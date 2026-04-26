# internal-swagger-mcp

让 AI Agent 通过 MCP 协议查询内部 Swagger 平台的 API 文档。

> 对接的是内部 Swagger 管理平台的私有分享接口（`/flow/swagger/share?uid=...`），而非公开 OpenAPI 地址。

## 工具

| 工具 | 作用 |
|------|------|
| `swagger_list_sources` | 列出所有服务及缓存状态 |
| `swagger_search_api` | 按关键词搜索接口（可过滤方法/服务）|
| `swagger_get_api_detail` | 查看接口完整参数和 Mock 示例 |
| `swagger_refresh_cache` | 强制刷新文档缓存（默认 30 分钟 TTL）|

## 接入 MCP 客户端

需要 Node.js ≥ 18。Swagger 源始终由客户端传入（本服务不持有任何配置），格式为 JSON 数组字符串：stdio 模式经环境变量 `SWAGGER_SOURCES`，HTTP 模式经 header `X-Swagger-Sources`。

HTTP 模式启动（部署到团队共享的内网机器）：

```bash
npx -y internal-swagger-mcp --http   # 默认 3000 端口，可用 --port 或 PORT 改
```

下文 `<SOURCE>` 形如 `http://your-server/...#/swaggerManage?uid=xxx`。各客户端均建议**项目级配置**（每个项目绑自己的 Swagger 源，可提交 git 共享）。客户端里能成功调用 `swagger_list_sources` 即视为接入成功。

### Claude Code

[官方文档](https://code.claude.com/docs/en/mcp) — 用 `--scope project` 写入项目根 `.mcp.json`。

本地（stdio）：

```bash
claude mcp add swagger --scope project --env SWAGGER_SOURCES='["<SOURCE>"]' -- npx -y internal-swagger-mcp
```

远程（HTTP）：

```bash
claude mcp add --transport http swagger --scope project http://<内网IP>:3000/mcp --header 'X-Swagger-Sources: ["<SOURCE>"]'
```

### opencode

[官方文档](https://opencode.ai/docs/mcp-servers) — 放在项目根 `opencode.json`。

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

[官方文档](https://cursor.com/docs/context/mcp) — 放在项目根 `.cursor/mcp.json`。

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

默认绑 `0.0.0.0` 方便内网共享，裸启动会打印警告；生产环境至少配下表中一项：

| 环境变量 | 作用 |
|------|------|
| `MCP_BIND_HOST` | 监听地址，设为 `127.0.0.1` 仅本机可访问（默认 `0.0.0.0`）|
| `MCP_BEARER_TOKEN` | 要求请求头 `Authorization: Bearer <token>` |
| `MCP_ALLOWED_ORIGINS` | 逗号分隔的 Origin 白名单（防 DNS rebinding）|

> 配置 `MCP_ALLOWED_ORIGINS` 后缺 `Origin` 的请求会被拒绝；带有效 `MCP_BEARER_TOKEN` 的请求例外（便于服务端到服务端调用）。
