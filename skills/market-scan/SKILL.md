---
name: market-scan
description: "Create a lightweight market regime snapshot for the active hedge symbols."
stage: sensor
role: sensor
requires: [okx-cex-market]
risk_level: low
writes: false
always_on: true
triggers: [market, funding, volatility, option, 期权, 波动率]
entrypoint: ./run.js
consumes: [portfolio.snapshot]
produces: [market.snapshot, market.regime]
preferred_handoffs: [trade-thesis]
repeatable: false
artifact_version: 2
---

# Market Scan

Produces a planning-oriented market snapshot. The current scaffold uses deterministic placeholder factors.
