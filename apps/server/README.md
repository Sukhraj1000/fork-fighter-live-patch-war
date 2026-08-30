# Fork Fighter match server

The server is the match-scoped authority for telemetry, event-batch ordering,
patch cadence, agent status, browser events, and the append-only activity log.
It runs with deterministic mock game masters by default. Director, game-master,
validator, selector, clock, and log implementations are dependency-injected so
the corresponding packages can replace the defaults as they land.

## Run

```bash
pnpm --filter @fork-fighter/server dev
```

Environment variables:

- `PORT` (default `3001`)
- `HOST` (default `0.0.0.0`)
- `MATCH_LOG_DIR` (default `data/matches`)
- `CLIENT_DIST_PATH` (optional built Vite client directory)

## HTTP surface

- `POST /api/matches` creates a match and starts proposal work for the first
  20-second patch boundary.
- `GET /api/matches/:matchId` returns the current public snapshot.
- `POST /api/matches/:matchId/telemetry` ingests compact `RunTelemetry`.
- `POST /api/matches/:matchId/event-batches` ingests ordered,
  retry-idempotent `GameEventBatch` payloads.
- `GET /api/matches/:matchId/events` streams native SSE. Reconnect with
  `Last-Event-ID` to replay missed events without mutating match state.
- `GET /api/matches/:matchId/log` reads the replayable, redacted activity log.
- `POST /api/matches/:matchId/end` ends the match and cancels active patches.

JSONL entries cover each proposal, rejection, selection, activation, expiry,
and patch outcome. Credential-shaped keys and values are redacted before an
entry reaches either disk or a browser connection.
