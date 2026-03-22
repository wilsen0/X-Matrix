# TradeMesh CLI Skill Mesh 2.0 for OKX

`okx-skill-mesh` is a CLI-native runtime that turns `okx` CLI into a guarded, auditable skill mesh.

This repo is not a generic agent framework and not a web app shell. Its product claim is narrower and stronger:

- `okx` CLI is the only execution kernel
- each skill is the only extension unit
- `official-executor` is the only write path
- `runs/` and `.trademesh/runs/` are the auditable source of truth

The flagship pack is a hedge workflow:

`portfolio-xray -> market-scan -> trade-thesis -> hedge-planner -> scenario-sim -> policy-gate -> official-executor -> replay`

That flagship pack proves the runtime. It is not the whole product identity.

For a single-document Chinese walkthrough of the product, runtime, safety model, user value, and current boundaries, see [PROJECT-INTRODUCTION.zh-CN.md](./PROJECT-INTRODUCTION.zh-CN.md).

For supervised operations procedures (strict doctor/reconcile loop/live guard/ledger recovery/proof rerun), see [docs/RUNBOOK-M2.5.md](./docs/RUNBOOK-M2.5.md).

## Why this shape

TradeMesh is optimized for operational clarity and operator trust:

- `doctor --probe passive|active|write` surfaces module-level readiness with probe receipts
- doctor probe failures are normalized into `reasonCode` + `nextActionCmd`
- `doctor --strict --strict-target plan|apply|execute` can act as an automation gate
- `skills inspect` and `skills graph` expose the mesh topology from skill manifests
- `skills certify --strict` now combines manifest checks with portable fixture proofs
- `skills run <name> --skip-satisfied` can resume from existing artifacts instead of replaying the whole mini-route
- `plan` produces ranked proposals, actionability labels, and a policy preview
- `apply` keeps dry-run first and routes every write through `official-executor` with apply-only approval tickets
- write intents use local v3 idempotency journal+snapshot checks before execute
- `reconcile` converges ambiguous/pending write outcomes without replaying writes
- `reconcile --until-settled` loops reconcile attempts until matched or max attempts
- `rehearse demo` validates policy + executor with a deterministic rehearsal route
- `replay` reconstructs the route, evidence, policy, and execution receipt
- every major run writes `mesh.route-proof`, so replay/export can show route minimality and safe rerun points
- `export` materializes a run report, machine-readable bundle, operator summary, skill certification evidence, and route proof evidence

## Quick Start

```bash
npm install
npm run build
node dist/bin/trademesh.js doctor --probe active --plane demo
node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply
node dist/bin/trademesh.js skills ls
node dist/bin/trademesh.js skills graph
node dist/bin/trademesh.js skills certify --strict
node dist/bin/trademesh.js skills run hedge-planner "hedge my BTC drawdown with demo first" --plane demo --input skills/hedge-planner/proof/input.artifacts.json --skip-satisfied
node dist/bin/trademesh.js plan "hedge my BTC drawdown with demo first" --plane demo --symbol BTC --max-drawdown 4 --intent protect-downside --horizon swing
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal protective-put --approve --approved-by alice
node dist/bin/trademesh.js apply <run-id> --plane live --proposal protective-put --approve --approved-by alice --live-confirm YES_LIVE_EXECUTION --max-order-usd 500 --max-total-usd 1500 --execute
node dist/bin/trademesh.js reconcile <run-id> --source auto --window-min 120 --until-settled --max-attempts 3 --interval-sec 5
node dist/bin/trademesh.js rehearse demo --approve
node dist/bin/trademesh.js replay <run-id>
node dist/bin/trademesh.js export <run-id>
node dist/bin/trademesh.js demo "hedge my BTC drawdown with demo first" --plane demo
pnpm test
```

## Core Commands

- `trademesh doctor [--probe passive|active|write] [--plane research|demo|live] [--strict] [--strict-target plan|apply|execute] [--json]`
- `trademesh demo "<goal>" [--plane research|demo|live] [--execute] [--symbol <CSV>] [--max-drawdown <number>] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--json]`
- `trademesh skills ls|list`
- `trademesh skills inspect <name> [--json]`
- `trademesh skills certify [--strict] [--json]`
- `trademesh skills run <name> "<goal>" [--plane research|demo|live] [--symbol <CSV>] [--max-drawdown <number>] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--input <artifact.json>] [--skip-satisfied] [--json]`
- `trademesh skills graph [--json]`
- `trademesh runs list`
- `trademesh plan "<goal>" [--plane research|demo|live] [--profile demo|live] [--symbol <CSV>] [--max-drawdown <number>] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--json]`
- `trademesh apply <run-id> [--plane demo|live] [--profile demo|live] [--proposal <name>] [--approve] [--approved-by <name>] [--approval-reason <text>] [--live-confirm YES_LIVE_EXECUTION] [--max-order-usd <n>] [--max-total-usd <n>] [--execute] [--json]`
- `trademesh rehearse demo [--execute] [--approve] [--json]`
- `trademesh replay <run-id> [--skill <name>] [--json]`
- `trademesh retry <run-id> [--json]`
- `trademesh reconcile <run-id> [--source auto|client-id|fallback] [--window-min <n>] [--until-settled] [--max-attempts <n>] [--interval-sec <n>] [--json]`
- `trademesh export <run-id> [--format md|json] [--output <path>] [--json]`

## Structured Goal Intake

TradeMesh now keeps a canonical `goal.intake` artifact for the flagship route.

- `plan` and `demo` can override the parsed goal with `--symbol`, `--max-drawdown`, `--intent`, and `--horizon`
- portfolio sensing persists the normalized goal interpretation before any market or hedge planning
- `plan`, `apply`, `replay`, and `export` all reference the same interpreted symbols, drawdown target, intent, and horizon

This makes planning more deterministic than the earlier prompt-only heuristics.

## Safety Model

- custom skills do not place orders directly
- `research` blocks all write intents
- `demo` defaults to preview-first, and `--execute` is explicit
- `live` execute requires `--approve --approved-by --live-confirm YES_LIVE_EXECUTION`
- `live` execute also requires `--max-order-usd` and `--max-total-usd` within policy limits
- `live` execute requires a fresh `doctor --probe active --plane live` check (<=15 min)
- `apply --execute` requires `--approve --approved-by <name>` and emits `approval.ticket`
- write intents are deduplicated through:
  - `.trademesh/ledgers/idempotency.v3.snapshot.json`
  - `.trademesh/ledgers/idempotency.v3.journal.jsonl`
  - `.trademesh/ledgers/idempotency.v3.lock`
- every plan/apply/replay persists an auditable run record
- write intents are never auto-retried; only safe read intents may be retried

## Actionability Model

- every proposal now carries `executionReadiness`, `actionable`, and `capabilityGaps`
- `policy-gate` re-evaluates every ranked proposal, not only the selected one
- the recommended proposal must come from the proposals that are currently actionable for dry-run or better
- `doctor` now separates `plan`, `apply`, and `execute` readiness

## Standalone Skill Model

- every skill manifest now declares `standalone_route`, `standalone_inputs`, and `standalone_outputs`
- `skills run <name>` executes that explicit mini-workflow route without trigger-based auto-routing
- `--skip-satisfied` turns standalone execution into a resume/proof mode by skipping already satisfied upstream outputs
- standalone runs are persisted as normal auditable runs with `routeKind=standalone`

## Proof-Carrying Mesh

- every skill now declares `proof_class`
  - `portable`: can be proved locally with fixture artifacts
  - `structural`: keeps a structural contract but does not pretend to be environment-free
- `skills certify` now runs portable fixture routes and records `proofPassed`, `proofMode`, and `rerunCommand`
- every major `plan/apply/reconcile/replay/rehearse` run now writes `mesh.route-proof`
- `mesh.route-proof` records:
  - which route steps executed
  - which steps were `skipped_satisfied`
  - whether the route is minimally sufficient for its target outputs
  - which skills are safe resume points
- replay/export render a `Mesh Proof` section from that artifact instead of inventing a separate explanation layer

## Active Probe + Rehearsal

- `doctor --probe active` runs read probes for market/account paths and records receipts
- `doctor --probe write` runs write-path preflight checks without placing orders
- `doctor` now emits `diagnostics.reason-catalog` style failures with normalized `reasonCode`
- `doctor --strict --strict-target <phase>` returns a machine-checkable pass/fail gate
- `rehearse demo` runs a deterministic operations route:
  - `env-probe -> market-probe -> account-probe -> diagnosis-synthesizer -> rehearsal-planner -> policy-gate -> official-executor`
- rehearsal writes `operations.rehearsal-plan` and `operations.rehearsal-receipt` artifacts

## Approval + Reconcile

- `apply` is the only approval injection point; there is no standalone `approve` command
- `approval-gate` creates `approval.ticket` for supervised write execution
- idempotent write hits are skipped as `skipped(idempotent-hit)`
- `reconcile <run-id> --source auto|client-id|fallback --window-min <n>` updates `execution.reconciliation` and converges pending/ambiguous write state
- `reconcile --until-settled --max-attempts <n> --interval-sec <n>` loops and appends per-attempt evidence until matched or max-attempt exit
- `export` writes `report.md`, `bundle.json`, and `operator-summary.json`
- `report.operator-brief` is now the single six-field operator first-screen source for replay/export
- `bundle.json` now carries `mesh.skill-certification` and `mesh.route-proof` for external proof of modularity and resumability
- apply route now includes explicit guardrail chain:
  - `policy-gate -> approval-gate -> live-guard -> official-executor -> idempotency-gate -> operator-summarizer`

## Skill Certification

- `skills certify` evaluates each installed skill on three dimensions:
  - contract completeness
  - standalone route validity
  - standalone outputs usability
- portable skills also run a fixture-backed proof route, so certification is executable rather than purely declarative
- the command emits a certification table and structured JSON output
- certification summary is embedded in export bundles for operator/auditor handoff

## Hard Cutover

- run files are now `version: 3` and require `routeKind`
- legacy run files and legacy raw artifact snapshots are rejected by design
- recreate old runs with the current runtime before applying/replaying/exporting

## Demo Script

Use this sequence for a live demo:

```bash
node dist/bin/trademesh.js doctor
node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply
node dist/bin/trademesh.js skills graph
node dist/bin/trademesh.js skills certify --strict
node dist/bin/trademesh.js plan "hedge my BTC drawdown with demo first" --plane demo --symbol BTC --max-drawdown 4 --intent protect-downside --horizon swing
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal protective-put --approve --approved-by alice --execute
node dist/bin/trademesh.js reconcile <run-id> --source auto --window-min 120 --until-settled --max-attempts 3 --interval-sec 5
node dist/bin/trademesh.js replay <run-id>
node dist/bin/trademesh.js export <run-id>
```

If local OKX demo credentials are configured and you want the final proof point:

```bash
node dist/bin/trademesh.js demo "hedge my BTC drawdown with demo first" --plane demo --execute
```

## Architecture

Three layers define the system:

- Execution Kernel
  - `okx ... --json`
- Skill Runtime
  - registry, graph runtime, artifact store, canonical goal intake, policy, trace persistence, export bundle, CLI presentation
- Skill Packs
  - `skills/*/SKILL.md` + optional `run.ts`

The knowledge layer under `docs/books`, `docs/rules`, `rules/`, and `doctrines/` supports the flagship hedge pack. It is not the main product headline.

## Important Note

This is a guarded trading runtime prototype, not a production trading engine yet.

- use `apply` without `--execute` first
- review policy and command preview before any write path
- prefer the `demo` plane before touching `live`
