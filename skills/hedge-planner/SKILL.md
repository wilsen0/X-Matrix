---
name: hedge-planner
description: "Turn portfolio and market observations into ranked hedge proposals."
stage: planner
role: planner
requires: [okx-cex-market, okx-cex-portfolio, okx-cex-trade]
risk_level: medium
writes: false
always_on: false
triggers: [risk, hedge, drawdown, protect, downside, 对冲, 风险, 回撤]
entrypoint: ./run.js
consumes: [trade.thesis, portfolio.risk-profile, market.snapshot]
produces: [planning.proposals]
preferred_handoffs: [scenario-sim]
repeatable: false
artifact_version: 2
---

# Hedge Planner

Builds a ranked menu of hedge ideas and forwards them to the policy gate.
