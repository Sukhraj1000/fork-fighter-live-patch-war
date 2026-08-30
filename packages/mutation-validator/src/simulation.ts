import type {
  MutationEffect,
  MutationTrigger,
  ValidationReason,
} from '@fork-fighter/contracts'

import { stableHash, stableSerialize } from './mechanics.js'
import type {
  MicroSimulationResult,
  MutationSimulationAdapter,
  MutationSimulationInput,
} from './types.js'

type ScheduledActivation = Readonly<{
  atMs: number
  trigger: MutationTrigger
}>

type SimulatedRules = {
  moveSpeed: number
  dashCooldownMs: number
  damageTakenMultiplier: number
}

function simulationReason(
  code: string,
  message: string,
  path: Array<string | number> = ['mutation'],
): ValidationReason {
  return { code, message, path }
}

function activationCapacity(
  trigger: MutationTrigger,
  input: MutationSimulationInput,
): number {
  switch (trigger.type) {
    case 'onActivation':
      return 1
    case 'onInterval':
      return Math.floor(input.mutation.durationMs / trigger.everyMs)
    case 'onCoreCollected': {
      const collectable = input.gameState.cores.filter(
        ({ status }) => status !== 'banked',
      ).length
      return Math.max(1, collectable)
    }
    case 'onCoreBanked':
      return trigger.minimumBanked <= input.gameState.cores.length ? 1 : 0
  }
}

function scheduleActivations(
  input: MutationSimulationInput,
): readonly ScheduledActivation[] {
  const scheduled = input.mutation.triggers.flatMap((trigger) => {
    const count = activationCapacity(trigger, input)
    if (count === 0) return []
    return Array.from({ length: count }, (_, index) => ({
      trigger,
      atMs:
        trigger.type === 'onActivation'
          ? 0
          : Math.floor(((index + 1) * input.mutation.durationMs) / (count + 1)),
    }))
  })
  return scheduled
    .sort(
      (first, second) =>
        first.atMs - second.atMs || first.trigger.id.localeCompare(second.trigger.id),
    )
    .slice(0, input.mutation.limits.maxTriggerActivations)
}

function ruleName(effect: MutationEffect): keyof SimulatedRules | null {
  if (effect.type !== 'modifyRule') return null
  return effect.rule
}

export function runDeterministicMicroSimulation(
  input: MutationSimulationInput,
): MicroSimulationResult {
  const baselineRules: SimulatedRules = {
    moveSpeed: input.gameState.rules.moveSpeed,
    dashCooldownMs: input.gameState.rules.dashCooldownMs,
    damageTakenMultiplier: 1,
  }
  const rules: SimulatedRules = { ...baselineRules }
  const baselineRequirement = input.gameState.extraction.requiredBankedCores
  let extractionRequirement = baselineRequirement
  const spawnedByTag = new Map<string, number>()
  const ruleSnapshots = new Map<
    string,
    Map<keyof SimulatedRules | 'extractionRequirement', number>
  >()
  const relocatedTags = new Set<string>()
  const reasons: ValidationReason[] = []
  let entitiesSpawned = 0
  const schedule = scheduleActivations(input)

  const rememberRule = (
    tag: string,
    name: keyof SimulatedRules | 'extractionRequirement',
    value: number,
  ): void => {
    let snapshots = ruleSnapshots.get(tag)
    if (!snapshots) {
      snapshots = new Map()
      ruleSnapshots.set(tag, snapshots)
    }
    if (!snapshots.has(name)) snapshots.set(name, value)
  }

  for (const { trigger } of schedule) {
    for (const effect of trigger.effects) {
      switch (effect.type) {
        case 'spawnCollector':
        case 'spawnBonusCore': {
          const current = spawnedByTag.get(effect.tag) ?? 0
          spawnedByTag.set(effect.tag, current + effect.count)
          entitiesSpawned += effect.count
          const activeEntities = [...spawnedByTag.values()].reduce(
            (total, count) => total + count,
            0,
          )
          if (
            activeEntities > input.mutation.limits.maxSpawnedEntities ||
            activeEntities > input.policy.maxSpawnedEntities
          ) {
            reasons.push(
              simulationReason(
                'simulation-entity-limit',
                'Deterministic simulation exceeded the retained entity limit.',
                ['mutation', 'limits', 'maxSpawnedEntities'],
              ),
            )
          }
          break
        }
        case 'relocateHazard':
          relocatedTags.add(effect.tag)
          break
        case 'modifyRule': {
          const name = ruleName(effect)
          if (!name) break
          rememberRule(effect.tag, name, rules[name])
          rules[name] *= effect.value
          if (!Number.isFinite(rules[name]) || rules[name] < 0) {
            reasons.push(
              simulationReason(
                'simulation-invalid-rule',
                'Deterministic simulation produced an invalid game rule.',
              ),
            )
          }
          break
        }
        case 'adjustExtractionRequirement':
          rememberRule(
            effect.tag,
            'extractionRequirement',
            extractionRequirement,
          )
          extractionRequirement += effect.additionalBankedCores
          if (extractionRequirement > input.gameState.cores.length) {
            reasons.push(
              simulationReason(
                'simulation-primary-objective',
                'Deterministic simulation could not preserve the primary objective.',
              ),
            )
          }
          break
      }
    }
  }

  let entitiesCleaned = 0
  for (const cleanup of input.mutation.cleanup) {
    switch (cleanup.type) {
      case 'removeEntitiesByTag': {
        const count = spawnedByTag.get(cleanup.tag) ?? 0
        entitiesCleaned += count
        spawnedByTag.delete(cleanup.tag)
        break
      }
      case 'restoreEntitiesByTag':
        relocatedTags.delete(cleanup.tag)
        break
      case 'restoreRulesByTag': {
        const snapshots = ruleSnapshots.get(cleanup.tag)
        if (snapshots) {
          for (const [name, value] of snapshots) {
            if (name === 'extractionRequirement') extractionRequirement = value
            else rules[name] = value
          }
          ruleSnapshots.delete(cleanup.tag)
        }
        break
      }
    }
  }

  const retainedEntities = [...spawnedByTag.values()].reduce(
    (total, count) => total + count,
    0,
  )
  if (retainedEntities !== 0) {
    reasons.push(
      simulationReason(
        'simulation-stale-entities',
        'Deterministic simulation found entities remaining after expiry.',
      ),
    )
  }
  if (relocatedTags.size !== 0) {
    reasons.push(
      simulationReason(
        'simulation-stale-hazard',
        'Deterministic simulation found a hazard remaining after expiry.',
      ),
    )
  }
  if (
    stableSerialize(rules) !== stableSerialize(baselineRules) ||
    extractionRequirement !== baselineRequirement ||
    ruleSnapshots.size !== 0
  ) {
    reasons.push(
      simulationReason(
        'simulation-stale-rules',
        'Deterministic simulation found rules remaining after expiry.',
      ),
    )
  }

  const distinctReasons = [
    ...new Map(reasons.map((entry) => [`${entry.code}:${entry.path.join('.')}`, entry])).values(),
  ].slice(0, 16)
  const summary = {
    mutationId: input.mutation.id,
    triggerActivations: schedule.length,
    entitiesSpawned,
    entitiesCleaned,
    retainedEntities,
    rules,
    extractionRequirement,
    relocatedTags: [...relocatedTags].sort(),
    reasonCodes: distinctReasons.map(({ code }) => code),
  }

  return {
    passed: distinctReasons.length === 0,
    digest: `sim-${stableHash(summary)}`,
    triggerActivations: schedule.length,
    entitiesSpawned,
    entitiesCleaned,
    reasons: distinctReasons,
  }
}

export const deterministicMutationSimulationAdapter: MutationSimulationAdapter =
  Object.freeze({
    id: 'deterministic-v1',
    simulate: runDeterministicMicroSimulation,
  })
