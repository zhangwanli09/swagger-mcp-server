#!/usr/bin/env node
import { createRequire } from "node:module";
import { startStdio } from "./stdio.js";
import { startHttp } from "./http.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

const HELP = `internal-swagger-mcp ${VERSION}

MCP server for querying internal Swagger API documentation.

Usage:
  internal-swagger-mcp                    Start in stdio mode (default, for MCP clients)
  internal-swagger-mcp --http             Start HTTP server on port 3000
  internal-swagger-mcp --http --port 8080 Start HTTP server on a custom port

Options:
  --http           Use Streamable HTTP transport instead of stdio
  --port <number>  HTTP port (default: 3000, or $PORT if set)
  -h, --help       Show this help
  -v, --version    Show version

Environment:
  SWAGGER_SOURCES       (stdio)  JSON array of Swagger Web UI URLs
  PORT                  (http)   Override default HTTP port
  MCP_ALLOWED_ORIGINS   (http)   Comma-separated allowed Origin headers
  MCP_BEARER_TOKEN      (http)   Require "Authorization: Bearer <token>"
`;

function parseArgs(argv: string[]): { http: boolean; port: number } {
  const http = argv.includes("--http");
  const portIdx = argv.indexOf("--port");
  let portFromCli: number | undefined;
  if (portIdx >= 0) {
    const raw = argv[portIdx + 1];
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) {
      console.error(`Invalid --port value: ${raw ?? "(missing)"}`);
      process.exit(1);
    }
    portFromCli = n;
  }
  let portFromEnv: number | undefined;
  if (process.env.PORT && process.env.PORT.trim()) {
    const n = Number(process.env.PORT);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`Invalid PORT env var: ${process.env.PORT}`);
      process.exit(1);
    }
    portFromEnv = n;
  }
  const port = portFromCli ?? portFromEnv ?? 3000;
  return { http, port };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  if (args.includes("-v") || args.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const { http, port } = parseArgs(args);
  if (http) {
    await startHttp({ port });
  } else {
    await startStdio();
  }
}

main().catch((err: unknown) => {
  console.error("Server error:", err);
  process.exit(1);
});
