# Skills Mesh Next Steps

This is the current execution board for the next phase.

Principle:

> Build something we would still want to use even without a competition.

So the order is not “package first”.
The order is:

1. make the default product path solid
2. verify the path in a clean demo
3. capture proof clearly
4. only then package the story

---

## P0 — Must do next

### 1. Re-run the default product path end to end

Goal: verify the path a real user would take still works cleanly.

Path:

- `doctor`
- `plan`
- `apply --proposal perp-short`
- `export`
- `replay --bundle`

What to check:

- environment readiness is readable
- `run-id` is easy to spot
- proposal choice is understandable
- apply output clearly shows wallet-aware X Layer / `onchainos` routing
- export/replay output is easy to explain

Status: **verified once on 2026-04-13, keep re-running after UX changes**

Current findings from the latest run:

- the core path does work end to end in dry-run mode
- `apply --proposal perp-short` clearly shows wallet-aware X Layer / `onchainos` routing
- `export` and `replay --bundle` work cleanly
- but `plan` still nudges users toward `protective-put` in `Next Safe Action`, which is not the best proposal when the goal is proving the X Layer swap route
- `Mesh Proof` currently reports `proofPassed: no` because `live-guard` is considered redundant on this route; this is acceptable for now as a runtime truth, but it is a product/UX issue worth fixing or explaining

---

### 2. Capture the 3 most important proof frames

Goal: collect proof assets before doing polished recording.

Required frames:

1. `plan` result with proposal ranking and `run-id`
2. `apply` result showing:
   - `Wallet: ...`
   - `Integration: onchainos`
   - `onchainos swap execute ...`
3. `replay --bundle` result showing route proof / bundle replay

Recommended screenshot names:

- `01-plan-ranked-proposals.png`
- `02-apply-onchainos-routing.png`
- `03-export-bundle-paths.png`
- `04-replay-bundle-proof.png`

Status: **next action**

---

### 3. Improve output comprehension where users will hesitate

Goal: reduce thinking cost during real usage.

Most likely hesitation points:

- what proposal to choose
- whether a proposal is option-style or swap-style
- whether the route will hit `onchainos`
- whether the current result is just preview or actionable

Suggested implementation direction:

- improve `plan` output hints
- improve `apply` summary wording
- add human-readable route hints near proposal selection

Status: **next product work after re-verification**

---

## P1 — Important, but after P0

### 4. Record a clean demo

Goal: record one clean run after the path is re-verified.

Preferred order:

- record proof frames first
- then record 90-second cut
- then record 3-minute cut if useful

Rule:

- do not record before the product path feels smooth

---

### 5. Keep docs aligned with actual behavior

Docs that should stay aligned:

- `README.md`
- `docs/QUICKSTART.md`
- `docs/USE-CASES.md`
- `docs/BUILDX-DEMO-SCRIPT.md`
- `docs/SUBMISSION-CHECKLIST.md`

Rule:

- if a command changes, docs change the same day
- if the best proposal changes, docs change the same day

---

## P2 — Packaging, only after product path is solid

### 6. Submission materials

Includes:

- final recording
- final screenshots
- final form copy
- social post copy

Rule:

- no claim without a visible proof frame

---

## Current recommendation

If starting right now, do this in order:

1. run the full default path once
2. save proof screenshots
3. note every place that feels confusing
4. improve output wording / UX
5. then record demo

That is the shortest path to both a better product and a better presentation.
