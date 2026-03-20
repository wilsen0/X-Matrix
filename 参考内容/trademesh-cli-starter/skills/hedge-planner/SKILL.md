---
name: hedge-planner
description: Activate when the user asks to reduce downside, cap drawdown, protect a spot portfolio, compare perpetual hedge versus protective put versus collar, or produce multiple hedge proposals.
license: Apache-2.0
---

# Goal
Create at least 3 hedge proposals with explicit trade-offs.

# Must compare
1. Light perpetual hedge
2. Protective put
3. Collar

# Output
Each proposal must include:
- reason
- estimated cost
- expected protection
- required modules
- CLI command intents
- handoff = `policy-gate`
