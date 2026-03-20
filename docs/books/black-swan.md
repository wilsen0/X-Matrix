# 《黑天鹅》精要 — 尾部风险防护

> 为极端情况设计防护，而不是预测它

---

## 核心哲学

**"黑天鹅不可预测，但可以防护"**

- 极端事件的影响远超日常波动
- 正态分布低估尾部风险
- 与其预测，不如构建鲁棒系统

---

## 关键概念

### 1. 肥尾分布

```typescript
// 传统金融假设正态分布
// 实际市场有肥尾，极端事件频率被低估 10x+

const normalProb = 0.001; // 3σ 事件概率
const actualProb = 0.01;  // 实际市场概率
```

### 2. 脆弱 vs 鲁棒 vs 反脆弱

```typescript
// 脆弱：极端事件造成毁灭性损失
const fragile = {
  leverage: 20,
  concentration: "100% BTC",
  stopLoss: "none",
};

// 鲁棒：极端事件造成可承受损失
const robust = {
  leverage: 2,
  concentration: "40% BTC / 40% ETH / 20% stable",
  stopLoss: "5%",
};

// 反脆弱：极端事件带来收益
const antifragile = {
  leverage: 1,
  longPut: "10% OTM",
  shortCall: "20% OTM", // Collar
};
```

---

## 防护策略

### 1. 杠杆控制

```typescript
// 黑天鹅时高杠杆 = 爆仓
const maxLeverage = 3; // 永不超过 3x
const safeLeverage = 1.5; // 日常目标
```

### 2. 分散投资

```typescript
// 相关性在危机时会趋近于 1
// 需要真正的分散：资产类别 + 地理 + 策略

const diversification = {
  assets: ["crypto", "stocks", "bonds", "cash"],
  geography: ["US", "Asia", "EU"],
  strategies: ["trend", "mean-reversion", "carry"],
};
```

### 3. 尾部对冲

```typescript
// 花 1-2% 买保险
const tailHedge = {
  cost: accountEquity * 0.015, // 每月
  protection: "10% OTM Put on BTC",
  expectedLoss: -0.015, // 大部分月份
  blackSwanGain: "+30%", // 极端月份
};
```

---

## 决策框架

### 不对称收益

```typescript
// 追求：损失有限，收益无限
const goodTrade = {
  maxLoss: "1%",
  maxGain: "unlimited",
  expectedValue: "positive",
};

// 避免：收益有限，损失无限
const badTrade = {
  maxGain: "2%",
  maxLoss: "unlimited", // 如 naked short
};
```

### 凸性思维

```typescript
// 凸性：收益曲线向上弯曲
// 小输入 → 小输出，大输入 → 超大输出

const convexBet = {
  cost: "small",
  upsideIfRight: "massive",
  downsideIfWrong: "limited",
};

// 例子：早期投资、OTM 期权
```

---

## 对 TradeMesh 的启示

| 黑天鹅原则 | TradeMesh 实现 |
|-----------|---------------|
| 杠杆控制 | policy-gate 的 leverage limit |
| 分散投资 | portfolio-xray 的 concentration 分析 |
| 尾部对冲 | hedge-planner 的 protective put |
| 凸性思维 | policy-gate 的收益/风险比检查 |

---

## 拒绝清单

**永远不要做的事**：
1. ❌ Naked short（无限损失）
2. ❌ > 5x 杠杆（爆仓风险）
3. ❌ 单币种 > 50% 仓位
4. ❌ 无止损持仓
5. ❌ 忽视相关性（所有资产一起跌）

---

**精要总结**：
- 黑天鹅不可预测，但可防护
- 凸性 > 凹性（收益不对称）
- 生存第一，盈利第二

**应用模块**: policy-gate, hedge-planner
