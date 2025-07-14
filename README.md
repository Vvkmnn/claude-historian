# claude-historian

![claude-historian](demo.gif)

MCP server for searching your Claude Code conversation history. Find past solutions, track file changes, and learn from previous work.

[![npm version](https://badge.fury.io/js/claude-historian.svg)](https://www.npmjs.com/package/claude-historian)
[![npm downloads](https://img.shields.io/npm/dm/claude-historian.svg)](https://www.npmjs.com/package/claude-historian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/claude-historian.svg)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/librariesio/release/npm/claude-historian)](https://www.npmjs.com/package/claude-historian)
[![Package Size](https://img.shields.io/bundlephobia/min/claude-historian)](https://bundlephobia.com/package/claude-historian)

## install

Requirements: [Claude Code](https://github.com/anthropics/claude-code)

```bash
claude mcp add claude-historian -- npx claude-historian
```

No `npm install` needed. No external dependencies. No security concerns.

Manual configuration:

```json
{
  "mcpServers": {
    "claude-historian": {
      "command": "npx",
      "args": ["claude-historian"],
      "env": {}
    }
  }
}
```

## features

[MCP server](https://modelcontextprotocol.io/) that gives Claude access to your conversation history. Fast search with smart prioritization.

Runs locally (with cool shades `[⌐■_■]`):

```
search_conversations [⌐■_■] - Find past discussions
  @claude-historian search_conversations query:"authentication setup"

find_file_context [⌐□_□] - See what you did to files
  @claude-historian find_file_context filepath:"config.json"

get_error_solutions [⌐×_×] - Look up error fixes
  @claude-historian get_error_solutions error_pattern:"connection timeout"

find_similar_queries [⌐◆_◆] - Find related questions
  @claude-historian find_similar_queries query:"React hooks"

list_recent_sessions [⌐○_○] - Show recent work
  @claude-historian list_recent_sessions limit:3

find_tool_patterns [⌐⎚_⎚] - Analyze tool usage
  @claude-historian find_tool_patterns tool_name:"Edit"
```

## development

```bash
git clone https://github.com/your-repo/claude-historian
cd claude-historian
npm install
npm run build
npm test
```

Contributing:

- Fork the repository and create feature branches
- Test with large conversation histories before submitting PRs
- Follow TypeScript strict mode and [MCP protocol](https://spec.modelcontextprotocol.io/) standards

Learn from examples:

- [Official MCP servers](https://github.com/modelcontextprotocol/servers) for reference implementations
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) for best practices

## license

MIT

---

![Claude Fauchet](https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Claude_Fauchet_par_Thomas_de_Leu.jpg/336px-Claude_Fauchet_par_Thomas_de_Leu.jpg)

_Claude Fauchet (1744-1793), French revolutionary_
