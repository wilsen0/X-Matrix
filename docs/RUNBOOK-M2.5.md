# TradeMesh M2.7 Runbook

This runbook covers supervised execution operations for `v3` runtime and artifacts with M2.7 proof-carrying mesh hardening.

## 1. Pre-Apply Execute Checklist

1. Verify runtime health:
   - `node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply`
2. Verify candidate run:
   - `node dist/bin/trademesh.js replay <run-id>`
3. Verify mesh contract integrity (once per release or deployment):
   - `node dist/bin/trademesh.js skills certify --strict`
4. Verify selected proposal is actionable and policy approved.
5. Execute with explicit approval:
   - `node dist/bin/trademesh.js apply <run-id> --plane demo --proposal <name> --approve --approved-by <operator> --execute`
6. If blocked by idempotency/reconcile, do not rerun execute directly.

## 2. Live Supervised Execute Checklist

1. Active live probe must be fresh (<= 15 min):
   - `node dist/bin/trademesh.js doctor --probe active --plane live --strict --strict-target execute`
2. Execute with all required live flags:
   - `node dist/bin/trademesh.js apply <run-id> --plane live --proposal <name> --approve --approved-by <operator> --live-confirm YES_LIVE_EXECUTION --max-order-usd <n> --max-total-usd <n> --execute`
3. If `operations.live-guard` is `blocked`, follow `nextAction` and retry only after remediation.

## 3. Reconcile Procedure

Use reconcile when latest apply execute reports `pending`/`ambiguous` or operator summary requires reconcile.

1. Auto mode (client-id first, then fallback):
   - `node dist/bin/trademesh.js reconcile <run-id> --source auto --window-min 120`
2. Auto settle loop (recommended for routine ops):
   - `node dist/bin/trademesh.js reconcile <run-id> --source auto --window-min 120 --until-settled --max-attempts 3 --interval-sec 5`
3. Force client-id mode:
   - `node dist/bin/trademesh.js reconcile <run-id> --source client-id`
4. Force fallback mode:
   - `node dist/bin/trademesh.js reconcile <run-id> --source fallback --window-min 60`
5. Re-check operator state:
   - `node dist/bin/trademesh.js replay <run-id>`
6. Export evidence pack:
   - `node dist/bin/trademesh.js export <run-id>`

`--until-settled` only converges state. It does not auto-replay write intents.

## 4. Proof-Carrying Resume Flow

Use this when a route already has enough artifacts and you want to resume or prove a skill path instead of re-running the whole chain.

1. Inspect the current proof layer:
   - `node dist/bin/trademesh.js replay <run-id>`
2. Read the `Mesh Proof` section:
   - check `resumePoints`
   - check top rerun commands
3. Rerun from a safe skill boundary:
   - `node dist/bin/trademesh.js skills run <skill> "<goal>" --plane demo --input .trademesh/runs/<run-id>/artifacts.json --skip-satisfied`
4. Re-export if needed:
   - `node dist/bin/trademesh.js export <run-id>`

## 5. Idempotency Ledger Files

- `.trademesh/ledgers/idempotency.v3.snapshot.json`
- `.trademesh/ledgers/idempotency.v3.journal.jsonl`
- `.trademesh/ledgers/idempotency.v3.lock`

## 6. Lock Handling and Recovery

The runtime acquires lock with `O_EXCL`, retries 5 times, and treats locks older than 120s as stale.

If apply is blocked by ledger lock:

1. Ensure no other apply/reconcile process is active.
2. Re-run command once.
3. If lock remains stale and no process is active, remove lock:
   - `rm .trademesh/ledgers/idempotency.v3.lock`
4. Retry apply/reconcile.

## 7. Ledger Corruption Recovery

If ledger files are corrupted or unreadable:

1. Export current evidence first:
   - `node dist/bin/trademesh.js export <run-id>`
2. Backup ledger files:
   - `cp .trademesh/ledgers/idempotency.v3.snapshot.json .trademesh/ledgers/idempotency.v3.snapshot.json.bak`
   - `cp .trademesh/ledgers/idempotency.v3.journal.jsonl .trademesh/ledgers/idempotency.v3.journal.jsonl.bak`
3. Clear lock and rebuild by replaying normal flow:
   - `rm -f .trademesh/ledgers/idempotency.v3.lock`
4. Re-run `reconcile` first, then `apply`.

## 8. Doctor Reason Catalog Use

When `doctor --probe active` fails, use reason catalog fields:

- `reasonCode`: `cli_missing | auth_failed | network_error | timeout | schema_mismatch | rate_limited | unknown`
- `nextActionCmd`: suggested immediate remediation command

Recommended loop:

1. `node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply --json`
2. Read `reasonCatalog.items[*]`
3. Run each `nextActionCmd`
4. Re-run doctor until strict pass

## 9. Hard Cutover Notes

- Runtime only accepts `RunRecord.version = 3`.
- Runtime only accepts artifact envelopes `version = 3`.
- Old v2 runs are rejected by design; recreate plan/apply/replay/export under current runtime.
