import type { GameMasterPersona } from '@fork-fighter/contracts'

import type { GameMasterBrains } from '../brain/proposal-runner.js'
import {
  DeterministicMockBrain,
  type DeterministicMockBrainOptions,
} from './deterministic-mock-brain.js'
import {
  createArchitectMockProposal,
  createAuditorMockProposal,
  createGremlinMockProposal,
} from './proposals.js'

export * from './deterministic-mock-brain.js'
export * from './proposals.js'

export type MockBrainOptionsByPersona = Partial<
  Record<GameMasterPersona, DeterministicMockBrainOptions>
>

export class ArchitectMockBrain extends DeterministicMockBrain {
  constructor(options: DeterministicMockBrainOptions = {}) {
    super('architect', createArchitectMockProposal, options)
  }
}

export class GremlinMockBrain extends DeterministicMockBrain {
  constructor(options: DeterministicMockBrainOptions = {}) {
    super('gremlin', createGremlinMockProposal, options)
  }
}

export class AuditorMockBrain extends DeterministicMockBrain {
  constructor(options: DeterministicMockBrainOptions = {}) {
    super('auditor', createAuditorMockProposal, options)
  }
}

export function createDeterministicMockBrains(
  options: MockBrainOptionsByPersona = {},
): GameMasterBrains {
  return {
    architect: new ArchitectMockBrain(options.architect),
    gremlin: new GremlinMockBrain(options.gremlin),
    auditor: new AuditorMockBrain(options.auditor),
  }
}
