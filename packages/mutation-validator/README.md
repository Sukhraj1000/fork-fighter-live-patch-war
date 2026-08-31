# Mutation validator

`@fork-fighter/mutation-validator` is the deterministic trust boundary between
game-master proposals and the mutation runtime. It accepts untrusted proposal
data plus the server-owned director context and game state, then evaluates the
frozen gates in order:

1. schema
2. capability and active-resource policy
3. cleanup ownership
4. objective, reachability, and spawn invariants
5. difficulty budget and anti-escalation policy
6. active/recent mechanic novelty
7. deterministic apply-and-expire micro-simulation

Only proposals that pass every gate receive a score. Selection sorts candidates
canonically, ranks valid scores, and uses proposal and mutation identifiers as
stable tie-breakers, so input ordering cannot change the winner.

For runner demands the capability gate also acts as a game referee: physics may
change only once per patch, warnings must meet the minimum reaction window,
interval waves cannot overlap, speed/scale/duration are capped, no-op demands
are rejected, and the global one-live-patch limit remains authoritative.

```ts
import {
  selectMutationProposal,
  validateMutationProposal,
} from '@fork-fighter/mutation-validator'

const validation = validateMutationProposal({
  proposal,
  context,
  gameState,
})

const selection = selectMutationProposal({
  candidates: proposals,
  context,
  gameState,
})
```

Rejections expose only concise reason codes, field paths, and activity-feed-safe
messages. They never return provider text, source snippets, exception details,
or hidden reasoning.
