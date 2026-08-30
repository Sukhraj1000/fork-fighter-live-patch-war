# Fork Fighter web presentation

The issue #3 visual lane is a standalone, fixture-driven React and Phaser shell.
It is intentionally runnable before the server, game core, or director lanes are
complete.

## Review the design

```bash
pnpm install
pnpm --filter @fork-fighter/web dev
```

Open `http://127.0.0.1:4173/` and use the three header buttons:

- **Run view** shows the full alternating player run cycle and the Architect as
  the current executor.
- **Patch hit** switches the player to a low dash pose with speed trails and
  shows the Gremlin as the next executor.
- **Extract!** switches the player to a tucked jump pose while the exit is live.

The narrow executor rail intentionally reveals only the master responsible for
the current change, the patch name, and execution state. Proposal history,
validation detail, the full master roster, and lifecycle diagnostics stay out
of the player-facing view.

## Integration boundary

`src/model/view-models.ts` is a presentation facade over the frozen contract in
issue #2. `src/fixtures/mock-game-state.ts` adapts the canonical mock state from
`@fork-fighter/contracts`, the scene consumes `GameStateViewModel`, and keyboard
input emits only `PlayerCommand` values. Renderers do not calculate score,
resolve collisions, apply mutations, or decide whether extraction is legal.

Player motion is also contract-driven. `idle`, `run`, `jump`, `dash`, and `hit`
are presentation values supplied on the player view model; the scene never
infers them from velocity, input, collision, or health.

## Verification

```bash
pnpm --filter @fork-fighter/web typecheck
pnpm --filter @fork-fighter/web build
```
