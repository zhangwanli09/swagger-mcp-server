import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadAllSources, loadSourceByName } from "../services/swagger-client.js";
import type { InterfaceInfo, MockResultField, OutputResultItem, Param } from "../types.js";

const GetDetailInputSchema = z.object({
  source: z
    .string()
    .describe("服务名，来自 swagger_list_sources 或 swagger_search_api 结果"),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
    .describe("HTTP 方法"),
  path: z
    .string()
    .describe("接口完整路径，如 /qmAuthorityCenter/systemFun/initPerformanceSolution"),
}).strict();

type GetDetailInput = z.infer<typeof GetDetailInputSchema>;

function resolveType(paramType: string | undefined, isList: boolean | undefined, typeMap: Map<string, string>): string {
  if (!paramType && paramType !== "0") return "-";
  const name = typeMap.get(paramType) ?? paramType;
  return isList ? `${name}[]` : name;
}

function formatParams(
  params: Param[],
  label: string,
  typeMap: Map<string, string>,
  lines: string[],
  depth = 0
): void {
  if (!params || params.length === 0) return;
  const prefix = "  ".repeat(depth);
  if (depth === 0) {
    lines.push(`**${label}参数**:`, "");
    lines.push("| 参数名 | 类型 | 必填 | 描述 |");
    lines.push("|--------|------|------|------|");
  }
  for (const p of params) {
    const required = p.checkType === 1 ? "是" : "否";
    const typeStr = resolveType(p.paramType, p.isList, typeMap);
    const desc = (p.description ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${prefix}${p.paramName} | ${typeStr} | ${required} | ${desc} |`);
    if (p.children && p.children.length > 0) {
      formatParams(p.children, label, typeMap, lines, depth + 1);
    }
  }
  if (depth === 0) lines.push("");
}

function formatMockFields(fields: MockResultField[], lines: string[], depth = 0): void {
  const prefix = "  ".repeat(depth);
  for (const f of fields) {
    const typeName = f.type.split(".").pop() ?? f.type;
    const typeStr = f.isList ? `${typeName}[]` : typeName;
    const desc = (f.description ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const defVal = (f.defaultValue ?? "").replace(/\|/g, "\\|");
    lines.push(`| ${prefix}${f.name} | ${typeStr} | ${desc} | ${defVal} |`);
    if (f.children && f.children.length > 0) {
      formatMockFields(f.children, lines, depth + 1);
    }
  }
}

function renderOutputItems(items: OutputResultItem[], lines: string[], depth = 0): void {
  const prefix = "  ".repeat(depth);
  for (const item of items) {
    const typeName = item.dataType.split(".").pop() ?? item.dataType;
    const desc = (item.content ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${prefix}${item.parameterName} | ${typeName} | ${desc} |`);
    if (item.children && item.children.length > 0) {
      renderOutputItems(item.children, lines, depth + 1);
    }
  }
}

export function registerGetApiDetail(server: McpServer): void {
  server.registerTool(
    "swagger_get_api_detail",
    {
      title: "Get Swagger API Detail",
      description: `获取单个 API 接口的完整详情，包括所有参数定义和响应示例。

参数说明:
- source (必填): 服务名，来自 swagger_list_sources 或 swagger_search_api 返回的 [服务名]
- method (必填): HTTP 方法，如 "GET"、"POST"
- path (必填): 接口完整路径，如 "/qmAuthorityCenter/systemFun/initPerformanceSolution"

返回内容:
- 接口基本信息（名称、描述、状态、Content-Type）
- Query/Path/Header/Form/Body 各类参数的完整定义（参数名、类型、是否必填、描述）
- 嵌套 Object 参数的子字段
- 响应结果（Demo JSON + 输出字段表格）
- Mock 响应字段表格`,
      inputSchema: GetDetailInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: GetDetailInput) => {
      try {
        let sources;
        const single = await loadSourceByName(params.source, false);
        if (single) {
          sources = [single];
        } else {
          sources = await loadAllSources(false);
        }

        let found: InterfaceInfo | undefined;
        let foundSourceName = "";
        let foundModuleName = "";
        let typeMap = new Map<string, string>();

        outer: for (const src of sources) {
          for (const mod of src.data.modules) {
            for (const iface of mod.interfaceInfos ?? []) {
              if (
                iface.httpMethodName.toUpperCase() === params.method.toUpperCase() &&
                iface.fullPath === params.path
              ) {
                found = iface;
                foundSourceName = src.name;
                foundModuleName = mod.moduleName;
                // Build type lookup map from dict
                for (const entry of src.data.dict?.inparam_data_type ?? []) {
                  typeMap.set(String(entry.dictNo), entry.dictValueDescription);
                }
                break outer;
              }
            }
          }
        }

        if (!found) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: 未找到接口 ${params.method} ${params.path}（服务: ${params.source}）。\n\n提示：请用 swagger_search_api 先搜索接口，确认正确的路径和方法。`,
              },
            ],
            isError: true,
          };
        }

        const iface = found;
        const pm = iface.inParamModelData;

        const lines: string[] = [
          `# ${iface.interfaceName}`,
          "",
          `**服务**: ${foundSourceName}`,
          `**模块**: ${foundModuleName}`,
          `**方法**: ${iface.httpMethodName}`,
          `**路径**: \`${iface.fullPath}\``,
          `**状态**: ${iface.interfaceStatusName}`,
        ];

        if (iface.interfaceContentType) {
          lines.push(`**Content-Type**: ${iface.interfaceContentType}`);
        }
        if (iface.description) {
          lines.push(`**描述**: ${iface.description}`);
        }
        lines.push("");

        // Parameters
        if (pm) {
          formatParams(pm.queryParam, "Query ", typeMap, lines);
          formatParams(pm.pathParam, "Path ", typeMap, lines);
          formatParams(pm.headerParam, "Header ", typeMap, lines);
          formatParams(pm.formParam, "Form ", typeMap, lines);
          formatParams(pm.bodyParam, "Body ", typeMap, lines);
        }

        // Request body demo
        if (iface.bodyRequestDemo && iface.bodyRequestDemo.trim() && iface.bodyRequestDemo !== "null") {
          lines.push("**请求体示例**:");
          lines.push("```json");
          try {
            lines.push(JSON.stringify(JSON.parse(iface.bodyRequestDemo), null, 2));
          } catch {
            lines.push(iface.bodyRequestDemo);
          }
          lines.push("```");
          lines.push("");
        }

        // outResults — response demos + output field tables
        if (iface.outResults && iface.outResults.length > 0) {
          lines.push("**响应结果**:", "");
          for (let i = 0; i < iface.outResults.length; i++) {
            const or = iface.outResults[i];
            const label = or.outResultComponentInfo?.name || `结果 ${i + 1}`;
            lines.push(`#### ${label}`);
            if (or.outResultDemo?.trim()) {
              lines.push("```json");
              try {
                lines.push(JSON.stringify(JSON.parse(or.outResultDemo), null, 2));
              } catch {
                lines.push(or.outResultDemo);
              }
              lines.push("```");
            }
            const items = or.outputResultInfo?.items ?? [];
            if (items.length > 0) {
              lines.push("| 字段名 | 类型 | 描述 |");
              lines.push("|--------|------|------|");
              renderOutputItems(items, lines);
            }
            lines.push("");
          }
        }

        // mockReturnResultExample — formatted table
        if (iface.mockReturnResultExample && iface.mockReturnResultExample.length > 0) {
          lines.push("**Mock 响应字段**:", "");
          lines.push("| 字段名 | 类型 | 描述 | 默认值 |");
          lines.push("|--------|------|------|--------|");
          formatMockFields(iface.mockReturnResultExample, lines);
          lines.push("");
        }

        const text = lines.join("\n");
        return {
          content: [{ type: "text" as const, text }],
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
