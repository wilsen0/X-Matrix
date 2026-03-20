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
artifact_version: 2
---

# Policy Gate

Guards every write-adjacent flow. The scaffold currently allows demo previews only and blocks live execution.
