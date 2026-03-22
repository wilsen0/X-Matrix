---
name: live-guard
description: "Enforce supervised live execution conditions before any write can proceed."
stage: executor
role: guardrail
requires: [okx-cex-trade]
risk_level: high
writes: false
always_on: false
triggers: [live, guard, execute, confirmation, approval]
entrypoint: ./run.js
consumes: [goal.intake, policy.plan-decision, diagnostics.readiness]
produces: [operations.live-guard]
preferred_handoffs: [official-executor]
repeatable: true
artifact_version: 3
contract_version: 1
safety_class: read
determinism: high
proof_class: portable
proof_goal: "portable proof live guard"
proof_fixture: ./proof/input.artifacts.json
proof_target_outputs: [operations.live-guard]
standalone_command: "trademesh skills run live-guard \"<goal>\" --plane live"
standalone_route: [portfolio-xray, market-scan, trade-thesis, hedge-planner, scenario-sim, policy-gate, live-guard]
standalone_inputs: [goal]
standalone_outputs: [operations.live-guard]
required_capabilities: [okx-cli, market-read, account-read, live-profile]
---

# Live Guard

Prevents unsafe live writes unless explicit supervised conditions are met.
