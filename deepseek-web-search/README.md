# DeepSeek Web Search for ZCode

通过 DeepSeek Search / Fetch API 为 ZCode 提供联网搜索与网页正文抓取，并附带面向 Agent 的使用技能。

## 功能

- **搜索**：返回标题、URL、短摘要、长摘要、发布时间、站点、权威度与可选正文。
- **抓取**：将指定 HTTP(S) 页面转换为 Markdown，保留标题。
- **检索语法**：支持 `site:`、`-site:`、精确短语、排除词、`lang:`、`after:`、`before:`。
- **生产级运行时**：参数校验、超时、指数退避重试、正文截断、结构化错误、优雅退出。
- **Agent 技能**：内置 `deepseek-web-search` skill，约束检索流程、引用方式与错误处理。
- **零依赖**：仅使用 Node.js 标准库，通过 stdio JSON-RPC 通信。

## 环境要求

- ZCode Desktop，已启用插件功能。
- Node.js 18 或更高版本。
- DeepSeek 开放平台 API Key。

## 安装

### 通过插件市场

1. 打开 **插件市场 → 添加 → 添加插件市场**。
2. 输入本仓库地址：`https://github.com/Ming-QWQ520/deepseek-web-search`。
3. 在 **个人 → DeepSeek 网页搜索** 中点击 **安装**。
4. 打开 **设置 → 插件 → DeepSeek Web Search → 高级**，填写 `api_key`。
5. 新建任务，使 MCP 服务器与 skill 加载。

### 本地开发

```bash
git clone https://github.com/Ming-QWQ520/deepseek-web-search.git
cd deepseek-web-search
```

在 ZCode 中把仓库根目录添加为插件市场即可。仓库根目录包含 `marketplace.json`，插件位于 `deepseek-web-search/`。

### 通用 MCP 客户端（npx）

Node.js 18+ 环境下无需克隆，直接把以下命令配置为 MCP 客户端的启动命令：

```bash
npx -y github:Ming-QWQ520/deepseek-web-search#v0.1.0
```

API Key 通过 `DEEPSEEK_API_KEY` 环境变量注入。DeepSeek Harness、Claude Code、Claude Desktop、Cursor、VS Code、Cline、Roo Code、Continue 等客户端的完整配置见 [集成指南](https://github.com/Ming-QWQ520/deepseek-web-search/blob/main/docs/integrations.md)。

## 配置

插件通过 ZCode user config 读取 `api_key`，并注入为 MCP 服务器环境变量 `DEEPSEEK_API_KEY`。

| 配置项 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `api_key` | string | 是 | DeepSeek API Key，`sk-` 开头 |

直接运行 MCP 服务器时可使用以下环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 无 | 必填，Bearer Token |
| `DEEPSEEK_API_BASE` | `https://api.deepseek.com/v1/tools` | API 基址 |
| `DEEPSEEK_MAX_ATTEMPTS` | `3` | 单个请求最大尝试次数（含首次） |
| `DEEPSEEK_SEARCH_TIMEOUT_MS` | `30000` | 搜索超时 |
| `DEEPSEEK_FETCH_TIMEOUT_MS` | `60000` | 抓取超时 |
| `DEEPSEEK_MAX_FETCH_CHARS` | `200000` | 抓取正文最大字符数 |
| `DEEPSEEK_MAX_SEARCH_CONTENT_CHARS` | `20000` | 搜索结果正文最大字符数 |
| `DEEPSEEK_SHUTDOWN_TIMEOUT_MS` | `10000` | 退出前等待在途请求的上限 |
| `DEEPSEEK_DEBUG` | 未设置 | 设为 `1` 输出调试日志到 stderr |

## 工具

### `search`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 是 | 1–128 字符，支持检索运算符 |
| `count` | integer | 否 | 1–50，默认 10 |
| `ori_question` | string | 否 | 1–128 字符，用户原始问题 |
| `localization` | string | 否 | 本地化偏好 IP |
| `need_content` | boolean | 否 | 默认 false；true 时返回正文（截断） |

返回 JSON，包含 `results` 数组。核心字段：

| 字段 | 说明 |
|---|---|
| `title` / `url` | 标题与链接 |
| `snippet` / `summary` | 短摘要 / 长摘要 |
| `content` | 页面正文；未请求或缺失时为空 |
| `date` | 发布时间，UTC RFC 3339，可能为 null |
| `rerank_score` | 0–3，≥1.5 通常表示高相关 |
| `authority` | 0–4，-1 表示未知，≥3 通常表示高权威 |

### `fetch`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 绝对 HTTP(S) URL，不含凭据，最长 8192 字符 |

返回 `# 标题` 加 Markdown 正文；超长时截断并标注省略字符数。

### 查询运算符

| 运算符 | 作用 | 示例 |
|---|---|---|
| `site:` | 限定站点，多站点用 `OR` | `site:github.com OR site:huggingface.co` |
| `-site:` | 排除站点 | `-site:example.com` |
| `"短语"` | 精确短语 | `"Mixture of Experts"` |
| `-词` / `-"短语"` | 排除词/短语 | `-招聘 -"广告"` |
| `lang:zh,en` | 限定语言 | `lang:zh,en` |
| `after:YYYY[-MM[-DD]]` | 发布时间下限 | `after:2026-01-01` |
| `before:YYYY[-MM[-DD]]` | 发布时间上限 | `before:2026-06-01` |

## 技能

安装后提供 `deepseek-web-search` skill，文件位于 `skills/deepseek-web-search/SKILL.md`。它规定：

- 何时使用搜索/抓取，何时应改用本地工具或浏览器自动化。
- 查询先宽后窄、按需抓取、控制结果数量。
- 来源分级、引用格式、空结果与截断处理。
- 401/402/403/404 与可重试错误的处理边界。
- QPS、计费与敏感信息约束。

## 集成

服务器使用标准 MCP stdio 传输，可直接接入任何支持 MCP 的 Agent 宿主：

| 宿主 | 适配方式 |
|---|---|
| DeepSeek Harness (dsh) | `@deepseek-ai/dsh-mcp-client` 预设插件行 |
| Claude Code | `.mcp.json` 或 `claude mcp add` |
| Claude Desktop | `claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` |
| VS Code / Copilot | `.vscode/mcp.json` |
| Cline / Roo Code | `cline_mcp_settings.json` / `mcp_settings.json` |
| Continue | `config.yaml` |
| 自建 Agent | MCP Python/TypeScript SDK 的 stdio 客户端 |

完整路径、配置片段与安全注意事项见 [docs/integrations.md](https://github.com/Ming-QWQ520/deepseek-web-search/blob/main/docs/integrations.md)，可直接复制 [examples](https://github.com/Ming-QWQ520/deepseek-web-search/tree/main/examples) 中的模板。带命名空间的宿主会显示 `mcp__deepseek_web_search__search` 和 `mcp__deepseek_web_search__fetch`。

## 调用示例

```json
{
  "method": "tools/call",
  "params": {
    "name": "search",
    "arguments": {
      "query": "DeepSeek 新模型发布 after:2026-01-01",
      "count": 5,
      "ori_question": "DeepSeek 最近发布了什么新模型？"
    }
  }
}
```

```json
{
  "method": "tools/call",
  "params": {
    "name": "fetch",
    "arguments": { "url": "https://api-docs.deepseek.com/zh-cn/guides/search/" }
  }
}
```

## 错误与重试

| HTTP | 含义 | 行为 |
|---|---|---|
| 400 | 参数不合法 | 修正参数后重试 |
| 401 | Key 无效 | 检查插件配置 |
| 402 | 余额不足 | 充值后重试 |
| 403 | 安全策略拦截 | 更换目标或停止 |
| 404 | 无法获得可用正文 | 改用其他来源 |
| 408 / 425 / 429 / 5xx | 临时性错误 | 自动退避重试，最多 3 次 |

工具错误以 `isError: true` 的文本返回，不伪造搜索结果。

## 限制与计费

- 每账号约 5 QPS，多个会话共享。
- 成功请求按约 ¥5 / 1000 次计费，`count` 不影响单价。
- 搜索仅在成功且有结果时计费；抓取成功时计费。
- 默认不返回搜索正文；需要正文时优先对目标页面调用 `fetch`，减少上下文与费用。

## 安全

- API Key 保存在 ZCode 插件配置中，不会写入本仓库。
- 不要提交 `.env`、密钥、Cookie 或带凭据的 URL。
- `fetch` 拒绝包含用户名/密码的 URL。
- 两个工具均为只读操作，不修改远端内容。
- 市场图标使用 jsDelivr 直链：`https://gcore.jsdelivr.net/gh/Ming-QWQ520/deepseek-web-search@v0.1.0/deepseek-web-search/assets/icon.png`；源文件为 `assets/icon.png`。

## 项目结构

```text
.
├── AGENTS.md
├── LICENSE
├── README.md
├── llms.txt
├── marketplace.json
├── package.json
├── docs/integrations.md
├── examples/
│   ├── deepseek-harness.yaml
│   ├── mcp/
│   └── sdk/
└── deepseek-web-search/
    ├── .zcode-plugin/plugin.json
    ├── LICENSE
    ├── assets/icon.png
    ├── server/
    │   ├── index.mjs
    │   └── package.json
    ├── skills/deepseek-web-search/SKILL.md
    └── README.md
```

## 开发

```bash
node --check deepseek-web-search/server/index.mjs
DEEPSEEK_API_KEY=sk-... node deepseek-web-search/server/index.mjs
```

服务器使用 stdio 传输，逐行收发 JSON-RPC 2.0。所有诊断日志写入 stderr，不会污染协议流。

## 许可证

本项目采用 [MIT License](LICENSE)，SPDX 标识为 `MIT`。可以自由使用、修改、分发和商用，只需保留版权与许可声明。

## 版本

`0.1.0`，许可证 `MIT`。
