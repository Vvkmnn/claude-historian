// Cool robot face formatter for Claude Historian MCP
import { CompactMessage, SearchResult, FileContext, ErrorSolution, ToolPattern } from './types.js';

// Robot faces for each MCP tool operation
const robots = {
  search: '[⌐■_■]', // search_conversations
  similar: '[⌐◆_◆]', // find_similar_queries
  fileContext: '[⌐□_□]', // find_file_context
  errorSolutions: '[⌐×_×]', // get_error_solutions
  toolPatterns: '[⌐⎚_⎚]', // find_tool_patterns
  sessions: '[⌐○_○]', // list_recent_sessions
  summary: '[⌐◉_◉]', // extract_compact_summary
};

// Clean, simple robot face formatter - no complex Unicode needed

export class BeautifulFormatter {
  constructor() {
    // Robot face formatter for MCP tool operations
  }

  private formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();

      const minutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (minutes < 1) return 'just now';
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;

      return date.toLocaleDateString();
    } catch {
      return timestamp;
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  // MCP Tool Operation Formatters with Cool Robot Faces

  formatSearchConversations(result: SearchResult): string {
    let output = `${robots.search} Searching conversations for: "${result.searchQuery}"\n\n`;

    if (result.messages.length === 0) {
      output += 'No messages found matching your query.\n';
      return output;
    }

    output += `Found ${result.totalResults} messages (showing top ${result.messages.length}):\n\n`;

    result.messages.forEach((message, index) => {
      const timestamp = this.formatTimestamp(message.timestamp);
      const content = this.truncateText(message.content, 80);
      const messageType = message.type.toUpperCase();

      output += `${index + 1}. ${messageType} ${timestamp} - "${content}"\n`;

      if (message.projectPath && message.projectPath !== 'unknown') {
        const projectName = message.projectPath.split('/').pop() || 'unknown';
        output += `   Project: ${projectName}\n`;
      }

      if (message.context?.filesReferenced?.length) {
        output += `   Files: ${message.context.filesReferenced.slice(0, 2).join(', ')}\n`;
      }

      output += '\n';
    });

    return output.trim();
  }

  formatSimilarQueries(queries: CompactMessage[], originalQuery: string): string {
    let output = `${robots.similar} Finding similar queries to: "${originalQuery}"\n\n`;

    if (queries.length === 0) {
      output += 'No similar queries found.\n';
      return output;
    }

    output += `Found ${queries.length} similar past questions:\n\n`;

    queries.forEach((query, index) => {
      const timestamp = this.formatTimestamp(query.timestamp);
      const content = this.truncateText(query.content, 80);
      const score = query.relevanceScore ? ` (${query.relevanceScore.toFixed(1)})` : '';

      output += `${index + 1}. USER ${timestamp}${score} - "${content}"\n`;

      if (query.projectPath && query.projectPath !== 'unknown') {
        const projectName = query.projectPath.split('/').pop() || 'unknown';
        output += `   Project: ${projectName}\n`;
      }

      output += '\n';
    });

    return output.trim();
  }

  formatFileContext(contexts: FileContext[], filepath: string): string {
    let output = `${robots.fileContext} Finding file context for: ${filepath}\n\n`;

    if (contexts.length === 0) {
      output += 'No file contexts found.\n';
      return output;
    }

    output += `Found ${contexts.length} conversations about this file:\n\n`;

    contexts.forEach((context, index) => {
      const timestamp = this.formatTimestamp(context.lastModified);
      const opType = context.operationType.toUpperCase();

      output += `${index + 1}. ${opType} discussed ${timestamp}\n`;

      if (context.relatedMessages.length > 0) {
        const firstMessage = context.relatedMessages[0];
        const content = this.truncateText(firstMessage.content, 60);
        output += `   "${content}"\n`;

        if (context.relatedMessages.length > 1) {
          output += `   (+ ${context.relatedMessages.length - 1} more messages)\n`;
        }
      }

      output += '\n';
    });

    return output.trim();
  }

  formatErrorSolutions(solutions: ErrorSolution[], errorPattern: string): string {
    let output = `${robots.errorSolutions} Getting error solutions for: "${errorPattern}"

`;

    if (solutions.length === 0) {
      output += 'No error solutions found.\n';
      return output;
    }

    output += `Found ${solutions.length} previous solutions:\n\n`;

    solutions.forEach((solution, index) => {
      output += `${index + 1}. "${solution.errorPattern}" - seen ${solution.frequency} times\n`;

      if (solution.solution.length > 0) {
        const firstSolution = solution.solution[0];
        const content = this.truncateText(firstSolution.content, 60);
        output += `   Solution: "${content}"\n`;
      }

      output += '\n';
    });

    return output.trim();
  }

  formatToolPatterns(patterns: ToolPattern[], toolName?: string): string {
    const toolFilter = toolName ? ` for "${toolName}"` : '';
    let output = `${robots.toolPatterns} Finding tool usage patterns${toolFilter}\n\n`;

    if (patterns.length === 0) {
      output += 'No tool patterns found.\n';
      return output;
    }

    output += `Found ${patterns.length} successful patterns:\n\n`;

    patterns.forEach((pattern, index) => {
      output += `${index + 1}. ${pattern.toolName} Tool - ${pattern.successfulUsages.length} successful uses\n`;

      if (pattern.commonPatterns.length > 0) {
        const firstPattern = pattern.commonPatterns[0];
        output += `   Pattern: ${firstPattern}\n`;
      }

      if (pattern.bestPractices.length > 0) {
        const firstPractice = pattern.bestPractices[0];
        output += `   Best practice: ${firstPractice}\n`;
      }

      output += '\n';
    });

    return output.trim();
  }

  formatRecentSessions(sessions: any[]): string {
    let output = `${robots.sessions} Listing recent sessions\n\n`;

    if (sessions.length === 0) {
      output += 'No recent sessions found.\n';
      return output;
    }

    output += `Found ${sessions.length} recent sessions:\n\n`;

    sessions.forEach((session, index) => {
      const duration = session.duration_minutes ? `${session.duration_minutes}m` : '0m';
      const timestamp = this.formatTimestamp(session.end_time || session.start_time);
      const sessionId = session.session_id ? session.session_id.substring(0, 8) : 'unknown';

      output += `${index + 1}. ${sessionId} - ${duration} ago (${timestamp})\n`;
      output += `   ${session.message_count || 0} messages`;

      if (session.project_path) {
        const projectName = session.project_path.split('/').pop() || 'unknown';
        output += ` - Project: ${projectName}`;
      }

      output += '\n\n';
    });

    return output.trim();
  }

  formatCompactSummary(sessions: any[], sessionId?: string): string {
    let output = `${robots.summary} Extracting compact summary`;

    if (sessionId) {
      output += ` for session: ${sessionId}`;
    }

    output += '\n\n';

    if (sessions.length === 0) {
      output += 'No session information found.\n';
      return output;
    }

    const session = sessions[0];
    const timestamp = this.formatTimestamp(session.end_time || session.start_time);
    const duration = session.duration_minutes ? `${session.duration_minutes}m` : '0m';

    output += `Session: ${session.session_id ? session.session_id.substring(0, 8) : 'unknown'}\n`;
    output += `Duration: ${duration}\n`;
    output += `Messages: ${session.message_count || 0}\n`;
    output += `Last activity: ${timestamp}\n`;

    if (session.project_path) {
      const projectName = session.project_path.split('/').pop() || 'unknown';
      output += `Project: ${projectName}\n`;
    }

    output += '\nNote: Enhanced summarization coming in future updates';

    return output;
  }
}
