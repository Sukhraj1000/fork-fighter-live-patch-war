# Fork Fighter: Live Patch War

## Project summary

**Fork Fighter** is a fast, replayable 2D action game where three long-running
AI game masters continuously design and test new rule mutations while the
player is still playing.

The game itself remains stable and deterministic. Agents cannot rewrite the
engine or execute arbitrary code in the browser. Instead, they author typed,
validated mutation configurations that the authoritative server may apply at
safe patch boundaries.

> **Pitch:** You are not fighting only the level. You are fighting three AI
> game masters that study how you play and live-patch the game against you.

## Goal

Build a polished 60–90 second game loop in which:

1. The player moves, dashes, collects Fork Cores, banks them at relays, and
   attempts to reach extraction.
2. The server measures how the player is performing.
3. Every 20 seconds, three persistent game-master agents propose the next
   mutation in parallel.
4. Every proposal passes through strict schema, capability, difficulty, and
   playability validation.
5. One valid proposal is selected and applied live without pausing the game.
6. The outcome becomes retained context for the next patch cycle.

## Product principles

### Typed configs, not arbitrary code

The Mutation SDK is a typed configuration contract. Agents compose approved
triggers, effects, objectives, limits, and cleanup rules. They do not receive a
free-form code-writing interface and do not select from a static list of
difficulty sliders.

### Stable game shell

Player movement, physics, collision, scoring, map validity, extraction, and HUD
remain deterministic and server-authoritative. Agents enrich the game but
cannot become a single point of failure.

### Server-owned memory

The server owns the canonical performance log and compact director context.
Daytona sandboxes remain alive for the match, but no sandbox owns irreplaceable
state. An agent can be restarted and given the current context again.

### Gradual, recoverable difficulty

Mutations must challenge the player's observed strategy without instantly
making the run impossible. Every mutation expires or provides explicit cleanup
behaviour.

## Roles of Codex and Daytona

### Codex

Codex authors one structured `MutationDefinition` per game master and patch
cycle. It receives compact telemetry, prior outcomes, the current budget, and
the Mutation SDK capability reference. Its output is schema-constrained and is
never trusted until validated.

Codex is also used throughout development to implement, test, debug, and
document the project.

### Daytona

Daytona provides three long-running, isolated agent environments for each
match. Each environment is prepared with the proposal runner, schema,
validation tests, and exactly one persona:

- **Architect:** proposes coherent systemic changes and secondary objectives.
- **Gremlin:** attacks repetitive or overly safe player strategies.
- **Auditor:** proposes fair counter-pressure and looks for broken or
  overpowered designs.

The environments draft and test proposals in parallel while the current game
continues. They receive only narrow, match-scoped proposal capabilities.

## High-level architecture

```text
Stable game shell
  ├─ player, physics, map, HUD, scoring, extraction
  ├─ deterministic game-core
  └─ mutation runtime
       └─ applies validated typed configs

Authoritative server
  ├─ match state and event log
  ├─ player performance telemetry
  ├─ active, expired, and rejected mutations
  ├─ outcomes of prior patches
  ├─ current difficulty budget
  └─ proposal validator and selector

Long-running Daytona game masters
  ├─ Architect
  ├─ Gremlin
  └─ Auditor
       └─ each authors and tests one proposal in parallel
```

```text
Player events
    ↓
RunTelemetry + MatchDirectorContext
    ↓
Three parallel Daytona/Codex proposals
    ↓
Schema → capability → invariant → micro-simulation validation
    ↓
Deterministic selection
    ↓
Patch announcement → live activation → expiry/cleanup
    ↓
PatchOutcome retained for the next cycle
```

## Core contracts

Shared runtime contracts must be defined with Zod first, with TypeScript types
inferred from those schemas. These contracts freeze before parallel
implementation begins.

### Mutation definition

```ts
export type MutationDefinition = {
  id: string
  title: string
  patchNote: string
  author: 'architect' | 'gremlin' | 'auditor'
  durationMs: number
  difficultyCost: number
  triggers: MutationTrigger[]
  objective?: SecondaryObjective
  cleanup: CleanupRule[]
}
```

Examples of authored compositions:

- Collect a core → spawn a slow collector → despawn it when a core is banked.
- Every eight seconds → move a hazard toward the most-used route → spawn a
  risky bonus core elsewhere.
- Activate a contract → require one additional banked core for extraction →
  grant a time bonus when completed.

### Run telemetry

```ts
export type RunTelemetry = {
  matchId: string
  patchIndex: number
  elapsedMs: number
  health: number
  coresHeld: number
  coresBanked: number
  primaryObjectiveProgress: number
  recentDamage: number
  recentDeaths: number
  routeRepetition: number
  lowRiskCoreRate: number
  highRiskCoreRate: number
  activeMutationIds: string[]
  recentPatchOutcomes: PatchOutcome[]
  challengeTrend: 'too_easy' | 'on_target' | 'too_hard'
}
```

### Agent proposal boundary

No game master can issue player commands, change canonical game state, or call
engine functions. Its only supported output is a `MutationProposal` containing
one `MutationDefinition` and proposal metadata.

## Retained agent context

Every patch cycle, each game master receives:

- Current health, progress, held cores, and banked cores.
- Recent damage, deaths, and objective progress.
- Route repetition and preference for safe or risky rewards.
- Active mutations and concepts already rejected.
- Outcomes of previous patches.
- Current difficulty trend: `too_easy`, `on_target`, or `too_hard`.
- Remaining difficulty budget.
- Its own recent proposal history.
- The current Mutation SDK schema and capability reference.

This compact snapshot replaces an uncontrolled conversation history. The
server can replay it into a restarted agent without losing the run.

## Validation and selection

A proposal must pass every gate before it can enter the live game:

1. **Schema:** all required fields and known trigger/effect variants are valid.
2. **Capabilities:** spawn counts, modifier ranges, duration, and active
   mutation limits remain within policy.
3. **Cleanup:** every temporary entity or rule has explicit removal semantics.
4. **Invariants:** extraction remains reachable, the primary objective remains
   intact, and no immediate unfair collision is introduced.
5. **Difficulty:** cost fits the current budget and a struggling player does
   not receive an escalation.
6. **Novelty:** the proposal does not repeat an active or recently ineffective
   mechanic.
7. **Micro-simulation:** deterministic test runs prove the config applies and
   expires without corrupting state.

The selector ranks only valid proposals using challenge fit, novelty, and
expected play value. If no fresh proposal is ready by the deadline, the game
uses a previously validated unused candidate or keeps the current rules for one
cycle.

## Repository structure

```text
fork-fighter/
  apps/
    web/                         # Phaser/React rendering and HUD
    server/                      # Fastify API and authoritative match host
  packages/
    contracts/                   # Shared Zod schemas and public interfaces
    game-core/                   # Deterministic world, collision, scoring
    mutation-runtime/            # Applies valid configs to GameState
    mutation-validator/          # Safety, invariants, and selection
    director-context/            # Telemetry, compact memory, cadence
    gm-orchestrator/             # Daytona lifecycle and Codex proposals
  fixtures/
    mutations/                   # Valid and invalid mutation fixtures
    runs/                        # Deterministic telemetry/replay fixtures
    demo/                        # Reliable seeded demo match
  tests/
    e2e/                         # Browser and patch-cycle tests
  docs/
    mutation-sdk.md
    agent-tool-contract.md
    demo-script.md
```

## Technology

- Vite, React, and TypeScript
- Phaser 3 for rendering and input
- Node.js and Fastify for the game/director server
- Zod for runtime schemas
- Vitest for unit and integration tests
- Daytona TypeScript SDK for persistent isolated agents
- Codex structured output for typed mutation authoring

## Conflict-safe implementation lanes

| Lane | Owns |
|---|---|
| Contracts | `packages/contracts/` until interface freeze |
| Game | `packages/game-core/` |
| Visual | `apps/web/` |
| Mutation | `packages/mutation-runtime/`, `packages/mutation-validator/` |
| Director | `packages/director-context/` |
| Daytona/Codex | `packages/gm-orchestrator/` |
| Integration | `apps/server/`, fixtures, and end-to-end tests |

After the interface freeze, no lane changes `packages/contracts/` without the
integration owner's approval. Lanes integrate only through public contracts;
they do not edit one another's implementation files.

## Build order

### 0. Freeze the contracts

Define and test `GameState`, player commands, game events, mutation schemas,
telemetry, director context, proposals, and validation results.

**Proof:** valid fixtures pass and unknown, unbounded, uncleanable, and
over-duration mutations fail.

### 1. Build the standalone game

Create a fun, deterministic 2D shell with movement, dash, core collection,
relay banking, health, scoring, and extraction. It must work with no server,
Daytona, Codex, or mutation dependency.

**Proof:** a human can complete a full seeded run.

### 2. Add the mutation runtime

Apply one hand-authored typed mutation at a timed boundary. Show its patch note,
duration, effect, expiry, and cleanup.

**Proof:** the mutation affects play and leaves no stale state after expiry.

### 3. Add telemetry and a local director

Aggregate game events every 20 seconds, classify difficulty, and use mock
agents to demonstrate gradual adaptation.

**Proof:** weak runs do not escalate; dominant repetitive runs do.

### 4. Add the validator and proposal protocol

Introduce three mock personas, proposal storage, visible rejection reasons,
invariant checks, and deterministic selection.

**Proof:** invalid or impossible mutations cannot be selected.

### 5. Add Daytona and Codex

Prepare three persistent sandboxes, send compact retained context, request
schema-constrained proposals in parallel, validate them, and keep the game
running through timeouts or sandbox failure.

**Proof:** all three environments persist across patch cycles and a restarted
agent recovers from server-owned context.

### 6. Polish the live-patch experience

Show drafting, validation, rejection, selection, incoming-patch countdown,
author identity, consequence, duration, and visible in-world effects.

**Proof:** the next change is understandable within two seconds and the game
never visibly pauses while agents work.

### 7. Optional finale

After the human run, make the game masters play the final mutation stack using
only normal player commands. Compare all scores under identical rules.

## Demo plan

The two-minute demo should show:

1. The player immediately collecting and banking Fork Cores.
2. Three named game masters drafting in parallel.
3. At least one rejected proposal with a concise safety reason.
4. One selected patch announced and applied without pausing play.
5. The mutation visibly responding to the player's observed strategy.
6. The activity log proving Daytona isolation, Codex authorship, validation,
   selection, and cleanup.

Maintain two demo paths:

- A deterministic seeded path that always demonstrates the complete loop.
- A genuinely live path that visibly calls the Daytona-backed game masters.

## V1 non-goals

- Arbitrary agent edits to the engine, renderer, or browser source.
- Arbitrary JavaScript execution in the browser.
- Multiplayer, accounts, profiles, or persistent progression.
- LLM authority over collision, score, death, or map validity.
- Agent player mode before the human game-master loop is complete.

## Acceptance criteria

- A human can play a complete 60–90 second run.
- The shell remains playable without agents or provider access.
- Three game masters author candidate configs in parallel.
- Agents retain compact context derived from player performance and outcomes.
- Every accepted mutation passes schema, capability, invariant, difficulty, and
  simulation validation.
- Mutations adapt gradually and cannot make extraction impossible.
- The UI shows drafting, rejection, validation, selection, and activation.
- The match log reconstructs why each patch was accepted or rejected.
- Codex's role as constrained mutation author is explicit.
- Daytona's role as persistent isolated parallel compute is explicit.

## First execution slice

Start with contracts only. Freeze and test the mutation, telemetry, game, and
proposal schemas before parallel implementation begins.

The first playable milestone is the standalone 2D shell. Do not begin live
Daytona/Codex integration until the local mutation and director feedback loop is
working with mocks.
