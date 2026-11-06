// Start a factory run and wait for its result.
//
//   npm run trigger -- owner/repo [label]
//
// Against the local task server (`npm run dev`), set RENDER_USE_LOCAL_DEV=true.

import { Render } from "@renderinc/sdk";
import type { FactoryInput } from "../src/types.js";

const WORKFLOW_SLUG = process.env.WORKFLOW_SLUG ?? "sandcastle-workflows";

const [repo, label = "sandcastle"] = process.argv.slice(2);
if (repo === undefined) {
  console.error("Usage: npm run trigger -- owner/repo [label]");
  process.exit(1);
}

const input: FactoryInput = { repo, label };
const run = await new Render().workflows.startTask(`${WORKFLOW_SLUG}/factory`, [input]);
console.log(`Started task run ${run.taskRunId}. Waiting for it to finish...`);

const finished = await run.get();
console.log(`Run ${finished.status}.`);
console.log(JSON.stringify(finished.results, null, 2));
