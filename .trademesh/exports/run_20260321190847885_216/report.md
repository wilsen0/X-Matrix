# TradeMesh Export Report

## Operator Snapshot
Executable now: no
Blockers: policy_blocked_or_runtime_blocked | correlation bucket correlated-btc at 100.0% exceeds 40.0%
Approval ticket: none
Idempotent hit count: 0
Needs reconcile: no
Next safe action: node dist/bin/trademesh.js export run_20260321190847885_216

## Summary
Run: run_20260321190847885_216
Goal: hedge my drawdown with demo first
Plane: demo
Status: blocked
Selected proposal: protective-put

## Goal Interpretation
Symbols: ETH
Drawdown target: 3.5%
Intent: protect_downside
Horizon: swing
Execute preference: plan_only
Warnings: none

## Environment Readiness
Readiness grade: A
Recommended plane: demo
OKX CLI: detected
Profiles: demo=ready live=ready
Blockers: none

## Proposal Ranking
[recommended] protective-put | score=74 protect=92 cost=54 exec=76 policy=70 data=90 | readiness=policy_blocked actionable=no | Buy convex downside protection because vol=normal and tailRisk=normal.
[#2] collar | score=76 protect=84 cost=76 exec=68 policy=92 data=90 | readiness=policy_blocked actionable=no | option premium spend 360.00 exceeds premium budget 300.00 USD
[#3] de-risk | score=73 protect=80 cost=80 exec=72 policy=70 data=90 | readiness=policy_blocked actionable=no | BTC-USDT-SWAP order notional 700.00 exceeds single-order limit 400.00 USD
[#4] perp-short | score=68 protect=74 cost=68 exec=64 policy=70 data=90 | readiness=policy_blocked actionable=no | ETH-USDT-SWAP order notional 960.00 exceeds single-order limit 400.00 USD

## Selected Plan
Proposal: protective-put
protective-put: policy_blocked | gap=none
collar: policy_blocked | gap=none
de-risk: policy_blocked | gap=none
perp-short: policy_blocked | gap=none

## Policy Verdict
Verdict: blocked
Reasons: correlation bucket correlated-btc at 100.0% exceeds 40.0%
Capability gaps: none

## Command Preview / Execution Receipt
[preview] run_20260321190847885_216:protective-put:read-balance | module=account write=no retry=yes | okx account balance --profile demo --json
[preview] run_20260321190847885_216:protective-put:read-positions | module=account write=no retry=yes | okx account positions --profile demo --json
[preview] run_20260321190847885_216:protective-put:read-ticker:eth | module=market write=no retry=yes | okx market ticker ETH-USDT --profile demo --json
[preview] run_20260321190847885_216:protective-put:write:3 | module=option write=yes retry=no | okx option place-order --instId ETH-USD-260327-67000-P --side buy --sz 1 --px 0.0100 --profile demo --json

## Evidence
portfolio-xray: consumed=[] produced=[goal.intake, portfolio.snapshot, portfolio.risk-profile] rules=[] doctrines=[]
market-scan: consumed=[portfolio.snapshot] produced=[market.snapshot, market.regime] rules=[ma-trend-detection, breakout-detection, atr-volatility-regime, trend-score-calc] doctrines=[turtle-trend]
hedge-planner: consumed=[goal.intake, trade.thesis, portfolio.risk-profile, market.snapshot] produced=[planning.proposals] rules=[perp-short-calc, protective-put-calc, collar-calc, funding-rate-priority, iv-percentile-priority, max-single-order, max-total-exposure, max-symbol-concentration, volatility-adjustment, leverage-tightening, ma-trend-detection, breakout-detection, atr-volatility-regime, trend-score-calc] doctrines=[black-swan-risk, discipline, turtle-trend, vol-hedging]
trade-thesis: consumed=[portfolio.snapshot, portfolio.risk-profile, market.regime] produced=[trade.thesis] rules=[perp-short-calc, protective-put-calc, collar-calc, funding-rate-priority, iv-percentile-priority, max-single-order, max-total-exposure, max-symbol-concentration, volatility-adjustment, leverage-tightening, ma-trend-detection, breakout-detection, atr-volatility-regime, trend-score-calc] doctrines=[black-swan-risk, discipline, turtle-trend, vol-hedging]
scenario-sim: consumed=[planning.proposals, trade.thesis, portfolio.risk-profile] produced=[planning.proposals, planning.scenario-matrix] rules=[perp-short-calc, protective-put-calc, collar-calc, funding-rate-priority, iv-percentile-priority, max-single-order, max-total-exposure, max-symbol-concentration, volatility-adjustment, leverage-tightening, ma-trend-detection, breakout-detection, atr-volatility-regime, trend-score-calc] doctrines=[black-swan-risk, discipline, turtle-trend, vol-hedging]
policy-gate: consumed=[goal.intake, planning.proposals, planning.scenario-matrix, trade.thesis, portfolio.snapshot, portfolio.risk-profile] produced=[planning.proposals, policy.plan-decision] rules=[max-single-order, max-total-exposure, max-symbol-concentration] doctrines=[black-swan-risk]
approval-gate: consumed=[policy.plan-decision, planning.proposals, goal.intake] produced=[] rules=[max-single-order, max-total-exposure, max-symbol-concentration] doctrines=[black-swan-risk]
live-guard: consumed=[goal.intake, policy.plan-decision, diagnostics.readiness] produced=[operations.live-guard] rules=[max-single-order, max-total-exposure, max-symbol-concentration] doctrines=[black-swan-risk]
official-executor: consumed=[planning.proposals, policy.plan-decision, trade.thesis] produced=[execution.intent-bundle] rules=[perp-short-calc, protective-put-calc, collar-calc, funding-rate-priority, iv-percentile-priority, max-single-order, max-total-exposure, max-symbol-concentration, volatility-adjustment, leverage-tightening, ma-trend-detection, breakout-detection, atr-volatility-regime, trend-score-calc] doctrines=[black-swan-risk, discipline, turtle-trend, vol-hedging]
idempotency-gate: consumed=[execution.intent-bundle, approval.ticket, execution.apply-decision] produced=[execution.idempotency-check] rules=[max-single-order, max-total-exposure, max-symbol-concentration] doctrines=[black-swan-risk]
operator-summarizer: consumed=[approval.ticket, execution.idempotency-check, execution.reconciliation] produced=[report.operator-summary] rules=[none] doctrines=[none]

## Next Safe Action
Replay: node dist/bin/trademesh.js replay run_20260321190847885_216
Reconcile: node dist/bin/trademesh.js reconcile run_20260321190847885_216
Export: node dist/bin/trademesh.js export run_20260321190847885_216
Retry: node dist/bin/trademesh.js retry run_20260321190847885_216

