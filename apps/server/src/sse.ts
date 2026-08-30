import type { ServerResponse } from 'node:http'

import type { MatchLogEntry } from './types.js'

function formatEvent(entry: MatchLogEntry): string {
  return `id: ${entry.sequence}\nevent: ${entry.type}\ndata: ${JSON.stringify(entry.data)}\n\n`
}

export class MatchSseHub {
  readonly #history = new Map<string, MatchLogEntry[]>()
  readonly #connections = new Map<string, Set<ServerResponse>>()

  constructor(readonly historySize: number) {}

  publish(entry: MatchLogEntry): void {
    const history = this.#history.get(entry.matchId) ?? []
    history.push(entry)
    if (history.length > this.historySize) {
      history.splice(0, history.length - this.historySize)
    }
    this.#history.set(entry.matchId, history)

    for (const response of this.#connections.get(entry.matchId) ?? []) {
      response.write(formatEvent(entry))
    }
  }

  subscribe(
    matchId: string,
    response: ServerResponse,
    lastEventId?: number,
  ): { replayed: number; historyMissed: boolean } {
    const connections = this.#connections.get(matchId) ?? new Set()
    connections.add(response)
    this.#connections.set(matchId, connections)

    response.once('close', () => {
      connections.delete(response)
      if (connections.size === 0) {
        this.#connections.delete(matchId)
      }
    })

    const history = this.#history.get(matchId) ?? []
    const historyMissed =
      lastEventId !== undefined &&
      history.length > 0 &&
      lastEventId < history[0]!.sequence - 1
    const replay =
      lastEventId === undefined
        ? []
        : history.filter((entry) => entry.sequence > lastEventId)

    for (const entry of replay) {
      response.write(formatEvent(entry))
    }

    return { replayed: replay.length, historyMissed }
  }

  writeSnapshot(
    response: ServerResponse,
    sequence: number,
    snapshot: unknown,
  ): void {
    response.write(
      `id: ${sequence}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
    )
  }

  closeMatch(matchId: string): void {
    for (const response of this.#connections.get(matchId) ?? []) {
      response.end()
    }
    this.#connections.delete(matchId)
  }

  close(): void {
    for (const matchId of this.#connections.keys()) {
      this.closeMatch(matchId)
    }
  }
}
