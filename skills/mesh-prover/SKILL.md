---
name: mesh-prover
description: "Generate a route-proof artifact that explains why a run route is valid, resumable, and minimally sufficient."
stage: memory
role: memory
requires: []
risk_level: low
writes: false
always_on: false
triggers: [proof, route, certification, replay, export]
entrypoint: ./run.js
consumes: [mesh.skill-certification]
produces: [mesh.route-proof]
preferred_handoffs: []
repeatable: true
artifact_version: 3
contract_version: 1
safety_class: read
determinism: high
proof_class: structural
standalone_command: "trademesh skills run mesh-prover \"<goal>\""
standalone_route: [mesh-prover]
standalone_inputs: [goal]
standalone_outputs: [mesh.route-proof]
required_capabilities: []
---

# Mesh Prover

Produces a machine-readable proof that a route can be replayed, resumed, and explained.
