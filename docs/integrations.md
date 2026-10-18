# 集成指南

本仓库提供一个标准 MCP stdio 服务器，可被任何支持 MCP 的 Agent 宿主或 SDK 使用。所有配置都指向同一个入口：

```bash
npx -y github:Ming-QWQ520/deepseek-web-search#v0.1.0
```

或使用本地绝对路径：

```bash
node /absolute/path/to/deepseek-web-search/server/index.mjs
```

要求 Node.js 18+，并通过 `DEEPSEEK_API_KEY` 注入 API Key。服务名建议使用 `deepseek_web_search`，工具名为 `search`、`fetch`；带命名空间的宿主会显示为 `mcp__deepseek_web_search__search` 和 `mcp__deepseek_web_search__fetch`。

## 支持矩阵

| 宿主 | 配置位置 | 传输 | 示例 |
|---|---|---|---|
| DeepSeek Harness (dsh) | Agent preset 插件行 | stdio | `examples/deepseek-harness.yaml` |
| Claude Code | `.mcp.json` 或 `claude mcp add` | stdio | `examples/mcp/claude-code.mcp.json` |
| Claude Desktop | `claude_desktop_config.json` | stdio | `examples/mcp/claude-desktop.json` |
| Cursor | `.cursor/mcp.json` | stdio | `examples/mcp/cursor.mcp.json` |
| VS Code / Copilot | `.vscode/mcp.json` | stdio | `examples/mcp/vscode.mcp.json` |
| Cline | `cline_mcp_settings.json` | stdio | `examples/mcp/cline.json` |
| Roo Code | `mcp_settings.json` | stdio | `examples/mcp/cline.json` |
| Continue | `config.yaml` | stdio | `examples/mcp/continue.yaml` |
| MCP Python SDK | 代码内配置 | stdio | `examples/sdk/python-mcp-client.py` |
| 其他 MCP 客户端 | `mcpServers` 通用结构 | stdio | `examples/mcp/universal.json` |

## 通用 stdio 配置

大多数 MCP 客户端接受以下结构：

```json
{
  "mcpServers": {
    "deepseek_web_search": {
      "command": "npx",
      "args": [
        "-y",
        "github:Ming-QWQ520/deepseek-web-search#v0.1.0"
      ],
      "env": {
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

如果宿主无法执行 `npx`，改为 `"command": "node"`，`"args": ["/absolute/path/to/deepseek-web-search/server/index.mjs"]`。Windows 路径需要写成 `C:\\path\\to\\index.mjs` 或使用正斜杠。

## DeepSeek Harness (dsh)

DeepSeek Harness（[deepseek-ai/dsh](https://github.com/deepseek-ai/dsh)）通过内置插件 `@deepseek-ai/dsh-mcp-client` 连接 MCP 服务器。在 Agent preset 中加入一行插件配置：

```yaml
- id: mcp-deepseek-web-search
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: deepseek_web_search
    transport: stdio
    command: npx
    args:
      - '-y'
      - 'github:Ming-QWQ520/deepseek-web-search#v0.1.0'
    env:
      DEEPSEEK_API_KEY: !!js process.env.DEEPSEEK_API_KEY
```

要点：

- 使用 `!!js process.env.DEEPSEEK_API_KEY` 从环境读取密钥，不要把 Key 写进 preset。
- 工具以 `mcp__deepseek_web_search__search` 和 `mcp__deepseek_web_search__fetch` 暴露。
- 修改 preset 后，在**新会话**中才会出现工具；旧会话不会热更新。
- dsh 仍处于 developer preview，字段可能变化；以 `@deepseek-ai/dsh-mcp-client` 当前文档为准。
- 若 dsh 的环境没有 `npx`，把 `command` 改为 `node` 并填写绝对路径。

## Claude Code

命令行添加：

```bash
claude mcp add deepseek_web_search \
  -e DEEPSEEK_API_KEY=sk-... \
  -- npx -y github:Ming-QWQ520/deepseek-web-search#v0.1.0
```

或在项目根目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "deepseek_web_search": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "github:Ming-QWQ520/deepseek-web-search#v0.1.0"
      ],
      "env": {
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

`.mcp.json` 可能被提交到版本库；不要把真实 Key 写入该文件。使用 `claude mcp add -e` 或本地未跟踪配置更安全。

## Claude Desktop

编辑配置文件：

- Windows：`%APPDATA%\Claude\claude_desktop_config.json`
- macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "deepseek_web_search": {
      "command": "npx",
      "args": [
        "-y",
        "github:Ming-QWQ520/deepseek-web-search#v0.1.0"
      ],
      "env": {
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

保存后完全退出并重新打开 Claude Desktop。

## Cursor

项目级配置 `.cursor/mcp.json`，或全局配置 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "deepseek_web_search": {
      "command": "npx",
      "args": [
        "-y",
        "github:Ming-QWQ520/deepseek-web-search#v0.1.0"
      ],
      "env": {
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

在 Cursor 的 MCP 设置中确认服务器为绿色/已连接状态。

## VS Code / GitHub Copilot

工作区配置文件 `.vscode/mcp.json` 使用 `servers` 而不是 `mcpServers`，并通过 `inputs` 避免把 Key 写进文件：

```json
{
  "inputs": [
    {
      "id": "deepseek-api-key",
      "type": "promptString",
      "description": "DeepSeek API Key",
      "password": true
    }
  ],
  "servers": {
    "deepseek_web_search": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "github:Ming-QWQ520/deepseek-web-search#v0.1.0"
      ],
      "env": {
        "DEEPSEEK_API_KEY": "${input:deepseek-api-key}"
      }
    }
  }
}
```

## Cline / Roo Code

在 MCP 设置文件中加入：

```json
{
  "mcpServers": {
    "deepseek_web_search": {
      "command": "npx",
      "args": [
        "-y",
        "github:Ming-QWQ520/deepseek-web-search#v0.1.0"
      ],
      "env": {
        "DEEPSEEK_API_KEY": "sk-..."
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

常见路径：

- Cline（Windows）：`%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
- Cline（macOS）：`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Roo Code：把目录中的 `saoudrizwan.claude-dev` 替换为 `rooveterinaryinc.roo-cline`，文件为 `mcp_settings.json`

## Continue

编辑 `~/.continue/config.yaml`：

```yaml
mcpServers:
  - name: deepseek_web_search
    command: npx
    args:
      - -y
      - github:Ming-QWQ520/deepseek-web-search#v0.1.0
    env:
      DEEPSEEK_API_KEY: sk-...
```

## MCP Python SDK

在自建 Agent 中直接启动 stdio 服务器：

```python
import asyncio

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    params = StdioServerParameters(
        command="npx",
        args=["-y", "github:Ming-QWQ520/deepseek-web-search#v0.1.0"],
        env={"DEEPSEEK_API_KEY": "sk-..."},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print([tool.name for tool in tools.tools])


asyncio.run(main())
```

任何支持 stdio MCP 的框架都可以复用同一组 `command`/`args`/`env`。

## 验证

1. 确认服务器能启动：`DEEPSEEK_API_KEY=sk-... npx -y github:Ming-QWQ520/deepseek-web-search#v0.1.0`
2. 在宿主中确认工具列表包含 `search` 与 `fetch`。
3. 调用 `search`，查询 `DeepSeek API search`，应返回 `results` 数组。
4. 调用 `fetch`，传入返回结果中的 URL，应返回标题与 Markdown 正文。
5. 若宿主报“找不到工具”，确认使用的是新会话；部分宿主只在启动时读取工具列表。

## 安全

- 不要在仓库、preset、`.mcp.json` 或截图中暴露 API Key。
- 优先使用宿主的环境变量、密码输入或密钥管理功能。
- `fetch` 只接受 HTTP(S) URL，并拒绝包含凭据的 URL。
- 生产环境建议固定 release tag（如 `#v0.1.0`），不要长期跟随 `main`。
- 本仓库使用 AGPL-3.0-only；网络部署修改版时请遵守 AGPL 的源码提供义务。
