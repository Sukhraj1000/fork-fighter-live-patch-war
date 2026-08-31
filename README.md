# Fork Fighter: Live Patch War

Fork Fighter is an endless 2D score-chaser that keeps playing while three game
masters draft typed game demands in parallel. They can flip or remove gravity,
spin or resize the runner, change world speed and style, and throw telegraphed
boulders, walls, spikes, anvils, rubber ducks, or fork storms. The validator is
the referee: it rejects unfair demands and permits exactly one live patch.

The default path is completely local: it uses deterministic mock game masters
and does not require Daytona, provider credentials, or network success.

For a split production deployment, set `VITE_API_BASE_URL` while building the
web app to the public Fastify server URL, and set `CLIENT_ORIGIN` on that server
to the web app origin. If the deployed API is unavailable, the public client
uses its typed local demo fallback instead of blocking the game.

## Play locally

Prerequisites: Node.js 20.6 or newer and pnpm 10.

```bash
pnpm install
pnpm play
```

Open <http://127.0.0.1:3001>. The runner moves automatically; use Space, W, or
the Up arrow to jump. Score increases for every moment alive and every Fork
Shard collected.

For a presentation, use the fixed five-second seeded path and open its labelled
URL:

```bash
pnpm demo:seeded
open 'http://127.0.0.1:3001/?demo=seeded'
```

The seeded path always shows concurrent drafting, a visible referee rejection,
one selected patch, an incoming countdown, activation and deterministic cleanup.
See [the operator runbook](./docs/demo-runbook.md) and
[two-minute script](./docs/demo-script.md). A separate `pnpm demo:live` command
runs the truthful Daytona path documented there.

`pnpm play` builds the Phaser/React client and serves it from Fastify. The
browser sends bounded endless-run stats (survival time, score, shards, and
death state) to the server, which folds them into compact Game Master context.
Agent and patch lifecycle events stream back to the UI over SSE.

## Verify everything

Install the Playwright browser once on a new machine:

```bash
pnpm exec playwright install chromium
```

Then run unit, integration, build, and browser smoke coverage with one command:

```bash
pnpm verify
```

The browser smoke covers start → live scoring → parallel proposals → referee
selection → real physics/hazard change → deterministic cleanup → one-hit death
→ restart. A server integration test also proves that the live match continues
while provider work runs in parallel.

## Provider boundary

Both the local and Daytona modes use the same `AgentBrain` interface. Mock mode
is the default:

```bash
GAME_MASTER_PROVIDER=mock pnpm play
```

For Daytona mode, create a Daytona API key and prepare the reusable worker
snapshot. Codex can authenticate with either a Daytona organization API-key
secret or a file-backed ChatGPT login on trusted private workers:

```bash
cp .env.example .env
# Add DAYTONA_API_KEY, then choose one Codex auth mode in .env:
# 1. DAYTONA_CODEX_SECRET_NAME for usage-based API access, or
# 2. DAYTONA_CODEX_AUTH_MODE=chatgpt plus DAYTONA_CODEX_AUTH_FILE
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

Credentials remain server-side. ChatGPT mode copies the official file-backed
Codex auth cache only into private, TTL-bound workers and never exposes it to
the proposal gateway, logs, or browser. A worker failure becomes a typed
unavailable or timeout result; it never blocks play or bypasses validation. See
[the live adapter](./docs/daytona-worker-adapter.md) and
[agent tool contract](./docs/agent-tool-contract.md).

## Safety boundary

- The stable Phaser shell owns the fixed interpreter for jump, collision,
  pickups, scoring, death, restart, runner-physics profiles, and hazard art.
- The server owns Game Master orchestration, validation, retained context, and
  the streamed patch lifecycle.
- Game masters can return only one typed `MutationProposal`.
- The client translates an accepted mutation through `configureRunner` and
  `spawnRunnerHazard`; agents choose bounded data but never write or execute
  game code.
- Every live proposal passes schema, capability, cleanup, invariant,
  difficulty, novelty, simulation, and playable-runtime checks.
- Mutation runtime applies and cleans up only capabilities it explicitly
  supports; contract-valid but unavailable effects are visibly rejected.
- The mock path and game loop do not import or depend on Daytona.
- Patch difficulty is reserved only while a mutation is live and returned on
  expiry, so long sessions do not exhaust a lifetime budget.
- Inactive matches expire after 60 seconds, all matches have a ten-minute hard
  lifetime, and match logs rotate at 8 MiB with three retained files. Match end
  closes all three match-scoped Daytona workers.

Read [PROJECT_SPEC.md](./PROJECT_SPEC.md) for the full architecture and product
intent.
