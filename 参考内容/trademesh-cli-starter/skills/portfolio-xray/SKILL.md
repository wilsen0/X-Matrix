---
name: portfolio-xray
description: Activate when the user asks to inspect portfolio health, account exposure, concentration risk, drawdown risk, leverage hotspots, fee drag, or whether the account needs hedging.
license: Apache-2.0
---

# Goal
Turn balances and positions into a risk map.

# Reads
- `okx account balance --json`
- `okx account positions --json`
- `okx account fee-rates --json`
- `okx account bills --json`

# Output
- directional exposure
- concentration by asset
- leverage hotspots
- fee drag summary
- handoff = `market-scan`
