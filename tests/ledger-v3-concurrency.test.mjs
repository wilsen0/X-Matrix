import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyRun, createPlan } from "../dist/runtime/executor.js";
import { idempotencyLedgerFilePaths } from "../dist/runtime/idempotency.js";
import { buildReferencePayloads, cleanupRunArtifacts } from "./test-helpers.mjs";

function shellSafeJson(payload) {
  return JSON.stringify(payload).replace(/'/g, `'\"'\"'`);
}

async function withConcurrentMockOkx(payloads, fn) {
  const dir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-concurrency-"));
  const scriptPath = join(dir, "okx");
  const writesPath = join(dir, "write-count.txt");
  await writeFile(writesPath, "0", "utf8");

  const script = `#!/usr/bin/env bash
set -euo pipefail
cmd1="\${1-}"
cmd2="\${2-}"
writes="${writesPath}"
if [[ "$cmd1" == "account" && "$cmd2" == "balance" ]]; then
  echo '${shellSafeJson(payloads.accountBalance)}'
  exit 0
fi
if [[ "$cmd1" == "account" && "$cmd2" == "positions" ]]; then
  echo '${shellSafeJson(payloads.accountPositions)}'
  exit 0
fi
if [[ "$cmd1" == "account" && "$cmd2" == "fee-rates" ]]; then
  echo '${shellSafeJson(payloads.accountFeeRates)}'
  exit 0
fi
if [[ "$cmd1" == "account" && "$cmd2" == "bills" ]]; then
  echo '${shellSafeJson(payloads.accountBills)}'
  exit 0
fi
if [[ "$cmd1" == "market" && "$cmd2" == "ticker" ]]; then
  echo '${shellSafeJson(payloads.marketTicker)}'
  exit 0
fi
if [[ "$cmd1" == "market" && "$cmd2" == "candles" ]]; then
  echo '${shellSafeJson(payloads.marketCandles)}'
  exit 0
fi
if [[ "$cmd1" == "market" && "$cmd2" == "funding-rate" ]]; then
  echo '${shellSafeJson(payloads.marketFundingRate)}'
  exit 0
fi
if [[ "$cmd1" == "market" && "$cmd2" == "orderbook" ]]; then
  echo '${shellSafeJson(payloads.marketOrderbook)}'
  exit 0
fi
if [[ "$cmd1" == "swap" && "$cmd2" == "place-order" ]]; then
  current="$(cat "$writes" || echo 0)"
  next=$((current + 1))
  echo "$next" > "$writes"
  echo '${shellSafeJson(payloads.swapPlaceOrder)}'
  exit 0
fi
if [[ "$cmd1" == "option" && "$cmd2" == "place-order" ]]; then
  current="$(cat "$writes" || echo 0)"
  next=$((current + 1))
  echo "$next" > "$writes"
  echo '${shellSafeJson(payloads.optionPlaceOrder)}'
  exit 0
fi
if [[ "$cmd1" == "trade" && "$cmd2" == "orders-history" ]]; then
  echo '{"code":"0","data":[]}'
  exit 0
fi
echo '{"code":"0","data":[]}'
`;

  await writeFile(scriptPath, script, { mode: 0o755 });

  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${dir}:${previousPath}`;
  try {
    return await fn(writesPath);
  } finally {
    process.env.PATH = previousPath;
    await rm(dir, { recursive: true, force: true });
  }
}

test("concurrent apply --execute only submits one write intent for identical fingerprint", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = {
    code: "0",
    data: [
      { instId: "BTC-USDT-SWAP", pos: "0.01", markPx: "70000", lever: "3", posSide: "long" },
      { instId: "ETH-USDT-SWAP", pos: "0.2", markPx: "3500", lever: "3", posSide: "long" },
      { instId: "SOL-USDT-SWAP", pos: "5", markPx: "140", lever: "3", posSide: "long" },
      { instId: "XRP-USDT-SWAP", pos: "1400", markPx: "0.5", lever: "3", posSide: "long" },
    ],
  };

  const ledgerPaths = idempotencyLedgerFilePaths();
  await rm(ledgerPaths.snapshotPath, { force: true });
  await rm(ledgerPaths.journalPath, { force: true });
  await rm(ledgerPaths.lockPath, { force: true });
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";

  let runId = null;
  try {
    await withConcurrentMockOkx(payloads, async (writesPath) => {
      const planned = await createPlan("hedge my BTC drawdown with demo execute", { plane: "demo" });
      runId = planned.id;

      const [left, right] = await Promise.allSettled([
        applyRun(planned.id, {
          plane: "demo",
          approve: true,
          approvedBy: "alice",
          execute: true,
        }),
        applyRun(planned.id, {
          plane: "demo",
          approve: true,
          approvedBy: "alice",
          execute: true,
        }),
      ]);

      assert.equal(left.status, "fulfilled");
      assert.equal(right.status, "fulfilled");
      const statuses = [left.value.status, right.value.status];
      assert.ok(statuses.includes("executed") || statuses.includes("blocked"));

      const writeCount = Number((await readFile(writesPath, "utf8")).trim());
      assert.equal(writeCount, 1);
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
  }

  await cleanupRunArtifacts(runId);
  await rm(ledgerPaths.snapshotPath, { force: true });
  await rm(ledgerPaths.journalPath, { force: true });
  await rm(ledgerPaths.lockPath, { force: true });
});
