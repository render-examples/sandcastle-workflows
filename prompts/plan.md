# ISSUES

These open issues are ready for work:

{{ISSUES}}

# TASK

Explore the repo, then decide which of these issues can be worked on at the same time, each by a separate agent on its own branch.

Two issues conflict if:

- one needs code or infrastructure the other introduces
- they are likely to change the same files or modules
- one depends on a decision or API shape the other will make

Pick at most {{MAX_ISSUES}} issues that don't conflict with each other. Prefer small, well-specified issues. If every issue conflicts with another, pick the single one with the fewest dependencies.

Do not change any files.

# OUTPUT

Output the chosen issue numbers as JSON inside `<plan>` tags:

<plan>{"issues": [42, 57]}</plan>

Always emit the `<plan>` tags. If nothing is ready, output `<plan>{"issues": []}</plan>`.
