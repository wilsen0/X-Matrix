import { putArtifact } from "../../runtime/artifacts.js";
import {
  buildActionsFromIntents,
  buildReadIntents,
  createClientOrderRef,
  formatPrice,
  previewEntry,
  resolveWalletFromArtifacts,
  toNumber,
  writeIntentForStep,
} from "../../runtime/official-skill-adapter.js";
import type {
  AgentWalletIdentity,
  ArtifactKey,
  ExecutionAction,
  OkxCommandIntent,
  OrderPlanStep,
  PolicyDecision,
  SkillContext,
  SkillOutput,
  SkillProposal,
  SwapOrderPlanStep,
  TradeThesis,
} from "../../runtime/types.js";

const FALLBACK_SYMBOL = "BTC";

// ---------------------------------------------------------------------------
// Risk-budget application (executor-level concern, not adapter)
// ---------------------------------------------------------------------------

function applyRiskBudgetToSwap(step: SwapOrderPlanStep, thesis: TradeThesis): SwapOrderPlanStep {
  const cappedNotional = Math.min(step.targetNotionalUsd, thesis.riskBudget.maxSingleOrderUsd);
  const entryPx = toNumber(step.params.px) ?? step.referencePx;
  const stopPct =
    thesis.disciplineState === "restricted"
      ? 1.8
      : thesis.volState === "stress"
        ? 2.2
        : thesis.volState === "elevated"
          ? 2.8
          : 3.4;
  const tpPct = Math.max(1.2, stopPct * 0.75);
  const slMultiplier = step.params.side === "sell" ? 1 + stopPct / 100 : 1 - stopPct / 100;
  const tpMultiplier = step.params.side === "sell" ? 1 - tpPct / 100 : 1 + tpPct / 100;
  return {
    ...step,
    targetNotionalUsd: cappedNotional,
    params: {
      ...step.params,
      tpTriggerPx: step.params.tpTriggerPx ?? formatPrice(entryPx * tpMultiplier),
      tpOrdPx: step.params.tpOrdPx ?? "-1",
      slTriggerPx: step.params.slTriggerPx ?? formatPrice(entryPx * slMultiplier),
      slOrdPx: step.params.slOrdPx ?? "-1",
    },
  };
}

// ---------------------------------------------------------------------------
// Proposal selection (executor-level concern)
// ---------------------------------------------------------------------------

function selectProposal(
  proposals: SkillProposal[],
  runtimeInput: Record<string, unknown>,
  decision: PolicyDecision,
): SkillProposal {
  const selected = typeof runtimeInput.selectedProposal === "string" ? runtimeInput.selectedProposal : null;
  if (selected) {
    const explicit = proposals.find((proposal) => proposal.name === selected);
    if (explicit) {
      return explicit;
    }
  }

  const fromDecision = proposals.find((proposal) => proposal.name === decision.proposal);
  if (fromDecision) {
    return fromDecision;
  }

  return proposals[0]!;
}

function materializeProposal(proposal: SkillProposal, thesis: TradeThesis): OrderPlanStep[] {
  const plan = proposal.orderPlan ?? [];
  return plan.map((step) => {
    if (step.kind === "swap-place-order") {
      return applyRiskBudgetToSwap(step, thesis);
    }
    return step;
  });
}

// ---------------------------------------------------------------------------
// Counting helpers
// ---------------------------------------------------------------------------

function countByKind(orderPlan: OrderPlanStep[]): { swap: number; option: number } {
  return orderPlan.reduce(
    (acc, step) => {
      if (step.kind === "swap-place-order") {
        acc.swap += 1;
      } else {
        acc.option += 1;
      }
      return acc;
    },
    { swap: 0, option: 0 },
  );
}

function symbolSet(orderPlan: OrderPlanStep[]): string[] {
  const unique = new Set<string>();
  for (const step of orderPlan) {
    unique.add((step.symbol || FALLBACK_SYMBOL).toUpperCase());
  }
  return unique.size > 0 ? [...unique] : [FALLBACK_SYMBOL];
}

// ---------------------------------------------------------------------------
// Main skill entry point
// ---------------------------------------------------------------------------

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const proposals = context.artifacts.require<SkillProposal[]>("planning.proposals").data;
  const decision = context.artifacts.require<PolicyDecision>("policy.plan-decision").data;
  const thesis = context.artifacts.require<TradeThesis>("trade.thesis").data;

  // Consume wallet identity (optional — falls back gracefully)
  const walletArtifact = context.artifacts.get<AgentWalletIdentity>("identity.agent-wallet")?.data;
  const { walletAddress, chain } = resolveWalletFromArtifacts(walletArtifact);

  const proposal = selectProposal(proposals, context.runtimeInput, decision);
  const orderPlan = materializeProposal(proposal, thesis);
  const symbols = symbolSet(orderPlan);
  const readIntents = buildReadIntents(symbols, context.plane, context.runId, proposal.name);
  const writeIntents = orderPlan.map((step, index) =>
    writeIntentForStep(
      step,
      context.plane,
      context.runId,
      proposal.name,
      readIntents.length + index,
    ),
  );
  const intents = [...readIntents, ...writeIntents];
  const preview = intents.map((intent) => previewEntry(intent));
  const counts = countByKind(orderPlan);

  // Build structured ExecutionAction entries
  const actions = buildActionsFromIntents(intents, walletAddress, chain);
  const actionPreview = actions;

  const consumedArtifacts: ArtifactKey[] = ["planning.proposals", "policy.plan-decision", "trade.thesis"];
  if (walletArtifact) {
    consumedArtifacts.push("identity.agent-wallet");
  }

  putArtifact(context.artifacts, {
    key: "execution.intent-bundle",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: {
      proposal: proposal.name,
      orderPlan,
      intents,
      commandPreview: preview,
      actions,
      actionPreview,
      wallet: walletAddress,
      chain,
      integration: "official-skill",
    },
    ruleRefs: proposal.evidence?.ruleRefs ?? thesis.ruleRefs,
    doctrineRefs: proposal.evidence?.doctrineRefs ?? thesis.doctrineRefs,
  });

  const walletFacts = walletAddress
    ? [`Wallet: ${walletAddress} (chain: ${chain}).`]
    : ["No wallet identity resolved."];

  return {
    skill: "official-executor",
    stage: "executor",
    goal: context.goal,
    summary: "Materialize a deterministic OKX CLI preview from the approved proposal, enriched with wallet identity and on-chain routing metadata.",
    facts: [
      `Selected proposal: ${proposal.name}.`,
      `Materialized swap writes: ${counts.swap}.`,
      `Materialized option writes: ${counts.option}.`,
      ...walletFacts,
      `Integration: official-skill (chain: ${chain}).`,
    ],
    constraints: {
      selectedProposal: proposal.name,
      requiredModules: proposal.requiredModules ?? ["account", "market", "swap", "option"],
      swapWriteIntentCount: counts.swap,
      optionWriteIntentCount: counts.option,
      writeIntentCount: counts.swap + counts.option,
      wallet: walletAddress ?? null,
      chain,
      integration: "official-skill",
    },
    proposal: [],
    risk: {
      score: decision.outcome === "approved" ? 0.55 : 0.2,
      maxLoss: "Execution remains bounded by policy and proposal risk budget.",
      needsApproval: decision.outcome !== "approved",
      reasons: decision.reasons,
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: proposal.requiredModules ?? ["account", "market", "swap", "option"],
    },
    handoff: "replay",
    handoffReason: "Execution preview is now audit-ready with wallet routing.",
    producedArtifacts: ["execution.intent-bundle"],
    consumedArtifacts,
    ruleRefs: proposal.evidence?.ruleRefs ?? thesis.ruleRefs,
    doctrineRefs: proposal.evidence?.doctrineRefs ?? thesis.doctrineRefs,
    metadata: {
      selectedProposal: proposal.name,
      intents,
      orderPlan,
      commandPreview: preview,
      actions,
      actionPreview,
      wallet: walletAddress,
      chain,
      integration: "official-skill",
    },
    timestamp: new Date().toISOString(),
  };
}
