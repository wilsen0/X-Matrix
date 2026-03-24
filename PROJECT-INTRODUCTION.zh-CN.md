# TradeMesh 产品介绍

> TradeMesh 是一组基于 OpenClaw 智能助手构建的模块化交易 skill pack，融合 OKX Agent Trade Kit 作为执行内核，让用户通过自然对话完成从目标设定到方案执行的完整交易工作流。

## 1. 这是什么

TradeMesh 是为 [OpenClaw](https://github.com/openclaw/openclaw)（开源 AI 私人助手平台）打造的交易能力扩展。用户不需要手动输入任何命令——只需要用自然语言告诉 OpenClaw 您的交易目标，TradeMesh 的 skills 会自动协同完成以下工作：

- 理解您的目标并标准化
- 读取账户与市场上下文
- 生成多套方案并排序
- 做情景压力测试和 policy 审核
- 通过 OKX Agent Trade Kit 执行交易
- 保存完整 run 记录，支持 replay 和 export

底层通过 [OKX Agent Trade Kit](https://github.com/okx/agent-trade-kit)（官方 CLI + 基础 Skills）作为唯一执行内核，所有交易操作都经过 policy 审核和权限收口。用户看到的是对话，系统做到的是可控、可解释、可回放。

## 2. 它解决什么问题

很多 AI 交易产品的问题不在"不会分析"，而在于：

1. 分析、决策、执行是断裂的。
2. 写操作权限没有被严格收口。
3. 决策过程不可解释，出了问题无法复盘。

TradeMesh 把职责拆分到独立的 skills 中：

- sensor skills 负责观察（portfolio-xray、market-scan）
- planner skills 负责生成方案（trade-thesis、hedge-planner、scenario-sim）
- guardrail skills 负责控制风险（policy-gate）
- executor skill 负责唯一写路径（official-executor）
- replay / export 负责还原事实

OpenClaw 作为智能助手层负责理解用户意图并编排这些 skills，让整个流程对用户透明且可控。

## 3. 您可以把它理解成什么产品

TradeMesh 是 OpenClaw 的交易能力层：

- 一组可独立安装、自动协同的交易 skills
- 一个基于 OKX Agent Trade Kit 的受控执行引擎
- 一个带护栏的交易工作流编排系统
- 一个可回放的交易决策记录系统

用户只需要像安装普通 OpenClaw skill 一样安装 TradeMesh，就能获得完整的交易工作流能力。

> TradeMesh 让"目标 → 方案 → 审核 → 执行 → 回放"成为一条受控链路，用户通过自然对话驱动，系统自动编排执行。

## 4. 您今天能用它做什么

当前版本最完整的能力是"组合风险观察与对冲规划"。

### 用户体验

通过 OpenClaw 对话即可完成完整工作流：

> "帮我看看 BTC 的持仓风险，如果回撤超过 4%，给我一个对冲方案"

OpenClaw 会自动编排 TradeMesh skills：扫描持仓 → 分析市场 → 生成对冲方案 → policy 审核 → 预览执行命令 → 等待您确认后执行。

您还可以：

- 让系统基于您的目标生成多套对冲方案并排序
- 查看每个方案的可行动性、环境缺口和 policy 审核结果
- 在 dry-run 模式下预览完整执行计划
- 确认后在 demo 环境执行并即时验证结果
- replay 回放任意一次 run 的完整决策链路
- export 导出可携带的证据包（report + bundle + operator summary）

### 底层能力

对于需要精细控制的高级用户，TradeMesh 也提供完整的 CLI 接口：

```bash
# 一键演示流程
pnpm demo:flow
pnpm demo:flow -- --execute --approved-by alice

# 环境健康检查
trademesh doctor --probe active --plane demo --strict --strict-target apply

# 技能图与合同认证
trademesh skills graph
trademesh skills certify --strict

# 目标规划
trademesh plan "hedge my BTC drawdown" --plane demo --symbol BTC --max-drawdown 4 --intent protect-downside --horizon swing

# 审批执行与验证
trademesh apply <run-id> --plane demo --proposal protective-put --approve --approved-by alice --execute --verify-receipt

# 回放与导出
trademesh replay <run-id>
trademesh export <run-id>
```

## 5. 它为什么有实际价值

TradeMesh 的实际价值主要来自 4 点。

### 5.1 把目标变成稳定输入

系统现在会把目标写成 `goal.intake`，而不是让不同模块各自猜测。

这意味着：

- symbol 解释是稳定的
- 目标回撤是稳定的
- 对冲意图是稳定的
- 周期判断是稳定的

从 `plan` 到 `apply` 再到 `replay / export`，您看到的是同一份目标解释，而不是每一步都重新推断。

### 5.2 把"方案"变成"可行动方案"

TradeMesh 不只是给您一个评分最高的方案，还会明确告诉您：

- 当前推荐的方案是什么
- 这个方案为什么被推荐
- 它当前是否可 dry-run
- 它是否具备 demo 执行条件
- 缺少什么环境条件
- 是 policy 拦截了它，还是环境还没准备好

这让系统更像真实产品，而不是只会输出一段建议文字。

### 5.3 把执行权限收口

系统严格区分官方能力与自定义能力：

- OKX Agent Trade Kit 的官方基础 skills（market / trade / portfolio / bot）负责底层执行
- 自定义高阶 skills（hedge-planner、scenario-sim 等）只做"读、想、审"，不直接写交易
- `official-executor` 是唯一写路径，所有写操作最终通过 OKX 官方 CLI 执行
- `policy-gate` 是写前的必经节点
- `research` plane 禁止所有写 intent
- `demo` plane 默认 preview-first
- `live` plane 要求显式批准

这意味着，智能判断和最终执行是解耦的。自定义 skill 永远不会直接触碰用户资产。

### 5.4 把结果变成证据

每次 run 都可以被 replay，也可以 export。

这对真实使用很重要，因为您最终需要的不只是"系统说了什么"，而是：

- 它依据了什么
- 它走了哪些 skill
- 它通过了哪些 policy
- 它最终生成了哪些命令
- 它在什么地方被阻塞

## 6. 它是怎么工作的

TradeMesh 的结构可以分成三层。

### 第一层：OKX Agent Trade Kit（执行内核）

最底层是 OKX 官方的 [Agent Trade Kit](https://github.com/okx/agent-trade-kit)，包括：

- `okx` CLI：确定性执行接口，支持 `--json` 结构化输出、`--demo` 模拟盘、`--read-only` 只读模式
- 官方基础 Skills：`okx-cex-market` / `okx-cex-trade` / `okx-cex-portfolio` / `okx-cex-bot`

这层只负责确定性执行（读账户、读市场、下单、撤单、查询结果），所有安全机制（本地签名、权限感知、模拟盘隔离）由 OKX 官方保障。TradeMesh 不允许任何上层模块绕过它直接写交易请求。

### 第二层：Skill Runtime（编排引擎）

这是 TradeMesh 真正的核心。它负责：

- 动态发现已安装的 skills（扫描 `skills/*/SKILL.md`）
- 读取 YAML frontmatter，解析输入输出合同
- 将 artifact 依赖图编译为带并行标注的执行计划（DAG Compiler：拓扑排序、并行分支检测、关键路径分析、dead-skill 消除）
- 在执行前静态验证安全不变量（Safety Verifier：写路径护栏、审批路径、无环、capability 可满足性、单写者、完备性）
- 为每个 artifact 构建 Merkle DAG 密码学完整性链——篡改任何上游 artifact 会使所有下游哈希失效
- 持久化 trace / policy / execution / artifact 快照
- 通过 OpenClaw 接收用户自然语言指令并路由到对应 skill 链

这层不关心单个策略细节，关心的是"系统如何安全、有序、可验证地运行"。安装一个新 skill 目录，就等于给系统装一个新的能力模块——无需改主程序，无需重新配置。

### 第三层：Skill Packs（能力模块）

Skills 分为两类：

**OKX 官方基础 Skills**（执行层）：
- `market` — 行情数据
- `trade` — 交易执行
- `portfolio` — 账户与持仓
- `bot` — 算法单与网格

**自定义高阶 Skills**（分析、规划、风控层）：
- `portfolio-xray` — 持仓风险扫描
- `market-scan` — 市场环境分析
- `trade-thesis` — 交易论点综合
- `hedge-planner` — 对冲方案生成
- `scenario-sim` — 情景压力测试
- `policy-gate` — 风控审核
- `official-executor` — 受控执行（唯一写路径）
- `replay` — 全链路回放

旗舰对冲链路：

```text
portfolio-xray
  -> market-scan
  -> trade-thesis
  -> hedge-planner
  -> scenario-sim
  -> policy-gate
  -> official-executor
  -> replay
```

## 7. 模块化 Skill 设计理念

TradeMesh 的核心设计理念是模块化：每个 skill 都是独立的能力单元，可以单独安装、单独运行、单独验证。

### 独立可用

每个 skill 都声明了自己的输入输出合同（`SKILL.md` manifest），包括：

- 需要什么 artifacts 作为输入
- 产出什么 artifacts 作为输出
- 独立运行时的 mini-workflow 路由
- 所需的环境能力（capabilities）

这意味着您可以只安装 `market-scan` 来做市场分析，或者只安装 `portfolio-xray` 来做持仓诊断，每个 skill 都能独立工作。

### 协同编排

当多个 skills 同时安装后，Skill Runtime 会根据 artifact 依赖关系自动编排执行顺序。不需要手动配置 skills 之间的连接——只要 skill A 的输出恰好是 skill B 的输入，系统就会自动把它们串联起来。

旗舰对冲工作流就是这样自然形成的：

```text
portfolio-xray → market-scan → trade-thesis → hedge-planner → scenario-sim → policy-gate → official-executor → replay
```

### 安装即生效（热插拔）

每个 skill 就是一个目录——安装一个目录，就等于给系统装一个新的能力模块。

- Skill Runtime 启动时自动扫描 `skills/*/SKILL.md`，动态发现所有已安装的 skills
- 新装一个 skill，不需要改主程序，不需要重新配置，不需要写编排脚本
- 卸载一个 skill，系统自动调整能力范围
- 通过 `skills ls` 查看当前已安装的 skills，通过 `skills graph` 查看协作拓扑

这意味着系统的能力面不是硬编码的，而是由当前安装的 skills 动态决定。今天装上 `hedge-planner`，系统就有对冲能力；明天再装上 `rebalance-planner`，系统就多了再平衡能力。OKX Agent Trade Kit 本身也在快速演进（从 82 个工具 / 7 模块到 106 个工具 / 8 模块），热插拔机制确保系统能力可以随官方更新同步扩展。用户通过 OpenClaw 对话即可触发任何已安装的 skill。

## 8. 为什么它用 artifact，而不是 skill 之间自由对话

因为真正可维护的系统不能靠模块之间"互相猜意思"。

TradeMesh 采用 artifact handoff。当前关键 artifact 包括：

- `goal.intake`
- `portfolio.snapshot`
- `portfolio.risk-profile`
- `market.snapshot`
- `market.regime`
- `trade.thesis`
- `planning.proposals`
- `planning.scenario-matrix`
- `policy.plan-decision`
- `execution.intent-bundle`
- `execution.apply-decision`
- `approval.ticket`
- `execution.reconciliation`
- `report.operator-summary`
- `mesh.route-proof`

这么做的好处是：

- 输入输出更稳定
- 测试更清晰
- 回放更可信
- 更容易增加新 skill
- 更容易定位问题
- 更容易证明某个 skill 是否真的可以被独立恢复和重跑

## 9. 当前版本最重要的能力升级

### 9.1 Structured Goal Intake

系统会在最开始生成 `goal.intake`，把您的目标标准化。

支持的显式输入包括：

- `--symbol`
- `--max-drawdown`
- `--intent`
- `--horizon`

### 9.2 Capability-aware Proposal

每个 proposal 现在都会附带：

- `actionable`
- `executionReadiness`
- `capabilityGaps`

这让 `plan` 阶段就能回答"现在到底能不能做"。

### 9.3 Safer Execution / Retry

每个 intent 都会带上：

- `intentId`
- `stepIndex`
- `safeToRetry`

并且：

- 写 intent 不会自动重试
- 只有安全读 intent 才会在可重试错误下重放
- `retry` 不会重放已经成功的写操作

### 9.4 Approval + Idempotency + Reconcile

M2 阶段新增了三条关键运行时护栏：

- `apply --execute` 必须显式 `--approve --approved-by <name>`，并落 `approval.ticket`
- 写 intent 在执行前会命中本地幂等 ledger 做去重
- 状态不确定时使用 `reconcile <run-id>` 收敛为 `matched / ambiguous / failed`

M2.5 在此基础上进一步收口可靠性：

- 幂等账本升级为 v3 事件账本：
  `.trademesh/ledgers/idempotency.v3.snapshot.json` + `.trademesh/ledgers/idempotency.v3.journal.jsonl` + `.trademesh/ledgers/idempotency.v3.lock`
- `reconcile` 增加 `--source auto|client-id|fallback` 与 `--window-min`，支持可解释的窗口化匹配
- `live` 执行增加强制门槛：
  `--live-confirm YES_LIVE_EXECUTION --max-order-usd --max-total-usd`，并要求 15 分钟内 active doctor 结果

M2.6 在保持 KISS 的前提下强化了可运营细节：

- `doctor` 失败探测统一为 `reasonCode`，并给出 `nextActionCmd`
- `doctor --strict` 可直接作为 CI 或值班流程的阻断门禁
- `reconcile --until-settled` 可自动循环收敛，减少人工重复执行
- replay 与 export 共用 `operator-brief` 六字段首屏，避免"口径不一致"
- `skills certify` 输出 `mesh.skill-certification`，把"模块化可独立工作"变成可量化证据

### 9.5 Standalone Skill Contract

每个 skill 现在都有显式的 standalone 合同（route/input/output/capabilities）。

这意味着：

- 每个 skill 都可以独立调用
- 独立调用仍然走 artifact handoff，不走隐式耦合
- 独立调用结果同样可 replay / export
- 独立调用还可以通过 `--skip-satisfied` 直接利用已有 artifacts 作为恢复点

### 9.6 Active Probe + Rehearsal

系统现在新增了两条运行时能力：

- `doctor --probe passive|active|write`：输出模块级健康状态和 probe receipts
- `rehearse demo`：走固定演练路线并生成 `operations.rehearsal-plan` / `operations.rehearsal-receipt`

### 9.7 Skill 合同认证

系统新增 `skills certify` 命令，对每个 skill 做三类检查：

- 合同完整性（manifest 必填字段）
- standalone route 合法性（终点 skill 与依赖路由一致）
- standalone 输出可用性（声明输出可由 route 产出）

进一步，这个能力变成了"可执行认证"：

- `portable` skill 会读取 proof fixture，真的跑一遍 mini-route
- `structural` skill 明确只做结构合同证明，不假装脱离环境也能本地证明

### 9.8 Proof-Carrying Mesh

TradeMesh 现在不只是"可 replay 的 runtime"，而是 proof-carrying runtime。

每次关键 run 都会自动生成 `mesh.route-proof`，回答这些问题：

- 这条 route 为什么成立
- 哪些 step 真正执行了
- 哪些 step 因为输入已满足而被 `skipped_satisfied`
- 这条链是否已经足够精简
- 可以从哪些 skill 作为恢复点继续执行

这是最核心的创新点：把"模块化 skills 可独立工作、可拼装、可恢复"做成系统自己能证明的能力。

M2.7 把这个方向进一步收口：

- `skills certify` 对 portable skills 执行 fixture-route proof，而不只是静态检查
- `skills run --skip-satisfied` 可以利用已有 artifacts 从中间恢复
- 每个关键 run 都会写出 `mesh.route-proof`
- replay 与 export 会直接展示 route minimality、resume point 与 rerun command

### 9.9 Portable Verified Bundles

proof 不再只绑定本地 run 目录，而是可以随导出的 bundle 一起携带。

核心能力：

- `bundle.json` 现在是 portable verified bundle，内含：
  - `artifactSnapshot`
  - `manifestProof`
  - `businessBrief`
  - `operatorSummary`
  - `meshRouteProof`
- `replay --bundle <bundle.json>` 可以在没有本地 `.trademesh/runs/<id>/` 的情况下直接复核一次 run
- `skills run --bundle <bundle.json>` 可以在合同未漂移时直接做局部 rerun；若合同漂移，系统会明确阻断，除非显式 `--allow-contract-drift`

同时，demo execute 也新增了即时验证能力：

- `apply --execute --verify-receipt`
- `rehearse demo --execute --verify-receipt`

这意味着 demo execute 不再只是"执行过"，而是可以立即告诉您：

- receipt 是否已经可回读
- 当前是 `verified`、`pending`、`ambiguous` 还是 `failed`
- 下一步安全动作是否应当进入 `reconcile`
- 认证结果会给出 `proofPassed`、`proofMode`、`rerunCommand`

这让 TradeMesh 的创新点不再停留在"理念描述"，而是可以产出机器可验证报告。

### 9.10 Exportable Evidence Pack

每次 run 都可以输出：

- `report.md`
- `bundle.json`
- `operator-summary.json`
- `report.operator-brief`（用于 replay/export 首屏的 6 字段摘要）

前者适合阅读和审阅，后者适合归档和系统集成。

### 9.11 DAG Compiler（依赖图编译器）

系统将 skill 之间的 artifact 依赖关系编译为带并行标注的执行计划：

- Kahn's algorithm 拓扑排序，确保执行顺序严格遵循依赖关系
- 并行分支检测：无互相依赖的 skills 被分组到同一执行层级，可并发执行
- 关键路径分析：标注最长依赖链，识别瓶颈
- Dead-skill 消除：给定目标输出 artifacts，反向可达性分析自动剪除不必要的 skills

输出 `ExecutionPlan`，包含 `levels[]`（并行层级）、`criticalPath`（关键路径）、`maxParallelism`（最大并行度）、`prunedSkills`（被剪除的 skills）。

### 9.12 Merkle DAG 密码学完整性链

每个 artifact 携带密码学完整性证明：

- 每个 artifact 的 content hash = SHA-256(stable-JSON(key + data))
- chained hash = SHA-256(contentHash + 排序后的上游 artifact chained hashes)
- 篡改任何上游 artifact，所有下游哈希自动失效
- 支持单 artifact 验证：给定 `MerkleProofPath`，无需重放整条链即可验证单个 artifact
- 支持全链验证：重算所有 chained hash，检测任何被篡改或缺失的节点

这把"可审计"从文档描述变成了密码学保证。

### 9.13 静态安全不变量验证

在任何组合工作流执行前，系统对依赖 DAG 静态验证六项安全不变量：

- 写路径护栏：每个 `writes: true` 的 skill 上游必须有 `stage: "guardrail"` 的祖先
- 审批路径：每个 `writes: true` 的 skill 上游必须有名称包含 "approval" 的祖先
- 无环：依赖图不能有环（检测到环时报告完整环路径）
- Capability 可满足性：所有 skill 的 `requiredCapabilities` 在当前环境下可满足
- 单写者：每个 artifact 最多由一个 skill 产出
- 完备性：每个被消费的 artifact 必须由某个 skill 产出或作为初始输入提供

输出 `SafetyVerdict`，包含通过/失败状态、每项不变量的详细结果、违规明细。本质上是一个面向 skill 工作流的轻量级 model checker。

## 10. 当前版本的能力范围

当前版本已经可以稳定完成以下工作：

- 本地环境检查与模块级健康诊断
- 技能图验证与合同认证
- 目标标准化（structured goal intake）
- 对冲方案生成、排序与 capability-aware policy 审核
- dry-run 预演与 demo 执行即时验证
- replay 全链路回放与 export 可携带证据包
- 依赖图编译为带并行标注的执行计划（DAG Compiler）
- 执行前静态安全不变量验证（6 项检查）
- Merkle DAG 密码学完整性链（artifact 级篡改检测）

系统设计遵循渐进式信任模型：从 `research` 到 `demo` 再到 `live`，每一层都有独立的安全门禁和审批流程。

## 11. 产品定位

TradeMesh 是 OpenClaw 生态中的交易能力层。它不是一个独立的交易终端，而是一组可安装的模块化 skills，通过 OpenClaw 的智能编排能力为用户提供完整的交易工作流。

核心价值：

- 用户通过自然对话驱动，无需理解底层命令
- 每个 skill 独立可用，多个 skills 自动协同
- OKX Agent Trade Kit 作为唯一执行内核，写操作严格收口
- 全流程可审计、可回放、可导出

## 12. 总结

TradeMesh 把交易相关的分析、方案、风控、执行和复盘组织成一条可控、可解释、可回放的链路。用户通过 OpenClaw 自然对话即可驱动整个工作流，底层由模块化 skills 自动编排、OKX Agent Trade Kit 安全执行。

> 一组基于 OpenClaw 构建的模块化交易 skills，以 OKX Agent Trade Kit 为执行内核，以 policy 与 replay 为可信基础，让交易工作流变得可控、可解释、可回放。
