---
name: idempotency-gate
description: "Check write intent fingerprints before execute and block reconcile-required states."
stage: executor
role: guardrail
requires: [okx-cex-trade]
risk_level: high
writes: false
always_on: false
triggers: [idempotency, fingerprint, duplicate, reconcile]
entrypoint: ./run.js
consumes: [execution.intent-bundle, approval.ticket, execution.apply-decision]
produces: [execution.idempotency-check]
preferred_handoffs: [official-executor]
repeatable: true
artifact_version: 3
contract_version: 1
safety_class: read
determinism: high
standalone_command: "trademesh skills run idempotency-gate \"<goal>\" --plane demo"
standalone_route: [portfolio-xray, market-scan, trade-thesis, hedge-planner, scenario-sim, policy-gate, approval-gate, official-executor, idempotency-gate]
standalone_inputs: [goal]
standalone_outputs: [execution.idempotency-check]
required_capabilities: [okx-cli, market-read, account-read]
---

# Idempotency Gate

Checks write-intent fingerprints and blocks execute when prior state is unresolved.
