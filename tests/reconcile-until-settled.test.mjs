import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { applyRun, createPlan, reconcileRun } from "../dist/runtime/executor.js";
import { idempotencyLedgerFilePaths } from "../dist/runtime/idempotency.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

const LEDGER_PATHS = idempotencyLedgerFilePaths();

async function resetLedger() {
  await rm(LEDGER_PATHS.snapshotPath, { force: true });
  await rm(LEDGER_PATHS.journalPath, { force: true });
  await rm(LEDGER_PATHS.lockPath, { force: true });
}

function heavyPositions() {
  return {
    code: "0",
    data: [
      { instId: "BTC-USDT-SWAP", pos: "0.01", markPx: "70000", lever: "3", posSide: "long" },
      { instId: "ETH-USDT-SWAP", pos: "0.2", markPx: "3500", lever: "3", posSide: "long" },
      { instId: "SOL-USDT-SWAP", pos: "5", markPx: "140", lever: "3", posSide: "long" },
      { instId: "XRP-USDT-SWAP", pos: "1400", markPx: "0.5", lever: "3", posSide: "long" },
    ],
  };
}

test("reconcile until-settled exits early once matched", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = heavyPositions();
  payloads.tradeOrdersHistory = {
    code: "0",
    data: [{ ordId: "remote_order_early_match", cTime: String(Date.now()) }],
  };
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";
  let runId = null;

  await resetLedger();
  try {
    await withMockOkx(payloads, async () => {
      const planned = await createPlan("hedge my BTC drawdown with demo execute", { plane: "demo" });
      runId = planned.id;
      await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });

      const reconciled = await reconcileRun(planned.id, {
        source: "fallback",
        windowMin: 5,
        untilSettled: true,
        maxAttempts: 4,
        intervalSec: 0,
      });
      assert.equal(reconciled.executions.at(-1)?.reconciliationState, "matched");

      const artifacts = await loadArtifactSnapshot(planned.id);
      const attempts = artifacts["execution.reconciliation"]?.data?.attempts ?? [];
      assert.equal(artifacts["execution.reconciliation"]?.data?.status, "matched");
      assert.equal(attempts.length, 1);
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
    await cleanupRunArtifacts(runId);
    await resetLedger();
  }
});

test("reconcile until-settled stops at max attempts and keeps next action clear when unresolved", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = heavyPositions();
  payloads.tradeOrdersHistory = {
    code: "0",
    data: [],
  };
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";
  let runId = null;

  await resetLedger();
  try {
    await withMockOkx(payloads, async () => {
      const planned = await createPlan("hedge my BTC drawdown with demo execute", { plane: "demo" });
      runId = planned.id;
      await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });

      const reconciled = await reconcileRun(planned.id, {
        source: "fallback",
        windowMin: 1,
        untilSettled: true,
        maxAttempts: 2,
        intervalSec: 0,
      });
      const state = reconciled.executions.at(-1)?.reconciliationState;
      assert.ok(state === "failed" || state === "ambiguous");
      assert.ok((reconciled.lastSafeAction ?? "").includes("reconcile"));

      const artifacts = await loadArtifactSnapshot(planned.id);
      const report = artifacts["execution.reconciliation"]?.data;
      assert.ok(report);
      assert.equal(report.attempts.length, 2);
      assert.ok(report.status === "failed" || report.status === "ambiguous");
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
    await cleanupRunArtifacts(runId);
    await resetLedger();
  }
});
