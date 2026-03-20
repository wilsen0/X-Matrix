# 《海龟交易法则》精要

> 完整的龟交易系统，供 TradeMesh skills 参考

---

## 核心哲学

**"交易是概率游戏，不是预测游戏"**

- 不要试图预测市场，而是对市场状态做出反应
- 系统化规则优于主观判断
- 小亏损 + 大盈利 = 长期盈利

---

## 系统 1：短期突破

### 入场规则

```typescript
// 20 日突破
if (currentPx > max(candles.slice(-20).map(c => c.high))) {
  enter("buy", unitSize);
}
```

### 出场规则

```typescript
// 10 日反向突破
if (currentPx < min(candles.slice(-10).map(c => c.low))) {
  exit("all");
}
```

---

## 系统 2：长期突破

### 入场规则

```typescript
// 55 日突破
if (currentPx > max(candles.slice(-55).map(c => c.high))) {
  enter("buy", unitSize);
}
```

### 出场规则

```typescript
// 20 日反向突破
if (currentPx < min(candles.slice(-20).map(c => c.low))) {
  exit("all");
}
```

---

## 仓位 Sizing（N 值系统）

### N 值定义

```typescript
// N = ATR (Average True Range)
const N = calculateATR(candles, 20);
const dollarVolatility = N * dollarsPerPoint;
```

### 单位仓位

```typescript
// 1 单位 = 账户 1% 风险
const unitSize = (accountEquity * 0.01) / dollarVolatility;
```

### 最大持仓

```typescript
// 单市场最多 4 单位
// 高度相关市场最多 6 单位
// 单方向最多 10 单位
// 总计最多 12 单位
```

---

## 止损规则

### 固定止损

```typescript
// 2N 止损
const stopLossPx = entryPx - (2 * N);
```

### 不移动止损

```typescript
// 海龟不移动止损以避免被震出
// 只有出场信号才平仓
```

---

## 心理纪律

### 避免的陷阱

1. **错过信号** — 害怕亏损而犹豫
2. **过早出场** — 拿不住盈利单
3. **过度交易** — 不遵循系统
4. **报复性交易** — 亏损后加大仓位

### 坚持的原则

1. **严格执行** — 信号出现立即行动
2. **接受亏损** — 小亏损是交易成本
3. **保持耐心** — 大趋势不常有
4. **信任系统** — 长期概率在系统这边

---

## 对 TradeMesh 的启示

| 海龟规则 | TradeMesh 实现 |
|---------|---------------|
| 突破系统 | market-scan 的 regime 判断 |
| N 值 sizing | policy-gate 的敞口限额 |
| 固定止损 | official-executor 的 SL 参数 |
| 心理纪律 | policy-gate 的情绪过滤 |

---

**精要总结**：
- 系统化 > 主观判断
- 小亏 + 大盈 = 盈利
- 纪律是成功的核心

**应用模块**: market-scan, hedge-planner, policy-gate
