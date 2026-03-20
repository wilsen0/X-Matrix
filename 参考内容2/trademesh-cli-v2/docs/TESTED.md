# Tested in container

Commands exercised:

```bash
npm run build
npm run doctor
npm run plan
node --loader ts-node/esm src/index.ts apply run_20260319163134 --proposal protective-put --approve --json
node --loader ts-node/esm src/index.ts apply run_20260319163203 --proposal protective-put --json
```

Observed behaviors:

- build succeeded
- `doctor` detected missing local `okx` binary and missing `~/.okx/config.toml`
- demo plan produced 3 hedge proposals
- demo apply with `--approve` executed as dry-run and persisted results
- live apply without `--approve` was blocked by policy gate
