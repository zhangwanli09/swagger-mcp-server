import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadAllSources, loadSourceByName } from "../services/swagger-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import type { InterfaceInfo, Module } from "../types.js";

const SearchInputSchema = z.object({
  keyword: z
    .string()
    .min(1, "关键词不能为空")
    .describe("搜索关键词，匹配接口名称/描述/路径/模块名，支持中文"),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
    .optional()
    .describe("过滤 HTTP 方法，不填则搜索所有方法"),
  source: z
    .string()
    .optional()
    .describe("只搜索指定服务名（来自 swagger_list_sources），不填则搜索全部服务"),
  include_deprecated: z
    .boolean()
    .default(false)
    .describe("是否包含已停用的接口，默认 false"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("最多返回条数，默认 20，最大 50"),
}).strict();

type SearchInput = z.infer<typeof SearchInputSchema>;

const ApiMatchSchema = z.object({
  sourceName: z.string(),
  moduleName: z.string(),
  method: z.string(),
  path: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
});

const SearchApiOutput = z.object({
  keyword: z.string(),
  total: z.number().int(),
  truncated: z.boolean(),
  results: z.array(ApiMatchSchema),
});

type SearchApiOutputType = z.infer<typeof SearchApiOutput>;
type ApiMatch = z.infer<typeof ApiMatchSchema>;

function matchesKeyword(keyword: string, iface: InterfaceInfo, module: Module): boolean {
  const kw = keyword.toLowerCase();
  return (
    iface.interfaceName.toLowerCase().includes(kw) ||
    (iface.description ?? "").toLowerCase().includes(kw) ||
    iface.fullPath.toLowerCase().includes(kw) ||
    module.moduleName.toLowerCase().includes(kw)
  );
}

export function registerSearchApi(server: McpServer): void {
  server.registerTool(
    "swagger_search_api",
    {
      title: "Search Swagger API",
      description: `搜索内部 Swagger 文档中的 API 接口。

支持按关键词搜索接口名、描述、路径、模块名，可选过滤 HTTP 方法和服务范围。

参数说明:
- keyword (必填): 搜索关键词，如 "登录"、"user"、"/api/order"
- method (可选): HTTP 方法过滤，如 "GET"、"POST"
- source (可选): 服务名过滤，来自 swagger_list_sources 的结果
- include_deprecated (可选): 是否包含已停用接口，默认 false
- limit (可选): 最多返回条数，默认 20

返回格式:
每个匹配接口包含：服务名、模块名、HTTP 方法、完整路径、接口名称、描述、状态

使用示例:
- 搜索登录接口: keyword="登录"
- 搜索 POST 接口: keyword="用户", method="POST"
- 在特定服务搜索: keyword="order", source="订单服务"`,
      inputSchema: SearchInputSchema,
      outputSchema: SearchApiOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: SearchInput) => {
      try {
        let sources;
        if (params.source) {
          const { source, failures } = await loadSourceByName(params.source);
          if (!source) {
            const hint =
              failures.length > 0
                ? `当前 ${failures.length} 个源加载失败，目标可能在其中，请用 swagger_list_sources 查看失败详情。`
                : "请用 swagger_list_sources 查看可用服务名。";
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: 未找到服务 "${params.source}"。${hint}`,
                },
              ],
              isError: true,
            };
          }
          sources = [source];
        } else {
          ({ sources } = await loadAllSources(false));
        }

        const results: ApiMatch[] = [];

        for (const src of sources) {
          for (const mod of src.data.modules) {
            for (const iface of mod.interfaceInfos ?? []) {
              if (!params.include_deprecated && iface.interfaceStatusName === "已停用") {
                continue;
              }
              if (params.method && iface.httpMethodName.toUpperCase() !== params.method) {
                continue;
              }
              if (!matchesKeyword(params.keyword, iface, mod)) {
                continue;
              }
              results.push({
                sourceName: src.name,
                moduleName: mod.moduleName,
                method: iface.httpMethodName,
                path: iface.fullPath,
                name: iface.interfaceName,
                description: iface.description ?? "",
                status: iface.interfaceStatusName ?? "",
              });
              if (results.length >= params.limit) break;
            }
            if (results.length >= params.limit) break;
          }
          if (results.length >= params.limit) break;
        }

        const truncated = results.length >= params.limit;
        const structured: SearchApiOutputType = {
          keyword: params.keyword,
          total: results.length,
          truncated,
          results,
        };

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `未找到匹配 "${params.keyword}" 的接口${params.method ? `（方法: ${params.method}）` : ""}。\n\n提示：可用 swagger_list_sources 查看已配置的服务和模块。`,
              },
            ],
            structuredContent: structured,
          };
        }

        const lines: string[] = [
          `## 搜索结果：「${params.keyword}」（共 ${results.length} 个）\n`,
        ];

        for (const r of results) {
          lines.push(`### [${r.sourceName}] ${r.method} ${r.path}`);
          lines.push(`- **接口名**: ${r.name}`);
          if (r.description) lines.push(`- **描述**: ${r.description}`);
          lines.push(`- **模块**: ${r.moduleName}`);
          if (r.status && r.status !== "已发布") lines.push(`- **状态**: ${r.status}`);
          lines.push("");
        }

        if (truncated) {
          lines.push(
            `> 结果已达上限 ${params.limit} 条，可增加 limit 或使用 source/method 参数缩小范围。`
          );
        }

        let text = lines.join("\n");
        if (text.length > CHARACTER_LIMIT) {
          text =
            text.slice(0, CHARACTER_LIMIT) +
            "\n\n> [响应已截断] 请使用 source 或 method 参数缩小搜索范围。";
        }

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: structured,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
