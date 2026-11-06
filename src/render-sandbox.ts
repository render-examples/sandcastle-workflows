/**
 * A Sandcastle sandbox provider backed by Render Sandboxes.
 *
 * Each `create()` starts one Render sandbox, and `close()` terminates it.
 * Sandcastle copies the repo in as a git bundle and copies the agent's
 * commits out as patches, so the sandbox image needs `git`.
 *
 * Render's `exec` has no stdin, working-directory or sudo options, so `exec`
 * below builds each of those into the bash script it sends.
 */

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  createIsolatedSandboxProvider,
  type ExecResult,
  type IsolatedSandboxHandle,
  type IsolatedSandboxProvider,
} from "@ai-hero/sandcastle";
import {
  Render,
  SandboxCreateWaitError,
  type SandboxesClient,
  type SandboxPlan,
} from "@renderinc/sdk";

export interface RenderSandboxOptions {
  /** Name or ID of a sandbox image. It must include `git`. */
  readonly image: string;
  /** Compute plan for the sandbox. Defaults to Render's default plan. */
  readonly plan?: SandboxPlan;
  /** Hard cap on the sandbox's lifetime. Set it to cover the whole agent run. */
  readonly timeoutSeconds: number;
  /** Extra environment variables for every command in the sandbox. */
  readonly env?: Record<string, string>;
  /**
   * The Render Sandboxes client. Defaults to `new Render().sandboxes`, which
   * reads RENDER_API_KEY and RENDER_WORKSPACE_ID from the host.
   */
  readonly client?: SandboxesClient;
}

type ExecOptions = Parameters<IsolatedSandboxHandle["exec"]>[1];

/** How much of a streamed command's output to keep for its `ExecResult`. */
const MAX_STREAMED_OUTPUT_CHARS = 64 * 1024;

export function renderSandbox(options: RenderSandboxOptions): IsolatedSandboxProvider {
  return createIsolatedSandboxProvider({
    name: "render",
    // Commands run as root, where Claude Code skips its own permission
    // checks only if it knows it is inside a sandbox.
    env: { IS_SANDBOX: "1", ...options.env },
    create: async ({ env }) => {
      const sandboxes = options.client ?? new Render().sandboxes;
      const sandboxId = await createRunningSandbox(sandboxes, options, env);
      try {
        return await connect(sandboxes, sandboxId);
      } catch (error) {
        await sandboxes.terminate(sandboxId).catch(() => undefined);
        throw error;
      }
    },
  });
}

async function createRunningSandbox(
  sandboxes: SandboxesClient,
  options: RenderSandboxOptions,
  env: Record<string, string>,
): Promise<string> {
  try {
    const sandbox = await sandboxes.create({
      image: options.image,
      plan: options.plan,
      timeoutSeconds: options.timeoutSeconds,
      // Sandcastle goes quiet between commands while it works on the host.
      // A suspend in that gap would stall the run, so never suspend.
      idleTimeoutSeconds: 0,
      env,
      wait: { timeoutMs: 120_000 },
    });
    return sandbox.id;
  } catch (error) {
    if (error instanceof SandboxCreateWaitError) {
      await sandboxes.terminate(error.sandboxId).catch(() => undefined);
    }
    throw error;
  }
}

/** Prepare the worktree folder and return the handle Sandcastle drives. */
async function connect(
  sandboxes: SandboxesClient,
  sandboxId: string,
): Promise<IsolatedSandboxHandle> {
  const setup = await runOrThrow(
    sandboxes,
    sandboxId,
    'mkdir -p "$HOME/workspace" && cd "$HOME/workspace" && pwd && id -u',
  );
  const [worktreePath = "", uid = ""] = setup.stdout.trim().split("\n");
  const isRoot = uid === "0";

  return {
    worktreePath,
    sandboxId,

    exec: async (command, execOptions) => {
      const stdinPath = execOptions?.stdin === undefined ? undefined : `/tmp/sandcastle-stdin-${randomUUID()}`;
      if (stdinPath !== undefined) {
        await sandboxes.upload(sandboxId, stdinPath, execOptions?.stdin ?? "");
      }
      const script = buildScript(command, {
        cwd: execOptions?.cwd ?? worktreePath,
        stdinPath,
        sudo: execOptions?.sudo === true && !isRoot,
      });
      try {
        return await execStreaming(sandboxes, sandboxId, script, execOptions?.onLine);
      } finally {
        if (stdinPath !== undefined) {
          await execStreaming(sandboxes, sandboxId, `rm -f ${quote(stdinPath)}`).catch(() => undefined);
        }
      }
    },

    copyIn: async (hostPath, sandboxPath) => {
      if ((await stat(hostPath)).isDirectory()) {
        await runOrThrow(sandboxes, sandboxId, `mkdir -p ${quote(sandboxPath)}`);
        await sandboxes.upload(sandboxId, sandboxPath, await tarDirectory(hostPath), undefined, {
          contentType: "application/x-tar",
        });
      } else {
        await runOrThrow(sandboxes, sandboxId, `mkdir -p ${quote(posix.dirname(sandboxPath))}`);
        await sandboxes.upload(sandboxId, sandboxPath, createReadStream(hostPath));
      }
    },

    copyFileOut: async (sandboxPath, hostPath) => {
      const download = await sandboxes.download(sandboxId, sandboxPath);
      await mkdir(dirname(hostPath), { recursive: true });
      await writeFile(hostPath, download.data);
    },

    close: async () => {
      await sandboxes.terminate(sandboxId);
    },
  };
}

/** Wrap a Sandcastle command with the cwd, stdin and sudo it asked for. */
function buildScript(
  command: string,
  { cwd, stdinPath, sudo }: { cwd: string; stdinPath?: string; sudo: boolean },
): string {
  let script = stdinPath === undefined ? command : `{ ${command}\n} < ${quote(stdinPath)}`;
  if (sudo) {
    script = `sudo -E bash -c ${quote(script)}`;
  }
  return `cd ${quote(cwd)} && ${script}`;
}

/** Run a script, calling `onLine` for each stdout line as it arrives. */
async function execStreaming(
  sandboxes: SandboxesClient,
  sandboxId: string,
  script: string,
  onLine?: (line: string) => void,
): Promise<ExecResult> {
  // A streamed command is usually the agent, which can print for hours.
  const keep = onLine === undefined ? (text: string) => text : keepTail;
  let stdout = "";
  let stderr = "";
  let partialLine = "";
  let exitCode: number | undefined;

  for await (const event of await sandboxes.exec(sandboxId, script)) {
    if (event.type === "exit") {
      exitCode = event.exit_code;
    } else if (event.stream === "stderr") {
      stderr = keep(stderr + event.data);
    } else {
      stdout = keep(stdout + event.data);
      if (onLine !== undefined) {
        const lines = (partialLine + event.data).split("\n");
        partialLine = lines.pop() ?? "";
        lines.forEach((line) => onLine(line));
      }
    }
  }
  if (onLine !== undefined && partialLine !== "") {
    onLine(partialLine);
  }

  if (exitCode === undefined) {
    throw new Error(`Render sandbox ${sandboxId}: command stream ended without an exit code`);
  }
  return { stdout, stderr, exitCode };
}

async function runOrThrow(sandboxes: SandboxesClient, sandboxId: string, script: string): Promise<ExecResult> {
  const result = await execStreaming(sandboxes, sandboxId, script);
  if (result.exitCode !== 0) {
    throw new Error(`Render sandbox ${sandboxId}: \`${script}\` exited ${result.exitCode}: ${result.stderr}`);
  }
  return result;
}

function keepTail(text: string): string {
  return text.length > MAX_STREAMED_OUTPUT_CHARS ? text.slice(-MAX_STREAMED_OUTPUT_CHARS) : text;
}

async function tarDirectory(dir: string): Promise<Buffer> {
  const { stdout } = await promisify(execFile)("tar", ["-cf", "-", "-C", dir, "."], {
    encoding: "buffer",
    maxBuffer: 1024 * 1024 * 1024,
  });
  return stdout;
}

/** Quote a string for bash. */
function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
