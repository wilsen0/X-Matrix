import { createCommandIntent } from "../../runtime/okx.js";
import { putArtifact } from "../../runtime/artifacts.js";
import { createHash } from "node:crypto";
import type {
  AgentWalletIdentity,
  ArtifactKey,
  CommandPreviewEntry,
  ExecutionAction,
  OkxCommandIntent,
  OptionOrderPlanStep,
  OptionPlaceOrderParams,
  OrderPlanStep,
  PolicyDecision,
  SkillContext,
  SkillOutput,
  SkillProposal,
  SwapOrderPlanStep,
  SwapPlaceOrderParams,
  TradeThesis,
} from "../../runtime/types.js";

const FALLBACK_SYMBOL = "BTC";

function buildPlaneFlagArgs(plane: SkillContext["plane"]): string[] {
  if (plane === "demo") {
    return ["--profile", "demo", "--json"];
  }

  if (plane === "live") {
    return ["--profile", "live", "--json"];
  }

  return ["--json"];
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function formatPrice(px: number): string {
  if (px >= 10_000) {
    return px.toFixed(1);
  }
  if (px >= 1_000) {
    return px.toFixed(2);
  }
  if (px >= 10) {
    return px.toFixed(3);
  }
  return px.toFixed(4);
}

function buildSwapPlaceOrderCommand(params: SwapPlaceOrderParams, plane: SkillContext["plane"]): string {
  const args = [
    "okx",
    "swap",
    "place-order",
    "--instId",
    params.instId,
    "--tdMode",
    params.tdMode,
    "--side",
    params.side,
    "--ordType",
    params.ordType,
    "--sz",
    params.sz,
  ];

  if (params.px && params.ordType !== "market") {
    args.push("--px", params.px);
  }
  if (params.reduceOnly !== undefined) {
    args.push("--reduceOnly", String(params.reduceOnly));
  }
  if (params.posSide) {
    args.push("--posSide", params.posSide);
  }
  if (params.tpTriggerPx) {
    args.push("--tpTriggerPx", params.tpTriggerPx, "--tpOrdPx", params.tpOrdPx ?? "-1");
  }
  if (params.slTriggerPx) {
    args.push("--slTriggerPx", params.slTriggerPx, "--slOrdPx", params.slOrdPx ?? "-1");
  }
  if (params.tag) {
    args.push("--tag", params.tag);
  }
  if (params.clOrdId) {
    args.push("--clOrdId", params.clOrdId);
  }
  args.push(...buildPlaneFlagArgs(plane));
  return args.join(" ");
}

function buildOptionPlaceOrderCommand(params: OptionPlaceOrderParams, plane: SkillContext["plane"]): string {
  return [
    "okx",
    "option",
    "place-order",
    "--instId",
    params.instId,
    "--side",
    params.side,
    "--sz",
    params.sz,
    "--px",
    params.px,
    ...buildPlaneFlagArgs(plane),
  ].join(" ");
}

function previewEntry(intent: OkxCommandIntent): CommandPreviewEntry {
  return {
    intentId: intent.intentId,
    stepIndex: intent.stepIndex,
    module: intent.module,
    requiresWrite: intent.requiresWrite,
    safeToRetry: intent.safeToRetry,
    clientOrderRef: intent.clientOrderRef,
    reason: intent.reason,
    command: intent.command,
  };
}

function buildReadIntents(
  symbols: string[],
  plane: SkillContext["plane"],
  runId: string,
  proposalName: string,
): OkxCommandIntent[] {
  const flags = buildPlaneFlagArgs(plane).join(" ");
  return [
    createCommandIntent(`okx account balance ${flags}`, {
      intentId: `${runId}:${proposalName}:read-balance`,
      stepIndex: 0,
      safeToRetry: true,
      module: "account",
      requiresWrite: false,
      reason: "Refresh account balance before materializing execution.",
    }),
    createCommandIntent(`okx account positions ${flags}`, {
      intentId: `${runId}:${proposalName}:read-positions`,
      stepIndex: 1,
      safeToRetry: true,
      module: "account",
      requiresWrite: false,
      reason: "Refresh account positions before materializing execution.",
    }),
    ...symbols.map((symbol, index) =>
      createCommandIntent(`okx market ticker ${symbol}-USDT ${flags}`, {
        intentId: `${runId}:${proposalName}:read-ticker:${symbol.toLowerCase()}`,
        stepIndex: index + 2,
        safeToRetry: true,
        module: "market",
        requiresWrite: false,
        reason: `Refresh ${symbol} price before materializing execution.`,
      })),
  ];
}

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

function createClientOrderRef(runId: string, proposalName: string, stepIndex: number): string {
  const fingerprint = createHash("sha256")
    .update(`${runId}|${proposalName}|${stepIndex}`)
    .digest("hex")
    .slice(0, 22);
  return `tm${fingerprint}`;
}

function writeIntentForStep(
  step: OrderPlanStep,
  plane: SkillContext["plane"],
  runId: string,
  proposalName: string,
  stepIndex: number,
): OkxCommandIntent {
  const clientOrderRef = createClientOrderRef(runId, proposalName, stepIndex);
  if (step.kind === "swap-place-order") {
    const params: SwapPlaceOrderParams = {
      ...step.params,
      clOrdId: clientOrderRef,
    };
    return createCommandIntent(buildSwapPlaceOrderCommand(params, plane), {
      intentId: `${runId}:${proposalName}:write:${stepIndex}`,
      stepIndex,
      safeToRetry: false,
      module: "swap",
      requiresWrite: true,
      clientOrderRef,
      reason: step.purpose,
    });
  }

  return createCommandIntent(buildOptionPlaceOrderCommand(step.params, plane), {
    intentId: `${runId}:${proposalName}:write:${stepIndex}`,
    stepIndex,
    safeToRetry: false,
    module: "option",
    requiresWrite: true,
    clientOrderRef,
    reason: step.purpose,
  });
}

function buildActionsFromIntents(
  intents: OkxCommandIntent[],
  walletAddress: string | undefined,
  chain: string | undefined,
): ExecutionAction[] {
  return intents.map((intent) => ({
    actionId: intent.intentId,
    stepIndex: intent.stepIndex,
    kind: intent.module === "swap"
      ? "swap-place-order" as const
      : intent.module === "option"
        ? "option-place-order" as const
        : "cross-chain-transfer" as const,
    module: intent.module,
    requiresWrite: intent.requiresWrite,
    safeToRetry: intent.safeToRetry,
    command: intent.command,
    reason: intent.reason,
    wallet: walletAddress,
    chain: chain,
    clientOrderRef: intent.clientOrderRef,
    integration: "official-skill",
  }));
}

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

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const proposals = context.artifacts.require<SkillProposal[]>("planning.proposals").data;
  const decision = context.artifacts.require<PolicyDecision>("policy.plan-decision").data;
  const thesis = context.artifacts.require<TradeThesis>("trade.thesis").data;

  // Consume wallet identity (optional — falls back gracefully)
  const walletArtifact = context.artifacts.get<AgentWalletIdentity>("identity.agent-wallet")?.data;
  const walletAddress = walletArtifact?.walletAddress;
  const chain = walletArtifact?.chain ?? "xlayer";

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
