import {
  GameStateSchema,
  MatchDirectorContextSchema,
  MutationProposalSchema,
  canonicalMockGameState,
  debtCollectorMutationFixture,
  type MutationProposal,
} from '@fork-fighter/contracts'

export const validatorContextFixture = MatchDirectorContextSchema.parse({
  version: 1,
  matchId: 'validator-match',
  patchIndex: 2,
  updatedAtMs: 40_000,
  telemetry: {
    matchId: 'validator-match',
    patchIndex: 2,
    elapsedMs: 40_000,
    health: 100,
    coresHeld: 1,
    coresBanked: 1,
    primaryObjectiveProgress: 1 / 3,
    recentDamage: 0,
    recentDeaths: 0,
    routeRepetition: 0.75,
    lowRiskCoreRate: 0.7,
    highRiskCoreRate: 0.3,
    activeMutationIds: [],
    recentPatchOutcomes: [],
    challengeTrend: 'too_easy',
  },
  remainingDifficultyBudget: 3,
  recentMutationIds: [],
  rejectedConceptIds: [],
})

export const validatorGameStateFixture = GameStateSchema.parse(
  canonicalMockGameState,
)

export const validCollectorProposalFixture = MutationProposalSchema.parse({
  proposalId: 'proposal-debt-collector',
  requestId: 'request-validator-2',
  author: 'gremlin',
  mutation: debtCollectorMutationFixture,
  summary: 'Adds measured pursuit pressure after core collection.',
  expectedImpact: 'Encourages prompt banking without blocking objectives.',
})

export const validBonusProposalFixture = MutationProposalSchema.parse({
  proposalId: 'proposal-risky-bonus',
  requestId: 'request-validator-2',
  author: 'architect',
  mutation: {
    id: 'risky-route-bonus',
    title: 'Risk Dividend',
    patchNote: 'A bonus core appears on the risky route.',
    author: 'architect',
    durationMs: 20_000,
    difficultyCost: 1,
    triggers: [
      {
        id: 'activate-bonus',
        type: 'onActivation',
        effects: [
          {
            type: 'spawnBonusCore',
            count: 1,
            spawnAt: 'riskyRoute',
            scoreMultiplier: 1.5,
            tag: 'risk-dividend:cores',
          },
        ],
      },
    ],
    limits: { maxTriggerActivations: 1, maxSpawnedEntities: 1 },
    cleanup: [
      {
        type: 'removeEntitiesByTag',
        tag: 'risk-dividend:cores',
        when: 'expiry',
      },
    ],
  },
  summary: 'Offers a fresh reward away from the safest route.',
  expectedImpact: 'Invites a voluntary risk without raising mandatory pressure.',
})

export const invalidSchemaProposalFixture = {
  ...structuredClone(validCollectorProposalFixture),
  proposalId: 'proposal-invalid-schema',
  mutation: {
    ...structuredClone(validCollectorProposalFixture.mutation),
    id: 'invalid-script-effect',
    triggers: [
      {
        id: 'unsafe-trigger',
        type: 'onActivation',
        effects: [{ type: 'executeJavascript', source: 'do-not-run' }],
      },
    ],
  },
}

export const overpoweredProposalFixture = MutationProposalSchema.parse({
  proposalId: 'proposal-overpowered',
  requestId: 'request-validator-2',
  author: 'gremlin',
  mutation: {
    id: 'instant-hunter-pack',
    title: 'Instant Hunter Pack',
    patchNote: 'A fast, high-damage collector pack arrives.',
    author: 'gremlin',
    durationMs: 20_000,
    difficultyCost: 2.5,
    triggers: [
      {
        id: 'activate-hunters',
        type: 'onActivation',
        effects: [
          {
            type: 'spawnCollector',
            count: 3,
            spawnAt: 'farthestEdge',
            speedMultiplier: 1.5,
            contactDamage: 25,
            tag: 'hunter-pack:collectors',
          },
        ],
      },
    ],
    limits: { maxTriggerActivations: 1, maxSpawnedEntities: 3 },
    cleanup: [
      {
        type: 'removeEntitiesByTag',
        tag: 'hunter-pack:collectors',
        when: 'expiry',
      },
    ],
  },
  summary: 'Adds a hunter pack.',
  expectedImpact: 'Creates immediate pursuit pressure.',
})

export const orphanCleanupProposalFixture = MutationProposalSchema.parse({
  ...structuredClone(validCollectorProposalFixture),
  proposalId: 'proposal-orphan-cleanup',
  mutation: {
    ...structuredClone(validCollectorProposalFixture.mutation),
    id: 'collector-orphan-cleanup',
    cleanup: [
      ...structuredClone(validCollectorProposalFixture.mutation.cleanup),
      {
        type: 'restoreRulesByTag',
        tag: 'unowned-rule-change',
        when: 'expiry',
      },
    ],
  },
})

export const overBudgetProposalFixture = MutationProposalSchema.parse({
  ...structuredClone(validCollectorProposalFixture),
  proposalId: 'proposal-over-budget',
  mutation: {
    ...structuredClone(validCollectorProposalFixture.mutation),
    id: 'expensive-collector',
    difficultyCost: 4,
  },
})

export const repetitiveContextFixture = MatchDirectorContextSchema.parse({
  ...structuredClone(validatorContextFixture),
  recentMutationIds: [validCollectorProposalFixture.mutation.id],
})

export const routeBlockingGameStateFixture = GameStateSchema.parse({
  version: 1,
  seed: 808,
  rngState: 808,
  tick: 20,
  elapsedMs: 1_000,
  status: 'running',
  rules: {
    tickMs: 50,
    moveSpeed: 200,
    playerRadius: 14,
    dashDistance: 120,
    dashCooldownMs: 600,
    damageCooldownMs: 400,
    maxHealth: 100,
    requiredBankedCores: 3,
    coreRadius: 10,
    relayBankScore: 100,
    extractionScore: 500,
  },
  map: {
    id: 'single-corridor-map',
    width: 900,
    height: 540,
    playerSpawn: { x: 60, y: 270 },
    obstacles: [
      { id: 'north-wall', bounds: { x: 0, y: 0, width: 900, height: 230 } },
      { id: 'south-wall', bounds: { x: 0, y: 310, width: 900, height: 230 } },
    ],
    damageZones: [
      {
        id: 'movable-gate-hazard',
        bounds: { x: 430, y: 230, width: 40, height: 80 },
        damage: 20,
      },
    ],
    coreSpawns: [
      { id: 'corridor-core-a', position: { x: 200, y: 270 }, risk: 'safe' },
      { id: 'corridor-core-b', position: { x: 350, y: 270 }, risk: 'safe' },
      { id: 'corridor-core-c', position: { x: 500, y: 270 }, risk: 'risky' },
    ],
    relays: [
      { id: 'corridor-relay', position: { x: 720, y: 270 }, radius: 30 },
    ],
    extraction: {
      id: 'corridor-extraction',
      position: { x: 840, y: 270 },
      radius: 28,
    },
  },
  player: {
    position: { x: 60, y: 270 },
    spawnPosition: { x: 60, y: 270 },
    health: 100,
    maxHealth: 100,
    radius: 14,
    coresHeld: 0,
    coresBanked: 0,
    score: 0,
    deaths: 0,
    dashCooldownRemainingMs: 0,
    damageCooldownRemainingMs: 0,
  },
  cores: [
    {
      id: 'corridor-core-a',
      spawnPosition: { x: 200, y: 270 },
      position: { x: 200, y: 270 },
      status: 'available',
      risk: 'safe',
    },
    {
      id: 'corridor-core-b',
      spawnPosition: { x: 350, y: 270 },
      position: { x: 350, y: 270 },
      status: 'available',
      risk: 'safe',
    },
    {
      id: 'corridor-core-c',
      spawnPosition: { x: 500, y: 270 },
      position: { x: 500, y: 270 },
      status: 'available',
      risk: 'risky',
    },
  ],
  extraction: {
    id: 'corridor-extraction',
    position: { x: 840, y: 270 },
    radius: 28,
    requiredBankedCores: 3,
    unlocked: false,
    completed: false,
  },
})

export const routeBlockingProposalFixture: MutationProposal =
  MutationProposalSchema.parse({
    proposalId: 'proposal-route-blocker',
    requestId: 'request-validator-2',
    author: 'gremlin',
    mutation: {
      id: 'route-blocker',
      title: 'Route Blocker',
      patchNote: 'The only corridor receives a relocated hazard.',
      author: 'gremlin',
      durationMs: 20_000,
      difficultyCost: 1.5,
      triggers: [
        {
          id: 'activate-route-blocker',
          type: 'onActivation',
          effects: [
            {
              type: 'relocateHazard',
              hazard: 'nearest',
              destination: 'mostUsedRoute',
              maxDistance: 500,
              tag: 'route-blocker:hazard',
            },
          ],
        },
      ],
      limits: { maxTriggerActivations: 1, maxSpawnedEntities: 1 },
      cleanup: [
        {
          type: 'restoreEntitiesByTag',
          tag: 'route-blocker:hazard',
          when: 'expiry',
        },
      ],
    },
    summary: 'Moves a hazard into the repeated route.',
    expectedImpact: 'Would prevent progress through the only corridor.',
  })

export const invalidValidatorFixtures = [
  {
    name: 'malformed schema',
    proposal: invalidSchemaProposalFixture,
    context: validatorContextFixture,
    gameState: validatorGameStateFixture,
    expectedGate: 'schema',
    expectedCode: 'schema-invalid',
  },
  {
    name: 'overpowered collector',
    proposal: overpoweredProposalFixture,
    context: validatorContextFixture,
    gameState: validatorGameStateFixture,
    expectedGate: 'capability',
    expectedCode: 'collector-policy-limit',
  },
  {
    name: 'orphan cleanup',
    proposal: orphanCleanupProposalFixture,
    context: validatorContextFixture,
    gameState: validatorGameStateFixture,
    expectedGate: 'cleanup',
    expectedCode: 'orphan-cleanup',
  },
  {
    name: 'difficulty budget',
    proposal: overBudgetProposalFixture,
    context: validatorContextFixture,
    gameState: validatorGameStateFixture,
    expectedGate: 'difficulty',
    expectedCode: 'difficulty-budget-exceeded',
  },
  {
    name: 'recent mutation',
    proposal: validCollectorProposalFixture,
    context: repetitiveContextFixture,
    gameState: validatorGameStateFixture,
    expectedGate: 'novelty',
    expectedCode: 'mutation-repeated',
  },
  {
    name: 'route blocking mutation',
    proposal: routeBlockingProposalFixture,
    context: validatorContextFixture,
    gameState: routeBlockingGameStateFixture,
    expectedGate: 'invariant',
    expectedCode: 'extraction-unreachable',
  },
] as const
