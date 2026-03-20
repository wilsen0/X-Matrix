# 风险限额规则 — Policy Gate 决策依据

> 基于《海龟交易法则》+《黑天鹅》的风险控制框架

---

## 核心原则

1. **生存第一** — 永远不要让单笔交易危及账户
2. **分散风险** — 不要把所有鸡蛋放在一个篮子
3. **尾部防护** — 为极端情况预留缓冲

---

## 限额规则

### 单笔订单限额

```typescript
// @rule max-single-order description="单笔订单限额" source="turtle-traders" multiplier="0.02"
const maxSingleOrderNotionalUsd = accountEquity * 0.02;
```

### 总敞口限额

```typescript
// @rule max-total-exposure description="总敞口限额" source="black-swan" multiplier="3"
const maxTotalExposureUsd = accountEquity * 3;
```

### 币种集中度

```typescript
// @rule max-symbol-concentration description="币种集中度上限" limit="40"
const maxSingleSymbolSharePct = 40;
```

### 黑名单（尾部风险币种）

```typescript
const blacklistSymbols = ["LUNA", "UST", "FTT", "LUNA2"];
```

### 白名单（流动性充足）

```typescript
const whitelistSymbols = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "MATIC"];
```

---

## 动态调整

### 波动率调整

```typescript
// @rule volatility-adjustment description="高波动降低敞口" threshold="0.05" factor="0.5"
if (marketVolatility > 0.05) {
  maxSingleOrderNotionalUsd *= 0.5;
}
```

### 杠杆调整

```typescript
// 高杠杆时收紧限额
if (avgLeverage > 5) {
  maxTotalExposureUsd *= 0.7;
}
```

---

## 拒绝条件

**立即拒绝**：
- 黑名单币种
- 单笔超过 2% 限制
- 总敞口超过 3x
- 账户余额不足

**警告但允许**：
- 白名单外的币种（需额外确认）
- 高波动环境（建议降低仓位）
- 集中度 > 30%（建议分散）

---

**来源**: 《海龟交易法则》第 4 章 + 《黑天鹅》第 17 章
**应用模块**: policy-gate
