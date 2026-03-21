import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyRun, createPlan } from "../dist/runtime/executor.js";
import { buildReferencePayloads, cleanupRunArtifacts } from "./test-helpers.mjs";

function shellSafeJson(payload) {
  return JSON.stringify(payload).replace(/'/g, `'\"'\"'`);
}

async function withRetryAwareMockOkx(payloads, fn) {
  const dir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-retry-"));
  const attemptsPath = join(dir, "option-attempts.txt");
  const scriptPath = join(dir, "okx");
  const script = `#!/usr/bin/env bash
set -euo pipefail
cmd1="\${1-}"
cmd2="\${2-}"
attempts="${attemptsPath}"
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
if [[ "$cmd1" == "option" && "$cmd2" == "place-order" ]]; then
  current="0"
  if [[ -f "$attempts" ]]; then
    current="$(cat "$attempts")"
  fi
  next=$((current + 1))
  echo "$next" > "$attempts"
  echo "network timeout" >&2
  exit 1
fi
echo '{"code":"0","data":[]}'
`;

  await writeFile(scriptPath, script, { mode: 0o755 });
  await writeFile(attemptsPath, "0", "utf8");

  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${dir}:${previousPath}`;
  try {
    return await fn(attemptsPath);
  } finally {
    process.env.PATH = previousPath;
    await rm(dir, { recursive: true, force: true });
  }
}

test("write intents are never auto retried even when the failure looks retryable", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = { code: "0", data: [] };
  payloads.accountBalance = {
    code: "0",
    data: [{ details: [{ ccy: "USDT", availBal: "50000", usdEq: "50000" }] }],
  };

  let runId = null;
  await withRetryAwareMockOkx(payloads, async (attemptsPath) => {
    const planned = await createPlan("hedge my btc drawdown with demo first", { plane: "demo" });
    runId = planned.id;

    const applied = await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      execute: true,
    });
    const attempts = Number((await readFile(attemptsPath, "utf8")).trim());
    const latestExecution = applied.executions.at(-1);
    const failedWrite = latestExecution?.results.find((result) => result.intent.requiresWrite);

    assert.equal(applied.status, "failed");
    assert.equal(attempts, 1);
    assert.ok(failedWrite);
    assert.equal(failedWrite.intent.safeToRetry, false);
    assert.notEqual(failedWrite.errorCategory, undefined);
    assert.notEqual(failedWrite.retryScheduled, true);
  });

  await cleanupRunArtifacts(runId);
});
