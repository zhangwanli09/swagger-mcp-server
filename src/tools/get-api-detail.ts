import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadSourceByName } from "../services/swagger-client.js";
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

// ── Output schemas ──────────────────────────────────────────────────────────

type ParamNode = {
  name: string;
  type: string;
  required: "yes" | "no" | "unknown";
  description: string;
  children?: ParamNode[];
};

const ParamNodeSchema: z.ZodType<ParamNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    required: z.enum(["yes", "no", "unknown"]),
    description: z.string(),
    children: z.array(ParamNodeSchema).optional(),
  })
);

type OutputFieldNode = {
  name: string;
  type: string;
  description: string;
  children?: OutputFieldNode[];
};

const OutputFieldSchema: z.ZodType<OutputFieldNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
    children: z.array(OutputFieldSchema).optional(),
  })
);

type MockFieldNode = {
  name: string;
  type: string;
  description: string;
  defaultValue?: string;
  children?: MockFieldNode[];
};

const MockFieldSchema: z.ZodType<MockFieldNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
    defaultValue: z.string().optional(),
    children: z.array(MockFieldSchema).optional(),
  })
);

const GetApiDetailOutput = z.object({
  sourceName: z.string(),
  moduleName: z.string(),
  method: z.string(),
  path: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  contentType: z.string().optional(),
  parameters: z.object({
    query: z.array(ParamNodeSchema),
    path: z.array(ParamNodeSchema),
    header: z.array(ParamNodeSchema),
    form: z.array(ParamNodeSchema),
    body: z.array(ParamNodeSchema),
  }),
  bodyRequestDemo: z.unknown().optional(),
  responses: z.array(
    z.object({
      name: z.string(),
      demo: z.unknown().optional(),
      fields: z.array(OutputFieldSchema),
    })
  ),
  mockFields: z.array(MockFieldSchema),
});

type GetApiDetailOutputType = z.infer<typeof GetApiDetailOutput>;

// ── Helpers: normalization (pure) ───────────────────────────────────────────

function resolveType(paramType: string | undefined, isList: boolean | undefined, typeMap: Map<string, string>): string {
  if (!paramType && paramType !== "0") return "-";
  const name = typeMap.get(paramType) ?? paramType;
  return isList ? `${name}[]` : name;
}

// 平台 checkType 枚举没有统一规范：
//   - 部分模块：0=选填, 1=必填(默认错误消息), 2=必填(自定义错误消息)
//   - 部分模块：没有 0，用 1=选填, 2=必填
// 因此单看数值无法判定，需要组合 resultMsg。只要 resultMsg 非空即视为必填（平台只在需要校验时才填写）。
function isRequired(p: Param): "yes" | "no" | "unknown" {
  const ct = p.checkType;
  const hasMsg = !!(p.resultMsg && p.resultMsg.trim());
  if (ct === 0) return "no";
  if (ct !== undefined && ct >= 2) return "yes";
  if (ct === 1) return hasMsg ? "yes" : "unknown";
  return "no";
}

const REQUIRED_CN: Record<ParamNode["required"], string> = {
  yes: "是",
  no: "否",
  unknown: "?",
};

function collectParams(params: Param[] | undefined, typeMap: Map<string, string>): ParamNode[] {
  if (!params || params.length === 0) return [];
  return params.map((p) => {
    const node: ParamNode = {
      name: p.paramName,
      type: resolveType(p.paramType, p.isList, typeMap),
      required: isRequired(p),
      description: p.description ?? "",
    };
    if (p.children && p.children.length > 0) {
      node.children = collectParams(p.children, typeMap);
    }
    return node;
  });
}

function collectOutputFields(items: OutputResultItem[] | undefined): OutputFieldNode[] {
  if (!items || items.length === 0) return [];
  return items.map((item) => {
    const typeName = item.dataType.split(".").pop() ?? item.dataType;
    const node: OutputFieldNode = {
      name: item.parameterName,
      type: typeName,
      description: item.content ?? "",
    };
    if (item.children && item.children.length > 0) {
      node.children = collectOutputFields(item.children);
    }
    return node;
  });
}

function collectMockFields(fields: MockResultField[] | undefined): MockFieldNode[] {
  if (!fields || fields.length === 0) return [];
  return fields.map((f) => {
    const typeName = f.type.split(".").pop() ?? f.type;
    const node: MockFieldNode = {
      name: f.name,
      type: f.isList ? `${typeName}[]` : typeName,
      description: f.description ?? "",
    };
    if (f.defaultValue !== undefined) node.defaultValue = f.defaultValue;
    if (f.children && f.children.length > 0) {
      node.children = collectMockFields(f.children);
    }
    return node;
  });
}

function tryParseJson(raw: string | undefined): unknown {
  if (!raw || !raw.trim() || raw === "null") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// ── Helpers: Markdown rendering ─────────────────────────────────────────────

function renderParamsMarkdown(nodes: ParamNode[], label: string, lines: string[]): void {
  if (nodes.length === 0) return;
  lines.push(`**${label}参数**:`, "");
  lines.push("| 参数名 | 类型 | 必填 | 描述 |");
  lines.push("|--------|------|------|------|");
  const walk = (ns: ParamNode[], depth: number): void => {
    const prefix = "  ".repeat(depth);
    for (const n of ns) {
      const desc = n.description.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${prefix}${n.name} | ${n.type} | ${REQUIRED_CN[n.required]} | ${desc} |`);
      if (n.children && n.children.length > 0) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  lines.push("");
}

function renderOutputFieldsMarkdown(nodes: OutputFieldNode[], lines: string[]): void {
  const walk = (ns: OutputFieldNode[], depth: number): void => {
    const prefix = "  ".repeat(depth);
    for (const n of ns) {
      const desc = n.description.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${prefix}${n.name} | ${n.type} | ${desc} |`);
      if (n.children && n.children.length > 0) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
}

function renderMockFieldsMarkdown(nodes: MockFieldNode[], lines: string[]): void {
  const walk = (ns: MockFieldNode[], depth: number): void => {
    const prefix = "  ".repeat(depth);
    for (const n of ns) {
      const desc = n.description.replace(/\|/g, "\\|").replace(/\n/g, " ");
      const defVal = (n.defaultValue ?? "").replace(/\|/g, "\\|");
      lines.push(`| ${prefix}${n.name} | ${n.type} | ${desc} | ${defVal} |`);
      if (n.children && n.children.length > 0) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
}

// ── Tool registration ───────────────────────────────────────────────────────

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
  必填列: "是"=必填, "否"=选填, "?"=平台元数据不明确（checkType=1 且无错误消息，建议对照后端代码或按选填处理）
- 嵌套 Object 参数的子字段
- 响应结果（Demo JSON + 输出字段表格）
- Mock 响应字段表格`,
      inputSchema: GetDetailInputSchema,
      outputSchema: GetApiDetailOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: GetDetailInput) => {
      try {
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
        const sources = [source];

        let found: InterfaceInfo | undefined;
        let foundSourceName = "";
        let foundModuleName = "";
        const typeMap = new Map<string, string>();

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

        // Collect normalized data
        const parameters = {
          query: collectParams(pm?.queryParam, typeMap),
          path: collectParams(pm?.pathParam, typeMap),
          header: collectParams(pm?.headerParam, typeMap),
          form: collectParams(pm?.formParam, typeMap),
          body: collectParams(pm?.bodyParam, typeMap),
        };

        const bodyRequestDemo = tryParseJson(iface.bodyRequestDemo);

        const responses: GetApiDetailOutputType["responses"] = (iface.outResults ?? []).map((or, i) => ({
          name: or.outResultComponentInfo?.name || `结果 ${i + 1}`,
          demo: tryParseJson(or.outResultDemo),
          fields: collectOutputFields(or.outputResultInfo?.items),
        }));

        const mockFields = collectMockFields(iface.mockReturnResultExample);

        const structured: GetApiDetailOutputType = {
          sourceName: foundSourceName,
          moduleName: foundModuleName,
          method: iface.httpMethodName,
          path: iface.fullPath,
          name: iface.interfaceName,
          description: iface.description ?? "",
          status: iface.interfaceStatusName,
          contentType: iface.interfaceContentType || undefined,
          parameters,
          bodyRequestDemo,
          responses,
          mockFields,
        };

        // Render markdown from normalized data
        const lines: string[] = [
          `# ${iface.interfaceName}`,
          "",
          `**服务**: ${foundSourceName}`,
          `**模块**: ${foundModuleName}`,
          `**方法**: ${iface.httpMethodName}`,
          `**路径**: \`${iface.fullPath}\``,
          `**状态**: ${iface.interfaceStatusName}`,
        ];
        if (iface.interfaceContentType) lines.push(`**Content-Type**: ${iface.interfaceContentType}`);
        if (iface.description) lines.push(`**描述**: ${iface.description}`);
        lines.push("");

        renderParamsMarkdown(parameters.query, "Query ", lines);
        renderParamsMarkdown(parameters.path, "Path ", lines);
        renderParamsMarkdown(parameters.header, "Header ", lines);
        renderParamsMarkdown(parameters.form, "Form ", lines);
        renderParamsMarkdown(parameters.body, "Body ", lines);

        // Request body demo: keep the original raw-string fallback for markdown readability
        if (iface.bodyRequestDemo && iface.bodyRequestDemo.trim() && iface.bodyRequestDemo !== "null") {
          lines.push("**请求体示例**:");
          lines.push("```json");
          if (bodyRequestDemo !== undefined) {
            lines.push(JSON.stringify(bodyRequestDemo, null, 2));
          } else {
            lines.push(iface.bodyRequestDemo);
          }
          lines.push("```");
          lines.push("");
        }

        if (iface.outResults && iface.outResults.length > 0) {
          lines.push("**响应结果**:", "");
          iface.outResults.forEach((or, i) => {
            const label = or.outResultComponentInfo?.name || `结果 ${i + 1}`;
            lines.push(`#### ${label}`);
            if (or.outResultDemo?.trim()) {
              lines.push("```json");
              const parsed = tryParseJson(or.outResultDemo);
              if (parsed !== undefined) {
                lines.push(JSON.stringify(parsed, null, 2));
              } else {
                lines.push(or.outResultDemo);
              }
              lines.push("```");
            }
            const fields = responses[i].fields;
            if (fields.length > 0) {
              lines.push("| 字段名 | 类型 | 描述 |");
              lines.push("|--------|------|------|");
              renderOutputFieldsMarkdown(fields, lines);
            }
            lines.push("");
          });
        }

        if (mockFields.length > 0) {
          lines.push("**Mock 响应字段**:", "");
          lines.push("| 字段名 | 类型 | 描述 | 默认值 |");
          lines.push("|--------|------|------|--------|");
          renderMockFieldsMarkdown(mockFields, lines);
          lines.push("");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
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
