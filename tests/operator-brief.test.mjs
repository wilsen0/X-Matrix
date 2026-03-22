import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyRun,
  createPlan,
  exportRun,
  formatReplay,
  replayRun,
} from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

function toYesNo(value) {
  return value ? "yes" : "no";
}

test("replay and export share the same six-field operator brief", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo first", { plane: "demo" });
    runId = planned.id;

    await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      execute: false,
    });

    const replayed = await replayRun(planned.id);
    const replayText = formatReplay(replayed);
    const exported = await exportRun(planned.id);
    const reportMd = await readFile(exported.reportPath, "utf8");
    const bundle = JSON.parse(await readFile(exported.bundlePath, "utf8"));
    const artifacts = await loadArtifactSnapshot(planned.id);
    const brief = artifacts["report.operator-brief"]?.data;

    assert.ok(brief);
    assert.equal(bundle.operatorBrief.isExecutable, brief.isExecutable);
    assert.equal(bundle.operatorBrief.currentBlocker, brief.currentBlocker);
    assert.equal(bundle.operatorBrief.approvalState, brief.approvalState);
    assert.equal(bundle.operatorBrief.idempotencyState, brief.idempotencyState);
    assert.equal(bundle.operatorBrief.reconciliationState, brief.reconciliationState);
    assert.equal(bundle.operatorBrief.nextSafeAction, brief.nextSafeAction);

    const expectedLines = [
      `isExecutable: ${toYesNo(brief.isExecutable)}`,
      `currentBlocker: ${brief.currentBlocker}`,
      `approvalState: ${brief.approvalState}`,
      `idempotencyState: ${brief.idempotencyState}`,
      `reconciliationState: ${brief.reconciliationState}`,
      `nextSafeAction: ${brief.nextSafeAction}`,
    ];
    for (const line of expectedLines) {
      assert.ok(replayText.includes(line));
      assert.ok(reportMd.includes(line));
    }
  });

  await cleanupRunArtifacts(runId);
});
