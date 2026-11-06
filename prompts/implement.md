# TASK

Resolve issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

{{ISSUE_BODY}}

Only work on this issue. You are on branch `{{SOURCE_BRANCH}}`.

# CONTEXT

The last 10 commits:

!`git log -n 10 --format="%h %ad %s" --date=short`

# EXECUTION

1. Explore the repo, paying extra attention to tests near the code you'll change.
2. Install dependencies if the project needs them.
3. Write a failing test, make it pass, and repeat until the issue is resolved.
4. Run the project's typecheck, lint and test commands, and fix what fails.

# COMMIT

Commit your work with a message that starts with `#{{ISSUE_NUMBER}}:` and summarizes the change and any key decisions. Do not push. Do not comment on or close the issue. The workflow opens the pull request.

When the issue is fully resolved and committed, output <promise>COMPLETE</promise>.
