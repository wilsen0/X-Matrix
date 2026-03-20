# 交易方法论 — TradeMesh 决策框架

> 模块化 skills + 交易心法 = 可审计的自动化交易系统

---

## 核心理念

**"系统优于直觉，规则优于情绪"**

TradeMesh 的每个 skill 都基于经典交易方法论，将人类交易员的决策过程编码为可执行的规则。

---

## 方法论来源

| 书籍 | 核心思想 | 映射模块 |
|------|---------|---------|
| 《海龟交易法则》 | 趋势跟踪 + 仓位 sizing | hedge-planner, policy-gate |
| 《黑天鹅》 | 尾部风险防护 | policy-gate |
| 《交易心理分析》 | 避免情绪化决策 | 全局约束 |
| 《期权波动率交易》 | 对冲策略选择 | hedge-planner (option) |

---

## 决策流程

```
用户目标 → portfolio-xray (识别敞口)
         → market-scan (评估环境)
         → hedge-planner (生成方案)
         → policy-gate (风险审批)
         → official-executor (执行)
         → replay (审计复盘)
```

---

## 规则文件

- `rules/trend-following.md` — 趋势判断规则
- `rules/risk-limits.md` — 风险限额规则
- `rules/hedging-strats.md` — 对冲策略选择
- `rules/execution.md` — 执行约束

---

## 扩展指南

添加新的交易心法：

1. 在 `docs/books/` 创建精要文件
2. 在 `docs/rules/` 提炼可执行规则
3. 在对应 skill 中引用规则
4. 添加测试验证规则生效

---

**版本**: 1.0
**更新**: 2026-03-20
