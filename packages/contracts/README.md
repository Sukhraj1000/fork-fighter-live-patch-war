# `@fork-fighter/contracts`

The only shared runtime boundary for Fork Fighter. Zod schemas are the source
of truth; every exported TypeScript type is inferred from its schema.

Import schemas, types, constants, and canonical fixtures from the package root:

```ts
import {
  MutationDefinitionSchema,
  canonicalMockGameState,
  type MutationDefinition,
} from '@fork-fighter/contracts'
```

Deep imports are intentionally not exported. See
[`docs/mutation-sdk.md`](../../docs/mutation-sdk.md) for the frozen mutation
surface and change policy.
