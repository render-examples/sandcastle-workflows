/**
 * A stand-in for the Render Sandboxes client that runs every command with
 * local bash, so the provider can be tested without a Render account.
 * Only the methods `renderSandbox()` calls are implemented.
 */

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SandboxCreateInput, SandboxesClient, SandboxExecEvent, SandboxUploadOptions } from "@renderinc/sdk";

export interface LocalSandboxes {
  client: SandboxesClient;
  /** What the provider passed to `create()`, most recent last. */
  created: SandboxCreateInput[];
  terminated: string[];
  /** The fake sandbox's $HOME. */
  home: string;
}

export function localSandboxes(): LocalSandboxes {
  const home = mkdtempSync(join(tmpdir(), "sandbox-home-"));
  const created: SandboxCreateInput[] = [];
  const terminated: string[] = [];

  const client = {
    async create(input: SandboxCreateInput) {
      created.push(input);
      return { id: `sbx-local-${created.length}` };
    },

    async terminate(sandboxId: string) {
      terminated.push(sandboxId);
    },

    async exec(_sandboxId: string, script: string) {
      const env = { ...process.env, HOME: home, ...created.at(-1)?.env };
      return runBash(script, env);
    },

    async upload(_sandboxId: string, path: string, data: unknown, _ownerId: unknown, options?: SandboxUploadOptions) {
      if (options?.contentType === "application/x-tar") {
        execFileSync("tar", ["-xf", "-", "-C", path], { input: data as Buffer });
      } else if (data instanceof Readable) {
        await pipeline(data, createWriteStream(path));
      } else {
        writeFileSync(path, data as string);
      }
    },

    async download(_sandboxId: string, path: string) {
      const data = readFileSync(path);
      return { data, size: data.length };
    },
  };

  return { client: client as unknown as SandboxesClient, created, terminated, home };
}

/** Stream a bash script's output as Render exec events. */
async function* runBash(script: string, env: NodeJS.ProcessEnv): AsyncGenerator<SandboxExecEvent> {
  const child = spawn("bash", ["-c", script], { env });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));

  for await (const chunk of child.stdout) {
    // Split each chunk mid-line, as a network stream can.
    const text = String(chunk);
    const middle = Math.floor(text.length / 2);
    yield { type: "output", stream: "stdout", data: text.slice(0, middle) };
    yield { type: "output", stream: "stdout", data: text.slice(middle) };
  }
  const code = await exitCode;
  if (stderr !== "") {
    yield { type: "output", stream: "stderr", data: stderr };
  }
  yield { type: "exit", exit_code: code };
}
