# TradeMesh

> Modular trading skills for OKX — install like any skill, auto-orchestrate into workflows, trust through proof-carrying execution.

[![Version](https://img.shields.io/badge/version-3.9.0-blue)]()
[![Tests](https://img.shields.io/badge/tests-110%20passing-brightgreen)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22-green)]()
[![TypeScript](https://img.shields.io/badge/lang-TypeScript%205.9-blue)]()

Most trading projects die at the same step: people can read the analysis, but nobody dares deploy and reuse the execution. TradeMesh solves this by turning trading capabilities into independently installable skill modules. Each skill works standalone. Multiple skills auto-compose into complete workflows through artifact dependencies — no config, no glue code. Trust is structural: a single write path, policy gates, and proof-carrying execution make every decision replayable, verifiable, and exportable.

Install trading skills like you install any other skill. That is the product claim.

For a detailed Chinese walkthrough, see [PROJECT-INTRODUCTION.zh-CN.md](./PROJECT-INTRODUCTION.zh-CN.md).
For supervised operations procedures, see [docs/RUNBOOK-M2.5.md](./docs/RUNBOOK-M2.5.md).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Skill Packs                        │
│                                                         │
│  Sensors            Planners           Guardrails       │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │portfolio-xray│  │trade-thesis   │  │policy-gate   │ │
│  │market-scan   │  │hedge-planner  │  │approval-gate │ │
│  │              │  │scenario-sim   │  │live-guard    │ │
│  └──────────────┘  └───────────────┘  └──────────────┘ │
│                                                         │
│  Executor (sole write path)     Audit                   │
│  ┌─────────────────────────┐   ┌──────────────────────┐ │
│  │  official-executor      │   │  replay / export     │ │
│  └─────────────────────────┘   └──────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                    Skill Runtime                         │
│  DAG compiler · safety verifier · Merkle DAG integrity  │
│  registry · graph · artifacts · policy · trace          │
│  goal intake · idempotency ledger · reconcile           │
│  route-proof · portable bundles · skill certification   │
├─────────────────────────────────────────────────────────┤
│                OKX Agent Trade Kit                       │
│  okx CLI · market · trade · portfolio · bot             │
│  (deterministic execution kernel — sole order path)     │
└─────────────────────────────────────────────────────────┘
```

**Three layers, strict boundaries:**

- **Skill Packs** — Each skill is a self-contained directory. Install one for a single capability; install several and they auto-compose through artifact dependencies. The system's capability surface is defined by what's currently installed, not by hardcoded config.
- **Skill Runtime** — The orchestration and trust layer. Compiles skill dependency graphs into parallel execution plans, statically verifies safety invariants before execution, and builds Merkle DAG integrity chains for cryptographic auditability. Also handles discovery, policy enforcement, tracing, and route proofs. No trading logic lives here.
- **Execution Kernel** — OKX Agent Trade Kit is the only way orders reach the exchange. Local signing, permission-aware, demo/live isolation.

## What Makes It Different

- **Install like any skill** — Each skill is a directory with a `SKILL.md` manifest. Drop it in, the runtime auto-discovers it. Remove it, the system adjusts. No config changes, no code changes, no orchestration scripts.
- **Standalone or composed** — Every skill works independently. Install just `market-scan` for market analysis, or just `portfolio-xray` for position diagnostics. When multiple skills are present, the runtime resolves artifact dependencies and auto-composes them into workflows.
- **Trust through write isolation** — `official-executor` is the only module that can place orders. Custom skills read, analyze, plan — they never touch assets directly. That separation is what makes deployment and reuse safe.
- **Proof-carrying mesh** — Every run generates `mesh.route-proof`: machine-verifiable evidence of what executed, what was skipped, and why the route is minimally sufficient. Reuse risk becomes an inspectable object, not a black box.
- **Portable verified bundles** — Export a run as a self-contained `bundle.json` with artifact snapshots, manifest proofs, and route evidence. Replay anywhere without local state.
- **Progressive trust** — `research` → `demo` → `live`, each with independent safety gates, approval flows, and execution caps.

## Quick Start

```bash
npm install && npm run build

# Health check
trademesh doctor --probe active --plane demo

# Full demo flow: doctor → certify → plan → apply → export → replay
pnpm demo:flow

# With execution + receipt verification
pnpm demo:flow -- --execute --approved-by alice
```

## Core Commands

| Command | Purpose |
|---------|---------|
| `doctor [--probe passive\|active\|write] [--strict]` | Environment readiness with probe receipts and machine-checkable gates |
| `skills ls \| graph \| certify --strict` | Mesh topology, contract verification, fixture-backed proof |
| `plan "<goal>" --plane demo` | Ranked proposals with actionability, capability gaps, and policy preview |
| `apply <run-id> [--execute --verify-receipt]` | Dry-run or supervised execution with approval ticket |
| `reconcile <run-id> [--until-settled]` | Converge ambiguous/pending write outcomes with bounded retries |
| `replay <run-id>` or `replay --bundle <file>` | Full decision chain reconstruction (local or portable) |
| `export <run-id>` | Evidence pack: report + verified bundle + operator summary |
| `rehearse demo [--execute --verify-receipt]` | Deterministic operations rehearsal route |

<details>
<summary>Full command reference</summary>

```
trademesh doctor [--probe passive|active|write] [--plane research|demo|live] [--strict] [--strict-target plan|apply|execute] [--json]
trademesh demo "<goal>" [--plane research|demo|live] [--execute] [--symbol <CSV>] [--max-drawdown <number>] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--json]
trademesh skills ls|list
trademesh skills inspect <name> [--json]
trademesh skills certify [--strict] [--json]
trademesh skills run <name> "<goal>" [--plane research|demo|live] [--input <artifact.json>] [--bundle <bundle.json>] [--skip-satisfied] [--allow-contract-drift] [--json]
trademesh skills graph [--json]
trademesh runs list
trademesh plan "<goal>" [--plane research|demo|live] [--symbol <CSV>] [--max-drawdown <number>] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--json]
trademesh apply <run-id> [--plane demo|live] [--proposal <name>] [--approve] [--approved-by <name>] [--live-confirm YES_LIVE_EXECUTION] [--max-order-usd <n>] [--max-total-usd <n>] [--execute] [--verify-receipt] [--json]
trademesh rehearse demo [--execute] [--approve] [--verify-receipt] [--json]
trademesh replay <run-id> [--skill <name>] [--json]
trademesh replay --bundle <bundle.json> [--json]
trademesh retry <run-id> [--json]
trademesh reconcile <run-id> [--source auto|client-id|fallback] [--window-min <n>] [--until-settled] [--max-attempts <n>] [--interval-sec <n>] [--json]
trademesh export <run-id> [--format md|json] [--output <path>] [--json]
```

</details>

## Flagship Workflow

When the hedge skill pack is installed, the runtime auto-composes this chain from artifact dependencies alone — no orchestration config:

```
portfolio-xray → market-scan → trade-thesis → hedge-planner → scenario-sim → policy-gate → official-executor → replay
```

Each arrow is an artifact handoff — not a function call, not a prompt chain. Skills communicate through typed, versioned artifacts that are persisted, replayable, and exportable. Install a different skill pack, get a different workflow. The runtime adapts.

## Safety Model

| Layer | Enforcement |
|-------|-------------|
| Write isolation | `official-executor` is the sole write path; custom skills cannot place orders |
| Plane separation | `research` blocks all writes; `demo` defaults to preview-first; `live` requires explicit confirmation |
| Approval gate | `apply --execute` requires `--approve --approved-by <name>`, emits `approval.ticket` |
| Live guard | `live` requires `--live-confirm YES_LIVE_EXECUTION` + order/total USD caps + fresh doctor check (≤15 min) |
| Idempotency | v3 journal + snapshot + lock prevents duplicate writes under concurrent execution |
| Reconciliation | `reconcile` converges ambiguous/pending states without replaying writes |
| Write retry policy | Write intents are never auto-retried; only safe read intents may retry on transient errors |

## Technical Highlights

### DAG Compiler

The skill runtime compiles artifact dependency graphs into optimized execution plans:

- **Topological sort** (Kahn's algorithm) resolves artifact dependencies into a strict execution order
- **Parallel branch detection** groups independent skills into execution levels — skills at the same level have no mutual dependencies and can run concurrently
- **Critical path analysis** identifies the longest dependency chain and annotates each skill with whether it's on the critical path
- **Dead-skill elimination** prunes skills whose outputs are unreachable from the target artifacts, reducing execution surface without manual config

Output: `ExecutionPlan` with `levels[]`, `criticalPath`, `maxParallelism`, `prunedSkills`, and `dependencyEdges`.

### Merkle DAG Artifact Integrity

Every artifact in the execution chain carries a cryptographic integrity proof:

- Each artifact gets a **content hash** (SHA-256 of stable-JSON-serialized key + data)
- The **chained hash** = SHA-256(contentHash + sorted input artifact chained hashes) — tampering with any upstream artifact invalidates all downstream hashes
- The full execution trace forms a **Merkle DAG** with roots (no inputs), leaves (no consumers), and a `chainDigest` (combined leaf hashes)
- **Single-artifact verification**: given a `MerkleProofPath`, verify one artifact's integrity without replaying the entire chain
- **Full-chain verification**: recompute all chained hashes from artifacts and detect any tampered or missing nodes

This turns "auditable" from a documentation claim into a cryptographic guarantee.

### Static Safety Invariant Verifier

Before any composed workflow executes, the runtime statically verifies six safety invariants on the dependency DAG:

| Invariant | What it checks |
|-----------|---------------|
| Write-path guardrail | Every `writes: true` skill has a `stage: "guardrail"` ancestor |
| Approval-path | Every `writes: true` skill has an ancestor whose name contains "approval" |
| Cycle-freedom | No cycles in the dependency graph (reports exact cycle path) |
| Capability satisfiability | All `requiredCapabilities` are met by the current environment |
| Single-writer | Each artifact is produced by at most one skill |
| Completeness | Every consumed artifact is produced by some skill or supplied as initial input |

Output: `SafetyVerdict` with `passed`, per-invariant results, violation details, and error/warning counts. This is a lightweight model checker for skill workflows.

### Runtime Infrastructure

- **v3 Idempotency Ledger** — Event-sourced journal + snapshot + lock file. Concurrent `apply` calls get single-writer admission; duplicate writes are detected and skipped before reaching the exchange.
- **Route-proof minimality** — `mesh.route-proof` records which steps executed, which were `skipped_satisfied`, whether the route is minimally sufficient, and which skills are safe resume points.
- **Executable certification** — `skills certify --strict` runs fixture-backed proof routes for portable skills, not just static manifest checks. Outputs `proofPassed`, `proofMode`, and `rerunCommand`.
- **Structured goal intake** — Canonical `goal.intake` artifact normalizes symbols, drawdown targets, intent, and horizon once. Every downstream skill references the same interpretation.
- **Portable bundle rerun** — `skills run --bundle <file>` seeds execution from an exported bundle. Manifest drift is detected automatically; blocked unless `--allow-contract-drift` is explicit.
- **Reconcile convergence** — Bounded retry loop (`--until-settled --max-attempts N`) with per-attempt evidence, windowed matching, and multi-source fallback.

## Demo

```bash
# One-command demo (dry-run path)
pnpm demo:flow

# With execution + verification
pnpm demo:flow -- --execute --approved-by alice
```

`pnpm demo:flow` runs: `doctor --strict` → `skills certify --strict` → `plan` → `apply` (dry-run) → `export` → `replay --bundle`

With `--execute`, it switches to: `doctor --probe active --strict` → `apply --execute --verify-receipt` → `export` → `replay --bundle`

<details>
<summary>Step-by-step commands</summary>

```bash
trademesh doctor --probe active --plane demo --strict --strict-target apply
trademesh skills graph
trademesh skills certify --strict
trademesh plan "hedge my BTC drawdown with demo first" --plane demo --symbol BTC --max-drawdown 4 --intent protect-downside --horizon swing
trademesh apply <run-id> --plane demo --proposal protective-put --approve --approved-by alice --execute --verify-receipt
trademesh replay <run-id>
trademesh export <run-id>
trademesh replay --bundle .trademesh/exports/<run-id>/bundle.json
```

</details>

## Documentation

| Document | Description |
|----------|-------------|
| [Product Introduction (中文)](./PROJECT-INTRODUCTION.zh-CN.md) | Full product walkthrough: positioning, architecture, safety model, user value |
| [Operations Runbook](./docs/RUNBOOK-M2.5.md) | Supervised operations: doctor loop, live guard, ledger recovery, proof rerun |
| [Trading Methodology](./docs/METHODOLOGY.md) | Knowledge layer: methodology, rules, book distillations |
| [Progress & Roadmap](./PROGRESS.md) | Implementation status, data model, validation coverage, next milestones |

## License

MIT
