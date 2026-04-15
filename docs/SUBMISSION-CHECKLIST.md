# X-Matrix — Build X Submission Checklist

Use this as the final submission control sheet.

Goal: make sure the Build X submission is not just technically strong, but also **product-grounded, complete, and easy to verify**.

---

## 0. Final positioning

### One-line positioning

> X-Matrix is a proof-carrying reusable skill runtime for agentic onchain workflows on X Layer.

### Short submission pitch

> X-Matrix turns installable agent skills into verifiable onchain workflows.  
> In the Build X version, analysis and planning skills produce typed artifacts, `agent-wallet` binds execution to an Agentic Wallet identity, and `official-executor` routes eligible X Layer swap actions through `onchainos`, while keeping a supervised single-write-path safety model.  
> Every workflow is replayable, exportable, and backed by route proof.

---

## 1. Repo and docs readiness

- [ ] README first screen is competition-facing
- [ ] README uses **X-Matrix** naming consistently
- [ ] README foregrounds:
  - [ ] X Layer
  - [ ] Agentic Wallet
  - [ ] onchainos / DEX path
  - [ ] replay / export / proof
- [ ] README demo commands are still valid
- [ ] README.zh-CN is aligned with English positioning
- [ ] RUNBOOK naming is aligned with X-Matrix branding
- [ ] `docs/BUILDX-DEMO-SCRIPT.md` is present and usable
- [ ] No embarrassing wording remains:
  - [ ] “legacy”
  - [ ] “old implementation”
  - [ ] “temporary patch”
  - [ ] “not finished” / “draft” / “broken” / “hacky”

---

## 2. Technical proof package

### A. Reproducible command path

- [ ] `pnpm build`
- [ ] `pnpm test`
- [ ] `node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply`
- [ ] `node dist/bin/trademesh.js skills certify --strict`
- [ ] `node dist/bin/trademesh.js plan "protect BTC downside with 4% max drawdown" --plane demo`
- [ ] `node dist/bin/trademesh.js apply <run-id> --plane demo --proposal perp-short --approve --approved-by demo-operator`
- [ ] `node dist/bin/trademesh.js export <run-id>`
- [ ] `node dist/bin/trademesh.js replay --bundle .trademesh/exports/<run-id>/bundle.json`

### B. Must-have visible proof in terminal

During the demo, capture these signals clearly:

- [ ] `Wallet: <address>`
- [ ] `Integration: onchainos`
- [ ] `onchainos wallet balance --chain xlayer`
- [ ] `onchainos swap execute ... --wallet <address>`
- [ ] export bundle path
- [ ] replay from bundle succeeds

### C. Real onchain proof

- [ ] X Layer wallet address recorded
- [ ] Real X Layer tx hash recorded
- [ ] Explorer link prepared
- [ ] One screenshot or terminal frame showing the tx / result
- [ ] One sentence explaining: real swap already succeeded outside the mesh; the mesh demo proves wallet-aware route generation and proof-carrying replay

### Current known proof items

Fill these before final submission:

- Wallet address: `0x2dcb1965ec07932bfaa165b043e0a7dc9b9eaf7e`
- Real X Layer tx: `0x680198e29d10b538397a90505141417101e7786fccf1991c4c451db8cefb0ed1`
- Demo proposal for onchainos route: `perp-short`

---

## 3. Video submission assets

### A. Main recording

- [ ] 90-second version recorded
- [ ] 3-minute version recorded
- [ ] Terminal font is readable
- [ ] No secrets visible on screen
- [ ] Wallet address is okay to show
- [ ] Demo follows `docs/BUILDX-DEMO-SCRIPT.md`

### B. Suggested video structure

- [ ] 5-10s: repo / README first screen
- [ ] 10-20s: `skills graph` or quick architecture context
- [ ] 20-40s: `doctor`
- [ ] 40-65s: `plan`
- [ ] 65-95s: `apply --proposal perp-short`
- [ ] 95-115s: point to `Wallet` + `Integration: onchainos`
- [ ] 115-140s: `export`
- [ ] 140-170s: `replay --bundle`
- [ ] final line: what makes X-Matrix different

### C. Spoken message consistency

- [ ] Say “reusable skill product”, not “just a bot”
- [ ] Say “wallet-aware execution”, not only “trading automation”
- [ ] Say “proof-carrying / replayable / exportable”
- [ ] Say “eligible X Layer swap actions route through onchainos”
- [ ] Do not over-explain old OKX-only history

---

## 4. Short materials grounded in product truth

### A. One-page summary

- [ ] Create a one-page summary doc only if it reflects actual product behavior
- [ ] Include:
  - [ ] What it is
  - [ ] Why it matters in normal use, not only in demo form
  - [ ] Why X Layer
  - [ ] Why Agentic Wallet
  - [ ] Why onchainos
  - [ ] What is verified today
  - [ ] How to understand it in 60-90 seconds

### B. Submission brief

- [ ] 50-word version
- [ ] 120-word version
- [ ] 1-paragraph version for forms / announcements

### C. Social post

- [ ] X / Twitter post draft
- [ ] Short version with demo link
- [ ] Longer version with technical differentiators

---

## 5. Form submission readiness

Before filling the final form:

- [ ] Repo URL ready
- [ ] Demo video URL ready
- [ ] X / social post URL ready
- [ ] Short description ready
- [ ] Longer description ready
- [ ] Team / contact info ready
- [ ] Track choice confirmed
- [ ] Any required tx / onchain proof attached

### Recommended narrative for forms

- Track: **Human Track / Skills Arena**
- Product label: **X-Matrix**
- Category framing: reusable agent skill runtime + onchain workflow execution + verifiable proof

---

## 6. Final anti-footgun check

Before submission, verify all of these:

- [ ] No outdated `TradeMesh` branding in public-facing docs unless intentionally kept for CLI compatibility
- [ ] No stale test count badge
- [ ] No dead links in README
- [ ] No commands that obviously fail in the demo path
- [ ] No screenshots exposing tokens / auth state
- [ ] No wording that sounds like apology or technical debt confession
- [ ] No mismatch between what video shows and what README claims

---

## 7. Final operator runbook for submission day

### Run order

```bash
cd ~/apps/apps/okx-skill-mesh
pnpm build
pnpm test
cp .env.example .env   # fill in your wallet address
node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply
node dist/bin/trademesh.js skills certify --strict
node dist/bin/trademesh.js plan "protect BTC downside with 4% max drawdown" --plane demo
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal perp-short --approve --approved-by demo-operator
node dist/bin/trademesh.js export <run-id>
node dist/bin/trademesh.js replay --bundle .trademesh/exports/<run-id>/bundle.json
```

### Submission-day rule

If anything is flaky, prefer:

- shorter demo
- clearer proof frame
- fewer claims
- stronger replay/export evidence

Do not add complexity at the last minute.

---

## 8. Definition of done

Submission is truly ready when all are true:

- [ ] README tells the right story fast
- [ ] Demo video shows wallet-aware X Layer / onchainos routing clearly
- [ ] Real onchain proof is attached
- [ ] Replay/export proof is shown
- [ ] Judge one-pager exists
- [ ] Form copy is prewritten
- [ ] Final links are collected in one place

When all boxes are checked, stop polishing and submit.
