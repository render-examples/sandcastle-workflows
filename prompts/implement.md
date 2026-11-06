# TASK

Resolve issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

{{ISSUE_BODY}}

Only work on this issue. You are on branch `{{SOURCE_BRANCH}}`.

# SCOPE

The issue's own scope and constraints come first. If the issue says which files to change, change only those.

Keep the change as small as the issue allows:

- Don't add or upgrade dependencies, and don't change config files (`package.json`, `tsconfig.json`, build or test config), unless the issue asks for it.
- Don't commit files that installing dependencies creates, such as a new lockfile.
- Don't fix problems that were already there. If a check fails for a reason unrelated to your change, leave it and say so in the commit message.

# CONTEXT

The last 10 commits:

!`git log -n 10 --format="%h %ad %s" --date=short`

# EXECUTION

1. Explore the repo, paying extra attention to tests near the code you'll change.
2. If the change has logic worth testing and the issue's scope allows tests, write a failing test first, then make it pass.
3. Install dependencies if you need them to run the project's checks.
4. Run the project's typecheck, lint and test commands. Fix failures your change caused.

# COMMIT

Commit your work with a message that starts with `#{{ISSUE_NUMBER}}:` and summarizes the change and any key decisions. Before committing, check `git status` and commit only the files the issue needs. Do not push. Do not comment on or close the issue. The workflow opens the pull request.

When the issue is fully resolved and committed, output <promise>COMPLETE</promise>.
