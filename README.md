# Skills Mesh

[English](./README.md) | [中文详细版](./README.zh-CN.md)

> **A proof-carrying reusable skill mesh for agentic onchain workflows on X Layer.**
> Install skills like plugins, auto-compose them through artifact dependencies, route execution through Agentic Wallet, and verify every decision with replayable route proofs.

[![Version](https://img.shields.io/badge/version-3.9.0-blue)]()
[![Tests](https://img.shields.io/badge/tests-158%20passing-brightgreen)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22-green)]()
[![TypeScript](https://img.shields.io/badge/lang-TypeScript%205.9-blue)]()

**Skills Mesh** is a modular, proof-carrying skill runtime for building verifiable onchain agent workflows. Each skill is a self-contained directory with a typed artifact contract. The runtime auto-discovers installed skills, compiles their dependency graph into parallel execution plans, statically verifies safety invariants before execution, and generates cryptographic Merkle DAG integrity chains — making every workflow replayable, auditable, and exportable.

For Build X Season 2, the flagship path is an **X Layer onchain execution workflow**: analysis and planning skills produce typed artifacts, `agent-wallet` binds execution to an Agentic Wallet identity, and `official-executor` routes eligible X Layer swap actions through **Onchain OS / DEX execution** while preserving the project’s single-write-path safety model.

This is not a one-off trading script. It is a **reusable skill product** — the same runtime can power hedge flows today and other wallet-aware onchain workflows tomorrow by installing different skill packs.

**Why this is interesting:**

- **X Layer native execution target.** `agent-wallet` resolves wallet identity; `official-executor` enriches every action with wallet, chain (`xlayer`), and integration metadata for onchain routing.
- **Agentic Wallet bound workflows.** Execution is wallet-aware, not just user-aware. Skills consume `identity.agent-wallet` so artifacts carry the chain identity that will actually execute.
- **Onchain OS execution path.** Eligible X Layer swap writes can route through `onchainos swap execute`, while other paths keep the existing OKX-oriented execution model intact.
- **Proof-carrying execution.** Every run produces `mesh.route-proof` — machine-verifiable evidence of what executed, what was skipped, and why the route is minimally sufficient. Export as portable `bundle.json` and replay anywhere.
- **Structural safety.** Single write path (`official-executor`), static safety invariant verification, approval gates, idempotency ledger, and progressive trust (`research` → `demo` → `live`).
- **Reusable skill product.** The onchain workflow is composed from installable skills and typed artifacts, not hardcoded orchestration scripts.

For the detailed Chinese version, see [中文详细版](./README.zh-CN.md).
For the fastest first successful run, see [docs/QUICKSTART.md](./docs/QUICKSTART.md).
For real product scenarios, see [docs/USE-CASES.md](./docs/USE-CASES.md).
For supervised operations procedures, see [docs/RUNBOOK-M2.5.md](./docs/RUNBOOK-M2.5.md).

## Architecture

![Architecture](./docs/architecture.jpg)

```
┌─────────────────────────────────────────────────────────┐
│                      Skill Packs                        │
│                                                         │
│  Sensors            Planners           Guardrails       │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │portfolio-xray│  │trade-thesis   │  │policy-gate   │ │
│  │market-scan   │  │hedge-planner  │  │approval-gate │ │
│  │agent-wallet  │  │scenario-sim   │  │live-guard    │ │
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
│             OKX Agent Trade Kit + X Layer                │
│  okx CLI · market · trade · portfolio · bot             │
│  (deterministic execution kernel — sole order path)     │
│  agent-wallet identity · xlayer chain routing            │
└─────────────────────────────────────────────────────────┘
```

**Three layers, strict boundaries:**

- **Skill Packs** — Each skill is a self-contained directory. Install one for a single capability; install several and they auto-compose through artifact dependencies. The system's capability surface is defined by what's currently installed, not by hardcoded config.
- **Skill Runtime** — The orchestration and trust layer. Compiles skill dependency graphs into parallel execution plans, statically verifies safety invariants before execution, and builds Merkle DAG integrity chains for cryptographic auditability. Also handles discovery, policy enforcement, tracing, and route proofs. No trading logic lives here.
- **Execution Kernel** — OKX Agent Trade Kit is the only way orders reach the exchange. The `agent-wallet` skill resolves wallet identity; `official-executor` enriches every action with wallet, chain, and integration metadata for X Layer on-chain routing. Local signing, permission-aware, demo/live isolation.

## What Makes It Different

- **Install like any skill** — Each skill is a directory with a `SKILL.md` manifest. Drop it in, the runtime auto-discovers it. Remove it, the system adjusts. No config changes, no code changes, no orchestration scripts.
- **Standalone or composed** — Every skill works independently. Install just `market-scan` for market analysis, or just `portfolio-xray` for position diagnostics. When multiple skills are present, the runtime resolves artifact dependencies and auto-composes them into workflows.
- **Wallet-aware execution** — `agent-wallet` resolves wallet identity from runtime input, environment, or demo fallback. Every execution intent is enriched with wallet address, chain (`xlayer`), and provenance metadata — making onchain routing a first-class concern, not an afterthought.
- **Trust through write isolation** — `official-executor` is the only module that can place orders. Custom skills read, analyze, plan — they never touch assets directly. That separation is what makes deployment and reuse safe.
- **Proof-carrying mesh** — Every run generates `mesh.route-proof`: machine-verifiable evidence of what executed, what was skipped, and why the route is minimally sufficient. Reuse risk becomes an inspectable object, not a black box.
- **Portable verified bundles** — Export a run as a self-contained `bundle.json` with artifact snapshots, manifest proofs, and route evidence. Replay anywhere without local state.
- **Progressive trust** — `research` → `demo` → `live`, each with independent safety gates, approval flows, and execution caps.

## Quick Start

If you only want the fastest path to first value, use this mental model:

> `doctor -> plan -> apply -> export -> replay`

```bash
npm install && npm run build

# Health check (includes wallet, xlayer-chain, official-skill probes)
trademesh doctor --probe active --plane demo --strict --strict-target apply

# Create a plan from a normal goal
trademesh plan "protect BTC downside with 4% max drawdown" --plane demo

# Apply a swap-style proposal to verify wallet-aware X Layer routing
trademesh apply <run-id> --plane demo --proposal perp-short --approve --approved-by demo-operator

# Export and replay the result
trademesh export <run-id>
trademesh replay --bundle .trademesh/exports/<run-id>/bundle.json
```

For a step-by-step first run, see [docs/QUICKSTART.md](./docs/QUICKSTART.md).
For product-oriented scenarios, see [docs/USE-CASES.md](./docs/USE-CASES.md).

## Core Commands

| Command | Purpose |
|---------|---------|
| `doctor [--probe passive\|active\|write] [--strict]` | Environment readiness with probe receipts, wallet & chain checks |
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

With wallet-aware routing enabled, `agent-wallet` resolves the execution identity and `official-executor` enriches every action with X Layer chain metadata for on-chain routing.

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
- **Wallet-aware routing** — `agent-wallet` skill resolves wallet identity from runtime input, environment variable, or demo/research fallback. `official-executor` consumes `identity.agent-wallet` to enrich execution intents with wallet address, chain (`xlayer`), and provenance metadata.
- **Official skill adapter** — Extracted command-building concern (`runtime/official-skill-adapter.ts`) enables any skill pack to compose OKX CLI commands without importing from the executor skill directly.

## Build X Demo Story

The strongest demo path for this repo is:

1. **Plan** a supervised hedge workflow from a natural-language goal
2. **Apply** a selected proposal on `demo`
3. **Bind** execution to an Agentic Wallet through `agent-wallet`
4. **Route** eligible X Layer swap actions through `onchainos`
5. **Replay / export** the full artifact chain with route proof

### Verified today

- `onchainos` installed and authenticated with Agentic Wallet
- Real X Layer swap already executed successfully outside the mesh
- `apply` runtime now executes `agent-wallet` before `official-executor`
- `apply --proposal perp-short` on `demo` now shows:
  - wallet resolved
  - `Integration: onchainos`
  - write path switched to `onchainos swap execute ... --wallet <address>`

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

### X Layer / onchainos verification path

```bash
export SKILLS_MESH_AGENT_WALLET=<your_xlayer_wallet>
trademesh apply <run-id> --plane demo --proposal perp-short --approve --approved-by alice
```

Expected signal in the output:

- `Wallet: <your_xlayer_wallet>`
- `Integration: onchainos`
- swap write command becomes `onchainos swap execute ...`

</details>

## Documentation

| Document | Description |
|----------|-------------|
| [中文详细版](./README.zh-CN.md) | Full product walkthrough: positioning, architecture, safety model, user value |
| [Quickstart](./docs/QUICKSTART.md) | Fastest path to the first useful run: doctor → plan → apply → export → replay |
| [Use Cases](./docs/USE-CASES.md) | Real product scenarios: when to use Skills Mesh again, and why it matters |
| [Build X Demo Script](./docs/BUILDX-DEMO-SCRIPT.md) | 90-second and 3-minute recording script for the submission demo |
| [Build X Submission Checklist](./docs/SUBMISSION-CHECKLIST.md) | Final submission control sheet: repo, proof, video, forms, and anti-footgun checks |
| [Operations Runbook](./docs/RUNBOOK-M2.5.md) | Supervised operations: doctor loop, live guard, ledger recovery, proof rerun |
| [Trading Methodology](./docs/METHODOLOGY.md) | Knowledge layer: methodology, rules, book distillations |
| [Progress & Roadmap](./PROGRESS.md) | Implementation status, data model, validation coverage, next milestones |

## License

MIT
