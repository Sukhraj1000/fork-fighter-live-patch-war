# Fork Fighter: Live Patch War

Fork Fighter is an endless 2D score-chaser that keeps playing while three game
masters draft typed obstacle patches. Survive, collect Fork Shards, and jump
the traps the Game Masters deploy in real time. One hit ends the run.

The default path is completely local: it uses deterministic mock game masters
and does not require Daytona, provider credentials, or network success.

## Play locally

Prerequisites: Node.js 20.6 or newer and pnpm 10.

```bash
pnpm install
pnpm play
```

Open <http://127.0.0.1:3001>. The runner moves automatically; use Space, W, or
the Up arrow to jump. Score increases for every moment alive and every Fork
Shard collected.

`pnpm play` builds the Phaser/React client and serves it from Fastify. The
server-authoritative ticker advances game-core continuously, batches compact
events into telemetry, and streams agent and patch lifecycle events to the UI
over SSE.

## Verify everything

Install the Playwright browser once on a new machine:

```bash
pnpm exec playwright install chromium
```

Then run unit, integration, build, and browser smoke coverage with one command:

```bash
pnpm verify
```

The browser smoke covers start → live scoring → one-hit death → final score →
restart. A server integration test also proves that the live match continues
while provider work runs in parallel.

## Provider boundary

Both the local and Daytona modes use the same `AgentBrain` interface. Mock mode
is the default:

```bash
GAME_MASTER_PROVIDER=mock pnpm play
```

For Daytona mode, create a Daytona API key and an organization secret mounted
as `CODEX_API_KEY`, then prepare and test the reusable worker snapshot:

```bash
cp .env.example .env
# Add DAYTONA_API_KEY and the provider secret name to .env
pnpm --filter @fork-fighter/gm-orchestrator prepare:snapshot
pnpm daytona:smoke
GAME_MASTER_PROVIDER=daytona pnpm play
```

The server uses the issue #9 `DaytonaGameMasterPool` implementation to retain
one private worker per persona and match. Each cycle writes only the compact
canonical request and prompt through a scoped gateway, then accepts at most one
typed proposal file before the deadline. Snapshot preparation installs the
pinned Codex CLI, proposal runner, and worker tests once; matches never install
packages in the hot path.

Credentials remain server-side. A worker failure becomes a typed unavailable
or timeout result; it never blocks the ticker or bypasses validation. See
[the live adapter](./docs/daytona-worker-adapter.md) and
[agent tool contract](./docs/agent-tool-contract.md).

## Safety boundary

- The stable Phaser shell owns only the fixed endless-run rules: jump,
  collision, pickups, scoring, death, and restart.
- The server owns Game Master orchestration, validation, retained context, and
  the streamed patch lifecycle.
- Game masters can return only one typed `MutationProposal`.
- The client translates an accepted mutation through an obstacle-only
  `ObstaclePatch` contract; agents never write or execute game code.
- Every live proposal passes schema, capability, cleanup, invariant,
  difficulty, novelty, simulation, and playable-runtime checks.
- Mutation runtime applies and cleans up only capabilities it explicitly
  supports; contract-valid but unavailable effects are visibly rejected.
- The mock path and game loop do not import or depend on Daytona.

Read [PROJECT_SPEC.md](./PROJECT_SPEC.md) for the full architecture and product
intent.
