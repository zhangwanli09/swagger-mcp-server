# swagger-mcp-server

让支持 MCP 协议的 AI 助手直接查询内部 Swagger API 文档。

## 工具

| 工具 | 说明 |
|------|------|
| `swagger_list_sources` | 列出所有服务及缓存状态 |
| `swagger_search_api` | 按关键词搜索接口，支持过滤方法和服务 |
| `swagger_get_api_detail` | 获取接口完整参数定义和 Mock 示例 |
| `swagger_refresh_cache` | 强制刷新文档缓存 |

## 安装

```bash
npm install && npm run build
```

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译 TypeScript 到 `dist/` |
| `npm start` | stdio 模式启动（供客户端直接调用） |
| `npm run serve` | HTTP 模式启动，默认端口 3000 |
| `npm run dev` | stdio 模式开发，文件变更自动重启 |
| `npm run dev:serve` | HTTP 模式开发，文件变更自动重启 |

> Node.js >= 18 required

## 配置

编辑 `swagger-sources.json`：

```json
{
  "sources": [
    {
      "webUrl": "http://your-server/...#/swaggerManage?uid=xxx",
      "name": "订单服务"
    }
  ],
  "cacheMinutes": 30
}
```

- `webUrl`：Swagger 平台浏览器地址（含 `uid` 参数）
- `name`（可选）：服务别名，不填则自动读取项目名
- `cacheMinutes`（可选）：缓存有效期，默认 30 分钟

## 接入

### stdio（本地）

由客户端直接启动进程，适合个人使用：

```json
{
  "mcpServers": {
    "swagger": {
      "command": "node",
      "args": ["/path/to/swagger-mcp-server/dist/index.js"]
    }
  }
}
```

### HTTP（团队共享）

启动后团队成员通过内网 IP 连接，无需各自部署：

```bash
npm run serve           # 默认端口 3000
PORT=8080 npm run serve
```

客户端配置：

```json
{
  "mcpServers": {
    "swagger": {
      "url": "http://<内网IP>:3000/mcp"
    }
  }
}
```

健康检查：`http://<内网IP>:3000/health`

## 调试

使用 [MCP Inspector](https://github.com/modelcontextprotocol/inspector) 在浏览器中交互式调用工具，无需接入 AI 客户端。

### stdio 模式（开发时推荐）

直接用 `tsx` 启动，改完代码重新运行即可，无需先 build：

```bash
npx @modelcontextprotocol/inspector tsx src/index.ts
```

### HTTP 模式

先启动开发服务，再连接 Inspector：

```bash
# 终端 1：启动开发服务（文件变更自动重启）
npm run dev:serve

# 终端 2：启动 Inspector
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp
```

启动后按提示访问本地地址，可直接调用工具并查看返回结果。

## 项目结构

```
src/
├── index.ts              # stdio 入口
├── server.ts             # HTTP 入口
├── types.ts
├── constants.ts
├── services/
│   └── swagger-client.ts
└── tools/
    ├── list-sources.ts
    ├── search-api.ts
    ├── get-api-detail.ts
    └── refresh-cache.ts
```
