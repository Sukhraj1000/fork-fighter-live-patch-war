# `@fork-fighter/game-core`

Pure, deterministic simulation for the base Fork Fighter run. The package has
no renderer, browser, server, mutation, agent, or network dependency.
Its state, command, map, and event types come from `@fork-fighter/contracts`.

The public API is intentionally small:

- `createInitialState` creates a seeded state from the deterministic map.
- `startGame` creates the state and emits the initial event.
- `stepGame` applies exactly one fixed-duration player command.
- `replayGame` applies a command sequence and returns the complete event log.

Every transition returns a new state. Given the same seed, options, and command
sequence, callers receive structurally identical states and events.

Run this package in isolation from the repository root:

```bash
pnpm --filter @fork-fighter/game-core test
pnpm --filter @fork-fighter/game-core typecheck
```
