# Mutation SDK contract

Status: **v1 frozen**

The Mutation SDK is a data contract, not a code-execution API. Game masters
may propose one `MutationDefinition`; they cannot send player commands, source
edits, callbacks, scripts, or engine calls. All untrusted values must pass
`MutationDefinitionSchema` before they reach validation, selection, or the
mutation runtime.

## Public import boundary

Everything supported is exported from `@fork-fighter/contracts`. Deep imports
are not part of the contract.

```ts
import {
  MUTATION_CAPABILITIES,
  MutationDefinitionSchema,
  type MutationDefinition,
} from '@fork-fighter/contracts'

const mutation: MutationDefinition = MutationDefinitionSchema.parse(input)
```

Schemas are authoritative and TypeScript types are inferred from them. A type
assertion is never a substitute for parsing data received from a file, worker,
provider, browser, or network request.

## Supported composition

| Area | Supported variants |
|---|---|
| Authors | `architect`, `gremlin`, `auditor` |
| Triggers | `onActivation`, `onCoreCollected`, `onCoreBanked`, `onInterval` |
| Effects | `spawnCollector`, `relocateHazard`, `spawnBonusCore`, `modifyRule`, `adjustExtractionRequirement`, `configureRunner`, `spawnRunnerHazard` |
| Objectives | `bankAdditionalCores`, `collectRiskyCores`, `survive` |
| Cleanup | `removeEntitiesByTag`, `restoreEntitiesByTag`, `restoreRulesByTag` |

Every trigger and temporary effect has a stable id or tag. Spawned entities,
relocated entities, and modified rules require the corresponding tagged expiry
cleanup. A mutation is rejected during schema parsing when cleanup is absent or
does not match its effect tag.

## Hard schema bounds

- Duration: 1–60 seconds.
- Triggers per mutation: 1–4.
- Effects per trigger: 1–4.
- Spawn count per effect: 1–3.
- Trigger activations: at most 32.
- Spawned entities retained by one mutation: at most 32.
- Difficulty cost: greater than 0 and at most 5.

These are structural safety ceilings. The validator applies stricter current-
match policy, difficulty budgets, novelty checks, reachability invariants, safe
spawn checks, and deterministic micro-simulation before selection.

## Canonical example

`debtCollectorMutationFixture` preserves the original deterministic collector
slice. `upsideDownForkStormMutationFixture` defines the live runner-demand slice:

```text
onCoreCollected
  -> spawnCollector(count: 1, tag: debt-collector:collectors)
  -> removeEntitiesByTag(tag: debt-collector:collectors) on expiry

onActivation
  -> configureRunner(gravity: inverted, rotation: flipped)
onInterval
  -> spawnRunnerHazard(kind: fork_storm, lane: ceiling)
on expiry
  -> restoreRulesByTag + removeEntitiesByTag
```

The fixture is parsed at module initialization, so it cannot silently drift
from the schema.

## Shared game and director boundary

The package also exports schemas and inferred types for:

- `GameConfig`, `GameState`, `PlayerCommand`, `GameEvent`, and
  `GameEventBatch`.
- `RunTelemetry`, `PatchOutcome`, and `MatchDirectorContext`.
- `GameMasterRequest`, `MutationProposal`, `ProposalResult`, and
  `ValidationResult`.
- `canonicalMockGameConfig`, `canonicalMockGameState`, and
  `canonicalMockEventBatch` for renderer, director, server, and integration
  adapters.

## Freeze policy

Downstream lanes may depend only on the package root. After this v1 freeze,
contract changes require an explicit integration-owned review. When a lane
needs a missing field or capability, it should raise that mismatch instead of
adding a private look-alike contract or changing this package opportunistically.
