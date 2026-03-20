# TradeMesh CLI 架构

## 1. 设计原则

1. `okx` CLI 是唯一执行内核。
2. 一个模块就是一个 skill。
3. skill 之间只传结构化 JSON，不传自由文本。
4. 自定义 skill 不直接下单，写操作统一交给 `official-executor`。
5. live 写操作必须经过 `policy-gate`。

## 2. 三层结构

### Execution Kernel
- `okx market ... --json`
- `okx account ... --json`
- `okx spot ... --json`
- `okx swap ... --json`
- `okx option ... --json`
- `okx bot ... --json`

### Skill Runtime
- 发现 skill
- 路由 skill
- 执行 skill 链
- 记录 trace
- 生成 replay

### Skill Packs
- `market-scan`
- `portfolio-xray`
- `hedge-planner`
- `policy-gate`
- `official-executor`
- `replay`

## 3. 统一交接协议

```json
{
  "goal": "user objective",
  "facts": [],
  "constraints": {},
  "proposal": [],
  "risk": {
    "score": 0,
    "needsApproval": false,
    "reasons": []
  },
  "permissions": {
    "plane": "research|demo|live",
    "officialWriteOnly": true,
    "allowedModules": []
  },
  "handoff": "next-skill"
}
```
