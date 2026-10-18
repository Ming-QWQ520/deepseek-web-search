# AGENTS.md

## What this repository is

A standalone MCP server plus a ZCode plugin for DeepSeek-powered web search and page fetching. The server exposes two read-only tools over stdio JSON-RPC:

- `search`: live web search with `site:`, `lang:`, `after:`, `before:`, phrase and exclusion operators.
- `fetch`: retrieve one HTTP(S) page as Markdown.

## Run it

```bash
DEEPSEEK_API_KEY=sk-... node deepseek-web-search/server/index.mjs
```

Or through npm/npx (Node.js 18+):

```bash
DEEPSEEK_API_KEY=sk-... npx -y github:Ming-QWQ520/deepseek-web-search#v0.1.0
```

The process speaks MCP over stdin/stdout. Diagnostics go to stderr. It does not use HTTP for transport and has no runtime dependencies.

## Configure it in an agent host

- ZCode: install the plugin from this repository as a marketplace.
- DeepSeek Harness: add `@deepseek-ai/dsh-mcp-client` as a preset plugin; see `examples/deepseek-harness.yaml`.
- Claude Code, Claude Desktop, Cursor, VS Code, Cline, Roo Code, Continue and other MCP clients: see `docs/integrations.md` and `examples/`.

Tool names are `search` and `fetch`. Hosts that namespace MCP tools expose them as `mcp__deepseek_web_search__search` and `mcp__deepseek_web_search__fetch`.

## Agent skill

`deepseek-web-search/skills/deepseek-web-search/SKILL.md` defines when to search, when to fetch, query strategy, citation rules, error handling, rate limits and truncation behavior. Agents that support Agent Skills can load it directly; others should follow the same operating rules.

## Development rules

- Keep the server dependency-free and stdio-only.
- Never commit API keys, tokens, cookies or credentialed URLs.
- Validate before committing:
  - `node --check deepseek-web-search/server/index.mjs`
  - JSON files parse as valid JSON
  - the MCP handshake and `tools/list` succeed
- Do not rename the plugin, MCP server key or tool names without updating every integration example.

## License

AGPL-3.0-only. See `LICENSE`.
