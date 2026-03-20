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
artifact_version: 2
---

# Replay

Explains the chain of evidence, proposals, and policy decisions for a recorded run.
