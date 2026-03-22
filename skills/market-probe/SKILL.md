---
name: market-probe
description: "Run market read probes and materialize market artifacts for rehearsal."
stage: sensor
role: sensor
requires: [okx-cex-market]
risk_level: low
writes: false
always_on: false
triggers: [probe, market, rehearsal]
entrypoint: ./run.js
consumes: [diagnostics.probes]
produces: [diagnostics.probes, market.snapshot, market.regime]
preferred_handoffs: [account-probe]
repeatable: true
artifact_version: 3
contract_version: 1
safety_class: read
determinism: medium
standalone_command: "trademesh skills run market-probe \"<goal>\" --plane demo"
standalone_route: [env-probe, market-probe]
standalone_inputs: [goal]
standalone_outputs: [diagnostics.probes, market.snapshot, market.regime]
required_capabilities: [okx-cli, market-read]
---

# Market Probe

Appends market probe evidence and refreshes market artifacts.
