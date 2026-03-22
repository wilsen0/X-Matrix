import assert from "node:assert/strict";
import test from "node:test";
import { certifySkills } from "../dist/runtime/executor.js";
import { loadSkillRegistry } from "../dist/runtime/registry.js";

test("skills certify runs portable fixture proofs and marks rerunnable skills", async () => {
  const certification = await certifySkills();
  const thesis = certification.report.items.find((item) => item.skill === "trade-thesis");
  const replay = certification.report.items.find((item) => item.skill === "replay");

  assert.ok(thesis);
  assert.equal(thesis.proofClass, "portable");
  assert.equal(thesis.proofPassed, true);
  assert.equal(thesis.proofMode, "fixture-route");
  assert.equal(thesis.rerunnable, true);
  assert.match(thesis.rerunCommand, /--skip-satisfied/);

  assert.ok(replay);
  assert.equal(replay.proofClass, "structural");
  assert.equal(replay.proofMode, "static");
});

test("skills certify reports portable proof fixture failures explicitly", async () => {
  const manifests = await loadSkillRegistry();
  const mutated = manifests.map((manifest) =>
    manifest.name === "trade-thesis"
      ? {
          ...manifest,
          proofFixture: "/tmp/trademesh-missing-proof-fixture.json",
        }
      : manifest
  );

  const certification = await certifySkills(mutated);
  const thesis = certification.report.items.find((item) => item.skill === "trade-thesis");
  assert.ok(thesis);
  assert.equal(thesis.passed, false);
  assert.equal(thesis.proofPassed, false);
  assert.match(thesis.proofFailure, /ENOENT|no such file/i);
});
