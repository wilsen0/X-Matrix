# TradeMesh Progress

> Last updated: 2026-03-22

## Current State

- Version: `v0.4.0`
- Product framing: `CLI Skill Mesh 2.0 for OKX`
- Status: production-grade supervised execution M2 (`approval + idempotency + reconcile + operator export`)

## What Is Now Implemented

### Runtime product surface

- `doctor` now renders a readiness card
- `doctor` now supports `--probe passive|active|write` and module-level probe receipts
- `demo "<goal>"` orchestrates `doctor -> skills graph -> plan -> apply -> replay`
- `skills inspect <name>` exposes manifest-driven skill details
- `skills graph` exposes the skill mesh topology
- `skills run <name>` now executes manifest-declared standalone mini-workflows
- `rehearse demo` now runs deterministic operations rehearsal route
- `runs list` now shows structured run summaries
- `reconcile <run-id>` now converges pending/ambiguous write outcomes
- `export <run-id>` now writes `report.md` + `bundle.json` + `operator-summary.json`

### Runtime control model

- `okx` CLI remains the only execution kernel
- `official-executor` remains the only write path
- `graph-runtime` is the execution-order truth for planning
- `router` is reduced to goal-signal and seed-selection logic
- `artifacts` remain the authoritative skill handoff contract
- `goal.intake` is now the authoritative goal interpretation contract
- `RunRecord` is now hard-cutover `version: 2` with explicit `routeKind`

### Flagship hedge pack

- `trade-thesis` remains the synthesis layer
- `hedge-planner` now outputs ranked proposals with score breakdowns
- `scenario-sim` now finalizes recommendation ordering after stress ranking
- `policy-gate` now surfaces capability gaps and proposal actionability during plan
- `apply` keeps dry-run first, records structured execution receipts, and does not auto-retry writes
- `apply --execute` now requires `--approve --approved-by <name>` and emits `approval.ticket`
- apply write path now checks local idempotency ledger before execution
- write re-execution is skipped on idempotent hit and blocked on pending/ambiguous state
- `replay` can render the route, evidence, policy verdict, execution receipt, and export pointer

### Operations probe pack (new)

- `env-probe` seeds probe context and baseline environment snapshot
- `market-probe` appends market read probe receipts and refreshes market artifacts
- `account-probe` appends account read probe receipts and refreshes goal/portfolio artifacts
- `diagnosis-synthesizer` produces `diagnostics.readiness` module-level diagnosis
- `rehearsal-planner` produces minimal-risk rehearsal proposals and `operations.rehearsal-plan`

### Data model additions

- `GoalIntake`
- `CapabilitySnapshot.readinessGrade`
- `CapabilitySnapshot.blockers`
- `CapabilitySnapshot.recommendedPlane`
- `PolicyDecision.capabilityGaps`
- `SkillProposal.recommended`
- `SkillProposal.actionable`
- `SkillProposal.executionReadiness`
- `SkillProposal.scoreBreakdown`
- `SkillProposal.rejectionReason`
- `OkxCommandIntent.intentId`
- `OkxCommandIntent.stepIndex`
- `OkxCommandIntent.safeToRetry`
- `ExecutionResult.durationMs`
- `RunRecord.routeSummary`
- `RunRecord.judgeSummary`
- `SkillManifest.standaloneCommand`
- `SkillManifest.standaloneRoute`
- `SkillManifest.standaloneInputs`
- `SkillManifest.standaloneOutputs`
- `SkillManifest.requiredCapabilities`
- `DoctorReport.probeMode`
- `DoctorReport.modules`
- `DoctorReport.probeReceipts`
- `RunRecord.routeKind`
- `RunRecord.entrySkill`
- `ExecutionRecord.approvalTicketId`
- `ExecutionRecord.idempotencyChecked`
- `ExecutionRecord.reconciliationState`
- `OkxCommandIntent.clientOrderRef`
- `ApprovalTicket`
- `IdempotencyLedger`
- `ReconciliationReport`

## Validation

Current automated coverage passes:

```bash
npm test
```

Key verified flows:

- doctor readiness without local `okx`
- skill inspect + graph manifest topology
- demo orchestration path
- plan -> apply --approve -> replay runtime loop
- plan overrides -> goal intake -> export consistency
- policy parity between plan/apply
- hedge ranking + scenario ranking
- write intents never auto-retry even on retryable-looking errors
- skills run standalone routes (including replay source-run targeting)
- doctor passive/active/write probe modes
- rehearse demo dry-run/execute with rehearsal artifacts
- apply execute approval gate (`--approved-by`) and approval ticket persistence
- write idempotent hit skip path
- reconcile state convergence (`matched/ambiguous/failed`)
- export operator summary generation

## What Still Matters Next

### Next: Batch-3 (M3)

- operator-focused replay/export rendering layers
- second independent mini-workflow pack (`rebalance`)
