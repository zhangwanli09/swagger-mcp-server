# swagger-mcp-server

让支持 MCP 协议的 AI 助手直接查询内部 Swagger 管理平台上的 API 文档。

> **适用范围**：本项目对接的是某个**内部 Swagger 管理平台**，消费的是该平台的私有分享接口（`/flow/swagger/share?uid=...`）及其自定义包装响应，而非标准 OpenAPI/Swagger JSON。用户只需从平台复制一个浏览器可访问的文档地址（含 `uid`），由本服务负责解析其中的接口请求/响应定义。

## 工具

| 工具 | 说明 |
|------|------|
| `swagger_list_sources` | 列出所有服务及缓存状态 |
| `swagger_search_api` | 按关键词搜索接口，支持过滤方法和服务 |
| `swagger_get_api_detail` | 获取接口完整参数定义和 Mock 示例 |
| `swagger_refresh_cache` | 强制刷新文档缓存 |

## 快速开始

> 需要 Node.js >= 18

```bash
npm install && npm run build     # 1. 安装并编译
npm run serve                     # 2. HTTP 模式启动（默认 3000 端口）
curl http://localhost:3000/health # 3. 验证
```

发布到 npm 后也可直接用：

```bash
npx swagger-mcp-server            # stdio 模式（供 MCP 客户端调用）
npx swagger-mcp-server --http     # HTTP 模式，默认 3000
npx swagger-mcp-server --http --port 8080   # 自定义端口
```

完成后参考下文"接入方式"把服务挂到你的 MCP 客户端。本地调试推荐使用 stdio 模式。

## 接入方式

### stdio（本地）

由客户端直接启动进程，Swagger 源通过环境变量 `SWAGGER_SOURCES` 传入：

```json
{
  "mcpServers": {
    "swagger": {
      "command": "node",
      "args": ["/path/to/swagger-mcp-server/dist/index.js"],
      "env": {
        "SWAGGER_SOURCES": "[\"http://your-server/...#/swaggerManage?uid=xxx\"]"
      }
    }
  }
}
```

### HTTP（团队共享）

服务端启动一次，多个客户端共用，每个客户端通过 HTTP header `X-Swagger-Sources` 自带源：

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

> HTTP 模式下源是 per-request 的——同一个 server 进程可以同时为多个团队/项目服务，互不干扰。

## 运行时说明

**Swagger 源格式**：Swagger 源列表始终由客户端传入（服务本身不持有任何源配置），统一为 **JSON 数组字符串**，元素为 Swagger 平台浏览器地址（含 `uid` 参数）：

```json
["http://your-server/...#/swaggerManage?uid=xxx"]
```

| 模式  | 传入渠道 |
|-------|----------|
| stdio | 启动进程的环境变量 `SWAGGER_SOURCES` |
| HTTP  | 每次请求的 HTTP header `X-Swagger-Sources`（缺失会返回 400） |

- **缓存有效期**：30 分钟固定 TTL，需强制刷新请调用 `swagger_refresh_cache`。
- **健康检查**（HTTP 模式）：`GET http://<内网IP>:3000/health`
- **端口**：默认 3000，可通过 `--port 8080` 参数或 `PORT=8080` 环境变量覆盖（CLI 参数优先）。值无效会直接退出并报错。

### 安全相关环境变量（仅 HTTP 模式）

| 变量 | 作用 | 默认 |
|------|------|------|
| `MCP_BIND_HOST` | 监听地址。设为 `127.0.0.1` 可限制为仅本机访问 | `0.0.0.0` |
| `MCP_BEARER_TOKEN` | 要求请求头 `Authorization: Bearer <token>` | 未设 = 不校验 |
| `MCP_ALLOWED_ORIGINS` | 逗号分隔的允许 Origin 白名单（防 DNS rebinding） | 未设 = 不校验 |

- 设置了 `MCP_ALLOWED_ORIGINS` 后，缺失 `Origin` 头的请求会被拒绝（除非同时携带有效 Bearer token，用于服务端到服务端调用）。
- 裸启动（`0.0.0.0` + 无鉴权）时启动日志会打印警告——生产部署建议至少配一项。

## 调试（MCP Inspector）

使用 [MCP Inspector](https://github.com/modelcontextprotocol/inspector) 在浏览器中交互式调用工具，无需接入 AI 客户端。两种模式均推荐使用 UI 模式（即不加 `--cli`），启动后按终端提示访问本地地址，在 UI 里点击 **Connect** 后即可调用工具。

### stdio 模式（开发时推荐）

直接用 `tsx` 启动，改完代码重新运行即可，无需先 build：

```bash
SWAGGER_SOURCES='["http://your-server/...#/swaggerManage?uid=xxx"]' \
  npx @modelcontextprotocol/inspector tsx src/index.ts
```

### HTTP 模式

先启动开发服务，再启动 Inspector：

```bash
# 终端 1：启动开发服务（文件变更自动重启）
npm run dev:serve

# 终端 2：启动 Inspector（UI 模式）
npx @modelcontextprotocol/inspector
```

在 Inspector UI 中：
1. Transport Type 选择 **Streamable HTTP**
2. URL 填 `http://localhost:3000/mcp`
3. 在 **Headers** 区域添加 `X-Swagger-Sources`，值为 JSON 数组字符串，例如：
   ```
   Header Name:  X-Swagger-Sources
   Header Value: ["http://your-server/...#/swaggerManage?uid=xxx"]
   ```
4. 点击 **Connect**

> 如果一定要用 CLI（`--cli`）模式，必须指定 `--method`，例如 `--method tools/list`，否则会报 "Method is required"。

## 开发脚本

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译 TypeScript 到 `dist/` |
| `npm start` | stdio 模式启动（等价于 `node dist/index.js`） |
| `npm run serve` | HTTP 模式启动（等价于 `node dist/index.js --http`），默认端口 3000 |
| `npm run dev` | stdio 模式开发，文件变更自动重启 |
| `npm run dev:serve` | HTTP 模式开发，文件变更自动重启 |
