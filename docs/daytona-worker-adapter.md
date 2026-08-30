# Daytona persistent worker adapter

The playable server selects a provider before it creates a match. Both provider
modes are adapted to the shared `AgentBrain` boundary from
`@fork-fighter/gm-orchestrator`; validation, selection, game-core, telemetry,
and mutation-runtime do not know which provider was selected.

## Required worker contract

Daytona mode requires:

- `DAYTONA_WORKER_SNAPSHOT`: a prepared snapshot containing the proposal runner
  and all worker-side tests. Package installation must already be complete.
- `DAYTONA_PROPOSAL_COMMAND`: the command invoked inside the persistent worker
  for each patch cycle.
- `DAYTONA_API_KEY` and any standard Daytona SDK configuration, available only
  to the server process.

The adapter creates one sandbox for Architect, Gremlin, and Auditor. On every
cycle the configured command receives:

- `FORK_FIGHTER_PERSONA`: the worker's fixed persona.
- `FORK_FIGHTER_REQUEST_JSON`: one compact `GameMasterRequest` containing
  canonical server context, the frozen capability reference, a deadline, and
  that persona's replayable proposal history.

The command must print exactly one `MutationProposal` JSON object as its final
JSON line and exit successfully. Any prose, command-shaped data, mismatched
request/persona, unsupported capability, nonzero exit, invalid JSON, or missed
deadline is non-actionable.

## Recovery and cleanup

A failed sandbox is discarded. The next cycle creates a replacement from the
same snapshot and sends the latest server-owned request, so canonical match
memory never lives only in Daytona. Server shutdown deletes all retained
sandboxes. Provider errors are redacted before logs or SSE and do not stop the
authoritative game ticker.
