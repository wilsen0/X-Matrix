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
artifact_version: 3
contract_version: 1
safety_class: read
determinism: high
proof_class: portable
proof_goal: "portable proof scenario sim"
proof_fixture: ./proof/input.artifacts.json
proof_target_outputs: [planning.scenario-matrix]
standalone_command: "trademesh skills run scenario-sim \"<goal>\""
standalone_route: [portfolio-xray, market-scan, trade-thesis, hedge-planner, scenario-sim]
standalone_inputs: [goal]
standalone_outputs: [planning.proposals, planning.scenario-matrix]
required_capabilities: [okx-cli, market-read, account-read]
---

# Scenario Sim

Adds a deterministic stress matrix to every proposal before the policy gate evaluates it.
