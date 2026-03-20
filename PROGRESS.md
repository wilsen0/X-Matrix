# okx-skill-mesh 项目进度

> 最后更新：2026-03-20 13:05

---

## 当前状态

**版本**: v0.1.0-alpha
**阶段**: 核心功能完成，待实战验证
**Git**: 尚无提交

---

## 已完成功能

### 2026-03-20 — Merge 参考实现

**Codex Session**: `cool-haven` (`019d06c1-bfbf-7f31-a932-1219284c3144`)

#### 类型系统 (`runtime/types.ts`)

- `OkxCommandIntent` — 结构化命令意图 (command, args, module, requiresWrite, reason)
- `CapabilitySnapshot` — 能力快照 (okxCliAvailable, configPath, profiles状态)
- `PolicyDecision` — 三态决策 (approved / require_approval / blocked)
- `ExecutionResult` — 单条执行结果
- `ExecutionRecord` — 执行记录集

#### 策略检查 (`runtime/policy.ts`)

三态决策逻辑：
- `approved` — 允许执行
- `require_approval` — 需要显式 `--approve`
- `blocked` — 禁止执行

检查项：
- [x] research plane 阻止所有写意图
- [x] demo plane 需要风险审批
- [x] live plane 写操作需要 `--approve`
- [x] module 权限检查 (`allowedModules`)
- [x] 能力快照检查 (CLI 可用、配置存在、profile 配置)

#### 数据流打通

- `portfolio-xray` → `sharedState.accountSnapshot`
- `market-scan` → `sharedState.marketSnapshot`
- `hedge-planner` → 消费快照数据 (待完善)

#### CLI 命令

| 命令 | 功能 | 状态 |
|------|------|------|
| `doctor` | 检查环境能力 | ✅ |
| `skills ls` | 列出已安装技能 | ✅ |
| `plan <goal>` | 生成对冲方案 | ✅ |
| `apply <run-id>` | 执行方案 | ✅ |
| `replay <run-id>` | 重放运行 | ✅ |
| `runs list` | 列出运行记录 | ✅ |

---

### 2026-03-19 — 项目初始化

#### 核心架构

- `skills/` — 技能目录 (portfolio-xray, market-scan, hedge-planner, policy-gate, official-executor, replay)
- `runtime/` — 运行时 (executor, registry, policy, okx)
- `profiles/` — 配置文件 (demo.toml, live.toml)
- `runs/` — 运行记录 JSON

#### OKX CLI Wrapper (`runtime/okx.ts`)

- 统一 `okx ... --json` 封装
- 支持 `research|demo|live` 三种模式
- 安全回退 (CLI 不可用时用假数据)

#### 执行模型

- `entrypoint` 动态加载技能
- `stage` 编排 (sensor → planner → guardrail → executor → memory)
- `sharedState` 跨技能数据传递

---

## 待完成功能

### 高优先级

- [ ] **hedge-planner 动态排序** — 基于快照数据质量调整方案优先级
- [ ] **policy-gate plan 阶段检查** — 在规划阶段暴露能力缺口
- [ ] **CLI `--approve --execute` 参数** — 支持显式审批和执行开关

### 中优先级

- [ ] **Git 初始化** — 提交代码，建立版本历史
- [ ] **测试覆盖** — 添加单元测试和集成测试
- [ ] **文档完善** — README, API 文档

### 低优先级

- [ ] **runs list 结构化摘要** — 显示 plane, status, proposals
- [ ] **多语言触发器** — 完善中英文关键词匹配

---

## 验证记录

### 2026-03-20 12:57

```
# research plane
pnpm start plan "对冲 BTC 风险" --plane research
→ Status: planned
→ apply → blocked (research plane blocks all write intents)

# demo plane
pnpm start plan "对冲 BTC 风险" --plane demo
→ Status: approval_required
→ apply → require_approval (risk gate requires approval)

# live plane
pnpm start plan "对冲 BTC 风险" --plane live
→ Status: approval_required
→ live write path requires explicit --approve
```

---

## 参考实现对比

| 功能 | 参考实现 | 当前实现 | 状态 |
|------|---------|---------|------|
| `--approve` 审批门 | ✅ | ⚠️ 参数解析待完善 | 部分 |
| `--execute` 执行开关 | ✅ | ⚠️ 参数解析待完善 | 部分 |
| `policyDecision` 三态 | ✅ | ✅ | 完成 |
| `executions[]` 审计 | ✅ | ✅ | 完成 |
| `capabilitySnapshot` | ✅ | ✅ | 完成 |
| 结构化 intent | ✅ | ✅ | 完成 |
| 动态 skill 加载 | ❌ | ✅ | 独有 |
| stage 编排模型 | ❌ | ✅ | 独有 |
| 双语触发器 | ❌ | ✅ | 独有 |

---

## Codex Session 信息

**专用 Session ID**: `019d06c1-bfbf-7f31-a932-1219284c3144`
**配置**: `~/.codex/config.toml` (model: gpt-5.3-codex, reasoning: xhigh)

**恢复命令**:
```bash
codex resume 019d06c1-bfbf-7f31-a932-1219284c3144
```

---

## 下一步计划

1. 完善 `hedge-planner` 消费快照逻辑
2. 添加 `policy-gate` plan 阶段能力缺口暴露
3. CLI 参数解析 (`--approve`, `--execute`)
4. Git 初始化 + 首次提交
5. 实战测试 (连接真实 OKX CLI)

---

_此文档由小音维护，记录项目开发进度。_
