# Fork Fighter demo runbook

This runbook provides two independent paths:

- a deterministic seeded path that never needs Daytona or model access;
- a live path that proves three private Daytona-hosted Codex Game Masters.

Keep the seeded path open throughout the presentation. It is the contingency path if the live provider is slow or unavailable.

## Prerequisites

- Node.js 20.6 or newer
- pnpm 10
- Chromium for Playwright: `pnpm exec playwright install chromium`
- Repository: <https://github.com/Sukhraj1000/fork-fighter-live-patch-war>

From the repository root:

```bash
pnpm install
pnpm verify
```

`pnpm verify` must pass before a presentation. It covers typechecking, unit and integration tests, production builds, desktop gameplay, mobile tapping, the seeded path and offline fallback.

## Terminal A: deterministic seeded demo

```bash
pnpm demo:seeded
```

Open:

- Game: <http://127.0.0.1:3001/?demo=seeded>
- Health: <http://127.0.0.1:3001/health>
- Runtime proof: <http://127.0.0.1:3001/api/runtime>

Expected sequence after `START SEEDED DEMO`:

1. The runner starts immediately and the score rises.
2. Architect, Gremlin and Auditor draft in parallel.
3. The activity feed shows a rejected candidate and one referee-selected candidate.
4. The selected attack is announced for 3–5 seconds.
5. At five seconds, exactly one typed obstacle patch becomes live.
6. The patch card names the author, consequence, duration and concrete demands.
7. The patch expires, its objects/rules are cleaned up and the baseline runner continues.
8. A collision shows final score, personal best and restart.

The fixed seed and timing contract are recorded in `fixtures/demo/seeded-run.json`.

## Terminal B: live Daytona proof

Complete `.env` from `.env.example`. Credentials must stay server-side and must not be placed in screenshots, logs or the repository.

Prepare and prove the reusable worker image once:

```bash
pnpm --filter @fork-fighter/gm-orchestrator prepare:snapshot
pnpm daytona:smoke
```

Leave Terminal A running. Start the live server on a second port:

```bash
PORT=3002 pnpm demo:live
```

Open:

- Live game: <http://127.0.0.1:3002/>
- Runtime proof: <http://127.0.0.1:3002/api/runtime>

Before presenting, confirm the runtime response reports:

```json
{
  "provider": "daytona",
  "sandboxed": true,
  "parallelGameMasters": 3,
  "maxActivePatches": 1
}
```

Start one run. The footer must say `DAYTONA // 3 PARALLEL CODEX WORKERS`. The activity feed must then show proposal receipt and either a specific validation rejection or a selected patch. The 25-second collision tutorial keeps the player alive while the first live Codex round runs; a selected patch enters its countdown near the 21-second boundary.

When the run ends, verify worker cleanup with the Daytona dashboard or SDK. There must be no remaining workers labelled for the ended match. The server also expires inactive matches after 60 seconds, enforces a ten-minute absolute lifetime, and rotates each match log at 8 MiB with three retained files.

## Presentation reset

Before each take:

1. Reload the selected URL.
2. Confirm the correct footer: `LOCAL MOCK GAME MASTERS` for seeded or `DAYTONA // 3 PARALLEL CODEX WORKERS` for live.
3. Confirm `/health` returns `{"status":"ok"}`.
4. Clear any game-over overlay by using `RESTART RUN` or reload.
5. Do not expose `.env`, browser developer tools containing credentials, or the Daytona key page.

## 30-second contingency

If live Daytona does not produce a proposal promptly, do not wait on stage:

1. Switch to the already-open seeded tab on port 3001.
2. Say: “The shell does not depend on a model. This seeded path uses the same typed proposal, validation, selection and cleanup boundary.”
3. Start the seeded run.
4. Point to the visible rejection, selected attack, live typed demand and deterministic cleanup.
5. Close on the architecture statement: Daytona supplies three isolated creative workers; the stable game and referee retain authority.

## Stop and cleanup

End active runs in the UI, then stop both servers with Ctrl-C. Server shutdown ends remaining matches, closes their workers and flushes their bounded logs.
