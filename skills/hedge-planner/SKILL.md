---
name: hedge-planner
description: "Turn portfolio and market observations into ranked hedge proposals."
stage: planner
requires: [okx-cex-market, okx-cex-portfolio, okx-cex-trade]
risk_level: medium
writes: false
always_on: false
triggers: [risk, hedge, drawdown, protect, downside, 对冲, 风险, 回撤]
entrypoint: ./run.js
---

# Hedge Planner

Builds a ranked menu of hedge ideas and forwards them to the policy gate.
