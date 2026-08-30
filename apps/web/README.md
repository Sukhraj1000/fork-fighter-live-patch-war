# Fork Fighter live web client

The React UI starts a real server-authoritative match. Phaser renders current
game-core snapshots and emits typed movement/dash commands; it does not decide
collisions, scoring, extraction, mutation selection, or cleanup.

The client polls compact playable snapshots for smooth presentation and uses
the match SSE stream for agent drafting, rejection, selection, activation,
effect, expiry, failure, and reconnect status. The activity rail makes the
validated patch lifecycle visible without pausing player input.

For hot client development, start the server and Vite proxy separately:

```bash
pnpm --filter @fork-fighter/server dev
pnpm --filter @fork-fighter/web dev
```

For the combined built app, use `pnpm play` at the repository root. Browser
smoke coverage lives in `tests/e2e/live-patch-loop.spec.ts` and runs through
`pnpm test:e2e` or the complete `pnpm verify` command.
