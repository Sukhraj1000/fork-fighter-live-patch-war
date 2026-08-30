# Fork Fighter match server

Fastify owns the live match, fixed-rate game-core ticker, compact event batches,
director telemetry, proposal deadlines, validation/selection, mutation-runtime
lifecycle, SSE status stream, and redacted append-only log.

The default dependency graph adapts the shared deterministic mock
`AgentBrain`s. It requires no Daytona credentials. Set
`GAME_MASTER_PROVIDER=daytona` plus the documented worker snapshot/command to
switch only the provider adapter.

## HTTP surface

- `POST /api/live-matches` starts a complete playable match.
- `GET /api/live-matches/:matchId` returns game, runtime, and patch state.
- `POST /api/live-matches/:matchId/commands` queues one typed game-core command.
- `POST /api/live-matches/:matchId/end` ends the playable match.
- `GET /api/matches/:matchId/events` streams agent and patch events with SSE
  replay via `Last-Event-ID`.
- The lower-level `/api/matches` telemetry/event-batch surface remains available
  to independent clients and tests.

The built Vite client is served when `CLIENT_DIST_PATH` is set. From the root,
`pnpm play` builds and starts that combined app.

Environment variables:

- `PORT` (default `3001`)
- `HOST` (default `0.0.0.0`)
- `MATCH_LOG_DIR` (default `data/matches`)
- `CLIENT_DIST_PATH` (optional built Vite client directory)
- `MATCH_PATCH_CADENCE_MS` (default `6000`)
- `MATCH_PROPOSAL_DEADLINE_MS` (default `5000`)
- `GAME_MASTER_PROVIDER` (`mock` by default, or `daytona`)
- `MOCK_AGENT_DELAY_MS` and `MOCK_MUTATION_DURATION_MS` (explicit fixture/E2E
  timing controls)

Run server tests with `pnpm --filter @fork-fighter/server test`.
