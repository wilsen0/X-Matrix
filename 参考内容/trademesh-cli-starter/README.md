# TradeMesh CLI Starter

A CLI-first, skill-centric runtime for OKX Agent Trade Kit hackathon projects.

This starter is intentionally opinionated:
- `okx` CLI is the only execution kernel.
- Each module is a skill under `skills/<name>/SKILL.md`.
- Custom skills analyze, plan, guard, and replay.
- Live writes must pass `policy-gate`.
- Execution intent is translated into `okx ... --json` commands by `official-executor`.

## Why this shape

OKX's current docs position `okx-trade-cli` as the terminal-native entrypoint, with `--json`, `--profile`, and `--demo` as first-class flags. The official `agent-skills` repo defines skills as Markdown files with YAML frontmatter, where `description` is used for routing. This repo mirrors that design for a CLI-native orchestration layer.

## Commands

```bash
npm install
npm run doctor
node --loader ts-node/esm src/index.ts skills list
node --loader ts-node/esm src/index.ts plan "hedge my btc drawdown with demo first"
node --loader ts-node/esm src/index.ts replay <run-id>
```

## Structure

```text
src/
  index.ts                 CLI entry
  runtime/
    types.ts               shared contracts
    registry.ts            skill discovery and frontmatter parsing
    router.ts              deterministic skill chain selection
    planner.ts             sample orchestration logic
    okx.ts                 okx CLI wrapper and command synthesis
    run-store.ts           save/load run traces
skills/
  market-scan/
  portfolio-xray/
  hedge-planner/
  policy-gate/
  official-executor/
  replay/
runs/
```

## Important note

This is a hackathon starter, not a production trading engine. The code generates plans and CLI execution intents. You still need to add real market/account reads, real risk logic, and human approvals before any live execution.
