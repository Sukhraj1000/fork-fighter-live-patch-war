const FALLBACK_SEED = 0x6d2b79f5

function hashString(value: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

export function normaliseSeed(seed: number | string): number {
  const value =
    typeof seed === 'string'
      ? hashString(seed)
      : Number.isFinite(seed)
        ? Math.trunc(seed) >>> 0
        : FALLBACK_SEED

  return value === 0 ? FALLBACK_SEED : value
}

export function nextRandom(state: number): { state: number; value: number } {
  let nextState = state >>> 0
  nextState ^= nextState << 13
  nextState ^= nextState >>> 17
  nextState ^= nextState << 5
  nextState >>>= 0

  return {
    state: nextState,
    value: nextState / 0x1_0000_0000,
  }
}

export function randomInteger(
  state: number,
  minimum: number,
  maximum: number,
): { state: number; value: number } {
  const random = nextRandom(state)
  const span = maximum - minimum + 1

  return {
    state: random.state,
    value: minimum + Math.floor(random.value * span),
  }
}
