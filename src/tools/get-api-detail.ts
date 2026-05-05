import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadSourceByName } from "../services/swagger-client.js";
import type { InterfaceInfo, MockResultField, OutputResultItem, Param } from "../types.js";

const GetDetailInputSchema = z.object({
  source: z
    .string()
    .describe("Service name, from swagger_list_sources or swagger_search_api results."),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
    .describe("HTTP method."),
  path: z
    .string()
    .describe("Full interface path, e.g. /qmAuthorityCenter/systemFun/initPerformanceSolution"),
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

export function resolveType(paramType: string | undefined, isList: boolean | undefined, typeMap: Map<string, string>): string {
  if (!paramType && paramType !== "0") return "-";
  const name = typeMap.get(paramType) ?? paramType;
  return isList ? `${name}[]` : name;
}

// 平台 checkType 枚举没有统一规范：
//   - 部分模块：0=选填, 1=必填(默认错误消息), 2=必填(自定义错误消息)
//   - 部分模块：没有 0，用 1=选填, 2=必填
// 因此单看数值无法判定，需要组合 resultMsg。只要 resultMsg 非空即视为必填（平台只在需要校验时才填写）。
export function isRequired(p: Param): "yes" | "no" | "unknown" {
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

export function collectParams(params: Param[] | undefined, typeMap: Map<string, string>): ParamNode[] {
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

export function collectOutputFields(items: OutputResultItem[] | undefined): OutputFieldNode[] {
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

export function collectMockFields(fields: MockResultField[] | undefined): MockFieldNode[] {
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

export function tryParseJson(raw: string | undefined): unknown {
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
      description: `Get full details of a single API interface, including all parameter definitions and response examples.

Parameters:
- source (required): Service name, from the [service name] returned by swagger_list_sources or swagger_search_api.
- method (required): HTTP method, e.g. "GET", "POST".
- path (required): Full interface path, e.g. "/qmAuthorityCenter/systemFun/initPerformanceSolution".

Response includes:
- Basic interface info (name, description, status, Content-Type).
- Full definitions for Query / Path / Header / Form / Body parameters (name, type, required, description).
  Required column: "是" = required, "否" = optional, "?" = platform metadata is ambiguous (checkType=1 with no error message — cross-check with backend code or treat as optional).
- Sub-fields of nested Object parameters.
- Response results (Demo JSON + output field table).
- Mock response field table.`,
      inputSchema: GetDetailInputSchema,
      outputSchema: GetApiDetailOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: GetDetailInput) => {
      try {
        const { source, failures } = await loadSourceByName(params.source);
        if (!source) {
          const hint =
            failures.length > 0
              ? `${failures.length} source(s) failed to load and the target may be among them — call swagger_list_sources for failure details.`
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
                text: `Error: interface ${params.method} ${params.path} not found (service: ${params.source}).\n\nHint: call swagger_search_api first to confirm the correct path and method.`,
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
