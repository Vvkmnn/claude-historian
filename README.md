# claude-historian

![claude-historian](demo.gif)

**🔍 A blazing-fast Model Context Protocol (MCP) server for searching your Claude Code conversation history**

Find past solutions, track file changes, and learn from previous work with intelligent search algorithms.

[![npm version](https://img.shields.io/npm/v/claude-historian.svg)](https://www.npmjs.com/package/claude-historian)
[![npm downloads](https://img.shields.io/npm/dm/claude-historian.svg)](https://www.npmjs.com/package/claude-historian)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![GitHub Release](https://img.shields.io/github/v/release/Vvkmnn/claude-historian)](https://github.com/Vvkmnn/claude-historian/releases)

## 🚀 Quick Start

### Requirements
- [Claude Code](https://claude.ai/code) - The official Claude CLI
- Node.js 20+ (automatically handled by npx)

### One-Command Installation

```bash
# Install via Claude CLI (recommended)
claude mcp add claude-historian -- npx claude-historian

# Or add manually to any MCP-compatible client
npx claude-historian --config
```

**Zero setup required** - No npm install, no external dependencies, no local databases. Just pure search algorithms.

### Alternative Configurations

<details>
<summary>📱 Manual MCP Configuration</summary>

For Cursor, Windsurf, or other MCP clients:

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
</details>

<details>
<summary>🔧 From Inside Claude</summary>

Tell Claude directly:
```
Add this to our global mcp config: npx claude-historian
```
*(Requires restart)*
</details>

## ✨ Features

**7 Intelligent Search Tools** with smart prioritization and token optimization:

```bash
[⌐■_■] search_conversations query="error handling patterns"
  🎯 Smart query enhancement and classification
  📊 Summary-first results for maximum context
  ⚡ 68% faster than database-based alternatives

[⌐□_□] find_file_context filepath="package.json"
  📁 Track file evolution across conversations
  🔍 Context-aware operation type detection (read/edit)
  📈 Rich change history with timestamps

[⌐×_×] get_error_solutions error_pattern="MODULE_NOT_FOUND"
  🚨 Learn from past debugging sessions
  💡 Pattern matching with content scanning
  🔄 Solution frequency and success tracking

[⌐◆_◆] find_similar_queries query="state management approaches"
  🧠 Enhanced similarity with semantic understanding
  🎯 Technical keyword prioritization
  📝 Query evolution tracking

[⌐○_○] list_recent_sessions
  📅 Smart activity detection and grouping
  🛠️  Tool usage and file modification tracking
  ⏰ Intelligent time-based filtering

[⌐◉_◉] extract_compact_summary session_id="feature-branch-work"
  📋 AI-powered outcome extraction
  🔧 Tool usage pattern analysis
  💾 Minimal token consumption design

[⌐⎚_⎚] find_tool_patterns tool_name="Read"
  📊 Success rate analysis and recommendations
  🔄 Common workflow pattern detection
  💎 Best practice extraction
```

## 🏗️ Architecture

**Pure Streaming Architecture** - No databases, no indexing, no persistence:

```mermaid
flowchart LR
    A[Query Input] --> B[Query Classification]
    B --> C[Stream Conversations]
    C --> D[Smart Filtering]
    D --> E[Relevance Scoring]
    E --> F[Summary Prioritization]
    F --> G[Optimized Results]
```

### Key Technologies
- **[JSON Streaming](https://en.wikipedia.org/wiki/Streaming_JSON)**: On-demand parsing without full deserialization
- **[LRU Caching](https://en.wikipedia.org/wiki/Cache_replacement_policies#Least_recently_used_(LRU))**: Intelligent memory management
- **[TF-IDF Scoring](https://en.wikipedia.org/wiki/Tf%E2%80%93idf)**: Relevance ranking with context awareness
- **[Query Classification](https://en.wikipedia.org/wiki/Text_classification)**: Adaptive limits based on query type
- **[Fuzzy Matching](https://en.wikipedia.org/wiki/Edit_distance)**: Typo tolerance and technical term matching
- **[Time Decay](https://en.wikipedia.org/wiki/Exponential_decay)**: Recent conversations weighted higher

### Performance Benefits
- ⚡ **68% faster** than database approaches
- 💾 **Zero persistent storage** - privacy first
- 🔒 **Never leaves your machine** - complete data privacy
- 📈 **Token optimized** - summary-first, progressive detail

## 📦 npm Package Information

```bash
# View package info
npm view claude-historian

# Check latest version
npm view claude-historian version

# View all available versions
npm view claude-historian versions --json

# Get package documentation
npm docs claude-historian
```

**Package Stats:**
- 🎯 Zero external dependencies (only @modelcontextprotocol/sdk)
- 📏 Minimal bundle size (~31KB compressed)
- 🔧 Cross-platform compatibility (Windows/macOS/Linux)
- 🚀 Automatic updates via npx

## 🛠️ Development

### Local Development

```bash
# Clone and setup
git clone https://github.com/Vvkmnn/claude-historian.git
cd claude-historian
npm install

# Build and test
npm run build
npm test

# Run linting and formatting
npm run lint
npm run format
```

### Contributing

We welcome contributions! Please:

1. **Fork** the repository and create feature branches
2. **Test** with large conversation histories before submitting PRs
3. **Follow** TypeScript strict mode and [MCP protocol](https://spec.modelcontextprotocol.io/) standards
4. **Run** the full test suite: `npm run lint && npm run format:check && npm test`

### CI/CD Pipeline

- ✅ **Automated testing** on Node.js 18, 20, 22
- 🔒 **Security scanning** with npm audit
- 📦 **Semantic versioning** with automated releases
- 🚀 **NPM publishing** via GitHub Actions

## 📚 Learn More

### Official Resources
- [Model Context Protocol](https://modelcontextprotocol.io/) - Learn about MCP
- [Claude Code Documentation](https://docs.anthropic.com/claude/code) - Official Claude CLI docs
- [MCP Server Examples](https://github.com/modelcontextprotocol/servers) - Reference implementations
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Best practices

### Community
- 🐛 [Report Issues](https://github.com/Vvkmnn/claude-historian/issues)
- 💡 [Request Features](https://github.com/Vvkmnn/claude-historian/issues/new)
- 🤝 [Contributing Guide](CONTRIBUTING.md)
- 📖 [Changelog](CHANGELOG.md)

## 📄 License

[MIT](LICENSE) © 2025 Claude Code Community

---

## 🎭 About the Name

![Claude Fauchet](https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Claude_Fauchet_par_Thomas_de_Leu.jpg/336px-Claude_Fauchet_par_Thomas_de_Leu.jpg)

*Named after Claude Fauchet (1744-1793), French historian who pioneered systematic approaches to historical research and documentation.*