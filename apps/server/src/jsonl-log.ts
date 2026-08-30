import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  MatchLogEntry,
  MatchLogStore,
  MatchReplay,
} from './types.js'

export class JsonlMatchLogStore implements MatchLogStore {
  readonly #directory: string
  readonly #queues = new Map<string, Promise<void>>()

  constructor(directory: string) {
    this.#directory = directory
  }

  async append(entry: MatchLogEntry): Promise<void> {
    const previous = this.#queues.get(entry.matchId) ?? Promise.resolve()
    const next = previous.then(async () => {
      const path = this.pathFor(entry.matchId)
      await mkdir(dirname(path), { recursive: true })
      const handle = await open(path, 'a', 0o600)
      try {
        await handle.appendFile(`${JSON.stringify(entry)}\n`, 'utf8')
      } finally {
        await handle.close()
      }
    })
    this.#queues.set(entry.matchId, next)
    await next
  }

  async read(matchId: string): Promise<readonly MatchLogEntry[]> {
    await this.#queues.get(matchId)
    try {
      const contents = await readFile(this.pathFor(matchId), 'utf8')
      return contents
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as MatchLogEntry)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.#queues.values())
  }

  pathFor(matchId: string): string {
    return join(this.#directory, `${matchId}.jsonl`)
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
