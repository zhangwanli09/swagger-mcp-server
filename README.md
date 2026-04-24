# internal-swagger-mcp

让 AI 助手通过 MCP 协议直接查询你们内部 Swagger 平台的 API 文档。

> 对接的是**内部 Swagger 管理平台**的私有分享接口（`/flow/swagger/share?uid=...`），不是标准 OpenAPI。你只需从平台复制一个含 `uid` 的浏览器地址，剩下的交给本服务。

## 工具

| 工具 | 作用 |
|------|------|
| `swagger_list_sources` | 列出所有服务及缓存状态 |
| `swagger_search_api` | 按关键词搜索接口（可过滤方法/服务）|
| `swagger_get_api_detail` | 查看接口完整参数和 Mock 示例 |
| `swagger_refresh_cache` | 强制刷新文档缓存（默认 30 分钟 TTL）|

## 接入 MCP 客户端

需要 Node.js ≥ 18。**Swagger 源始终由客户端传入**（本服务不持有任何配置），格式为 JSON 数组字符串：

```json
["http://your-server/...#/swaggerManage?uid=xxx"]
```

### stdio

```json
{
  "mcpServers": {
    "swagger": {
      "command": "npx",
      "args": ["internal-swagger-mcp"],
      "env": {
        "SWAGGER_SOURCES": "[\"http://your-server/...#/swaggerManage?uid=xxx\"]"
      }
    }
  }
}
```

### HTTP（团队共享）

服务端启动一次，多客户端共用：

```bash
npx internal-swagger-mcp --http   # 默认 3000 端口，可用 --port 或 PORT 改
```

每个客户端通过 header 自带源：

```json
{
  "mcpServers": {
    "swagger": {
      "url": "http://<内网IP>:3000/mcp",
      "headers": {
        "X-Swagger-Sources": "[\"http://your-server/...#/swaggerManage?uid=xxx\"]"
      }
    }
  }
}
```

## HTTP 部署安全

裸启动会打印警告，生产至少配一项：

| 环境变量 | 作用 |
|------|------|
| `MCP_BIND_HOST` | 监听地址，设为 `127.0.0.1` 仅本机可访问（默认 `0.0.0.0`）|
| `MCP_BEARER_TOKEN` | 要求请求头 `Authorization: Bearer <token>` |
| `MCP_ALLOWED_ORIGINS` | 逗号分隔的 Origin 白名单（防 DNS rebinding）|

> 配置 `MCP_ALLOWED_ORIGINS` 后，缺 `Origin` 的请求会被拒绝，除非带了有效 Bearer token（用于服务端到服务端调用）。
