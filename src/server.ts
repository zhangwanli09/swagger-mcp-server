#!/usr/bin/env node
import { networkInterfaces } from "os";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerListSources } from "./tools/list-sources.js";
import { registerSearchApi } from "./tools/search-api.js";
import { registerGetApiDetail } from "./tools/get-api-detail.js";
import { registerRefreshCache } from "./tools/refresh-cache.js";
import { runWithSources } from "./services/source-context.js";

const PORT = Number(process.env.PORT ?? 3000);

const ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const BEARER_TOKEN = process.env.MCP_BEARER_TOKEN?.trim() || "";

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.header("origin");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: `Origin "${origin}" is not allowed.` });
      return;
    }
  }

  if (BEARER_TOKEN) {
    const auth = req.header("authorization") ?? "";
    const expected = `Bearer ${BEARER_TOKEN}`;
    if (auth !== expected) {
      res.status(401).json({ error: "Missing or invalid Authorization bearer token." });
      return;
    }
  }

  const accept = req.header("accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    console.error(
      `[mcp] Accept header "${accept}" does not include required types (application/json, text/event-stream). Allowing for backward compatibility.`
    );
  }

  const headerVal = req.header("x-swagger-sources");
  if (!headerVal || !headerVal.trim()) {
    res.status(400).json({
      error: "Missing X-Swagger-Sources header. Provide a JSON array of swagger Web UI URLs.",
    });
    return;
  }

  let sources: string[];
  try {
    const parsed = JSON.parse(headerVal);
    if (!Array.isArray(parsed) || !parsed.every((u) => typeof u === "string")) {
      throw new Error("must be a JSON array of URL strings");
    }
    sources = parsed;
  } catch (err) {
    res.status(400).json({
      error: `Invalid X-Swagger-Sources header: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  await runWithSources(sources, async () => {
    const server = new McpServer({ name: "swagger-mcp-server", version: "1.0.0" });
    registerListSources(server);
    registerSearchApi(server);
    registerGetApiDetail(server);
    registerRefreshCache(server);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    const cleanup = async () => {
      try {
        await transport.close();
      } catch {
        // ignore
      }
      try {
        await server.close();
      } catch {
        // ignore
      }
    };
    res.on("close", () => {
      void cleanup();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      await cleanup();
      throw err;
    }
  });
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
