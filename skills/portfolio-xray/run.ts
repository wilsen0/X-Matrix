import type { SkillContext, SkillOutput } from "../../runtime/types.js";
import { readAccountSnapshot } from "../../runtime/okx.js";

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL"];
const IGNORED_SYMBOLS = new Set(["CLI", "OKX", "JSON", "DEMO", "LIVE"]);

type JsonRecord = Record<string, unknown>;

interface DirectionalExposure {
  longUsd: number;
  shortUsd: number;
  netUsd: number;
  dominantSide: "long" | "short" | "flat";
}

interface ConcentrationSummary {
  grossUsd: number;
  topSymbol: string;
  topSharePct: number;
  top3: Array<{ symbol: string; usd: number; sharePct: number }>;
}

interface LeverageHotspot {
  instId: string;
  symbol: string;
  leverage: number;
  notionalUsd: number;
}

interface FeeDragSummary {
  makerRateBps?: number;
  takerRateBps?: number;
  recentFeePaidUsd: number;
  recentFeeRows: number;
}

interface PortfolioRiskProfile {
  directionalExposure: DirectionalExposure;
  concentration: ConcentrationSummary;
  leverageHotspots: LeverageHotspot[];
  feeDrag: FeeDragSummary;
}

function extractSymbols(goal: string): string[] {
  const matches = goal.toUpperCase().match(/\b[A-Z]{2,6}\b/g) ?? [];
  const filtered = matches.filter((symbol) => !IGNORED_SYMBOLS.has(symbol));
  return filtered.length > 0 ? [...new Set(filtered)] : DEFAULT_SYMBOLS;
}

function extractDrawdownTarget(goal: string): string {
  const matches = [...goal.matchAll(/(\d+(\.\d+)?)\s*%/g)];
  const finalMatch = matches.at(-1);
  return finalMatch ? `${finalMatch[1]}%` : "4%";
}

function describePayload(label: string, payload: unknown): string {
  if (Array.isArray(payload)) {
    return `${label} payload loaded from okx CLI (${payload.length} items).`;
  }

  if (payload && typeof payload === "object") {
    return `${label} payload loaded from okx CLI (${Object.keys(payload as Record<string, unknown>).length} keys).`;
  }

  return `${label} payload loaded from okx CLI.`;
}

function asObject(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}

function asObjectArray(value: unknown): JsonRecord[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => asObject(item))
      .filter((item): item is JsonRecord => Boolean(item));
  }

  const payload = asObject(value);
  if (!payload) {
    return [];
  }

  const data = payload.data;
  if (Array.isArray(data)) {
    return data
      .map((item) => asObject(item))
      .filter((item): item is JsonRecord => Boolean(item));
  }

  return [];
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

function formatUsd(value: number): string {
  return `$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function symbolFromInstId(instId: string): string {
  return instId.split("-")[0] ?? instId;
}

function extractPositionRows(payload: unknown): JsonRecord[] {
  return asObjectArray(payload);
}

function extractBalanceRows(payload: unknown): JsonRecord[] {
  const baseRows = asObjectArray(payload);
  const detailRows = baseRows.flatMap((row) => {
    const details = row.details;
    return Array.isArray(details)
      ? details
          .map((item) => asObject(item))
          .filter((item): item is JsonRecord => Boolean(item))
      : [];
  });

  return detailRows.length > 0 ? detailRows : baseRows;
}

function extractDirectionalExposure(positionRows: JsonRecord[]): DirectionalExposure {
  let longUsd = 0;
  let shortUsd = 0;

  for (const row of positionRows) {
    const pos = toNumber(row.pos) ?? toNumber(row.sz) ?? 0;
    const sideHint = toString(row.posSide)?.toLowerCase();
    const inferredSide: "long" | "short" =
      sideHint === "short" ? "short" : sideHint === "long" ? "long" : pos < 0 ? "short" : "long";
    const notional =
      Math.abs(
        toNumber(row.notionalUsd) ??
          toNumber(row.notional) ??
          toNumber(row.posUsd) ??
          (Math.abs(pos) * (toNumber(row.markPx) ?? toNumber(row.last) ?? 0)),
      ) || 0;

    if (notional <= 0) {
      continue;
    }

    if (inferredSide === "long") {
      longUsd += notional;
    } else {
      shortUsd += notional;
    }
  }

  const netUsd = longUsd - shortUsd;
  const dominantSide: "long" | "short" | "flat" =
    netUsd > 0 ? "long" : netUsd < 0 ? "short" : "flat";

  return { longUsd, shortUsd, netUsd, dominantSide };
}

function extractConcentration(positionRows: JsonRecord[]): ConcentrationSummary {
  const bySymbol = new Map<string, number>();

  for (const row of positionRows) {
    const instId = toString(row.instId) ?? "UNKNOWN";
    const symbol = symbolFromInstId(instId);
    const notional =
      Math.abs(
        toNumber(row.notionalUsd) ??
          toNumber(row.notional) ??
          toNumber(row.posUsd) ??
          (Math.abs(toNumber(row.pos) ?? toNumber(row.sz) ?? 0) *
            (toNumber(row.markPx) ?? toNumber(row.last) ?? 0)),
      ) || 0;

    if (notional <= 0) {
      continue;
    }

    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + notional);
  }

  const entries = [...bySymbol.entries()].sort((left, right) => right[1] - left[1]);
  const grossUsd = entries.reduce((total, [, usd]) => total + usd, 0);
  const topSymbol = entries[0]?.[0] ?? "n/a";
  const topUsd = entries[0]?.[1] ?? 0;
  const topSharePct = grossUsd > 0 ? (topUsd / grossUsd) * 100 : 0;
  const top3 = entries.slice(0, 3).map(([symbol, usd]) => ({
    symbol,
    usd,
    sharePct: grossUsd > 0 ? (usd / grossUsd) * 100 : 0,
  }));

  return { grossUsd, topSymbol, topSharePct, top3 };
}

function extractLeverageHotspots(positionRows: JsonRecord[]): LeverageHotspot[] {
  const hotspots: LeverageHotspot[] = [];

  for (const row of positionRows) {
    const leverage = toNumber(row.lever) ?? toNumber(row.leverage);
    if (leverage === undefined || leverage < 3) {
      continue;
    }

    const instId = toString(row.instId) ?? "UNKNOWN";
    const symbol = symbolFromInstId(instId);
    const notionalUsd =
      Math.abs(
        toNumber(row.notionalUsd) ??
          toNumber(row.notional) ??
          toNumber(row.posUsd) ??
          (Math.abs(toNumber(row.pos) ?? toNumber(row.sz) ?? 0) *
            (toNumber(row.markPx) ?? toNumber(row.last) ?? 0)),
      ) || 0;

    hotspots.push({ instId, symbol, leverage, notionalUsd });
  }

  return hotspots.sort((left, right) => right.leverage - left.leverage).slice(0, 5);
}

function extractMaxFeeRateBps(payload: unknown, keys: string[]): number | undefined {
  const rows = asObjectArray(payload);
  const candidates = rows.flatMap((row) =>
    keys
      .map((key) => toNumber(row[key]))
      .filter((value): value is number => value !== undefined),
  );

  if (candidates.length === 0) {
    return undefined;
  }

  return Math.max(...candidates.map((value) => Math.abs(value) * 10_000));
}

function extractFeeDrag(feeRates: unknown, bills: unknown): FeeDragSummary {
  const billRows = asObjectArray(bills);
  let recentFeePaidUsd = 0;
  let recentFeeRows = 0;

  for (const row of billRows) {
    const fee =
      toNumber(row.fee) ??
      toNumber(row.fillFee) ??
      toNumber(row.execFee) ??
      toNumber(row.tradeFee);

    if (fee === undefined || fee === 0) {
      continue;
    }

    recentFeeRows += 1;
    if (fee < 0) {
      recentFeePaidUsd += Math.abs(fee);
    }
  }

  return {
    makerRateBps: extractMaxFeeRateBps(feeRates, ["maker", "makerU", "makerFeeRate"]),
    takerRateBps: extractMaxFeeRateBps(feeRates, ["taker", "takerU", "takerFeeRate"]),
    recentFeePaidUsd,
    recentFeeRows,
  };
}

function buildRiskProfile(
  accountSnapshot: ReturnType<typeof readAccountSnapshot>,
): PortfolioRiskProfile {
  const positionRows = extractPositionRows(accountSnapshot.positions);

  return {
    directionalExposure: extractDirectionalExposure(positionRows),
    concentration: extractConcentration(positionRows),
    leverageHotspots: extractLeverageHotspots(positionRows),
    feeDrag: extractFeeDrag(accountSnapshot.feeRates, accountSnapshot.bills),
  };
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const symbols = extractSymbols(context.goal);
  const drawdownTarget = extractDrawdownTarget(context.goal);
  const accountSnapshot = readAccountSnapshot(context.plane);
  const riskProfile = buildRiskProfile(accountSnapshot);
  const facts = [
    `Detected symbols: ${symbols.join(", ")}`,
    `Target drawdown cap interpreted as ${drawdownTarget}`,
  ];

  if (accountSnapshot.source === "okx-cli") {
    if (accountSnapshot.balance !== undefined) {
      facts.push(describePayload("Account balance", accountSnapshot.balance));
    }
    if (accountSnapshot.positions !== undefined) {
      facts.push(describePayload("Account positions", accountSnapshot.positions));
    }
    if (accountSnapshot.feeRates !== undefined) {
      facts.push(describePayload("Account fee rates", accountSnapshot.feeRates));
    }
    if (accountSnapshot.bills !== undefined) {
      facts.push(describePayload("Account bills", accountSnapshot.bills));
    }
  } else {
    facts.push("No live account connector is configured, so the portfolio is treated as a prompt-derived working set.");
  }

  const direction = riskProfile.directionalExposure;
  facts.push(
    `Directional exposure: long ${formatUsd(direction.longUsd)} / short ${formatUsd(direction.shortUsd)} (net ${
      direction.netUsd >= 0 ? "+" : "-"
    }${formatUsd(direction.netUsd)}).`,
  );

  const concentration = riskProfile.concentration;
  if (concentration.grossUsd > 0) {
    facts.push(
      `Concentration: ${concentration.topSymbol} takes ${concentration.topSharePct.toFixed(1)}% of gross exposure (${formatUsd(concentration.grossUsd)} total).`,
    );
  } else {
    facts.push("Concentration: insufficient notional data from positions payload.");
  }

  if (riskProfile.leverageHotspots.length > 0) {
    const hotspot = riskProfile.leverageHotspots[0];
    facts.push(
      `Leverage hotspots: ${riskProfile.leverageHotspots.length} position(s) >= 3x, highest ${hotspot.instId} at ${hotspot.leverage.toFixed(2)}x.`,
    );
  } else {
    facts.push("Leverage hotspots: no position above 3x was detected.");
  }

  const feeDrag = riskProfile.feeDrag;
  if (feeDrag.recentFeeRows > 0 || feeDrag.takerRateBps !== undefined || feeDrag.makerRateBps !== undefined) {
    facts.push(
      `Fee drag: recent paid fees ${formatUsd(feeDrag.recentFeePaidUsd)} across ${feeDrag.recentFeeRows} bill rows, maker/taker up to ${
        feeDrag.makerRateBps?.toFixed(2) ?? "n/a"
      }/${feeDrag.takerRateBps?.toFixed(2) ?? "n/a"} bps.`,
    );
  } else {
    facts.push("Fee drag: no fee-rate or bill-fee datapoints were parsed.");
  }

  if (accountSnapshot.errors.length > 0) {
    facts.push(`Account read fallback reason: ${accountSnapshot.errors[0]}`);
  }

  context.sharedState.symbols = symbols;
  context.sharedState.drawdownTarget = drawdownTarget;
  context.sharedState.portfolioSource = accountSnapshot.source;
  context.sharedState.accountSnapshot = accountSnapshot;
  context.sharedState.portfolioRiskProfile = riskProfile;

  return {
    skill: "portfolio-xray",
    stage: "sensor",
    goal: context.goal,
    summary: "Turn the goal into a provisional portfolio risk map before any hedge planning.",
    facts,
    constraints: {
      selectedSymbols: symbols,
      drawdownTarget,
      requiredModules: ["account"],
      portfolioSource: accountSnapshot.source,
      portfolioRiskProfile: riskProfile,
    },
    proposal: [],
    risk: {
      score: 0.12,
      maxLoss: "Unknown until a hedge plan is selected",
      needsApproval: false,
      reasons:
        accountSnapshot.source === "okx-cli"
          ? ["Portfolio context loaded from okx CLI."]
          : ["Prompt-derived portfolio only."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["account"],
    },
    handoff: "market-scan",
    metadata: {
      symbols,
      drawdownTarget,
      accountSource: accountSnapshot.source,
      accountCommands: accountSnapshot.commands,
      accountErrors: accountSnapshot.errors,
      riskProfile,
    },
    timestamp: new Date().toISOString(),
  };
}
