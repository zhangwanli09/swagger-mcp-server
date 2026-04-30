#!/usr/bin/env node
import { createRequire } from "node:module";
import { startStdio } from "./stdio.js";
import { startHttp } from "./http.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

const HELP = `internal-swagger-mcp ${VERSION}

MCP server for querying internal Swagger API documentation.

Usage:
  internal-swagger-mcp                                    Start in stdio mode (default, for MCP clients)
  internal-swagger-mcp --sources-file ./sources.json      Stdio mode reading sources from a project-local JSON file
  internal-swagger-mcp --http                             Start HTTP server on port 3000
  internal-swagger-mcp --http --port 8080                 Start HTTP server on a custom port

Options:
  --http                   Use Streamable HTTP transport instead of stdio
  --port <number>          HTTP port (default: 3000, or $PORT if set)
  --sources-file <path>    (stdio only) Path to a JSON file containing an array of Swagger Web UI URLs
  -h, --help               Show this help
  -v, --version            Show version

Environment:
  SWAGGER_SOURCES       (stdio)  JSON array of Swagger Web UI URLs (used when --sources-file is not set)
  PORT                  (http)   Override default HTTP port
  MCP_ALLOWED_ORIGINS   (http)   Comma-separated allowed Origin headers
  MCP_BEARER_TOKEN      (http)   Require "Authorization: Bearer <token>"
`;

function parseArgs(argv: string[]): { http: boolean; port: number; sourcesFile?: string } {
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

  let sourcesFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--sources-file") {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith("-")) {
        console.error(`Invalid --sources-file value: ${raw ?? "(missing)"}`);
        process.exit(1);
      }
      sourcesFile = raw;
      break;
    }
    if (tok.startsWith("--sources-file=")) {
      const raw = tok.slice("--sources-file=".length);
      if (!raw) {
        console.error("Invalid --sources-file value: (empty)");
        process.exit(1);
      }
      sourcesFile = raw;
      break;
    }
  }
  if (sourcesFile && http) {
    console.error(
      "--sources-file is only valid in stdio mode. In HTTP mode, sources must be passed per-request via the X-Swagger-Sources header."
    );
    process.exit(1);
  }

  return { http, port, sourcesFile };
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

  const { http, port, sourcesFile } = parseArgs(args);
  if (http) {
    await startHttp({ port });
  } else {
    await startStdio({ sourcesFile });
  }
}

main().catch((err: unknown) => {
  console.error("Server error:", err);
  process.exit(1);
});
