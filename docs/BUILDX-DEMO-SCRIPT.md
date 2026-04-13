# Skills Mesh Demo Script

This document is the operator-facing demo and recording script.

Goal: verify and show the core product path of Skills Mesh — not just a strategy clip, but a **reusable proof-carrying skill product** for **agentic onchain workflows on X Layer**.

---

## 1. What to show

The recording should make 5 things obvious:

1. The project accepts a natural-language goal
2. Skills auto-compose into a workflow
3. Execution is bound to an **Agentic Wallet**
4. Eligible X Layer swap actions route through **onchainos**
5. The whole route is **replayable / exportable / provable**

---

## 2. Recommended demo variants

### Variant A — 90 second proof demo

Use this when time is tight and you want to prove the core path fast.

Sequence:

1. Show README first screen
2. Run `doctor`
3. Run `plan`
4. Run `apply --proposal perp-short`
5. Point at:
   - `Wallet: ...`
   - `Integration: onchainos`
   - `onchainos swap execute ...`
6. Run `export`
7. Run `replay`

### Variant B — 3 minute product walkthrough

Use this when you want to show the product path with a little more context.

Sequence:

1. Repo / README positioning
2. `skills graph`
3. `doctor --probe active`
4. `plan`
5. `apply`
6. `export`
7. `replay --bundle`
8. Briefly mention the already verified real X Layer swap

---

## 3. Pre-recording checklist

Run these before opening screen recording:

```bash
cd ~/apps/apps/okx-skill-mesh
pnpm build
pnpm test
export SKILLS_MESH_AGENT_WALLET=<your_xlayer_wallet>
```

Optional sanity checks:

```bash
node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply
node dist/bin/trademesh.js skills certify --strict
```

If you want the onchainos path to be visible, use a proposal with `swap-place-order`, such as `perp-short`.
Do **not** use `protective-put` for this verification clip, because that path is an option order, not a swap order.

---

## 4. Copy-paste demo commands

### Step 1 — Doctor

```bash
node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply
```

What to say:

> We start with a health and readiness check. Skills Mesh verifies environment readiness before execution and keeps progressive trust boundaries between research, demo, and live.

---

### Step 2 — Show graph

```bash
node dist/bin/trademesh.js skills graph
```

What to say:

> The workflow is not hardcoded. Skills are installed like plugins, then auto-composed through typed artifact dependencies.

---

### Step 3 — Plan from a goal

```bash
node dist/bin/trademesh.js plan "protect BTC downside with 4% max drawdown" --plane demo
```

What to say:

> A natural-language goal becomes a typed planning flow: portfolio analysis, market scan, thesis, hedge planning, scenario simulation, and policy evaluation.

Look for:

- proposal ranking
- recommendation lenses
- policy preview
- mesh proof
- generated `run_<id>`

---

### Step 4 — Apply with X Layer swap proposal

```bash
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal perp-short --approve --approved-by demo-operator
```

What to say:

> Here the workflow binds execution to an Agentic Wallet. Because this is an eligible X Layer swap action, the executor switches from the default path to the onchainos execution path.

Look for these exact signals:

- `Wallet: <address>`
- `Integration: onchainos`
- `onchainos wallet balance --chain xlayer`
- `onchainos swap execute ... --wallet <address>`

This is the most important frame in the whole video.

---

### Step 5 — Export the evidence pack

```bash
node dist/bin/trademesh.js export <run-id>
```

What to say:

> After execution planning, the whole route can be exported as a portable evidence pack: report, operator summary, and bundle.

Look for:

- export path
- bundle path
- report path

---

### Step 6 — Replay from the bundle

```bash
node dist/bin/trademesh.js replay --bundle .trademesh/exports/<run-id>/bundle.json
```

What to say:

> This is the proof-carrying part. The route can be replayed from exported artifacts, so the workflow is auditable and portable, not just a one-time terminal session.

Look for:

- route proof
- artifact handoffs
- contract proof / bundle replay summary

---

## 5. Suggested spoken track (short version)

> Skills Mesh is a reusable proof-carrying skill runtime for onchain agent workflows on X Layer.  
> We start from a natural-language risk goal.  
> Installed skills auto-compose into a typed workflow through artifact dependencies.  
> On apply, the agent-wallet skill binds execution to an Agentic Wallet identity.  
> For eligible X Layer swap actions, the executor routes through onchainos, which you can see here in the generated command path.  
> Finally, the full run is exportable and replayable with route proof, so the workflow is verifiable instead of opaque.

---

## 6. Suggested spoken track (slightly longer)

> This project is not a single trading bot script. It is a reusable skill mesh.  
> Each capability is packaged as an installable skill with typed artifact contracts.  
> The runtime discovers installed skills, compiles their dependency graph, verifies safety invariants, and records replayable execution evidence.  
> In the Build X version, we connect that runtime to X Layer execution. The agent-wallet skill resolves the Agentic Wallet identity, and eligible swap actions are routed through onchainos.  
> That means we keep the original safety model — a single supervised write path — while still producing a real onchain execution route for X Layer.

---

## 7. What NOT to spend time on in the video

Avoid getting stuck on:

- long test output
- implementation internals
- every single skill output
- option-only proposals when trying to prove onchainos routing
- long explanations of old OKX-only history

The core story is:

**goal → auto-composed workflow → wallet-bound execution → onchainos route → replay/export proof**

---

## 8. Strong finishing line

> Skills Mesh turns reusable agent skills into verifiable onchain workflows on X Layer — with wallet-bound execution, supervised safety, and replayable proof.
