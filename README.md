# swagger-mcp-server

一个 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 服务，让 Claude 等 AI 助手能够直接查询内部 Swagger API 文档。

## 功能

提供 4 个 MCP 工具：

| 工具 | 说明 |
|------|------|
| `swagger_list_sources` | 列出所有已配置的服务及其模块、接口数量、缓存状态 |
| `swagger_search_api` | 按关键词搜索接口，支持过滤 HTTP 方法和服务范围 |
| `swagger_get_api_detail` | 获取单个接口的完整参数定义和 Mock 响应示例 |
| `swagger_refresh_cache` | 强制重新拉取文档数据，更新内存缓存 |

## 环境要求

- Node.js 18+

## 安装

```bash
npm install
npm run build
```

## 配置

编辑 `swagger-sources.json`，填入 Swagger 服务的 Web UI 地址：

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

- `webUrl`：Swagger 平台的浏览器地址（含 `uid` 参数）
- `name`（可选）：服务别名，不填则自动读取文档中的项目名
- `cacheMinutes`（可选）：缓存有效期，默认 30 分钟

## 接入 Claude Desktop

在 Claude Desktop 配置文件中添加（通常位于 `%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "swagger": {
      "command": "node",
      "args": ["D:/projects/swagger-mcp-server/dist/index.js"]
    }
  }
}
```

修改配置后重启 Claude Desktop 即可使用。

## 本地开发

```bash
# 监听模式运行（无需编译）
npm run dev

# 编译
npm run build

# 运行编译产物
npm start
```

## 使用示例

在 Claude 中：

- **查看可用服务**：`用 swagger_list_sources 列出所有服务`
- **搜索接口**：`搜索关键词"登录"的接口`
- **查看详情**：`获取 POST /api/user/login 的完整参数`
- **刷新数据**：`刷新订单服务的缓存`

## 项目结构

```
src/
├── index.ts                    # 入口，注册 MCP Server（stdio 传输）
├── types.ts                    # TypeScript 类型定义
├── constants.ts                # 常量（超时、缓存、请求头等）
├── services/
│   └── swagger-client.ts       # 拉取、解析、缓存 Swagger 数据
└── tools/
    ├── list-sources.ts         # swagger_list_sources 工具
    ├── search-api.ts           # swagger_search_api 工具
    ├── get-api-detail.ts       # swagger_get_api_detail 工具
    └── refresh-cache.ts        # swagger_refresh_cache 工具
```
