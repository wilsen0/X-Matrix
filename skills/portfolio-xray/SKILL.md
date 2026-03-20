---
name: portfolio-xray
description: "Infer the working portfolio shape and drawdown target from the user's goal."
stage: sensor
requires: [okx-cex-portfolio]
risk_level: low
writes: false
always_on: true
triggers: [portfolio, risk, hedge, drawdown, 回撤, 对冲, 风险]
entrypoint: ./run.js
---

# Portfolio Xray

Maps the user's request into a provisional portfolio shape for downstream planning.
