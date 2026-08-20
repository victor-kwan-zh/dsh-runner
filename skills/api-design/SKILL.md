---
name: api-design
version: 1.0.0
description: "API 设计：设计清晰一致的 REST/OpenAPI 接口（资源、语义、错误、版本）。当用户要设计接口、写 OpenAPI、评审 API 时使用。"
---

# API 设计

## 设计原则

- **以资源为中心**：名词复数 URL（`/users`、`/users/{id}/orders`），动词进方法（GET/POST/PUT/PATCH/DELETE）。
- **一致性**：命名风格统一（kebab-case 路径、snake_case 或 camelCase 字段——选定一种全程一致）；分页/过滤/排序参数约定统一。
- **幂等与语义**：PUT 幂等；POST 创建；PATCH 局部更新；DELETE 幂等。返回码语义正确（201 创建/204 删除/400 参数错/404 不存在/409 冲突/422 校验失败）。
- **错误结构统一**：`{ error: { code, message, details? } }`，机器可读 code + 人可读 message。
- **版本策略**：URL 版本（`/v1/`）或 header；破坏性变更必须升版本。
- **安全**：认证方式明确（Bearer/API key）；敏感字段不返回；限流说明。

## 流程

1. **需求澄清**：接口给谁用、做什么、约束（并发/延迟/容量）。
2. **先写 OpenAPI**（或至少接口清单）：路径、方法、请求/响应 schema、错误——先定契约再实现。
3. **实现与校验**：按契约实现；写测试覆盖成功/失败路径（`tdd` skill）。
4. **评审**：对照上面原则自查；`code-review` 让模型再审一遍。

## 输出

- OpenAPI（YAML/JSON）或清晰的接口文档：每个端点 方法/路径/参数/请求/响应/错误。
- 变化点提醒：与现有接口的不一致处、需要调用方配合的破坏性变更。
