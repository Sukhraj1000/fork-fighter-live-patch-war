import type {
  MatchDirectorContext,
  MutationDefinition,
  MutationEffect,
  MutationTrigger,
} from '@fork-fighter/contracts'

type EffectEntry = Readonly<{
  effect: MutationEffect
  effectIndex: number
  trigger: MutationTrigger
  triggerIndex: number
}>

export function mutationEffectEntries(
  mutation: MutationDefinition,
): readonly EffectEntry[] {
  return mutation.triggers.flatMap((trigger, triggerIndex) =>
    trigger.effects.map((effect, effectIndex) => ({
      effect,
      effectIndex,
      trigger,
      triggerIndex,
    })),
  )
}

export function requiredCleanupType(
  effect: MutationEffect,
): 'removeEntitiesByTag' | 'restoreEntitiesByTag' | 'restoreRulesByTag' {
  switch (effect.type) {
    case 'spawnCollector':
    case 'spawnBonusCore':
      return 'removeEntitiesByTag'
    case 'relocateHazard':
      return 'restoreEntitiesByTag'
    case 'modifyRule':
    case 'adjustExtractionRequirement':
    case 'configureRunner':
      return 'restoreRulesByTag'
    case 'spawnRunnerHazard':
      return 'removeEntitiesByTag'
  }
}

function effectMechanic(effect: MutationEffect): string {
  switch (effect.type) {
    case 'spawnCollector':
      return `${effect.type}:${effect.spawnAt}`
    case 'relocateHazard':
      return `${effect.type}:${effect.hazard}:${effect.destination}`
    case 'spawnBonusCore':
      return `${effect.type}:${effect.spawnAt}`
    case 'modifyRule':
      return `${effect.type}:${effect.rule}:${effect.value < 1 ? 'down' : effect.value > 1 ? 'up' : 'same'}`
    case 'adjustExtractionRequirement':
      return `${effect.type}:up`
    case 'configureRunner':
      return [
        effect.type,
        effect.gravityMode,
        effect.rotationMode,
        effect.worldStyle,
        effect.speedMultiplier < 1
          ? 'slow'
          : effect.speedMultiplier > 1
            ? 'fast'
            : 'steady',
      ].join(':')
    case 'spawnRunnerHazard':
      return `${effect.type}:${effect.hazard}:${effect.lane}`
  }
}

export function mutationMechanicTokens(
  mutation: MutationDefinition,
): readonly string[] {
  const tokens = mutationEffectEntries(mutation).map(
    ({ effect, trigger }) => `${trigger.type}:${effectMechanic(effect)}`,
  )
  if (mutation.objective) tokens.push(`objective:${mutation.objective.type}`)
  return tokens.sort()
}

export function mutationMechanicKey(mutation: MutationDefinition): string {
  return [...new Set(mutationMechanicTokens(mutation))].join('|')
}

export function stableSerialize(value: unknown): string {
  const ancestors = new Set<object>()

  function visit(current: unknown): string {
    if (current === null) return 'null'
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return JSON.stringify(String(current))
      return JSON.stringify(current)
    }
    if (typeof current === 'string' || typeof current === 'boolean') {
      return JSON.stringify(current)
    }
    if (typeof current === 'undefined') return '"[Undefined]"'
    if (typeof current !== 'object') return JSON.stringify(String(current))
    if (ancestors.has(current)) return '"[Circular]"'

    ancestors.add(current)
    let serialised: string
    if (Array.isArray(current)) {
      serialised = `[${current.map((entry) => visit(entry)).join(',')}]`
    } else {
      const record = current as Record<string, unknown>
      serialised = `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(record[key])}`)
        .join(',')}}`
    }
    ancestors.delete(current)
    return serialised
  }

  return visit(value)
}

export function stableHash(value: unknown): string {
  const text = typeof value === 'string' ? value : stableSerialize(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function mutationConceptId(mutation: MutationDefinition): string {
  return `mechanic-${stableHash(mutationMechanicKey(mutation))}`
}

export function estimateMutationPressure(mutation: MutationDefinition): number {
  let pressure = 0
  for (const { effect } of mutationEffectEntries(mutation)) {
    switch (effect.type) {
      case 'spawnCollector':
        pressure +=
          effect.count *
          (0.25 + effect.speedMultiplier * 0.25 + effect.contactDamage / 50)
        break
      case 'relocateHazard':
        pressure += effect.destination === 'mostUsedRoute' ? 0.9 : 0.7
        break
      case 'spawnBonusCore':
        pressure -= 0.35 * effect.count
        break
      case 'modifyRule': {
        const direction = effect.rule === 'moveSpeed' ? 1 - effect.value : effect.value - 1
        pressure += direction * 2
        break
      }
      case 'adjustExtractionRequirement':
        pressure += effect.additionalBankedCores * 0.75
        break
      case 'configureRunner': {
        const gravityPressure =
          effect.gravityMode === 'inverted'
            ? 1.1
            : effect.gravityMode === 'zero_g'
              ? 0.75
              : effect.gravityMode === 'moon'
                ? 0.25
                : 0
        pressure += gravityPressure
        pressure += Math.max(0, effect.speedMultiplier - 1) * 2.5
        pressure += Math.max(0, effect.scaleMultiplier - 1) * 1.5
        pressure += Math.max(0, 1 - effect.jumpMultiplier) * 1.2
        break
      }
      case 'spawnRunnerHazard': {
        const hazardWeight =
          effect.hazard === 'falling_anvil' || effect.hazard === 'fork_storm'
            ? 0.8
            : effect.hazard === 'rubber_duck'
              ? 0.4
              : 0.6
        pressure += effect.count * hazardWeight * effect.speedMultiplier
        break
      }
    }
  }
  if (mutation.objective) pressure += 0.2
  return Math.round(pressure * 1_000_000) / 1_000_000
}

export function scoreMutation(
  mutation: MutationDefinition,
  context: MatchDirectorContext,
): number {
  const pressure = estimateMutationPressure(mutation)
  const targetPressure =
    context.telemetry.challengeTrend === 'too_easy'
      ? 1.5
      : context.telemetry.challengeTrend === 'too_hard'
        ? -0.25
        : 0.75
  const challengeFit = Math.max(0, 40 - Math.abs(pressure - targetPressure) * 16)
  const tokens = mutationMechanicTokens(mutation)
  const novelty = new Set(tokens).size * 5
  const effectTypes = new Set(
    mutationEffectEntries(mutation).map(({ effect }) => effect.type),
  )
  const effects = mutationEffectEntries(mutation).map(({ effect }) => effect)
  let playValue = effectTypes.size * 4 + (mutation.objective ? 8 : 0)

  if (
    context.telemetry.routeRepetition >= 0.6 &&
    effectTypes.has('relocateHazard')
  ) {
    playValue += 7
  }
  if (
    context.telemetry.lowRiskCoreRate >= 0.6 &&
    (effectTypes.has('spawnBonusCore') ||
      mutation.objective?.type === 'collectRiskyCores')
  ) {
    playValue += 7
  }
  if (effectTypes.has('configureRunner')) playValue += 12
  if (effectTypes.has('spawnRunnerHazard')) playValue += 10
  if (
    effects.some(
      (effect) =>
        effect.type === 'configureRunner' &&
        (effect.gravityMode === 'inverted' || effect.gravityMode === 'zero_g'),
    )
  ) {
    playValue += 12
  }
  if (
    effects.some(
      (effect) =>
        effect.type === 'spawnRunnerHazard' &&
        ['falling_anvil', 'rubber_duck', 'fork_storm'].includes(effect.hazard),
    )
  ) {
    playValue += 8
  }
  if (context.telemetry.challengeTrend === 'too_hard' && pressure <= 0) {
    playValue += 8
  }

  return Math.round((challengeFit + novelty + playValue) * 1_000_000) / 1_000_000
}
