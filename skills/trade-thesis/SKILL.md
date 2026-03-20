---
name: trade-thesis
description: "Fuse portfolio risk, market regime, and doctrine into one canonical trade thesis."
stage: planner
role: synthesizer
requires: [okx-cex-market, okx-cex-portfolio]
risk_level: low
writes: false
always_on: true
triggers: [hedge, thesis, doctrine, risk, 对冲, 心法, 风险]
entrypoint: ./run.js
consumes: [portfolio.snapshot, portfolio.risk-profile, market.regime]
produces: [trade.thesis]
preferred_handoffs: [hedge-planner]
repeatable: false
artifact_version: 2
---

# Trade Thesis

Converts shared portfolio and market artifacts into a single, auditable hedge thesis.
