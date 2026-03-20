# TradeMesh CLI

A CLI-native skill mesh for OKX Agent Trade Kit style workflows.

## What changed in this build

This version moves beyond the starter skeleton and adds:

- runtime environment inspection (`doctor`)
- plane-aware planning (`research`, `demo`, `live`)
- proposal selection + policy gate
- dry-run versus real execution path
- persisted execution history under `runs/*.json`
- richer skill manifests (`writes`, `risk_level`, `triggers`)

## Commands

```bash
node --loader ts-node/esm src/index.ts skills list --json
node --loader ts-node/esm src/index.ts doctor --json
node --loader ts-node/esm src/index.ts plan "hedge my BTC downside with demo first" --plane demo --json
node --loader ts-node/esm src/index.ts apply run_20260319160000 --proposal protective-put --approve --json
node --loader ts-node/esm src/index.ts replay run_20260319160000 --json
```

Add `--execute` to `apply` only after the OKX CLI is installed and configured locally.

## Safety model

- custom skills never place orders directly
- all write intents are routed through `official-executor`
- `research` blocks all writes
- `live` requires `--approve`
- every plan and apply call creates an auditable run record
