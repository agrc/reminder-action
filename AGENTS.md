# Agent instructions

## Verifying integration-test results

The `integration-test` job in `.github/workflows/pull_request.yml` tests action cooperation, **not `issue_comment`
event wiring**. It builds this checkout's notifier, then runs the pinned published creator bundle and the locally
built `dist/index.js` sequentially using `src/integration/run.ts`. The creator receives a standard
`GITHUB_EVENT_PATH` payload shaped like an `issue_comment` event; do not use its undeclared `testContextPath` input.

The pull-request workflow runs both bundles only against in-memory API fixtures, with and without an existing future
reminder. It does not create comments, perform live delivery, or verify `issue_comment` event wiring. The live harness
mode must not run in PR CI with a write-capable token because the workflow executes PR-controlled code.

To check a result:

1. Find the workflow run for the exact PR revision. Use `gh run view <run-id> --repo agrc/reminder-action` to find
   the **Integration test** job ID, then
   `gh run view <run-id> --repo agrc/reminder-action --job <job-id> --log`.
2. Require **Verify deterministic action cooperation** to pass. This proves only action cooperation with in-memory API
   fixtures—not live creation, delivery, cleanup, or event wiring.

The notifier normally scans all open items labeled `reminder`. The harness uses a local API gateway to expose only
the target item and rejects other routes. It refuses to start if the target already has unrelated past-due reminders
and checks for concurrent body edits before gateway writes. On a failed live run, cleanup is attempted only if the
item still matches the exact post-creation body and label snapshot; otherwise it is skipped to avoid overwriting
concurrent changes. Inspect the unique marker and clean up manually if needed. This scoped test does not prove
repository-wide discovery or pagination.

Creation in production is a separate flow: `.github/workflows/issue_comment.yml` invokes
`agrc/create-reminder-action@v1`. To claim event wiring works, separately require an **Issue Comment Events** run
correlated with an eligible comment (for example, one posted by a human), plus the resulting label, body metadata,
and acknowledgment. Raw `<!-- bot: {"reminders":...} -->` metadata is hidden in rendered Markdown; inspect the
API body or edit view. `.github/workflows/scheduled.yml` uses released `agrc/reminder-action@v1`, not the PR build,
so a scheduled delivery cannot substitute for evidence of the PR's live integration pass.

Report the run/revision, mode (deterministic/live/skipped), marker and comment links, and exact assertions observed.
State missing evidence explicitly. Do not post comments or edit reminder state merely to inspect existing results.

For deterministic verification, build with `pnpm run build`, then run `pnpm run test:integration` with
`INTEGRATION_MODE=mock` and `CREATOR_ACTION_PATH` pointing to the pinned creator's published `dist/index.js`.
Use `pnpm test`, `pnpm run check`, and `pnpm run lint` for assertion and gateway regression checks.
