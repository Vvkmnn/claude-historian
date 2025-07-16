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
            content: this.smartContentPreservation(content, 3000), // Smart content extraction with more space
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

    // Extract file references - ENHANCED for comprehensive detection like GLOBAL
    const filePatterns = [
      // Standard file extensions - much more comprehensive 
      /[\w\-/\\.]+\.(ts|tsx|js|jsx|json|md|py|java|cpp|c|h|css|html|yml|yaml|toml|rs|go|txt|log|env|config|gitignore|lock|sql|sh|bat|php|rb|swift|kt|scala|fs|clj|ex|elm|vue|svelte|astro)(?:\b|$)/gi,
      // File paths in git status output
      /(?:modified|added|deleted|new file|renamed):\s+([^\n\r\t]+)/gi,
      // File paths with common prefixes
      /(?:src\/|\.\/|\.\.\/|~\/|\/)[^\s]+\.(ts|tsx|js|jsx|json|md|py|java|cpp|c|h|css|html|yml|yaml|toml|rs|go|txt|log|env|config|gitignore|lock|sql|sh|bat|php|rb|swift|kt|scala|fs|clj|ex|elm|vue|svelte|astro)/gi,
      // Standalone common files like CLAUDE.md, README.md, package.json
      /\b(CLAUDE\.md|README\.md|package\.json|tsconfig\.json|next\.config\.js|tailwind\.config\.js|vite\.config\.js|webpack\.config\.js|babel\.config\.js|eslint\.config\.js|prettier\.config\.js|\.env|\.gitignore|Dockerfile|docker-compose\.yml)\b/gi,
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

    // Extract Claude's valuable insights - solutions, explanations, actions
    if (message.type === 'assistant') {
      const insights = this.extractClaudeInsights(content);
      if (insights.length > 0) {
        context.claudeInsights = insights;
      }
    }

    // Extract code snippets and technical solutions
    const codeSnippets = this.extractCodeSnippets(content);
    if (codeSnippets.length > 0) {
      context.codeSnippets = codeSnippets;
    }

    // Extract action items and next steps
    const actionItems = this.extractActionItems(content);
    if (actionItems.length > 0) {
      context.actionItems = actionItems;
    }

    return Object.keys(context).length > 0 ? context : undefined;
  }

  public smartContentPreservation(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;

    // First, extract the most valuable sentences/paragraphs
    const valuableContent = this.extractMostValuableContent(content, maxLength);
    if (valuableContent.length <= maxLength) {
      return valuableContent;
    }

    // Detect content type and apply appropriate strategy
    const contentType = this.detectContentType(content);
    
    switch (contentType) {
      case 'code':
        return this.preserveCodeBlocks(content, maxLength);
      case 'error':
        return this.preserveErrorMessages(content, maxLength);
      case 'technical':
        return this.preserveTechnicalContent(content, maxLength);
      default:
        return this.intelligentTruncation(content, maxLength);
    }
  }

  private detectContentType(content: string): 'code' | 'error' | 'technical' | 'conversational' {
    // Code block detection
    if (content.includes('```') || content.includes('function ') || content.includes('const ') || 
        content.includes('import ') || content.includes('export ') || content.match(/\{\s*\n.*\}\s*$/s)) {
      return 'code';
    }
    
    // Error message detection
    if (content.match(/(error|exception|failed|cannot|unable to|stack trace)/i) && 
        content.match(/at \w+|line \d+|:\d+:\d+/)) {
      return 'error';
    }
    
    // Technical content detection
    if (content.match(/\.(ts|js|json|md|py|java|cpp|rs|go|yml|yaml)\b/) ||
        content.includes('src/') || content.includes('./') || 
        content.match(/\w+:\d+/) || content.includes('tool_use')) {
      return 'technical';
    }
    
    return 'conversational';
  }

  private preserveCodeBlocks(content: string, maxLength: number): string {
    // Try to preserve complete code blocks
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks = content.match(codeBlockRegex) || [];
    
    if (codeBlocks.length > 0) {
      let preserved = '';
      let remainingLength = maxLength;
      
      for (const block of codeBlocks) {
        if (block.length <= remainingLength) {
          preserved += block + '\n';
          remainingLength -= block.length + 1;
        } else {
          // If we can't fit the whole block, include context and truncate
          const contextBefore = content.substring(0, content.indexOf(block)).slice(-100);
          preserved += contextBefore + block.substring(0, remainingLength - contextBefore.length - 3) + '...';
          break;
        }
      }
      return preserved.trim();
    }
    
    // No code blocks, preserve function definitions and imports
    return this.preserveTechnicalContent(content, maxLength);
  }

  private preserveErrorMessages(content: string, maxLength: number): string {
    // Preserve error messages and stack traces completely
    const errorRegex = /(error|exception|failed)[\s\S]*?(\n\n|\n(?=[A-Z])|$)/gi;
    const errors = content.match(errorRegex) || [];
    
    if (errors.length > 0) {
      const mainError = errors[0];
      if (mainError && mainError.length <= maxLength) {
        return mainError + (errors.length > 1 ? '\n... (additional errors truncated)' : '');
      }
    }
    
    // If error is too long, preserve the beginning and any stack trace
    const stackTrace = content.match(/at [\s\S]*$/);
    if (stackTrace) {
      const errorPart = content.substring(0, maxLength - stackTrace[0].length - 10);
      return errorPart + '\n...\n' + stackTrace[0];
    }
    
    return this.intelligentTruncation(content, maxLength);
  }

  private preserveTechnicalContent(content: string, maxLength: number): string {
    // Extract and preserve key technical elements
    const technicalElements = [];
    
    // File paths and line numbers
    const filePaths = content.match(/[\w\-/\\.]+\.(ts|js|json|md|py|java|cpp|rs|go|yml|yaml)(?::\d+)?/g) || [];
    technicalElements.push(...filePaths);
    
    // Function definitions
    const functions = content.match(/(function \w+|const \w+ =|export \w+|class \w+)/g) || [];
    technicalElements.push(...functions);
    
    // Tool usage
    const tools = content.match(/tool_use.*?"name":\s*"([^"]+)"/g) || [];
    technicalElements.push(...tools);
    
    // Commands
    const commands = content.match(/`[^`]+`/g) || [];
    technicalElements.push(...commands);
    
    if (technicalElements.length > 0) {
      const preserved = technicalElements.join(' | ');
      if (preserved.length <= maxLength) {
        // Add some context around the technical elements
        const contextLength = maxLength - preserved.length - 20;
        const context = content.substring(0, contextLength);
        return context + '\n--- Key elements: ' + preserved;
      }
    }
    
    return this.intelligentTruncation(content, maxLength);
  }

  private intelligentTruncation(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    
    // Try to truncate at natural boundaries
    const boundaries = ['\n\n', '. ', '! ', '? ', '\n', ', ', ' '];
    
    for (const boundary of boundaries) {
      const lastBoundary = content.lastIndexOf(boundary, maxLength - 3);
      if (lastBoundary > maxLength * 0.7) { // Don't truncate too early
        return content.substring(0, lastBoundary) + '...';
      }
    }
    
    // Fallback to character limit with ellipsis
    return content.substring(0, maxLength - 3) + '...';
  }

  // Extract Claude's most valuable insights from assistant messages
  private extractClaudeInsights(content: string): string[] {
    const insights: string[] = [];
    
    // Solution patterns - capture Claude's solutions
    const solutionPatterns = [
      /(?:solution|fix|resolve|answer)[:\s]*([^\n.]{20,200})/gi,
      /(?:here's how|to fix this|you can)[:\s]*([^\n.]{20,200})/gi,
      /(?:the issue is|problem is|cause is)[:\s]*([^\n.]{20,200})/gi,
      /(?:✅|✓|fixed|solved|resolved)[:\s]*([^\n.]{15,150})/gi
    ];

    solutionPatterns.forEach(pattern => {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1] && match[1].trim().length > 15) {
          insights.push(`Solution: ${match[1].trim()}`);
        }
      }
    });

    // Explanation patterns - capture Claude's explanations
    const explanationPatterns = [
      /(?:this means|this is because|the reason)[:\s]*([^\n.]{25,250})/gi,
      /(?:explanation|basically|in other words)[:\s]*([^\n.]{25,200})/gi
    ];

    explanationPatterns.forEach(pattern => {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1] && match[1].trim().length > 20) {
          insights.push(`Explanation: ${match[1].trim()}`);
        }
      }
    });

    return insights.slice(0, 3); // Top 3 most valuable insights
  }

  // Extract code snippets with context
  private extractCodeSnippets(content: string): string[] {
    const snippets: string[] = [];
    
    // Extract code blocks
    const codeBlockRegex = /```[\w]*\n([\s\S]*?)\n```/g;
    let match: RegExpExecArray | null;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match[1] && match[1].trim().length > 10) {
        const snippet = match[1].trim();
        snippets.push(snippet.length > 100 ? snippet.substring(0, 100) + '...' : snippet);
      }
    }

    // Extract inline code with context
    const inlineCodeRegex = /`([^`]{10,80})`/g;
    let inlineMatch: RegExpExecArray | null;
    while ((inlineMatch = inlineCodeRegex.exec(content)) !== null) {
      if (inlineMatch?.[1] && !snippets.some(s => s.includes(inlineMatch![1]))) {
        snippets.push(inlineMatch[1]);
      }
    }

    return snippets.slice(0, 3); // Top 3 code snippets
  }

  // Extract actionable items and next steps
  private extractActionItems(content: string): string[] {
    const actions: string[] = [];
    
    // Action patterns
    const actionPatterns = [
      /(?:next step|now|then|first|finally|to do)[:\s]*([^\n.]{15,150})/gi,
      /(?:run|execute|install|update|create|add|remove)[:\s]*([^\n.]{10,100})/gi,
      /(?:you should|you need to|you can)[:\s]*([^\n.]{15,150})/gi,
      /\d+\.\s+([^\n.]{15,150})/g, // Numbered lists
      /[-*]\s+([^\n.]{15,150})/g   // Bullet points
    ];

    actionPatterns.forEach(pattern => {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1] && match[1].trim().length > 10) {
          const action = match[1].trim();
          if (!actions.some(a => a.includes(action.substring(0, 20)))) {
            actions.push(action);
          }
        }
      }
    });

    return actions.slice(0, 4); // Top 4 action items
  }

  // Extract the most valuable content by prioritizing sentences with high information density
  private extractMostValuableContent(content: string, maxLength: number): string {
    // For structured content (code, errors), preserve original order and structure
    if (this.hasStructuredContent(content)) {
      return this.preserveStructuredContent(content, maxLength);
    }
    
    // For conversational content, use sentence-based extraction
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    // Score sentences based on value indicators
    const scoredSentences = sentences.map(sentence => {
      let score = 0;
      
      // High value keywords
      const highValueTerms = [
        'solution', 'fix', 'error', 'problem', 'resolved', 'working', 'success',
        'function', 'class', 'import', 'export', 'const', 'let', 'var',
        'install', 'update', 'create', 'build', 'test', 'deploy',
        'file', 'path', 'directory', 'config', 'settings'
      ];
      
      const lowerSentence = sentence.toLowerCase();
      highValueTerms.forEach(term => {
        if (lowerSentence.includes(term)) score += 2;
      });
      
      // Boost sentences with code or technical references
      if (sentence.includes('`') || sentence.includes('/') || sentence.includes('.ts') || sentence.includes('.js')) {
        score += 3;
      }
      
      // Boost sentences that explain outcomes or provide answers
      if (lowerSentence.includes('now') || lowerSentence.includes('result') || lowerSentence.includes('this will')) {
        score += 2;
      }
      
      // Penalize very short or generic sentences
      if (sentence.length < 40) score -= 1;
      if (lowerSentence.includes('this session is being continued') || lowerSentence.includes('caveat:') ||
          lowerSentence.includes('command-name>') || lowerSentence.includes('generated by the user while running') ||
          lowerSentence.includes('local-command-stdout') || lowerSentence.includes('analysis:') ||
          lowerSentence.includes('command-message>') || lowerSentence.includes('system-reminder') ||
          content.length < 50) {
        score -= 50; // Aggressively eliminate noise and short content
      }
      
      return { sentence: sentence.trim(), score };
    });
    
    // Sort by score and build result
    const sortedSentences = scoredSentences
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);
    
    let result = '';
    for (const { sentence } of sortedSentences) {
      if (result.length + sentence.length + 2 <= maxLength) {
        result += sentence + '. ';
      } else {
        break;
      }
    }
    
    return result.trim() || content.substring(0, maxLength - 3) + '...';
  }

  private hasStructuredContent(content: string): boolean {
    return content.includes('function ') || 
           content.includes('Error:') || 
           content.includes('Exception:') ||
           content.includes('```') ||
           content.match(/at \w+.*:\d+:\d+/) !== null ||
           content.includes('Solution:') ||
           content.includes('TypeError:');
  }

  private preserveStructuredContent(content: string, maxLength: number): string {
    // For structured content, preserve the first occurrence of each key section
    const sections = [];
    
    // Extract function definitions
    const functionMatch = content.match(/function\s+\w+[^}]*\}/);
    if (functionMatch) {
      sections.push({ content: functionMatch[0], priority: 3, type: 'function' });
    }
    
    // Extract error messages
    const errorMatch = content.match(/(Error|Exception|TypeError):[^\n]*(\n[^\n]*)*?(?=\n\n|\n[A-Z]|$)/);
    if (errorMatch) {
      sections.push({ content: errorMatch[0], priority: 3, type: 'error' });
    }
    
    // Extract solutions
    const solutionMatch = content.match(/Solution:[^\n]*(\n[^\n]*)*?(?=\n\n|\n[A-Z]|$)/);
    if (solutionMatch) {
      sections.push({ content: solutionMatch[0], priority: 2, type: 'solution' });
    }
    
    // Sort by priority and fit within limit
    sections.sort((a, b) => b.priority - a.priority);
    
    let result = '';
    for (const section of sections) {
      if (result.length + section.content.length + 2 <= maxLength) {
        result += section.content + '\n\n';
      } else {
        // Try to fit a truncated version
        const remaining = maxLength - result.length - 5;
        if (remaining > 50) {
          result += section.content.substring(0, remaining) + '...';
        }
        break;
      }
    }
    
    return result.trim();
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
