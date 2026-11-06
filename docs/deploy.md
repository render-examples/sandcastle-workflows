# Deploy to Render

A runbook for taking this repo from a fresh clone to a live workflow that has opened its first pull request. It's written for a coding agent, and a person can follow it too. Run every command from the repo root.

Each step gives a command, what success looks like, and what to do if it fails. Steps marked **Human** need the person you're working with.

**Rules for the agent:**

- Never print, log or commit `.env` or any token. Use `npm run doctor` to check values without showing them.
- Ask before each step that creates something: the sandbox image, the workflow service, labels and issues.
- Never push to a target repo's default branch, and never bypass branch protection.
- If a step fails, stop and report the error. Don't repeat a step that creates something until you know why it failed.

## 1. Check the tools

```bash
node --version       # v24 or later
render --version     # v2.16 or later. Install: brew install render
npm ci
npm test             # 9 tests pass. No Render account needed.
```

## 2. Fill in `.env` (Human)

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

## 3. Import the sandbox image

```bash
npm run import-image
```

This imports `node:24-bookworm` (Node, git, root user) into the workspace's default sandbox group as `sandcastle-node`. It takes about 90 seconds. Success: `Image sbb-... is ready.` It's safe to run again.

## 4. Create the workflow service

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

- To change the prompts or config, deploy from a fork: point `--repo` at the fork. A service deployed from `render-examples` redeploys when that repo changes.
- If the CLI fails with `x509: certificate signed by unknown authority`, a proxy on this machine is intercepting its TLS. Ask the human to use the [Deploy to Render](https://render.com/deploy?repo=https://github.com/render-examples/sandcastle-workflows) button instead, and to enter the same four values when the Dashboard asks. The service ID is on the service's page.

## 5. Check the tasks registered

The first build takes a minute or two. Poll until the tasks appear:

```bash
WORKFLOW_ID=wfl-... npm run doctor
```

Success: `PASS  wfl-... has registered plan, implement and factory`. If tasks are still missing after five minutes, check the build logs on the service's page in the Dashboard.

## 6. Run it once (Human picks the repo)

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

## 7. Report back

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
