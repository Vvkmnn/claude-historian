import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';
import { ClaudeMessage, CompactMessage, ConversationSession } from './types.js';
import {
  getClaudeProjectsPath,
  decodeProjectPath,
  extractContentFromMessage,
  calculateRelevanceScore,
  formatTimestamp,
} from './utils.js';

export class ConversationParser {
  private sessions: Map<string, ConversationSession> = new Map();

  async parseJsonlFile(
    projectDir: string,
    filename: string,
    query?: string,
    timeFilter?: (timestamp: string) => boolean
  ): Promise<CompactMessage[]> {
    const messages: CompactMessage[] = [];
    const filePath = join(getClaudeProjectsPath(), projectDir, filename);

    try {
      const fileStream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const claudeMessage: ClaudeMessage = JSON.parse(line);

          // Apply time filter if provided
          if (timeFilter && !timeFilter(claudeMessage.timestamp)) {
            continue;
          }

          const content = extractContentFromMessage(claudeMessage.message || {});
          if (!content) continue;

          const compactMessage: CompactMessage = {
            uuid: claudeMessage.uuid,
            timestamp: formatTimestamp(claudeMessage.timestamp),
            type: claudeMessage.type,
            content: content.substring(0, 1000), // Limit content length
            sessionId: claudeMessage.sessionId,
            projectPath: decodeProjectPath(projectDir),
            relevanceScore: query ? calculateRelevanceScore(claudeMessage, query, projectDir) : 0,
            context: this.extractContext(claudeMessage, content),
          };

          messages.push(compactMessage);

          // Track session info
          this.updateSessionInfo(claudeMessage, projectDir);
        } catch (parseError) {
          // Gracefully handle corrupted JSONL lines
          console.warn(`Skipping malformed line in ${filename}:`, parseError);
          continue;
        }
      }
    } catch (error) {
      console.error(`Error reading file ${filename}:`, error);
    }

    return messages;
  }

  private extractContext(message: ClaudeMessage, content: string): CompactMessage['context'] {
    const context: CompactMessage['context'] = {};

    // Extract file references
    const filePatterns = [
      /[\w\-/\\.]+\.(ts|js|json|md|py|java|cpp|c|h|css|html|yml|yaml|toml|rs|go)(?:\b|$)/gi,
      /src\/[\w\-/\\.]+/gi,
      /\.\/[\w\-/\\.]+/gi,
    ];

    const files = new Set<string>();
    filePatterns.forEach((pattern) => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach((match) => files.add(match));
      }
    });

    if (files.size > 0) {
      context.filesReferenced = Array.from(files);
    }

    // Extract tool usage from multiple sources
    const tools = new Set<string>();

    // Method 1: Direct tool_use content extraction from message structure
    if (message.message?.content) {
      const toolContent = Array.isArray(message.message.content)
        ? message.message.content
        : [message.message.content];

      toolContent
        .filter((item) => item && item.type === 'tool_use' && item.name)
        .map((item) => item.name)
        .filter(Boolean)
        .forEach((tool) => {
          // Clean up tool names (remove mcp__ prefixes, extract core name)
          const cleanName = tool.replace(/^mcp__.*?__/, '').replace(/[_-]/g, '');
          if (cleanName) tools.add(cleanName);
        });
    }

    // Method 2: Extract from assistant type messages with tool_use content
    if (message.type === 'assistant' && message.message?.content) {
      const toolContent = Array.isArray(message.message.content)
        ? message.message.content
        : [message.message.content];

      toolContent
        .filter((item) => item && item.type === 'tool_use' && item.name)
        .forEach((item) => {
          const cleanName = item.name.replace(/^mcp__.*?__/, '').replace(/[_-]/g, '');
          if (cleanName) tools.add(cleanName);
        });
    }

    // Method 3: Look for tool usage patterns in content text
    const toolPatterns = [
      /\[Tool:\s*(\w+)\]/gi, // Matches [Tool: Read], [Tool: Edit], etc.
      /Called the (\w+) tool/gi, // Matches "Called the Read tool"
      /\bmcp__[\w-]+__([\w-]+)/gi, // MCP tool calls
      /Result of calling the (\w+) tool/gi, // Tool results
      /tool_use.*?"name":\s*"([^"]+)"/gi, // JSON tool_use name extraction
    ];

    toolPatterns.forEach((pattern) => {
      // Reset the regex to ensure we start from the beginning
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1]) {
          // Extract the captured group (tool name)
          const cleanName = match[1].replace(/^mcp__.*?__/, '').replace(/[_-]/g, '');
          if (cleanName) tools.add(cleanName);
        }
        // Prevent infinite loop on zero-length matches
        if (match.index === pattern.lastIndex) {
          pattern.lastIndex++;
        }
      }
    });

    if (tools.size > 0) {
      context.toolsUsed = Array.from(tools);
    }

    // Extract error patterns
    const errorPatterns = [
      /error[:\s]+([^\n]+)/gi,
      /failed[:\s]+([^\n]+)/gi,
      /exception[:\s]+([^\n]+)/gi,
      /cannot[:\s]+([^\n]+)/gi,
      /unable to[:\s]+([^\n]+)/gi,
    ];

    const errors = new Set<string>();
    errorPatterns.forEach((pattern) => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach((match) => errors.add(match.substring(0, 100)));
      }
    });

    if (errors.size > 0) {
      context.errorPatterns = Array.from(errors);
    }

    return Object.keys(context).length > 0 ? context : undefined;
  }

  private updateSessionInfo(message: ClaudeMessage, projectDir: string): void {
    const sessionId = message.sessionId;

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        projectPath: decodeProjectPath(projectDir),
        startTime: this.isValidTimestamp(message.timestamp)
          ? message.timestamp
          : new Date().toISOString(),
        endTime: this.isValidTimestamp(message.timestamp)
          ? message.timestamp
          : new Date().toISOString(),
        messageCount: 0,
      });
    }

    const session = this.sessions.get(sessionId)!;
    session.endTime = this.isValidTimestamp(message.timestamp)
      ? message.timestamp
      : session.endTime;
    session.messageCount++;

    // Update start time if this message is earlier (with timestamp validation)
    if (this.isValidTimestamp(message.timestamp) && this.isValidTimestamp(session.startTime)) {
      if (new Date(message.timestamp) < new Date(session.startTime)) {
        session.startTime = message.timestamp;
      }
    }
  }

  getSession(sessionId: string): ConversationSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): ConversationSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
    );
  }

  private isValidTimestamp(timestamp: string): boolean {
    if (!timestamp || typeof timestamp !== 'string') return false;
    const date = new Date(timestamp);
    return !isNaN(date.getTime()) && date.getFullYear() > 2020;
  }
}
