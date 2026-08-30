# Fork Fighter live web client

The React UI starts a real server-hosted Game Master match. Phaser owns the
small, stable endless-run shell: auto-run, jump, shard collection, scoring,
one-hit death, and restart. It accepts only obstacle patches translated through
the typed client contract; it never executes agent-authored code.

The client polls compact match snapshots and uses the SSE stream for agent
drafting, rejection, selection, activation, expiry, failure, and reconnect
status. The activity rail makes the validated patch lifecycle visible without
pausing play.

For hot client development, start the server and Vite proxy separately:

```bash
pnpm --filter @fork-fighter/server dev
pnpm --filter @fork-fighter/web dev
```

For the combined built app, use `pnpm play` at the repository root. Browser
smoke coverage lives in `tests/e2e/live-patch-loop.spec.ts` and runs through
`pnpm test:e2e` or the complete `pnpm verify` command.
