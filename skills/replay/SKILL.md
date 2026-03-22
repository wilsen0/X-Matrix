---
name: replay
description: "Explain why the runtime chose a route and preserve an auditable trace."
stage: memory
role: memory
requires: []
risk_level: low
writes: false
always_on: false
triggers: [replay, trace, audit, 审计, 回放]
entrypoint: ./run.js
consumes: []
produces: []
preferred_handoffs: []
repeatable: false
artifact_version: 3
contract_version: 1
safety_class: read
determinism: high
standalone_command: "trademesh skills run replay \"<goal>\" --input <run-id>"
standalone_route: [replay]
standalone_inputs: [run-id]
standalone_outputs: []
required_capabilities: []
---

# Replay

Explains the chain of evidence, proposals, and policy decisions for a recorded run.
