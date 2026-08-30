# Fork Fighter: Live Patch War

Fork Fighter is a fast 2D action game where three long-running AI game masters
study how you play and continuously propose safe, typed mutations to the live
game.

The deterministic game shell never accepts arbitrary agent code. Codex authors
structured mutation configurations, Daytona runs the persistent game-master
workers in parallel, and the authoritative server validates every proposal
before it can become a patch.

Read the complete [project specification](./PROJECT_SPEC.md) for the
architecture, contracts, implementation lanes, build order, and demo plan.

## Current status

- Daytona TypeScript SDK installed and authenticated locally.
- Live sandbox create, execute, and cleanup smoke test verified.
- Project specification and implementation plan complete.
- Monorepo contracts and playable game shell are the next milestones.

## Daytona smoke test

Prerequisites:

- Node.js 20.6 or newer
- A Daytona API key from
  [the Daytona dashboard](https://app.daytona.io/dashboard/keys)

```bash
cp .env.example .env
# Add DAYTONA_API_KEY to .env
npm install
npm run dev
```

The temporary starter creates an isolated sandbox, executes Python, and waits
for the sandbox to be deleted. It will be moved behind the server-only
game-master orchestrator as the monorepo is scaffolded.

## Safety boundary

- Agents submit one typed `MutationProposal`; they cannot edit live game code.
- The server owns canonical game state, telemetry, and retained agent context.
- Every accepted mutation must pass schema, capability, invariant, difficulty,
  and deterministic simulation checks.
- The playable core remains functional if Codex or Daytona is unavailable.
