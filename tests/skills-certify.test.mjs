import assert from "node:assert/strict";
import test from "node:test";
import { certifySkills } from "../dist/runtime/executor.js";
import { loadSkillRegistry } from "../dist/runtime/registry.js";

test("skills certify includes all installed skills and passes current contracts", async () => {
  const certification = await certifySkills();
  assert.equal(certification.report.totalSkills, 18);
  assert.equal(certification.report.items.length, 18);
  assert.equal(certification.report.failedSkills, 0);
  assert.ok(certification.summary.includes("TradeMesh Skills Certification"));
});

test("skills certify returns explicit failures for invalid manifest contract and route", async () => {
  const manifests = await loadSkillRegistry();
  const mutated = manifests.map((manifest) =>
    manifest.name === "trade-thesis"
      ? {
          ...manifest,
          contractVersion: 2,
          standaloneRoute: ["unknown-skill", "trade-thesis"],
          standaloneOutputs: ["execution.intent-bundle"],
        }
      : manifest
  );

  const certification = await certifySkills(mutated);
  const thesis = certification.report.items.find((item) => item.skill === "trade-thesis");
  assert.ok(thesis);
  assert.equal(thesis.passed, false);
  assert.ok(thesis.failures.some((message) => message.includes("contractVersion must be 1")));
  assert.ok(thesis.failures.some((message) => message.includes("unknown skill")));
  assert.ok(thesis.failures.some((message) => message.includes("standalone output")));
});
