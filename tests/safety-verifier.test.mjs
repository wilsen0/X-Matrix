import assert from "node:assert/strict";
import test from "node:test";
import {
  checkApprovalPath,
  checkCapabilitySatisfiability,
  checkCompleteness,
  checkCycleFreedom,
  checkSingleWriter,
  checkWritePathGuardrail,
  verifySafetyInvariants,
} from "../dist/runtime/safety-verifier.js";

function roleForStage(stage) {
  if (stage === "sensor") {
    return "sensor";
  }
  if (stage === "planner") {
    return "planner";
  }
  if (stage === "guardrail") {
    return "guardrail";
  }
  if (stage === "executor") {
    return "executor";
  }
  return "memory";
}

function manifest({
  name,
  stage = "sensor",
  writes = false,
  consumes = [],
  produces = [],
  requiredCapabilities = [],
}) {
  return {
    name,
    description: `${name} manifest`,
    stage,
    role: roleForStage(stage),
    requires: [],
    riskLevel: "low",
    writes,
    alwaysOn: false,
    triggers: [],
    entrypoint: "./run.js",
    path: `skills/${name}`,
    consumes,
    produces,
    preferredHandoffs: [],
    repeatable: false,
    artifactVersion: 3,
    standaloneCommand: `trademesh skills run ${name} "<goal>"`,
    standaloneRoute: [name],
    standaloneInputs: ["goal"],
    standaloneOutputs: produces.length > 0 ? [produces[0]] : [],
    requiredCapabilities,
    contractVersion: 1,
    safetyClass: writes ? "write" : "read",
    determinism: "high",
    proofClass: "structural",
    proofGoal: undefined,
    proofFixture: undefined,
    proofTargetOutputs: [],
  };
}

test("safe workflow passes all safety invariants", () => {
  const manifests = [
    manifest({ name: "intake-sensor", stage: "sensor", produces: ["goal.intake"] }),
    manifest({
      name: "thesis-planner",
      stage: "planner",
      consumes: ["goal.intake"],
      produces: ["trade.thesis"],
    }),
    manifest({
      name: "policy-guardrail",
      stage: "guardrail",
      consumes: ["trade.thesis"],
      produces: ["policy.plan-decision"],
    }),
    manifest({
      name: "approval-gate",
      stage: "guardrail",
      consumes: ["policy.plan-decision"],
      produces: ["approval.ticket"],
    }),
    manifest({
      name: "official-executor",
      stage: "executor",
      writes: true,
      consumes: ["approval.ticket"],
      produces: ["execution.apply-decision"],
      requiredCapabilities: ["swap-write"],
    }),
  ];

  const verdict = verifySafetyInvariants(manifests, {
    availableCapabilities: ["swap-write"],
  });

  assert.equal(verdict.passed, true);
  assert.equal(verdict.totalViolations, 0);
  assert.equal(verdict.errorCount, 0);
  assert.equal(verdict.warningCount, 0);
  assert.equal(verdict.skillCount, 5);
  assert.equal(verdict.edgeCount, 4);
  assert.equal(verdict.invariants.length, 6);
});

test("write-path guardrail fails when writer has no guardrail ancestor", () => {
  const manifests = [
    manifest({ name: "source", stage: "sensor", produces: ["goal.intake"] }),
    manifest({
      name: "approval-signal",
      stage: "planner",
      consumes: ["goal.intake"],
      produces: ["approval.ticket"],
    }),
    manifest({
      name: "official-executor",
      stage: "executor",
      writes: true,
      consumes: ["approval.ticket"],
      produces: ["execution.apply-decision"],
    }),
  ];

  const invariant = checkWritePathGuardrail(manifests);
  assert.equal(invariant.passed, false);
  assert.equal(invariant.violations.length, 1);
  assert.equal(invariant.violations[0].skill, "official-executor");
  assert.match(invariant.violations[0].message, /no guardrail ancestor/i);
});

test("approval-path fails when writer has no approval ancestor", () => {
  const manifests = [
    manifest({ name: "source", stage: "sensor", produces: ["goal.intake"] }),
    manifest({
      name: "policy-guardrail",
      stage: "guardrail",
      consumes: ["goal.intake"],
      produces: ["policy.plan-decision"],
    }),
    manifest({
      name: "official-executor",
      stage: "executor",
      writes: true,
      consumes: ["policy.plan-decision"],
      produces: ["execution.apply-decision"],
    }),
  ];

  const invariant = checkApprovalPath(manifests);
  assert.equal(invariant.passed, false);
  assert.equal(invariant.violations.length, 1);
  assert.equal(invariant.violations[0].skill, "official-executor");
  assert.match(invariant.violations[0].message, /no approval ancestor/i);
});

test("cycle-freedom reports exact cycle path", () => {
  const manifests = [
    manifest({
      name: "cycle-a",
      stage: "sensor",
      consumes: ["execution.apply-decision"],
      produces: ["goal.intake"],
    }),
    manifest({
      name: "cycle-b",
      stage: "planner",
      consumes: ["goal.intake"],
      produces: ["trade.thesis"],
    }),
    manifest({
      name: "cycle-c",
      stage: "guardrail",
      consumes: ["trade.thesis"],
      produces: ["execution.apply-decision"],
    }),
  ];

  const invariant = checkCycleFreedom(manifests);
  assert.equal(invariant.passed, false);
  assert.equal(invariant.violations.length, 1);
  assert.match(invariant.violations[0].message, /cycle-a -> cycle-b -> cycle-c -> cycle-a/);
});

test("capability satisfiability fails when required capabilities are unavailable", () => {
  const manifests = [
    manifest({
      name: "market-scan",
      stage: "sensor",
      produces: ["market.snapshot"],
      requiredCapabilities: ["okx-cli", "market-read"],
    }),
  ];

  const invariant = checkCapabilitySatisfiability(manifests, ["okx-cli"]);
  assert.equal(invariant.passed, false);
  assert.equal(invariant.violations.length, 1);
  assert.equal(invariant.violations[0].skill, "market-scan");
  assert.match(invariant.violations[0].message, /market-read/);
});

test("single-writer fails when one artifact has duplicate producers", () => {
  const manifests = [
    manifest({ name: "planner-a", stage: "planner", produces: ["trade.thesis"] }),
    manifest({ name: "planner-b", stage: "planner", produces: ["trade.thesis"] }),
  ];

  const invariant = checkSingleWriter(manifests);
  assert.equal(invariant.passed, false);
  assert.equal(invariant.violations.length, 1);
  assert.match(invariant.violations[0].message, /trade\.thesis/);
  assert.match(invariant.violations[0].message, /planner-a/);
  assert.match(invariant.violations[0].message, /planner-b/);
});

test("completeness fails on dangling consumed artifact", () => {
  const manifests = [
    manifest({
      name: "consumer-only",
      stage: "planner",
      consumes: ["portfolio.snapshot"],
      produces: ["trade.thesis"],
    }),
  ];

  const invariant = checkCompleteness(manifests);
  assert.equal(invariant.passed, false);
  assert.equal(invariant.violations.length, 1);
  assert.equal(invariant.violations[0].skill, "consumer-only");
  assert.match(invariant.violations[0].message, /portfolio\.snapshot/);
});

test("completeness passes when consumed artifact is provided as initial artifact", () => {
  const manifests = [
    manifest({
      name: "consumer-only",
      stage: "planner",
      consumes: ["portfolio.snapshot"],
      produces: ["trade.thesis"],
    }),
  ];

  const invariant = checkCompleteness(manifests, ["portfolio.snapshot"]);
  assert.equal(invariant.passed, true);
  assert.equal(invariant.violations.length, 0);
});

test("empty manifest list returns passing verdict", () => {
  const verdict = verifySafetyInvariants([], {
    availableCapabilities: [],
    initialArtifacts: [],
  });

  assert.equal(verdict.passed, true);
  assert.equal(verdict.skillCount, 0);
  assert.equal(verdict.edgeCount, 0);
  assert.equal(verdict.totalViolations, 0);
  assert.equal(verdict.invariants.length, 6);
});

test("single non-writing skill passes", () => {
  const manifests = [
    manifest({
      name: "simple-sensor",
      stage: "sensor",
      produces: ["goal.intake"],
    }),
  ];

  const verdict = verifySafetyInvariants(manifests);
  assert.equal(verdict.passed, true);
  assert.equal(verdict.totalViolations, 0);
  assert.equal(verdict.edgeCount, 0);
});

test("complex 10-skill workflow passes with connected DAG", () => {
  const manifests = [
    manifest({ name: "intake-sensor", stage: "sensor", produces: ["goal.intake"] }),
    manifest({
      name: "portfolio-sensor",
      stage: "sensor",
      consumes: ["goal.intake"],
      produces: ["portfolio.snapshot"],
    }),
    manifest({
      name: "market-sensor",
      stage: "sensor",
      consumes: ["goal.intake"],
      produces: ["market.regime"],
    }),
    manifest({
      name: "risk-planner",
      stage: "planner",
      consumes: ["portfolio.snapshot"],
      produces: ["portfolio.risk-profile"],
    }),
    manifest({
      name: "thesis-planner",
      stage: "planner",
      consumes: ["portfolio.snapshot", "portfolio.risk-profile", "market.regime"],
      produces: ["trade.thesis"],
    }),
    manifest({
      name: "policy-guardrail",
      stage: "guardrail",
      consumes: ["trade.thesis"],
      produces: ["policy.plan-decision"],
    }),
    manifest({
      name: "approval-gate",
      stage: "guardrail",
      consumes: ["policy.plan-decision"],
      produces: ["approval.ticket"],
    }),
    manifest({
      name: "idempotency-gate",
      stage: "guardrail",
      consumes: ["approval.ticket"],
      produces: ["execution.idempotency-check"],
    }),
    manifest({
      name: "official-executor",
      stage: "executor",
      writes: true,
      consumes: ["execution.idempotency-check"],
      produces: ["execution.apply-decision"],
      requiredCapabilities: ["swap-write", "okx-cli"],
    }),
    manifest({
      name: "receipt-verifier",
      stage: "memory",
      consumes: ["execution.apply-decision"],
      produces: ["operations.receipt-verification"],
    }),
  ];

  const verdict = verifySafetyInvariants(manifests, {
    availableCapabilities: ["swap-write", "okx-cli"],
  });

  assert.equal(verdict.passed, true);
  assert.equal(verdict.totalViolations, 0);
  assert.equal(verdict.skillCount, 10);
  assert.equal(verdict.edgeCount, 11);
});
