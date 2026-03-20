import type {
  SkillContext,
  SkillOutput,
  SkillProposal,
  SwapOrderPlanStep,
} from "../../runtime/types.js";
import { loadRules, findRule } from "../../runtime/rules-loader.js";

type JsonRecord = Record<string, unknown>;

interface PolicyLimits {
  maxSingleOrderNotionalUsd: number;
  maxTotalOrderNotionalUsd: number;
  maxTotalExposureUsd: number;
  initialMarginRate: number;
  whitelistSymbols: string[];
  blacklistSymbols: string[];
}

interface VolatilityAdjustmentMetadata {
  threshold: number;
  factor: number;
  marketVolatility: number | null;
  applied: boolean;
  source: string;
}

interface PolicyLimitsResult {
  limits: PolicyLimits;
  volatilityAdjustment: VolatilityAdjustmentMetadata;
  loadedRules: string[];
}

interface OrderSlice {
  instId: string;
  symbol: string;
  notionalUsd: number;
  reduceOnly: boolean;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return raw
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeVolatility(value: number): number {
  if (value <= 0) {
    return value;
  }

  // Allow both decimal (0.05) and percentage (5) inputs.
  return value > 1 ? value / 100 : value;
}

function extractVolatilityFromCandlePayload(payload: unknown): number | undefined {
  const rows = asObjectArray(payload);
  if (rows.length === 0 && Array.isArray(payload)) {
    const closesFromArray = payload
      .map((row) => {
        if (Array.isArray(row)) {
          return toNumber(row[4] ?? row[1]);
        }
        return undefined;
      })
      .filter((value): value is number => value !== undefined)
      .slice(0, 60);

    if (closesFromArray.length < 2) {
      return undefined;
    }

    let sumAbsReturns = 0;
    for (let index = 1; index < closesFromArray.length; index += 1) {
      const previous = closesFromArray[index - 1];
      const current = closesFromArray[index];
      if (previous === 0) {
        continue;
      }
      sumAbsReturns += Math.abs((current - previous) / previous);
    }

    return sumAbsReturns / (closesFromArray.length - 1);
  }

  const payloadObject = asObject(payload);
  const dataRows = Array.isArray(payloadObject?.data) ? payloadObject.data : [];
  const closes = dataRows
    .map((row) => {
      if (Array.isArray(row)) {
        return toNumber(row[4] ?? row[1]);
      }

      const objectRow = asObject(row);
      if (!objectRow) {
        return undefined;
      }

      return toNumber(objectRow.close) ?? toNumber(objectRow.c);
    })
    .filter((value): value is number => value !== undefined)
    .slice(0, 60);

  if (closes.length < 2) {
    return undefined;
  }

  let sumAbsReturns = 0;
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];
    if (previous === 0) {
      continue;
    }
    sumAbsReturns += Math.abs((current - previous) / previous);
  }

  return sumAbsReturns / (closes.length - 1);
}

function extractMarketVolatility(snapshot: JsonRecord | undefined): { value: number | null; source: string } {
  if (!snapshot) {
    return { value: null, source: "marketSnapshot-missing" };
  }

  const directCandidates: Array<{ key: string; value: unknown }> = [
    { key: "marketVolatility", value: snapshot.marketVolatility },
    { key: "volatility", value: snapshot.volatility },
    { key: "realizedVolatility", value: snapshot.realizedVolatility },
    { key: "volatilityPct", value: snapshot.volatilityPct },
  ];

  for (const candidate of directCandidates) {
    const parsed = toNumber(candidate.value);
    if (parsed !== undefined && parsed > 0) {
      return { value: normalizeVolatility(parsed), source: candidate.key };
    }
  }

  const candles = asObject(snapshot.candles);
  if (candles) {
    const vols = Object.values(candles)
      .map((payload) => extractVolatilityFromCandlePayload(payload))
      .filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);

    if (vols.length > 0) {
      const avg = vols.reduce((sum, value) => sum + value, 0) / vols.length;
      return { value: avg, source: "candles-avg-abs-return" };
    }
  }

  return { value: null, source: "not-available" };
}

/**
 * 从 rules 文件加载风险限额参数
 * 优先级: rules 文件 > 环境变量 > 硬编码默认值
 */
async function getPolicyLimitsFromRules(
  accountEquity: number,
  marketSnapshot?: JsonRecord,
): Promise<PolicyLimitsResult> {
  // 硬编码默认值（fallback）
  const defaults: PolicyLimits = {
    maxSingleOrderNotionalUsd: envNumber("TRADEMESH_MAX_SINGLE_ORDER_USD", 50_000),
    maxTotalOrderNotionalUsd: envNumber("TRADEMESH_MAX_TOTAL_ORDER_USD", 150_000),
    maxTotalExposureUsd: envNumber("TRADEMESH_MAX_TOTAL_EXPOSURE_USD", 300_000),
    initialMarginRate: envNumber("TRADEMESH_INITIAL_MARGIN_RATE", 0.12),
    whitelistSymbols: envList("TRADEMESH_SYMBOL_WHITELIST", ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"]),
    blacklistSymbols: envList("TRADEMESH_SYMBOL_BLACKLIST", ["LUNA", "UST", "FTT"]),
  };

  const marketVolatility = extractMarketVolatility(marketSnapshot);
  const defaultVolatilityMetadata: VolatilityAdjustmentMetadata = {
    threshold: 0.05,
    factor: 0.5,
    marketVolatility: marketVolatility.value,
    applied: false,
    source: marketVolatility.source,
  };

  try {
    const doc = await loadRules("risk-limits.md");
    
    // 读取单笔限额 (accountEquity * multiplier)
    const singleOrderRule = findRule(doc, "max-single-order");
    const singleMultiplier = singleOrderRule?.params?.multiplier 
      ? Number(singleOrderRule.params.multiplier) 
      : 0.02;
    
    // 读取总敞口限额 (accountEquity * multiplier)
    const totalExposureRule = findRule(doc, "max-total-exposure");
    const totalMultiplier = totalExposureRule?.params?.multiplier 
      ? Number(totalExposureRule.params.multiplier) 
      : 3;
    
    // 读取集中度上限
    const concentrationRule = findRule(doc, "max-symbol-concentration");
    const maxConcentration = concentrationRule?.params?.limit 
      ? Number(concentrationRule.params.limit) 
      : 40;

    // 波动率阈值调整
    const volatilityAdjustmentRule = findRule(doc, "volatility-adjustment");
    const threshold = volatilityAdjustmentRule?.params?.threshold
      ? Number(volatilityAdjustmentRule.params.threshold)
      : 0.05;
    const factor = volatilityAdjustmentRule?.params?.factor
      ? Number(volatilityAdjustmentRule.params.factor)
      : 0.5;

    // 如果有 accountEquity，计算动态限额
    let calculatedSingleLimit = accountEquity > 0 
      ? accountEquity * singleMultiplier 
      : defaults.maxSingleOrderNotionalUsd;
    
    const calculatedTotalExposure = accountEquity > 0 
      ? accountEquity * totalMultiplier 
      : defaults.maxTotalExposureUsd;

    const normalizedThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 0.05;
    const normalizedFactor = Number.isFinite(factor) && factor > 0 && factor <= 1 ? factor : 0.5;
    const shouldAdjustForVolatility =
      marketVolatility.value !== null && marketVolatility.value > normalizedThreshold;

    if (shouldAdjustForVolatility) {
      calculatedSingleLimit *= normalizedFactor;
    }

    return {
      limits: {
        ...defaults,
        maxSingleOrderNotionalUsd: calculatedSingleLimit,
        maxTotalExposureUsd: calculatedTotalExposure,
        // 存储集中度上限到 metadata（后续可用）
      },
      volatilityAdjustment: {
        threshold: normalizedThreshold,
        factor: normalizedFactor,
        marketVolatility: marketVolatility.value,
        applied: shouldAdjustForVolatility,
        source: marketVolatility.source,
      },
      loadedRules: doc.rules.map((rule) => rule.id),
    };
  } catch (error) {
    // rules 文件读取失败，使用默认值
    console.error("[policy-gate] Failed to load rules:", error);
    return {
      limits: defaults,
      volatilityAdjustment: defaultVolatilityMetadata,
      loadedRules: [],
    };
  }
}

function getPolicyLimits(): PolicyLimits {
  return {
    maxSingleOrderNotionalUsd: envNumber("TRADEMESH_MAX_SINGLE_ORDER_USD", 50_000),
    maxTotalOrderNotionalUsd: envNumber("TRADEMESH_MAX_TOTAL_ORDER_USD", 150_000),
    maxTotalExposureUsd: envNumber("TRADEMESH_MAX_TOTAL_EXPOSURE_USD", 300_000),
    initialMarginRate: envNumber("TRADEMESH_INITIAL_MARGIN_RATE", 0.12),
    whitelistSymbols: envList("TRADEMESH_SYMBOL_WHITELIST", ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"]),
    blacklistSymbols: envList("TRADEMESH_SYMBOL_BLACKLIST", ["LUNA", "UST", "FTT"]),
  };
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
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
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

function symbolFromInstId(instId: string): string {
  return instId.split("-")[0] ?? instId;
}

function extractProposalList(sharedState: Record<string, unknown>): SkillProposal[] {
  const raw = sharedState.proposals;
  if (!Array.isArray(raw)) {
    return [];
  }

  const proposals: SkillProposal[] = [];
  for (const rawEntry of raw) {
    const entry = asObject(rawEntry);
    if (!entry) {
      continue;
    }

    const name = toString(entry.name);
    const reason = toString(entry.reason);
    if (!name || !reason) {
      continue;
    }

    const orderPlan = Array.isArray(entry.orderPlan)
      ? (entry.orderPlan as SwapOrderPlanStep[])
      : undefined;
    const requiredModules = Array.isArray(entry.requiredModules)
      ? entry.requiredModules
          .map((item) => toString(item))
          .filter((item): item is string => Boolean(item))
      : undefined;

    proposals.push({
      name,
      reason,
      requiredModules,
      orderPlan,
    });
  }

  return proposals;
}

function extractOrderSlices(proposal: SkillProposal | undefined): OrderSlice[] {
  if (!proposal?.orderPlan || proposal.orderPlan.length === 0) {
    return [];
  }

  return proposal.orderPlan
    .filter((step) => step.kind === "swap-place-order")
    .map((step) => {
      const symbol = (step.symbol || symbolFromInstId(step.params.instId)).toUpperCase();
      const notionalUsd =
        step.targetNotionalUsd > 0
          ? step.targetNotionalUsd
          : Math.max(0, (toNumber(step.params.sz) ?? 0) * (toNumber(step.params.px) ?? step.referencePx));
      return {
        instId: step.params.instId,
        symbol,
        notionalUsd,
        reduceOnly: step.params.reduceOnly === true,
      };
    })
    .filter((slice) => slice.notionalUsd > 0);
}

function extractBalanceRows(payload: unknown): JsonRecord[] {
  const topRows = asObjectArray(payload);
  const detailRows = topRows.flatMap((row) => {
    const detail = row.details;
    if (!Array.isArray(detail)) {
      return [];
    }

    return detail
      .map((entry) => asObject(entry))
      .filter((entry): entry is JsonRecord => Boolean(entry));
  });

  return detailRows.length > 0 ? detailRows : topRows;
}

function extractAvailableUsd(balancePayload: unknown): number | null {
  const rows = extractBalanceRows(balancePayload);
  let total = 0;
  let hasValue = false;

  for (const row of rows) {
    const usdEq = toNumber(row.usdEq) ?? toNumber(row.eqUsd);
    if (usdEq !== undefined) {
      total += Math.max(0, usdEq);
      hasValue = true;
      continue;
    }

    const ccy = toString(row.ccy)?.toUpperCase();
    const avail = toNumber(row.availBal) ?? toNumber(row.availEq);
    if ((ccy === "USDT" || ccy === "USD") && avail !== undefined) {
      total += Math.max(0, avail);
      hasValue = true;
    }
  }

  return hasValue ? total : null;
}

function extractGrossExposureUsd(positionsPayload: unknown): number {
  const rows = asObjectArray(positionsPayload);
  let grossUsd = 0;

  for (const row of rows) {
    const position = Math.abs(toNumber(row.pos) ?? toNumber(row.sz) ?? 0);
    const notional =
      Math.abs(
        toNumber(row.notionalUsd) ??
          toNumber(row.notional) ??
          toNumber(row.posUsd) ??
          position * (toNumber(row.markPx) ?? toNumber(row.last) ?? 0),
      ) || 0;
    if (notional > 0) {
      grossUsd += notional;
    }
  }

  return grossUsd;
}

function extractPositionCount(positionsPayload: unknown): number {
  const rows = asObjectArray(positionsPayload);
  return rows.filter((row) => Math.abs(toNumber(row.pos) ?? toNumber(row.sz) ?? 0) > 0).length;
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const sharedState = context.sharedState as Record<string, unknown>;
  const marketSnapshot = asObject(sharedState.marketSnapshot);
  
  // 从 accountSnapshot 提取账户权益（用于计算动态限额）
  const accountSnap = asObject(sharedState.accountSnapshot);
  const accountEquity = accountSnap 
    ? (toNumber(accountSnap.totalEq) ?? toNumber(accountSnap.equity) ?? 0)
    : 0;
  
  // 从 rules 文件加载动态限额
  const policyLimits = await getPolicyLimitsFromRules(accountEquity, marketSnapshot);
  const { limits } = policyLimits;
  
  const proposals = extractProposalList(sharedState);
  const ranked = Array.isArray(sharedState.hedgePlannerRanked)
    ? (sharedState.hedgePlannerRanked as unknown[])
        .map((entry) => toString(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const selectedProposalName = ranked[0] ?? proposals[0]?.name;
  const selectedProposal =
    proposals.find((proposal) => proposal.name === selectedProposalName) ?? proposals[0];
  const slices = extractOrderSlices(selectedProposal);
  const totalOrderNotionalUsd = slices.reduce((sum, slice) => sum + slice.notionalUsd, 0);
  const plannedMarginUsd = slices
    .filter((slice) => !slice.reduceOnly)
    .reduce((sum, slice) => sum + slice.notionalUsd * limits.initialMarginRate, 0);

  const symbolViolations: string[] = [];
  for (const slice of slices) {
    if (limits.blacklistSymbols.includes(slice.symbol)) {
      symbolViolations.push(`symbol '${slice.symbol}' is blocked by blacklist`);
    }
    if (limits.whitelistSymbols.length > 0 && !limits.whitelistSymbols.includes(slice.symbol)) {
      symbolViolations.push(`symbol '${slice.symbol}' is not in whitelist`);
    }
  }

  const sizeViolations: string[] = [];
  for (const slice of slices) {
    if (slice.notionalUsd > limits.maxSingleOrderNotionalUsd) {
      sizeViolations.push(
        `${slice.instId} exceeds single-order limit (${slice.notionalUsd.toFixed(2)} > ${limits.maxSingleOrderNotionalUsd.toFixed(2)} USD)`,
      );
    }
  }
  if (totalOrderNotionalUsd > limits.maxTotalOrderNotionalUsd) {
    sizeViolations.push(
      `aggregate order notional exceeds total-order cap (${totalOrderNotionalUsd.toFixed(2)} > ${limits.maxTotalOrderNotionalUsd.toFixed(2)} USD)`,
    );
  }

  const accountSnapshot = asObject(sharedState.accountSnapshot);
  const accountSource = toString(accountSnapshot?.source) ?? "unknown";
  const availableUsd = extractAvailableUsd(accountSnapshot?.balance);
  const grossExposureUsd = extractGrossExposureUsd(accountSnapshot?.positions);
  const positionCount = extractPositionCount(accountSnapshot?.positions);
  const projectedExposureUsd = grossExposureUsd + totalOrderNotionalUsd;
  const accountViolations: string[] = [];
  if (accountSource === "okx-cli") {
    if (availableUsd === null) {
      accountViolations.push("available USD-equivalent balance is missing from account payload");
    } else if (plannedMarginUsd > availableUsd) {
      accountViolations.push(
        `estimated margin ${plannedMarginUsd.toFixed(2)} exceeds available balance ${availableUsd.toFixed(2)} USD`,
      );
    }

    if (projectedExposureUsd > limits.maxTotalExposureUsd) {
      accountViolations.push(
        `projected exposure ${projectedExposureUsd.toFixed(2)} exceeds cap ${limits.maxTotalExposureUsd.toFixed(2)} USD`,
      );
    }
  } else if (context.plane === "live") {
    accountViolations.push("live plane requires accountSnapshot from okx CLI for dynamic approval");
  }

  const violations = [...symbolViolations, ...sizeViolations, ...accountViolations];
  const allowedModules =
    context.plane === "research"
      ? ["account", "market"]
      : selectedProposal?.requiredModules && selectedProposal.requiredModules.length > 0
        ? [...new Set(selectedProposal.requiredModules)]
        : ["account", "market", "swap", "option"];

  const decision =
    context.plane === "research"
      ? "blocked-research"
      : violations.length > 0
        ? "blocked"
        : context.plane === "live"
          ? "require-approval"
          : "approved-demo";
  const policyNotes =
    context.plane === "research"
      ? ["Research plane blocks all write actions."]
      : violations.length > 0
        ? violations
        : context.plane === "live"
          ? ["Live plane requires explicit approval before execution."]
          : ["Demo proposal passed dynamic policy checks."];

  const facts = [
    `Requested plane: ${context.plane}`,
    `Selected proposal: ${selectedProposal?.name ?? "n/a"}`,
    `Account source: ${accountSource}`,
    `Open positions: ${positionCount}, gross exposure: ${grossExposureUsd.toFixed(2)} USD`,
    `Planned order notional: ${totalOrderNotionalUsd.toFixed(2)} USD, projected exposure: ${projectedExposureUsd.toFixed(2)} USD`,
    `Available balance: ${availableUsd === null ? "n/a" : `${availableUsd.toFixed(2)} USD`}`,
    `Whitelist: ${limits.whitelistSymbols.join(", ")}`,
    `Blacklist: ${limits.blacklistSymbols.join(", ")}`,
    `Volatility adjustment: ${policyLimits.volatilityAdjustment.applied ? "applied" : "not applied"} (volatility=${
      policyLimits.volatilityAdjustment.marketVolatility === null
        ? "n/a"
        : policyLimits.volatilityAdjustment.marketVolatility.toFixed(4)
    }, threshold=${policyLimits.volatilityAdjustment.threshold.toFixed(4)}, factor=${policyLimits.volatilityAdjustment.factor.toFixed(2)}).`,
  ];

  return {
    skill: "policy-gate",
    stage: "guardrail",
    goal: context.goal,
    summary: "Apply dynamic account-aware approval checks with symbol filters and risk limits.",
    facts,
    constraints: {
      mustDemoFirst: true,
      requiredApprovalForLive: true,
      requiredModules: allowedModules,
      selectedProposal: selectedProposal?.name ?? null,
      limits,
      volatilityAdjustment: policyLimits.volatilityAdjustment,
      totalOrderNotionalUsd,
      projectedExposureUsd,
    },
    proposal: [],
    risk: {
      score:
        context.plane === "research"
          ? 0.08
          : violations.length > 0
            ? 0.9
            : context.plane === "live"
              ? 0.75
              : 0.3,
      maxLoss:
        context.plane === "research"
          ? "No write path"
          : context.plane === "demo"
            ? "Demo capital only"
            : "Potential live capital loss",
      needsApproval: context.plane !== "research",
      reasons: policyNotes,
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules,
    },
    handoff: "official-executor",
    metadata: {
      decision,
      policyNotes,
      selectedProposal: selectedProposal?.name ?? null,
      accountSource,
      availableUsd,
      grossExposureUsd,
      totalOrderNotionalUsd,
      volatilityAdjustment: policyLimits.volatilityAdjustment,
      loadedRules: policyLimits.loadedRules,
    },
    timestamp: new Date().toISOString(),
  };
}
