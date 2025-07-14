# claude-historian

![claude-historian](demo.gif)

A Model Context Protocol (MCP) server for searching your Claude Code conversation history. Find past solutions, track file changes, and learn from previous work.

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![npm version](https://img.shields.io/npm/v/claude-historian.svg)](https://www.npmjs.com/package/claude-historian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/Vvkmnn/claude-historian?utm_source=oss&utm_medium=github&utm_campaign=Vvkmnn%2Fclaude-historian&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

## install

Requirements:

- [Claude Code](https://claude.ai/code)

That's it. No `npm install` needed; thare are no external dependencies or local databases; only search algorithms.

**From shell:**

```bash
claude mcp add claude-historian -- npx claude-historian
```

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
  > "How did we fix that Redis connection pooling nightmare?"
  > "Docker container keeps crashing on Kubernetes deployment"
  > "React infinite re-render loop - useEffect dependency hell"

[⌐□_□] find_file_context filepath=<filepath>
  > "package.json changes that broke everything last month"
  > "When we accidentally committed .env to main branch"
  > "Authentication service refactor - before/after comparison"

[⌐×_×] get_error_solutions error_pattern=<error>
  > "MODULE_NOT_FOUND - the classic npm/yarn version mismatch"
  > "CORS preflight failing - but only on production Fridays?"
  > "Database deadlock during Black Friday traffic spike"

[⌐◆_◆] find_similar_queries query=<query>
  > "Database queries slower than my morning coffee brewing"
  > "How to implement error boundaries without losing sanity"
  > "State management: Redux vs Zustand vs just useState"

[⌐○_○] list_recent_sessions
  > "Tuesday debugging marathon: 9pm-3am flaky test hunt"
  > "Performance optimization sprint - reduced bundle 40%"
  > "The great TypeScript migration of 2024"

[⌐⎚_⎚] find_tool_patterns tool_name=<tool>
  > "Read → Edit → Bash combo for rapid prototyping"
  > "When I use Grep vs Task for different searches"
  > "Git operations during feature branch management"
```

## methodology

How claude-historian works ([source](https://github.com/Vvkmnn/claude-historian/tree/main/src)):

```
"docker auth" query
      |
      ├─> Classify: implementation query -> boost tool examples
      |
      ├─> Stream & Filter:
      |   • Summary messages -> priority queue *****
      |   • Tool usage context -> high value ****
      |   • Error solutions -> targeted ***
      |
      ├─> Smart Ranking:
      |   • "Fixed Docker auth with Read tool" (2h ago) *****
      |   • "OAuth implementation approach" (yesterday) ****
      |   • "Container auth debug" (last week) ***
      |
      └─> Return Claude Code optimized results
```

**Pure streaming architecture using:**

- **[JSON streaming parser](https://en.wikipedia.org/wiki/Streaming_JSON)**: Reads Claude Code conversation files on-demand without full deserialization
- **[LRU caching](<https://en.wikipedia.org/wiki/Cache_replacement_policies#Least_recently_used_(LRU)>)**: In-memory cache with intelligent eviction for frequently accessed conversations
- **[TF-IDF inspired scoring](https://en.wikipedia.org/wiki/Tf%E2%80%93idf)**: Term frequency scoring with document frequency weighting for relevance
- **[Query classification](https://en.wikipedia.org/wiki/Text_classification)**: Naive Bayes-style classification (error/implementation/analysis/general) with adaptive limits
- **[Edit distance](https://en.wikipedia.org/wiki/Edit_distance)**: Fuzzy matching for technical terms and typo tolerance
- **[Exponential time decay](https://en.wikipedia.org/wiki/Exponential_decay)**: Recent messages weighted higher with configurable half-life

**File access:**

- Reads from: `~/.claude/conversations/`
- Zero persistent storage or indexing
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