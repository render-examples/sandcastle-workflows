/** What a caller passes to the `factory` task. */
export interface FactoryInput {
  /** GitHub repo to work on, as `owner/name`. */
  repo: string;
  /** Only open issues with this label are considered. */
  label: string;
}

/** An issue the planner chose to work on. */
export interface PlannedIssue {
  number: number;
  title: string;
}

/** What happened to one issue. */
export type IssueResult =
  | { issue: number; status: "opened"; pullRequestUrl: string }
  | { issue: number; status: "no-changes" }
  | { issue: number; status: "failed"; error: string };
