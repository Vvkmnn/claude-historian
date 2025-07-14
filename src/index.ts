#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { HistorySearchEngine } from './search.js';
import { BeautifulFormatter } from './formatter.js';

class ClaudeHistorianServer {
  private server: Server;
  private searchEngine: HistorySearchEngine;
  private formatter: BeautifulFormatter;

  constructor() {
    this.server = new Server(
      {
        name: 'claude-historian',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.searchEngine = new HistorySearchEngine();
    this.formatter = new BeautifulFormatter();
    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_conversations',
            description: 'Search through Claude Code conversation history',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query to find relevant conversations',
                },
                project: {
                  type: 'string',
                  description: 'Optional project name to filter results',
                },
                timeframe: {
                  type: 'string',
                  description: 'Time range filter (today, week, month)',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 50)',
                  default: 50,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'find_file_context',
            description: 'Find conversations related to a specific file',
            inputSchema: {
              type: 'object',
              properties: {
                filepath: {
                  type: 'string',
                  description: 'File path to search for in conversation history',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 20)',
                  default: 20,
                },
              },
              required: ['filepath'],
            },
          },
          {
            name: 'find_similar_queries',
            description: 'Find previous similar questions or queries',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Query to find similar previous questions',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 10)',
                  default: 10,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_error_solutions',
            description: 'Find how similar errors were resolved in the past',
            inputSchema: {
              type: 'object',
              properties: {
                error_pattern: {
                  type: 'string',
                  description: 'Error message or pattern to search for solutions',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 10)',
                  default: 10,
                },
              },
              required: ['error_pattern'],
            },
          },
          {
            name: 'list_recent_sessions',
            description: 'List recent conversation sessions',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of sessions (default: 10)',
                  default: 10,
                },
              },
            },
          },
          {
            name: 'extract_compact_summary',
            description: 'Get a compact summary of a conversation session',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: {
                  type: 'string',
                  description: 'Session ID to summarize',
                },
                max_messages: {
                  type: 'number',
                  description: 'Maximum messages to include in summary (default: 10)',
                  default: 10,
                },
              },
              required: ['session_id'],
            },
          },
          {
            name: 'find_tool_patterns',
            description: 'Find patterns of successful tool usage',
            inputSchema: {
              type: 'object',
              properties: {
                tool_name: {
                  type: 'string',
                  description: 'Optional specific tool name to analyze',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of patterns (default: 20)',
                  default: 20,
                },
              },
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'search_conversations':
            const searchResult = await this.searchEngine.searchConversations(
              args?.query as string,
              args?.project as string,
              args?.timeframe as string,
              (args?.limit as number) || 50
            );

            return {
              content: [
                {
                  type: 'text',
                  text: this.formatter.formatSearchConversations(searchResult),
                },
              ],
            };

          case 'find_file_context':
            const fileContexts = await this.searchEngine.findFileContext(
              args?.filepath as string,
              (args?.limit as number) || 20
            );

            return {
              content: [
                {
                  type: 'text',
                  text: this.formatter.formatFileContext(fileContexts, args?.filepath as string),
                },
              ],
            };

          case 'find_similar_queries':
            const similarQueries = await this.searchEngine.findSimilarQueries(
              args?.query as string,
              (args?.limit as number) || 10
            );

            return {
              content: [
                {
                  type: 'text',
                  text: this.formatter.formatSimilarQueries(similarQueries, args?.query as string),
                },
              ],
            };

          case 'get_error_solutions':
            const errorSolutions = await this.searchEngine.getErrorSolutions(
              args?.error_pattern as string,
              (args?.limit as number) || 10
            );

            return {
              content: [
                {
                  type: 'text',
                  text: this.formatter.formatErrorSolutions(errorSolutions, args?.error_pattern as string),
                },
              ],
            };

          case 'list_recent_sessions':
            const recentSessions = await this.searchEngine.getRecentSessions(
              (args?.limit as number) || 10
            );

            return {
              content: [
                {
                  type: 'text',
                  text: this.formatter.formatRecentSessions(recentSessions),
                },
              ],
            };

          case 'extract_compact_summary':
            // For now, return session info - could be enhanced with actual summarization
            const sessionInfo = await this.searchEngine.getRecentSessions(1);
            
            return {
              content: [
                {
                  type: 'text',
                  text: this.formatter.formatCompactSummary(sessionInfo, args?.session_id as string),
                },
              ],
            };

          case 'find_tool_patterns':
            const toolPatterns = await this.searchEngine.getToolPatterns(
              args?.tool_name as string,
              (args?.limit as number) || 20
            );

            return {
              content: [
                {
                  type: 'text',
                  text: this.formatter.formatToolPatterns(toolPatterns, args?.tool_name as string),
                },
              ],
            };

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        console.error('Tool execution error:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing ${request.params.name}: ${error}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Claude Historian MCP server running on stdio');
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Claude Historian - MCP Server for Claude Code History Search

Usage:
  npx claude-historian                    # Start MCP server (stdio mode)
  npx claude-historian --config           # Show configuration snippet
  npx claude-historian --help             # Show this help

Installation:
  claude mcp add claude-historian -- npx claude-historian

Configuration snippet for ~/.claude/.claude.json:
{
  "claude-historian": {
    "command": "npx",
    "args": ["claude-historian"],
    "env": {}
  }
}
  `);
  process.exit(0);
}

if (args.includes('--config')) {
  console.log(JSON.stringify({
    "claude-historian": {
      "command": "npx",
      "args": ["claude-historian"],
      "env": {}
    }
  }, null, 2));
  process.exit(0);
}

// Start the server
const server = new ClaudeHistorianServer();
server.run().catch(console.error);