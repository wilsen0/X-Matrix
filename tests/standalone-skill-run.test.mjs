import assert from "node:assert/strict";
import test from "node:test";
import { loadSkillRegistry } from "../dist/runtime/registry.js";
import { createPlan, runSkillStandalone } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("skills run executes standalone routes and produces declared outputs", async () => {
  const payloads = await buildReferencePayloads();
  const manifests = await loadSkillRegistry();
  const runIds = [];
  const targets = [
    "portfolio-xray",
    "market-scan",
    "trade-thesis",
    "hedge-planner",
    "scenario-sim",
    "policy-gate",
    "official-executor",
  ];

  await withMockOkx(payloads, async () => {
    for (const skillName of targets) {
      const manifest = manifests.find((entry) => entry.name === skillName);
      assert.ok(manifest, `missing manifest for ${skillName}`);

      const record = await runSkillStandalone(skillName, "hedge my BTC drawdown with demo first", {
        plane: "demo",
      });
      runIds.push(record.id);

      assert.equal(record.routeKind, "standalone");
      assert.equal(record.entrySkill, skillName);
      assert.equal(record.route.at(-1), skillName);

      const artifacts = await loadArtifactSnapshot(record.id);
      for (const key of manifest.standaloneOutputs) {
        assert.equal(artifacts[key] !== undefined, true, `${skillName} missing standalone output ${key}`);
      }
    }
  });

  for (const runId of runIds) {
    await cleanupRunArtifacts(runId);
  }
});

test("skills run replay can target another run id", async () => {
  const payloads = await buildReferencePayloads();
  let sourceRunId = null;
  let replayRunId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo first", { plane: "demo" });
    sourceRunId = planned.id;
    const replayRecord = await runSkillStandalone("replay", planned.id, { plane: "demo" });
    replayRunId = replayRecord.id;

    assert.equal(replayRecord.routeKind, "standalone");
    assert.equal(replayRecord.entrySkill, "replay");
    assert.ok(replayRecord.trace.some((entry) => entry.skill === "replay"));
    assert.equal(replayRecord.trace.at(-1)?.skill, "mesh-prover");
  });

  await cleanupRunArtifacts(sourceRunId);
  await cleanupRunArtifacts(replayRunId);
});
