# X-Matrix — Build X Season 2 Submission Copy

---

## 50-word version

X-Matrix is a proof-carrying skill runtime for agentic onchain workflows on X Layer. Skills auto-compose through typed artifacts, execution routes through Agentic Wallet + Onchain OS, and every run produces replayable route proofs. Not a trading bot — a reusable onchain workflow engine.

---

## 120-word version

X-Matrix turns installable agent skills into verifiable onchain workflows on X Layer.

Each skill is a self-contained directory with a typed artifact contract. The runtime auto-discovers installed skills, compiles their dependency graph into parallel execution plans, and statically verifies safety invariants before execution. The `agent-wallet` skill binds workflows to an Agentic Wallet identity, and `official-executor` routes eligible X Layer swap actions through Onchain OS.

Every run generates `mesh.route-proof` — machine-verifiable evidence of what executed, what was skipped, and why the route is minimally sufficient. Runs export as portable `bundle.json` and replay anywhere without local state.

This is not a one-off trading script. It's a reusable skill product — install different skill packs, get different onchain workflows. The runtime adapts.

---

## One-paragraph version (for forms)

X-Matrix is a modular, proof-carrying skill runtime designed for agentic onchain workflows on X Layer. It introduces three key innovations: (1) installable skill packs with typed artifact contracts that auto-compose into execution plans through dependency resolution, (2) wallet-aware execution where `agent-wallet` binds workflows to an Agentic Wallet identity and `official-executor` routes X Layer swap actions through Onchain OS, and (3) cryptographic route proofs that make every workflow replayable, auditable, and exportable as portable bundles. The same runtime powers hedge flows today and can power any wallet-aware onchain workflow tomorrow by installing different skill packs. Built with TypeScript, Merkle DAG artifact integrity, static safety invariant verification, progressive trust planes (research → demo → live), and a single-write-path safety model.

---

## Social post — X/Twitter

### Short version

Ship agent skills like plugins, not scripts.

X-Matrix auto-composes typed artifact dependencies into onchain workflows on X Layer. Agentic Wallet binding. Onchain OS routing. Route proofs for every run.

Built for Build X Season 2. Replayable, auditable, exportable.

🔗 [repo link]

### Longer version

What if agent skills were installable like npm packages?

X-Matrix is a proof-carrying skill runtime for X Layer:
▸ Skills auto-compose through typed artifact contracts
▸ Agentic Wallet binds execution identity
▸ Onchain OS routes X Layer swaps
▸ Every run gets a cryptographic route proof
▸ Export as portable bundle, replay anywhere

Not a trading bot. A reusable onchain workflow engine.

🔗 [repo link]

---

## Track & Category

- **Track**: Human Track / Skills Arena
- **Product**: X-Matrix
- **Category**: reusable agent skill runtime + onchain workflow execution + verifiable proof

---

## Key Proof Points (for judges)

1. **Real X Layer tx**: `0x680198e29d10b538397a90505141417101e7786fccf1991c4c451db8cefb0ed1`
2. **Agentic Wallet**: `0x2dcb1965ec07932bfaa165b043e0a7dc9b9eaf7e` (Google OAuth onboarding)
3. **158 tests passing**, `skills certify --strict` passes
4. **End-to-end demo**: doctor → plan → apply → export → replay with wallet-aware onchainos routing
5. **Merkle DAG integrity** on every artifact chain
6. **Static safety invariant verification** (6 invariants checked before execution)
