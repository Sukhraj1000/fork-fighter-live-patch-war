# Fork Fighter: Live Patch War

## Product

Fork Fighter is an endless 2D score-chaser. The runner moves automatically;
the player uses Space, W, Up, or a screen tap to jump. Time alive and collected
Fork Shards increase the score. One obstacle hit ends the run, shows the final
score and personal best, and offers an immediate restart.

While the player runs, three Game Masters independently author typed mutations:

- **Architect** prefers coherent systemic pressure.
- **Gremlin** attacks repetitive and overly safe play.
- **Auditor** applies measured, fair counter-pressure.

The three proposals are produced concurrently. The server validates every
candidate and allows at most one live patch at a time. Accepted mutations are
translated through the browser's obstacle-only adapter; agents never edit or
execute game code.

## Player loop

```text
Start run
  -> short control countdown
  -> auto-run and jump
  -> collect Fork Shards
  -> score rises with survival time + pickups
  -> Game Master obstacle patches enter the route
  -> one collision ends the run
  -> final score + personal best
  -> restart
```

The baseline course remains playable without a server or model provider. If the
API cannot be reached, the client switches to a deterministic local Game Master
cycle instead of blocking the game.

## Feedback loop

```text
Visible endless-run stats
  -> bounded runner telemetry endpoint
  -> compact server-owned director context
  -> Architect, Gremlin, and Auditor draft in parallel
  -> schema/capability/cleanup/invariant/difficulty/novelty simulation gates
  -> deterministic selection
  -> one typed patch enters the game
  -> patch outcome and player performance inform the next cycle
```

The browser reports only:

- elapsed survival time;
- Fork Shards collected;
- score;
- alive/dead state.

The server maps those values into the frozen `RunTelemetry` compatibility
contract. Survival progress, pickup rate, health, death, and challenge trend are
therefore available to the next Game Master request. The provider never receives
browser objects, controls, credentials, arbitrary conversation history, or
canonical server functions.

## Stable shell

The Phaser shell owns the fixed rules:

- automatic forward motion;
- buffered jump input;
- collision and one-hit death;
- baseline obstacle pacing;
- pickup collision;
- score calculation;
- countdown, game-over state, personal best, and restart.

A short grace period teaches the control before the first hazard. Collision
bounds and the pacing ramp are deliberately more forgiving at the beginning,
then tighten as survival time increases.

## Typed mutation boundary

A Game Master may return exactly one `MutationProposal`. It cannot send player
commands, source code, scripts, engine calls, or arbitrary JavaScript. The
proposal must match the requesting persona and request id and remain within the
capabilities advertised by the server.

The current live runtime advertises only capabilities it can execute safely.
Contract-valid effects outside that slice are rejected visibly rather than
silently ignored.

## Validation and turn-taking

A proposal must pass every gate:

1. Zod and structured-output schema.
2. Capability and numeric limits.
3. Complete cleanup semantics.
4. Stable-game invariants and route playability.
5. Current difficulty budget and no escalation for a struggling player.
6. Novelty against recent and active mechanics.
7. Deterministic micro-simulation.
8. Current playable-runtime support.

Drafting remains concurrent. Activation does not: the validator policy sets
`maxActiveMutations` to one, and the match host has a second activation guard.
A later candidate is rejected or deferred while a prior patch is active.

## Daytona runtime

A live match owns three private Daytona workers, one per persona. Workers are
created or claimed concurrently from a prepared snapshot and retained across
patch cycles. The snapshot contains the pinned Codex CLI, proposal command, JSON
schema runner, and worker self-test, so no package installation occurs in the
hot path.

Workers receive only three host-written files:

- `contract/mutation-proposal.schema.json`;
- `runtime/request.json`;
- `runtime/prompt.txt`.

The host reads only `runtime/proposal.json`. A one-use scoped gateway consumes
each grant even when output is malformed, late, replayed, or cross-persona.
Private workers are deleted at match end and also carry a TTL backstop.

## Codex authentication

Two server-only modes are supported:

- `api-key`: a Daytona organization secret is mounted as `CODEX_API_KEY` and
  resolved only for `api.openai.com`.
- `chatgpt`: for trusted private automation, a file-backed official Codex
  `auth.json` is validated and copied into each private worker's `CODEX_HOME`.
  The file is never included in labels, sandbox create parameters, logs,
  prompts, proposals, or browser responses.

The proposal command uses HTTPS-only providers, avoiding repeated WebSocket
fallback delays in Daytona's restricted network. ChatGPT workers allow only
`chatgpt.com` and explicitly wildcarded OpenAI authentication domains. API-key workers allow only
`api.openai.com`.

## Failure behavior

Gameplay never waits for the model. A provider timeout or unavailable worker is
recorded as a typed failure, shown in the activity feed, and skipped for that
cycle. The runner, score, input, and local obstacle course continue. A killed
worker is replaced from the prepared snapshot and receives current server-owned
context.

## Runtime labels

`GET /api/runtime` reports the active provider, whether workers are sandboxed,
the number of parallel Game Masters, and the one-patch activation limit. The UI
uses this response so mock mode never claims to be Daytona and a real run can
show `DAYTONA // 3 PARALLEL CODEX WORKERS` truthfully.

## Main HTTP surface

- `GET /health`
- `GET /api/runtime`
- `POST /api/live-matches`
- `GET /api/live-matches/:matchId`
- `POST /api/live-matches/:matchId/runner-telemetry`
- `POST /api/live-matches/:matchId/end`
- `GET /api/matches/:matchId/events`
- `GET /api/matches/:matchId/log`

The lower-level deterministic game-core command, telemetry, and event-batch
routes remain available for integration tests and validator micro-simulation.

## Technology

- TypeScript, React, Vite, and Phaser 3
- Fastify and server-sent events
- Zod contracts
- Vitest/Node tests and Playwright browser tests
- JSONL match logs
- Daytona TypeScript SDK
- Codex CLI structured output

## Repository layout

```text
apps/web                  Phaser runner, React HUD, controls, local fallback
apps/server               Match host, telemetry adapter, SSE, provider wiring
packages/contracts        Frozen Zod and TypeScript contracts
packages/director-context Compact retained performance context
packages/game-core        Deterministic validation game simulation
packages/mutation-runtime Safe mutation application and cleanup
packages/mutation-validator Validation and deterministic selection
packages/gm-orchestrator  Daytona workers, Codex schema, scoped gateway
tests/e2e                 Playwright product-path coverage
```

## Verification contract

`pnpm verify` must prove:

- all package typechecks pass;
- unit and integration suites pass;
- production builds complete;
- the endless runner scores, dies in one hit, persists personal best, and
  restarts;
- proposal work does not block live game ticks;
- phone-sized screens have no horizontal overflow and taps reach the canvas
  through HUD overlays;
- the local fallback stays playable with the API route unavailable;
- runner telemetry reaches Game Master context;
- only one mutation can remain active.

The separate Daytona smoke command must create a real private sandbox from the
prepared snapshot, execute the installed health command, and delete the sandbox.
A finished live-provider verification additionally requires at least one real
Codex proposal to be received, validated, selected or rejected for a recorded
reason, and reflected in the match log.

## Non-goals

- arbitrary live source edits;
- browser-side provider credentials;
- arbitrary JavaScript from agents;
- multiplayer, accounts, or a database;
- LLM authority over score, collision, death, or restart;
- more than one live mutation at a time.
