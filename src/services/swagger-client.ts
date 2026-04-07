import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type {
  ApiResponse,
  ApiResponseData,
  CachedSource,
} from "../types.js";
import { DEFAULT_CACHE_MINUTES, FIXED_HEADERS, REQUEST_TIMEOUT_MS } from "../constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCES_CONFIG_PATH = resolve(__dirname, "../../swagger-sources.json");

// In-memory cache: sourceName -> CachedSource
const cache = new Map<string, CachedSource>();

let config: string[] | null = null;

function loadConfig(): string[] {
  if (config) return config;
  const raw = readFileSync(SOURCES_CONFIG_PATH, "utf-8");
  config = JSON.parse(raw) as string[];
  return config;
}

/**
 * Parse a Web UI URL and extract the API URL for fetching swagger data.
 *
 * Input:  http://172.16.101.121:8112/?redirect=/login#/swaggerManage?fs-tenant=null&uid=xxx&formShare=0
 * Output: http://172.16.101.121:8112/flow/swagger/share?uid=xxx&fs-tenant=null
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

export async function loadAllSources(forceRefresh = false): Promise<CachedSource[]> {
  const urls = loadConfig();
  return Promise.all(urls.map((url) => getSource(url, DEFAULT_CACHE_MINUTES, forceRefresh)));
}

export async function loadSourceByName(
  name: string
): Promise<CachedSource | undefined> {
  const all = await loadAllSources(false);
  return all.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

export function getCacheStatus(): Array<{
  name: string;
  fetchedAt: Date | null;
  apiUrl: string;
}> {
  const urls = loadConfig();
  return urls.map((url) => {
    const cached = cache.get(url);
    return {
      name: cached?.name ?? url,
      fetchedAt: cached?.fetchedAt ?? null,
      apiUrl: cached?.apiUrl ?? parseWebUrl(url),
    };
  });
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
