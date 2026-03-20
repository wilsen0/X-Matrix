---
name: replay
description: Activate when the user asks why the system chose a plan, how execution was gated, what evidence was used, or wants a saved run replayed for audit or demo.
license: Apache-2.0
writes: false
risk_level: low
triggers: replay, audit, trace, why, evidence
---

# Goal
Explain the chain, facts, proposals, risk gate result, and execution intents.

# Output
- skill trace
- top facts
- rejected alternatives
- final approved path
