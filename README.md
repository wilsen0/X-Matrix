# OKX Skill Mesh

`okx-skill-mesh` is a CLI-first scaffold for a guarded multi-skill trading runtime.

Current scope:

- scans local `skills/*/SKILL.md` files as the runtime registry
- treats `SKILL.md` as the primary contract and local `run.ts` handlers as optional runtime enhancers
- runs a minimal planning chain for risk-reduction workflows
- stores auditable traces in `runs/*.json`
- generates safe execution previews instead of placing live orders

Quick start:

```bash
npm install
npm run build
node dist/bin/trademesh.js doctor
node dist/bin/trademesh.js skills list
node dist/bin/trademesh.js plan "把未来24小时 BTC 下跌 5% 的最大回撤压到 2.5% 内"
node dist/bin/trademesh.js plan "把未来24小时 BTC 下跌 5% 的最大回撤压到 2.5% 内，先给我 demo 方案"
node dist/bin/trademesh.js replay <run-id> --skill portfolio-xray
node dist/bin/trademesh.js apply <run-id> --profile demo --proposal perp-light-hedge
node dist/bin/trademesh.js apply <run-id> --profile demo --approve
node dist/bin/trademesh.js apply <run-id> --profile demo --approve --execute
node dist/bin/trademesh.js retry <run-id>
pnpm test
```

Main commands:

- `trademesh doctor`
- `trademesh skills ls|list`
- `trademesh runs list`
- `trademesh plan "<goal>" [--plane research|demo|live] [--profile demo|live] [--json]`
- `trademesh replay <run-id> [--skill <name>] [--json]`
- `trademesh retry <run-id> [--json]`
- `trademesh apply <run-id> [--plane demo|live] [--profile demo|live] [--proposal <name>] [--approve] [--execute] [--json]`

Behavior notes:

- `plan` defaults to `research` unless the goal text or flags request `demo` or `live`
- `apply` uses the run's current plane unless you override it with `--plane` or `--profile`
- `apply` now records structured `policyDecision` and `executions[]` for every request
- use `--approve` to satisfy approval-required policies and `--execute` to run commands instead of dry-run
- `official-executor` emits structured command intents and execution previews
# Agile-Skill-Orchestration-Engine
