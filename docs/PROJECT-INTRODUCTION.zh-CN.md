# TradeMesh 项目介绍

> 一个以 `okx` CLI 为唯一执行内核、以 skill mesh 为运行时、以审计回放为可信基础的 CLI 原生交易操作系统原型。

## 1. 项目一句话

TradeMesh 不是一个“会聊天的交易助手”，也不是一个泛化 agent 框架。

它是一个面向 OKX 交易场景的 `CLI Skill Mesh` 运行时：用户给出一个目标，系统会把目标送进一条由 skill 组成的可审计链路，先做组合感知、市场感知、方案生成、情景压力测试和策略护栏，再由唯一的官方执行器把方案翻译成 `okx ... --json` 命令，最后把全过程写入 run 记录并支持 replay / export。

## 2. 这个项目要解决什么问题

现实里的 AI 交易产品经常有三个问题：

1. 研究、规划、执行之间是断裂的。
2. 风控和执行权限没有被真正收口。
3. 决策过程不可回放，出了问题无法解释。

TradeMesh 的解决方式不是“让一个大模型自己做完一切”，而是把整个过程拆成多个职责明确的 skill，并用统一 runtime 管理：

- 读账户和市场的 skill 负责“看见世界”
- 生成方案的 skill 负责“提出动作”
- 风控和 policy 的 skill 负责“拦截风险”
- 官方执行器负责“唯一写路径”
- replay / export 负责“解释系统为什么这么做”

所以它的核心价值不是“预测多准”，而是“执行链路可信、可控、可解释”。

## 3. 它不是什么

为了避免误解，TradeMesh 明确不是：

- 不是 web app 外壳
- 不是通用聊天机器人
- 不是让任意 skill 直接下单的自治 agent
- 不是生产级交易引擎

它是一个 guarded runtime，一个强调 demo-first、preview-first、official-write-path-only 的交易工作流系统。

## 4. 设计理念

TradeMesh 的设计理念可以概括成 4 条：

1. `okx` CLI 是唯一执行内核。
2. skill 是唯一扩展单位。
3. `official-executor` 是唯一写路径。
4. `runs/` 和 `.trademesh/runs/` 是审计与回放的事实来源。

这意味着：

- 不允许 skill 直接绕过 runtime 手写交易请求
- 不依赖聊天上下文做隐式控制流
- 每个 skill 的输入输出都通过 artifact 显式传递
- 每次 `plan`、`apply`、`replay` 都会留下可复盘记录

## 5. 产品定位

TradeMesh 当前的产品定位是：

`CLI Skill Mesh 2.0 for OKX`

它的旗舰工作流是一个“组合风险中枢 + 对冲执行官”：

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

这条链路本身就是项目价值的证明，因为它展示了一个完整闭环：

- 组合读取
- 市场读取
- 策略综合
- 方案排序
- 情景压测
- policy 审核
- 命令物化
- 回放导出

## 6. 用户是怎么使用它的

TradeMesh 的交互方式是 CLI-first。

用户既可以直接给自然语言目标，也可以显式指定结构化参数。

典型命令如下：

```bash
node dist/bin/trademesh.js doctor
node dist/bin/trademesh.js skills graph
node dist/bin/trademesh.js plan "hedge my BTC drawdown with demo first" \
  --plane demo \
  --symbol BTC \
  --max-drawdown 4 \
  --intent protect-downside \
  --horizon swing
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal protective-put --approve
node dist/bin/trademesh.js replay <run-id>
node dist/bin/trademesh.js export <run-id>
```

这 5 步分别回答 5 个问题：

- `doctor`：当前环境是否具备计划、预演、执行能力
- `plan`：系统打算怎么做
- `apply`：系统会产生哪些命令、是否允许执行
- `replay`：这次决策链路到底发生了什么
- `export`：如何把这次 run 打成可交付证据包

## 7. 运行时是怎么工作的

TradeMesh 的运行时分成三层。

### 第一层：Execution Kernel

最底层只有 `okx` CLI。

它负责两类事情：

- 读：`account` / `market`
- 写：`swap` / `option`

所有外部执行都必须表现为 `okx ... --json` 命令。

### 第二层：Skill Runtime

中间层是这个项目真正的核心，它负责：

- 扫描 `skills/*/SKILL.md` 注册 skill
- 解析 manifest 上的 `consumes / produces / preferred_handoffs`
- 用 graph runtime 决定 planning 链路执行顺序
- 用 artifact store 保存 skill 间的结构化 handoff
- 用 policy 和 official executor 把写路径收口
- 把 trace / policy / execution / artifacts 写入 run 目录

### 第三层：Skill Packs

上层是领域能力包，也就是 skill 本身。当前旗舰 pack 包括：

- `portfolio-xray`：把目标和账户信息整理成组合快照
- `market-scan`：读取市场状态并生成 regime
- `trade-thesis`：把组合和市场状态综合成统一 thesis
- `hedge-planner`：输出多套对冲方案并排序
- `scenario-sim`：对方案做固定情景矩阵压测
- `policy-gate`：做 capability-aware 的逐案评估
- `official-executor`：生成结构化 OKX 命令预览
- `replay`：生成审计时间线和证据说明

## 8. 为什么要用 artifact，而不是 skill 直接对话

TradeMesh 的核心协议不是自由文本，而是 artifact。

skill 之间不会靠自然语言互相“猜”，而是通过结构化 artifact 交接。

当前关键 artifact 包括：

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

这么做的意义是：

- 控制流更稳定
- 测试更容易
- replay 更可信
- 后续替换单个 skill 时不用重写整条链路

## 9. 新版最关键的升级点

当前版本相较于早期 demo，重点强化了 4 个方面。

### 9.1 Structured Goal Intake

系统现在会先把用户目标归一化成 `goal.intake`。

它记录：

- 解析后的 symbol
- 目标回撤
- 对冲意图
- 时间周期
- 期望执行偏好
- 每个字段来自 CLI override、goal parse 还是默认值

这意味着 `plan -> apply -> replay -> export` 不会再各自重新猜目标，而是围绕同一份解释工作。

### 9.2 Capability-aware Proposal

现在每个 proposal 不只包含分数，还会包含：

- `actionable`
- `executionReadiness`
- `capabilityGaps`

也就是说，系统不只是告诉用户“哪个方案理论上最好”，还会告诉用户“这个方案当前能不能安全落地、缺什么环境条件、为什么没被推荐”。

### 9.3 Safer Execution / Retry

执行层现在会为每个 intent 打上：

- `intentId`
- `stepIndex`
- `safeToRetry`

同时：

- 写 intent 永不自动重试
- 只有安全读 intent 才能在可重试错误下自动重放
- `retry` 只会重试失败的安全读路径，不会重放成功写入的命令

这让系统更接近真实可运营 runtime，而不是一次性 demo script。

### 9.4 Exportable Evidence Pack

现在每次 run 都可以导出为：

- `report.md`
- `bundle.json`

`report.md` 面向人类，适合评委、操作者和审阅者。

`bundle.json` 面向机器，适合后续做存档、审计、流水归档或接别的系统。

## 10. 安全模型

TradeMesh 的安全模型很明确：

- `research` plane 禁止所有写 intent
- `demo` plane 默认 dry-run first
- `live` plane 仍要求显式 `--approve`
- 自定义 skill 不直接下单
- 所有写操作必须经过 `policy-gate`
- 所有真正的写命令必须由 `official-executor` 物化

这让系统的“智能”与“执行权限”是解耦的：

- skill 可以分析和建议
- runtime 可以审查和拦截
- 官方执行器才可以写

## 11. 为什么这个项目可信

一个交易 agent 项目是否可信，关键不在于“说自己有多聪明”，而在于是否具备以下能力：

- 能解释为什么这么做
- 能明确当前能做什么、不能做什么
- 能把写路径收口到最小面
- 能保留每一步的证据

TradeMesh 当前已经具备这些特征：

- `doctor` 会显示 `plan / apply / execute` readiness
- `plan` 会输出 actionability summary
- `apply` 会输出结构化 command preview
- `replay` 会重建 route、artifact、policy、execution 证据
- `export` 会把 run 导出成可交付包

## 12. 项目目录应该怎么理解

从阅读角度，最重要的目录是这几个：

```text
bin/                 CLI 入口
runtime/             skill runtime、policy、trace、okx wrapper
skills/              各个 skill 的 manifest 和实现
profiles/            demo / live 本地配置
runs/                run 总记录
.trademesh/runs/     trace / policy / execution / artifacts 细粒度快照
doctrines/           策略思想卡片
rules/               规则卡片
tests/               单测与 e2e
```

如果要快速理解项目，推荐顺序是：

1. 看 `README.md`
2. 看 `docs/METHODOLOGY.md`
3. 看 `bin/trademesh.ts`
4. 看 `runtime/executor.ts`
5. 看旗舰 skill 链

## 13. 适合怎么向评委介绍

最推荐的介绍方式不是从“技术栈”开始，而是从“产品控制模型”开始。

可以直接这样讲：

> TradeMesh 把 OKX CLI 包装成一个有 skill 协作、policy 护栏、execution 收口、run 可回放、结果可导出的交易运行时。  
> 它不是在做一个会聊天的交易机器人，而是在做一个可审计、可插拔、可控的交易操作系统原型。

再补一句它的差异化：

> 很多 AI 交易产品只做到“生成建议”，TradeMesh 重点解决的是“如何让建议变成受控执行，并留下可信证据”。

## 14. 当前已经做到哪里

当前版本的定位是：

`product-grade demo-ready runtime`

也就是说，它已经不是概念验证，而是具备以下完整度：

- 有明确命令面
- 有运行时骨架
- 有旗舰工作流
- 有 policy 和 execution 收口
- 有 replay 和 export
- 有自动化测试覆盖核心链路

但它仍然不是生产系统。

## 15. 当前边界和限制

为了保证表达诚实，这个项目也有清晰边界：

- 目前旗舰 use case 主要是对冲，而不是全策略平台
- 真实 OKX demo execute 仍需要本地环境进一步联调
- 环境 readiness 检查目前偏向本地配置存在性，而不是深度健康检查
- 这是一个强调控制与审计的系统，不以高频性能为目标

## 16. 一句话总结

TradeMesh 的本质，是把“交易所 CLI + skill 协作 + 风控护栏 + 审计回放”组合成一个能真正解释自己行为的 AI 交易运行时。

如果只用一句话向别人介绍这个项目，最准确的说法是：

> 一个以 `okx` CLI 为唯一执行内核、以 skill 为唯一扩展单位、以 policy + replay 为可信基础的 CLI 原生交易操作系统原型。
