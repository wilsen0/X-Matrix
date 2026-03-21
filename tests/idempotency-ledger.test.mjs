import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { applyRun, createPlan } from "../dist/runtime/executor.js";
import { idempotencyLedgerFilePaths, loadIdempotencyLedger } from "../dist/runtime/idempotency.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

const LEDGER_PATHS = idempotencyLedgerFilePaths();

test("write intents hit local idempotency ledger on repeated apply execute", async () => {
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
  let runId = null;
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";
  await rm(LEDGER_PATHS.snapshotPath, { force: true });
  await rm(LEDGER_PATHS.journalPath, { force: true });
  await rm(LEDGER_PATHS.lockPath, { force: true });

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
      assert.equal(first.executions.at(-1)?.idempotencyChecked, true);

      const second = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });
      assert.equal(second.status, "executed");
      assert.equal(second.executions.at(-1)?.idempotencyChecked, true);
      const hits = second.executions.at(-1)?.results.filter((result) =>
        result.stderr.includes("skipped(idempotent-hit)")
      ) ?? [];
      assert.ok(hits.length >= 1);

      const rawLedger = await loadIdempotencyLedger();
      assert.equal(rawLedger.version, 3);
      const entries = Object.values(rawLedger.entries);
      assert.ok(entries.length >= 1);
      assert.ok(entries.some((entry) => entry.status === "executed"));
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
  }

  await cleanupRunArtifacts(runId);
  await rm(LEDGER_PATHS.snapshotPath, { force: true });
  await rm(LEDGER_PATHS.journalPath, { force: true });
  await rm(LEDGER_PATHS.lockPath, { force: true });
});
