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

## Deploy it with your coding agent

Clone this repo, open it in Claude Code, Cursor or Codex, and paste:

> Deploy this repo to my Render workspace by following the Runbook in README.md. Ask me before each step that creates something, and never print or commit my secrets.

The agent does everything except two steps that need you: creating four tokens, and choosing a repo for the first test run. To click through it yourself instead, follow the same steps.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/render-examples/sandcastle-workflows)

## Runbook

These steps are written for a coding agent. Each one gives a command, what success looks like, and what to do if it fails. Steps marked **Human** need the person you're working with.

**Rules for the agent:**

- Never print, log or commit `.env` or any token. Use `npm run doctor` to check values without showing them.
- Ask before each step that creates something: the sandbox image, the workflow service, labels and issues.
- Never push to a target repo's default branch, and never bypass branch protection.
- If a step fails, stop and report the error. Don't repeat a step that creates something until you know why it failed.

### 1. Check the tools

```bash
node --version       # v24 or later
render --version     # v2.16 or later. Install: brew install render
npm ci
npm test             # 9 tests pass. No Render account needed.
```

### 2. Fill in `.env` (Human)

The human creates the tokens and pastes them into `.env`. Don't ask them to paste secrets into the chat.

```bash
cp .env.example .env
```

| Variable | Where to get it | Starts with |
| --- | --- | --- |
| `RENDER_API_KEY` | Render Dashboard > **Account Settings** > **API Keys** | `rnd_` |
| `RENDER_WORKSPACE_ID` | Top of the workspace's **Settings** page in the Dashboard | `tea-` |
| `GITHUB_TOKEN` | A [fine-grained token](https://github.com/settings/personal-access-tokens/new) for the target repo, with **Contents** and **Pull requests** read and write and **Issues** read. `gh auth token` also works but can reach every repo you can. | `github_pat_` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Run `claude setup-token` (needs a Claude Pro or Max plan) | `sk-ant-` |

Then check it:

```bash
npm run doctor
```

Success: every line says `PASS`. The most common failure is a token that wrapped onto a second line when it was copied. The doctor reports the line number.

### 3. Import the sandbox image

```bash
npm run import-image
```

This imports `node:24-bookworm` (Node, git, root user) into the workspace's default sandbox group as `sandcastle-node`. It takes about 90 seconds. Success: `Image sbb-... is ready.` It's safe to run again.

### 4. Create the workflow service

```bash
render workflows create \
  --name sandcastle-workflows \
  --repo https://github.com/render-examples/sandcastle-workflows \
  --branch main \
  --runtime node \
  --build-command "npm ci" \
  --run-command "npm start" \
  --region oregon \
  --env-file .env \
  --confirm -o json
```

Success: JSON with an `id` starting with `wfl-`. Save it as `WORKFLOW_ID`. This uploads the four values in `.env` to the service, which is what it needs.

- To change the prompts or config, deploy from a fork: point `--repo` at the fork. A service deployed from `render-examples` redeploys when this repo changes.
- If the CLI fails with `x509: certificate signed by unknown authority`, a proxy on this machine is intercepting its TLS. Ask the human to use the **Deploy to Render** button above instead, and to enter the same four values when the Dashboard asks. The service ID is on the service's page.

### 5. Check the tasks registered

The first build takes a minute or two. Poll until the tasks appear:

```bash
WORKFLOW_ID=wfl-... npm run doctor
```

Success: `PASS  wfl-... has registered plan, implement and factory`. If tasks are still missing after five minutes, check the build logs on the service's page in the Dashboard.

### 6. Run it once (Human picks the repo)

Ask the human which repo to test against. It must be one they own and are happy to receive a pull request on. Then check the token can push to it:

```bash
npm run doctor -- owner/repo
```

With the human's OK, add a label and one small, well-scoped issue:

```bash
gh label create sandcastle -R owner/repo --description "Picked up by Sandcastle on Render Workflows"
gh issue create -R owner/repo --label sandcastle \
  --title "Add a one-paragraph project description to the README" \
  --body "Only change README.md."
```

Start a run and wait for it:

```bash
npm run trigger -- owner/repo
```

Success, after about two to three minutes:

```json
[[{ "issue": 1, "status": "opened", "pullRequestUrl": "https://github.com/owner/repo/pull/2" }]]
```

`no-changes` means the agent decided nothing needed doing. `failed` includes the error.

### 7. Report back

Tell the human the workflow ID, the pull request URL, and anything that failed or looked off. Leave the pull request for them to review.

## Troubleshooting

| Error | Cause and fix |
| --- | --- |
| `failed to load env file .env: unexpected character` | A token wrapped onto a second line. Run `npm run doctor`, then join the reported line back onto the line above it. |
| `Missing environment variable X. See .env.example.` | Locally, `X` isn't in `.env`. On Render, add it to the service's environment variables. |
| `x509: certificate signed by unknown authority` from `render` | TLS interception on this machine. Use the Dashboard for that step. The npm scripts aren't affected. |
| `port 8120 is already in use` from `npm run dev` | Another local workflow server is running. Use `render workflows dev --port 8121 -- npm start`, and set `RENDER_LOCAL_DEV_URL=http://localhost:8121` for `trigger`. |
| Sandbox creation fails with an image error | The image is missing in the workspace's default sandbox group. Run `npm run import-image` with the same `RENDER_WORKSPACE_ID`. |
| A pull request changes files the issue didn't ask for | Tighten the issue's scope, or edit `prompts/implement.md` in your fork. |
| `GH013: Repository rule violations` on push | The repo requires pull requests. Push a branch and open one. |

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
| [`scripts/`](scripts) | `doctor`, `import-image` and `trigger`. |

### Where secrets live

| Secret | Host | Sandbox |
| --- | --- | --- |
| `RENDER_API_KEY`, `RENDER_WORKSPACE_ID` | Creates and drives sandboxes | Never |
| `GITHUB_TOKEN` | Reads issues, clones, pushes, opens pull requests | Never |
| `CLAUDE_CODE_OAUTH_TOKEN` | Passed to the agent | Yes. The agent can read it. |

The agent never gets a GitHub token: it commits locally, and the host does the pushing. Render Sandboxes don't broker credentials yet, so the Claude token has to be an ordinary environment variable inside the sandbox.

## After it's live

- **Scheduling.** Workflows have no built-in schedule. To run nightly, add a [cron job](https://render.com/docs/cronjobs) that runs `npm run trigger -- owner/repo` with `RENDER_API_KEY` set.
- **A different label.** `npm run trigger -- owner/repo my-label`.
- **A renamed service.** `trigger` uses the slug `sandcastle-workflows`. Set `WORKFLOW_SLUG` if you named it differently.
- **Running tasks locally.** `npm run dev` starts a local task server that loads `.env`. Each agent still runs in a real Render Sandbox. Trigger it with `RENDER_USE_LOCAL_DEV=true npm run trigger -- owner/repo`, or run one task with `render workflows start plan --local --input='[{"repo":"owner/repo","label":"sandcastle"}]'`.

## Tests

```bash
npm test
```

The tests cover `renderSandbox()`, using a stand-in Render client that runs each command with local bash. They check the provider contract (streamed output, stdin, cwd, file copies, teardown), plus a full `sandcastle.run()` that commits inside the sandbox and lands the commit on a host branch.

## Things to know

- **Each sandbox installs Claude Code at startup.** It takes a few seconds, and the hook is in `src/config.ts`. A [filesystem snapshot](https://render.com/docs/sandboxes) with Claude Code preinstalled would skip it. `sandboxes.create()` accepts a `snapshotName` in place of `image`.
- **Sandboxes never idle-suspend.** Sandcastle goes quiet in a sandbox while it does git work on the host, so the provider sets `idleTimeoutSeconds: 0`. Each sandbox's lifetime matches its task's timeout.
- **Retries are safe to repeat.** Branch names are deterministic, the push is a force push to the agent's own branch, and the existing pull request is reused.
- **`.sandcastle/.env` is removed from each clone.** Sandcastle forwards every key listed in that file from the host environment, and the host environment holds the Render and GitHub tokens.
- **Render Sandboxes and Workflows are in beta.** APIs and limits may change. See the [Workflows limits](https://render.com/docs/workflows-limits) and [Sandboxes docs](https://render.com/docs/sandboxes).
