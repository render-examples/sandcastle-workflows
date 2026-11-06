import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { run, type AgentProvider, type IsolatedSandboxHandle } from "@ai-hero/sandcastle";
import { renderSandbox } from "../src/render-sandbox.js";
import { localSandboxes } from "./local-sandboxes.js";

/** Call the provider's `create()` directly, as Sandcastle does internally. */
async function createHandle(env: Record<string, string> = {}) {
  const local = localSandboxes();
  const provider = renderSandbox({ image: "test", timeoutSeconds: 60, client: local.client });
  const create = (provider as unknown as { create: (o: { env: Record<string, string> }) => Promise<IsolatedSandboxHandle> }).create;
  const handle = await create({ env: { ...provider.env, ...env } });
  return { handle, local };
}

describe("renderSandbox() handle", () => {
  test("creates the sandbox with the requested lifetime and no idle suspension", async () => {
    const { local } = await createHandle({ FOO: "bar" });
    assert.equal(local.created[0]?.timeoutSeconds, 60);
    assert.equal(local.created[0]?.idleTimeoutSeconds, 0);
    assert.deepEqual(local.created[0]?.env, { IS_SANDBOX: "1", FOO: "bar" });
  });

  test("puts the worktree under the sandbox's home directory", async () => {
    const { handle, local } = await createHandle();
    assert.equal(handle.worktreePath, join(local.home, "workspace"));
  });

  test("streams whole lines to onLine, even when chunks split them", async () => {
    const { handle } = await createHandle({ FOO: "bar" });
    const lines: string[] = [];
    const result = await handle.exec("printf 'one\\ntwo\\n' && echo $FOO", { onLine: (line) => lines.push(line) });
    assert.deepEqual(lines, ["one", "two", "bar"]);
    assert.equal(result.exitCode, 0);
  });

  test("returns a nonzero exit instead of throwing", async () => {
    const { handle } = await createHandle();
    const result = await handle.exec("echo oops >&2; exit 3");
    assert.equal(result.exitCode, 3);
    assert.match(result.stderr, /oops/);
  });

  test("runs in the requested cwd", async () => {
    const { handle } = await createHandle();
    const result = await handle.exec("pwd", { cwd: "/tmp" });
    assert.match(result.stdout.trim(), /\/tmp$/);
  });

  test("pipes stdin larger than the 128 KB argument limit", async () => {
    const { handle } = await createHandle();
    const result = await handle.exec("wc -c | tr -d ' '", { stdin: "x".repeat(300_000) });
    assert.equal(result.stdout.trim(), "300000");
  });

  test("copies a directory in, a file in, and a file out", async () => {
    const { handle } = await createHandle();
    const hostDir = mkdtempSync(join(tmpdir(), "host-"));
    mkdirSync(join(hostDir, "nested"));
    writeFileSync(join(hostDir, "a.txt"), "A");
    writeFileSync(join(hostDir, "nested", "b.txt"), "B");

    await handle.copyIn(hostDir, `${handle.worktreePath}/dir`);
    await handle.copyIn(join(hostDir, "a.txt"), `${handle.worktreePath}/new/folder/a.txt`);
    const copied = await handle.exec("cat dir/a.txt dir/nested/b.txt new/folder/a.txt");
    assert.equal(copied.stdout, "ABA");

    await handle.exec("echo result > out.txt");
    await handle.copyFileOut(`${handle.worktreePath}/out.txt`, join(hostDir, "out", "out.txt"));
    assert.equal(readFileSync(join(hostDir, "out", "out.txt"), "utf8"), "result\n");
  });

  test("close() terminates the sandbox", async () => {
    const { handle, local } = await createHandle();
    await handle.close();
    assert.deepEqual(local.terminated, ["sbx-local-1"]);
  });
});

describe("renderSandbox() with sandcastle.run()", () => {
  test("syncs the repo in and the agent's commit back onto the named branch", async () => {
    const repo = mkdtempSync(join(tmpdir(), "repo-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo }).toString().trim();
    git("init", "--quiet", "--initial-branch", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("commit", "--quiet", "--allow-empty", "-m", "init");

    const local = localSandboxes();
    const result = await run({
      agent: committingAgent("do the thing"),
      sandbox: renderSandbox({ image: "test", timeoutSeconds: 60, client: local.client }),
      cwd: repo,
      branchStrategy: { type: "branch", branch: "sandcastle/issue-1" },
      prompt: "do the thing",
      logging: { type: "file", path: join(mkdtempSync(join(tmpdir(), "logs-")), "run.log") },
    });

    assert.equal(result.commits.length, 1);
    assert.equal(git("log", "-1", "--format=%s by %an", "sandcastle/issue-1"), "agent work by Test");
    assert.deepEqual(local.terminated, ["sbx-local-1"]);
  });
});

/** A stand-in agent that checks its prompt arrived on stdin, then commits. */
function committingAgent(expectedPrompt: string): AgentProvider {
  return {
    name: "committing-agent",
    env: {},
    captureSessions: false,
    buildPrintCommand: ({ prompt }) => ({
      command: [
        `test "$(cat)" = '${expectedPrompt}'`,
        "echo hi > agent.txt",
        "git add agent.txt",
        "git commit --quiet -m 'agent work'",
        "echo '<promise>COMPLETE</promise>'",
      ].join(" && "),
      stdin: prompt,
    }),
    parseStreamLine: (line) => [{ type: "text", text: line }],
  };
}
