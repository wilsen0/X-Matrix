import { createCommandIntent } from "../../runtime/okx.js";
import { putArtifact } from "../../runtime/artifacts.js";
import { artifactReference } from "../../runtime/artifact-schema.js";
import type {
  MarketRegime,
  OptionOrderPlanStep,
  OptionPlaceOrderParams,
  PortfolioRiskProfile,
  SkillContext,
  SkillOutput,
  SkillProposal,
  SwapOrderPlanStep,
  SwapPlaceOrderParams,
  TradeThesis,
} from "../../runtime/types.js";

const DEFAULT_SYMBOL = "BTC";
const FALLBACK_PRICE_BY_SYMBOL: Record<string, number> = {
  BTC: 70_000,
  ETH: 3_500,
  SOL: 150,
};
const STRATEGIES = ["perp-short", "protective-put", "collar", "de-risk"] as const;
type StrategyId = (typeof STRATEGIES)[number];

type JsonRecord = Record<string, unknown>;

function asObject(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return undefined;
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

function buildPlaneFlagArgs(plane: SkillContext["plane"]): string[] {
  if (plane === "demo") {
    return ["--profile", "demo", "--json"];
  }

  if (plane === "live") {
    return ["--profile", "live", "--json"];
  }

  return ["--json"];
}

function sizeStepForSymbol(symbol: string): number {
  if (symbol === "BTC") {
    return 0.001;
  }
  if (symbol === "ETH") {
    return 0.01;
  }
  if (symbol === "SOL") {
    return 0.1;
  }
  return 1;
}

function formatWithStep(value: number, step: number): string {
  const rounded = Math.floor(value / step) * step;
  const decimals = step.toString().includes(".") ? step.toString().split(".")[1].length : 0;
  return rounded.toFixed(decimals);
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

function formatOptionPrice(px: number): string {
  if (px >= 1) {
    return px.toFixed(3);
  }
  return px.toFixed(4);
}

function nextFridayYymmdd(base = new Date()): string {
  const date = new Date(base.getTime());
  const distance = ((5 - date.getUTCDay() + 7) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + distance);
  const year = date.getUTCFullYear().toString().slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeStrike(referencePx: number, multiplier: number): number {
  const target = Math.max(1, referencePx * multiplier);
  const step = target >= 50_000 ? 1_000 : target >= 10_000 ? 500 : target >= 1_000 ? 100 : 10;
  return Math.round(target / step) * step;
}

function readLastPrice(marketSnapshot: unknown, symbol: string): number {
  const snapshot = asObject(marketSnapshot);
  const tickers = asObject(snapshot?.tickers);
  const ticker = asObject(tickers?.[`${symbol}-USDT`]);
  const data = Array.isArray(ticker?.data) ? ticker?.data : [];
  const first = asObject(data[0]);
  return (
    toNumber(first?.last) ??
    toNumber(first?.lastPx) ??
    toNumber(first?.markPx) ??
    FALLBACK_PRICE_BY_SYMBOL[symbol] ??
    1
  );
}

function choosePrimarySymbol(profile: PortfolioRiskProfile): string {
  if (profile.concentration.topSymbol && profile.concentration.topSymbol !== "n/a") {
    return profile.concentration.topSymbol;
  }

  if (profile.leverageHotspots.length > 0) {
    return profile.leverageHotspots[0].symbol;
  }

  if (profile.correlationBuckets.length > 0 && profile.correlationBuckets[0].symbols.length > 0) {
    return profile.correlationBuckets[0].symbols[0] ?? DEFAULT_SYMBOL;
  }

  return DEFAULT_SYMBOL;
}

function buildSwapCommand(params: SwapPlaceOrderParams, plane: SkillContext["plane"]): string {
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
  if (params.tpTriggerPx) {
    args.push("--tpTriggerPx", params.tpTriggerPx, "--tpOrdPx", params.tpOrdPx ?? "-1");
  }
  if (params.slTriggerPx) {
    args.push("--slTriggerPx", params.slTriggerPx, "--slOrdPx", params.slOrdPx ?? "-1");
  }
  if (params.tag) {
    args.push("--tag", params.tag);
  }

  args.push(...buildPlaneFlagArgs(plane));
  return args.join(" ");
}

function buildOptionCommand(params: OptionPlaceOrderParams, plane: SkillContext["plane"]): string {
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

function buildReadIntents(symbol: string, plane: SkillContext["plane"]) {
  const flags = buildPlaneFlagArgs(plane).join(" ");
  return [
    createCommandIntent(`okx account balance ${flags}`, {
      module: "account",
      requiresWrite: false,
      reason: "Refresh balances before hedge execution.",
    }),
    createCommandIntent(`okx account positions ${flags}`, {
      module: "account",
      requiresWrite: false,
      reason: "Refresh positions before hedge execution.",
    }),
    createCommandIntent(`okx market ticker ${symbol}-USDT ${flags}`, {
      module: "market",
      requiresWrite: false,
      reason: `Refresh ${symbol} price before hedge execution.`,
    }),
  ];
}

function makeSwapStep(input: {
  symbol: string;
  side: "buy" | "sell";
  notionalUsd: number;
  referencePx: number;
  reduceOnly?: boolean;
  purpose: string;
  riskTags: string[];
  tag: string;
}): SwapOrderPlanStep | null {
  if (input.notionalUsd <= 0 || input.referencePx <= 0) {
    return null;
  }

  const step = sizeStepForSymbol(input.symbol);
  const size = input.notionalUsd / input.referencePx;
  const formattedSize = formatWithStep(size, step);
  if (Number(formattedSize) <= 0) {
    return null;
  }

  const entryPx =
    input.side === "sell"
      ? input.referencePx * 0.999
      : input.referencePx * 1.001;

  return {
    kind: "swap-place-order",
    purpose: input.purpose,
    symbol: input.symbol,
    targetNotionalUsd: input.notionalUsd,
    referencePx: input.referencePx,
    params: {
      instId: `${input.symbol}-USDT-SWAP`,
      tdMode: "cross",
      side: input.side,
      ordType: "limit",
      sz: formattedSize,
      px: formatPrice(entryPx),
      reduceOnly: input.reduceOnly ?? false,
      tag: input.tag,
    },
    riskTags: input.riskTags,
  };
}

function makeOptionStep(input: {
  symbol: string;
  referencePx: number;
  premiumUsd: number;
  side: "buy" | "sell";
  right: "P" | "C";
  purpose: string;
  strategy: "protective-put" | "collar";
  leg: "protective-put" | "covered-call";
  multiplier: number;
  riskTags: string[];
}): OptionOrderPlanStep {
  const contractPx = Math.max(0.01, input.premiumUsd / Math.max(input.referencePx, 1));
  return {
    kind: "option-place-order",
    purpose: input.purpose,
    symbol: input.symbol,
    targetPremiumUsd: input.premiumUsd,
    referencePx: input.referencePx,
    params: {
      instId: `${input.symbol}-USD-${nextFridayYymmdd()}-${normalizeStrike(input.referencePx, input.multiplier)}-${input.right}`,
      side: input.side,
      sz: "1",
      px: formatOptionPrice(contractPx),
    },
    strategy: input.strategy,
    leg: input.leg,
    riskTags: input.riskTags,
  };
}

function preferredStrategies(thesis: TradeThesis): StrategyId[] {
  const ranked: StrategyId[] = [];
  for (const raw of thesis.preferredStrategies) {
    if (STRATEGIES.includes(raw as StrategyId) && !ranked.includes(raw as StrategyId)) {
      ranked.push(raw as StrategyId);
    }
  }

  const bias = thesis.hedgeBias === "perp"
    ? "perp-short"
    : thesis.hedgeBias === "protective-put"
      ? "protective-put"
      : thesis.hedgeBias === "collar"
        ? "collar"
        : "de-risk";
  if (!ranked.includes(bias)) {
    ranked.unshift(bias);
  }

  for (const candidate of STRATEGIES) {
    if (!ranked.includes(candidate)) {
      ranked.push(candidate);
    }
  }

  return ranked;
}

function buildProposal(
  strategyId: StrategyId,
  context: SkillContext,
  thesis: TradeThesis,
  regime: MarketRegime,
  profile: PortfolioRiskProfile,
  marketSnapshot: unknown,
): SkillProposal {
  const primarySymbol = choosePrimarySymbol(profile);
  const referencePx = readLastPrice(marketSnapshot, primarySymbol);
  const absNetUsd = Math.abs(profile.directionalExposure.netUsd);
  const cappedNotional = Math.min(
    Math.max(absNetUsd, thesis.riskBudget.maxSingleOrderUsd * 0.6),
    thesis.riskBudget.maxSingleOrderUsd,
  );
  const premiumSpendUsd = Math.min(
    Math.max(thesis.riskBudget.maxPremiumSpendUsd * 0.75, 100),
    thesis.riskBudget.maxPremiumSpendUsd,
  );
  const readIntents = buildReadIntents(primarySymbol, context.plane);
  const artifactRefs = [
    artifactReference(context.artifacts.get("trade.thesis"), "trade.thesis", "trade-thesis"),
    artifactReference(context.artifacts.get("portfolio.risk-profile"), "portfolio.risk-profile", "portfolio-xray"),
    artifactReference(context.artifacts.get("market.snapshot"), "market.snapshot", "market-scan"),
  ];
  const baseRiskTags = [
    `strategy:${strategyId}`,
    "strategy-source:trade-thesis",
    `regime:${thesis.directionalRegime}`,
    `vol:${thesis.volState}`,
  ];

  if (strategyId === "perp-short") {
    const side = profile.directionalExposure.netUsd >= 0 ? "sell" : "buy";
    const step = makeSwapStep({
      symbol: primarySymbol,
      side,
      notionalUsd: cappedNotional,
      referencePx,
      purpose: "Offset net directional exposure with a perp hedge.",
      riskTags: [...baseRiskTags, `funding:${regime.fundingState}`],
      tag: "mesh-perp",
    });

    const orderPlan = step ? [step] : [];
    return {
      name: "perp-short",
      strategyId,
      reason: `Use perp hedge because thesis bias=${thesis.hedgeBias} and funding=${regime.fundingState}.`,
      estimatedCost: regime.fundingState === "longs-paying" ? "carry cost elevated" : "carry cost moderate",
      estimatedProtection: `Hedge up to ${cappedNotional.toFixed(0)} USD of net exposure`,
      riskTags: [...baseRiskTags, "instrument:swap"],
      evidence: {
        artifactRefs,
        ruleRefs: thesis.ruleRefs,
        doctrineRefs: thesis.doctrineRefs,
      },
      riskBudgetUse: {
        orderNotionalUsd: cappedNotional,
        marginUseUsd: cappedNotional * 0.12,
        correlationBucketPct: profile.concentration.topSharePct,
      },
      decisionNotes: [...thesis.decisionNotes],
      requiredModules: ["account", "market", "swap"],
      intents: [...readIntents, ...orderPlan.map((item) => createCommandIntent(buildSwapCommand(item.params, context.plane), {
        module: "swap",
        requiresWrite: true,
        reason: item.purpose,
      }))],
      orderPlan,
    };
  }

  if (strategyId === "protective-put") {
    const putLeg = makeOptionStep({
      symbol: primarySymbol,
      referencePx,
      premiumUsd: premiumSpendUsd,
      side: "buy",
      right: "P",
      purpose: "Buy downside convexity for the primary concentration symbol.",
      strategy: "protective-put",
      leg: "protective-put",
      multiplier: 0.95,
      riskTags: [...baseRiskTags, "instrument:option"],
    });
    return {
      name: "protective-put",
      strategyId,
      reason: `Buy convex downside protection because vol=${thesis.volState} and tailRisk=${thesis.tailRiskState}.`,
      estimatedCost: `${premiumSpendUsd.toFixed(0)} USD premium budget`,
      estimatedProtection: `Downside convexity on ${primarySymbol}`,
      riskTags: [...baseRiskTags, "instrument:option"],
      evidence: {
        artifactRefs,
        ruleRefs: thesis.ruleRefs,
        doctrineRefs: thesis.doctrineRefs,
      },
      riskBudgetUse: {
        premiumSpendUsd,
        correlationBucketPct: profile.concentration.topSharePct,
      },
      decisionNotes: [...thesis.decisionNotes],
      requiredModules: ["account", "market", "option"],
      intents: [
        ...readIntents,
        createCommandIntent(buildOptionCommand(putLeg.params, context.plane), {
          module: "option",
          requiresWrite: true,
          reason: putLeg.purpose,
        }),
      ],
      orderPlan: [putLeg],
    };
  }

  if (strategyId === "collar") {
    const putBudget = premiumSpendUsd;
    const callBudget = Math.max(putBudget * 0.6, 80);
    const putLeg = makeOptionStep({
      symbol: primarySymbol,
      referencePx,
      premiumUsd: putBudget,
      side: "buy",
      right: "P",
      purpose: "Buy protective put leg.",
      strategy: "collar",
      leg: "protective-put",
      multiplier: 0.95,
      riskTags: [...baseRiskTags, "instrument:option"],
    });
    const callLeg = makeOptionStep({
      symbol: primarySymbol,
      referencePx,
      premiumUsd: callBudget,
      side: "sell",
      right: "C",
      purpose: "Sell covered-call style financing leg.",
      strategy: "collar",
      leg: "covered-call",
      multiplier: 1.05,
      riskTags: [...baseRiskTags, "instrument:option", "premium-financing"],
    });
    const orderPlan: OptionOrderPlanStep[] = [putLeg, callLeg];
    return {
      name: "collar",
      strategyId,
      reason: `Use collar because premium budget is constrained and tail protection is still required.`,
      estimatedCost: `${Math.max(0, putBudget - callBudget).toFixed(0)} USD net premium`,
      estimatedProtection: `Protected downside with capped upside on ${primarySymbol}`,
      riskTags: [...baseRiskTags, "instrument:option", "premium-financing"],
      evidence: {
        artifactRefs,
        ruleRefs: thesis.ruleRefs,
        doctrineRefs: thesis.doctrineRefs,
      },
      riskBudgetUse: {
        premiumSpendUsd: Math.max(0, putBudget - callBudget),
        correlationBucketPct: profile.concentration.topSharePct,
      },
      decisionNotes: [...thesis.decisionNotes],
      requiredModules: ["account", "market", "option"],
      intents: [
        ...readIntents,
        ...orderPlan.map((item) =>
          createCommandIntent(buildOptionCommand(item.params, context.plane), {
            module: "option",
            requiresWrite: true,
            reason: item.purpose,
          })),
      ],
      orderPlan,
    };
  }

  const hotspot = profile.leverageHotspots[0];
  const reduceSymbol = hotspot?.symbol ?? primarySymbol;
  const reducePrice = readLastPrice(marketSnapshot, reduceSymbol);
  const reduceNotional = Math.min(
    Math.max(hotspot?.notionalUsd ?? cappedNotional * 0.8, 100),
    thesis.riskBudget.maxSingleOrderUsd,
  );
  const reduceStep = makeSwapStep({
    symbol: reduceSymbol,
    side: "sell",
    notionalUsd: reduceNotional,
    referencePx: reducePrice,
    reduceOnly: true,
    purpose: "Reduce gross exposure because thesis recommends de-risking.",
    riskTags: [...baseRiskTags, "reduce-only"],
    tag: "mesh-derisk",
  });
  const orderPlan = reduceStep ? [reduceStep] : [];
  return {
    name: "de-risk",
    strategyId,
    reason: `Reduce leverage because discipline=${thesis.disciplineState} and tailRisk=${thesis.tailRiskState}.`,
    estimatedCost: "Opportunity cost from smaller gross exposure",
    estimatedProtection: `Reduce ${reduceNotional.toFixed(0)} USD gross exposure`,
    riskTags: [...baseRiskTags, "instrument:swap", "reduce-only"],
    evidence: {
      artifactRefs,
      ruleRefs: thesis.ruleRefs,
      doctrineRefs: thesis.doctrineRefs,
    },
    riskBudgetUse: {
      orderNotionalUsd: reduceNotional,
      marginUseUsd: 0,
      correlationBucketPct: hotspot ? profile.concentration.topSharePct : 0,
    },
    decisionNotes: [...thesis.decisionNotes],
    requiredModules: ["account", "market", "swap"],
    intents: [...readIntents, ...orderPlan.map((item) => createCommandIntent(buildSwapCommand(item.params, context.plane), {
      module: "swap",
      requiresWrite: true,
      reason: item.purpose,
    }))],
    orderPlan,
  };
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const thesis = context.artifacts.require<TradeThesis>("trade.thesis").data;
  const profile = context.artifacts.require<PortfolioRiskProfile>("portfolio.risk-profile").data;
  const marketSnapshot = context.artifacts.get("market.snapshot")?.data;
  const regime = context.artifacts.get<MarketRegime>("market.regime")?.data ?? {
    symbols: [],
    directionalRegime: thesis.directionalRegime,
    volState: thesis.volState,
    tailRiskState: thesis.tailRiskState,
    fundingState: "neutral",
    conviction: thesis.conviction,
    trendScores: [],
    marketVolatility: null,
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
  };

  const rankedStrategies = preferredStrategies(thesis);
  const proposals = rankedStrategies.map((strategyId) =>
    buildProposal(strategyId, context, thesis, regime, profile, marketSnapshot),
  );

  putArtifact(context.artifacts, {
    key: "planning.proposals",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: proposals,
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
  });

  const first = proposals[0];
  return {
    skill: "hedge-planner",
    stage: "planner",
    goal: context.goal,
    summary: "Rank hedge proposals from the shared trade thesis instead of raw market heuristics.",
    facts: [
      `Primary strategy: ${first?.strategyId ?? "n/a"}.`,
      `Ranked strategies: ${rankedStrategies.join(" -> ")}.`,
      `Risk budget: single=${thesis.riskBudget.maxSingleOrderUsd.toFixed(0)} premium=${thesis.riskBudget.maxPremiumSpendUsd.toFixed(0)} margin=${thesis.riskBudget.maxMarginUseUsd.toFixed(0)}.`,
    ],
    constraints: {
      rankedStrategies,
      requiredModules: [...new Set(proposals.flatMap((proposal) => proposal.requiredModules ?? []))],
      thesisDirection: thesis.directionalRegime,
      thesisBias: thesis.hedgeBias,
    },
    proposal: proposals,
    risk: {
      score: thesis.tailRiskState === "stress" ? 0.72 : thesis.volState === "elevated" ? 0.48 : 0.32,
      maxLoss: "Proposal sizing is bounded by thesis risk budget.",
      needsApproval: context.plane !== "research",
      reasons: [...thesis.decisionNotes],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["account", "market", "swap", "option"],
    },
    handoff: "scenario-sim",
    handoffReason: "Proposals are ranked and ready for scenario stress testing.",
    producedArtifacts: ["planning.proposals"],
    consumedArtifacts: ["trade.thesis", "portfolio.risk-profile", "market.snapshot"],
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
    metadata: {
      rankedStrategies,
      selectedPrimaryStrategy: first?.strategyId ?? null,
      thesisBias: thesis.hedgeBias,
    },
    timestamp: new Date().toISOString(),
  };
}
