---
name: portfolio-xray
description: "Infer the working portfolio shape and drawdown target from the user's goal."
stage: sensor
role: sensor
requires: [okx-cex-portfolio]
risk_level: low
writes: false
always_on: true
triggers: [portfolio, risk, hedge, drawdown, 回撤, 对冲, 风险]
entrypoint: ./run.js
consumes: []
produces: [goal.intake, portfolio.snapshot, portfolio.risk-profile]
preferred_handoffs: [market-scan]
repeatable: false
artifact_version: 3
contract_version: 1
safety_class: read
determinism: medium
standalone_command: "trademesh skills run portfolio-xray \"<goal>\""
standalone_route: [portfolio-xray]
standalone_inputs: [goal]
standalone_outputs: [goal.intake, portfolio.snapshot, portfolio.risk-profile]
required_capabilities: [okx-cli, account-read]
---

# Portfolio Xray

Maps the user's request into a provisional portfolio shape for downstream planning.
