import * as sandcastle from "@ai-hero/sandcastle";
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { z } from "zod";
import {
  agentSandbox,
  MAX_PARALLEL_ISSUES,
  PLAN_TIMEOUT_SECONDS,
  plannerAgent,
  promptPath,
  sandboxHooks,
} from "../config.js";
import { cloneRepo } from "../git.js";
import { listOpenIssues, type Issue } from "../github.js";
import type { FactoryInput, PlannedIssue } from "../types.js";

const planSchema = z.object({
  issues: z.array(z.number().int()),
});

/**
 * Read the labelled open issues, then have an agent pick the ones that can be
 * worked on in parallel without stepping on each other.
 */
export const plan = task(
  {
    name: "plan",
    timeoutSeconds: PLAN_TIMEOUT_SECONDS,
    retry: { maxRetries: 1, waitDurationMs: 30_000 },
  },
  async function plan(_ctx: TaskContext, input: FactoryInput): Promise<PlannedIssue[]> {
    const openIssues = await listOpenIssues(input.repo, input.label);
    console.log(`Found ${openIssues.length} open issue(s) labelled "${input.label}" in ${input.repo}`);
    if (openIssues.length === 0) {
      return [];
    }

    await using checkout = await cloneRepo(input.repo);
    const result = await sandcastle.run({
      name: "planner",
      cwd: checkout.dir,
      agent: plannerAgent(),
      sandbox: agentSandbox(PLAN_TIMEOUT_SECONDS),
      hooks: sandboxHooks,
      promptFile: promptPath("plan.md"),
      promptArgs: {
        ISSUES: formatIssues(openIssues),
        MAX_ISSUES: String(MAX_PARALLEL_ISSUES),
      },
      output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
      logging: { type: "stdout" },
    });

    // Keep only issues that exist, in case the planner invents a number.
    const chosen = new Set(result.output.issues);
    return openIssues
      .filter((issue) => chosen.has(issue.number))
      .slice(0, MAX_PARALLEL_ISSUES)
      .map(({ number, title }) => ({ number, title }));
  },
);

function formatIssues(issues: Issue[]): string {
  return issues.map((issue) => `## #${issue.number}: ${issue.title}\n\n${issue.body}`).join("\n\n");
}
