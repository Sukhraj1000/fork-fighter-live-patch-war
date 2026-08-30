import { readFile } from 'node:fs/promises'

const [requestPath, proposalPath] = process.argv.slice(2)
if (requestPath === undefined || proposalPath === undefined) {
  throw new Error('Usage: validate-proposal <request.json> <proposal.json>')
}

const request = JSON.parse(await readFile(requestPath, 'utf8'))
const proposal = JSON.parse(await readFile(proposalPath, 'utf8'))
const expectedKeys = [
  'author',
  'expectedImpact',
  'mutation',
  'proposalId',
  'requestId',
  'summary',
]
const actualKeys = Object.keys(proposal).sort()

if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
  throw new Error('Proposal has fields outside the installed output contract.')
}
if (
  proposal.requestId !== request.requestId ||
  proposal.author !== request.persona ||
  proposal.mutation?.author !== request.persona
) {
  throw new Error('Proposal does not match the request-scoped persona capability.')
}

const forbiddenKeys = new Set([
  'code',
  'command',
  'commands',
  'rawCommand',
  'script',
  'source',
  'sourceEdit',
  'sourceEdits',
])

function rejectForbiddenKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(rejectForbiddenKeys)
    return
  }
  if (value === null || typeof value !== 'object') {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      throw new Error(`Forbidden proposal capability: ${key}`)
    }
    rejectForbiddenKeys(child)
  }
}

rejectForbiddenKeys(proposal)
