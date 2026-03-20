import { createCommandIntent } from "../../runtime/okx.js";
import { loadRules, findRule, findTableRow } from "../../runtime/rules-loader.js";
import type {
  OkxCommandIntent,
  SkillContext,
  SkillOutput,
  SkillProposal,
  SwapOrderPlanStep,
  SwapPlaceOrderParams,
} from "../../runtime/types.js";

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL"];
const DEFAULT_PRICE_BY_SYMBOL: Record<string, number> = {
  BTC: 70_000,
  ETH: 3_500,
  SOL: 150,
};
const MIN_NOTIONAL_USD = 25;
const DEFAULT_STRATEGY_PRIORITY = ["perp-short", "protective-put", "collar"] as const;
type HedgeStrategy = (typeof DEFAULT_STRATEGY_PRIORITY)[number];
const STRATEGY_TO_PROPOSAL: Record<HedgeStrategy, string> = {
  "perp-short": "directional-net-hedge",
  "protective-put": "deleverage-first",
  collar: "diversified-hedge",
};

type JsonRecord = Record<string, unknown>;

interface DirectionalExposure {
  longUsd: number;
  shortUsd: number;
  netUsd: number;
  dominantSide: "long" | "short" | "flat";
}

interface ConcentrationTopSymbol {
  symbol: string;
  usd: number;
  sharePct: number;
}

interface ConcentrationSummary {
  grossUsd: number;
  topSymbol: string;
  topSharePct: number;
  top3: ConcentrationTopSymbol[];
}

interface LeverageHotspot {
  instId: string;
  symbol: string;
  leverage: number;
  notionalUsd: number;
}

interface PortfolioRiskProfile {
  directionalExposure: DirectionalExposure;
  concentration: ConcentrationSummary;
  leverageHotspots: LeverageHotspot[];
}

interface MarketSnapshotLike {
  tickers?: Record<string, unknown>;
}

interface AccountSnapshotLike {
  positions?: unknown;
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

function asObject(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}

function asObjectArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asObject(entry))
      .filter((entry): entry is JsonRecord => Boolean(entry));
  }

  const objectValue = asObject(value);
  if (!objectValue) {
    return [];
  }

  const data = objectValue.data;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((entry) => asObject(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.replace(/,/g, "").trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundDown(value: number, step: number): number {
  if (step <= 0) {
    return value;
  }
  return Math.floor(value / step) * step;
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

function sizePrecisionForStep(step: number): number {
  const asText = step.toString();
  const decimalIndex = asText.indexOf(".");
  return decimalIndex === -1 ? 0 : asText.length - decimalIndex - 1;
}

function formatSize(size: number, step: number): string {
  const adjusted = roundDown(size, step);
  const precision = sizePrecisionForStep(step);
  return adjusted.toFixed(precision);
}

function pricePrecision(px: number): number {
  if (px >= 10_000) {
    return 1;
  }
  if (px >= 1_000) {
    return 2;
  }
  if (px >= 10) {
    return 3;
  }
  return 4;
}

function formatPrice(px: number): string {
  return px.toFixed(pricePrecision(px));
}

function parseDrawdownTargetPct(drawdownTarget: string): number {
  const match = drawdownTarget.match(/(\d+(\.\d+)?)/);
  if (!match) {
    return 4;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 4;
}

function hedgeRatioFromDrawdownTarget(drawdownTargetPct: number): number {
  if (drawdownTargetPct <= 3) {
    return 0.75;
  }
  if (drawdownTargetPct <= 5) {
    return 0.6;
  }
  if (drawdownTargetPct <= 8) {
    return 0.45;
  }
  return 0.35;
}

function symbolFromInstId(instId: string): string {
  return instId.split("-")[0] ?? instId;
}

function normalizeSwapInstId(instId: string, symbol: string): string {
  if (instId.endsWith("-SWAP")) {
    return instId;
  }

  if (instId.includes("-USDT-")) {
    return instId;
  }

  return `${symbol}-USDT-SWAP`;
}

function unwrapDataRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const objectPayload = asObject(payload);
  if (!objectPayload) {
    return [];
  }

  const data = objectPayload.data;
  if (Array.isArray(data)) {
    return data;
  }

  return [];
}

function extractTickerLastPrice(payload: unknown): number | undefined {
  const rows = unwrapDataRows(payload);
  const first = asObject(rows[0]);
  if (!first) {
    return undefined;
  }

  return (
    toNumber(first.last) ??
    toNumber(first.lastPx) ??
    toNumber(first.markPx) ??
    toNumber(first.idxPx) ??
    toNumber(first.close)
  );
}

function resolveReferencePrice(symbol: string, marketSnapshot?: MarketSnapshotLike): number {
  const tickerPayload = marketSnapshot?.tickers?.[`${symbol}-USDT`];
  const parsed = extractTickerLastPrice(tickerPayload);
  if (parsed !== undefined && parsed > 0) {
    return parsed;
  }

  return DEFAULT_PRICE_BY_SYMBOL[symbol] ?? 1;
}

function parseRiskProfile(raw: unknown): PortfolioRiskProfile {
  const objectRaw = asObject(raw);

  const directionalRaw = asObject(objectRaw?.directionalExposure);
  const netUsd = toNumber(directionalRaw?.netUsd) ?? 0;
  const dominantSideRaw = toString(directionalRaw?.dominantSide);
  const dominantSide: "long" | "short" | "flat" =
    dominantSideRaw === "long" || dominantSideRaw === "short" || dominantSideRaw === "flat"
      ? dominantSideRaw
      : netUsd > 0
        ? "long"
        : netUsd < 0
          ? "short"
          : "flat";

  const concentrationRaw = asObject(objectRaw?.concentration);
  const top3Raw = Array.isArray(concentrationRaw?.top3) ? concentrationRaw.top3 : [];
  const top3 = top3Raw
    .map((entry) => asObject(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => ({
      symbol: toString(entry.symbol) ?? "UNKNOWN",
      usd: Math.max(0, toNumber(entry.usd) ?? 0),
      sharePct: clamp(toNumber(entry.sharePct) ?? 0, 0, 100),
    }))
    .filter((entry) => entry.symbol !== "UNKNOWN");

  const hotspotsRaw = Array.isArray(objectRaw?.leverageHotspots) ? objectRaw?.leverageHotspots : [];
  const leverageHotspots = hotspotsRaw
    .map((entry) => asObject(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => {
      const instId = toString(entry.instId) ?? "";
      const symbol = toString(entry.symbol) ?? symbolFromInstId(instId);
      const leverage = toNumber(entry.leverage) ?? toNumber(entry.lever) ?? 0;
      const notionalUsd = Math.max(0, toNumber(entry.notionalUsd) ?? 0);
      return { instId, symbol, leverage, notionalUsd };
    })
    .filter((entry) => entry.instId && entry.symbol && entry.leverage > 0 && entry.notionalUsd > 0)
    .sort((left, right) => right.leverage - left.leverage);

  return {
    directionalExposure: {
      longUsd: Math.max(0, toNumber(directionalRaw?.longUsd) ?? 0),
      shortUsd: Math.max(0, toNumber(directionalRaw?.shortUsd) ?? 0),
      netUsd,
      dominantSide,
    },
    concentration: {
      grossUsd: Math.max(0, toNumber(concentrationRaw?.grossUsd) ?? 0),
      topSymbol: toString(concentrationRaw?.topSymbol) ?? "n/a",
      topSharePct: clamp(toNumber(concentrationRaw?.topSharePct) ?? 0, 0, 100),
      top3,
    },
    leverageHotspots,
  };
}

function parsePositionRows(accountSnapshot?: AccountSnapshotLike): JsonRecord[] {
  if (!accountSnapshot) {
    return [];
  }
  return asObjectArray(accountSnapshot.positions);
}

function buildPositionSideLookup(accountSnapshot?: AccountSnapshotLike): Map<string, "long" | "short"> {
  const rows = parsePositionRows(accountSnapshot);
  const lookup = new Map<string, "long" | "short">();

  for (const row of rows) {
    const instId = toString(row.instId);
    if (!instId) {
      continue;
    }

    const sideHint = toString(row.posSide)?.toLowerCase();
    const positionSize = toNumber(row.pos) ?? toNumber(row.sz) ?? 0;
    const side: "long" | "short" =
      sideHint === "short" ? "short" : sideHint === "long" ? "long" : positionSize < 0 ? "short" : "long";

    lookup.set(instId, side);
  }

  return lookup;
}

function choosePrimarySymbol(symbols: string[], profile: PortfolioRiskProfile): string {
  if (profile.concentration.topSymbol && profile.concentration.topSymbol !== "n/a") {
    return profile.concentration.topSymbol;
  }
  if (profile.leverageHotspots.length > 0) {
    return profile.leverageHotspots[0].symbol;
  }
  return symbols[0] ?? "BTC";
}

function buildSwapPlaceOrderCommand(
  params: SwapPlaceOrderParams,
  plane: SkillContext["plane"],
): string {
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
    args.push("--tpTriggerPx", params.tpTriggerPx);
  }
  if (params.tpOrdPx) {
    args.push("--tpOrdPx", params.tpOrdPx);
  }
  if (params.slTriggerPx) {
    args.push("--slTriggerPx", params.slTriggerPx);
  }
  if (params.slOrdPx) {
    args.push("--slOrdPx", params.slOrdPx);
  }
  if (params.clOrdId) {
    args.push("--clOrdId", params.clOrdId);
  }
  if (params.tag) {
    args.push("--tag", params.tag);
  }

  args.push(...buildPlaneFlagArgs(plane));
  return args.join(" ");
}

function toSwapIntent(step: SwapOrderPlanStep, plane: SkillContext["plane"]): OkxCommandIntent {
  return createCommandIntent(buildSwapPlaceOrderCommand(step.params, plane), {
    module: "swap",
    requiresWrite: true,
    reason: step.purpose,
  });
}

function buildReadIntents(symbols: string[], plane: SkillContext["plane"]): OkxCommandIntent[] {
  const flags = buildPlaneFlagArgs(plane).join(" ");
  const intents: OkxCommandIntent[] = [
    createCommandIntent(`okx account balance ${flags}`, {
      module: "account",
      requiresWrite: false,
      reason: "Read balances before final hedge sizing.",
    }),
    createCommandIntent(`okx account positions ${flags}`, {
      module: "account",
      requiresWrite: false,
      reason: "Read positions before applying hedge orders.",
    }),
  ];

  for (const symbol of symbols) {
    intents.push(
      createCommandIntent(`okx market ticker ${symbol}-USDT ${flags}`, {
        module: "market",
        requiresWrite: false,
        reason: `Read ${symbol} spot ticker for final order price reference.`,
      }),
    );
  }

  return intents;
}

function leverageReductionRatio(leverage: number): number {
  if (leverage >= 10) {
    return 0.4;
  }
  if (leverage >= 6) {
    return 0.3;
  }
  return 0.2;
}

function sideForDirectionalNet(netUsd: number): "buy" | "sell" | null {
  if (netUsd > 0) {
    return "sell";
  }
  if (netUsd < 0) {
    return "buy";
  }
  return null;
}

function makeSwapStep(
  options: {
    symbol: string;
    side: "buy" | "sell";
    targetNotionalUsd: number;
    referencePx: number;
    instId?: string;
    reduceOnly?: boolean;
    purpose: string;
    riskTags?: string[];
    orderTag: string;
  },
): SwapOrderPlanStep | null {
  if (options.targetNotionalUsd < MIN_NOTIONAL_USD || options.referencePx <= 0) {
    return null;
  }

  const stepSize = sizeStepForSymbol(options.symbol);
  const rawSize = options.targetNotionalUsd / options.referencePx;
  const formattedSize = formatSize(rawSize, stepSize);
  if (toNumber(formattedSize) === 0) {
    return null;
  }

  const priceOffsetBps = 7;
  const priceMultiplier = options.side === "sell" ? 1 - priceOffsetBps / 10_000 : 1 + priceOffsetBps / 10_000;
  const limitPx = formatPrice(options.referencePx * priceMultiplier);
  const params: SwapPlaceOrderParams = {
    instId: options.instId ?? `${options.symbol}-USDT-SWAP`,
    tdMode: "cross",
    side: options.side,
    ordType: "limit",
    sz: formattedSize,
    px: limitPx,
    reduceOnly: options.reduceOnly ?? false,
    tag: options.orderTag,
  };

  return {
    kind: "swap-place-order",
    purpose: options.purpose,
    symbol: options.symbol,
    targetNotionalUsd: options.targetNotionalUsd,
    referencePx: options.referencePx,
    params,
    riskTags: options.riskTags,
  };
}

function buildProposal(
  options: {
    name: string;
    reason: string;
    estimatedCost: string;
    estimatedProtection: string;
    riskTags?: string[];
    orderPlan: SwapOrderPlanStep[];
    readSymbols: string[];
    plane: SkillContext["plane"];
  },
): SkillProposal {
  const readIntents = buildReadIntents(options.readSymbols, options.plane);
  const writeIntents = options.orderPlan.map((step) => toSwapIntent(step, options.plane));

  return {
    name: options.name,
    reason: options.reason,
    estimatedCost: options.estimatedCost,
    estimatedProtection: options.estimatedProtection,
    riskTags: options.riskTags,
    requiredModules: ["account", "market", "swap"],
    intents: [...readIntents, ...writeIntents],
    orderPlan: options.orderPlan,
  };
}

function summarizeOrderPlan(plan: SwapOrderPlanStep[]): string {
  if (plan.length === 0) {
    return "none";
  }

  return plan
    .map(
      (step) =>
        `${step.params.instId} ${step.params.side} sz=${step.params.sz} px=${step.params.px ?? "mkt"}${step.params.reduceOnly ? " reduceOnly" : ""}`,
    )
    .join(" | ");
}

function sanitizeStrategyPriority(priority: string[]): HedgeStrategy[] {
  const allowed = new Set<HedgeStrategy>(DEFAULT_STRATEGY_PRIORITY);
  const normalized: HedgeStrategy[] = [];

  for (const raw of priority) {
    if (allowed.has(raw as HedgeStrategy) && !normalized.includes(raw as HedgeStrategy)) {
      normalized.push(raw as HedgeStrategy);
    }
  }

  for (const fallback of DEFAULT_STRATEGY_PRIORITY) {
    if (!normalized.includes(fallback)) {
      normalized.push(fallback);
    }
  }

  return normalized;
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const symbols = (context.sharedState.symbols as string[] | undefined) ?? DEFAULT_SYMBOLS;
  const drawdownTarget = (context.sharedState.drawdownTarget as string | undefined) ?? "4%";
  const marketSnapshot = asObject(context.sharedState.marketSnapshot) as MarketSnapshotLike | undefined;
  const accountSnapshot = asObject(context.sharedState.accountSnapshot) as AccountSnapshotLike | undefined;
  const profile = parseRiskProfile(context.sharedState.portfolioRiskProfile);
  const drawdownTargetPct = parseDrawdownTargetPct(drawdownTarget);
  const hedgeRatio = hedgeRatioFromDrawdownTarget(drawdownTargetPct);
  const directionalSide = sideForDirectionalNet(profile.directionalExposure.netUsd);
  const primarySymbol = choosePrimarySymbol(symbols, profile);
  const primaryReferencePx = resolveReferencePrice(primarySymbol, marketSnapshot);
  const directionalTargetNotional = Math.abs(profile.directionalExposure.netUsd) * hedgeRatio;

  // 从 hedging-strats.md 加载策略选择规则
  let strategyPriority: HedgeStrategy[] = [...DEFAULT_STRATEGY_PRIORITY];
  let rulesMetadata: Record<string, unknown> = {};
  
  try {
    const doc = await loadRules("hedging-strats.md");
    
    // 提取资金费率阈值和优先级规则
    const fundingRule = findRule(doc, "funding-rate-priority");
    const ivRule = findRule(doc, "iv-percentile-priority");
    
    // 提取市场环境
    const fundingRate = toNumber((marketSnapshot as Record<string, unknown>)?.fundingRate) ?? 0;
    // IV percentile 需要从 marketSnapshot 推断，暂时用波动率替代
    const volatilityNote = toString((marketSnapshot as Record<string, unknown>)?.volatilityNote) ?? "";
    const isHighVolatility = volatilityNote.includes("high") || volatilityNote.includes("高波动");
    
    // 根据规则决定策略优先级
    if (fundingRate > 0.01 && fundingRule) {
      // 资金费率过高，优先 option
      strategyPriority = ["protective-put", "collar", "perp-short"];
      rulesMetadata = { 
        rule: "funding-rate-priority", 
        fundingRate, 
        threshold: fundingRule.params.threshold ?? "0.01" 
      };
    } else if (isHighVolatility && ivRule) {
      // IV 过高，期权贵，优先 perp
      strategyPriority = ["perp-short", "collar", "protective-put"];
      rulesMetadata = { 
        rule: "iv-percentile-priority", 
        volatilityNote 
      };
    }
    
    strategyPriority = sanitizeStrategyPriority(strategyPriority);
    rulesMetadata.loadedRules = doc.rules.map(r => r.id);
  } catch (error) {
    console.error("[hedge-planner] Failed to load hedging rules:", error);
    strategyPriority = sanitizeStrategyPriority(strategyPriority);
  }

  const directionalPlan: SwapOrderPlanStep[] = [];
  if (directionalSide) {
    const step = makeSwapStep({
      symbol: primarySymbol,
      side: directionalSide,
      targetNotionalUsd: directionalTargetNotional,
      referencePx: primaryReferencePx,
      purpose: `Neutralize ${Math.abs(profile.directionalExposure.netUsd).toFixed(2)} USD net exposure with a ${hedgeRatio.toFixed(2)} hedge ratio.`,
      riskTags: ["directional"],
      orderTag: "mesh-dir",
    });
    if (step) {
      directionalPlan.push(step);
    }
  }

  const needsDiversification =
    profile.concentration.topSharePct >= 55 &&
    profile.concentration.top3.length > 1 &&
    directionalSide !== null;
  const diversificationBudget = Math.max(
    directionalTargetNotional * 0.7,
    profile.concentration.grossUsd * Math.min(0.35, hedgeRatio),
  );
  const diversificationPlan: SwapOrderPlanStep[] = [];
  if (needsDiversification && directionalSide) {
    const topSymbols = profile.concentration.top3.slice(0, 2);
    for (const topSymbol of topSymbols) {
      const symbol = topSymbol.symbol;
      const symbolReferencePx = resolveReferencePrice(symbol, marketSnapshot);
      const cappedUsd = Math.min(topSymbol.usd * 0.45, diversificationBudget * (topSymbol.sharePct / 100));
      const step = makeSwapStep({
        symbol,
        side: directionalSide,
        targetNotionalUsd: cappedUsd,
        referencePx: symbolReferencePx,
        purpose: `Disperse concentration risk from ${profile.concentration.topSymbol} (${profile.concentration.topSharePct.toFixed(1)}%).`,
        riskTags: ["concentration", "diversification"],
        orderTag: "mesh-div",
      });
      if (step) {
        diversificationPlan.push(step);
      }
    }
  }

  if (diversificationPlan.length === 0 && directionalPlan.length > 0) {
    diversificationPlan.push(...directionalPlan);
  }

  const positionSideLookup = buildPositionSideLookup(accountSnapshot);
  const deleveragePlan: SwapOrderPlanStep[] = [];
  for (const hotspot of profile.leverageHotspots.slice(0, 3)) {
    const normalizedInstId = normalizeSwapInstId(hotspot.instId, hotspot.symbol);
    const sideHint = positionSideLookup.get(hotspot.instId) ?? positionSideLookup.get(normalizedInstId);
    const side: "buy" | "sell" | null =
      sideHint === "long" ? "sell" : sideHint === "short" ? "buy" : directionalSide;
    if (!side) {
      continue;
    }

    const targetNotionalUsd = hotspot.notionalUsd * leverageReductionRatio(hotspot.leverage);
    const referencePx = resolveReferencePrice(hotspot.symbol, marketSnapshot);
    const step = makeSwapStep({
      symbol: hotspot.symbol,
      instId: normalizedInstId,
      side,
      targetNotionalUsd,
      referencePx,
      reduceOnly: true,
      purpose: `Reduce leverage hotspot ${hotspot.instId} (${hotspot.leverage.toFixed(2)}x).`,
      riskTags: ["leverage", "deleveraging"],
      orderTag: "mesh-lev",
    });

    if (step) {
      deleveragePlan.push(step);
    }
  }

  if (deleveragePlan.length === 0 && directionalPlan.length > 0) {
    deleveragePlan.push(...directionalPlan);
  }

  const strategySource = typeof rulesMetadata.rule === "string" ? `rules:${rulesMetadata.rule}` : "rules:default";
  const baseProposals: SkillProposal[] = [
    buildProposal({
      name: "deleverage-first",
      reason:
        "Prioritize reducing high-leverage positions, then keep directional exposure from expanding.",
      estimatedCost: "Funding + maker/taker fees, usually lower than forced liquidation risk",
      estimatedProtection: "Fastest reduction of liquidation sensitivity on high-leverage legs",
      riskTags: ["plan:deleverage"],
      orderPlan: deleveragePlan,
      readSymbols: [...new Set(deleveragePlan.map((step) => step.symbol).concat(primarySymbol))],
      plane: context.plane,
    }),
    buildProposal({
      name: "diversified-hedge",
      reason: "Split hedge pressure across concentration-heavy symbols to avoid single-asset dependence.",
      estimatedCost: "Multi-leg execution slippage across top concentrated assets",
      estimatedProtection: "Better concentration control with still-meaningful directional dampening",
      riskTags: ["plan:diversified"],
      orderPlan: diversificationPlan,
      readSymbols: [...new Set(diversificationPlan.map((step) => step.symbol).concat(primarySymbol))],
      plane: context.plane,
    }),
    buildProposal({
      name: "directional-net-hedge",
      reason: "Directly neutralize the net directional exposure with a focused perpetual hedge.",
      estimatedCost: "Single-leg funding + slippage",
      estimatedProtection: "Highest speed to compress net delta",
      riskTags: ["plan:directional"],
      orderPlan: directionalPlan,
      readSymbols: [primarySymbol],
      plane: context.plane,
    }),
  ];

  const proposalByName = new Map(baseProposals.map((proposal) => [proposal.name, proposal]));
  const proposals = strategyPriority.reduce<SkillProposal[]>((ordered, strategy) => {
      const proposal = proposalByName.get(STRATEGY_TO_PROPOSAL[strategy]);
      if (!proposal) {
        return ordered;
      }

      proposalByName.delete(proposal.name);
      ordered.push({
        ...proposal,
        riskTags: [
          ...new Set([...(proposal.riskTags ?? []), `strategy:${strategy}`, `strategy-source:${strategySource}`]),
        ],
      });
      return ordered;
    }, []);

  for (const proposal of proposalByName.values()) {
    proposals.push({
      ...proposal,
      riskTags: [...new Set([...(proposal.riskTags ?? []), "strategy:unmapped", `strategy-source:${strategySource}`])],
    });
  }

  const ranked = proposals
    .filter((proposal) => (proposal.orderPlan?.length ?? 0) > 0)
    .map((proposal) => proposal.name);

  context.sharedState.proposals = proposals;
  context.sharedState.hedgePlannerRanked = ranked;
  context.sharedState.hedgePlannerSignals = {
    hedgeRatio,
    directionalTargetNotional,
    needsDiversification,
    leverageHotspotCount: profile.leverageHotspots.length,
  };

  const allowedModules = [...new Set(proposals.flatMap((proposal) => proposal.requiredModules ?? []))];
  const facts = [
    `Directional exposure net=${profile.directionalExposure.netUsd.toFixed(2)} USD => hedge side ${
      directionalSide ?? "flat"
    }.`,
    `Drawdown target ${drawdownTarget} => hedge ratio ${hedgeRatio.toFixed(2)}.`,
    `Concentration top=${profile.concentration.topSymbol} share=${profile.concentration.topSharePct.toFixed(1)}%, diversification=${
      needsDiversification ? "enabled" : "not required"
    }.`,
    `Leverage hotspots prioritized: ${profile.leverageHotspots.length}.`,
    `Strategy priority: ${strategyPriority.join(" > ")} (top=${strategyPriority[0]}).`,
    `First proposal: ${proposals[0]?.name ?? "n/a"} with tags ${(proposals[0]?.riskTags ?? []).join(", ") || "n/a"}.`,
    `Directional order params: ${summarizeOrderPlan(directionalPlan)}.`,
    `Diversified order params: ${summarizeOrderPlan(diversificationPlan)}.`,
    `Deleverage order params: ${summarizeOrderPlan(deleveragePlan)}.`,
  ];

  return {
    skill: "hedge-planner",
    stage: "planner",
    goal: context.goal,
    summary: "Compute hedge direction/size from portfolio risk profile and emit precise swap place-order parameters.",
    facts,
    constraints: {
      selectedSymbols: symbols,
      drawdownTarget,
      hedgeRatio,
      requiredModules: allowedModules,
      mustCompare: proposals.map((proposal) => proposal.name),
      directionalExposure: profile.directionalExposure,
      concentration: profile.concentration,
      leverageHotspots: profile.leverageHotspots,
    },
    proposal: proposals,
    risk: {
      score: 0.34,
      maxLoss: "Execution slippage and funding drift if hedge ratio is oversized",
      needsApproval: true,
      reasons: [
        "Planner emits swap write intents with explicit size/price parameters.",
        "Deleverage actions can change margin profile quickly.",
      ],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules,
    },
    handoff: "policy-gate",
    metadata: {
      ranked,
      hedgeRatio,
      directionalTargetNotional,
      needsDiversification,
      leverageHotspotCount: profile.leverageHotspots.length,
      strategyPriority,
      rulesMetadata,
    },
    timestamp: new Date().toISOString(),
  };
}
