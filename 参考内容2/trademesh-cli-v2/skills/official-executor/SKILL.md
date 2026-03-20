---
name: official-executor
description: Activate only after policy approval when a proposal must be translated into official okx CLI commands for account, spot, swap, option, futures, or bot execution.
license: Apache-2.0
writes: true
risk_level: high
triggers: execute, apply, order, trade, cancel
---

# Goal
Convert approved proposal steps into `okx ... --json` command intents.

# Constraints
- No custom HTTP requests.
- No unofficial write paths.
- All commands must be printable before execution.
- Prefer `--profile demo` for rehearsal.

# Output
- ordered CLI intents
- dry-run preview
- handoff = `replay`
