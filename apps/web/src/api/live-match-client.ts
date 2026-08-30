import type { PlayerCommand } from '@fork-fighter/contracts'
import type {
  LiveMatchPayload,
  MatchStreamEvent,
} from '../model/live-match'

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Match server returned ${response.status}: ${detail.slice(0, 160)}`)
  }
  return response.json() as Promise<T>
}

export async function createLiveMatch(): Promise<LiveMatchPayload> {
  const response = await jsonRequest<{ live: LiveMatchPayload }>('/api/live-matches', {
    method: 'POST',
    body: '{}',
  })
  return response.live
}

export async function getLiveMatch(matchId: string): Promise<LiveMatchPayload> {
  const response = await jsonRequest<{ live: LiveMatchPayload }>(
    `/api/live-matches/${encodeURIComponent(matchId)}`,
  )
  return response.live
}

export async function sendPlayerCommand(
  matchId: string,
  command: PlayerCommand,
): Promise<void> {
  await jsonRequest(`/api/live-matches/${encodeURIComponent(matchId)}/commands`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
}

const MATCH_EVENT_TYPES = [
  'snapshot',
  'agent_status',
  'proposal_received',
  'proposal_failed',
  'proposal_rejected',
  'proposal_selected',
  'proposal_expired',
  'patch_scheduled',
  'patch_activated',
  'patch_expired',
  'patch_outcome',
  'event_batch_ingested',
] as const

export function subscribeToMatch(
  matchId: string,
  onEvent: (event: MatchStreamEvent) => void,
  onConnectionChange: (connected: boolean) => void,
): () => void {
  const source = new EventSource(`/api/matches/${encodeURIComponent(matchId)}/events`)
  const listeners = MATCH_EVENT_TYPES.map((type) => {
    const listener = (event: Event) => {
      const message = event as MessageEvent<string>
      onEvent({
        id: Number.parseInt(message.lastEventId || '0', 10),
        type,
        data: JSON.parse(message.data) as unknown,
      })
    }
    source.addEventListener(type, listener)
    return [type, listener] as const
  })
  source.onopen = () => onConnectionChange(true)
  source.onerror = () => onConnectionChange(false)

  return () => {
    for (const [type, listener] of listeners) {
      source.removeEventListener(type, listener)
    }
    source.close()
  }
}
