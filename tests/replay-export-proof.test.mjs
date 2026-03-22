import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyRun, createPlan, exportRun, formatReplay, replayRun } from "../dist/runtime/executor.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("replay and export render the same mesh proof conclusion", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo first", { plane: "demo" });
    runId = planned.id;
    await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      approvedBy: "alice",
      execute: false,
    });
    const replayed = await replayRun(planned.id);
    const replayText = formatReplay(replayed);
    const exported = await exportRun(planned.id);
    const bundle = JSON.parse(await readFile(exported.bundlePath, "utf8"));
    const report = await readFile(exported.reportPath, "utf8");

    assert.ok(replayText.includes("Mesh Proof"));
    assert.ok(report.includes("## Mesh Proof"));
    assert.ok(bundle.meshRouteProof);
    assert.equal(bundle.meshRouteProof.proofPassed, true);
    assert.ok(replayText.includes(`proofPassed: ${bundle.meshRouteProof.proofPassed ? "yes" : "no"}`));
    assert.ok(report.includes(`proofPassed: ${bundle.meshRouteProof.proofPassed ? "yes" : "no"}`));
  });

  await cleanupRunArtifacts(runId);
});
