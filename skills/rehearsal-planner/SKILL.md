---
name: rehearsal-planner
description: "Create a minimal-risk rehearsal proposal set for demo execution checks."
stage: planner
role: planner
requires: [okx-cex-market, okx-cex-portfolio, okx-cex-trade]
risk_level: medium
writes: false
always_on: false
triggers: [rehearsal, drill, preflight]
entrypoint: ./run.js
consumes: [goal.intake, portfolio.snapshot, diagnostics.readiness, market.regime]
produces: [trade.thesis, planning.proposals, planning.scenario-matrix, operations.rehearsal-plan]
preferred_handoffs: [policy-gate]
repeatable: false
artifact_version: 3
contract_version: 1
safety_class: read
determinism: high
standalone_command: "trademesh skills run rehearsal-planner \"<goal>\" --plane demo"
standalone_route: [env-probe, market-probe, account-probe, diagnosis-synthesizer, rehearsal-planner]
standalone_inputs: [goal]
standalone_outputs: [trade.thesis, planning.proposals, planning.scenario-matrix, operations.rehearsal-plan]
required_capabilities: [okx-cli, market-read, account-read, option-write]
---

# Rehearsal Planner

Builds a deterministic low-risk rehearsal plan that flows through policy and the official executor.
