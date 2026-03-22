import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyRun, createPlan, reconcileRun, replayRun, rehearseDemo } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

async function withTempHome(configToml, fn) {
  const dir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-proof-home-"));
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = dir;
    if (configToml) {
      const okxDir = join(dir, ".okx");
      await mkdir(okxDir, { recursive: true });
      await writeFile(join(okxDir, "config.toml"), configToml, "utf8");
    }
    return await fn();
  } finally {
    process.env.HOME = previousHome;
    await rm(dir, { recursive: true, force: true });
  }
}

test("plan/apply/replay write mesh.route-proof artifacts", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo first", { plane: "demo" });
    runId = planned.id;

    let artifacts = await loadArtifactSnapshot(planned.id);
    assert.ok(artifacts["mesh.route-proof"]);
    assert.deepEqual(artifacts["mesh.route-proof"].data.targetOutputs, ["planning.proposals", "policy.plan-decision"]);

    await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      approvedBy: "alice",
      execute: false,
    });
    artifacts = await loadArtifactSnapshot(planned.id);
    assert.ok(artifacts["mesh.route-proof"]);
    assert.deepEqual(
      artifacts["mesh.route-proof"].data.targetOutputs,
      ["execution.intent-bundle", "execution.apply-decision", "report.operator-summary"],
    );

    await replayRun(planned.id);
    artifacts = await loadArtifactSnapshot(planned.id);
    assert.ok(artifacts["mesh.route-proof"]);
    assert.deepEqual(artifacts["mesh.route-proof"].data.targetOutputs, ["report.operator-summary"]);
  });

  await cleanupRunArtifacts(runId);
});

test("reconcile and rehearse emit route proofs for operations routes", async () => {
  const payloads = await buildReferencePayloads();
  payloads.tradeOrdersHistory = {
    code: "0",
    data: [
      {
        ordId: "ord-proof-1",
        instId: payloads.optionInstId,
        side: "buy",
        sz: "1",
        cTime: `${Date.now()}`,
      },
    ],
  };
  let planRunId = null;
  let rehearsalRunId = null;

  await withTempHome("[profiles.demo]\napiKey = \"demo\"\n", async () => {
    await withMockOkx(payloads, async () => {
      const planned = await createPlan("hedge my BTC drawdown with demo execute", { plane: "demo" });
      planRunId = planned.id;

      await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });
      await reconcileRun(planned.id, { source: "fallback", windowMin: 120 });
      let artifacts = await loadArtifactSnapshot(planned.id);
      assert.ok(artifacts["mesh.route-proof"]);
      assert.deepEqual(artifacts["mesh.route-proof"].data.route, ["reconcile-engine", "operator-summarizer"]);

      const rehearsal = await rehearseDemo({ execute: false, approve: true });
      rehearsalRunId = rehearsal.id;
      artifacts = await loadArtifactSnapshot(rehearsal.id);
      assert.ok(artifacts["mesh.route-proof"]);
      assert.ok(artifacts["mesh.route-proof"].data.targetOutputs.includes("operations.rehearsal-plan"));
      assert.ok(artifacts["mesh.route-proof"].data.targetOutputs.includes("report.operator-summary"));
    });
  });

  await cleanupRunArtifacts(planRunId);
  await cleanupRunArtifacts(rehearsalRunId);
});
