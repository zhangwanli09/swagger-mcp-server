import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadAllSources, loadSourceByName } from "../services/swagger-client.js";
import { CHARACTER_LIMIT } from "../constants.js";
import type { InterfaceInfo, Module } from "../types.js";

const SearchInputSchema = z.object({
  keyword: z
    .string()
    .min(1, "keyword must not be empty")
    .describe("Search keyword. Matches interface name / description / path / module name. Chinese is supported."),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
    .optional()
    .describe("Filter by HTTP method. Omit to search all methods."),
  source: z
    .string()
    .optional()
    .describe("Restrict the search to a specific service name (from swagger_list_sources). Omit to search all services."),
  include_deprecated: z
    .boolean()
    .default(false)
    .describe("Whether to include deprecated interfaces. Default false."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum number of results. Default 20, max 50."),
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
  failed: z
    .array(
      z.object({
        url: z.string(),
        apiUrl: z.string(),
        error: z.string(),
      })
    )
    .optional(),
});

type SearchApiOutputType = z.infer<typeof SearchApiOutput>;
type ApiMatch = z.infer<typeof ApiMatchSchema>;

export function matchesKeyword(keyword: string, iface: InterfaceInfo, module: Module): boolean {
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
      description: `Search API interfaces in the internal Swagger documentation.

Searches by keyword across interface name, description, path, and module name. Optionally filter by HTTP method and service.

Parameters:
- keyword (required): Search keyword, e.g. "登录", "user", "/api/order". Chinese is supported.
- method (optional): HTTP method filter, e.g. "GET", "POST".
- source (optional): Service name filter, taken from swagger_list_sources results.
- include_deprecated (optional): Whether to include deprecated interfaces. Default false.
- limit (optional): Maximum number of results. Default 20.

Response:
Each matched interface includes: service name, module name, HTTP method, full path, interface name, description, status.

Examples:
- Search login interfaces: keyword="登录"
- Search POST interfaces: keyword="用户", method="POST"
- Search within a specific service: keyword="order", source="订单服务"`,
      inputSchema: SearchInputSchema,
      outputSchema: SearchApiOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: SearchInput) => {
      try {
        let sources;
        let failures: Awaited<ReturnType<typeof loadAllSources>>["failures"] = [];
        if (params.source) {
          const result = await loadSourceByName(params.source);
          if (!result.source) {
            const hint =
              result.failures.length > 0
                ? `${result.failures.length} source(s) failed to load and the target may be among them — call swagger_list_sources for failure details.`
                : "Call swagger_list_sources to see available service names.";
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: service "${params.source}" not found. ${hint}`,
                },
              ],
              isError: true,
            };
          }
          sources = [result.source];
        } else {
          const all = await loadAllSources(false);
          sources = all.sources;
          failures = all.failures;
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
        if (failures.length > 0) {
          structured.failed = failures;
        }

        const failureNote =
          failures.length > 0
            ? [
                "",
                `> ⚠️ 搜索期间有 ${failures.length} 个源加载失败，结果可能不完整：`,
                ...failures.map((f) => `> - ${f.url}: ${f.error}`),
              ].join("\n")
            : "";

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No interfaces matched "${params.keyword}"${params.method ? ` (method: ${params.method})` : ""}.\n\nHint: call swagger_list_sources to see the configured services and modules.` +
                  failureNote,
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

        let text = lines.join("\n") + failureNote;
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
