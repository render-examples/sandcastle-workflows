import * as sandcastle from "@ai-hero/sandcastle";
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import {
  agentSandbox,
  IMPLEMENT_TIMEOUT_SECONDS,
  implementerAgent,
  promptPath,
  sandboxHooks,
} from "../config.js";
import { cloneRepo, pushBranch } from "../git.js";
import { getIssue, openPullRequest } from "../github.js";
import type { IssueResult, PlannedIssue } from "../types.js";

/** Maximum agent iterations per issue before Sandcastle stops the loop. */
const MAX_ITERATIONS = 20;

/**
 * Work one issue in its own sandbox, on its own branch, then open a pull
 * request for it. The factory runs one of these per planned issue.
 */
export const implement = task(
  {
    name: "implement",
    timeoutSeconds: IMPLEMENT_TIMEOUT_SECONDS,
    retry: { maxRetries: 1, waitDurationMs: 60_000 },
  },
  async function implement(_ctx: TaskContext, repo: string, planned: PlannedIssue): Promise<IssueResult> {
    // Deterministic, so a retry reuses the same branch and pull request.
    const branch = `sandcastle/issue-${planned.number}`;
    const issue = await getIssue(repo, planned.number);

    await using checkout = await cloneRepo(repo);
    const result = await sandcastle.run({
      name: `issue-${issue.number}`,
      cwd: checkout.dir,
      agent: implementerAgent(),
      sandbox: agentSandbox(IMPLEMENT_TIMEOUT_SECONDS),
      hooks: sandboxHooks,
      branchStrategy: { type: "branch", branch },
      maxIterations: MAX_ITERATIONS,
      promptFile: promptPath("implement.md"),
      promptArgs: {
        ISSUE_NUMBER: String(issue.number),
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: issue.body,
      },
      logging: { type: "stdout" },
    });

    if (result.commits.length === 0) {
      console.log(`#${issue.number}: the agent made no commits`);
      return { issue: issue.number, status: "no-changes" };
    }

    await pushBranch(checkout, branch);
    const pullRequest = await openPullRequest(repo, {
      branch,
      base: checkout.defaultBranch,
      title: issue.title,
      body: `Closes #${issue.number}\n\nOpened by Sandcastle running on Render Workflows.`,
    });
    console.log(`#${issue.number}: opened ${pullRequest.url}`);
    return { issue: issue.number, status: "opened", pullRequestUrl: pullRequest.url };
  },
);
