# TradeMesh 产品介绍

> TradeMesh 是一个以 `okx` CLI 为唯一执行内核、以 skill mesh 为运行时、以 policy 与 replay 为可信基础的 CLI 原生交易工作流系统。

## 1. 这是什么

如果您把它当成一个“会聊天的交易机器人”，会低估它。

TradeMesh 的重点不在聊天，而在把交易相关的几个关键环节连成一条可控、可解释、可回放的链路：

- 理解您的目标
- 读取账户与市场上下文
- 生成多套方案并排序
- 做情景压力测试和 policy 审核
- 把最终方案翻译成可执行的 OKX CLI 命令
- 保存完整 run 记录，支持 replay 和 export

它不是通用 agent 框架，也不是 web UI 外壳，而是一个面向真实交易流程的运行时。

## 2. 它解决什么问题

很多 AI 交易产品的问题不在“不会分析”，而在于：

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

> TradeMesh 让“目标 -> 方案 -> 审核 -> 执行 -> 回放”成为一条受控链路，而不是几个分散步骤。

## 4. 您今天能用它做什么

当前版本最完整的能力是“组合风险观察与对冲规划”。

您可以：

- 检查本地环境是否具备 plan / apply / execute 能力
- 用 `doctor --probe active|write` 做主动探测，而不是只看静态配置
- 让系统基于您的目标生成对冲方案
- 用 `--symbol`、`--max-drawdown`、`--intent`、`--horizon` 显式约束目标
- 查看每个 proposal 的可行动性、环境缺口和 policy 结果
- 通过 `skills run <name>` 独立调用任意 skill 的 mini-workflow
- 通过 `rehearse demo` 做标准化演练并生成 rehearsal receipt
- 在 dry-run 模式下生成结构化命令预览
- replay 一次 run 的完整链路
- export 一份可阅读的 `report.md`、一份可集成的 `bundle.json`、以及 operator 视角的 `operator-summary.json`

典型命令如下：

```bash
node dist/bin/trademesh.js doctor --probe active --plane demo
node dist/bin/trademesh.js skills graph
node dist/bin/trademesh.js skills run hedge-planner "hedge my BTC drawdown with demo first" --plane demo
node dist/bin/trademesh.js plan "hedge my BTC drawdown with demo first" \
  --plane demo \
  --symbol BTC \
  --max-drawdown 4 \
  --intent protect-downside \
  --horizon swing
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal protective-put --approve --approved-by alice --execute
node dist/bin/trademesh.js reconcile <run-id>
node dist/bin/trademesh.js rehearse demo --approve
node dist/bin/trademesh.js replay <run-id>
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

### 5.2 把“方案”变成“可行动方案”

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

这对真实使用很重要，因为您最终需要的不只是“系统说了什么”，而是：

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

这层不关心单个策略细节，关心的是“系统如何有序运行”。

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

因为真正可维护的系统不能靠模块之间“互相猜意思”。

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

这么做的好处是：

- 输入输出更稳定
- 测试更清晰
- 回放更可信
- 更容易增加新 skill
- 更容易定位问题

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

这让 `plan` 阶段就能回答“现在到底能不能做”。

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

前者适合阅读和审阅，后者适合归档和系统集成。

### 8.7 Approval + Idempotency + Reconcile

M2 阶段新增了三条关键运行时护栏：

- `apply --execute` 必须显式 `--approve --approved-by <name>`，并落 `approval.ticket`
- 写 intent 在执行前会命中本地幂等 ledger（`.trademesh/ledgers/idempotency.json`）做去重
- 状态不确定时使用 `reconcile <run-id>` 收敛为 `matched / ambiguous / failed`

### 8.5 Standalone Skill Contract

每个 skill 现在都有显式的 standalone 合同（route/input/output/capabilities）。

这意味着：

- 每个 skill 都可以独立调用
- 独立调用仍然走 artifact handoff，不走隐式耦合
- 独立调用结果同样可 replay / export

### 8.6 Active Probe + Rehearsal

系统现在新增了两条运行时能力：

- `doctor --probe passive|active|write`：输出模块级健康状态和 probe receipts
- `rehearse demo`：走固定演练路线并生成 `operations.rehearsal-plan` / `operations.rehearsal-receipt`

## 9. 它现在是不是已经可以用

可以用，但要准确理解“可用”的含义。

当前版本已经可以稳定完成这些事情：

- 本地环境检查
- 技能图检查
- 目标标准化
- 对冲方案生成与排序
- capability-aware policy 审核
- dry-run 预演
- replay 与 export

如果您希望它承担“真实生产交易引擎”的职责，当前版本还没有到那个阶段。

更准确的描述是：

> 它已经是一个可以持续使用、持续打磨的产品化运行时，但还不是一个可以默认托管实盘风险的成品交易系统。

## 10. 当前边界，以及这些边界能不能解决

可以解决的大多是工程问题，不是方向问题。下面按边界逐项说明。

### 10.1 真实 OKX demo execute 还没有成为稳定日常能力

现状：

- 已经有 `doctor --probe` 和 `rehearse demo`，可以做标准化演练
- 但“长期稳定、跨环境一致”的 demo execute 日常化能力仍在建设中

能不能解决：

- 能

解决方案：

1. 继续强化 `doctor --probe` 的错误分类和可恢复建议。
2. 把 `rehearse demo` 固化为团队 runbook，固定检查：
   - CLI 是否可调用
   - demo profile 是否可读
   - market/account 只读命令是否成功
   - demo 下单后的 receipt 是否可回读
3. 为真实 demo execute 增加单独 failure taxonomy 与恢复脚本。

优先级：

- 最高

### 10.2 环境诊断仍偏“静态存在性”，不够像产品级健康检查

现状：

- 当前 `doctor` 已支持模块级诊断（CLI、config、profiles、market-read、account-read、write-path）
- 但失败归因仍有继续细化空间（例如网络异常类别、接口格式异常类别）

能不能解决：

- 能

解决方案：

1. 每个诊断项继续细化失败分类（配置问题 / 权限问题 / 网络问题 / 响应格式问题）。
2. 每个诊断项持续保持：
   - 当前状态
   - 失败原因
   - 建议动作
3. 在 export 中保留 environment diagnosis，方便后续分析失败 run。

优先级：

- 最高

### 10.3 当前旗舰场景集中在对冲，通用交易能力还没有铺开

现状：

- 对冲工作流已经比较完整
- 但如果您想把它直接当成一个“全策略平台”，当前 skill pack 还不够丰富

能不能解决：

- 能

解决方案：

1. 先保持 hedge pack 为核心，不要立刻做“大而全”。
2. 采用相同 runtime 合同扩展第二个 pack，例如：
   - rebalance pack
   - treasury / allocation pack
   - event-driven pack
3. 每个新 pack 必须复用现有运行时能力：
   - goal intake
   - policy gate
   - official executor
   - replay / export

优先级：

- 中高

### 10.4 replay / export 仍偏工程视角，离“业务可读报告”还有距离

现状：

- 当前已经能 replay 和导出
- 但输出仍偏技术视角，对普通操作者来说信息密度偏高

能不能解决：

- 能

解决方案：

1. 把 `report.md` 分成两层：
   - 简版结论
   - 技术细节
2. 默认展示：
   - 本次目标
   - 推荐方案
   - 当前阻塞点
   - 下一步建议动作
3. 把意图、风险预算、命令预览做更强的摘要化表达。

优先级：

- 中高

### 10.5 距离生产级实盘系统还有明显差距

现状：

- 当前系统非常适合做受控预演、研究、review 和 demo plane 执行
- 但还不具备完整的生产级托管条件

主要差距：

- 更严格的 idempotency 与 order correlation
- 更系统化的权限模型
- 更完整的失败恢复与审计策略
- 更稳定的健康检查与运维机制
- 更严格的 live execution 审批流

能不能解决：

- 可以部分解决，但会进入另一阶段的工程量

解决方案：

1. 把下一阶段目标定义为“production-grade supervised execution”，而不是“一步到位全自动实盘”。
2. 先做：
   - execution idempotency
   - stronger run receipts
   - richer failure categories
   - supervised live approval workflow
3. 再决定是否进入更重的生产化方向，例如：
   - 多账户
   - 持久队列
   - 指标与监控
   - 外部告警

优先级：

- 中长期

## 11. 建议您如何看待这个项目

如果您想要的是一个“立刻替您全自动实盘交易”的黑盒，这不是那个产品。

如果您想要的是一个：

- 能理解目标
- 能给出结构化方案
- 能告诉您当前能做什么
- 能把执行权限收口
- 能 replay / export 全流程
- 能在 demo 和 dry-run 场景下持续打磨

的交易工作流系统，那么 TradeMesh 的方向是对的，而且已经具备清晰的产品价值。

## 12. 下一阶段应该优先做什么

如果目标是“真正把产品做好到可以持续用”，建议优先级如下：

1. 做主动环境探测和 demo rehearsal，把执行链路从“能跑”变成“可靠可验证”。
2. 做更强的 environment diagnosis，让 `doctor` 成为真正的入口工具。
3. 做更易读的 replay / export，让输出更适合日常使用。
4. 在不破坏核心哲学的前提下，扩展第二个高价值 skill pack。
5. 最后再决定是否进入更重的 live production 化建设。

## 13. 一句话总结

TradeMesh 的核心不是“让 AI 代替您下单”，而是把交易相关的分析、方案、风控、执行和复盘组织成一条可控、可解释、可回放的链路。

如果只用一句话介绍它，最准确的说法是：

> 一个以 `okx` CLI 为唯一执行内核、以 skill 为唯一扩展单位、以 policy 与 replay 为可信基础的 CLI 原生交易工作流系统。
