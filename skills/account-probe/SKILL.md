---
name: account-probe
description: "Run account read probes and refresh goal/portfolio artifacts for rehearsal."
stage: sensor
role: sensor
requires: [okx-cex-portfolio]
risk_level: low
writes: false
always_on: false
triggers: [probe, account, rehearsal]
entrypoint: ./run.js
consumes: [diagnostics.probes]
produces: [diagnostics.probes, goal.intake, portfolio.snapshot, portfolio.risk-profile]
preferred_handoffs: [diagnosis-synthesizer]
repeatable: true
artifact_version: 3
contract_version: 1
safety_class: read
determinism: medium
standalone_command: "trademesh skills run account-probe \"<goal>\" --plane demo"
standalone_route: [env-probe, market-probe, account-probe]
standalone_inputs: [goal]
standalone_outputs: [diagnostics.probes, goal.intake, portfolio.snapshot, portfolio.risk-profile]
required_capabilities: [okx-cli, account-read]
---

# Account Probe

Appends account probe evidence and refreshes portfolio context.
