# Fork Fighter: Live Patch War

Fork Fighter is a deterministic 2D action game that keeps playing while three
game masters draft typed live mutations. The server accepts only structured
proposals, validates them against the current game state, selects a safe
candidate, and applies it through the mutation runtime at a patch boundary.

The default path is completely local: it uses deterministic mock game masters
and does not require Daytona, provider credentials, or network success.

## Play locally

Prerequisites: Node.js 20.6 or newer and pnpm 10.

```bash
pnpm install
pnpm play
```

Open <http://127.0.0.1:3001>. Use A/D or the arrow keys to move, W/S for the
vertical axis, and Space to dash. Collect three Fork Cores, bank them at the
relay, then reach extraction.

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

The browser smoke covers start → play → concurrent drafting → visible
rejection → selection → activation → triggered mutation → expiry/cleanup →
extraction. A server integration test also proves that game ticks continue
while a provider request times out.

## Provider boundary

Both the local and Daytona modes use the same `AgentBrain` interface. Mock mode
is the default:

```bash
GAME_MASTER_PROVIDER=mock pnpm play
```

The optional Daytona adapter claims one persistent worker per persona from the
prepared worker snapshot owned by issue #9. It sends compact context through
an environment variable and expects exactly one proposal JSON object on
stdout:

```bash
GAME_MASTER_PROVIDER=daytona \
DAYTONA_WORKER_SNAPSHOT=fork-fighter-gm-worker \
DAYTONA_PROPOSAL_COMMAND='pnpm --silent propose' \
pnpm play
```

Credentials remain server-side. A worker failure becomes a typed unavailable
or timeout result; it never blocks the ticker or bypasses validation. See
[the worker adapter contract](./docs/daytona-worker-adapter.md).

## Safety boundary

- Phaser emits player commands but owns no game rules.
- game-core is the deterministic authority for movement, collisions, scoring,
  banking, death, and extraction.
- Game masters can return only one typed `MutationProposal`.
- Every live proposal passes schema, capability, cleanup, invariant,
  difficulty, novelty, simulation, and playable-runtime checks.
- Mutation runtime applies and cleans up only capabilities it explicitly
  supports; contract-valid but unavailable effects are visibly rejected.
- The mock path and game loop do not import or depend on Daytona.

Read [PROJECT_SPEC.md](./PROJECT_SPEC.md) for the full architecture and product
intent.
