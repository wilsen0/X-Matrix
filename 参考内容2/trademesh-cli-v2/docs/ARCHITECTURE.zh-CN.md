# TradeMesh CLI 架构（v0.2）

## 定位

这是一个 **CLI-native Skill Mesh**：

- `okx` CLI 是唯一执行内核
- 自定义 skill 只负责分析、规划、风控、回放
- `official-executor` 是唯一写入口
- `runs/*.json` 是审计与 replay 的真相来源

## 运行平面

- `research`：只读研究，阻断所有写操作
- `demo`：模拟盘演练，默认仍要求确认
- `live`：真实环境，必须显式 `--approve`

## 当前能力

1. 启动时扫描 `skills/*/SKILL.md`
2. 根据 goal 路由 skill chain
3. 生成 proposal 和 `okx ... --json` intent
4. 通过 `policy-gate` 决定 `approved / require_approval / blocked`
5. `apply` 支持 dry-run 与真实执行两条路径
6. 所有结果写入 `runs/*.json`

## 推荐下一步

- 接入真实 OKX CLI 返回值，替换当前示例 intents
- 增加 slippage / budget / max-drawdown gate
- 做一个 TUI trace 面板
- 给 skill 增加 schema 校验与 hot-reload
