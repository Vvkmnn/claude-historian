# claude-historian

![claude-historian](demo.gif)

A Model Context Protocol (MCP) server for searching your Claude Code conversation history. Find past solutions, track file changes, and learn from previous work.

[![npm version](https://img.shields.io/npm/v/claude-historian.svg)](https://www.npmjs.com/package/claude-historian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

## install

Requirements: [Claude Code](https://claude.ai/code)

**From shell:**

```bash
claude mcp add claude-historian -- npx claude-historian
```

No `npm install` needed. No external dependencies. No security concerns.

**From inside Claude** (restart required):

```
Add this to our global mcp config: npx claude-historian

Install this mcp: https://github.com/Vvkmnn/claude-historian
```

**From any manually configurable `mcp.json`**: (Cursor, Windsurf, etc.)

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
[⌐■_■] search_conversations query=<query>
  > How did we fix the Redis connection pooling in production?
  > That 3am session chasing a semicolon bug for 4 hours
  > WebSocket reconnection with exponential backoff patterns

[⌐□_□] find_file_context filepath=<filepath>
  > What broke when we upgraded React to v18 last month?
  > When we accidentally committed secrets to the repo
  > Authentication service refactor with proper error handling

[⌐×_×] get_error_solutions error_pattern=<error>
  > React component re-rendering infinitely in production
  > That CORS issue that only happened on Fridays somehow
  > Race condition between DB transactions and cache invalidation

[⌐◆_◆] find_similar_queries query=<query>
  > Database queries running slower than my morning coffee
  > Anything about implementing proper error boundaries?
  > Event sourcing with snapshot management and replay logic

[⌐○_○] list_recent_sessions
  > Late-night session finally fixing those flaky tests
  > The great debugging marathon of last Tuesday
  > Performance sprint that reduced load times by 60%

[⌐⎚_⎚] find_tool_patterns tool_name=<tool>
  > Git vs file operations during that refactoring week
  > Do I search more when stuck on frontend vs backend?
  > Which tools correlate with my most productive sessions?
```

## methodology

How claude-historian works ([source](https://github.com/Vvkmnn/claude-historian/tree/main/src)):

```
"docker auth" query
      │
      ├─> Tokenize: ["docker", "auth*"]
      │
      ├─> FTS5
      │   • "auth*" → authentication ✓
      │   • "auth*" → authorize ✓
      │   • "auth*" → OAuth ✓
      │
      ├─> Scan conversations:
      │   • "Fixed authentication bug in Docker" (yesterday) ★★★★★
      │   • "Docker OAuth implementation" (last week) ★★★
      │   • "Authorized container access" (last month) ★
      │
      └─> Return ranked results
```

The logic:

- **[FTS5](https://www.sqlite.org/fts5.html)**: SQLite's full-text search engine with advanced ranking
- **Prefix matching**: `conn` → connection, connect, reconnect
- **[Porter stemming](https://tartarus.org/martin/PorterStemmer/)**: `running` → run, `flies` → fly
- **Fuzzy search**: `recieve` → receive (typos handled)
- **Time decay**: Yesterday = 5x weight, last week = 3x, older = 1x

File access:

- Reads from: `~/.claude/conversations/`
- Indexes to: `~/.local/share/claude-historian/history.db`
- Never leaves your machine

## development

```bash
git clone https://github.com/vvkmnn/claude-historian && cd claude-historian
npm install && npm run build
npm test
```

Contributing:

- Please fork the repository and create feature branches
- Test with large conversation histories before submitting PRs
- Follow TypeScript strict mode and [MCP protocol](https://spec.modelcontextprotocol.io/) standards

Learn from examples:

- [Official MCP servers](https://github.com/modelcontextprotocol/servers) for reference implementations
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) for best practices

## license

[MIT](LICENSE)

---

![Claude Fauchet](https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Claude_Fauchet_par_Thomas_de_Leu.jpg/336px-Claude_Fauchet_par_Thomas_de_Leu.jpg)

_Claude Fauchet (1744-1793), French Historian_
