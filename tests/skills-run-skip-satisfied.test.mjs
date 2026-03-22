import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { runSkillStandalone } from "../dist/runtime/executor.js";
import { cleanupRunArtifacts } from "./test-helpers.mjs";

test("skills run --skip-satisfied skips satisfied upstream steps and records route proof", async () => {
  const fixturePath = new URL("../skills/trade-thesis/proof/input.artifacts.json", import.meta.url);
  const inputArtifacts = JSON.parse(await readFile(fixturePath, "utf8"));
  let runId = null;

  try {
    const record = await runSkillStandalone("trade-thesis", "portable proof trade thesis", {
      plane: "demo",
      inputArtifacts,
      skipSatisfied: true,
    });
    runId = record.id;

    assert.equal(record.routeKind, "standalone");
    assert.equal(record.entrySkill, "trade-thesis");
    assert.equal(record.trace.at(-1)?.skill, "mesh-prover");

    const artifacts = await loadArtifactSnapshot(record.id);
    const proof = artifacts["mesh.route-proof"]?.data;
    assert.ok(proof);
    assert.equal(proof.routeKind, "standalone");

    const dispositionBySkill = new Map(proof.steps.map((step) => [step.skill, step.disposition]));
    assert.equal(dispositionBySkill.get("portfolio-xray"), "skipped_satisfied");
    assert.equal(dispositionBySkill.get("market-scan"), "skipped_satisfied");
    assert.equal(dispositionBySkill.get("trade-thesis"), "executed");
  } finally {
    await cleanupRunArtifacts(runId);
  }
});
