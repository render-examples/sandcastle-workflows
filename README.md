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

## Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/render-examples/sandcastle-workflows)

[`docs/deploy.md`](docs/deploy.md) takes you from a fresh clone to a first pull request. It's written so a coding agent can follow it: open this repo in Claude Code, Cursor or Codex and ask it to deploy to Render using `docs/deploy.md`.

You'll need a Render API key and workspace ID, a GitHub token for the target repo, and a Claude Code login. Once it's live, start a run with:

```bash
npm run trigger -- owner/repo            # works issues labelled "sandcastle"
npm run trigger -- owner/repo my-label   # or another label
```

## How it works

Each task runs on a workflow instance (the **host**). The host clones the target repo, then calls `sandcastle.run()` with `renderSandbox()`, the provider in [`src/render-sandbox.ts`](src/render-sandbox.ts). Sandcastle copies the repo into a new sandbox, runs Claude Code there, and copies the agent's commits back onto a branch on the host. The host pushes that branch and opens the pull request.

| File | What it does |
| --- | --- |
| [`src/tasks/factory.ts`](src/tasks/factory.ts) | Entry point. Runs `plan`, then one `implement` per issue. |
| [`src/tasks/plan.ts`](src/tasks/plan.ts) | Lists the labelled open issues. An Opus agent picks up to five that won't conflict. |
| [`src/tasks/implement.ts`](src/tasks/implement.ts) | A Sonnet agent resolves one issue on `sandcastle/issue-<n>`. The task then pushes the branch and opens a pull request. |
| [`src/render-sandbox.ts`](src/render-sandbox.ts) | The Sandcastle sandbox provider for Render Sandboxes. |
| [`src/config.ts`](src/config.ts) | Models, timeouts, issue limit, sandbox image and plan. Start here to tune it. |
| [`prompts/`](prompts) | The planner and implementer prompts. |

### Where secrets live

| Secret | Host | Sandbox |
| --- | --- | --- |
| `RENDER_API_KEY`, `RENDER_WORKSPACE_ID` | Creates and drives sandboxes | Never |
| `GITHUB_TOKEN` | Reads issues, clones, pushes, opens pull requests | Never |
| `CLAUDE_CODE_OAUTH_TOKEN` | Passed to the agent | Yes. The agent can read it. |

The agent never gets a GitHub token: it commits locally, and the host does the pushing. Render Sandboxes don't broker credentials yet, so the Claude token has to be an ordinary environment variable inside the sandbox.

## Develop locally

```bash
npm run dev                                                  # local task server, loads .env
RENDER_USE_LOCAL_DEV=true npm run trigger -- owner/repo      # in another terminal
npm test                                                     # provider tests, no Render account needed
```

Locally, the workflow tasks run on your machine, and each agent still runs in a real Render Sandbox.

## Things to know

- **Workflows have no built-in schedule.** To run nightly, add a [cron job](https://render.com/docs/cronjobs) that runs `npm run trigger -- owner/repo`.
- **Retries are safe to repeat.** Branch names are deterministic, the push is a force push to the agent's own branch, and the existing pull request is reused.
- **Sandboxes never idle-suspend.** Sandcastle goes quiet in a sandbox while it does git work on the host, so the provider sets `idleTimeoutSeconds: 0`. Each sandbox's lifetime matches its task's timeout.
- **`.sandcastle/.env` is removed from each clone.** Sandcastle forwards every key listed in that file from the host environment, and the host environment holds the Render and GitHub tokens.
- **Render Sandboxes and Workflows are in beta.** APIs and limits may change. See the [Workflows limits](https://render.com/docs/workflows-limits) and [Sandboxes docs](https://render.com/docs/sandboxes).
