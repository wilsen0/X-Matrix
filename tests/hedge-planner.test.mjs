import assert from "node:assert/strict";
import test from "node:test";
import run from "../dist/skills/hedge-planner/run.js";
import { buildReferencePayloads, createContext } from "./test-helpers.mjs";

test("hedge-planner emits proposal set with structured intents/order plans", async () => {
  const payloads = await buildReferencePayloads();
  const sharedState = {
    symbols: ["BTC"],
    drawdownTarget: "3%",
    accountSnapshot: {
      source: "okx-cli",
      positions: payloads.accountPositions,
    },
    marketSnapshot: {
      tickers: {
        "BTC-USDT": payloads.marketTicker,
      },
    },
    portfolioRiskProfile: {
      directionalExposure: {
        longUsd: 20_000,
        shortUsd: 2_000,
        netUsd: 18_000,
        dominantSide: "long",
      },
      concentration: {
        grossUsd: 25_000,
        topSymbol: "BTC",
        topSharePct: 70,
        top3: [{ symbol: "BTC", usd: 17_500, sharePct: 70 }],
      },
      leverageHotspots: [{ instId: "BTC-USDT-SWAP", symbol: "BTC", leverage: 6, notionalUsd: 7_000 }],
      feeDrag: { recentFeePaidUsd: 12, recentFeeRows: 3, makerRateBps: 1, takerRateBps: 5 },
    },
  };

  const output = await run(
    createContext({
      skill: "hedge-planner",
      stage: "planner",
      sharedState,
    }),
  );

  assert.equal(output.skill, "hedge-planner");
  assert.equal(output.stage, "planner");
  assert.equal(output.proposal.length, 3);
  assert.ok(output.proposal.every((proposal) => Array.isArray(proposal.intents)));
  assert.ok(output.proposal.every((proposal) => Array.isArray(proposal.orderPlan)));
  assert.ok(Array.isArray(sharedState.proposals));
});
