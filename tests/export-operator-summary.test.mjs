import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyRun, createPlan, exportRun } from "../dist/runtime/executor.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("export emits operator-summary.json and operator-focused fields in bundle", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo execute", { plane: "demo" });
    runId = planned.id;

    await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      approvedBy: "alice",
      execute: false,
    });

    const exported = await exportRun(planned.id);
    assert.equal(typeof exported.operatorSummaryPath, "string");

    const bundle = JSON.parse(await readFile(exported.bundlePath, "utf8"));
    const operatorSummary = JSON.parse(await readFile(exported.operatorSummaryPath, "utf8"));

    assert.ok("approvalTicket" in bundle);
    assert.ok("idempotencySummary" in bundle);
    assert.ok("reconciliationSummary" in bundle);
    assert.ok("operatorSummary" in bundle);
    assert.ok("meshRouteProof" in bundle);
    assert.equal(typeof operatorSummary.isExecutable, "boolean");
    assert.equal(typeof operatorSummary.nextSafeAction, "string");
  });

  await cleanupRunArtifacts(runId);
});
