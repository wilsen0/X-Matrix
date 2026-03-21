import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyRun, createPlan, reconcileRun } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

const LEDGER_PATH = join(process.cwd(), ".trademesh", "ledgers", "idempotency.json");

test("reconcile can resolve pending write intents and unblock repeated apply execute", async () => {
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
  payloads.tradeOrdersHistory = {
    code: "0",
    data: [{ ordId: "remote_order_001", side: "sell", sz: "0.05", cTime: String(Date.now()) }],
  };
  let runId = null;
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";
  await rm(LEDGER_PATH, { force: true });

  try {
    await withMockOkx(payloads, async () => {
      const planned = await createPlan("hedge my BTC drawdown with demo execute", { plane: "demo" });
      runId = planned.id;

      const first = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });
      assert.equal(first.status, "executed");

      const ledger = JSON.parse(await readFile(LEDGER_PATH, "utf8"));
      const fingerprints = Object.keys(ledger.entries);
      assert.ok(fingerprints.length >= 1);
      ledger.entries[fingerprints[0]].status = "pending";
      await writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

      const blocked = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });
      assert.equal(blocked.status, "blocked");
      assert.ok(blocked.executions.at(-1)?.blockedReason?.includes("reconcile"));

      const reconciled = await reconcileRun(planned.id);
      assert.equal(reconciled.executions.at(-1)?.reconciliationState, "matched");

      const artifacts = await loadArtifactSnapshot(planned.id);
      assert.equal(artifacts["execution.reconciliation"]?.data?.status, "matched");

      const recovered = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });
      assert.equal(recovered.status, "executed");
      const idempotentHits = recovered.executions.at(-1)?.results.filter((result) =>
        result.stderr.includes("skipped(idempotent-hit)")
      ) ?? [];
      assert.ok(idempotentHits.length >= 1);
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
  }

  await cleanupRunArtifacts(runId);
  await rm(LEDGER_PATH, { force: true });
});
