import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { FACTORY_TIMEOUT_SECONDS } from "../config.js";
import type { FactoryInput, IssueResult } from "../types.js";
import { implement } from "./implement.js";
import { plan } from "./plan.js";

/**
 * The entry point. Plan, then fan out one `implement` run per issue. Each
 * run gets its own compute, its own retry and its own sandbox.
 */
export const factory = task(
  { name: "factory", timeoutSeconds: FACTORY_TIMEOUT_SECONDS },
  async function factory(ctx: TaskContext, input: FactoryInput): Promise<IssueResult[]> {
    const issues = await ctx.run(plan, input);
    if (issues.length === 0) {
      console.log("Nothing to work on.");
      return [];
    }
    console.log(`Working ${issues.length} issue(s) in parallel: ${issues.map((i) => `#${i.number}`).join(", ")}`);

    // allSettled, so one failed issue doesn't hide the others' pull requests.
    const outcomes = await Promise.allSettled(issues.map((issue) => ctx.run(implement, input.repo, issue)));

    return outcomes.map((outcome, i): IssueResult => {
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      return { issue: issues[i]!.number, status: "failed", error: String(outcome.reason) };
    });
  },
);
