---
name: official-executor
description: "Translate an approved proposal into an auditable OKX CLI command preview."
stage: executor
role: executor
requires: [okx-cex-trade]
risk_level: high
writes: true
always_on: false
triggers: [apply, execute, order, 订单, 执行]
entrypoint: ./run.js
consumes: [planning.proposals, policy.plan-decision, trade.thesis]
produces: [execution.intent-bundle]
preferred_handoffs: [replay]
repeatable: false
artifact_version: 3
contract_version: 1
safety_class: write
determinism: high
standalone_command: "trademesh skills run official-executor \"<goal>\""
standalone_route: [portfolio-xray, market-scan, trade-thesis, hedge-planner, scenario-sim, policy-gate, official-executor]
standalone_inputs: [goal]
standalone_outputs: [execution.intent-bundle]
required_capabilities: [okx-cli, market-read, account-read]
---

# Official Executor

Builds a preview of the future OKX CLI command sequence. It does not submit exchange orders yet.
