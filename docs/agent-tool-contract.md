# Game-master worker tool contract

Architect, Gremlin, and Auditor run as three persistent Daytona sandboxes for
the lifetime of a match. Each sandbox is bound to one persona and implements the
existing server-side `AgentBrain` interface. A worker is a proposal author, not
a game client, validator, or authority over match state.

## Worker lifecycle

At match start, `DaytonaGameMasterPool.start()` claims a sandbox carrying the
match/persona labels or creates one from `DAYTONA_WORKER_SNAPSHOT`. All three
claims/creates run concurrently. The prepared snapshot already contains the
pinned Codex CLI, proposal runner, and test command, so a patch cycle never runs
`npm install`, `pnpm install`, or another package installer.

The same sandbox is retained for every proposal cycle in that match. Match end
calls `DaytonaGameMasterPool.close()` and deletes the three sandboxes. Daytona's
TTL is also set as a cleanup backstop.

If a proposal command or file transfer fails, the adapter discards that
sandbox, creates a replacement from the same snapshot, uploads the current
contract, and replays the exact server-owned request. The sandbox has no
irreplaceable conversation or canonical match state.

## Input capability

The host may write only these files:

| Path | Contents |
|---|---|
| `contract/mutation-proposal.schema.json` | JSON Schema generated from the frozen Zod contract |
| `runtime/request.json` | One parsed `GameMasterRequest` for the sandbox's persona |
| `runtime/prompt.txt` | Persona instructions plus the same compact request |

`GameMasterRequest` contains compact telemetry, remaining difficulty budget,
mutation capabilities, rejected/recent concept ids, and at most eight history
entries for that same persona. It does not contain player controls, engine
objects, server functions, credentials, or unrestricted conversation history.

The current playable capability slice is data-only:

- `configureRunner` selects bounded gravity, jump, speed, scale, rotation, and
  world-style values;
- `spawnRunnerHazard` selects a bounded object, lane, count, spacing, speed, and
  mandatory telegraph window;
- triggers are limited to activation or bounded intervals;
- every temporary rule or object group requires matching expiry cleanup.

The Game Masters can therefore demand dramatic combinations such as inverted
gravity plus a ceiling fork storm or zero gravity plus falling anvils, but they
cannot add code, invent engine calls, bypass collision, or activate a second
patch. The authoritative validator remains the referee.

The SDK adapter permits exactly two installed commands:

- `./bin/test-worker` verifies the prepared image and installed schema.
- `./bin/propose` runs Codex with the output schema and then runs the worker-side
  request/persona/forbidden-capability test. It follows the
  [official non-interactive Codex pattern](https://learn.chatgpt.com/docs/non-interactive-mode)
  for schema output and final-message capture.

Arbitrary commands, arbitrary reads, and writes outside the three input files
are rejected by the host adapter.

## Output gateway

Codex must emit exactly one JSON `MutationProposal`. Its `requestId`, proposal
author, and mutation author must match the current request and persona. Source
edits, scripts, code, and player commands are forbidden.

The host may read only `runtime/proposal.json`. A server-owned
`ScopedProposalGateway` grants one submission for one request/persona pair and
consumes the grant even when the output is malformed. Replays, cross-persona
submissions, late submissions, and second submissions return no proposal.

JSON Schema constrains generation, the worker test checks the narrow envelope,
and the authoritative server parses the result with the frozen Zod schema and
capability limits again. Normal mutation validation and selection still happen
outside the worker.

## Deadlines and observations

The proposal deadline is enforced at three layers:

1. `runAgentBrain` races the provider against the game-facing deadline.
2. The Daytona command receives only the remaining deadline as its execution
   timeout.
3. The one-use gateway rejects delivery after the original absolute deadline.

A timeout or provider failure becomes a typed failed `ProposalResult`; it never
blocks the other personas or the patch boundary. `ProposalResult.latencyMs`
records game-facing proposal latency. The optional pool observer records worker
startup/recovery and end-to-end Codex-plus-worker-test latency without proposal
contents or credentials. The authoritative validator records its own activity
after delivery.

## Credential and network boundary

`DAYTONA_API_KEY` is read only by the server-side Daytona SDK. It is never put in
a request, prompt, proposal, event, log payload, or browser bundle.

API-key mode mounts `CODEX_API_KEY` only by reference to the Daytona
organization secret named by `DAYTONA_CODEX_SECRET_NAME`. The secret value is
not accepted by the pool configuration. Configure that secret for
`api.openai.com`; the worker itself also permits only that domain.

Trusted ChatGPT mode follows OpenAI's documented headless fallback: set
`DAYTONA_CODEX_AUTH_MODE=chatgpt` and point `DAYTONA_CODEX_AUTH_FILE` at a
file-backed Codex `auth.json`. The server validates `auth_mode=chatgpt` and a
refresh token, then uploads the file directly to each private worker's
`CODEX_HOME`. It is never included in labels, create parameters, logs, prompts,
or the proposal gateway. Those workers allow only `chatgpt.com` and OpenAI
auth domains, are deleted at match end, and retain a TTL cleanup backstop.
Treat the source file like a password and use this mode only for trusted private
automation.

The runner sets `shell_environment_policy.inherit=none`, so model-launched
commands cannot read API-key environment credentials. Do not use `VITE_*`
variables for Daytona, Codex, or provider credentials, and never serialize
`process.env` into match state or browser-visible diagnostics.

## Preparing the reusable snapshot

Create the Daytona organization secret first, then build the snapshot once:

```bash
export DAYTONA_API_KEY=...
export DAYTONA_WORKER_SNAPSHOT=fork-fighter-game-master-codex-v9
pnpm --filter @fork-fighter/gm-orchestrator prepare:snapshot
```

The image definition is in `packages/gm-orchestrator/worker/Dockerfile`. It pins
the Codex CLI version and runs `./bin/test-worker --image-build` during image
creation. Rebuild under a new snapshot name when the frozen contract, worker
runner, or Codex version changes.

After setting `DAYTONA_CODEX_SECRET_NAME`, `pnpm dev` runs a server-only smoke
test against the prepared environment and deletes that temporary sandbox.
