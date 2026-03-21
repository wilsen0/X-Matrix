import assert from "node:assert/strict";
import test from "node:test";
import { applyRun, createPlan } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("apply execute requires --approved-by and emits approval ticket when provided", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

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

  await cleanupRunArtifacts(runId);
});
