import assert from "node:assert/strict";
import test from "node:test";
import { putArtifact } from "../dist/runtime/artifacts.js";
import run from "../dist/skills/scenario-sim/run.js";
import { createContext } from "./test-helpers.mjs";

test("scenario-sim enriches proposals with the fixed scenario matrix", async () => {
  const sharedState = {
    proposals: [
      {
        name: "protective-put",
        strategyId: "protective-put",
        reason: "test hedge",
        riskBudgetUse: {
          premiumSpendUsd: 300,
          correlationBucketPct: 52,
        },
        requiredModules: ["account", "market", "option"],
      },
    ],
    tradeThesis: {
      directionalRegime: "uptrend",
      volState: "elevated",
      tailRiskState: "elevated",
      hedgeBias: "protective-put",
      conviction: 70,
      riskBudget: {
        maxSingleOrderUsd: 5_000,
        maxPremiumSpendUsd: 900,
        maxMarginUseUsd: 4_000,
        maxCorrelationBucketPct: 60,
      },
      disciplineState: "normal",
      preferredStrategies: ["protective-put"],
      decisionNotes: ["test thesis"],
      ruleRefs: ["trend-following"],
      doctrineRefs: ["vol-hedging"],
    },
    portfolioRiskProfile: {
      directionalExposure: {
        longUsd: 20_000,
        shortUsd: 0,
        netUsd: 20_000,
        dominantSide: "long",
      },
      concentration: {
        grossUsd: 25_000,
        topSymbol: "BTC",
        topSharePct: 52,
        top3: [{ symbol: "BTC", usd: 13_000, sharePct: 52 }],
      },
      leverageHotspots: [],
      feeDrag: { recentFeePaidUsd: 10, recentFeeRows: 2 },
      correlationBuckets: [{ bucketId: "crypto-beta", symbols: ["BTC"], grossUsd: 13_000, sharePct: 52 }],
    },
  };

  const context = createContext({
    skill: "scenario-sim",
    stage: "planner",
    sharedState,
  });
  putArtifact(context.artifacts, {
    key: "planning.proposals",
    version: 3,
    producer: "hedge-planner",
    data: sharedState.proposals,
  });
  putArtifact(context.artifacts, {
    key: "trade.thesis",
    version: 3,
    producer: "trade-thesis",
    data: sharedState.tradeThesis,
  });
  putArtifact(context.artifacts, {
    key: "portfolio.risk-profile",
    version: 3,
    producer: "portfolio-xray",
    data: sharedState.portfolioRiskProfile,
  });

  const output = await run(context);

  assert.equal(output.skill, "scenario-sim");
  assert.equal(output.proposal.length, 1);
  assert.ok(output.proposal[0].scenarioMatrix);
  assert.equal(Object.keys(output.proposal[0].scenarioMatrix).length, 4);
  assert.ok(sharedState.scenarioMatrix);
});
