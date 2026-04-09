# swagger-mcp-server

让支持 MCP 协议的 AI 助手直接查询内部 Swagger API 文档。

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
- **端口**：默认 3000，可通过 `PORT=8080 npm run serve` 覆盖。

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
| `npm start` | stdio 模式启动（供客户端直接调用） |
| `npm run serve` | HTTP 模式启动，默认端口 3000 |
| `npm run dev` | stdio 模式开发，文件变更自动重启 |
| `npm run dev:serve` | HTTP 模式开发，文件变更自动重启 |
