import {
  MutationProposalSchema,
  type GameMasterRequest,
  type MutationProposal,
} from '@fork-fighter/contracts'

function cycleKey(request: GameMasterRequest): string {
  return request.context.patchIndex.toString(36)
}

function difficultyCost(request: GameMasterRequest, target: number): number {
  const budget = request.context.remainingDifficultyBudget
  return Math.max(0.1, Math.min(target, Math.max(0.1, budget)))
}

export function createArchitectMockProposal(
  request: GameMasterRequest,
): MutationProposal {
  const cycle = cycleKey(request)
  const runnerTag = `mock:architect:${cycle}:runner`
  const hazardTag = `mock:architect:${cycle}:walls`

  return MutationProposalSchema.parse({
    proposalId: `proposal:architect:${cycle}`,
    requestId: request.requestId,
    author: 'architect',
    mutation: {
      id: `mock:architect:${cycle}`,
      title: 'Moonbase Construction',
      patchNote: 'Low gravity and neon construction walls remix the next jump sequence.',
      author: 'architect',
      durationMs: 14_000,
      difficultyCost: difficultyCost(request, 1.25),
      triggers: [
        {
          id: 'open-moonbase',
          type: 'onActivation',
          effects: [
            {
              type: 'configureRunner',
              gravityMode: 'moon',
              jumpMultiplier: 1.2,
              speedMultiplier: 0.9,
              scaleMultiplier: 0.9,
              rotationMode: 'upright',
              worldStyle: 'neon',
              tag: runnerTag,
            },
          ],
        },
        {
          id: 'deploy-construction-walls',
          type: 'onActivation',
          effects: [
            {
              type: 'spawnRunnerHazard',
              hazard: 'moving_wall',
              lane: 'air',
              count: 2,
              spacingMs: 750,
              speedMultiplier: 0.9,
              telegraphMs: 700,
              tag: hazardTag,
            },
          ],
        },
      ],
      limits: { maxTriggerActivations: 2, maxSpawnedEntities: 2 },
      cleanup: [
        { type: 'restoreRulesByTag', tag: runnerTag, when: 'expiry' },
        { type: 'removeEntitiesByTag', tag: hazardTag, when: 'expiry' },
      ],
    },
    summary: 'Creates a coherent low-gravity construction-zone remix.',
    expectedImpact: 'Longer jumps and telegraphed walls change timing without blocking play.',
  })
}

export function createGremlinMockProposal(
  request: GameMasterRequest,
): MutationProposal {
  const cycle = cycleKey(request)
  const zeroGravity = request.context.patchIndex % 2 === 0
  const runnerTag = `mock:gremlin:${cycle}:runner`
  const hazardTag = `mock:gremlin:${cycle}:${zeroGravity ? 'anvils' : 'forks'}`

  return MutationProposalSchema.parse({
    proposalId: `proposal:gremlin:${cycle}`,
    requestId: request.requestId,
    author: 'gremlin',
    mutation: {
      id: `mock:gremlin:${cycle}`,
      title: zeroGravity ? 'Zero-G Anvil Disco' : 'Upside-Down Fork Storm',
      patchNote: zeroGravity
        ? 'Gravity disappears while the upright runner dodges anvils drifting through the air lane.'
        : 'Gravity flips and a telegraphed fork storm attacks the ceiling lane.',
      author: 'gremlin',
      durationMs: 12_000,
      difficultyCost: difficultyCost(request, 3),
      triggers: [
        {
          id: 'flip-the-runner',
          type: 'onActivation',
          effects: [
            {
              type: 'configureRunner',
              gravityMode: zeroGravity ? 'zero_g' : 'inverted',
              jumpMultiplier: zeroGravity ? 1.1 : 0.9,
              speedMultiplier: 1,
              scaleMultiplier: 0.9,
              rotationMode: zeroGravity ? 'upright' : 'flipped',
              worldStyle: zeroGravity ? 'neon' : 'void',
              tag: runnerTag,
            },
          ],
        },
        {
          id: 'throw-the-forks',
          type: 'onActivation',
          effects: [
            {
              type: 'spawnRunnerHazard',
              hazard: zeroGravity ? 'falling_anvil' : 'fork_storm',
              lane: zeroGravity ? 'air' : 'ceiling',
              count: zeroGravity ? 2 : 3,
              spacingMs: 600,
              speedMultiplier: 1.05,
              telegraphMs: 1_000,
              tag: hazardTag,
            },
          ],
        },
      ],
      limits: { maxTriggerActivations: 2, maxSpawnedEntities: zeroGravity ? 2 : 3 },
      cleanup: [
        { type: 'restoreRulesByTag', tag: runnerTag, when: 'expiry' },
        { type: 'removeEntitiesByTag', tag: hazardTag, when: 'expiry' },
      ],
    },
    summary: zeroGravity
      ? 'Combines readable zero gravity with a bounded anvil barrage.'
      : 'Combines a bounded gravity inversion with a visible fork barrage.',
    expectedImpact: 'Forces a dramatic control adaptation while preserving warning time.',
  })
}

export function createAuditorMockProposal(
  request: GameMasterRequest,
): MutationProposal {
  const cycle = cycleKey(request)
  const runnerTag = `mock:auditor:${cycle}:runner`
  const struggling = request.context.telemetry.challengeTrend === 'too_hard'

  return MutationProposalSchema.parse({
    proposalId: `proposal:auditor:${cycle}`,
    requestId: request.requestId,
    author: 'auditor',
    mutation: {
      id: `mock:auditor:${cycle}`,
      title: struggling ? 'Recovery Spin' : 'Slow-Motion Audit',
      patchNote: struggling
        ? 'The world slows down while the runner performs a harmless victory spin.'
        : 'A slow-motion sunset forces deliberate timing without adding a hazard.',
      author: 'auditor',
      durationMs: 10_000,
      difficultyCost: difficultyCost(request, 0.25),
      triggers: [
        {
          id: 'apply-slow-motion-audit',
          type: 'onActivation',
          effects: [
            {
              type: 'configureRunner',
              gravityMode: 'normal',
              jumpMultiplier: 1.25,
              speedMultiplier: 0.75,
              scaleMultiplier: 0.8,
              rotationMode: 'spin',
              worldStyle: 'sunset',
              tag: runnerTag,
            },
          ],
        },
      ],
      limits: { maxTriggerActivations: 1, maxSpawnedEntities: 1 },
      cleanup: [
        { type: 'restoreRulesByTag', tag: runnerTag, when: 'expiry' },
      ],
    },
    summary: 'Applies a reversible slow-motion visual and control remix.',
    expectedImpact: 'Creates recovery room while still making the selected patch obvious.',
  })
}
