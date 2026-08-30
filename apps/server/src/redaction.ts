const REDACTED = '[REDACTED]'

const secretKeyPattern =
  /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key)/i

const credentialPattern =
  /\b(?:bearer\s+|api[-_]?key\s*[:=]\s*|token\s*[:=]\s*)[^\s,;]+/gi

function redactString(value: string, secretValues: readonly string[]): string {
  let redacted = value.replace(credentialPattern, REDACTED)
  for (const secret of secretValues) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join(REDACTED)
    }
  }
  return redacted
}

export function redactForExternal(
  value: unknown,
  secretValues: readonly string[] = [],
): unknown {
  if (typeof value === 'string') {
    return redactString(value, secretValues)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForExternal(item, secretValues))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        secretKeyPattern.test(key)
          ? REDACTED
          : redactForExternal(nestedValue, secretValues),
      ]),
    )
  }
  return value
}
