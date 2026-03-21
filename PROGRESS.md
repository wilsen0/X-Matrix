# TradeMesh Progress

> Last updated: 2026-03-21

## Current State

- Version: `v0.2.0`
- Product framing: `CLI Skill Mesh 2.0 for OKX`
- Status: product-grade demo-ready runtime with guarded plan/apply/replay/export loop

## What Is Now Implemented

### Runtime product surface

- `doctor` now renders a readiness card
- `demo "<goal>"` orchestrates `doctor -> skills graph -> plan -> apply -> replay`
- `skills inspect <name>` exposes manifest-driven skill details
- `skills graph` exposes the skill mesh topology
- `runs list` now shows structured run summaries
- `export <run-id>` now writes `report.md` + `bundle.json` evidence packs

### Runtime control model

- `okx` CLI remains the only execution kernel
- `official-executor` remains the only write path
- `graph-runtime` is the execution-order truth for planning
- `router` is reduced to goal-signal and seed-selection logic
- `artifacts` remain the authoritative skill handoff contract
- `goal.intake` is now the authoritative goal interpretation contract

### Flagship hedge pack

- `trade-thesis` remains the synthesis layer
- `hedge-planner` now outputs ranked proposals with score breakdowns
- `scenario-sim` now finalizes recommendation ordering after stress ranking
- `policy-gate` now surfaces capability gaps and proposal actionability during plan
- `apply` keeps dry-run first, records structured execution receipts, and does not auto-retry writes
- `replay` can render the route, evidence, policy verdict, execution receipt, and export pointer

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

## What Still Matters Next

### High value

- connect to a real local OKX demo environment and rehearse `demo --execute`
- tighten live/demo environment diagnostics beyond profile-file detection
- polish CLI card spacing and copy for live presentation

### Medium value

- add richer route reasoning to `routeSummary`
- add stable screenshots / terminal recording assets for submission
- enrich `replay` and `export` with more compact execution receipts for judges

### Lower value

- add more flagship packs beyond hedging
- expand doctrine coverage only when it changes runtime behavior
