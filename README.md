# internal-swagger-mcp

Let AI agents query your internal Swagger platform's API docs via MCP.

> This server talks to the internal Swagger management platform's private share endpoint (`/flow/swagger/share?uid=...`), not a public OpenAPI URL.

## Tools

| Tool | Purpose |
|------|---------|
| `swagger_list_sources` | List all configured services and their cache status |
| `swagger_search_api` | Search APIs by keyword (filterable by method / service) |
| `swagger_get_api_detail` | View an API's full parameters and mock example |
| `swagger_refresh_cache` | Force-refresh the doc cache (default TTL is 30 minutes) |

## Connecting MCP clients

Requires Node.js ≥ 18. Swagger sources are always supplied by the client — this server holds no configuration. Pass them in stdio mode via the `SWAGGER_SOURCES` env var or [`--sources-file`](#sources-file), and in HTTP mode via the `X-Swagger-Sources` header per request. **Use project scope** for every client's MCP config so each repo pins its own sources and the config can be committed to git. In the snippets below, `<SOURCE>` looks like `http://your-server/...#/swaggerManage?uid=xxx`; if `swagger_list_sources` works inside the client, the integration is up.

Start in HTTP mode (for deploying on a shared internal host):

```bash
npx -y internal-swagger-mcp --http   # defaults to port 3000; override with --port or PORT
```

### Claude Code

[Official docs](https://code.claude.com/docs/en/mcp) — using `--scope project` writes to the project root's `.mcp.json`.

Local (stdio):

```bash
claude mcp add swagger --scope project --env SWAGGER_SOURCES='["<SOURCE>"]' -- npx -y internal-swagger-mcp
```

Remote (HTTP):

```bash
claude mcp add --transport http swagger --scope project http://<internal-IP>:3000/mcp --header 'X-Swagger-Sources: ["<SOURCE>"]'
```

### opencode

[Official docs](https://opencode.ai/docs/mcp-servers) — place this in `opencode.json` at the project root.

Local (stdio):

```json
{
  "mcp": {
    "swagger": {
      "type": "local",
      "command": ["npx", "-y", "internal-swagger-mcp"],
      "environment": {
        "SWAGGER_SOURCES": "[\"<SOURCE>\"]"
      }
    }
  }
}
```

Remote (HTTP):

```json
{
  "mcp": {
    "swagger": {
      "type": "remote",
      "url": "http://<internal-IP>:3000/mcp",
      "headers": {
        "X-Swagger-Sources": "[\"<SOURCE>\"]"
      }
    }
  }
}
```

### Cursor

[Official docs](https://cursor.com/docs/context/mcp) — place this in `.cursor/mcp.json` at the project root.

Local (stdio):

```json
{
  "mcpServers": {
    "swagger": {
      "command": "npx",
      "args": ["-y", "internal-swagger-mcp"],
      "env": {
        "SWAGGER_SOURCES": "[\"<SOURCE>\"]"
      }
    }
  }
}
```

Remote (HTTP):

```json
{
  "mcpServers": {
    "swagger": {
      "url": "http://<internal-IP>:3000/mcp",
      "headers": {
        "X-Swagger-Sources": "[\"<SOURCE>\"]"
      }
    }
  }
}
```

### Sources file

When the source list belongs to the project, pass `--sources-file <path>` instead of pasting the same JSON-as-string into every client's `env`. Use a path relative to the project root (e.g. `./swagger-sources.json`) — it resolves from `process.cwd()`, which is the project root under project-scoped configs in Claude Code, Cursor, opencode, etc. — so the MCP config can be committed and shared as-is.

`swagger-sources.json` (each entry is a `<SOURCE>` URL as defined above):

```json
[
  "<SOURCE_1>",
  "<SOURCE_2>"
]
```

Each client config then becomes a thin wrapper around the same command:

Claude Code:

```bash
claude mcp add swagger --scope project -- npx -y internal-swagger-mcp --sources-file ./swagger-sources.json
```

opencode (`opencode.json`):

```json
{
  "mcp": {
    "swagger": {
      "type": "local",
      "command": ["npx", "-y", "internal-swagger-mcp", "--sources-file", "./swagger-sources.json"]
    }
  }
}
```

Cursor (`.cursor/mcp.json`) — and other clients using the `mcpServers` shape:

```json
{
  "mcpServers": {
    "swagger": {
      "command": "npx",
      "args": ["-y", "internal-swagger-mcp", "--sources-file", "./swagger-sources.json"]
    }
  }
}
```

The file is read once at startup; the source list is fixed for the server's lifetime (clients relaunch on config change anyway). When both `--sources-file` and `SWAGGER_SOURCES` are provided, the file wins. The flag is rejected in `--http` mode because HTTP sources are inherently per-request.

## HTTP deployment security

The server binds to `0.0.0.0` by default for easy intranet sharing, and prints a warning if started bare. In production, set at least one of the following:

| Environment variable | Effect |
|------|--------|
| `MCP_BIND_HOST` | Bind address; set to `127.0.0.1` to restrict access to the local host (default `0.0.0.0`) |
| `MCP_BEARER_TOKEN` | Require an `Authorization: Bearer <token>` header on every request |
| `MCP_ALLOWED_ORIGINS` | Comma-separated Origin allowlist (DNS-rebinding protection) |

> When `MCP_ALLOWED_ORIGINS` is set, requests without an `Origin` header are rejected — except for requests carrying a valid `MCP_BEARER_TOKEN`, so server-to-server calls still work.
