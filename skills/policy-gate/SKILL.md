---
name: policy-gate
description: "Enforce demo-first execution policy and convert plans into approved previews."
stage: guardrail
role: guardrail
requires: [okx-cex-trade]
risk_level: high
writes: false
always_on: true
triggers: [policy, approval, demo, live, 批准, 模拟盘]
entrypoint: ./run.js
consumes: [planning.proposals, planning.scenario-matrix, trade.thesis, portfolio.snapshot, portfolio.risk-profile]
produces: [policy.plan-decision]
preferred_handoffs: [official-executor]
repeatable: false
artifact_version: 3
contract_version: 1
safety_class: read
determinism: high
standalone_command: "trademesh skills run policy-gate \"<goal>\""
standalone_route: [portfolio-xray, market-scan, trade-thesis, hedge-planner, scenario-sim, policy-gate]
standalone_inputs: [goal]
standalone_outputs: [planning.proposals, policy.plan-decision]
required_capabilities: [okx-cli, market-read, account-read]
---

# Policy Gate

Guards every write-adjacent flow. The scaffold currently allows demo previews only and blocks live execution.
