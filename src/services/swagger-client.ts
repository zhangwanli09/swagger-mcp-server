import { readFileSync } from "node:fs";
import type {
  ApiResponse,
  ApiResponseData,
  CachedSource,
} from "../types.js";
import { DEFAULT_CACHE_MINUTES, FIXED_HEADERS, REQUEST_TIMEOUT_MS } from "../constants.js";
import { getCurrentSources } from "./source-context.js";

// In-memory cache: sourceName / url -> CachedSource (URL keys are tenant-safe since URLs are globally unique)
const cache = new Map<string, CachedSource>();

export type SourceFailure = {
  url: string;
  apiUrl: string;
  error: string;
};

export type LoadAllResult = {
  sources: CachedSource[];
  failures: SourceFailure[];
};

const NO_SOURCES_ERROR =
  'No swagger sources configured. Pass via --sources-file <path> (stdio mode, JSON file with array of URLs), SWAGGER_SOURCES env var (stdio mode, JSON array of URLs), or X-Swagger-Sources header (HTTP mode, JSON array of URLs).';

let defaultSourcesFile: string | null = null;

export function setDefaultSourcesFile(absPath: string): void {
  defaultSourcesFile = absPath;
}

export function parseSourcesJson(raw: string, origin: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse ${origin} as JSON: ${err instanceof Error ? err.message : String(err)}. Expected a JSON array of URLs.`
    );
  }
  if (!Array.isArray(parsed) || !parsed.every((u) => typeof u === "string")) {
    throw new Error(`${origin} must be a JSON array of URL strings.`);
  }
  if (parsed.length === 0) {
    throw new Error(`${origin} must contain at least one URL.`);
  }
  return parsed;
}

function loadConfig(): string[] {
  const fromContext = getCurrentSources();
  if (fromContext && fromContext.length > 0) return fromContext;

  if (defaultSourcesFile) {
    let raw: string;
    try {
      raw = readFileSync(defaultSourcesFile, "utf8");
    } catch (err) {
      throw new Error(
        `Failed to read --sources-file at ${defaultSourcesFile}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return parseSourcesJson(raw, `--sources-file ${defaultSourcesFile}`);
  }

  const fromEnv = process.env.SWAGGER_SOURCES;
  if (fromEnv && fromEnv.trim().length > 0) {
    return parseSourcesJson(fromEnv, "SWAGGER_SOURCES env var");
  }

  throw new Error(NO_SOURCES_ERROR);
}

/**
 * Parse a Web UI URL and extract the API URL for fetching swagger data.
 *
 * Input:  http://swagger.example.com/?redirect=/login#/swaggerManage?fs-tenant=null&uid=xxx&formShare=0
 * Output: http://swagger.example.com/flow/swagger/share?uid=xxx&fs-tenant=null
 */
export function parseWebUrl(webUrl: string): string {
  const url = new URL(webUrl);
  const base = `${url.protocol}//${url.host}`;

  // Hash part: #/swaggerManage?fs-tenant=null&uid=xxx&formShare=0
  const hash = url.hash; // includes the '#'
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) {
    throw new Error(`Cannot parse uid from URL: ${webUrl}`);
  }

  const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
  const uid = hashParams.get("uid");
  const fsTenant = hashParams.get("fs-tenant") ?? "null";

  if (!uid) {
    throw new Error(`No uid found in URL: ${webUrl}`);
  }

  return `${base}/flow/swagger/share?uid=${uid}&fs-tenant=${encodeURIComponent(fsTenant)}`;
}

async function fetchSource(url: string): Promise<CachedSource> {
  const apiUrl = parseWebUrl(url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: ApiResponse;
  try {
    const res = await fetch(apiUrl, {
      headers: FIXED_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching swagger for "${url}"`);
    }
    response = (await res.json()) as ApiResponse;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new Error(`Request timeout fetching swagger for "${url}"`);
      }
      throw new Error(`Network error fetching swagger: ${err.message}`);
    }
    throw err;
  }

  if (response.code !== "000000" || !response.data) {
    throw new Error(
      `API returned error: code=${response.code}, msg=${response.msg}`
    );
  }

  const name = response.data.projectInfo?.projectName || "未命名服务";

  return {
    name,
    data: response.data,
    fetchedAt: new Date(),
    apiUrl,
  };
}

function isCacheValid(cached: CachedSource, cacheMinutes: number): boolean {
  const ageMs = Date.now() - cached.fetchedAt.getTime();
  return ageMs < cacheMinutes * 60 * 1000;
}

export async function getSource(
  url: string,
  cacheMinutes: number,
  forceRefresh = false
): Promise<CachedSource> {
  const cached = cache.get(url);

  if (!forceRefresh && cached && isCacheValid(cached, cacheMinutes)) {
    return cached;
  }

  const fresh = await fetchSource(url);
  // Use real name as cache key after fetch
  cache.set(fresh.name, fresh);
  // Also index by url in case name changes
  cache.set(url, fresh);
  return fresh;
}

export async function loadAllSources(forceRefresh = false): Promise<LoadAllResult> {
  const urls = loadConfig();
  const results = await Promise.allSettled(
    urls.map((url) => getSource(url, DEFAULT_CACHE_MINUTES, forceRefresh))
  );

  const sources: CachedSource[] = [];
  const failures: SourceFailure[] = [];
  for (let i = 0; i < results.length; i++) {
    const url = urls[i];
    const r = results[i];
    if (r.status === "fulfilled") {
      sources.push(r.value);
    } else {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      let apiUrl = url;
      try {
        apiUrl = parseWebUrl(url);
      } catch {
        // URL itself malformed — fall back to raw url string for display.
      }
      failures.push({ url, apiUrl, error });
    }
  }
  return { sources, failures };
}

export async function loadSourceByName(
  name: string
): Promise<{ source: CachedSource | undefined; failures: SourceFailure[] }> {
  const { sources, failures } = await loadAllSources(false);
  const source = sources.find((c) => c.name.toLowerCase() === name.toLowerCase());
  return { source, failures };
}

export function clearCache(name?: string): void {
  if (name) {
    // Clear all entries matching this name
    for (const [key, val] of cache.entries()) {
      if (val.name.toLowerCase() === name.toLowerCase() || key === name) {
        cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
}
