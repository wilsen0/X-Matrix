# Skills Mesh Quickstart

This guide is for the first successful run.

Not for deep architecture study. Not for competition packaging.
Just: **get value fast**.

---

## What you can do in a few minutes

With the current build, the fastest useful workflow is:

1. check environment readiness
2. describe a risk goal in plain language
3. generate ranked hedge proposals
4. preview or apply a selected proposal on `demo`
5. export and replay the result

If you only remember one mental model, remember this:

> `doctor -> plan -> apply -> export -> replay`

---

## 1. Install and build

```bash
cd ~/apps/apps/okx-skill-mesh
npm install
npm run build
```

Optional but recommended:

```bash
pnpm test
```

---

## 2. Check whether the environment is usable

```bash
node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply
```

What this does:

- checks runtime readiness
- checks skill execution prerequisites
- checks wallet / chain / execution path availability
- tells you whether `demo` apply is safe to continue

If this fails, do not guess.
Read the output and fix the blocking capability first.

---

## 3. Create a plan from a normal goal

```bash
node dist/bin/trademesh.js plan "protect BTC downside with 4% max drawdown" --plane demo
```

What you should expect:

- a new `run-id`
- ranked proposals
- recommendation lenses
- policy feedback
- actionability / capability hints

This is the first useful moment of the product.
Even if you stop here, you already have structured decision support instead of free-form AI text.

Read the lenses like this:

- **Best risk hedge** = strongest default protection choice
- **Best X Layer routing check** = best proposal for proving wallet-aware `onchainos` routing
- **Best low-friction demo path** = easiest proposal to preview on `demo`

---

## 4. Pick a proposal and apply it

### Safe default: preview / demo apply

```bash
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal perp-short --approve --approved-by demo-operator
```

Why `perp-short`?

Because it is a **swap-style** proposal and is useful when you want to verify the wallet-aware X Layer / `onchainos` route.

Look for these signals:

- `Wallet: <address>`
- `Integration: onchainos`
- `onchainos swap execute ... --wallet <address>`

### When to use `protective-put`

Use `protective-put` when you want to inspect an option-style hedge proposal.
Do **not** use it if your goal is to prove the X Layer swap route, because it does not hit the same execution path.

---

## 5. Export the result

```bash
node dist/bin/trademesh.js export <run-id>
```

This gives you an evidence pack, not just terminal output.
Usually you want:

- report
- operator summary
- portable `bundle.json`

---

## 6. Replay the run

```bash
node dist/bin/trademesh.js replay --bundle .trademesh/exports/<run-id>/bundle.json
```

This is where Skills Mesh becomes more than a one-shot agent.
You can inspect the route again, prove what happened, and carry the result to another environment.

---

## 7. The shortest high-value path

If you are in a hurry, run exactly this:

```bash
cd ~/apps/apps/okx-skill-mesh
npm run build
export SKILLS_MESH_AGENT_WALLET=<your_xlayer_wallet>
node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply
node dist/bin/trademesh.js plan "protect BTC downside with 4% max drawdown" --plane demo
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal perp-short --approve --approved-by demo-operator
node dist/bin/trademesh.js export <run-id>
node dist/bin/trademesh.js replay --bundle .trademesh/exports/<run-id>/bundle.json
```

---

## 8. How to think about proposal choice

Choose a proposal based on what you want to learn or verify:

- `perp-short`
  - use when you want a **swap-like de-risk route**
  - useful for checking wallet-aware X Layer / `onchainos` behavior
- `de-risk`
  - use when you want a broader reduction path
  - also relevant for swap execution checks depending on generated route
- `protective-put`
  - use when you want an **option hedge** view
  - not the right proposal for proving the X Layer swap route

If your question is:

> “Can this runtime bind execution to a wallet and route an eligible X Layer swap through onchainos?”

Then use `perp-short`.

---

## 9. What value you already got

After one successful quickstart run, you already have:

- structured goal intake
- ranked actionable proposals
- policy-aware execution preview
- wallet-aware routing metadata
- replayable and exportable evidence

That is already useful even before live execution.

---

## 10. If you only keep one sentence

Skills Mesh is useful when you want a chain of risk-aware decisions to be **structured, supervised, and replayable** instead of disappearing into a chat log.
