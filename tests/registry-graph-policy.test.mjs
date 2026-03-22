import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactStore, putArtifact } from "../dist/runtime/artifacts.js";
import { runPlanningGraph } from "../dist/runtime/graph-runtime.js";
import { evaluatePolicy } from "../dist/runtime/policy.js";
import { loadSkillRegistry } from "../dist/runtime/registry.js";

test("registry parses extended skill contract frontmatter", async () => {
  const manifests = await loadSkillRegistry();
  const thesis = manifests.find((manifest) => manifest.name === "trade-thesis");

  assert.ok(thesis);
  assert.equal(thesis.role, "synthesizer");
  assert.deepEqual(thesis.consumes, ["portfolio.snapshot", "portfolio.risk-profile", "market.regime"]);
  assert.deepEqual(thesis.produces, ["trade.thesis"]);
  assert.deepEqual(thesis.preferredHandoffs, ["hedge-planner"]);
  assert.equal(thesis.standaloneCommand.includes("skills run trade-thesis"), true);
  assert.deepEqual(thesis.standaloneRoute, ["portfolio-xray", "market-scan", "trade-thesis"]);
  assert.deepEqual(thesis.standaloneInputs, ["goal"]);
  assert.deepEqual(thesis.standaloneOutputs, ["trade.thesis"]);
  assert.equal(thesis.contractVersion, 1);
  assert.equal(thesis.safetyClass, "read");
  assert.equal(thesis.determinism, "high");
});

test("graph runtime honors artifact dependencies and preferred handoffs", async () => {
  const artifacts = createArtifactStore();
  const sharedState = {};
  const executed = [];
  const manifests = [
    {
      name: "sensor-a",
      description: "",
      stage: "sensor",
      role: "sensor",
      requires: [],
      riskLevel: "low",
      writes: false,
      alwaysOn: true,
      triggers: [],
      consumes: [],
      produces: ["portfolio.snapshot"],
      preferredHandoffs: ["planner-a"],
      repeatable: false,
      artifactVersion: 3,
      standaloneCommand: "trademesh skills run sensor-a \"<goal>\"",
      standaloneRoute: ["sensor-a"],
      standaloneInputs: ["goal"],
      standaloneOutputs: ["portfolio.snapshot"],
      requiredCapabilities: [],
      path: "sensor-a",
    },
    {
      name: "planner-a",
      description: "",
      stage: "planner",
      role: "planner",
      requires: [],
      riskLevel: "low",
      writes: false,
      alwaysOn: true,
      triggers: [],
      consumes: ["portfolio.snapshot"],
      produces: ["trade.thesis"],
      preferredHandoffs: ["guardrail-a"],
      repeatable: false,
      artifactVersion: 3,
      standaloneCommand: "trademesh skills run planner-a \"<goal>\"",
      standaloneRoute: ["sensor-a", "planner-a"],
      standaloneInputs: ["goal"],
      standaloneOutputs: ["trade.thesis"],
      requiredCapabilities: [],
      path: "planner-a",
    },
    {
      name: "guardrail-a",
      description: "",
      stage: "guardrail",
      role: "guardrail",
      requires: [],
      riskLevel: "low",
      writes: false,
      alwaysOn: true,
      triggers: [],
      consumes: ["trade.thesis"],
      produces: ["policy.plan-decision"],
      preferredHandoffs: [],
      repeatable: false,
      artifactVersion: 3,
      standaloneCommand: "trademesh skills run guardrail-a \"<goal>\"",
      standaloneRoute: ["sensor-a", "planner-a", "guardrail-a"],
      standaloneInputs: ["goal"],
      standaloneOutputs: ["policy.plan-decision"],
      requiredCapabilities: [],
      path: "guardrail-a",
    },
  ];

  const result = await runPlanningGraph({
    goal: "test goal",
    manifests,
    executeSkill: async (manifest, context) => {
      executed.push(manifest.name);
      if (manifest.name === "sensor-a") {
        putArtifact(context.artifacts, {
          key: "portfolio.snapshot",
          version: 3,
          producer: manifest.name,
          data: { symbols: ["BTC"] },
        });
      }
      if (manifest.name === "planner-a") {
        putArtifact(context.artifacts, {
          key: "trade.thesis",
          version: 3,
          producer: manifest.name,
          data: { hedgeBias: "perp" },
        });
      }
      if (manifest.name === "guardrail-a") {
        putArtifact(context.artifacts, {
          key: "policy.plan-decision",
          version: 3,
          producer: manifest.name,
          data: { outcome: "approved" },
        });
      }
      return {
        skill: manifest.name,
        stage: manifest.stage,
        goal: context.goal,
        summary: manifest.name,
        facts: [],
        constraints: {},
        proposal: [],
        risk: { score: 0, maxLoss: "n/a", needsApproval: false, reasons: [] },
        permissions: { plane: context.plane, officialWriteOnly: true, allowedModules: [] },
        handoff: manifest.preferredHandoffs[0] ?? null,
        timestamp: "2026-03-20T10:00:00.000Z",
      };
    },
    context: {
      runId: "run_graph_test",
      goal: "test goal",
      plane: "demo",
      manifests,
      trace: [],
      artifacts,
      sharedState,
    },
  });

  assert.deepEqual(result.route, ["sensor-a", "planner-a", "guardrail-a"]);
  assert.deepEqual(executed, ["sensor-a", "planner-a", "guardrail-a"]);
});

test("policy evaluator returns the same decision in plan/apply parity when inputs are identical", async () => {
  const artifacts = createArtifactStore();
  putArtifact(artifacts, {
    key: "portfolio.snapshot",
    version: 3,
    producer: "test",
    data: {
      source: "okx-cli",
      symbols: ["BTC"],
      drawdownTarget: "4%",
      balance: { code: "0", data: [{ details: [{ ccy: "USDT", availBal: "20000", usdEq: "20000" }] }] },
      positions: { code: "0", data: [] },
      commands: [],
      errors: [],
      accountEquity: 100_000,
      availableUsd: 20_000,
    },
  });
  putArtifact(artifacts, {
    key: "portfolio.risk-profile",
    version: 3,
    producer: "test",
    data: {
      directionalExposure: { longUsd: 15_000, shortUsd: 0, netUsd: 15_000, dominantSide: "long" },
      concentration: {
        grossUsd: 20_000,
        topSymbol: "BTC",
        topSharePct: 35,
        top3: [{ symbol: "BTC", usd: 7_000, sharePct: 35 }],
      },
      leverageHotspots: [],
      feeDrag: { recentFeePaidUsd: 0, recentFeeRows: 0 },
      correlationBuckets: [{ bucketId: "crypto-beta", symbols: ["BTC"], grossUsd: 7_000, sharePct: 35 }],
    },
  });
  putArtifact(artifacts, {
    key: "market.regime",
    version: 3,
    producer: "test",
    data: {
      symbols: ["BTC"],
      directionalRegime: "uptrend",
      volState: "normal",
      tailRiskState: "normal",
      fundingState: "neutral",
      conviction: 60,
      trendScores: [],
      marketVolatility: 0.03,
      ruleRefs: ["trend-following"],
      doctrineRefs: ["turtle-trend"],
    },
  });
  putArtifact(artifacts, {
    key: "trade.thesis",
    version: 3,
    producer: "test",
    data: {
      directionalRegime: "uptrend",
      volState: "normal",
      tailRiskState: "normal",
      hedgeBias: "perp",
      conviction: 60,
      riskBudget: {
        maxSingleOrderUsd: 5_000,
        maxPremiumSpendUsd: 1_000,
        maxMarginUseUsd: 4_000,
        maxCorrelationBucketPct: 50,
        maxTotalExposureUsd: 80_000,
      },
      disciplineState: "normal",
      preferredStrategies: ["perp-short"],
      decisionNotes: [],
      ruleRefs: ["trend-following"],
      doctrineRefs: ["turtle-trend"],
    },
  });

  const proposal = {
    name: "perp-short",
    strategyId: "perp-short",
    reason: "test proposal",
    requiredModules: ["account", "market", "swap"],
    riskBudgetUse: {
      orderNotionalUsd: 2_000,
      marginUseUsd: 240,
      correlationBucketPct: 35,
    },
    orderPlan: [
      {
        kind: "swap-place-order",
        purpose: "test hedge leg",
        symbol: "BTC",
        targetNotionalUsd: 2_000,
        referencePx: 70_000,
        params: {
          instId: "BTC-USDT-SWAP",
          tdMode: "cross",
          side: "sell",
          ordType: "limit",
          sz: "0.028",
          px: "69950",
        },
      },
    ],
  };

  const planDecision = await evaluatePolicy({
    phase: "plan",
    artifacts,
    proposal,
    plane: "demo",
    approvalProvided: true,
    executeRequested: false,
  });
  const applyDecision = await evaluatePolicy({
    phase: "apply",
    artifacts,
    proposal,
    plane: "demo",
    approvalProvided: true,
    executeRequested: false,
    capabilitySnapshot: {
      okxCliAvailable: true,
      configPath: "profiles",
      configExists: true,
      demoProfileLikelyConfigured: true,
      liveProfileLikelyConfigured: false,
      readinessGrade: "A",
      blockers: [],
      recommendedPlane: "demo",
      warnings: [],
    },
  });

  assert.equal(planDecision.outcome, applyDecision.outcome);
  assert.deepEqual(planDecision.ruleRefs, applyDecision.ruleRefs);
});
