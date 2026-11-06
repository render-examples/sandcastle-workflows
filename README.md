# Sandcastle on Render Workflows

Point this at a GitHub repo and an issue label. It opens one pull request per issue, each written by a [Sandcastle](https://github.com/mattpocock/sandcastle) coding agent working in its own [Render Sandbox](https://render.com/docs/sandboxes).

```
factory                      one run, waits for everything below
├── plan                     reads labelled issues, picks the ones that can run in parallel
├── implement  #42           own compute, own retry, own sandbox, own branch → pull request
├── implement  #57
└── implement  #63
```

Render Workflows provides durability: each task has its own retries and timeouts, the issue runs fan out in parallel, and a run can last up to 24 hours. Render Sandboxes provide isolation: agents run in disposable microVMs, so their code never runs on the workflow host.

## How it works

Each task runs on a workflow instance (the **host**). The host clones the target repo, then calls `sandcastle.run()` with `renderSandbox()`, the provider in [`src/render-sandbox.ts`](src/render-sandbox.ts). Sandcastle copies the repo into a new sandbox, runs Claude Code there, and copies the agent's commits back onto a branch on the host. The host pushes that branch and opens the pull request.

| File | What it does |
| --- | --- |
| [`src/tasks/factory.ts`](src/tasks/factory.ts) | Entry point. Runs `plan`, then one `implement` per issue. |
| [`src/tasks/plan.ts`](src/tasks/plan.ts) | Lists the labelled open issues. An Opus agent picks up to five that won't conflict. |
| [`src/tasks/implement.ts`](src/tasks/implement.ts) | A Sonnet agent resolves one issue on `sandcastle/issue-<n>`. The task then pushes the branch and opens a pull request. |
| [`src/render-sandbox.ts`](src/render-sandbox.ts) | The Sandcastle sandbox provider for Render Sandboxes. |
| [`src/config.ts`](src/config.ts) | Models, timeouts, sandbox image and plan. Start here to tune it. |
| [`prompts/`](prompts) | The planner and implementer prompts. |

### Where secrets live

| Secret | Host | Sandbox |
| --- | --- | --- |
| `RENDER_API_KEY`, `RENDER_WORKSPACE_ID` | Creates and drives sandboxes | Never |
| `GITHUB_TOKEN` | Reads issues, clones, pushes, opens pull requests | Never |
| `CLAUDE_CODE_OAUTH_TOKEN` | Passed to the agent | Yes. The agent can read it. |

The agent never gets a GitHub token: it commits locally, and the host does the pushing. Render Sandboxes don't broker credentials yet, so the Claude token has to be an ordinary environment variable inside the sandbox.

## Run it

You need Node 24, the [Render CLI](https://render.com/docs/cli), a Render workspace with Sandboxes enabled, and a Claude Code login (`claude setup-token`). Use a GitHub token with **Contents** and **Pull requests** write access to the target repo. A fine-grained token scoped to a single fork is a good choice.

```bash
npm install
cp .env.example .env        # fill in the four values
npm run import-image        # one-time: imports node:24-bookworm as the "sandcastle-node" sandbox image
```

Label a few issues `sandcastle` in the target repo. A fork of `mattpocock/sandcastle` makes a good first target.

### Locally

The workflow tasks run on your machine, and each agent still runs in a real Render Sandbox.

```bash
npm run dev                                                       # terminal 1: local task server
RENDER_USE_LOCAL_DEV=true npm run trigger -- you/sandcastle       # terminal 2
```

`trigger` takes an optional second argument for the label, which defaults to `sandcastle`. You can also run a single task, for example only the planner:

```bash
render workflows start plan --local --input='[{"repo":"you/sandcastle","label":"sandcastle"}]'
```

### On Render

1. Push this template to your own GitHub repo and set `repo:` in [`render.yaml`](render.yaml) to it.
2. In the Render Dashboard, go to **New > Blueprint** and select the repo. Enter the four secrets when prompted.
3. Start a run from your machine:

```bash
npm run trigger -- you/sandcastle
```

The workflow slug defaults to `sandcastle-workflows`. If you renamed the service, set `WORKFLOW_SLUG`.

Workflows have no built-in schedule. To run nightly, add a [cron job](https://render.com/docs/cronjobs) that runs `npm run trigger -- you/sandcastle` with `RENDER_API_KEY` set.

## Tests

```bash
npm test
```

The tests cover `renderSandbox()`, using a stand-in Render client that runs each command with local bash. They check the provider contract (streamed output, stdin, cwd, file copies, teardown), plus a full `sandcastle.run()` that commits inside the sandbox and lands the commit on a host branch. No Render account is needed.

## Things to know

- **Each sandbox installs Claude Code at startup.** The hook is in `src/config.ts`, and it adds some time to every run. A faster setup is a [filesystem snapshot](https://render.com/docs/sandboxes) with Claude Code preinstalled. `sandboxes.create()` accepts a `snapshotName` in place of `image`.
- **Sandboxes never idle-suspend.** Sandcastle goes quiet in a sandbox while it does git work on the host, so the provider sets `idleTimeoutSeconds: 0`. Each sandbox's lifetime matches its task's timeout.
- **Retries are safe to repeat.** Branch names are deterministic, the push is a force push to the agent's own branch, and the existing pull request is reused.
- **`.sandcastle/.env` is removed from the clone.** Sandcastle forwards every key listed in that file from the host environment, and the host environment holds the Render and GitHub tokens.
- **Render Sandboxes and Workflows are in beta.** APIs and limits may change. See the [Workflows limits](https://render.com/docs/workflows-limits) and [Sandboxes docs](https://render.com/docs/sandboxes).
