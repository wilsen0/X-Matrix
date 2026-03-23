# TradeMesh 产品介绍

> TradeMesh 是一个以 `okx` CLI 为唯一执行内核、以 skill mesh 为运行时、以 policy 与 replay 为可信基础的 CLI 原生交易工作流系统。

## 1. 这是什么

如果您把它当成一个"会聊天的交易机器人"，会低估它。

TradeMesh 的重点不在聊天，而在把交易相关的几个关键环节连成一条可控、可解释、可回放的链路：

- 理解您的目标
- 读取账户与市场上下文
- 生成多套方案并排序
- 做情景压力测试和 policy 审核
- 把最终方案翻译成可执行的 OKX CLI 命令
- 保存完整 run 记录，支持 replay 和 export

它不是通用 agent 框架，也不是 web UI 外壳，而是一个面向真实交易流程的运行时。

## 2. 它解决什么问题

很多 AI 交易产品的问题不在"不会分析"，而在于：

1. 分析、决策、执行是断裂的。
2. 写操作权限没有被严格收口。
3. 决策过程不可解释，出了问题无法复盘。

TradeMesh 不是把所有事情交给一个模型，而是把职责拆开：

- sensor skills 负责观察
- planner skills 负责生成方案
- guardrail skills 负责控制风险
- executor skill 负责唯一写路径
- replay / export 负责还原事实

这样做的目标很直接：让系统不仅能给建议，还能把建议变成一个可审计、可复核、可逐步执行的工作流。

## 3. 您可以把它理解成什么产品

TradeMesh 更接近以下产品，而不是聊天助手：

- 一个交易工作流编排器
- 一个 CLI 原生的策略运行时
- 一个带护栏的执行控制层
- 一个可回放的交易决策记录系统

如果要用一句话定义它：

> TradeMesh 让"目标 -> 方案 -> 审核 -> 执行 -> 回放"成为一条受控链路，而不是几个分散步骤。

## 4. 您今天能用它做什么

当前版本最完整的能力是"组合风险观察与对冲规划"。

您可以：

- 检查本地环境是否具备 plan / apply / execute 能力
- 用 `doctor --probe active|write` 做主动探测，而不是只看静态配置
- 用 `doctor --strict --strict-target plan|apply|execute` 作为自动化门禁
- 让系统基于您的目标生成对冲方案
- 用 `--symbol`、`--max-drawdown`、`--intent`、`--horizon` 显式约束目标
- 查看每个 proposal 的可行动性、环境缺口和 policy 结果
- 通过 `skills certify` 量化证明模块化 skill 的合同完整性与独立可执行性
- 通过 `skills certify --strict` 把 modularity proof 变成可执行门禁
- 通过 `skills run <name>` 独立调用任意 skill 的 mini-workflow
- 通过 `skills run --skip-satisfied` 基于现有 artifacts 从中间恢复 skill 路由
- 通过 `skills run --bundle <bundle.json>` 从导出的 portable bundle 恢复 skill 路由
- 通过 `rehearse demo` 做标准化演练并生成 rehearsal receipt
- 通过 `apply --execute --verify-receipt` 或 `rehearse demo --execute --verify-receipt` 在 demo 下立即验证 receipt/readback
- 在 dry-run 模式下生成结构化命令预览
- 用 `reconcile --until-settled` 自动循环收敛不确定执行状态
- replay 一次 run 的完整链路
- 用 `replay --bundle <bundle.json>` 在没有本地 run 目录的情况下直接查看结果
- export 一份可阅读的 `report.md`、一份可携带可验证的 `bundle.json`、以及 operator 视角的 `operator-summary.json`

典型命令如下：

```bash
pnpm demo:flow
pnpm demo:flow -- --execute --approved-by alice
node dist/bin/trademesh.js doctor --probe active --plane demo
node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply
node dist/bin/trademesh.js skills graph
node dist/bin/trademesh.js skills certify --strict
node dist/bin/trademesh.js skills run hedge-planner "hedge my BTC drawdown with demo first" --plane demo --input skills/hedge-planner/proof/input.artifacts.json --skip-satisfied
node dist/bin/trademesh.js skills run hedge-planner "hedge my BTC drawdown with demo first" --plane demo --bundle .trademesh/exports/<run-id>/bundle.json --skip-satisfied
node dist/bin/trademesh.js plan "hedge my BTC drawdown with demo first" \
  --plane demo \
  --symbol BTC \
  --max-drawdown 4 \
  --intent protect-downside \
  --horizon swing
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal protective-put --approve --approved-by alice --execute --verify-receipt
node dist/bin/trademesh.js apply <run-id> --plane live --proposal protective-put --approve --approved-by alice --live-confirm YES_LIVE_EXECUTION --max-order-usd 500 --max-total-usd 1500 --execute
node dist/bin/trademesh.js reconcile <run-id> --source auto --window-min 120 --until-settled --max-attempts 3 --interval-sec 5
node dist/bin/trademesh.js rehearse demo --approve --execute --verify-receipt
node dist/bin/trademesh.js replay <run-id>
node dist/bin/trademesh.js replay --bundle .trademesh/exports/<run-id>/bundle.json
node dist/bin/trademesh.js export <run-id>
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

系统的设计原则非常明确：

- 自定义 skill 不直接写交易
- `official-executor` 是唯一写路径
- `policy-gate` 是写前的必经节点
- `research` plane 禁止所有写 intent
- `demo` plane 默认 preview-first
- `live` plane 仍要求显式批准

这意味着，智能判断和最终执行是解耦的。

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

### 第一层：Execution Kernel

最底层只有 `okx` CLI。

这层只负责确定性执行：

- 读账户
- 读市场
- 下单
- 撤单
- 查询结果

TradeMesh 不允许上层模块绕过它直接写交易请求。

### 第二层：Skill Runtime

这是项目真正的核心。它负责：

- 发现 skill
- 读取 `SKILL.md` frontmatter
- 解析 skill 的输入输出合同
- 根据 artifact 依赖安排执行顺序
- 持久化 trace / policy / execution / artifact 快照
- 渲染 CLI 输出

这层不关心单个策略细节，关心的是"系统如何有序运行"。

### 第三层：Skill Packs

当前旗舰 skill pack 包括：

- `portfolio-xray`
- `market-scan`
- `trade-thesis`
- `hedge-planner`
- `scenario-sim`
- `policy-gate`
- `official-executor`
- `replay`

它们组成的旗舰链路如下：

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

## 7. 为什么它用 artifact，而不是 skill 之间自由对话

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

## 8. 当前版本最重要的能力升级

### 8.1 Structured Goal Intake

系统会在最开始生成 `goal.intake`，把您的目标标准化。

支持的显式输入包括：

- `--symbol`
- `--max-drawdown`
- `--intent`
- `--horizon`

### 8.2 Capability-aware Proposal

每个 proposal 现在都会附带：

- `actionable`
- `executionReadiness`
- `capabilityGaps`

这让 `plan` 阶段就能回答"现在到底能不能做"。

### 8.3 Safer Execution / Retry

每个 intent 都会带上：

- `intentId`
- `stepIndex`
- `safeToRetry`

并且：

- 写 intent 不会自动重试
- 只有安全读 intent 才会在可重试错误下重放
- `retry` 不会重放已经成功的写操作

### 8.4 Exportable Evidence Pack

每次 run 都可以输出：

- `report.md`
- `bundle.json`
- `operator-summary.json`
- `report.operator-brief`（用于 replay/export 首屏的 6 字段摘要）

前者适合阅读和审阅，后者适合归档和系统集成。

### 8.7 Approval + Idempotency + Reconcile

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

M2.7 则把这个方向进一步收口成 proof-carrying mesh：

- `skills certify` 对 portable skills 执行 fixture-route proof，而不只是静态检查
- `skills run --skip-satisfied` 可以利用已有 artifacts 从中间恢复
- 每个关键 run 都会写出 `mesh.route-proof`
- replay 与 export 会直接展示 route minimality、resume point 与 rerun command

### 8.5 Standalone Skill Contract

每个 skill 现在都有显式的 standalone 合同（route/input/output/capabilities）。

这意味着：

- 每个 skill 都可以独立调用
- 独立调用仍然走 artifact handoff，不走隐式耦合
- 独立调用结果同样可 replay / export
- 独立调用还可以通过 `--skip-satisfied` 直接利用已有 artifacts 作为恢复点

### 8.6 Active Probe + Rehearsal

系统现在新增了两条运行时能力：

- `doctor --probe passive|active|write`：输出模块级健康状态和 probe receipts
- `rehearse demo`：走固定演练路线并生成 `operations.rehearsal-plan` / `operations.rehearsal-receipt`

### 8.8 Skill 合同认证（M2.6）

系统新增 `skills certify` 命令，对每个 skill 做三类检查：

- 合同完整性（manifest 必填字段）
- standalone route 合法性（终点 skill 与依赖路由一致）
- standalone 输出可用性（声明输出可由 route 产出）

在 M2.7，这个能力进一步变成"可执行认证"：

- `portable` skill 会读取 proof fixture，真的跑一遍 mini-route
- `structural` skill 明确只做结构合同证明，不假装脱离环境也能本地证明

### 8.10 Portable Verified Bundles（M2.8）

M2.8 把 proof-carrying runtime 再推进了一步：proof 不再只绑定本地 run 目录，而是可以随导出的 bundle 一起携带。

这版新增了三件直接影响日常使用的能力：

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

### 8.9 Proof-Carrying Mesh（M2.7）

TradeMesh 现在不只是"可 replay 的 runtime"，而是 proof-carrying runtime。

每次关键 run 都会自动生成 `mesh.route-proof`，回答这些问题：

- 这条 route 为什么成立
- 哪些 step 真正执行了
- 哪些 step 因为输入已满足而被 `skipped_satisfied`
- 这条链是否已经足够精简
- 可以从哪些 skill 作为恢复点继续执行

这也是本轮最核心的创新点：把"模块化 skills 可独立工作、可拼装、可恢复"做成系统自己能证明的能力。

## 9. 当前版本的能力范围

当前版本已经可以稳定完成以下工作：

- 本地环境检查与模块级健康诊断
- 技能图验证与合同认证
- 目标标准化（structured goal intake）
- 对冲方案生成、排序与 capability-aware policy 审核
- dry-run 预演与 demo 执行即时验证
- replay 全链路回放与 export 可携带证据包

系统设计遵循渐进式信任模型：从 `research` 到 `demo` 再到 `live`，每一层都有独立的安全门禁和审批流程。

## 10. Roadmap

| 阶段 | 方向 |
|------|------|
| M3 | 审批生命周期优化（expiry / escalation）、reconcile 辅助运营工作流、第二 skill pack（rebalance） |
| M4 | 多账户支持、持久队列、外部监控与告警集成 |

当前架构已为这些扩展预留了清晰的接入点：goal intake、policy gate、official executor、replay / export 均可被新 skill pack 直接复用。

## 11. 产品定位

TradeMesh 是一个受控交易工作流系统。核心价值在于让"目标 → 方案 → 审核 → 执行 → 回放"成为一条可审计的链路。

它适合需要以下能力的交易场景：

- 透明的决策过程
- 结构化的方案评估与 policy 审核
- 严格收口的执行权限
- 完整的执行记录与可携带证据包

## 12. 总结

TradeMesh 的核心不是"让 AI 代替您下单"，而是把交易相关的分析、方案、风控、执行和复盘组织成一条可控、可解释、可回放的链路。

> 一个以 `okx` CLI 为唯一执行内核、以 skill 为唯一扩展单位、以 policy 与 replay 为可信基础的 CLI 原生交易工作流系统。
