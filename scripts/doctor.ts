// Check that this machine is ready to deploy and run the workflow.
// Prints no secret values.
//
//   npm run doctor                         # env vars, Render access, GitHub token
//   npm run doctor -- owner/repo           # also check the token can push to that repo
//   WORKFLOW_ID=wfl-... npm run doctor     # also check the deployed tasks registered

import { existsSync, readFileSync } from "node:fs";
import { Render } from "@renderinc/sdk";

const EXPECTED_PREFIXES: Record<string, string[]> = {
  RENDER_API_KEY: ["rnd_"],
  RENDER_WORKSPACE_ID: ["tea-"],
  GITHUB_TOKEN: ["github_pat_", "ghp_", "gho_", "ghu_", "ghs_"],
  CLAUDE_CODE_OAUTH_TOKEN: ["sk-ant-"],
};

let failed = false;
const pass = (message: string) => console.log(`PASS  ${message}`);
const fail = (message: string) => {
  console.log(`FAIL  ${message}`);
  failed = true;
};

// Node's env-file parser silently drops a stray line, so a token that wrapped
// onto two lines loads truncated. The Render CLI rejects the file instead.
if (existsSync(".env")) {
  const strayLines = readFileSync(".env", "utf8")
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line !== "" && !line.startsWith("#") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line));
  if (strayLines.length > 0) {
    fail(`.env line(s) ${strayLines.map((l) => l.number).join(", ")} aren't KEY=value. Join a wrapped token back onto its line.`);
  } else {
    pass(".env has one KEY=value per line");
  }
}

for (const [name, prefixes] of Object.entries(EXPECTED_PREFIXES)) {
  const value = process.env[name];
  if (!value) {
    fail(`${name} is not set. Add it to .env (see .env.example).`);
  } else if (/\s/.test(value)) {
    fail(`${name} contains whitespace. A pasted token probably wrapped onto a second line.`);
  } else if (!prefixes.some((prefix) => value.startsWith(prefix))) {
    fail(`${name} should start with ${prefixes.join(" or ")}.`);
  } else {
    pass(`${name} is set (${value.length} chars)`);
  }
}

if (process.env.RENDER_API_KEY && process.env.RENDER_WORKSPACE_ID) {
  try {
    const groups = await new Render().sandboxes.listGroups();
    pass(`Render API key works for ${process.env.RENDER_WORKSPACE_ID} (${groups.length} sandbox group(s))`);
  } catch (error) {
    fail(`Render API rejected the key or workspace: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const workflowId = process.env.WORKFLOW_ID;
if (workflowId && process.env.RENDER_API_KEY) {
  const response = await fetch(`https://api.render.com/v1/tasks?workflowId=${encodeURIComponent(workflowId)}`, {
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: "application/json" },
  });
  // The API answers an unknown workflow ID with `null`, not an empty list.
  const entries = (response.ok ? await response.json() : null) as { task: { name: string } }[] | null;
  const registered = new Set((entries ?? []).map(({ task }) => task.name));
  const missing = ["plan", "implement", "factory"].filter((name) => !registered.has(name));
  if (!response.ok) {
    fail(`Render API couldn't list tasks for ${workflowId}: ${response.status}`);
  } else if (missing.length > 0) {
    fail(`${workflowId} is missing task(s) ${missing.join(", ")}. The first build may still be running.`);
  } else {
    pass(`${workflowId} has registered plan, implement and factory`);
  }
}

if (process.env.GITHUB_TOKEN) {
  const github = (path: string) =>
    fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    });

  const user = await github("/user");
  if (user.ok) {
    pass(`GitHub token belongs to ${((await user.json()) as { login: string }).login}`);
  } else {
    fail(`GitHub rejected the token: ${user.status}`);
  }

  const repo = process.argv[2];
  if (repo !== undefined) {
    const response = await github(`/repos/${repo}`);
    const body = (await response.json()) as { has_issues?: boolean; permissions?: { push?: boolean } };
    if (!response.ok) {
      fail(`GitHub token can't see ${repo}: ${response.status}`);
    } else if (body.permissions?.push !== true) {
      fail(`GitHub token can read ${repo} but can't push to it`);
    } else if (body.has_issues === false) {
      fail(`${repo} has issues turned off`);
    } else {
      pass(`GitHub token can push to ${repo}`);
    }
  }
}

process.exitCode = failed ? 1 : 0;
