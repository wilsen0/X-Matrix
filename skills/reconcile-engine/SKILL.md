---
name: reconcile-engine
description: "Reconcile uncertain write intents against exchange order history and converge idempotency state."
stage: executor
role: guardrail
requires: [okx-cex-trade]
risk_level: medium
writes: false
always_on: false
triggers: [reconcile, settlement, order-history]
entrypoint: ./run.js
consumes: [execution.intent-bundle]
produces: [execution.reconciliation]
preferred_handoffs: [operator-summarizer]
repeatable: true
artifact_version: 3
contract_version: 1
safety_class: read
determinism: medium
proof_class: structural
standalone_command: "trademesh skills run reconcile-engine \"<run-id>\" --plane demo"
standalone_route: [reconcile-engine]
standalone_inputs: [run-id]
standalone_outputs: [execution.reconciliation]
required_capabilities: [okx-cli, market-read, account-read]
---

# Reconcile Engine

Uses client-order-id first matching, then deterministic fallback matching, to converge execution state.
