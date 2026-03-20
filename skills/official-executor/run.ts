import { createCommandIntent, readMarketSnapshot } from "../../runtime/okx.js";
import type {
  OptionOrderPlanStep,
  OptionPlaceOrderParams,
  OrderPlanStep,
  OkxCommandIntent,
  SkillContext,
  SkillOutput,
  SkillProposal,
  SwapOrderPlanStep,
  SwapPlaceOrderParams,
} from "../../runtime/types.js";

const FALLBACK_SYMBOL = "BTC";

type JsonRecord = Record<string, unknown>;

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

function parseDrawdownPct(drawdownTarget: string | undefined): number {
  if (!drawdownTarget) {
    return 4;
  }

  const match = drawdownTarget.match(/(\d+(\.\d+)?)/);
  if (!match) {
    return 4;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 4;
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

function sizePrecision(step: number): number {
  const text = step.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function roundDown(value: number, step: number): number {
  if (step <= 0) {
    return value;
  }
  return Math.floor(value / step) * step;
}

function formatSize(rawSize: number, step: number): string {
  const precision = sizePrecision(step);
  return roundDown(rawSize, step).toFixed(precision);
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

function formatOptionPrice(px: number): string {
  const normalized = Math.max(0.0001, px);
  if (normalized >= 100) {
    return normalized.toFixed(2);
  }
  if (normalized >= 1) {
    return normalized.toFixed(3);
  }
  return normalized.toFixed(4);
}

function toYymmdd(date: Date): string {
  const year = date.getUTCFullYear().toString().slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function nextFridayYymmdd(base = new Date()): string {
  const date = new Date(base.getTime());
  const day = date.getUTCDay();
  const distance = ((5 - day + 7) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + distance);
  return toYymmdd(date);
}

function normalizeOptionStrike(referencePx: number, multiplier: number): number {
  const raw = Math.max(1, referencePx * multiplier);
  const step = raw >= 50_000 ? 1000 : raw >= 10_000 ? 500 : raw >= 1_000 ? 100 : 10;
  return Math.round(raw / step) * step;
}

function symbolFromInstId(instId: string): string {
  return instId.split("-")[0] ?? instId;
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
  return Array.isArray(data) ? data : [];
}

function extractTickerPrice(payload: unknown): number | undefined {
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

function buildOptionPlaceOrderCommand(
  params: OptionPlaceOrderParams,
  plane: SkillContext["plane"],
): string {
  const args = [
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
  ];

  return args.join(" ");
}

function normalizeOrderPlan(rawPlan: unknown): OrderPlanStep[] {
  if (!Array.isArray(rawPlan)) {
    return [];
  }

  const normalized: OrderPlanStep[] = [];
  for (const rawEntry of rawPlan) {
    const entry = asObject(rawEntry);
    if (!entry) {
      continue;
    }

    const paramsRaw = asObject(entry.params);
    if (!paramsRaw) {
      continue;
    }

    const symbol = toString(entry.symbol) ?? symbolFromInstId(toString(paramsRaw.instId) ?? "");
    const kind = toString(entry.kind) ?? "swap-place-order";
    if (kind === "option-place-order") {
      const sideRaw = toString(paramsRaw.side);
      const side = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : "buy";
      const params: OptionPlaceOrderParams = {
        instId: toString(paramsRaw.instId) ?? `${symbol}-USD-${nextFridayYymmdd()}-50000-P`,
        side,
        sz: toString(paramsRaw.sz) ?? "1",
        px: toString(paramsRaw.px) ?? "0.05",
      };

      normalized.push({
        kind: "option-place-order",
        purpose: toString(entry.purpose) ?? "Execute approved option hedge leg.",
        symbol: symbol || FALLBACK_SYMBOL,
        targetPremiumUsd: Math.max(0, toNumber(entry.targetPremiumUsd) ?? 0),
        referencePx: Math.max(0, toNumber(entry.referencePx) ?? 0),
        params,
        strategy:
          toString(entry.strategy) === "collar"
            ? "collar"
            : toString(entry.strategy) === "protective-put"
              ? "protective-put"
              : undefined,
        leg:
          toString(entry.leg) === "covered-call"
            ? "covered-call"
            : toString(entry.leg) === "protective-put"
              ? "protective-put"
              : undefined,
        riskTags: Array.isArray(entry.riskTags)
          ? entry.riskTags
              .map((tag) => toString(tag))
              .filter((tag): tag is string => Boolean(tag))
          : undefined,
      });
      continue;
    }

    const sideRaw = toString(paramsRaw.side);
    const tdModeRaw = toString(paramsRaw.tdMode);
    const ordTypeRaw = toString(paramsRaw.ordType);
    const side = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : "sell";
    const tdMode = tdModeRaw === "isolated" ? "isolated" : "cross";
    const ordType =
      ordTypeRaw === "market" ||
      ordTypeRaw === "limit" ||
      ordTypeRaw === "post_only" ||
      ordTypeRaw === "fok" ||
      ordTypeRaw === "ioc"
        ? ordTypeRaw
        : "limit";

    const params: SwapPlaceOrderParams = {
      instId: toString(paramsRaw.instId) ?? `${symbol}-USDT-SWAP`,
      tdMode,
      side,
      ordType,
      sz: toString(paramsRaw.sz) ?? "0",
      px: toString(paramsRaw.px),
      reduceOnly: paramsRaw.reduceOnly === true,
      posSide: (() => {
        const parsed = toString(paramsRaw.posSide);
        if (parsed === "long" || parsed === "short" || parsed === "net") {
          return parsed;
        }
        return undefined;
      })(),
      tpTriggerPx: toString(paramsRaw.tpTriggerPx),
      tpOrdPx: toString(paramsRaw.tpOrdPx),
      slTriggerPx: toString(paramsRaw.slTriggerPx),
      slOrdPx: toString(paramsRaw.slOrdPx),
      clOrdId: toString(paramsRaw.clOrdId),
      tag: toString(paramsRaw.tag),
    };

    normalized.push({
      kind: "swap-place-order",
      purpose: toString(entry.purpose) ?? "Execute approved swap hedge leg.",
      symbol: symbol || FALLBACK_SYMBOL,
      targetNotionalUsd: Math.max(0, toNumber(entry.targetNotionalUsd) ?? 0),
      referencePx: Math.max(0, toNumber(entry.referencePx) ?? 0),
      params,
      riskTags: Array.isArray(entry.riskTags)
        ? entry.riskTags
            .map((tag) => toString(tag))
            .filter((tag): tag is string => Boolean(tag))
        : undefined,
    });
  }

  return normalized;
}

function extractIntentsFromSharedState(sharedState: Record<string, unknown>): OkxCommandIntent[] {
  const raw = sharedState.selectedProposalIntents;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => asObject(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => {
      const command = toString(entry.command);
      const module = toString(entry.module);
      const reason = toString(entry.reason);
      if (!command || !module || !reason) {
        return null;
      }

      const args = Array.isArray(entry.args)
        ? entry.args
            .map((arg) => toString(arg))
            .filter((arg): arg is string => Boolean(arg))
        : command.split(/\s+/);
      const requiresWrite = entry.requiresWrite === true;

      return {
        command,
        args,
        module,
        requiresWrite,
        reason,
      };
    })
    .filter((entry): entry is OkxCommandIntent => Boolean(entry));
}

function fallbackSwapOrderPlan(symbol: string): SwapOrderPlanStep[] {
  const referencePx = symbol === "BTC" ? 70_000 : symbol === "ETH" ? 3_500 : 100;
  return [
    {
      kind: "swap-place-order",
      purpose: "Fallback hedge leg when proposal orderPlan is missing.",
      symbol,
      targetNotionalUsd: 200,
      referencePx,
      params: {
        instId: `${symbol}-USDT-SWAP`,
        tdMode: "cross",
        side: "sell",
        ordType: "limit",
        sz: "0.001",
        px: formatPrice(referencePx * 0.999),
        reduceOnly: false,
        tag: "mesh-fallback",
      },
      riskTags: ["fallback"],
    },
  ];
}

function normalizeProposalName(name: string): string {
  return name.trim().toLowerCase();
}

function isOptionProposal(name: string): boolean {
  const normalized = normalizeProposalName(name);
  return normalized === "protective-put" || normalized === "collar";
}

function buildOptionInstId(
  symbol: string,
  referencePx: number,
  right: "P" | "C",
  multiplier: number,
): string {
  const expiry = nextFridayYymmdd();
  const strike = normalizeOptionStrike(referencePx, multiplier);
  return `${symbol}-USD-${expiry}-${strike}-${right}`;
}

function fallbackOptionOrderPlan(
  proposalName: string,
  symbol: string,
  referencePx: number,
): OptionOrderPlanStep[] {
  const normalized = normalizeProposalName(proposalName);
  const reference = referencePx > 0 ? referencePx : symbol === "BTC" ? 70_000 : symbol === "ETH" ? 3_500 : 100;
  const putLeg: OptionOrderPlanStep = {
    kind: "option-place-order",
    purpose: "Buy downside protection put leg.",
    symbol,
    targetPremiumUsd: 200,
    referencePx: reference,
    params: {
      instId: buildOptionInstId(symbol, reference, "P", 0.95),
      side: "buy",
      sz: "1",
      px: formatOptionPrice(0.05),
    },
    strategy: normalized === "collar" ? "collar" : "protective-put",
    leg: "protective-put",
    riskTags: ["downside-protection", "fallback"],
  };

  if (normalized !== "collar") {
    return [putLeg];
  }

  const callLeg: OptionOrderPlanStep = {
    kind: "option-place-order",
    purpose: "Sell upside call leg to finance the put premium.",
    symbol,
    targetPremiumUsd: 140,
    referencePx: reference,
    params: {
      instId: buildOptionInstId(symbol, reference, "C", 1.05),
      side: "sell",
      sz: "1",
      px: formatOptionPrice(0.04),
    },
    strategy: "collar",
    leg: "covered-call",
    riskTags: ["premium-financing", "fallback"],
  };

  return [putLeg, callLeg];
}

function applyTpSl(
  params: SwapPlaceOrderParams,
  entryPx: number,
  drawdownPct: number,
): SwapPlaceOrderParams {
  if (params.tpTriggerPx || params.slTriggerPx || params.reduceOnly) {
    return params;
  }

  const tpPct = clamp(drawdownPct / 2, 0.8, 3);
  const slPct = clamp(drawdownPct, 1.5, 8);
  const tpMultiplier = params.side === "sell" ? 1 - tpPct / 100 : 1 + tpPct / 100;
  const slMultiplier = params.side === "sell" ? 1 + slPct / 100 : 1 - slPct / 100;

  return {
    ...params,
    tpTriggerPx: formatPrice(entryPx * tpMultiplier),
    tpOrdPx: "-1",
    slTriggerPx: formatPrice(entryPx * slMultiplier),
    slOrdPx: "-1",
  };
}

function buildReadIntents(symbols: string[], plane: SkillContext["plane"]): OkxCommandIntent[] {
  const flags = buildPlaneFlagArgs(plane).join(" ");

  return [
    createCommandIntent(`okx account balance ${flags}`, {
      module: "account",
      requiresWrite: false,
      reason: "Refresh account balance before materializing execution commands.",
    }),
    createCommandIntent(`okx account positions ${flags}`, {
      module: "account",
      requiresWrite: false,
      reason: "Refresh position inventory before place-order execution.",
    }),
    ...symbols.map((symbol) =>
      createCommandIntent(`okx market ticker ${symbol}-USDT ${flags}`, {
        module: "market",
        requiresWrite: false,
        reason: `Refresh ${symbol} ticker for price-sensitive order materialization.`,
      }),
    ),
  ];
}

function toSwapIntent(step: SwapOrderPlanStep, plane: SkillContext["plane"]): OkxCommandIntent {
  return createCommandIntent(buildSwapPlaceOrderCommand(step.params, plane), {
    module: "swap",
    requiresWrite: true,
    reason: step.purpose,
  });
}

function toOptionIntent(step: OptionOrderPlanStep, plane: SkillContext["plane"]): OkxCommandIntent {
  return createCommandIntent(buildOptionPlaceOrderCommand(step.params, plane), {
    module: "option",
    requiresWrite: true,
    reason: step.purpose,
  });
}

function readSelectedProposalName(sharedState: Record<string, unknown>): string {
  const selected = sharedState.selectedProposal;
  return typeof selected === "string" ? selected : "directional-net-hedge";
}

function readSelectedProposal(sharedState: Record<string, unknown>): SkillProposal | null {
  const raw = sharedState.selectedProposalData;
  const record = asObject(raw);
  if (!record) {
    return null;
  }

  const name = toString(record.name);
  const reason = toString(record.reason);
  if (!name || !reason) {
    return null;
  }

  return {
    name,
    reason,
  };
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const sharedState = context.sharedState as Record<string, unknown>;
  const selectedProposal = readSelectedProposalName(sharedState);
  const selectedProposalData = readSelectedProposal(sharedState);
  const drawdownTarget = toString(sharedState.drawdownTarget) ?? "4%";
  const drawdownPct = parseDrawdownPct(drawdownTarget);
  const planFromState = normalizeOrderPlan(sharedState.selectedProposalOrderPlan);
  const legacyIntents = extractIntentsFromSharedState(sharedState);

  const fallbackSymbol =
    (Array.isArray(sharedState.symbols) && toString((sharedState.symbols as unknown[])[0])) || FALLBACK_SYMBOL;
  const symbolsFromPlan = planFromState.map((step) => step.symbol).filter(Boolean);
  const symbols = [...new Set((symbolsFromPlan.length > 0 ? symbolsFromPlan : [fallbackSymbol]).map((symbol) => symbol.toUpperCase()))];
  const marketSnapshot = readMarketSnapshot(symbols.map((symbol) => `${symbol}-USDT`), context.plane);
  const fallbackReferencePx = (() => {
    if (fallbackSymbol === "BTC") {
      return 70_000;
    }
    if (fallbackSymbol === "ETH") {
      return 3_500;
    }
    return 100;
  })();
  const optionFallbackPlan =
    planFromState.length === 0 && isOptionProposal(selectedProposal)
      ? fallbackOptionOrderPlan(
          selectedProposal,
          fallbackSymbol,
          extractTickerPrice(marketSnapshot.tickers[`${fallbackSymbol}-USDT`]) ?? fallbackReferencePx,
        )
      : [];
  const orderPlanSource =
    planFromState.length > 0
      ? "proposal.orderPlan"
      : optionFallbackPlan.length > 0
        ? "proposal-name option fallback"
        : "swap fallback model";
  const baseOrderPlan: OrderPlanStep[] =
    planFromState.length > 0
      ? planFromState
      : optionFallbackPlan.length > 0
        ? optionFallbackPlan
        : fallbackSwapOrderPlan(fallbackSymbol);
  const baseSwapPlan = baseOrderPlan.filter(
    (step): step is SwapOrderPlanStep => step.kind === "swap-place-order",
  );
  const baseOptionPlan = baseOrderPlan.filter(
    (step): step is OptionOrderPlanStep => step.kind === "option-place-order",
  );

  const priceWarnings: string[] = [];
  const finalizedSwapOrderPlan = baseSwapPlan.map((step, index) => {
    const tickerPayload = marketSnapshot.tickers[`${step.symbol}-USDT`];
    const livePx = extractTickerPrice(tickerPayload);
    const referencePx = livePx ?? step.referencePx;
    if (!livePx) {
      priceWarnings.push(`Ticker fallback used for ${step.symbol} when computing order ${index + 1}.`);
    }

    const computedReferencePx = referencePx > 0 ? referencePx : 1;
    const targetNotionalUsd =
      step.targetNotionalUsd > 0 ? step.targetNotionalUsd : computedReferencePx * (toNumber(step.params.sz) ?? 0);
    const orderStep = sizeStepForSymbol(step.symbol);
    const computedSz = targetNotionalUsd > 0 ? targetNotionalUsd / computedReferencePx : toNumber(step.params.sz) ?? 0;
    const formattedSz = formatSize(computedSz, orderStep);
    const bps = step.params.reduceOnly ? 5 : 8;
    const multiplier = step.params.side === "sell" ? 1 - bps / 10_000 : 1 + bps / 10_000;
    const derivedPx = formatPrice(computedReferencePx * multiplier);

    const params: SwapPlaceOrderParams = {
      ...step.params,
      sz: toNumber(formattedSz) && toNumber(formattedSz)! > 0 ? formattedSz : step.params.sz,
      px: step.params.ordType === "market" ? undefined : derivedPx,
      clOrdId: step.params.clOrdId ?? `${context.runId}-${index + 1}`,
    };
    const paramsWithTpSl = applyTpSl(params, computedReferencePx, drawdownPct);

    return {
      ...step,
      targetNotionalUsd,
      referencePx: computedReferencePx,
      params: paramsWithTpSl,
    };
  });
  const finalizedOptionOrderPlan = baseOptionPlan.map((step, index) => {
    const tickerPayload = marketSnapshot.tickers[`${step.symbol}-USDT`];
    const livePx = extractTickerPrice(tickerPayload);
    const referencePx = livePx ?? step.referencePx;
    if (!livePx) {
      priceWarnings.push(`Ticker fallback used for ${step.symbol} when computing option order ${index + 1}.`);
    }

    const computedReferencePx = referencePx > 0 ? referencePx : step.referencePx > 0 ? step.referencePx : 1;
    const sz = toNumber(step.params.sz) ?? 0;
    const px = toNumber(step.params.px) ?? 0;
    const targetPremiumUsd = step.targetPremiumUsd > 0 ? step.targetPremiumUsd : sz > 0 && px > 0 ? sz * px : 0;
    const normalizedSz = sz > 0 ? step.params.sz : "1";
    const normalizedPx =
      px > 0
        ? step.params.px
        : targetPremiumUsd > 0
          ? formatOptionPrice(targetPremiumUsd / (toNumber(normalizedSz) ?? 1))
          : formatOptionPrice(0.05);

    return {
      ...step,
      targetPremiumUsd,
      referencePx: computedReferencePx,
      params: {
        ...step.params,
        sz: normalizedSz,
        px: normalizedPx,
      },
    };
  });
  const finalizedOrderPlan: OrderPlanStep[] = [...finalizedSwapOrderPlan, ...finalizedOptionOrderPlan];
  const materializedSymbols = [...new Set(finalizedOrderPlan.map((step) => step.symbol))];

  const readIntents = buildReadIntents(materializedSymbols, context.plane);
  const swapWriteIntents = finalizedSwapOrderPlan.map((step) => toSwapIntent(step, context.plane));
  const optionWriteIntents = finalizedOptionOrderPlan.map((step) => toOptionIntent(step, context.plane));
  const writeIntents = [...swapWriteIntents, ...optionWriteIntents];
  const intents = [...readIntents, ...writeIntents];
  const writeIntentCount = writeIntents.length;
  const requiredModules = [...new Set(intents.map((intent) => intent.module))];
  const commandPreview = intents.map((intent) => intent.command);

  const facts = [
    `Selected proposal: ${selectedProposal}`,
    `Execution plane: ${context.plane}`,
    `Order plan source: ${orderPlanSource}`,
    `Materialized swap writes: ${swapWriteIntents.length}`,
    `Materialized option writes: ${optionWriteIntents.length}`,
    `TP/SL support: ${
      finalizedSwapOrderPlan.some((step) => step.params.tpTriggerPx || step.params.slTriggerPx)
        ? "enabled"
        : "not attached"
    }`,
  ];
  if (selectedProposalData) {
    facts.push(`Proposal rationale: ${selectedProposalData.reason}`);
  }
  if (marketSnapshot.errors.length > 0) {
    facts.push(`Market refresh warning: ${marketSnapshot.errors[0]}`);
  }
  if (priceWarnings.length > 0) {
    facts.push(`Pricing fallback warning: ${priceWarnings[0]}`);
  }
  if (planFromState.length === 0 && legacyIntents.length > 0) {
    facts.push("Legacy intents were detected; orderPlan fallback was used to keep execution deterministic.");
  }
  if (optionFallbackPlan.length > 0) {
    facts.push(`Option fallback activated for ${selectedProposal}; generated ${optionFallbackPlan.length} option leg(s).`);
  }

  return {
    skill: "official-executor",
    stage: "executor",
    goal: context.goal,
    summary: "Materialize policy-approved swap/option plans into executable OKX place-order commands.",
    facts,
    constraints: {
      selectedProposal,
      requiredModules,
      intentCount: intents.length,
      writeIntentCount,
      swapWriteIntentCount: swapWriteIntents.length,
      optionWriteIntentCount: optionWriteIntents.length,
      drawdownTarget,
    },
    proposal: [],
    risk: {
      score: context.plane === "live" ? 0.92 : context.plane === "demo" ? 0.42 : 0.2,
      maxLoss:
        context.plane === "live"
          ? "Live execution can incur direct capital loss"
          : context.plane === "demo"
            ? "Demo account PnL drift only"
            : "Research plane only previews commands",
      needsApproval: true,
      reasons: ["Execution commands were materialized with concrete size, price, and TP/SL parameters."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: requiredModules,
    },
    handoff: "replay",
    metadata: {
      selectedProposal,
      commandPreview,
      intents,
      orderPlan: finalizedOrderPlan,
      swapOrderPlan: finalizedSwapOrderPlan,
      optionOrderPlan: finalizedOptionOrderPlan,
      marketSnapshotSource: marketSnapshot.source,
      marketSnapshotErrors: marketSnapshot.errors,
      priceWarnings,
    },
    timestamp: new Date().toISOString(),
  };
}
