import assert from "node:assert/strict";
import test from "node:test";
import { putArtifact } from "../dist/runtime/artifacts.js";
import run from "../dist/skills/official-executor/run.js";
import { buildReferencePayloads, createContext, withMockOkx } from "./test-helpers.mjs";

test("official-executor materializes protective-put option place-order command", async () => {
  const payloads = await buildReferencePayloads();
  await withMockOkx(payloads, async () => {
    const sharedState = {
      proposals: [
        {
          name: "protective-put",
          strategyId: "protective-put",
          reason: "downside hedge",
          requiredModules: ["account", "market", "option"],
          orderPlan: [
            {
              kind: "option-place-order",
              purpose: "Buy downside protection put leg.",
              symbol: "BTC",
              targetPremiumUsd: 220,
              referencePx: 70_000,
              params: {
                instId: payloads.optionInstId,
                side: "buy",
                sz: "1",
                px: "0.05",
              },
              strategy: "protective-put",
              leg: "protective-put",
              riskTags: ["instrument:option"],
            },
          ],
        },
      ],
      policyPlanDecision: {
        outcome: "approved",
        reasons: ["approved for test"],
        proposal: "protective-put",
        plane: "demo",
        executeRequested: false,
        approvalProvided: true,
        evaluatedAt: "2026-03-20T10:00:00.000Z",
        phase: "plan",
      },
      tradeThesis: {
        directionalRegime: "uptrend",
        volState: "elevated",
        tailRiskState: "elevated",
        hedgeBias: "protective-put",
        conviction: 75,
        riskBudget: {
          maxSingleOrderUsd: 5_000,
          maxPremiumSpendUsd: 900,
          maxMarginUseUsd: 3_500,
          maxCorrelationBucketPct: 55,
        },
        disciplineState: "normal",
        preferredStrategies: ["protective-put", "collar", "perp-short"],
        decisionNotes: ["test thesis"],
        ruleRefs: ["trend-following"],
        doctrineRefs: ["vol-hedging"],
      },
    };
    const context = createContext({
      skill: "official-executor",
      stage: "executor",
      sharedState,
      runtimeInput: { selectedProposal: "protective-put" },
    });
    putArtifact(context.artifacts, {
      key: "planning.proposals",
      version: 3,
      producer: "hedge-planner",
      data: sharedState.proposals,
    });
    putArtifact(context.artifacts, {
      key: "policy.plan-decision",
      version: 3,
      producer: "policy-gate",
      data: sharedState.policyPlanDecision,
    });
    putArtifact(context.artifacts, {
      key: "trade.thesis",
      version: 3,
      producer: "trade-thesis",
      data: sharedState.tradeThesis,
    });

    const output = await run(context);

    const preview = Array.isArray(output.metadata?.commandPreview) ? output.metadata.commandPreview : [];
    const optionCommands = preview.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.command === "string" &&
        entry.command.startsWith("okx option place-order"),
    );

    assert.equal(output.skill, "official-executor");
    assert.equal(output.stage, "executor");
    assert.ok(optionCommands.length >= 1);
    assert.ok(optionCommands[0].command.includes("--side buy"));
    assert.ok(optionCommands[0].command.includes("--sz 1"));
    assert.ok(optionCommands[0].command.includes("--px"));
    assert.equal(optionCommands[0].safeToRetry, false);
    assert.equal(output.constraints.optionWriteIntentCount, 1);
  });
});

test("official-executor injects swap --clOrdId from deterministic clientOrderRef", async () => {
  const payloads = await buildReferencePayloads();
  await withMockOkx(payloads, async () => {
    const sharedState = {
      proposals: [
        {
          name: "perp-short",
          strategyId: "perp-short",
          reason: "reduce beta",
          requiredModules: ["account", "market", "swap"],
          orderPlan: [
            {
              kind: "swap-place-order",
              purpose: "Open short hedge leg.",
              symbol: "BTC",
              targetNotionalUsd: 2000,
              referencePx: 70_000,
              params: {
                instId: "BTC-USDT-SWAP",
                tdMode: "cross",
                side: "sell",
                ordType: "limit",
                sz: "0.03",
                px: "69950",
                reduceOnly: false,
              },
              riskTags: ["instrument:swap"],
            },
          ],
        },
      ],
      policyPlanDecision: {
        outcome: "approved",
        reasons: ["approved for test"],
        proposal: "perp-short",
        plane: "demo",
        executeRequested: false,
        approvalProvided: true,
        evaluatedAt: "2026-03-20T10:00:00.000Z",
        phase: "plan",
      },
      tradeThesis: {
        directionalRegime: "uptrend",
        volState: "normal",
        tailRiskState: "normal",
        hedgeBias: "perp",
        conviction: 70,
        riskBudget: {
          maxSingleOrderUsd: 5_000,
          maxPremiumSpendUsd: 500,
          maxMarginUseUsd: 4_000,
          maxCorrelationBucketPct: 55,
        },
        disciplineState: "normal",
        preferredStrategies: ["perp-short"],
        decisionNotes: ["test thesis"],
        ruleRefs: ["trend-following"],
        doctrineRefs: ["discipline"],
      },
    };
    const context = createContext({
      runId: "run_swap_ref",
      skill: "official-executor",
      stage: "executor",
      sharedState,
      runtimeInput: { selectedProposal: "perp-short" },
    });
    putArtifact(context.artifacts, {
      key: "planning.proposals",
      version: 3,
      producer: "hedge-planner",
      data: sharedState.proposals,
    });
    putArtifact(context.artifacts, {
      key: "policy.plan-decision",
      version: 3,
      producer: "policy-gate",
      data: sharedState.policyPlanDecision,
    });
    putArtifact(context.artifacts, {
      key: "trade.thesis",
      version: 3,
      producer: "trade-thesis",
      data: sharedState.tradeThesis,
    });

    const output = await run(context);
    const preview = Array.isArray(output.metadata?.commandPreview) ? output.metadata.commandPreview : [];
    const swap = preview.find((entry) => typeof entry.command === "string" && entry.command.startsWith("okx swap place-order"));

    assert.ok(swap);
    assert.ok(swap.command.includes("--clOrdId"));
    assert.equal(typeof swap.clientOrderRef, "string");
    assert.ok(swap.clientOrderRef.length > 8);
  });
});
