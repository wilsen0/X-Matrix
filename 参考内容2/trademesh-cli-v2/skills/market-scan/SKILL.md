---
name: market-scan
description: Activate when the user asks to scan market state, read price action, candles, volatility, order book imbalance, funding rates, or open interest before a trade decision.
license: Apache-2.0
writes: false
risk_level: low
triggers: market, price, volatility, funding, orderbook, open interest, scan
---

# Goal
Read market structure before planning any trade or hedge.

# Reads
- `okx market ticker <instId> --json`
- `okx market candles <instId> --bar 1H --limit 200 --json`
- `okx market funding-rate <instId> --json`
- `okx market orderbook <instId> --sz 20 --json`

# Output
- regime
- volatility note
- liquidity note
- handoff = `hedge-planner` or `policy-gate`
