/**
 * Git on the workflow host: clone the target repo, then push the agent's
 * branch. Sandcastle copies the clone into a sandbox and brings commits back.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GIT_IDENTITY, requireEnv } from "./config.js";
import { repoPath } from "./github.js";

export interface Checkout extends AsyncDisposable {
  /** Host path of the clone. Pass it to `sandcastle.run({ cwd })`. */
  readonly dir: string;
  /** The branch the clone started on, used as the pull request base. */
  readonly defaultBranch: string;
}

/** Clone a GitHub repo into a temp dir. `await using` deletes it afterwards. */
export async function cloneRepo(repo: string): Promise<Checkout> {
  const dir = await mkdtemp(join(tmpdir(), "sandcastle-"));
  await git(["clone", "--quiet", `https://github.com/${repoPath(repo)}.git`, dir]);
  // Sandcastle copies this identity into the sandbox for the agent's commits.
  await git(["config", "user.name", GIT_IDENTITY.name], dir);
  await git(["config", "user.email", GIT_IDENTITY.email], dir);
  // Sandcastle forwards every key listed in .sandcastle/.env from this
  // process's env, which holds RENDER_API_KEY and GITHUB_TOKEN.
  await rm(join(dir, ".sandcastle", ".env"), { force: true });

  return {
    dir,
    defaultBranch: await git(["branch", "--show-current"], dir),
    [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Push the agent's branch. A retried task replaces what an earlier attempt pushed. */
export async function pushBranch(checkout: Checkout, branch: string): Promise<void> {
  await git(["push", "--force", "--quiet", "origin", branch], checkout.dir);
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await promisify(execFile)("git", args, {
    cwd,
    env: { ...process.env, ...githubAuthEnv() },
  });
  return stdout.trim();
}

/**
 * Authenticate git to GitHub through env vars, so the token never appears in
 * argv (and so in error messages) or in the clone's .git/config.
 */
function githubAuthEnv(): Record<string, string> {
  const credentials = Buffer.from(`x-access-token:${requireEnv("GITHUB_TOKEN")}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${credentials}`,
  };
}
