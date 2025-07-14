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

  private setupToolHandlers(): void {
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
          case 'search_conversations': {
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
          }

          case 'find_file_context': {
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
          }

          case 'find_similar_queries': {
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
          }

          case 'get_error_solutions': {
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
          }

          case 'list_recent_sessions': {
            // Enhanced session listing with smart activity detection
            const limit = (args?.limit as number) || 10;
            const smartSessions = await this.getSmartRecentSessions(limit);

            return {
              content: [
                {
                  type: 'text',
                  text: smartSessions,
                },
              ],
            };
          }

          case 'extract_compact_summary': {
            const sessionId = args?.session_id as string;
            const maxMessages = args?.max_messages as number || 10;
            
            // Generate intelligent summary from recent tool usage and outcomes
            const summary = await this.generateSmartSummary(sessionId, maxMessages);
            
            return {
              content: [
                {
                  type: 'text',
                  text: summary,
                },
              ],
            };
          }

          case 'find_tool_patterns': {
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
          }

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

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Claude Historian MCP server running on stdio');
  }
  private async generateSmartSummary(sessionId: string, maxMessages: number): Promise<string> {
    try {
      // Search for recent activity related to the session
      const recentActivity = await this.searchEngine.searchConversations(
        sessionId || 'recent tool usage outcomes', undefined, 'today', maxMessages
      );
      
      if (!recentActivity.messages.length) {
        return `[⌐◉_◉] No recent activity found for session: ${sessionId}`;
      }
      
      // Extract key information: tools used, files changed, outcomes
      const toolsUsed = new Set<string>();
      const filesReferenced = new Set<string>();
      const outcomes: string[] = [];
      
      recentActivity.messages.forEach(msg => {
        // Collect tools used
        msg.context?.toolsUsed?.forEach(tool => toolsUsed.add(tool));
        
        // Collect files referenced
        msg.context?.filesReferenced?.forEach(file => filesReferenced.add(file));
        
        // Extract key outcomes from assistant messages
        if (msg.type === 'assistant' && msg.content.length > 100) {
          const lines = msg.content.split('\n').filter(line => 
            line.includes('✅') || line.includes('Fixed') || line.includes('Created') || 
            line.includes('Updated') || line.includes('Completed')
          );
          outcomes.push(...lines.slice(0, 2)); // Max 2 outcomes per message
        }
      });
      
      // Generate compact summary
      let summary = `[⌐◉_◉] Smart Summary (${recentActivity.messages.length} messages)\n\n`;
      
      if (toolsUsed.size > 0) {
        summary += `**Tools Used:** ${Array.from(toolsUsed).slice(0, 5).join(', ')}\n`;
      }
      
      if (filesReferenced.size > 0) {
        summary += `**Files Modified:** ${Array.from(filesReferenced).slice(0, 3).join(', ')}\n`;
      }
      
      if (outcomes.length > 0) {
        summary += `**Key Outcomes:**\n${outcomes.slice(0, 3).map(o => `• ${o.replace(/[✅🔧]/g, '').trim()}`).join('\n')}\n`;
      }
      
      summary += `\n**Duration:** ${Math.round(recentActivity.executionTime)}ms | **Relevance:** High`;
      
      return summary;
    } catch (error) {
      return `[⌐◉_◉] Summary generation failed: ${error}`;
    }
  }

  private async getSmartRecentSessions(limit: number): Promise<string> {
    try {
      // Get recent activity instead of just session metadata
      const recentActivity = await this.searchEngine.searchConversations(
        'recent activity projects files tools', undefined, 'week', limit * 3
      );
      
      if (!recentActivity.messages.length) {
        return `[⌐○_○] No recent sessions found`;
      }
      
      // Group by project and extract session info
      const projectSessions = new Map<string, {
        lastActivity: string;
        messageCount: number;
        toolsUsed: Set<string>;
        filesModified: Set<string>;
      }>();
      
      recentActivity.messages.forEach(msg => {
        const project = msg.projectPath || 'unknown';
        if (!projectSessions.has(project)) {
          projectSessions.set(project, {
            lastActivity: msg.timestamp || 'unknown',
            messageCount: 0,
            toolsUsed: new Set(),
            filesModified: new Set()
          });
        }
        
        const session = projectSessions.get(project)!;
        session.messageCount++;
        msg.context?.toolsUsed?.forEach(tool => session.toolsUsed.add(tool));
        msg.context?.filesReferenced?.forEach(file => session.filesModified.add(file));
        
        // Update to most recent activity
        if (msg.timestamp && msg.timestamp > session.lastActivity) {
          session.lastActivity = msg.timestamp;
        }
      });
      
      // Format as smart session list
      let result = `[⌐○_○] Smart Sessions (${projectSessions.size} active projects)\n\n`;
      
      const sortedProjects = Array.from(projectSessions.entries())
        .sort(([,a], [,b]) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
        .slice(0, limit);
      
      sortedProjects.forEach(([project, session], index) => {
        const timeAgo = this.getTimeAgo(session.lastActivity);
        const toolsList = Array.from(session.toolsUsed).slice(0, 3).join(', ');
        const filesList = Array.from(session.filesModified).slice(0, 2).join(', ');
        
        result += `${index + 1}. **${project}** - ${timeAgo}\n`;
        result += `   ${session.messageCount} messages`;
        if (toolsList) result += ` | Tools: ${toolsList}`;
        if (filesList) result += ` | Files: ${filesList}`;
        result += `\n\n`;
      });
      
      return result;
    } catch (error) {
      return `[⌐○_○] Session listing failed: ${error}`;
    }
  }

  private getTimeAgo(timestamp: string): string {
    try {
      const now = new Date();
      const then = new Date(timestamp);
      const diffMs = now.getTime() - then.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);
      
      if (diffDays > 0) return `${diffDays}d ago`;
      if (diffHours > 0) return `${diffHours}h ago`;
      return 'Recent';
    } catch {
      return 'Unknown time';
    }
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