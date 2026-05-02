import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListSources } from "./tools/list-sources.js";
import { registerSearchApi } from "./tools/search-api.js";
import { registerGetApiDetail } from "./tools/get-api-detail.js";
import { registerRefreshCache } from "./tools/refresh-cache.js";
import { setDefaultSourcesFile } from "./services/swagger-client.js";

export async function startStdio({ sourcesFile }: { sourcesFile?: string } = {}): Promise<void> {
  if (sourcesFile) {
    setDefaultSourcesFile(resolve(process.cwd(), sourcesFile));
  }

  const server = new McpServer({
    name: "internal-swagger-mcp",
    version: "1.0.0",
  });

  registerListSources(server);
  registerSearchApi(server);
  registerGetApiDetail(server);
  registerRefreshCache(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (!sourcesFile && !process.env.SWAGGER_SOURCES?.trim()) {
    console.error(
      "Warning: no swagger sources configured. Pass --sources-file <path> or set SWAGGER_SOURCES env var. Tool calls will fail until one is provided."
    );
  }
  console.error("Internal Swagger MCP Server running via stdio");
}
