import { fileURLToPath } from "node:url";
import { claudeCode, type SandboxHooks } from "@ai-hero/sandcastle";
import { renderSandbox } from "./render-sandbox.js";

/** Name of the sandbox image that `npm run import-image` creates. */
export const SANDBOX_IMAGE = "sandcastle-node";

/** The most issues one factory run works on at once. */
export const MAX_PARALLEL_ISSUES = 5;

export const PLAN_TIMEOUT_SECONDS = 30 * 60;

/** How long one agent may spend on one issue, from clone to pull request. */
export const IMPLEMENT_TIMEOUT_SECONDS = 2 * 60 * 60;

/** The factory waits on every child task, so it has to outlive all of them. */
export const FACTORY_TIMEOUT_SECONDS = PLAN_TIMEOUT_SECONDS + IMPLEMENT_TIMEOUT_SECONDS + 60 * 60;

/** Author of the agent's commits. */
export const GIT_IDENTITY = {
  name: "Sandcastle",
  email: "sandcastle@users.noreply.github.com",
};

export function plannerAgent() {
  return claudeCode("claude-opus-4-8", { env: claudeEnv() });
}

export function implementerAgent() {
  return claudeCode("claude-sonnet-4-6", { env: claudeEnv() });
}

export function agentSandbox(timeoutSeconds: number) {
  return renderSandbox({ image: SANDBOX_IMAGE, plan: "2c-4g", timeoutSeconds });
}

/** Runs inside each sandbox before the agent starts. */
export const sandboxHooks: SandboxHooks = {
  sandbox: {
    onSandboxReady: [{ command: "npm install --global @anthropic-ai/claude-code" }],
  },
};

export function promptPath(name: string): string {
  return fileURLToPath(new URL(`../prompts/${name}`, import.meta.url));
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

/** The only secret that enters a sandbox. The agent can read it. */
function claudeEnv() {
  return { CLAUDE_CODE_OAUTH_TOKEN: requireEnv("CLAUDE_CODE_OAUTH_TOKEN") };
}
