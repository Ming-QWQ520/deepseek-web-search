#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * DeepSeek Web Search & Fetch — MCP server.
 *
 * Exposes two read-only tools over JSON-RPC 2.0 on stdio:
 *   - search: query the DeepSeek web search API
 *   - fetch:  retrieve a single page as Markdown
 *
 * Environment:
 *   DEEPSEEK_API_KEY                  required, Bearer token for api.deepseek.com
 *   DEEPSEEK_API_BASE                 optional, default https://api.deepseek.com/v1/tools
 *   DEEPSEEK_MAX_ATTEMPTS             optional, default 3
 *   DEEPSEEK_SEARCH_TIMEOUT_MS        optional, default 30000
 *   DEEPSEEK_FETCH_TIMEOUT_MS         optional, default 60000
 *   DEEPSEEK_MAX_FETCH_CHARS          optional, default 200000
 *   DEEPSEEK_MAX_SEARCH_CONTENT_CHARS optional, default 20000
 *   DEEPSEEK_SHUTDOWN_TIMEOUT_MS      optional, default 10000
 *   DEEPSEEK_DEBUG                    optional, set to "1" for verbose logs
 *
 * Protocol frames are written to stdout as newline-delimited JSON. All
 * diagnostics go to stderr so they never corrupt the JSON-RPC stream.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

// Version
let VERSION = "0.1.0";
try {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
  if (typeof pkg?.version === "string" && pkg.version) VERSION = pkg.version;
} catch {
  // package.json unavailable; fall back to the built-in version
}

// Logging (stderr only)
const IS_DEBUG = process.env.DEEPSEEK_DEBUG === "1";

function formatLogPart(value) {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(level, ...parts) {
  const text = parts.map(formatLogPart).join(" ");
  process.stderr.write(`[${new Date().toISOString()}] [${level}] [deepseek-mcp] ${text}\n`);
}

const log = {
  debug: (...parts) => {
    if (IS_DEBUG) emit("DEBUG", ...parts);
  },
  info: (...parts) => emit("INFO", ...parts),
  warn: (...parts) => emit("WARN", ...parts),
  error: (...parts) => emit("ERROR", ...parts),
};

// Configuration
function envInt(name, fallback, { min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    log.warn(`ignoring invalid ${name}=${JSON.stringify(raw)}, using ${fallback}`);
    return fallback;
  }
  return Math.floor(value);
}

const CONFIG = {
  apiBase: (process.env.DEEPSEEK_API_BASE ?? "").trim() || "https://api.deepseek.com/v1/tools",
  apiKey: (process.env.DEEPSEEK_API_KEY ?? "").trim(),
  maxAttempts: envInt("DEEPSEEK_MAX_ATTEMPTS", 3, { min: 1 }),
  timeouts: {
    search: envInt("DEEPSEEK_SEARCH_TIMEOUT_MS", 30_000, { min: 1 }),
    fetch: envInt("DEEPSEEK_FETCH_TIMEOUT_MS", 60_000, { min: 1 }),
  },
  maxFetchChars: envInt("DEEPSEEK_MAX_FETCH_CHARS", 200_000, { min: 1 }),
  maxSearchContentChars: envInt("DEEPSEEK_MAX_SEARCH_CONTENT_CHARS", 20_000, { min: 1 }),
  shutdownTimeoutMs: envInt("DEEPSEEK_SHUTDOWN_TIMEOUT_MS", 10_000, { min: 1 }),
};

const API_KEY_VALID = CONFIG.apiKey.length > 0 && !CONFIG.apiKey.includes("${");

if (!API_KEY_VALID) {
  log.warn("DEEPSEEK_API_KEY is missing or unresolved; tool calls will return an error until it is configured");
}

// Small utilities
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const unicodeLength = (value) => [...value].length;

function truncate(value, limit) {
  if (typeof value !== "string") return "";
  if (value.length <= limit) return value;
  const omitted = value.length - limit;
  return `${value.slice(0, limit)}\n\n[truncated: ${omitted} characters omitted]`;
}

// Errors
const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

class ApiError extends Error {
  constructor(status, endpoint, message) {
    super(`DeepSeek ${endpoint} failed (HTTP ${status}): ${message}`);
    this.name = "ApiError";
    this.status = status;
  }
}

// MCP protocol constants
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL = SUPPORTED_PROTOCOLS[0];
const SERVER_NAME = "deepseek-web-search";

const TOOL_SEARCH = "search";
const TOOL_FETCH = "fetch";

// Tool definitions
const TOOLS = [
  {
    name: TOOL_SEARCH,
    description:
      "Search the live web via DeepSeek. Use when you need real-time information, news, documentation, " +
      "or facts you are unsure about. Query supports operators: site:, -site:, \"exact phrase\", -word, " +
      "lang:zh,en, after:YYYY[-MM[-DD]], before:YYYY[-MM[-DD]]. Returns titles, URLs, snippets, summaries, " +
      "optional page content (truncated), dates and authority scores.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          description: "Search query with optional search operators.",
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
          description: "Number of results (1-50).",
        },
        ori_question: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          description: "User's original question, used to improve intent understanding.",
        },
        localization: {
          type: "string",
          description: "IP address used to prefer localized results.",
        },
        need_content: {
          type: "boolean",
          default: false,
          description: "Include page content (truncated) for each result.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_FETCH,
    description:
      "Fetch a single web page via DeepSeek and return its title and Markdown body. " +
      "Use when you already have a specific HTTP(S) URL and need its readable content. " +
      "Content is truncated if too long.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          maxLength: 8192,
          description: "Absolute HTTP(S) URL without credentials.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
];

const textResult = (text) => ({ content: [{ type: "text", text }] });
const errorResult = (text) => ({ content: [{ type: "text", text }], isError: true });


// Argument validation
function validateArguments(name, args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return "arguments must be a JSON object";
  }
  if (name === TOOL_SEARCH) return validateSearchArguments(args);
  if (name === TOOL_FETCH) return validateFetchArguments(args);
  return null;
}

function validateSearchArguments(args) {
  if (typeof args.query !== "string" || args.query.trim().length === 0) {
    return "query must be a non-empty string";
  }
  if (unicodeLength(args.query) > 128) {
    return "query must be at most 128 characters";
  }
  if (args.count != null && (!Number.isInteger(args.count) || args.count < 1 || args.count > 50)) {
    return "count must be an integer between 1 and 50";
  }
  if (args.need_content != null && typeof args.need_content !== "boolean") {
    return "need_content must be a boolean";
  }
  if (args.ori_question != null) {
    if (typeof args.ori_question !== "string") return "ori_question must be a string";
    const length = unicodeLength(args.ori_question);
    if (length < 1 || length > 128) return "ori_question must be between 1 and 128 characters";
  }
  if (args.localization != null && typeof args.localization !== "string") {
    return "localization must be a string";
  }
  return null;
}

function validateFetchArguments(args) {
  if (typeof args.url !== "string") return "url must be a string";
  if (args.url.length === 0) return "url must not be empty";
  if (args.url.length > 8192) return "url must be at most 8192 characters";
  let parsed;
  try {
    parsed = new URL(args.url);
  } catch {
    return "url must be an absolute HTTP(S) URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "url must use http or https";
  }
  if (parsed.username || parsed.password) {
    return "url must not contain credentials";
  }
  return null;
}

// HTTP client with retry
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 30_000;

function isRetryableStatus(status) {
  return RETRYABLE_STATUS.has(status);
}

function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function computeBackoff(attempt, retryAfterMs = null) {
  const base = Math.min(1000 * 2 ** (attempt - 1), 8_000);
  const jitter = Math.floor(Math.random() * 250);
  const backoff = base + jitter;
  if (retryAfterMs == null) return backoff;
  return Math.max(backoff, Math.min(retryAfterMs, MAX_RETRY_AFTER_MS));
}

async function callApi(endpoint, body, timeoutMs) {
  const url = `${CONFIG.apiBase}/${endpoint}`;
  let lastError;

  for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      log.debug(`POST ${url} attempt ${attempt}/${CONFIG.maxAttempts}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CONFIG.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": `deepseek-mcp/${VERSION}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        if (data == null) {
          throw new ApiError(response.status, endpoint, "empty or invalid JSON response");
        }
        return data;
      }

      const message = data?.error?.message ?? response.statusText ?? "unknown error";
      const apiError = new ApiError(response.status, endpoint, message);

      if (!isRetryableStatus(response.status) || attempt >= CONFIG.maxAttempts) {
        throw apiError;
      }

      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const delay = computeBackoff(attempt, retryAfterMs);
      log.warn(`HTTP ${response.status} from ${endpoint}, retrying in ${delay}ms`);
      await sleep(delay);
      lastError = apiError;
    } catch (error) {
      if (error instanceof ApiError) throw error;

      const wrapped = new Error(
        error.name === "AbortError"
          ? `DeepSeek ${endpoint} timed out after ${timeoutMs}ms`
          : `DeepSeek ${endpoint} request failed: ${error.message}`,
      );

      if (attempt >= CONFIG.maxAttempts) throw wrapped;

      const delay = computeBackoff(attempt);
      log.warn(`${wrapped.message}, retrying in ${delay}ms`);
      await sleep(delay);
      lastError = wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`DeepSeek ${endpoint} failed`);
}

// Tool execution
async function runSearch(args) {
  const body = {
    query: args.query,
    count: args.count ?? 10,
    need_content: args.need_content ?? false,
  };
  if (args.ori_question != null) body.ori_question = args.ori_question;
  if (args.localization != null) body.localization = args.localization;

  const data = await callApi("search", body, CONFIG.timeouts.search);

  if (Array.isArray(data?.results)) {
    for (const result of data.results) {
      if (typeof result.content === "string") {
        result.content = truncate(result.content, CONFIG.maxSearchContentChars);
      }
    }
  }

  return textResult(JSON.stringify(data));
}

async function runFetch(args) {
  const data = await callApi("fetch", { url: args.url }, CONFIG.timeouts.fetch);
  const title = typeof data?.title === "string" ? data.title : "";
  const content = typeof data?.content === "string" ? data.content : "";
  const header = `# ${title || args.url}\n\n`;
  return textResult(header + truncate(content, CONFIG.maxFetchChars));
}

async function executeTool(params) {
  const name = params?.name;
  const args = params?.arguments ?? {};

  if (typeof name !== "string" || name.length === 0) {
    throw new RpcError(RPC.INVALID_PARAMS, "Tool name is required");
  }
  if (!TOOLS.some((tool) => tool.name === name)) {
    throw new RpcError(RPC.INVALID_PARAMS, `Unknown tool: ${name}`);
  }

  const invalid = validateArguments(name, args);
  if (invalid) return errorResult(invalid);

  if (!API_KEY_VALID) {
    return errorResult(
      "Missing DeepSeek API key. Set DEEPSEEK_API_KEY in the server environment, then restart the server.",
    );
  }

  try {
    if (name === TOOL_SEARCH) return await runSearch(args);
    return await runFetch(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`tool "${name}" failed:`, error);
    return errorResult(message);
  }
}

// JSON-RPC dispatch
async function dispatch(method, params) {
  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions:
          "Use `search` for live web information (news, docs, facts you are unsure about). " +
          "Use `fetch` when you already have a specific HTTP(S) URL and need its readable content. " +
          "Long page content is truncated.",
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return executeTool(params);
    default:
      throw new RpcError(RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}


// Message handling
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleMessage(message) {
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: RPC.INVALID_REQUEST, message: "Invalid Request: expected an object" },
    });
    return;
  }

  const { id, method } = message;

  if (message.jsonrpc !== "2.0") {
    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id: id ?? null,
        error: { code: RPC.INVALID_REQUEST, message: 'Invalid Request: jsonrpc must be "2.0"' },
      });
    }
    return;
  }

  if (typeof method !== "string") {
    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: RPC.INVALID_REQUEST, message: "Invalid Request: method must be a string" },
      });
    }
    return;
  }

  // A message without an id is a JSON-RPC notification and must not be answered.
  if (id === undefined) {
    log.debug(`notification received: ${method}`);
    return;
  }

  try {
    const result = await dispatch(method, message.params ?? {});
    send({ jsonrpc: "2.0", id, result });
  } catch (error) {
    const code = error instanceof RpcError ? error.code : RPC.INTERNAL_ERROR;
    const message = error instanceof Error ? error.message : String(error);
    log.error(`method "${method}" failed:`, error);
    send({ jsonrpc: "2.0", id, error: { code, message } });
  }
}

async function processIncoming(message) {
  if (Array.isArray(message)) {
    if (message.length === 0) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: RPC.INVALID_REQUEST, message: "Invalid Request: empty batch" },
      });
      return;
    }
    // Process batch entries sequentially so account-level QPS is respected.
    for (const item of message) {
      await handleMessage(item);
    }
    return;
  }
  await handleMessage(message);
}

// Transport and lifecycle
let shuttingDown = false;
let queue = Promise.resolve();

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`shutting down (${reason}), draining pending requests`);

  const forceExit = setTimeout(() => {
    log.error("shutdown timed out, forcing exit");
    process.exit(1);
  }, CONFIG.shutdownTimeoutMs);

  try {
    await queue;
  } catch (error) {
    log.error("error while draining queue:", error);
  }

  clearTimeout(forceExit);
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) return;

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: RPC.PARSE_ERROR, message: "Parse error" } });
    return;
  }

  // Chain requests to avoid concurrent tool calls and keep the queue alive
  // even if a single message fails unexpectedly.
  queue = queue
    .then(() => processIncoming(message))
    .catch((error) => log.error("unexpected error while processing message:", error));
});

rl.on("close", () => {
  shutdown("stdin closed");
});

process.stdout.on("error", (error) => {
  log.error("stdout error:", error);
  process.exit(1);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection:", reason);
});

process.on("uncaughtException", (error) => {
  log.error("uncaughtException:", error);
  process.exit(1);
});