import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { applyRun, createPlan } from "../dist/runtime/executor.js";
import { idempotencyLedgerFilePaths } from "../dist/runtime/idempotency.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

const LEDGER_PATHS = idempotencyLedgerFilePaths();

test("apply execute requires --approved-by and emits approval ticket when provided", async () => {
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

      const missingApprover = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        execute: true,
      });
      assert.equal(missingApprover.status, "approval_required");
      assert.equal(missingApprover.executions.at(-1)?.approvalTicketId ?? null, null);
      assert.ok(missingApprover.executions.at(-1)?.blockedReason?.includes("--approved-by"));

      const approved = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        approvalReason: "manual_gate",
        execute: true,
      });
      assert.equal(approved.status, "executed");
      assert.equal(typeof approved.executions.at(-1)?.approvalTicketId, "string");

      const artifacts = await loadArtifactSnapshot(planned.id);
      const ticket = artifacts["approval.ticket"]?.data;
      assert.equal(typeof ticket?.ticketId, "string");
      assert.equal(ticket?.approvedBy, "alice");
      assert.equal(ticket?.reason, "manual_gate");
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
