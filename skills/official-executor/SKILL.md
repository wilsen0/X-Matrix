---
name: official-executor
description: "Translate an approved proposal into an auditable OKX CLI command preview."
stage: executor
requires: [okx-cex-trade]
risk_level: high
writes: true
always_on: false
triggers: [apply, execute, order, 订单, 执行]
entrypoint: ./run.js
---

# Official Executor

Builds a preview of the future OKX CLI command sequence. It does not submit exchange orders yet.
