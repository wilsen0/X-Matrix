import assert from "node:assert/strict";
import test from "node:test";
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

  const output = await run(
    createContext({
      skill: "policy-gate",
      stage: "guardrail",
      sharedState,
    }),
  );

  assert.equal(output.skill, "policy-gate");
  assert.equal(output.stage, "guardrail");
  assert.equal(output.handoff, "official-executor");
  assert.ok(output.facts.some((fact) => fact.includes("Selected proposal")));
  assert.ok(Array.isArray(output.permissions.allowedModules));
});
