---
name: hedge-planner
description: "Turn portfolio and market observations into ranked hedge proposals."
stage: planner
role: planner
requires: [okx-cex-market, okx-cex-portfolio, okx-cex-trade]
risk_level: medium
writes: false
always_on: false
triggers: [risk, hedge, drawdown, protect, downside, 对冲, 风险, 回撤]
entrypoint: ./run.js
consumes: [goal.intake, trade.thesis, portfolio.risk-profile, market.snapshot]
produces: [planning.proposals]
preferred_handoffs: [scenario-sim]
repeatable: false
artifact_version: 3
contract_version: 1
safety_class: read
determinism: high
standalone_command: "trademesh skills run hedge-planner \"<goal>\""
standalone_route: [portfolio-xray, market-scan, trade-thesis, hedge-planner]
standalone_inputs: [goal]
standalone_outputs: [planning.proposals]
required_capabilities: [okx-cli, market-read, account-read]
---

# Hedge Planner

Builds a ranked menu of hedge ideas and forwards them to the policy gate.
