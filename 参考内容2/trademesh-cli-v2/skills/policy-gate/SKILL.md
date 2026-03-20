---
name: policy-gate
description: Activate when a proposal may place, amend, cancel, or stop orders, create bots, change leverage, or move from demo to live execution.
license: Apache-2.0
writes: false
risk_level: high
triggers: policy, approval, live, execute, order, leverage
---

# Goal
Prevent unsafe or unauthorized execution.

# Rules
1. If plane is `research`, block all writes.
2. If plane is `live`, require approval.
3. Custom skills must not execute non-official write paths.
4. If required module is not allowed, downgrade to plan-only.
5. Prefer `demo` first whenever possible.

# Output
- approved | blocked | require_approval
- reason
- allowed executor = `official-executor`
