# Agent instructions

## Verifying integration-test results

The `integration-test` job in `.github/workflows/pull_request.yml` tests action cooperation, **not `issue_comment`
event wiring**. It builds this checkout's notifier, then runs the pinned published creator bundle and the locally
built `dist/index.js` sequentially using `src/integration/run.ts`. The creator receives a standard
`GITHUB_EVENT_PATH` payload shaped like an `issue_comment` event; do not use its undeclared `testContextPath` input.

The harness first exercises both bundles with in-memory API fixtures, with and without an existing future reminder.
For eligible same-repository PRs it then creates a real command comment, invokes the creator, verifies creation,
invokes the notifier, and verifies delivery and cleanup. Every command uses a unique run/attempt/UUID marker.
No App/PAT credentials or event chaining are needed: comments posted with
[`GITHUB_TOKEN` do not start a new `issue_comment` workflow](https://docs.github.com/en/actions/concepts/security/github_token).

To check a result:

1. Find the workflow run for the exact PR revision. Use `gh run view <run-id> --repo agrc/reminder-action` to find
   the **Integration test** job ID, then
   `gh run view <run-id> --repo agrc/reminder-action --job <job-id> --log`.
2. Check **Verify deterministic action cooperation** separately from **Verify live creation, delivery, and cleanup**.
   Fork/Dependabot PRs skip live writes explicitly. A 403 when creating the command also reports a live skip;
   subsequent failures fail the test and attempt fixture-only cleanup. A green job with a live skip proves only
   deterministic cooperation, not real GitHub delivery.
3. For a live pass, require `LIVE integration passed` and the logged unique marker, command URL, acknowledgment URL,
   and delivery URL. The `/remind me to verify <marker> yesterday` comment is input, **not a delivered reminder**.
   The test asserts the `reminder` label, one exact new metadata entry (recipient, message, unique ID, past-due date),
   and a new creator acknowledgment before invoking the notifier.
4. Require the new delivery comment `:wave: @<who>, verify <marker>` on the same PR and the cleanup assertion:
   only that reminder's body metadata is removed, with the label removed only if no active reminders remain.
   Old comments, an existing label, `sending N past due notifications` (logged before API writes), or successful
   no-op logs such as `no open issues found with the reminder label`, `no reminders found`, and
   `no past due reminders found` are not sufficient evidence.

The notifier normally scans all open items labeled `reminder`. The harness uses a local API gateway to expose only
the target PR, forwards allowed mutations to the real GitHub API in live mode, and rejects other routes. It refuses
to start if the target already has unrelated past-due reminders, checks for concurrent body edits before writes,
and does not restore stale body snapshots during failure cleanup. Unrelated reminders, labels, and body content
must remain intact. This scoped test does not prove repository-wide discovery or pagination.

Creation in production is a separate flow: `.github/workflows/issue_comment.yml` invokes
`agrc/create-reminder-action@v1`. To claim event wiring works, separately require an **Issue Comment Events** run
correlated with an eligible comment (for example, one posted by a human), plus the resulting label, body metadata,
and acknowledgment. Raw `<!-- bot: {"reminders":...} -->` metadata is hidden in rendered Markdown; inspect the
API body or edit view. `.github/workflows/scheduled.yml` uses released `agrc/reminder-action@v1`, not the PR build,
so a scheduled delivery cannot substitute for evidence of the PR's live integration pass.

Report the run/revision, mode (deterministic/live/skipped), marker and comment links, and exact assertions observed.
State missing evidence explicitly. Do not post comments or edit reminder state merely to inspect existing results.

For local deterministic verification, build with `pnpm run build`, then run `pnpm run test:integration` with
`INTEGRATION_MODE=mock` and `CREATOR_ACTION_PATH` pointing to the pinned creator's published `dist/index.js`.
Use `pnpm test`, `pnpm run check`, and `pnpm run lint` for assertion and gateway regression checks.
