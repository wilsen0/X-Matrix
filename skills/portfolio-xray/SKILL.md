---
name: portfolio-xray
description: "Infer the working portfolio shape and drawdown target from the user's goal."
stage: sensor
role: sensor
requires: [okx-cex-portfolio]
risk_level: low
writes: false
always_on: true
triggers: [portfolio, risk, hedge, drawdown, 回撤, 对冲, 风险]
entrypoint: ./run.js
consumes: []
produces: [goal.intake, portfolio.snapshot, portfolio.risk-profile]
preferred_handoffs: [market-scan]
repeatable: false
artifact_version: 2
---

# Portfolio Xray

Maps the user's request into a provisional portfolio shape for downstream planning.
