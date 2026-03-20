import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import run from "../dist/skills/replay/run.js";
import { createContext } from "./test-helpers.mjs";

async function writeReplayFixture(runId) {
  const runDir = join(process.cwd(), ".trademesh", "runs", runId);
  await mkdir(runDir, { recursive: true });
  const trace = [
    {
      skill: "portfolio-xray",
      stage: "sensor",
      goal: "demo goal",
      summary: "portfolio snapshot",
      facts: ["Detected symbols: BTC"],
      constraints: {},
      proposal: [],
      risk: { score: 0.1, maxLoss: "n/a", needsApproval: false, reasons: [] },
      permissions: { plane: "demo", officialWriteOnly: true, allowedModules: ["account"] },
      handoff: "market-scan",
      metadata: {},
      timestamp: "2026-03-20T09:00:00.000Z",
    },
    {
      skill: "hedge-planner",
      stage: "planner",
      goal: "demo goal",
      summary: "planner proposal",
      facts: ["Planner generated proposals"],
      constraints: {},
      proposal: [{ name: "protective-put", reason: "downside hedge" }, { name: "collar", reason: "budget hedge" }],
      risk: { score: 0.2, maxLoss: "n/a", needsApproval: true, reasons: [] },
      permissions: { plane: "demo", officialWriteOnly: true, allowedModules: ["market", "option"] },
      handoff: "policy-gate",
      metadata: {},
      timestamp: "2026-03-20T09:01:00.000Z",
    },
    {
      skill: "policy-gate",
      stage: "guardrail",
      goal: "demo goal",
      summary: "policy decision",
      facts: ["Policy approved demo proposal"],
      constraints: {},
      proposal: [],
      risk: { score: 0.3, maxLoss: "n/a", needsApproval: true, reasons: [] },
      permissions: { plane: "demo", officialWriteOnly: true, allowedModules: ["market", "option"] },
      handoff: "official-executor",
      metadata: { decision: "approved-demo", policyNotes: ["Demo proposal passed dynamic policy checks."] },
      timestamp: "2026-03-20T09:02:00.000Z",
    },
    {
      skill: "official-executor",
      stage: "executor",
      goal: "demo goal",
      summary: "executor materialized commands",
      facts: ["Materialized option writes: 1"],
      constraints: {},
      proposal: [],
      risk: { score: 0.4, maxLoss: "n/a", needsApproval: true, reasons: [] },
      permissions: { plane: "demo", officialWriteOnly: true, allowedModules: ["option"] },
      handoff: "replay",
      metadata: {
        commandPreview: ["okx option place-order --instId BTC-USD-260327-90000-P --side buy --sz 1 --px 0.05 --profile demo --json"],
      },
      timestamp: "2026-03-20T09:03:00.000Z",
    },
  ];

  await writeFile(
    join(runDir, "trace.json"),
    JSON.stringify(
      {
        runId,
        goal: "demo goal",
        plane: "demo",
        status: "executed",
        createdAt: "2026-03-20T09:00:00.000Z",
        updatedAt: "2026-03-20T09:03:00.000Z",
        trace,
        executions: [],
        errors: [],
      },
      null,
      2,
    ),
  );

  await writeFile(
    join(runDir, "artifacts.json"),
    JSON.stringify(
      {
        kind: "trademesh-artifacts",
        version: 2,
        runId,
        savedAt: "2026-03-20T09:02:00.000Z",
        artifacts: {
          "portfolio.snapshot": {
            key: "portfolio.snapshot",
            version: 2,
            producer: "portfolio-xray",
            createdAt: "2026-03-20T09:00:00.000Z",
            data: { symbols: ["BTC"] },
            ruleRefs: [],
            doctrineRefs: [],
          },
          "policy.plan-decision": {
            key: "policy.plan-decision",
            version: 2,
            producer: "policy-gate",
            createdAt: "2026-03-20T09:02:00.000Z",
            data: { outcome: "approved" },
            ruleRefs: ["risk-limits"],
            doctrineRefs: ["discipline"],
          },
        },
      },
      null,
      2,
    ),
  );
}

test("replay summarizes sensor/planner/policy/executor chain from trace.json", async () => {
  const runId = `run_test_replay_${Date.now()}`;
  const runDir = join(process.cwd(), ".trademesh", "runs", runId);
  await writeReplayFixture(runId);
  try {
    const output = await run(
      createContext({
        runId,
        skill: "replay",
        stage: "memory",
        sharedState: {},
      }),
    );

    assert.equal(output.skill, "replay");
    assert.ok(output.facts.some((fact) => fact.startsWith("Replay entries:")));
    assert.ok(output.facts.some((fact) => fact.startsWith("Artifacts captured:")));
    assert.ok(output.facts.some((fact) => fact.startsWith("Policy decisions:")));
    assert.ok(output.facts.some((fact) => fact.startsWith("Executions recorded:")));
    assert.equal(output.constraints.timelineLength, 4);
    assert.ok(Array.isArray(output.metadata?.artifacts));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("replay supports --skill style filtering through sharedState", async () => {
  const runId = `run_test_replay_filter_${Date.now()}`;
  const runDir = join(process.cwd(), ".trademesh", "runs", runId);
  await writeReplayFixture(runId);
  try {
    const output = await run(
      createContext({
        runId,
        skill: "replay",
        stage: "memory",
        runtimeInput: { skillFilter: "portfolio-xray" },
      }),
    );

    assert.equal(output.constraints.skillFilter, "portfolio-xray");
    assert.equal(output.constraints.timelineLength, 1);
    assert.ok(output.facts.some((fact) => fact.includes("skill filter: portfolio-xray")));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
