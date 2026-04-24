# internal-swagger-mcp

让 AI 助手通过 MCP 协议直接查询你们内部 Swagger 平台的 API 文档。

> 对接的是**内部 Swagger 管理平台**的私有分享接口（`/flow/swagger/share?uid=...`），而非公开的 OpenAPI 文档地址。你只需从平台复制一个含 `uid` 的浏览器地址，剩下的交给本服务。

## 工具

| 工具 | 作用 |
|------|------|
| `swagger_list_sources` | 列出所有服务及缓存状态 |
| `swagger_search_api` | 按关键词搜索接口（可过滤方法/服务）|
| `swagger_get_api_detail` | 查看接口完整参数和 Mock 示例 |
| `swagger_refresh_cache` | 强制刷新文档缓存（默认 30 分钟 TTL）|

## 接入 MCP 客户端

需要 Node.js ≥ 18。**Swagger 源始终由客户端传入**（本服务不持有任何 Swagger 源配置），格式为 JSON 数组字符串（须整体作为字符串传递）：

```json
["http://your-server/...#/swaggerManage?uid=xxx"]
```

两种传递方式：

- **stdio 模式**：通过环境变量 `SWAGGER_SOURCES`
- **HTTP 模式**：把服务部署到团队共享的内网机器上，再通过 header `X-Swagger-Sources` 传

  ```bash
  npx -y internal-swagger-mcp --http   # 默认 3000 端口，可用 --port 或 PORT 改
  ```

配置完成后，在客户端里调用 `swagger_list_sources` 能看到服务列表即视为接入成功。

下文 `<SOURCE>` 代表实际的 Swagger URL，例如 `http://your-server/...#/swaggerManage?uid=xxx`。

### Claude Code

[官方文档](https://code.claude.com/docs/en/mcp)

每个项目的 Swagger 源通常不同，配置按项目走。推荐 `--scope project`（写入项目根 `.mcp.json`，可提交 git 让团队共享）；不想共享就省略 `--scope`（默认 `local`，仅你在本项目可见）。

本地（stdio）：

```bash
claude mcp add swagger --scope project \
  --env SWAGGER_SOURCES='["<SOURCE>"]' \
  -- npx -y internal-swagger-mcp
```

远程（HTTP）：

```bash
claude mcp add --transport http swagger --scope project http://<内网IP>:3000/mcp \
  --header 'X-Swagger-Sources: ["<SOURCE>"]'
```

### opencode

配置文件 `opencode.json` — [官方文档](https://opencode.ai/docs/mcp-servers)

放在**项目根目录**的 `opencode.json`，而不是全局 `~/.config/opencode/opencode.json`，这样每个项目可以绑自己的 Swagger 源。

本地（stdio）：

```json
{
  "mcp": {
    "swagger": {
      "type": "local",
      "command": ["npx", "-y", "internal-swagger-mcp"],
      "environment": {
        "SWAGGER_SOURCES": "[\"<SOURCE>\"]"
      }
    }
  }
}
```

远程（HTTP）：

```json
{
  "mcp": {
    "swagger": {
      "type": "remote",
      "url": "http://<内网IP>:3000/mcp",
      "headers": {
        "X-Swagger-Sources": "[\"<SOURCE>\"]"
      }
    }
  }
}
```

### Cursor

[官方文档](https://cursor.com/docs/context/mcp)

用**项目级** `.cursor/mcp.json`（每个项目独立绑源），不要用全局 `~/.cursor/mcp.json`。

本地（stdio）：

```json
{
  "mcpServers": {
    "swagger": {
      "command": "npx",
      "args": ["-y", "internal-swagger-mcp"],
      "env": {
        "SWAGGER_SOURCES": "[\"<SOURCE>\"]"
      }
    }
  }
}
```

远程（HTTP）：

```json
{
  "mcpServers": {
    "swagger": {
      "url": "http://<内网IP>:3000/mcp",
      "headers": {
        "X-Swagger-Sources": "[\"<SOURCE>\"]"
      }
    }
  }
}
```

## HTTP 部署安全

默认绑 `0.0.0.0` 是为方便局域网共享，因此裸启动会打印警告提醒你加上访问控制。生产至少配一项：

| 环境变量 | 作用 |
|------|------|
| `MCP_BIND_HOST` | 监听地址，设为 `127.0.0.1` 仅本机可访问（默认 `0.0.0.0`）|
| `MCP_BEARER_TOKEN` | 要求请求头 `Authorization: Bearer <token>` |
| `MCP_ALLOWED_ORIGINS` | 逗号分隔的 Origin 白名单（防 DNS rebinding）|

> 配置 `MCP_ALLOWED_ORIGINS` 后，缺 `Origin` 的请求会被拒绝；例外：带有效 `MCP_BEARER_TOKEN` 的请求仍可通过，便于服务端到服务端调用。
