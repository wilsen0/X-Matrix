---
name: env-probe
description: "Probe local runtime and environment prerequisites before rehearsal routing."
stage: sensor
role: sensor
requires: [okx-cex-portfolio]
risk_level: low
writes: false
always_on: false
triggers: [probe, doctor, readiness, rehearsal]
entrypoint: ./run.js
consumes: []
produces: [diagnostics.probes]
preferred_handoffs: [market-probe]
repeatable: true
artifact_version: 3
contract_version: 1
safety_class: read
determinism: medium
standalone_command: "trademesh skills run env-probe \"<goal>\" --plane demo"
standalone_route: [env-probe]
standalone_inputs: [goal]
standalone_outputs: [diagnostics.probes]
required_capabilities: [okx-cli]
---

# Env Probe

Collects environment probe context used by doctor and rehearsal workflows.
