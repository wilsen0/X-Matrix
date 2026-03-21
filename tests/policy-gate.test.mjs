import assert from "node:assert/strict";
import test from "node:test";
import { putArtifact } from "../dist/runtime/artifacts.js";
import run from "../dist/skills/policy-gate/run.js";
import { buildReferencePayloads, createContext } from "./test-helpers.mjs";

test("policy-gate validates proposal/account snapshot and returns guardrail output", async () => {
  const payloads = await buildReferencePayloads();
  const sharedState = {
    proposals: [
      {
        name: "directional-net-hedge",
        reason: "test proposal",
        requiredModules: ["account", "market", "swap"],
        orderPlan: [
          {
            kind: "swap-place-order",
            purpose: "test hedge leg",
            symbol: "BTC",
            targetNotionalUsd: 200,
            referencePx: 70_000,
            params: {
              instId: "BTC-USDT-SWAP",
              tdMode: "cross",
              side: "sell",
              ordType: "limit",
              sz: "0.002",
              px: "69950",
            },
          },
        ],
      },
    ],
    hedgePlannerRanked: ["directional-net-hedge"],
    accountSnapshot: {
      source: "okx-cli",
      balance: payloads.accountBalance,
      positions: payloads.accountPositions,
    },
  };

  const context = createContext({
    skill: "policy-gate",
    stage: "guardrail",
    sharedState,
  });
  putArtifact(context.artifacts, {
    key: "planning.proposals",
    version: 2,
    producer: "hedge-planner",
    data: sharedState.proposals,
  });
  putArtifact(context.artifacts, {
    key: "portfolio.snapshot",
    version: 2,
    producer: "portfolio-xray",
    data: {
      source: "okx-cli",
      symbols: ["BTC"],
      drawdownTarget: "4%",
      balance: payloads.accountBalance,
      positions: payloads.accountPositions,
      accountEquity: 100_000,
      availableUsd: 20_000,
      commands: [],
      errors: [],
    },
  });
  putArtifact(context.artifacts, {
    key: "trade.thesis",
    version: 2,
    producer: "trade-thesis",
    data: {
      directionalRegime: "sideways",
      volState: "normal",
      tailRiskState: "normal",
      hedgeBias: "perp",
      conviction: 50,
      riskBudget: {
        maxSingleOrderUsd: 5_000,
        maxPremiumSpendUsd: 500,
        maxMarginUseUsd: 2_000,
        maxCorrelationBucketPct: 45,
        maxTotalExposureUsd: 90_000,
      },
      disciplineState: "normal",
      preferredStrategies: ["directional-net-hedge"],
      decisionNotes: ["test thesis"],
      ruleRefs: [],
      doctrineRefs: [],
    },
  });

  const output = await run(context);

  assert.equal(output.skill, "policy-gate");
  assert.equal(output.stage, "guardrail");
  assert.equal(output.handoff, "official-executor");
  assert.ok(output.facts.some((fact) => fact.includes("Selected proposal")));
  assert.ok(output.proposal[0].executionReadiness);
  assert.equal(output.proposal[0].actionable, true);
  assert.ok(Array.isArray(output.permissions.allowedModules));
});
