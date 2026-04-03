#!/usr/bin/env node
import { networkInterfaces } from "os";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerListSources } from "./tools/list-sources.js";
import { registerSearchApi } from "./tools/search-api.js";
import { registerGetApiDetail } from "./tools/get-api-detail.js";
import { registerRefreshCache } from "./tools/refresh-cache.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = new McpServer({ name: "swagger-mcp-server", version: "1.0.0" });
  registerListSources(server);
  registerSearchApi(server);
  registerGetApiDetail(server);
  registerRefreshCache(server);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

function getLocalIP() {
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

app.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIP();
  console.error(`Swagger MCP Server (HTTP) listening on http://${ip}:${PORT}/mcp`);
  console.error(`Health check: http://${ip}:${PORT}/health`);
});
