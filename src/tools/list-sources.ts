import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAllSources, getCacheStatus, loadAllSources } from "../services/swagger-client.js";
import { DEFAULT_CACHE_MINUTES } from "../constants.js";

export function registerListSources(server: McpServer): void {
  server.registerTool(
    "swagger_list_sources",
    {
      title: "List Swagger Sources",
      description: `列出所有已配置的 Swagger 文档源及其缓存状态。

返回每个服务的：
- name: 服务名称（来自配置或自动从 projectName 读取）
- fetchedAt: 最后缓存时间（null 表示尚未加载）
- totalInterfaces: 接口总数（已加载时显示）
- modules: 模块列表

用途：在使用 swagger_search_api 之前，可先用此工具了解有哪些可用服务。`,
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const cfg = getAllSources();
        const cacheMinutes = cfg.cacheMinutes ?? DEFAULT_CACHE_MINUTES;
        // Load first so cache is populated before getCacheStatus() reads it
        const sources = await loadAllSources(false);
        const statuses = getCacheStatus();

        const lines: string[] = ["# 已配置的 Swagger 文档源\n"];
        for (const src of sources) {
          const totalInterfaces = src.data.modules.reduce(
            (sum, m) => sum + (m.interfaceInfos?.length ?? 0),
            0
          );
          const modules = src.data.modules.map((m) => m.moduleName).join("、");
          lines.push(`## ${src.name}`);
          lines.push(`- **项目路径**: ${src.data.projectInfo.projectPath}`);
          lines.push(`- **状态**: ${src.data.projectInfo.projectStatusName ?? "未知"}`);
          lines.push(`- **接口总数**: ${totalInterfaces}`);
          lines.push(`- **缓存时间**: ${src.fetchedAt.toLocaleString("zh-CN")}`);
          lines.push(`- **缓存有效期**: ${cacheMinutes} 分钟`);
          if (modules) lines.push(`- **模块**: ${modules}`);
          lines.push("");
        }

        // Add any sources that failed to load (show from status)
        const loadedNames = new Set(sources.map((s) => s.name));
        for (const st of statuses) {
          if (!loadedNames.has(st.name)) {
            lines.push(`## ${st.name} ⚠️ (未加载)`);
            lines.push(`- **API URL**: ${st.apiUrl}`);
            lines.push("");
          }
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
