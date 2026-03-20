# 对冲策略选择 — Hedge Planner 决策依据

> 基于《期权波动率交易》+《海龟交易法则》的对冲框架

---

## 核心原则

1. **成本效率** — 用最小的成本获得足够的保护
2. **保持上行** — 不要过度对冲损失上涨空间
3. **动态调整** — 根据市场环境选择策略

---

## 策略选择矩阵

| 场景 | 净敞口 | 波动率 | 推荐策略 | 理由 |
|------|-------|--------|---------|------|
| 牛市回调 | Long | 低 | Perp Short | 低成本，快速 |
| 震荡市 | Long | 中 | Protective Put | 买保险，保留上行 |
| 高波动 | Long | 高 | Collar | 用 call 融资 put |
| 极端风险 | Long | 极高 | 平仓部分 | 直接降敞口 |

---

## 策略详解

### 1. Perp Short（永续空单）

**适用**：
- 需要快速对冲
- 资金费率合理（< 0.01%）
- 短期（< 7 天）

**参数计算**：
```typescript
// @rule perp-short-calc description="Perp Short 对冲计算" strategy="perp-short"
const hedgeNotionalUsd = netLongUsd * 0.5;
const hedgeSz = hedgeNotionalUsd / currentPx;
```

**成本**：资金费率 + 滑点

---

### 2. Protective Put（保护性看跌）

**适用**：
- 需要保留上行空间
- 愿意支付期权费
- 中期（1-4 周）

**参数计算**：
```typescript
// @rule protective-put-calc description="Protective Put 参数计算" strategy="protective-put"
const strikePx = currentPx * 0.90; // 10% OTM
const expiry = "30d"; // 30 天到期
const notionalToHedge = netLongUsd * 0.8; // 对冲 80%
```

**成本**：期权费（约 1-2% notional/月）

---

### 3. Collar（领口策略）

**适用**：
- 成本敏感
- 愿意放弃部分上行
- 中期（1-4 周）

**构造**：
```typescript
// @rule collar-calc description="Collar 领口策略构造" strategy="collar"
const putStrike = currentPx * 0.90;  // 10% 下跌保护
const callStrike = currentPx * 1.15; // 15% 上限
// Call 收入 ≈ Put 成本，净成本接近 0
```

**成本**：净成本接近 0，但上限被锁

---

## 优先级排序

**hedge-planner 输出 3 个提案时**：

1. **Perp Short** — 低成本，快速，适合短期
2. **Protective Put** — 保留上行，买保险
3. **Collar** — 零成本，但放弃上行

由 policy-gate 根据账户状态选择。

---

## 动态调整

### 资金费率影响

```typescript
// @rule funding-rate-priority description="资金费率影响策略优先级"
if (fundingRate > 0.01) {
  // 资金费率过高，优先 option
  prioritizedStrategies = ["protective-put", "collar", "perp-short"];
}
```

### 波动率影响

```typescript
// @rule iv-percentile-priority description="隐含波动率影响策略优先级"
if (ivPercentile > 80) {
  // IV 过高，期权贵，优先 perp
  prioritizedStrategies = ["perp-short", "collar", "protective-put"];
}
```

---

**来源**: 《期权波动率交易》第 6-8 章
**应用模块**: hedge-planner
