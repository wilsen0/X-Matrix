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

## Why this shape

TradeMesh is optimized for operational clarity and operator trust:

- `doctor` shows whether the local mesh is ready to plan, dry-run, or execute on OKX demo
- `skills inspect` and `skills graph` expose the mesh topology from skill manifests
- `plan` produces ranked proposals, actionability labels, and a policy preview
- `apply` keeps dry-run first and routes every write through `official-executor`
- `replay` reconstructs the route, evidence, policy, and execution receipt
- `export` materializes a run report plus a machine-readable evidence bundle

## Quick Start

```bash
npm install
npm run build
node dist/bin/trademesh.js doctor
node dist/bin/trademesh.js skills ls
node dist/bin/trademesh.js skills graph
node dist/bin/trademesh.js plan "hedge my BTC drawdown with demo first" --plane demo --symbol BTC --max-drawdown 4 --intent protect-downside --horizon swing
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal protective-put --approve
node dist/bin/trademesh.js replay <run-id>
node dist/bin/trademesh.js export <run-id>
node dist/bin/trademesh.js demo "hedge my BTC drawdown with demo first" --plane demo
pnpm test
```

## Core Commands

- `trademesh doctor`
- `trademesh demo "<goal>" [--plane research|demo|live] [--execute] [--symbol <CSV>] [--max-drawdown <number>] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--json]`
- `trademesh skills ls|list`
- `trademesh skills inspect <name> [--json]`
- `trademesh skills graph [--json]`
- `trademesh runs list`
- `trademesh plan "<goal>" [--plane research|demo|live] [--profile demo|live] [--symbol <CSV>] [--max-drawdown <number>] [--intent protect-downside|reduce-beta|de-risk] [--horizon intraday|swing|position] [--json]`
- `trademesh apply <run-id> [--plane demo|live] [--profile demo|live] [--proposal <name>] [--approve] [--execute] [--json]`
- `trademesh replay <run-id> [--skill <name>] [--json]`
- `trademesh retry <run-id> [--json]`
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
- `live` still requires `--approve`
- every plan/apply/replay persists an auditable run record
- write intents are never auto-retried; only safe read intents may be retried

## Actionability Model

- every proposal now carries `executionReadiness`, `actionable`, and `capabilityGaps`
- `policy-gate` re-evaluates every ranked proposal, not only the selected one
- the recommended proposal must come from the proposals that are currently actionable for dry-run or better
- `doctor` now separates `plan`, `apply`, and `execute` readiness

## Demo Script

Use this sequence for a live demo:

```bash
node dist/bin/trademesh.js doctor
node dist/bin/trademesh.js skills graph
node dist/bin/trademesh.js plan "hedge my BTC drawdown with demo first" --plane demo --symbol BTC --max-drawdown 4 --intent protect-downside --horizon swing
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal protective-put --approve
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
