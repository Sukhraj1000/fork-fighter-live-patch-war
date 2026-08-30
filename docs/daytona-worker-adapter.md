# Daytona persistent worker adapter

The playable server selects a provider before it creates a match. Both provider
modes are adapted to the shared `AgentBrain` boundary from
`@fork-fighter/gm-orchestrator`; validation, selection, game-core, telemetry,
and mutation-runtime do not know which provider was selected.

## Required worker contract

Daytona mode requires:

- `DAYTONA_WORKER_SNAPSHOT`: the prepared issue #9 snapshot containing the
  pinned Codex CLI, proposal runner, and worker-side tests.
- `DAYTONA_CODEX_SECRET_NAME`: the name of a Daytona organization secret that
  is mounted only inside workers as `CODEX_API_KEY`.
- `DAYTONA_API_KEY` and any standard Daytona SDK configuration, available only
  to the server process.

The server creates a `DaytonaGameMasterPool` for each match. Its Architect,
Gremlin, and Auditor sandboxes are private and persistent across patch cycles.
They are labeled by match and persona so an existing worker can be reclaimed
after a server restart.

For each cycle, the pool writes only these scoped inputs:

- the frozen proposal JSON schema;
- one compact `GameMasterRequest` containing canonical server context, the
  capability reference, deadline, and replayable persona history;
- a prompt derived from that request.

The installed worker command tests its output and writes one proposal JSON
file. The host gateway reads only that file and accepts it only when its
request, persona, capability use, schema, single-submit grant, and deadline all
match. Arbitrary commands, paths, prose, or extra provider output never reach
the game.

## Recovery and cleanup

A failed worker is discarded and replaced once within the same deadline. The
replacement receives the latest server-owned request, so canonical match memory
never lives only in Daytona. Server shutdown deletes all retained workers.
Provider errors are redacted before logs or SSE and do not stop the
authoritative game ticker.

The deterministic mock brains remain the default and do not instantiate the
Daytona SDK, read Daytona environment variables, or require network access.
