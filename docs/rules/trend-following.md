# 趋势判断规则 — Market Scan 决策依据

> 基于《海龟交易法则》的趋势跟踪框架

---

## 核心原则

1. **顺势而为** — 不要逆势交易
2. **多周期确认** — 用多个时间框架验证趋势
3. **突破确认** — 价格突破关键位才行动

---

## 趋势判断指标

### 1. 移动平均线（MA）

```typescript
// @rule ma-trend-detection description="MA 趋势判断" source="turtle-traders"
const ma20 = calculateMA(candles, 20);
const ma55 = calculateMA(candles, 55);

if (currentPx > ma20 && ma20 > ma55) {
  trend = "uptrend";
} else if (currentPx < ma20 && ma20 < ma55) {
  trend = "downtrend";
} else {
  trend = "sideways";
}
```

### 2. 突破系统

```typescript
// @rule breakout-detection description="20 日突破系统" source="turtle-traders"
const high20 = Math.max(...candles.slice(-20).map(c => c.high));
const low20 = Math.min(...candles.slice(-20).map(c => c.low));

if (currentPx > high20) {
  signal = "breakout-up";
} else if (currentPx < low20) {
  signal = "breakout-down";
}
```

### 3. 波动率状态

```typescript
// @rule atr-volatility-regime description="ATR 波动率状态" source="turtle-traders"
const atr14 = calculateATR(candles, 14);
const atrPercentile = getPercentile(atr14, atrHistory);

if (atrPercentile > 80) {
  regime = "high-volatility";
} else if (atrPercentile < 20) {
  regime = "low-volatility";
}
```

---

## 趋势强度评分

```typescript
// @rule trend-score-calc description="趋势强度评分算法" source="turtle-traders"
interface TrendScore {
  direction: "up" | "down" | "sideways";
  strength: number; // 0-100
  confidence: "low" | "medium" | "high";
}

function calculateTrendScore(candles: Candle[]): TrendScore {
  let score = 0;

  // MA 排列（30 分）
  if (currentPx > ma20 > ma55) score += 30;

  // 突破确认（25 分）
  if (currentPx > high20) score += 25;

  // 趋势一致性（25 分）
  const higherHighs = countHigherHighs(candles, 10);
  score += higherHighs * 2.5;

  // 成交量确认（20 分）
  if (volume > avgVolume * 1.5) score += 20;

  return {
    direction: score >= 60 ? "up" : score <= 40 ? "down" : "sideways",
    strength: score,
    confidence: score >= 70 ? "high" : score >= 50 ? "medium" : "low",
  };
}
```

---

## 环境分类

| 趋势 | 波动率 | 推荐操作 |
|------|--------|---------|
| Up | Low | 持有 + 轻仓对冲 |
| Up | High | 持有 + Protective Put |
| Down | Low | 减仓 + Perp Short |
| Down | High | 平仓 + 等待 |
| Sideways | Any | 观望 + Collar |

---

## 假信号过滤

### 1. 多周期确认

```typescript
// @rule multi-timeframe-confirm description="多周期确认" source="turtle-traders"
// 只在 1D 和 4H 同向时行动
if (trend1D === trend4H) {
  signalConfidence = "high";
}
```

### 2. 成交量确认

```typescript
// @rule volume-confirm description="成交量确认突破" source="turtle-traders"
// 突破需要成交量配合
if (currentPx > high20 && volume > avgVolume * 1.2) {
  validBreakout = true;
}
```

### 3. 回踩确认

```typescript
// @rule pullback-confirm description="回踩确认入场" source="turtle-traders"
// 等待回踩支撑再入场
if (currentPx > ma20 && pullback <= 0.618 * breakout) {
  entrySignal = true;
}
```

---

**来源**: 《海龟交易法则》第 2-3 章
**应用模块**: market-scan
