---
name: agent-wallet
description: "Resolve an agent wallet identity for on-chain execution routing."
stage: sensor
role: sensor
requires: []
risk_level: low
writes: false
always_on: false
triggers: [wallet, agent-wallet, identity, 钱包]
entrypoint: ./run.js
consumes: []
produces: [identity.agent-wallet]
preferred_handoffs: [official-executor]
repeatable: false
artifact_version: 3
contract_version: 1
safety_class: read
determinism: high
proof_class: portable
proof_goal: "portable proof agent wallet identity"
proof_fixture: ./proof/input.artifacts.json
proof_target_outputs: [identity.agent-wallet]
standalone_command: "trademesh skills run agent-wallet \"<goal>\""
standalone_route: [agent-wallet]
standalone_inputs: [goal]
standalone_outputs: [identity.agent-wallet]
required_capabilities: []
---

# Agent Wallet

Resolves a wallet address from runtime input, environment variable, or demo/research fallback.
Produces an `identity.agent-wallet` artifact with the resolved address and provenance metadata.
