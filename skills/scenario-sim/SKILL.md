---
name: scenario-sim
description: "Stress hedge proposals across a fixed scenario matrix before policy approval."
stage: planner
role: planner
requires: [okx-cex-market, okx-cex-portfolio]
risk_level: low
writes: false
always_on: true
triggers: [scenario, stress, hedge, 风险, 压测]
entrypoint: ./run.js
consumes: [planning.proposals, trade.thesis, portfolio.risk-profile]
produces: [planning.proposals, planning.scenario-matrix]
preferred_handoffs: [policy-gate]
repeatable: false
artifact_version: 2
---

# Scenario Sim

Adds a deterministic stress matrix to every proposal before the policy gate evaluates it.
