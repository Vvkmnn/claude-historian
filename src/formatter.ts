// Cool robot face formatter for Claude Historian MCP
import { CompactMessage, SearchResult, FileContext, ErrorSolution, ToolPattern } from './types.js';

// Robot faces for each MCP tool operation - these are the signature of Claude Historian!
const robots = {
  search: '[⌐■_■]', // search_conversations
  similar: '[⌐◆_◆]', // find_similar_queries
  fileContext: '[⌐□_□]', // find_file_context
  errorSolutions: '[⌐×_×]', // get_error_solutions
  toolPatterns: '[⌐⎚_⎚]', // find_tool_patterns
  sessions: '[⌐○_○]', // list_recent_sessions
  summary: '[⌐◉_◉]', // extract_compact_summary
};

export class BeautifulFormatter {
  constructor() {
    // Robot face formatter with maximum information density
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
    return this.smartTruncation(text, maxLength);
  }

  private smartTruncation(text: string, maxLength: number): string {
    // Dynamic sizing based on content type
    const contentType = this.detectContentType(text);
    
    switch (contentType) {
      case 'code':
        return this.preserveCodeInSummary(text, maxLength);
      case 'error':
        return this.preserveErrorInSummary(text, maxLength);
      case 'technical':
        return this.preserveTechnicalInSummary(text, maxLength);
      default:
        return this.intelligentTextTruncation(text, maxLength);
    }
  }

  private detectContentType(text: string): 'code' | 'error' | 'technical' | 'conversational' {
    // Code detection
    if (text.includes('```') || text.includes('function ') || text.includes('const ') || 
        text.includes('import ') || text.includes('export ')) {
      return 'code';
    }
    
    // Error detection
    if (text.match(/(error|exception|failed|cannot|unable to)/i)) {
      return 'error';
    }
    
    // Technical content detection
    if (text.match(/\.(ts|js|json|md|py|java|cpp|rs|go|yml|yaml)\b/) ||
        text.includes('src/') || text.includes('./') || text.includes('tool_use')) {
      return 'technical';
    }
    
    return 'conversational';
  }

  private preserveCodeInSummary(text: string, maxLength: number): string {
    // Extract function names, key identifiers
    const codeElements = text.match(/(function \w+|const \w+|class \w+|export \w+)/g) || [];
    if (codeElements.length > 0) {
      const summary = codeElements.slice(0, 3).join(', ');
      if (summary.length < maxLength) {
        return summary + (codeElements.length > 3 ? '...' : '');
      }
    }
    return this.intelligentTextTruncation(text, maxLength);
  }

  private preserveErrorInSummary(text: string, maxLength: number): string {
    // Keep error type and key details
    const errorMatch = text.match(/(error|exception|failed)[\s\S]*?(\n|$)/i);
    if (errorMatch && errorMatch[0].length <= maxLength) {
      return errorMatch[0].trim();
    }
    
    // Extract error type at least
    const errorType = text.match(/(TypeError|ReferenceError|SyntaxError|Error):/);
    if (errorType && errorType.index !== undefined) {
      const remaining = maxLength - errorType[0].length - 3;
      const context = text.substring(errorType.index + errorType[0].length, errorType.index + errorType[0].length + remaining);
      return errorType[0] + ' ' + context + '...';
    }
    
    return this.intelligentTextTruncation(text, maxLength);
  }

  private preserveTechnicalInSummary(text: string, maxLength: number): string {
    // Extract file references and key technical terms
    const fileRefs = text.match(/[\w\-/\\.]+\.(ts|js|json|md|py|java|cpp|rs|go|yml|yaml)/g) || [];
    const toolRefs = text.match(/tool_use.*?"name":\s*"([^"]+)"/g) || [];
    
    const keyElements = [...fileRefs.slice(0, 2), ...toolRefs.slice(0, 1)];
    if (keyElements.length > 0) {
      const summary = keyElements.join(' | ');
      if (summary.length <= maxLength) {
        return summary;
      }
    }
    
    return this.intelligentTextTruncation(text, maxLength);
  }

  private intelligentTextTruncation(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    
    // Try to truncate at sentence boundaries
    const sentences = text.split(/[.!?]+/);
    let result = '';
    
    for (const sentence of sentences) {
      if (result.length + sentence.length + 1 <= maxLength - 3) {
        result += sentence + '.';
      } else {
        break;
      }
    }
    
    if (result.length > 0) {
      return result + '..';
    }
    
    // Fallback to word boundaries
    const words = text.split(' ');
    result = '';
    for (const word of words) {
      if (result.length + word.length + 1 <= maxLength - 3) {
        result += word + ' ';
      } else {
        break;
      }
    }
    
    return result.trim() + '...';
  }

  private extractHighValueContent(text: string): string {
    // REVOLUTIONARY: Maximum information density extraction for Claude Code
    const contentType = this.detectContentType(text);
    
    if (contentType === 'code' || contentType === 'error' || contentType === 'technical') {
      // Extract core technical elements while preserving completeness
      return this.extractTechnicalEssence(text);
    }
    
    // For conversational: extract only actionable intelligence
    return this.extractActionableIntelligence(text);
  }

  private extractTechnicalEssence(text: string): string {
    // Extract function signatures, file paths, error messages, key variables
    const technical = [];
    
    // Function/class/interface declarations
    const declarations = text.match(/(function|class|interface|const|let|var)\s+\w+[^{;]*[{;]/g);
    if (declarations) technical.push(...declarations.slice(0, 2));
    
    // File paths and imports
    const paths = text.match(/[\w\-./]+\.(ts|js|json|md|py|java|cpp|rs|go|yml|yaml|tsx|jsx)/g);
    if (paths) technical.push(...[...new Set(paths)].slice(0, 3));
    
    // Error messages (preserve completely)
    const errors = text.match(/(Error|Exception|Failed|Cannot|Unable)[\s\S]*?(?=\n|$)/gi);
    if (errors) technical.push(...errors.slice(0, 1));
    
    // Key technical terms
    const keyTerms = text.match(/(npm|git|build|deploy|test|fix|update|install|configure)\s+[\w-]+/gi);
    if (keyTerms) technical.push(...[...new Set(keyTerms)].slice(0, 2));
    
    if (technical.length > 0) {
      return technical.join(' | ');
    }
    
    // Fallback: preserve complete technical content
    return text.length > 500 ? text.substring(0, 500) + '...' : text;
  }

  private extractActionableIntelligence(text: string): string {
    // Extract only decisions, solutions, and actions - eliminate noise
    const intelligence = [];
    
    // Solutions and fixes
    const solutions = text.match(/(fixed|resolved|solution|approach):\s*([^.!?\n]+)/gi);
    if (solutions) intelligence.push(...solutions.slice(0, 2));
    
    // Concrete actions
    const actions = text.match(/(will|should|need to|going to|implemented|added|updated)\s+([^.!?\n]+)/gi);
    if (actions) intelligence.push(...actions.slice(0, 2));
    
    // Key outcomes
    const outcomes = text.match(/(success|completed|working|deployed|built|tested)[\s\S]*?(?=[.!?\n]|$)/gi);
    if (outcomes) intelligence.push(...outcomes.slice(0, 1));
    
    if (intelligence.length > 0) {
      return intelligence.join('; ');
    }
    
    // Last resort: extract first meaningful sentence
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    return sentences[0]?.trim() + (sentences.length > 1 ? '...' : '') || text.substring(0, 100) + '...';
  }

  public getDynamicDisplayLength(content: string): number {
    const contentType = this.detectContentType(content);
    
    switch (contentType) {
      case 'code':
        return 600; // Increased for complete code context
      case 'error': 
        return 700; // Increased for full error context
      case 'technical':
        return 500; // Increased for complete technical context
      default:
        return 400; // Increased for better conversational context
    }
  }

  // MCP Tool Operation Formatters

  formatSearchConversations(result: SearchResult, _detailLevel: string = 'summary'): string {
    let output = `Search: "${result.searchQuery}"\n\n`;
    
    if (result.messages.length === 0) {
      return output + 'No messages found matching your query.\n';
    }

    // REVOLUTIONARY: Smart deduplication and relevance ranking
    const rankedMessages = this.rankAndDeduplicateMessages(result.messages);
    const topMessages = rankedMessages.slice(0, Math.min(result.messages.length, 8)); // Cap for token efficiency

    output += `Found ${result.totalResults} messages, showing ${topMessages.length} highest-value:\n\n`;

    topMessages.forEach((message, index) => {
      const timestamp = this.formatTimestamp(message.timestamp);
      const messageType = message.type.toUpperCase();
      const content = this.extractHighValueContent(message.content);

      output += `${index + 1}. ${messageType} ${timestamp}\n`;
      output += `   ${content}\n`;

      // Intelligent context aggregation
      const context = this.aggregateContext(message);
      if (context) {
        output += `   ${context}\n`;
      }

      output += '\n';
    });

    return output.trim();
  }

  private rankAndDeduplicateMessages(messages: any[]): any[] {
    // Score messages by information density and uniqueness
    const scored = messages.map(msg => {
      let score = 0;
      const content = msg.content.toLowerCase();
      
      // Higher score for technical content
      if (this.detectContentType(msg.content) === 'technical') score += 50;
      if (this.detectContentType(msg.content) === 'code') score += 60;
      if (this.detectContentType(msg.content) === 'error') score += 70;
      
      // Boost for actionable content
      if (/(fix|solution|implement|deploy|build)/i.test(content)) score += 30;
      if (/(error|fail|issue|problem)/i.test(content)) score += 25;
      if (/(success|complete|working|done)/i.test(content)) score += 20;
      
      // Penalize generic content
      if (/(hello|thanks|okay|sure|yes|no)$/.test(content.trim())) score -= 20;
      
      // Boost for file references
      if (msg.context?.filesReferenced?.length) score += msg.context.filesReferenced.length * 10;
      
      // Boost for tool usage
      if (msg.context?.toolsUsed?.length) score += msg.context.toolsUsed.length * 5;
      
      return { ...msg, score };
    });

    // Deduplicate similar content
    const deduplicated: any[] = [];
    for (const msg of scored) {
      const isDuplicate = deduplicated.some(existing => 
        this.calculateSimilarity(msg.content, existing.content) > 0.8
      );
      if (!isDuplicate) {
        deduplicated.push(msg);
      }
    }

    // Sort by score descending
    return deduplicated.sort((a, b) => b.score - a.score);
  }

  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
  }

  private aggregateContext(message: any): string {
    const contexts = [];
    
    if (message.projectPath && message.projectPath !== 'unknown') {
      const projectName = message.projectPath.split('/').pop() || 'unknown';
      contexts.push(`Project: ${projectName}`);
    }

    if (message.context?.filesReferenced?.length) {
      const files = [...new Set(message.context.filesReferenced)].slice(0, 3);
      contexts.push(`Files: ${files.join(', ')}`);
    }

    if (message.context?.toolsUsed?.length) {
      const tools = [...new Set(message.context.toolsUsed)].slice(0, 3);
      contexts.push(`Tools: ${tools.join(' → ')}`);
    }

    if (message.context?.errorPatterns?.length) {
      contexts.push(`Error: ${message.context.errorPatterns[0]}`);
    }

    return contexts.join(' | ');
  }

  formatSimilarQueries(queries: CompactMessage[], originalQuery: string, _detailLevel: string = 'summary'): string {
    if (queries.length === 0) {
      return 'No similar queries found.\n';
    }

    // Optimize for Claude's context consumption - raw useful data
    const clusteredQueries = this.clusterBySemantic(queries, originalQuery);
    const highValueQueries = clusteredQueries.filter(q => q.relevanceScore && q.relevanceScore > 0.1);

    let output = `Found ${highValueQueries.length} similar queries:\n\n`;

    highValueQueries.forEach((query, index) => {
      const timestamp = this.formatTimestamp(query.timestamp);
      const score = query.relevanceScore ? ` (${query.relevanceScore.toFixed(1)})` : '';
      const project = query.projectPath ? query.projectPath.split('/').pop() : 'unknown';
      
      // RAW COMPLETE CONTENT for Claude - no truncation of valuable data
      output += `${index + 1}. ${timestamp}${score}: ${query.content}\n`;
      output += `   Project: ${project}`;
      
      // Add valuable metadata for Claude's context
      if (query.context?.toolsUsed?.length) {
        output += ` | Tools: ${query.context.toolsUsed.join(', ')}`;
      }
      if (query.context?.filesReferenced?.length) {
        output += ` | Files: ${query.context.filesReferenced.slice(0, 2).join(', ')}`;
      }
      output += '\n\n';
    });

    return output.trim();
  }

  private clusterBySemantic(queries: CompactMessage[], originalQuery: string): CompactMessage[] {
    // Boost relevance scores based on semantic similarity
    return queries.map(query => {
      let boostedScore = query.relevanceScore || 0;
      
      // Boost for exact keyword matches
      const originalWords = originalQuery.toLowerCase().split(/\s+/);
      const queryWords = query.content.toLowerCase().split(/\s+/);
      const matchCount = originalWords.filter(word => queryWords.includes(word)).length;
      boostedScore += matchCount * 0.1;
      
      // Boost for technical similarity
      if (this.detectContentType(query.content) === this.detectContentType(originalQuery)) {
        boostedScore += 0.2;
      }
      
      // Boost for actionable content
      if (/(fix|solve|implement|build|deploy)/.test(query.content.toLowerCase())) {
        boostedScore += 0.15;
      }
      
      return { ...query, relevanceScore: Math.min(boostedScore, 1.0) };
    }).sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }

  formatFileContext(contexts: FileContext[], filepath: string, _detailLevel: string = 'summary', _operationType: string = 'all'): string {
    let output = `File context: ${filepath}\n\n`;
    
    if (contexts.length === 0) {
      return output + 'No file contexts found.\n';
    }

    // CLAUDE-OPTIMIZED: Rich metadata and complete context for AI consumption
    const rankedContexts = this.rankFileContextsByImpact(contexts);
    const topContexts = rankedContexts.slice(0, Math.min(contexts.length, 15)); // More results for Claude

    output += `Found ${contexts.length} operations, showing ${topContexts.length} with complete context:\n\n`;

    topContexts.forEach((context, index) => {
      const timestamp = this.formatTimestamp(context.lastModified);
      const opType = context.operationType.toUpperCase();
      
      output += `${index + 1}. ${opType} ${timestamp} | File: ${filepath}\n`;

      if (context.relatedMessages.length > 0) {
        // CLAUDE-OPTIMIZED: Provide multiple messages for full context, not just "best" one
        const topMessages = context.relatedMessages.slice(0, 3); // Show up to 3 messages for context
        
        topMessages.forEach((msg, msgIndex) => {
          // RAW COMPLETE CONTENT for Claude - no truncation of valuable data
          const content = msg.content.length > 500 ? msg.content : msg.content; // Keep complete content
          output += `   Message ${msgIndex + 1}: ${content}\n`;
          
          // Add valuable metadata for Claude's context
          if (msg.context?.toolsUsed?.length) {
            output += `   Tools: ${msg.context.toolsUsed.join(', ')}\n`;
          }
          if (msg.context?.filesReferenced?.length) {
            output += `   Files: ${msg.context.filesReferenced.slice(0, 3).join(', ')}\n`;
          }
          if (msg.context?.errorPatterns?.length) {
            output += `   Errors: ${msg.context.errorPatterns.slice(0, 2).join(', ')}\n`;
          }
        });

        if (context.relatedMessages.length > 3) {
          output += `   (${context.relatedMessages.length - 3} additional messages available)\n`;
        }
      }

      output += '\n';
    });

    return output.trim();
  }

  private rankFileContextsByImpact(contexts: FileContext[]): FileContext[] {
    return contexts.map(context => {
      let score = 0;
      
      // Higher score for more recent operations
      const daysSince = (Date.now() - new Date(context.lastModified).getTime()) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 10 - daysSince); // Recent operations score higher
      
      // Boost for critical operations
      if (context.operationType.toLowerCase().includes('edit')) score += 20;
      if (context.operationType.toLowerCase().includes('create')) score += 15;
      if (context.operationType.toLowerCase().includes('read')) score += 5;
      
      // Boost for more messages (indicates complex operations)
      score += context.relatedMessages.length * 2;
      
      // Boost for technical content
      context.relatedMessages.forEach(msg => {
        const contentType = this.detectContentType(msg.content);
        if (contentType === 'code') score += 10;
        if (contentType === 'error') score += 15;
        if (contentType === 'technical') score += 8;
      });
      
      return { ...context, score };
    }).sort((a, b) => (b as any).score - (a as any).score);
  }

  private selectBestMessage(messages: any[]): any {
    // Select the message with highest information value
    return messages.reduce((best, current) => {
      const currentType = this.detectContentType(current.content);
      const bestType = this.detectContentType(best.content);
      
      // Prioritize technical content
      if (currentType === 'code' && bestType !== 'code') return current;
      if (currentType === 'error' && bestType !== 'error' && bestType !== 'code') return current;
      if (currentType === 'technical' && bestType === 'conversational') return current;
      
      // Prioritize longer, more detailed content
      if (current.content.length > best.content.length * 1.5) return current;
      
      return best;
    });
  }

  formatErrorSolutions(solutions: ErrorSolution[], errorPattern: string, _detailLevel: string = 'summary'): string {
    let output = `Error solutions for: "${errorPattern}"\n\n`;
    
    if (solutions.length === 0) {
      return output + 'No error solutions found.\n';
    }

    // CLAUDE-OPTIMIZED: Enhanced quality with speed and token efficiency
    const rankedSolutions = this.rankErrorSolutions(solutions);
    const topSolutions = rankedSolutions.slice(0, Math.min(solutions.length, 3)); // Focused on top results

    output += `${solutions.length} solutions for "${errorPattern}":\n\n`;

    topSolutions.forEach((solution, index) => {
      output += `${index + 1}. ${solution.errorPattern} (${solution.frequency}x)\n`;

      if (solution.solution.length > 0) {
        // CLAUDE-OPTIMIZED: Best solution with essential metadata - quality + efficiency balance
        const bestSolution = this.selectBestSolution(solution.solution);
        
        // Enhanced content extraction - preserve key technical details, remove fluff
        const content = this.extractTechnicalEssence(bestSolution.content);
        output += `   ${content}\n`;
        
        // Add essential metadata for Claude's context
        if (bestSolution.context?.toolsUsed?.length) {
          output += `   Tools: ${bestSolution.context.toolsUsed.slice(0, 2).join(', ')}\n`;
        }
        if (bestSolution.context?.filesReferenced?.length) {
          output += `   Files: ${bestSolution.context.filesReferenced.slice(0, 2).join(', ')}\n`;
        }
        
        // Show additional solutions count for context without bloating output
        if (solution.solution.length > 1) {
          output += `   (+${solution.solution.length - 1} more solutions)\n`;
        }
      }

      output += '\n';
    });

    return output.trim();
  }

  private rankErrorSolutions(solutions: ErrorSolution[]): ErrorSolution[] {
    return solutions.map(solution => {
      let score = 0;
      
      // Higher score for more frequent errors (more important to solve)
      score += solution.frequency * 5;
      
      // Boost for solutions with actionable content
      solution.solution.forEach(sol => {
        const content = sol.content.toLowerCase();
        if (/(fix|solution|resolved|implemented|deploy)/i.test(content)) score += 20;
        if (/(npm|install|config|update|build)/i.test(content)) score += 15;
        if (this.detectContentType(sol.content) === 'code') score += 25;
        if (this.detectContentType(sol.content) === 'technical') score += 10;
      });
      
      return { ...solution, score };
    }).sort((a, b) => (b as any).score - (a as any).score);
  }

  private selectBestSolution(solutions: any[]): any {
    return solutions.reduce((best, current) => {
      // Prioritize technical solutions over conversational
      const currentType = this.detectContentType(current.content);
      const bestType = this.detectContentType(best.content);
      
      if (currentType === 'code' && bestType !== 'code') return current;
      if (currentType === 'technical' && bestType === 'conversational') return current;
      
      // Prioritize solutions with actionable language
      if (/(fix|solution|resolved)/i.test(current.content) && 
          !/(fix|solution|resolved)/i.test(best.content)) return current;
      
      return best;
    });
  }

  formatToolPatterns(patterns: ToolPattern[], toolName?: string, _patternType: string = 'tools'): string {
    const toolFilter = toolName ? ` for "${toolName}"` : '';
    let output = `Tool usage patterns${toolFilter}\n\n`;
    
    if (patterns.length === 0) {
      return output + 'No tool patterns found.\n';
    }

    // REVOLUTIONARY: Usage frequency ranking and workflow intelligence
    const rankedPatterns = this.rankToolPatternsByValue(patterns);
    const topPatterns = rankedPatterns.slice(0, Math.min(patterns.length, 8));

    output += `Found ${patterns.length} patterns, showing ${topPatterns.length} highest-value (${Math.round((topPatterns.length/patterns.length)*100)}% success rate):\n\n`;

    topPatterns.forEach((pattern, index) => {
      const successRate = pattern.successfulUsages.length;
      const efficiency = this.calculateToolEfficiency(pattern);
      
      output += `${index + 1}. ${pattern.toolName} (${successRate} uses, ${efficiency}% efficiency)\n`;

      // Extract most valuable pattern
      if (pattern.commonPatterns.length > 0) {
        const bestPattern = this.selectBestPattern(pattern.commonPatterns);
        output += `   Pattern: ${bestPattern}\n`;
      }

      // Extract most actionable practice
      if (pattern.bestPractices.length > 0) {
        const bestPractice = this.selectBestPractice(pattern.bestPractices);
        output += `   Best Practice: ${bestPractice}\n`;
      }

      output += '\n';
    });

    return output.trim();
  }

  private rankToolPatternsByValue(patterns: ToolPattern[]): ToolPattern[] {
    return patterns.map(pattern => {
      let score = 0;
      
      // Higher score for more successful usages
      score += pattern.successfulUsages.length * 2;
      
      // Boost for commonly used tools
      if (/(Read|Edit|Bash|Grep|Glob)/i.test(pattern.toolName)) score += 20;
      
      // Boost for patterns with actionable practices
      pattern.bestPractices.forEach(practice => {
        if (/(efficient|fast|optimal|best)/i.test(practice)) score += 10;
        if (practice.length > 50) score += 5; // Detailed practices
      });
      
      // Boost for workflow patterns
      pattern.commonPatterns.forEach(p => {
        if (/→/.test(p)) score += 15; // Tool chains
        if (/(file|search|edit|build)/i.test(p)) score += 8;
      });
      
      return { ...pattern, score };
    }).sort((a, b) => (b as any).score - (a as any).score);
  }

  private calculateToolEfficiency(pattern: ToolPattern): number {
    // Simple efficiency metric based on usage frequency
    const usageCount = pattern.successfulUsages.length;
    return Math.min(100, Math.round((usageCount / 100) * 100));
  }

  private selectBestPattern(patterns: string[]): string {
    // Prioritize workflow patterns with tool chains
    const workflowPattern = patterns.find(p => /→/.test(p));
    if (workflowPattern) return workflowPattern;
    
    // Prioritize technical patterns
    const technicalPattern = patterns.find(p => /(file|search|edit|build|deploy)/i.test(p));
    if (technicalPattern) return technicalPattern;
    
    return patterns[0] || '';
  }

  private selectBestPractice(practices: string[]): string {
    // Prioritize actionable practices
    const actionablePractice = practices.find(p => /(use|avoid|ensure|prefer)/i.test(p));
    if (actionablePractice) return actionablePractice;
    
    // Prioritize detailed practices
    const detailedPractice = practices.find(p => p.length > 50);
    if (detailedPractice) return detailedPractice;
    
    return practices[0] || '';
  }

  formatRecentSessions(sessions: any[], project?: string): string {
    let output = `Recent session analysis` + (project ? ` | Project: ${project}` : '') + '\n\n';
    
    if (sessions.length === 0) {
      return output + 'No recent sessions found.\n';
    }

    // REVOLUTIONARY: Activity scoring and productivity metrics
    const rankedSessions = this.rankSessionsByProductivity(sessions);
    const topSessions = rankedSessions.slice(0, Math.min(sessions.length, 10));

    output += `Found ${sessions.length} sessions, showing ${topSessions.length} most productive (${Math.round((topSessions.length/sessions.length)*100)}% activity):\n\n`;

    topSessions.forEach((session, index) => {
      const duration = session.duration_minutes ? `${session.duration_minutes}m` : '0m';
      const timestamp = this.formatTimestamp(session.end_time || session.start_time);
      const sessionId = session.session_id ? session.session_id.substring(0, 8) : 'unknown';
      const productivity = this.calculateProductivityScore(session);

      output += `${index + 1}. ${sessionId} ${timestamp}\n`;
      output += `   ${session.message_count || 0} msgs (${duration}) | Productivity: ${productivity}%`;

      if (session.project_path) {
        const projectName = session.project_path.split('/').pop() || 'unknown';
        output += ` | Project: ${projectName}`;
      }

      // Extract key tools used
      const tools = this.extractSessionTools(session);
      if (tools.length > 0) {
        output += ` | Tools: ${tools.join(', ')}`;
      }

      output += '\n\n';
    });

    return output.trim();
  }

  private rankSessionsByProductivity(sessions: any[]): any[] {
    return sessions.map(session => {
      let score = 0;
      
      // Score based on message density (messages per minute)
      const duration = session.duration_minutes || 1;
      const messageCount = session.message_count || 0;
      const density = messageCount / duration;
      score += density * 10;
      
      // Boost for recent sessions
      const timestamp = session.end_time || session.start_time;
      if (timestamp) {
        const hoursAgo = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
        score += Math.max(0, 24 - hoursAgo); // Recent sessions score higher
      }
      
      // Boost for longer sessions (indicates focus work)
      if (duration > 30) score += 20;
      if (duration > 60) score += 30;
      
      // Boost for high message count (indicates activity)
      if (messageCount > 50) score += 15;
      if (messageCount > 100) score += 25;
      
      return { ...session, score };
    }).sort((a, b) => (b as any).score - (a as any).score);
  }

  private calculateProductivityScore(session: any): number {
    const duration = session.duration_minutes || 1;
    const messageCount = session.message_count || 0;
    const density = messageCount / duration;
    
    // Normalize to 0-100 scale
    return Math.min(100, Math.round(density * 5));
  }

  private extractSessionTools(session: any): string[] {
    // Extract tools from session metadata if available
    const tools = [];
    if (session.tools_used) {
      tools.push(...session.tools_used.slice(0, 3));
    }
    return tools;
  }

  formatCompactSummary(sessions: any[], sessionId?: string): string {
    let output = `${robots.summary} Session summary`;
    
    if (sessionId) {
      output += ` for: ${sessionId}`;
    }
    
    output += '\n\n';
    
    if (sessions.length === 0) {
      return output + 'No session information found.\n';
    }

    const session = sessions[0];
    const timestamp = this.formatTimestamp(session.end_time || session.start_time);
    const duration = session.duration_minutes ? `${session.duration_minutes}m` : '0m';
    const id = session.session_id ? session.session_id.substring(0, 8) : 'unknown';

    output += `Session: ${id}\n`;
    output += `Duration: ${duration}\n`;
    output += `Messages: ${session.message_count || 0}\n`;
    output += `Last activity: ${timestamp}\n`;

    if (session.project_path) {
      const projectName = session.project_path.split('/').pop() || 'unknown';
      output += `Project: ${projectName}\n`;
    }

    return output;
  }
}
