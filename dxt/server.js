#!/usr/bin/env node

// DXT-specific server implementation for Claude Desktop
// Fixes process lifecycle issues while keeping NPM package unchanged

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

// Import from parent dist directory (NPM build)
import { HistorySearchEngine } from '../dist/search.js';
import { BeautifulFormatter } from '../dist/formatter.js';
import { UniversalHistorySearchEngine } from '../dist/universal-engine.js';

class ClaudeHistorianDXTServer {
  constructor() {
    this.server = new Server(
      {
        name: 'claude-historian',
        version: '1.0.1',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.searchEngine = new HistorySearchEngine();
    this.universalEngine = new UniversalHistorySearchEngine();
    this.formatter = new BeautifulFormatter();
    this.setupToolHandlers();
  }

  setupToolHandlers() {
    // Copy exact tool handlers from main server implementation
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_conversations',
            description: 'Search through Claude Code conversation history with smart insights',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query to find relevant conversations'
                },
                project: {
                  type: 'string',
                  description: 'Optional project name to filter results'
                },
                timeframe: {
                  type: 'string',
                  description: 'Time range filter (today, week, month)'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 10)',
                  default: 10
                },
                detail_level: {
                  type: 'string',
                  description: 'Response detail: summary (default), detailed, raw',
                  enum: ['summary', 'detailed', 'raw'],
                  default: 'summary'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'find_file_context',
            description: 'Find all conversations and changes related to a specific file',
            inputSchema: {
              type: 'object',
              properties: {
                filepath: {
                  type: 'string',
                  description: 'File path to search for in conversation history'
                },
                operation_type: {
                  type: 'string',
                  description: 'Filter by operation: read, edit, create, or all',
                  enum: ['read', 'edit', 'create', 'all'],
                  default: 'all'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 15)',
                  default: 15
                },
                detail_level: {
                  type: 'string',
                  description: 'Response detail: summary (default), detailed, raw',
                  enum: ['summary', 'detailed', 'raw'],
                  default: 'summary'
                }
              },
              required: ['filepath']
            }
          },
          {
            name: 'find_similar_queries',
            description: 'Find previous similar questions or queries with enhanced matching',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Query to find similar previous questions'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 8)',
                  default: 8
                },
                detail_level: {
                  type: 'string',
                  description: 'Response detail: summary (default), detailed, raw',
                  enum: ['summary', 'detailed', 'raw'],
                  default: 'summary'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get_error_solutions',
            description: 'Find solutions for specific errors with enhanced matching',
            inputSchema: {
              type: 'object',
              properties: {
                error_pattern: {
                  type: 'string',
                  description: 'Error message or pattern to search for solutions'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 8)',
                  default: 8
                },
                detail_level: {
                  type: 'string',
                  description: 'Response detail: summary (default), detailed, raw',
                  enum: ['summary', 'detailed', 'raw'],
                  default: 'summary'
                }
              },
              required: ['error_pattern']
            }
          },
          {
            name: 'list_recent_sessions',
            description: 'Browse recent sessions with smart activity detection and summaries',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of sessions (default: 10)',
                  default: 10
                },
                project: {
                  type: 'string',
                  description: 'Optional project name to filter sessions'
                },
                include_summary: {
                  type: 'boolean',
                  description: 'Include intelligent session summaries (default: true)',
                  default: true
                }
              }
            }
          },
          {
            name: 'extract_compact_summary',
            description: 'Get intelligent summary of a conversation session with key insights',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: {
                  type: 'string',
                  description: 'Session ID to summarize'
                },
                max_messages: {
                  type: 'number',
                  description: 'Maximum messages to analyze (default: 10)',
                  default: 10
                },
                focus: {
                  type: 'string',
                  description: 'Focus area: solutions, tools, files, or all',
                  enum: ['solutions', 'tools', 'files', 'all'],
                  default: 'all'
                }
              },
              required: ['session_id']
            }
          },
          {
            name: 'find_tool_patterns',
            description: 'Analyze tool usage patterns, workflows, and successful practices',
            inputSchema: {
              type: 'object',
              properties: {
                tool_name: {
                  type: 'string',
                  description: 'Optional specific tool name to analyze'
                },
                pattern_type: {
                  type: 'string',
                  description: 'Type of patterns: tools, workflows, or solutions',
                  enum: ['tools', 'workflows', 'solutions'],
                  default: 'tools'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of patterns (default: 12)',
                  default: 12
                }
              }
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'search_conversations': {
            const universalResult = await this.universalEngine.searchConversations(
              args?.query,
              args?.project,
              args?.timeframe,
              args?.limit || 10
            );

            const detailLevel = args?.detail_level || 'summary';
            const formattedResult = this.formatter.formatSearchConversations(universalResult.results, detailLevel);
            
            const lines = formattedResult.split('\n');
            const sourceInfo = universalResult.enhanced 
              ? 'Searching: Claude Code + Desktop'
              : 'Searching: Claude Code';
            const actionInfo = `Query: "${args?.query}" | Action: Conversation search`;
            const scope = args?.project ? ` | Project: ${args?.project}` : '';
            const timeInfo = args?.timeframe ? ` | Time: ${args?.timeframe}` : '';
            
            lines[0] = sourceInfo;
            lines[1] = actionInfo + scope + timeInfo;
            
            return {
              content: [
                {
                  type: 'text',
                  text: lines.join('\n'),
                },
              ],
            };
          }

          case 'find_file_context': {
            const universalResult = await this.universalEngine.findFileContext(
              args?.filepath,
              args?.limit || 15
            );

            const detailLevel = args?.detail_level || 'summary';
            const operationType = args?.operation_type || 'all';
            
            const formattedResult = this.formatter.formatFileContext(universalResult.results, args?.filepath, detailLevel, operationType);
            
            const lines = formattedResult.split('\n');
            const sourceInfo = universalResult.enhanced 
              ? 'Searching: Claude Code + Desktop'
              : 'Searching: Claude Code';
            const actionInfo = `Target: "${args?.filepath}" | Action: File change history`;
            const filterInfo = operationType !== 'all' ? ` | Filter: ${operationType}` : '';
            
            lines[0] = sourceInfo;
            lines[1] = actionInfo + filterInfo;

            return {
              content: [
                {
                  type: 'text',
                  text: lines.join('\n'),
                },
              ],
            };
          }

          case 'find_similar_queries': {
            const universalResult = await this.universalEngine.findSimilarQueries(
              args?.query,
              args?.limit || 8
            );

            const detailLevel = args?.detail_level || 'summary';
            const formattedResult = this.formatter.formatSimilarQueries(universalResult.results, args?.query, detailLevel);
            
            const lines = formattedResult.split('\n');
            const sourceInfo = universalResult.enhanced 
              ? 'Searching: Claude Code + Desktop'
              : 'Searching: Claude Code';
            const actionInfo = `Query: "${args?.query}" | Action: Similar queries & patterns`;
            
            lines[0] = sourceInfo;
            lines[1] = actionInfo;
            
            return {
              content: [
                {
                  type: 'text',
                  text: lines.join('\n'),
                },
              ],
            };
          }

          case 'get_error_solutions': {
            const universalResult = await this.universalEngine.getErrorSolutions(
              args?.error_pattern,
              args?.limit || 8
            );

            const detailLevel = args?.detail_level || 'summary';
            const formattedResult = this.formatter.formatErrorSolutions(
              universalResult.results,
              args?.error_pattern,
              detailLevel
            );
            
            const lines = formattedResult.split('\n');
            const sourceInfo = universalResult.enhanced 
              ? 'Searching: Claude Code + Desktop'
              : 'Searching: Claude Code';
            const actionInfo = `Error: "${args?.error_pattern}" | Action: Solution lookup`;
            
            lines[0] = sourceInfo;
            lines[1] = actionInfo;
            
            return {
              content: [
                {
                  type: 'text',
                  text: lines.join('\n'),
                },
              ],
            };
          }

          case 'list_recent_sessions': {
            const limit = args?.limit || 10;
            const project = args?.project;
            const includeSummary = args?.include_summary !== false;

            const universalResult = await this.universalEngine.getRecentSessions(limit, project);
            const formattedResult = this.formatter.formatRecentSessions(universalResult.results, project);
            
            const lines = formattedResult.split('\n');
            const sourceInfo = universalResult.enhanced 
              ? 'Searching: Claude Code + Desktop'
              : 'Searching: Claude Code';
            const actionInfo = `Action: Recent session analysis` + (project ? ` | Project: ${project}` : '') + (includeSummary ? ' | With summaries' : '');
            
            lines[0] = sourceInfo;
            lines[1] = actionInfo;

            return {
              content: [
                {
                  type: 'text',
                  text: lines.join('\n'),
                },
              ],
            };
          }

          case 'extract_compact_summary': {
            const sessionId = args?.session_id;
            const maxMessages = args?.max_messages || 10;
            const focus = args?.focus || 'all';

            const universalResult = await this.universalEngine.generateCompactSummary(sessionId, maxMessages, focus);
            
            const sourceInfo = universalResult.enhanced 
              ? 'Searching: Claude Code + Desktop'
              : 'Searching: Claude Code';
            const actionInfo = `Session: "${sessionId}" | Action: Compact summary | Focus: ${focus}`;
            const summaryContent = universalResult.results.summary;
            
            const formattedResult = `${sourceInfo}\n${actionInfo}\n\n${summaryContent}`;

            return {
              content: [
                {
                  type: 'text',
                  text: formattedResult,
                },
              ],
            };
          }

          case 'find_tool_patterns': {
            const universalResult = await this.universalEngine.getToolPatterns(
              args?.tool_name,
              args?.limit || 12
            );

            const patternType = args?.pattern_type || 'tools';
            const formattedResult = this.formatter.formatToolPatterns(universalResult.results, args?.tool_name, patternType);
            
            const lines = formattedResult.split('\n');
            const sourceInfo = universalResult.enhanced 
              ? 'Searching: Claude Code + Desktop'
              : 'Searching: Claude Code';
            const actionInfo = `Tool: "${args?.tool_name || 'all'}" | Action: Pattern analysis | Type: ${patternType}`;
            
            lines[0] = sourceInfo;
            lines[1] = actionInfo;

            return {
              content: [
                {
                  type: 'text',
                  text: lines.join('\n'),
                },
              ],
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error('DXT Tool execution error:', error);
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
    console.error('Claude Historian DXT server running on stdio');
    
    // DXT-specific: Let Node.js event loop keep process alive naturally
    // DO NOT use infinite promise - it blocks Claude Desktop transport
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.error('DXT server received SIGINT, shutting down gracefully...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.error('DXT server received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });
    
    // Add error handlers for debugging
    process.on('uncaughtException', (error) => {
      console.error('DXT server uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('DXT server unhandled rejection:', reason);
      process.exit(1);
    });
  }
}

// Start the DXT server
const server = new ClaudeHistorianDXTServer();
server.run().catch(console.error);