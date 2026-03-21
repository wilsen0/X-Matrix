---
name: approval-gate
description: "Issue auditable approval tickets for supervised write execution."
stage: guardrail
role: guardrail
requires: [okx-cex-trade]
risk_level: high
writes: false
always_on: false
triggers: [approval, ticket, apply, execute, 审批]
entrypoint: ./run.js
consumes: [policy.plan-decision, planning.proposals, goal.intake]
produces: [approval.ticket]
preferred_handoffs: [official-executor]
repeatable: true
artifact_version: 2
standalone_command: "trademesh skills run approval-gate \"<goal>\""
standalone_route: [portfolio-xray, market-scan, trade-thesis, hedge-planner, scenario-sim, policy-gate, approval-gate]
standalone_inputs: [goal]
standalone_outputs: [approval.ticket]
required_capabilities: [okx-cli, market-read, account-read]
---

# Approval Gate

Creates explicit approval tickets only for supervised write flows.
