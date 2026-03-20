import type { SkillContext, SkillOutput } from "../../runtime/types.js";
import { readMarketSnapshot } from "../../runtime/okx.js";
import { loadRules, findRule } from "../../runtime/rules-loader.js";

function describeTicker(instId: string, payload: unknown): string {
  if (Array.isArray(payload)) {
    return `${instId} ticker payload loaded from okx CLI (${payload.length} items).`;
  }

  if (payload && typeof payload === "object") {
    return `${instId} ticker payload loaded from okx CLI (${Object.keys(payload as Record<string, unknown>).length} keys).`;
  }

  return `${instId} ticker payload loaded from okx CLI.`;
}

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

function unwrapDataRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asObject(payload);
  if (!record) {
    return [];
  }

  const data = record.data;
  return Array.isArray(data) ? data : [];
}

function extractTickerRegime(instId: string, payload: unknown): string | null {
  const rows = unwrapDataRows(payload);
  const first = asObject(rows[0]);
  if (!first) {
    return null;
  }

  const last = toNumber(first.last) ?? toNumber(first.lastPx) ?? toNumber(first.close);
  const open24h = toNumber(first.open24h) ?? toNumber(first.open) ?? toNumber(first.sodUtc0);
  if (last === undefined || open24h === undefined || open24h === 0) {
    return null;
  }

  const changePct = ((last - open24h) / open24h) * 100;
  if (Math.abs(changePct) >= 3) {
    return `${instId} regime: strong ${changePct > 0 ? "uptrend" : "downtrend"} (${changePct.toFixed(2)}% vs 24h open).`;
  }

  return `${instId} regime: range/mean-reversion (${changePct.toFixed(2)}% vs 24h open).`;
}

function extractCandleVolatility(instId: string, payload: unknown): string | null {
  const rows = unwrapDataRows(payload);
  const closes = rows
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
    .slice(0, 48);

  if (closes.length < 2) {
    return null;
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

  const avgAbsReturnPct = (sumAbsReturns / (closes.length - 1)) * 100;
  if (avgAbsReturnPct >= 2) {
    return `${instId} candles: volatility is high (avg |ret| ${avgAbsReturnPct.toFixed(2)}% per bar).`;
  }
  if (avgAbsReturnPct >= 1) {
    return `${instId} candles: volatility is moderate (avg |ret| ${avgAbsReturnPct.toFixed(2)}% per bar).`;
  }
  return `${instId} candles: volatility is compressed (avg |ret| ${avgAbsReturnPct.toFixed(2)}% per bar).`;
}

function extractFundingNote(instId: string, payload: unknown): string | null {
  const rows = unwrapDataRows(payload);
  const first = asObject(rows[0]);
  if (!first) {
    return null;
  }

  const fundingRate =
    toNumber(first.fundingRate) ??
    toNumber(first.funding_rate) ??
    toNumber(first.nextFundingRate);
  if (fundingRate === undefined) {
    return null;
  }

  const rateBps = fundingRate * 10_000;
  if (fundingRate > 0) {
    return `${instId} funding: longs are paying (${rateBps.toFixed(2)} bps).`;
  }
  if (fundingRate < 0) {
    return `${instId} funding: shorts are paying (${Math.abs(rateBps).toFixed(2)} bps).`;
  }
  return `${instId} funding: near neutral (0.00 bps).`;
}

function parseBookLevelSize(level: unknown): number {
  if (Array.isArray(level)) {
    return toNumber(level[1]) ?? 0;
  }

  const row = asObject(level);
  if (!row) {
    return 0;
  }

  return toNumber(row.sz) ?? toNumber(row.size) ?? toNumber(row.qty) ?? 0;
}

function extractOrderbookNote(instId: string, payload: unknown): string | null {
  const rows = unwrapDataRows(payload);
  const first = asObject(rows[0]);
  if (!first) {
    return null;
  }

  const bids = Array.isArray(first.bids) ? first.bids : [];
  const asks = Array.isArray(first.asks) ? first.asks : [];
  if (bids.length === 0 && asks.length === 0) {
    return null;
  }

  const bidDepth = bids.slice(0, 10).reduce((sum, level) => sum + parseBookLevelSize(level), 0);
  const askDepth = asks.slice(0, 10).reduce((sum, level) => sum + parseBookLevelSize(level), 0);
  const totalDepth = bidDepth + askDepth;
  if (totalDepth <= 0) {
    return null;
  }

  const imbalance = (bidDepth - askDepth) / totalDepth;
  if (imbalance >= 0.2) {
    return `${instId} orderbook: bid-skewed (${(imbalance * 100).toFixed(1)}%).`;
  }
  if (imbalance <= -0.2) {
    return `${instId} orderbook: ask-skewed (${(imbalance * 100).toFixed(1)}%).`;
  }
  return `${instId} orderbook: balanced (${(imbalance * 100).toFixed(1)}%).`;
}

interface CandlePoint {
  high: number;
  low: number;
  close: number;
}

interface TrendScoreResult {
  instId: string;
  direction: "up" | "down" | "sideways";
  strength: number;
  confidence: "low" | "medium" | "high";
  breakout: "up" | "down" | "none";
  atrPct: number | null;
}

function parseCandles(payload: unknown): CandlePoint[] {
  const rows = unwrapDataRows(payload);
  return rows
    .map((row) => {
      if (Array.isArray(row)) {
        const high = toNumber(row[2]);
        const low = toNumber(row[3]);
        const close = toNumber(row[4] ?? row[1]);
        if (high === undefined || low === undefined || close === undefined) {
          return undefined;
        }
        return { high, low, close };
      }

      const objectRow = asObject(row);
      if (!objectRow) {
        return undefined;
      }

      const high = toNumber(objectRow.high) ?? toNumber(objectRow.h);
      const low = toNumber(objectRow.low) ?? toNumber(objectRow.l);
      const close = toNumber(objectRow.close) ?? toNumber(objectRow.c);
      if (high === undefined || low === undefined || close === undefined) {
        return undefined;
      }
      return { high, low, close };
    })
    .filter((candle): candle is CandlePoint => Boolean(candle));
}

function movingAverage(candles: CandlePoint[], period: number): number | null {
  if (candles.length < period || period <= 0) {
    return null;
  }

  const closes = candles.slice(0, period).map((candle) => candle.close);
  const sum = closes.reduce((acc, value) => acc + value, 0);
  return sum / closes.length;
}

function atr(candles: CandlePoint[], period: number): number | null {
  if (candles.length < period + 1 || period <= 0) {
    return null;
  }

  // ATR uses chronological data for prevClose linkage.
  const chronological = [...candles].reverse();
  const trValues: number[] = [];
  for (let index = 1; index < chronological.length; index += 1) {
    const current = chronological[index];
    const previous = chronological[index - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    trValues.push(tr);
  }

  if (trValues.length < period) {
    return null;
  }

  const recentTr = trValues.slice(-period);
  const sum = recentTr.reduce((acc, value) => acc + value, 0);
  return sum / recentTr.length;
}

function extractTrendScore(instId: string, payload: unknown): TrendScoreResult | null {
  const candles = parseCandles(payload);
  if (candles.length < 20) {
    return null;
  }

  const currentClose = candles[0]?.close;
  if (!currentClose || currentClose <= 0) {
    return null;
  }

  const ma20 = movingAverage(candles, 20);
  const ma55 = movingAverage(candles, 55);
  const breakoutWindow = candles.length >= 21 ? candles.slice(1, 21) : candles.slice(0, 20);
  const high20 = Math.max(...breakoutWindow.map((candle) => candle.high));
  const low20 = Math.min(...breakoutWindow.map((candle) => candle.low));
  const atr14 = atr(candles, 14);
  const atrPct = atr14 !== null && currentClose > 0 ? atr14 / currentClose : null;

  let upScore = 0;
  let downScore = 0;

  if (ma20 !== null && ma55 !== null) {
    if (currentClose > ma20 && ma20 > ma55) {
      upScore += 40;
    } else if (currentClose < ma20 && ma20 < ma55) {
      downScore += 40;
    } else {
      upScore += 10;
      downScore += 10;
    }
  }

  let breakout: TrendScoreResult["breakout"] = "none";
  if (currentClose > high20) {
    upScore += 35;
    breakout = "up";
  } else if (currentClose < low20) {
    downScore += 35;
    breakout = "down";
  } else if (ma20 !== null) {
    if (currentClose >= ma20) {
      upScore += 10;
    } else {
      downScore += 10;
    }
  }

  if (atrPct !== null) {
    const atrWeight = atrPct >= 0.04 ? 25 : atrPct >= 0.02 ? 18 : atrPct >= 0.01 ? 12 : 6;
    if (upScore >= downScore) {
      upScore += atrWeight;
    } else {
      downScore += atrWeight;
    }
  }

  const scoreDiff = Math.abs(upScore - downScore);
  const topScore = Math.max(upScore, downScore);
  const strength = Math.min(100, Math.max(0, topScore));
  const direction: TrendScoreResult["direction"] =
    scoreDiff < 12 ? "sideways" : upScore > downScore ? "up" : "down";
  const confidence: TrendScoreResult["confidence"] =
    strength >= 75 && scoreDiff >= 20 ? "high" : strength >= 50 && scoreDiff >= 10 ? "medium" : "low";

  return {
    instId,
    direction,
    strength,
    confidence,
    breakout,
    atrPct,
  };
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const symbols = (context.sharedState.symbols as string[] | undefined) ?? ["BTC", "ETH", "SOL"];
  const instIds = symbols.map((symbol) => `${symbol}-USDT`);
  const marketSnapshot = readMarketSnapshot(instIds, context.plane);
  
  // 从 trend-following.md 加载趋势判断规则
  let trendRules: Record<string, unknown> = {};
  let scoreRuleLoaded = false;
  try {
    const doc = await loadRules("trend-following.md");
    const maRule = findRule(doc, "ma-trend-detection");
    const breakoutRule = findRule(doc, "breakout-detection");
    const atrRule = findRule(doc, "atr-volatility-regime");
    const scoreRule = findRule(doc, "trend-score-calc");
    
    trendRules = {
      loadedRules: doc.rules.map(r => r.id),
      hasMA: !!maRule,
      hasBreakout: !!breakoutRule,
      hasATR: !!atrRule,
      hasScore: !!scoreRule,
    };
    scoreRuleLoaded = Boolean(scoreRule);
  } catch (error) {
    console.error("[market-scan] Failed to load trend rules:", error);
  }
  
  const placeholderFacts = symbols.map((symbol, index) => {
    const regimes = [
      `${symbol} realized volatility is elevated versus the recent range`,
      `${symbol} liquidity remains acceptable for staged hedges`,
      `${symbol} downside skew is firm enough to justify option comparisons`,
    ];
    return regimes[index % regimes.length];
  });
  const marketFacts =
    marketSnapshot.source === "okx-cli"
      ? [
          ...Object.entries(marketSnapshot.tickers).map(([instId, payload]) =>
            describeTicker(instId, payload),
          ),
          ...Object.entries(marketSnapshot.tickers)
            .map(([instId, payload]) => extractTickerRegime(instId, payload))
            .filter((note): note is string => Boolean(note)),
          ...Object.entries(marketSnapshot.candles)
            .map(([instId, payload]) => extractCandleVolatility(instId, payload))
            .filter((note): note is string => Boolean(note)),
          ...Object.entries(marketSnapshot.fundingRates)
            .map(([instId, payload]) => extractFundingNote(instId, payload))
            .filter((note): note is string => Boolean(note)),
          ...Object.entries(marketSnapshot.orderbooks)
            .map(([instId, payload]) => extractOrderbookNote(instId, payload))
            .filter((note): note is string => Boolean(note)),
        ]
      : placeholderFacts;

  const trendScores = Object.entries(marketSnapshot.candles)
    .map(([instId, payload]) => extractTrendScore(instId, payload))
    .filter((result): result is TrendScoreResult => Boolean(result));
  const trendFacts = trendScores.map((result) => {
    const atrPctText = result.atrPct === null ? "n/a" : `${(result.atrPct * 100).toFixed(2)}%`;
    return `${result.instId} trend-score: ${result.direction} (strength=${result.strength}/100, confidence=${result.confidence}, breakout=${result.breakout}, atr=${atrPctText}).`;
  });

  if (trendFacts.length > 0) {
    marketFacts.push(...trendFacts);
  } else {
    marketFacts.push("Trend score: unavailable (insufficient candle history for MA55/ATR14).");
  }

  if (marketSnapshot.errors.length > 0) {
    marketFacts.push(`Market read fallback reason: ${marketSnapshot.errors[0]}`);
  }

  if (marketSnapshot.source === "okx-cli") {
    marketFacts.push(
      `Snapshot coverage: tickers=${Object.keys(marketSnapshot.tickers).length}, candles=${Object.keys(marketSnapshot.candles).length}, funding=${Object.keys(marketSnapshot.fundingRates).length}, orderbook=${Object.keys(marketSnapshot.orderbooks).length}.`,
    );
  }

  context.sharedState.marketFacts = marketFacts;
  context.sharedState.marketSnapshot = marketSnapshot;
  context.sharedState.marketTrendScores = trendScores;

  return {
    skill: "market-scan",
    stage: "sensor",
    goal: context.goal,
    summary: "Read market regime, liquidity, and downside context before ranking hedge proposals.",
    facts: marketFacts,
    constraints: {
      selectedSymbols: symbols,
      requiredModules: ["market"],
      marketSnapshotMode: marketSnapshot.source,
      marketSnapshotCoverage: {
        tickers: Object.keys(marketSnapshot.tickers).length,
        candles: Object.keys(marketSnapshot.candles).length,
        fundingRates: Object.keys(marketSnapshot.fundingRates).length,
        orderbooks: Object.keys(marketSnapshot.orderbooks).length,
      },
    },
    proposal: [],
    risk: {
      score: 0.18,
      maxLoss: "Market drift remains unbounded without a hedge",
      needsApproval: false,
      reasons:
        marketSnapshot.source === "okx-cli"
          ? ["Snapshot loaded from okx CLI ticker/candle/funding/orderbook reads."]
          : ["Snapshot is placeholder data until the OKX CLI market wrapper is connected."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["market"],
    },
    handoff: "hedge-planner",
    metadata: {
      snapshotMode: marketSnapshot.source,
      marketCommands: marketSnapshot.commands,
      marketErrors: marketSnapshot.errors,
      trendRules,
      trendScoreRuleLoaded: scoreRuleLoaded,
      trendScores,
    },
    timestamp: new Date().toISOString(),
  };
}
