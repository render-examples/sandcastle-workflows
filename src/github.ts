/**
 * The few GitHub REST calls the workflow makes. They run on the workflow
 * host, so GITHUB_TOKEN never enters a sandbox.
 */

import { requireEnv } from "./config.js";

export interface Issue {
  number: number;
  title: string;
  body: string;
}

export async function listOpenIssues(repo: string, label: string): Promise<Issue[]> {
  const query = new URLSearchParams({ state: "open", labels: label, per_page: "100" });
  const items = await github<GitHubIssue[]>(`/repos/${repoPath(repo)}/issues?${query}`);
  // The issues endpoint also returns pull requests.
  return items.filter((item) => item.pull_request === undefined).map(toIssue);
}

export async function getIssue(repo: string, number: number): Promise<Issue> {
  return toIssue(await github<GitHubIssue>(`/repos/${repoPath(repo)}/issues/${number}`));
}

/** Open a pull request, or return the one already open for this branch. */
export async function openPullRequest(
  repo: string,
  pr: { branch: string; base: string; title: string; body: string },
): Promise<{ url: string }> {
  const [owner] = repoPath(repo).split("/");
  const query = new URLSearchParams({ state: "open", head: `${owner}:${pr.branch}` });
  const [existing] = await github<GitHubPullRequest[]>(`/repos/${repoPath(repo)}/pulls?${query}`);
  if (existing !== undefined) {
    return { url: existing.html_url };
  }

  const created = await github<GitHubPullRequest>(`/repos/${repoPath(repo)}/pulls`, {
    method: "POST",
    body: JSON.stringify({ head: pr.branch, base: pr.base, title: pr.title, body: pr.body }),
  });
  return { url: created.html_url };
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  pull_request?: unknown;
}

interface GitHubPullRequest {
  html_url: string;
}

function toIssue(item: GitHubIssue): Issue {
  return { number: item.number, title: item.title, body: item.body ?? "" };
}

async function github<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${requireEnv("GITHUB_TOKEN")}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** Reject anything that isn't `owner/name`, since it is spliced into URLs. */
export function repoPath(repo: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error(`Expected a GitHub repo as owner/name, got "${repo}"`);
  }
  return repo;
}
