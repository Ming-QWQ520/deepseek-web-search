"""Minimal MCP stdio client for the DeepSeek web search server.

Install: pip install mcp
Run:     DEEPSEEK_API_KEY=sk-... python python-mcp-client.py
"""

import asyncio
import os

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main() -> None:
    params = StdioServerParameters(
        command="npx",
        args=["-y", "github:Ming-QWQ520/deepseek-web-search#v0.1.0"],
        env={**os.environ, "DEEPSEEK_API_KEY": os.environ["DEEPSEEK_API_KEY"]},
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print("tools:", [tool.name for tool in tools.tools])

            result = await session.call_tool(
                "search",
                {"query": "DeepSeek API search", "count": 3},
            )
            for block in result.content:
                print(block.text)


if __name__ == "__main__":
    asyncio.run(main())
