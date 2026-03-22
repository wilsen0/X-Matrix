# TradeMesh Progress

> Last updated: 2026-03-22

## Current State

- Version: `v0.4.1`
- Product framing: `CLI Skill Mesh 2.0 for OKX`
- Status: production-grade supervised execution M2.6 (`KISS hardening for operator usability + modularity proof`)

## What Is Now Implemented

### Runtime product surface

- `doctor` now renders a readiness card
- `doctor` now supports `--probe passive|active|write` and module-level probe receipts
- `doctor` now supports `--strict --strict-target plan|apply|execute` for machine gate checks
- probe failures are now normalized with `reasonCode` + `nextActionCmd`
- `doctor` now emits reason catalog data for remediation automation
- `demo "<goal>"` orchestrates `doctor -> skills graph -> plan -> apply -> replay`
- `skills inspect <name>` exposes manifest-driven skill details
- `skills graph` exposes the skill mesh topology
- `skills certify` now verifies modular skill contracts and standalone executability
- `skills run <name>` now executes manifest-declared standalone mini-workflows
- `rehearse demo` now runs deterministic operations rehearsal route
- `runs list` now shows structured run summaries
- `reconcile <run-id>` now converges pending/ambiguous write outcomes with `--source auto|client-id|fallback` and `--window-min`
- `reconcile --until-settled` now loops with bounded retries (`--max-attempts`, `--interval-sec`) and per-attempt evidence
- `export <run-id>` now writes `report.md` + `bundle.json` + `operator-summary.json`
- replay/export now share the same six-field `report.operator-brief` first-screen contract
- `apply` now accepts live supervised flags:
  - `--live-confirm YES_LIVE_EXECUTION`
  - `--max-order-usd <n>`
  - `--max-total-usd <n>`

### Runtime control model

- `okx` CLI remains the only execution kernel
- `official-executor` remains the only write path
- `graph-runtime` is the execution-order truth for planning
- `router` is reduced to goal-signal and seed-selection logic
- `artifacts` remain the authoritative skill handoff contract
- `goal.intake` is now the authoritative goal interpretation contract
- `RunRecord` is now hard-cutover `version: 3` with explicit `routeKind`
- artifact envelopes are hard-cutover `version: 3`
- idempotency storage is now v3 `journal + snapshot + lock`

### Flagship hedge pack

- `trade-thesis` remains the synthesis layer
- `hedge-planner` now outputs ranked proposals with score breakdowns
- `scenario-sim` now finalizes recommendation ordering after stress ranking
- `policy-gate` now surfaces capability gaps and proposal actionability during plan
- `apply` keeps dry-run first, records structured execution receipts, and does not auto-retry writes
- `apply --execute` now requires `--approve --approved-by <name>` and emits `approval.ticket`
- `live` execute now requires supervised guard contract (`live-confirm + order caps + fresh active doctor`)
- apply write path now checks local idempotency gate before execution
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
- `SkillManifest.contractVersion`
- `SkillManifest.safetyClass`
- `SkillManifest.determinism`
- `DoctorReport.probeMode`
- `DoctorReport.modules`
- `DoctorReport.probeReceipts`
- `DoctorReport.strictTarget`
- `DoctorReport.strictPass`
- `ProbeReceipt.reasonCode`
- `ProbeReceipt.nextActionCmd`
- `ProbeReasonCatalog`
- `RunRecord.routeKind`
- `RunRecord.entrySkill`
- `ExecutionRecord.approvalTicketId`
- `ExecutionRecord.idempotencyChecked`
- `ExecutionRecord.reconciliationState`
- `ExecutionRecord.executionId`
- `ExecutionRecord.idempotencyLedgerSeq`
- `ExecutionRecord.reconciliationRequired`
- `ExecutionRecord.doctorCheckedAt`
- `OkxCommandIntent.clientOrderRef`
- `ExecutionResult.startedAt`
- `ExecutionResult.finishedAt`
- `ApprovalTicket`
- `IdempotencyLedgerV3`
- `IdempotencyEvent`
- `ReconciliationReport`
- `OperatorSummaryV3`
- `RunRecord.operatorState`
- `RunRecord.lastSafeAction`
- `RunRecord.requiresHumanAction`
- `execution.idempotency-check`
- `operations.live-guard`
- `diagnostics.reason-catalog`
- `report.operator-brief`
- `mesh.skill-certification`

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
- v3 ledger concurrency guard (concurrent apply has single write admission)
- live-guard blocking for missing supervised-live flags
- reconcile fallback windowed matching
- replay/export operator summary consistency
- replay/export operator brief six-field consistency
- doctor strict target gate behavior
- reconcile until-settled bounded loop behavior
- skills certify pass/fail behavior and error reason reporting
- v3 hard-cutover rejection of v2 run/artifact envelopes

## What Still Matters Next

### Next: Batch-3 (M3)

- approval lifecycle refinement (expiry/escalation)
- reconcile-assisted operator workflow for ambiguous settlement
- second independent mini-workflow pack (`rebalance`)
