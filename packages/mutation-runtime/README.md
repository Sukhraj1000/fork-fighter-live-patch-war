# Mutation runtime

`@fork-fighter/mutation-runtime` is a deterministic, side-effect-free adapter
between frozen game events and temporary mutation-owned state. It does not
change `GameState`, call the renderer, or perform proposal validation.

The runtime supports both the original Debt Collector composition and the live
runner-demand composition:

```text
onCoreCollected
  -> spawnCollector
  -> removeEntitiesByTag on expiry

onActivation / onInterval
  -> configureRunner / spawnRunnerHazard
  -> restoreRulesByTag / removeEntitiesByTag on expiry
```

Collectors live in the runtime overlay with deterministic sequence ids. The
caller may render or simulate that overlay without adding private fields to the
frozen game contract.

## Lifecycle

1. Create an empty runtime with `createMutationRuntimeState()`.
2. Call `activateMutation(runtime, unknownConfig, boundary)`. Activation parses
   the config through `MutationDefinitionSchema` before changing state and
   emits `patch_activated` plus any bounded activation effects.
3. After each game-core transition, pass its state and events to
   `processMutationGameBoundary`. Matching core events spawn collectors;
   interval boundaries emit deterministic runner-hazard effect events.
4. Call `advanceMutationRuntime` at fixed boundaries that have no game
   transition. At or after `expiresAtMs`, the runtime removes every entity with
   a configured cleanup tag and emits `patch_expired`.

All functions return new state and leave their inputs unchanged. Boundaries
must be monotonic. Expiry wins when a trigger and expiry share a timestamp, so
the outcome does not depend on call timing.

Contract-valid trigger/effect combinations outside the playable slice are
rejected before activation with a typed `MutationRuntimeError`.
