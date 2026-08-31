import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { dirname, join } from 'node:path'

import type {
  MatchLogEntry,
  MatchLogStore,
  MatchReplay,
} from './types.js'

export class JsonlMatchLogStore implements MatchLogStore {
  readonly #directory: string
  readonly #maxBytes: number
  readonly #maxFiles: number
  readonly #queues = new Map<string, Promise<void>>()

  constructor(
    directory: string,
    options: { maxBytes?: number; maxFiles?: number } = {},
  ) {
    this.#directory = directory
    this.#maxBytes = options.maxBytes ?? 8 * 1024 * 1024
    this.#maxFiles = options.maxFiles ?? 3
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 1) {
      throw new Error('maxBytes must be a positive integer')
    }
    if (!Number.isSafeInteger(this.#maxFiles) || this.#maxFiles < 1) {
      throw new Error('maxFiles must be a positive integer')
    }
  }

  async append(entry: MatchLogEntry): Promise<void> {
    const previous = this.#queues.get(entry.matchId) ?? Promise.resolve()
    const next = previous.then(async () => {
      const path = this.pathFor(entry.matchId)
      await mkdir(dirname(path), { recursive: true })
      const line = `${JSON.stringify(entry)}\n`
      const currentBytes = await this.#size(path)
      if (
        currentBytes > 0 &&
        currentBytes + Buffer.byteLength(line, 'utf8') > this.#maxBytes
      ) {
        await this.#rotate(path)
      }
      const handle = await open(path, 'a', 0o600)
      try {
        await handle.appendFile(line, 'utf8')
      } finally {
        await handle.close()
      }
    })
    this.#queues.set(entry.matchId, next)
    await next
  }

  async read(matchId: string): Promise<readonly MatchLogEntry[]> {
    await this.#queues.get(matchId)
    const entries: MatchLogEntry[] = []
    const path = this.pathFor(matchId)
    for (let index = this.#maxFiles - 1; index >= 0; index -= 1) {
      const candidate = index === 0 ? path : `${path}.${index}`
      try {
        const contents = await readFile(candidate, 'utf8')
        entries.push(
          ...contents
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as MatchLogEntry),
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return entries
  }

  async close(): Promise<void> {
    await Promise.all(this.#queues.values())
  }

  pathFor(matchId: string): string {
    return join(this.#directory, `${matchId}.jsonl`)
  }

  async #size(path: string): Promise<number> {
    try {
      return (await stat(path)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }

  async #rotate(path: string): Promise<void> {
    if (this.#maxFiles === 1) {
      await rm(path, { force: true })
      return
    }
    await rm(`${path}.${this.#maxFiles - 1}`, { force: true })
    for (let index = this.#maxFiles - 2; index >= 1; index -= 1) {
      try {
        await rename(`${path}.${index}`, `${path}.${index + 1}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await rename(path, `${path}.1`)
  }
}

export class InMemoryMatchLogStore implements MatchLogStore {
  readonly entries: MatchLogEntry[] = []

  async append(entry: MatchLogEntry): Promise<void> {
    this.entries.push(structuredClone(entry))
  }

  async read(matchId: string): Promise<readonly MatchLogEntry[]> {
    return this.entries
      .filter((entry) => entry.matchId === matchId)
      .map((entry) => structuredClone(entry))
  }
}

export function reconstructMatchReplay(
  entries: readonly MatchLogEntry[],
): MatchReplay {
  const matchId = entries[0]?.matchId ?? ''
  const byType = (...types: MatchLogEntry['type'][]): MatchLogEntry[] =>
    entries.filter((entry) => types.includes(entry.type))

  return {
    matchId,
    proposals: byType('proposal_received'),
    rejections: byType('proposal_rejected'),
    selections: byType('proposal_selected'),
    activations: byType('patch_activated'),
    expiries: byType('patch_expired'),
    outcomes: byType('patch_outcome'),
  }
}
