# `@fork-fighter/director-context`

Deterministic, server-owned player telemetry and local difficulty adaptation for
Fork Fighter. The package has no provider or browser dependency.

Every 20-second patch cycle, `aggregateRunTelemetry` reduces authoritative game
state plus ordered event batches into the frozen `RunTelemetry` contract. It
measures recent damage and deaths, objective progress, route concentration, and
safe-versus-risky core preference. `advanceDirectorContext` retains only bounded
mutation, rejection, and patch-outcome history, so the resulting
`MatchDirectorContext` remains compact JSON that can be replayed after a process
or agent restart.

`selectLocalAdaptivePatch` is the deterministic fallback policy. A `too_hard`
run receives no patch and a zero difficulty budget; an `on_target` run holds its
rules; and only a `too_easy` run can spend budget on a typed fixture mutation.
Dominant repeated routing gets a small route-pressure patch with a compensating
risky reward. Active, rejected, over-budget, and immediately repeated mutations
are excluded before candidates are ranked, allowing the next valid fixture to
act as a stable fallback.
