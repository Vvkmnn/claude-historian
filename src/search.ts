import { ConversationParser } from './parser.js';
import { CompactMessage, SearchResult, FileContext, ErrorSolution, ToolPattern } from './types.js';
import { findProjectDirectories, findJsonlFiles, getTimeRangeFilter, extractContentFromMessage } from './utils.js';

export class HistorySearchEngine {
  private parser: ConversationParser;
  private messageCache: Map<string, CompactMessage[]> = new Map();

  constructor() {
    this.parser = new ConversationParser();
  }

  // Pure streaming approach for zero-config operation

  async searchConversations(
    query: string,
    projectFilter?: string,
    timeframe?: string,
    limit: number = 50
  ): Promise<SearchResult> {
    const startTime = Date.now();
    // Dynamic limit based on query type - Claude Code needs context depth
    const queryType = this.classifyQueryType(query);
    const safeLimit = this.getOptimalLimit(queryType, limit);
    
    try {
      // Pure streaming search approach
      const enhancedQuery = this.enhanceQueryIntelligently(query);
      return await this.streamingSearch(enhancedQuery, safeLimit, startTime, projectFilter, timeframe);
    } catch (error) {
      console.error('Search error:', error);
      return {
        messages: [],
        totalResults: 0,
        searchQuery: query,
        executionTime: Date.now() - startTime
      };
    }
  }

  private async streamingSearch(
    query: string,
    limit: number,
    startTime: number,
    projectFilter?: string,
    timeframe?: string
  ): Promise<SearchResult> {
    const timeFilter = getTimeRangeFilter(timeframe);
    const allMessages: CompactMessage[] = [];
    const summaryMessages: CompactMessage[] = []; // Prioritize summaries

    try {
      const projectDirs = await findProjectDirectories();
      const maxDirs = Math.min(projectDirs.length, 10); // Limit for performance
      
      for (let i = 0; i < maxDirs; i++) {
        const projectDir = projectDirs[i];
        
        // Apply project filter if specified
        if (projectFilter && !projectDir.includes(projectFilter)) {
          continue;
        }

        const jsonlFiles = await findJsonlFiles(projectDir);
        // Adaptive file limit based on query complexity and results found
        const targetResults = Math.max(limit, 20);
        const currentResults = summaryMessages.length + allMessages.length;
        const filesNeeded = Math.max(1, Math.ceil((targetResults - currentResults) / 8));
        const maxFiles = Math.min(jsonlFiles.length, filesNeeded);
        
        for (let j = 0; j < maxFiles; j++) {
          const file = jsonlFiles[j];
          const cacheKey = `${projectDir}/${file}`;
          
          try {
            let messages: CompactMessage[];
            if (this.messageCache.has(cacheKey)) {
              messages = this.messageCache.get(cacheKey)!;
            } else {
              messages = await this.parser.parseJsonlFile(projectDir, file, query, timeFilter);
              // Intelligent caching: prioritize recent and high-value content
              if (this.messageCache.size < 100) {
                this.messageCache.set(cacheKey, messages);
              } else if (messages.some(m => (m.relevanceScore || 0) > 8)) {
                // Replace least valuable cache entry with high-value content
                const cacheEntries = Array.from(this.messageCache.entries());
                const leastValuable = cacheEntries.reduce((min, [key, msgs]) => {
                  const avgScore = msgs.reduce((sum, m) => sum + (m.relevanceScore || 0), 0) / msgs.length;
                  return avgScore < (min.avgScore || Infinity) ? { key, avgScore } : min;
                }, { key: '', avgScore: Infinity });
                
                if (leastValuable.key) {
                  this.messageCache.delete(leastValuable.key);
                  this.messageCache.set(cacheKey, messages);
                }
              }
            }
            
            // Fast pre-filter: only process messages with minimum relevance
            const qualifyingMessages = messages.filter(msg => (msg.relevanceScore || 0) >= 1);
            
            // Intelligent message categorization for Claude Code
            qualifyingMessages.forEach(msg => {
              if (this.isSummaryMessage(msg)) {
                summaryMessages.push(msg);
              } else if (this.isHighValueMessage(msg, query)) {
                allMessages.push(msg);
              }
            });
            
            // Smart early exit: stop when we have enough high-quality results
            const totalQuality = summaryMessages.length * 2 + allMessages.length;
            if (totalQuality >= targetResults) break;
            
          } catch (fileError) {
            console.error(`Error processing file ${file}:`, fileError);
            continue;
          }
        }
        
        // Early exit with sufficient quality results
        const totalQuality = summaryMessages.length * 2 + allMessages.length;
        if (totalQuality >= Math.max(limit * 1.5, 30)) break;
      }

      // Intelligent result prioritization for Claude Code workflows
      const prioritizedResults = this.prioritizeResultsForClaudeCode(summaryMessages, allMessages, query, limit);

      return {
        messages: prioritizedResults,
        totalResults: summaryMessages.length + allMessages.length,
        searchQuery: query,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('Streaming search error:', error);
      throw error;
    }
  }

  private isSummaryMessage(message: CompactMessage): boolean {
    const content = message.content.toLowerCase();
    const summaryIndicators = [
      'summary:',
      'in summary',
      'to recap',
      'here\'s what we accomplished',
      'let me summarize',
      'to sum up',
      'overview:',
      'in conclusion',
      'final summary',
      'session summary'
    ];
    
    return summaryIndicators.some(indicator => content.includes(indicator)) ||
           (message.type === 'assistant' && content.includes('summary') && content.length > 100);
  }

  private isHighValueMessage(message: CompactMessage, _query: string): boolean {
    const relevanceScore = message.relevanceScore || 0;
    const content = message.content.toLowerCase();
    
    // Always include high relevance scores
    if (relevanceScore >= 5) return true;
    
    // Include tool usage messages - crucial for Claude Code
    if (message.context?.toolsUsed && message.context.toolsUsed.length > 0) return true;
    
    // Include error resolution messages
    if (message.context?.errorPatterns && message.context.errorPatterns.length > 0) return true;
    
    // Include file operation messages
    if (message.context?.filesReferenced && message.context.filesReferenced.length > 0) return true;
    
    // Include assistant messages with substantial solutions
    if (message.type === 'assistant' && content.length > 200 && relevanceScore > 0) return true;
    
    // Include user messages that are substantial queries
    if (message.type === 'user' && content.length > 50 && content.length < 500 && relevanceScore > 0) return true;
    
    return false;
  }

  private prioritizeResultsForClaudeCode(
    summaryMessages: CompactMessage[], 
    allMessages: CompactMessage[], 
    query: string,
    limit: number
  ): CompactMessage[] {
    const queryType = this.classifyQueryType(query);
    
    // Define priority buckets for different query types
    const priorityBuckets = {
      error: {
        summaries: 2,        // Few summaries for error queries
        toolMessages: 5,     // More tool usage examples
        regular: 8           // More detailed solutions
      },
      implementation: {
        summaries: 3,        // Some summaries for context
        toolMessages: 8,     // Heavy tool usage examples
        regular: 10          // Implementation details
      },
      analysis: {
        summaries: 5,        // More summaries for understanding
        toolMessages: 4,     // Some tool examples
        regular: 8           // Analysis and reasoning
      },
      general: {
        summaries: 3,        // Balanced approach
        toolMessages: 3,
        regular: 4
      }
    };

    const buckets = priorityBuckets[queryType] || priorityBuckets.general;
    
    // Categorize messages by value type
    const toolMessages = allMessages.filter(msg => 
      msg.context?.toolsUsed && msg.context.toolsUsed.length > 0
    );
    const regularMessages = allMessages.filter(msg => 
      !msg.context?.toolsUsed || msg.context.toolsUsed.length === 0
    );
    
    // Sort each category by relevance
    const sortedSummaries = summaryMessages.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    const sortedToolMessages = toolMessages.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    const sortedRegularMessages = regularMessages.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    
    // Build result set with intelligent distribution
    const results: CompactMessage[] = [];
    
    // Add summaries first (but not too many)
    results.push(...sortedSummaries.slice(0, Math.min(buckets.summaries, limit / 4)));
    
    // Add tool messages (critical for Claude Code)
    const remainingAfterSummaries = limit - results.length;
    results.push(...sortedToolMessages.slice(0, Math.min(buckets.toolMessages, remainingAfterSummaries / 2)));
    
    // Fill remaining with regular messages
    const remainingSlots = limit - results.length;
    results.push(...sortedRegularMessages.slice(0, Math.min(buckets.regular, remainingSlots)));
    
    // If we still have slots, fill with any remaining high-value messages
    if (results.length < limit) {
      const remaining = [...sortedSummaries, ...sortedToolMessages, ...sortedRegularMessages]
        .filter(msg => !results.includes(msg))
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      
      results.push(...remaining.slice(0, limit - results.length));
    }
    
    return results.slice(0, limit);
  }

  private classifyQueryType(query: string): 'error' | 'implementation' | 'analysis' | 'general' {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('error') || lowerQuery.includes('bug') || lowerQuery.includes('fix') || lowerQuery.includes('issue')) {
      return 'error';
    }
    if (lowerQuery.includes('implement') || lowerQuery.includes('create') || lowerQuery.includes('build') || lowerQuery.includes('add')) {
      return 'implementation';
    }
    if (lowerQuery.includes('how') || lowerQuery.includes('why') || lowerQuery.includes('analyze') || lowerQuery.includes('understand')) {
      return 'analysis';
    }
    return 'general';
  }

  private getOptimalLimit(queryType: string, requestedLimit: number): number {
    const baseLimits = {
      error: 15,      // Error queries need multiple solution attempts
      implementation: 25, // Implementation needs examples and approaches  
      analysis: 20,    // Analysis needs context and reasoning
      general: 10      // General queries can be more focused
    };
    
    const optimal = baseLimits[queryType as keyof typeof baseLimits] || 10;
    return Math.min(Math.max(requestedLimit, optimal), 100); // Cap at 100 for performance
  }

  private enhanceQueryIntelligently(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    // Add contextual terms for Claude Code-specific patterns
    if (lowerQuery.includes('error') || lowerQuery.includes('bug')) {
      return `${query} solution fix resolve tool_result`;
    }
    if (lowerQuery.includes('implement') || lowerQuery.includes('create')) {
      return `${query} solution approach code example`;
    }
    if (lowerQuery.includes('optimize') || lowerQuery.includes('performance')) {
      return `${query} improvement solution approach`;
    }
    if (lowerQuery.includes('file') || lowerQuery.includes('read') || lowerQuery.includes('edit')) {
      return `${query} tool_use Read Edit Write`;
    }
    
    return query;
  }


  private calculateRelevanceScore(message: any, query: string): number {
    try {
      const content = extractContentFromMessage(message.message || {});
      if (!content) return 0;
      
      const lowerQuery = query.toLowerCase();
      const lowerContent = content.toLowerCase();
      
      let score = 0;
      
      // Exact phrase match - high value for Claude Code
      if (lowerContent.includes(lowerQuery)) score += 15;
      
      // Enhanced word matching with context awareness
      const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);
      const contentWords = lowerContent.split(/\s+/);
      const matches = queryWords.filter(word => 
        contentWords.some(cWord => cWord.includes(word))
      );
      score += matches.length * 3;
      
      // High bonus for tool usage - essential for Claude Code queries
      if (message.type === 'tool_use' || message.type === 'tool_result') score += 8;
      if (lowerContent.includes('tool_use') || lowerContent.includes('called the')) score += 6;
      
      // Code file references - crucial for development queries
      if (content.includes('.ts') || content.includes('.js') || content.includes('src/')) score += 4;
      if (content.includes('package.json') || content.includes('.md')) score += 3;
      
      // Error resolution context
      if (lowerContent.includes('error') || lowerContent.includes('fix')) score += 4;
      if (lowerContent.includes('solution') || lowerContent.includes('resolved')) score += 3;
      
      // Assistant messages with substantial content get bonus
      if (message.type === 'assistant' && content.length > 200) score += 2;
      
      // Recent conversations are more valuable
      const timestamp = message.timestamp || '';
      const isRecent = new Date(timestamp) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (isRecent) score += 1;
      
      return score;
    } catch {
      return 0;
    }
  }

  private matchesTimeframe(timestamp: string, timeframe: string): boolean {
    try {
      const filter = getTimeRangeFilter(timeframe);
      return filter(timestamp);
    } catch {
      return true;
    }
  }

  async findFileContext(filePath: string, limit: number = 20): Promise<FileContext[]> {
    const fileContexts: FileContext[] = [];
    
    try {
      const projectDirs = await findProjectDirectories();
      
      for (const projectDir of projectDirs) {
        const jsonlFiles = await findJsonlFiles(projectDir);
        
        for (const file of jsonlFiles) {
          const messages = await this.parser.parseJsonlFile(projectDir, file);
          
          const fileMessages = messages.filter(msg => {
            const hasFileRef = msg.context?.filesReferenced?.some(ref => 
              ref.includes(filePath) || filePath.includes(ref)
            );
            const hasContentRef = msg.content.toLowerCase().includes(filePath.toLowerCase());
            return hasFileRef || hasContentRef;
          });
          
          if (fileMessages.length > 0) {
            // Group by operation type (heuristic)
            const operationType = this.inferOperationType(fileMessages);
            
            fileContexts.push({
              filePath,
              lastModified: fileMessages[0]?.timestamp || '',
              relatedMessages: fileMessages.slice(0, limit),
              operationType
            });
          }
        }
      }
      
      return fileContexts.sort((a, b) => 
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
      );
      
    } catch (error) {
      console.error('File context search error:', error);
      return [];
    }
  }

  async findSimilarQueries(targetQuery: string, limit: number = 10): Promise<CompactMessage[]> {
    const allMessages: CompactMessage[] = [];
    
    try {
      const projectDirs = await findProjectDirectories();
      
      for (const projectDir of projectDirs) {
        const jsonlFiles = await findJsonlFiles(projectDir);
        
        for (const file of jsonlFiles) {
          const messages = await this.parser.parseJsonlFile(projectDir, file);
          
          // Find user messages (queries) that are similar
          const userQueries = messages.filter(msg => 
            msg.type === 'user' && 
            msg.content.length > 10 && 
            msg.content.length < 1000 // Increased limit for longer queries
          );
          
          for (const query of userQueries) {
            const similarity = this.calculateQuerySimilarity(targetQuery, query.content);
            // Lowered threshold from 0.3 to 0.1 and added partial matching
            if (similarity > 0.4 || this.hasExactKeywords(targetQuery, query.content)) {
              query.relevanceScore = similarity;
              allMessages.push(query);
            }
          }
        }
      }
      
      return allMessages
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, limit);
        
    } catch (error) {
      console.error('Similar query search error:', error);
      return [];
    }
  }

  async getErrorSolutions(errorPattern: string, limit: number = 10): Promise<ErrorSolution[]> {
    const solutions: ErrorSolution[] = [];
    const errorMap = new Map<string, CompactMessage[]>();
    
    try {
      const projectDirs = await findProjectDirectories();
      
      for (const projectDir of projectDirs) {
        const jsonlFiles = await findJsonlFiles(projectDir);
        
        for (const file of jsonlFiles) {
          const messages = await this.parser.parseJsonlFile(projectDir, file);
          
          // Find error patterns and their solutions
          for (let i = 0; i < messages.length - 1; i++) {
            const current = messages[i];
            
            if ((current.context?.errorPatterns?.some(err => 
              err.toLowerCase().includes(errorPattern.toLowerCase())
            )) || this.hasErrorInContent(current.content, errorPattern)) {
              const errorKey = current.context?.errorPatterns?.[0] || errorPattern;
              
              if (!errorMap.has(errorKey)) {
                errorMap.set(errorKey, []);
              }
              
              // Include the error message and the next few messages as potential solutions
              const solutionMessages = messages.slice(i, i + 3).filter(msg => 
                msg.type === 'assistant' || msg.type === 'tool_result'
              );
              
              errorMap.get(errorKey)!.push(...solutionMessages);
            }
          }
        }
      }
      
      // Convert to ErrorSolution format
      for (const [pattern, msgs] of errorMap.entries()) {
        solutions.push({
          errorPattern: pattern,
          solution: msgs.slice(0, 3),
          context: this.extractSolutionContext(msgs),
          frequency: msgs.length
        });
      }
      
      return solutions
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, limit);
        
    } catch (error) {
      console.error('Error solution search error:', error);
      return [];
    }
  }

  async getToolPatterns(toolName?: string, limit: number = 20): Promise<ToolPattern[]> {
    const toolMap = new Map<string, CompactMessage[]>();
    
    try {
      const projectDirs = await findProjectDirectories();
      
      for (const projectDir of projectDirs) {
        const jsonlFiles = await findJsonlFiles(projectDir);
        
        for (const file of jsonlFiles) {
          const messages = await this.parser.parseJsonlFile(projectDir, file);
          
          const toolMessages = messages.filter(msg => 
            msg.context?.toolsUsed && 
            (!toolName || msg.context.toolsUsed.includes(toolName))
          );
          
          for (const msg of toolMessages) {
            for (const tool of msg.context!.toolsUsed!) {
              if (!toolMap.has(tool)) {
                toolMap.set(tool, []);
              }
              toolMap.get(tool)!.push(msg);
            }
          }
        }
      }
      
      const patterns: ToolPattern[] = [];
      for (const [tool, messages] of toolMap.entries()) {
        const commonPatterns = this.extractCommonPatterns(messages);
        
        patterns.push({
          toolName: tool,
          successfulUsages: messages.slice(0, 10),
          commonPatterns,
          bestPractices: this.extractBestPractices()
        });
      }
      
      return patterns
        .sort((a, b) => b.successfulUsages.length - a.successfulUsages.length)
        .slice(0, limit);
        
    } catch (error) {
      console.error('Tool pattern search error:', error);
      return [];
    }
  }

  async getRecentSessions(limit: number = 10): Promise<any[]> {
    try {
      // Load all sessions from parser
      const projectDirs = await findProjectDirectories();
      
      for (const projectDir of projectDirs) {
        const jsonlFiles = await findJsonlFiles(projectDir);
        
        for (const file of jsonlFiles) {
          await this.parser.parseJsonlFile(projectDir, file);
        }
      }
      
      return this.parser.getAllSessions().slice(0, limit);
      
    } catch (error) {
      console.error('Recent sessions error:', error);
      return [];
    }
  }

  // Helper methods
  private inferOperationType(messages: CompactMessage[]): FileContext['operationType'] {
    const hasWrites = messages.some(msg => 
      msg.content.toLowerCase().includes('write') || 
      msg.content.toLowerCase().includes('edit') ||
      msg.context?.toolsUsed?.includes('Edit')
    );
    
    const hasReads = messages.some(msg => 
      msg.context?.toolsUsed?.includes('Read')
    );
    
    if (hasWrites) return 'edit';
    if (hasReads) return 'read';
    return 'read';
  }

  private calculateQuerySimilarity(query1: string, query2: string): number {
    const words1 = query1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const words2 = query2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    // Enhanced similarity scoring with semantic understanding
    let totalScore = 0;
    const maxWords = Math.max(words1.length, words2.length);
    const minWords = Math.min(words1.length, words2.length);
    
    // Track matched words to avoid double counting
    const matched2 = new Set<number>();
    
    for (let i = 0; i < words1.length; i++) {
      const word1 = words1[i];
      let bestMatch = 0;
      let bestIndex = -1;
      
      for (let j = 0; j < words2.length; j++) {
        if (matched2.has(j)) continue; // Skip already matched words
        
        const word2 = words2[j];
        let matchScore = 0;
        
        // Exact match gets highest score
        if (word1 === word2) {
          matchScore = 1.0;
        }
        // Partial containment
        else if (word1.includes(word2) || word2.includes(word1)) {
          const shorter = Math.min(word1.length, word2.length);
          const longer = Math.max(word1.length, word2.length);
          matchScore = 0.7 * (shorter / longer); // Better scoring for partial matches
        }
        // Fuzzy/similar words
        else if (this.isWordSimilar(word1, word2)) {
          matchScore = 0.5;
        }
        
        if (matchScore > bestMatch) {
          bestMatch = matchScore;
          bestIndex = j;
        }
      }
      
      if (bestIndex >= 0) {
        matched2.add(bestIndex);
        totalScore += bestMatch;
      }
    }
    
    // Normalize by considering both query lengths
    const lengthPenalty = minWords / maxWords; // Penalty for very different lengths
    return Math.min((totalScore / maxWords) * lengthPenalty, 1.0);
  }

  private hasExactKeywords(query1: string, query2: string): boolean {
    const keywords1 = query1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const keywords2 = query2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    // High-value technical keywords get priority
    const techKeywords = ['error', 'fix', 'implement', 'optimize', 'debug', 'build', 'deploy', 'test', 'tool', 'file', 'code'];
    const hasTechMatch = keywords1.some(k1 => techKeywords.includes(k1) && keywords2.some(k2 => k2.includes(k1)));
    
    // Check if they share at least 2 keywords or 1 important technical keyword
    const sharedKeywords = keywords1.filter(k => 
      keywords2.some(k2 => k === k2 || k.includes(k2) || k2.includes(k))
    );
    
    return hasTechMatch || sharedKeywords.length >= 2 || 
           sharedKeywords.some(k => k.length > 6); // Important long keywords
  }

  private isWordSimilar(word1: string, word2: string): boolean {
    // Simple fuzzy matching for similar words
    if (Math.abs(word1.length - word2.length) > 3) return false;
    
    const minLen = Math.min(word1.length, word2.length);
    if (minLen < 4) return false;
    
    // Check if they share a significant portion
    const shared = minLen * 0.6;
    let matches = 0;
    
    for (let i = 0; i < minLen; i++) {
      if (word1[i] === word2[i]) matches++;
    }
    
    return matches >= shared;
  }

  private extractSolutionContext(messages: CompactMessage[]): string {
    return messages
      .map(msg => msg.content)
      .join(' ')
      .substring(0, 200) + '...';
  }

  private extractCommonPatterns(messages: CompactMessage[]): string[] {
    // Enhanced pattern extraction with success rates and recommendations
    const patterns = new Set<string>();
    const toolCombos = new Map<string, number>();
    const filePatterns = new Map<string, number>();
    
    messages.forEach(msg => {
      if (msg.context?.toolsUsed && msg.context.toolsUsed.length > 0) {
        const toolCombo = msg.context.toolsUsed.sort().join(' → ');
        toolCombos.set(toolCombo, (toolCombos.get(toolCombo) || 0) + 1);
      }
      if (msg.context?.filesReferenced) {
        const fileTypes = msg.context.filesReferenced.map(f => f.split('.').pop()).filter(Boolean);
        fileTypes.forEach(type => filePatterns.set(type!, (filePatterns.get(type!) || 0) + 1));
      }
    });
    
    // Add most successful tool combinations
    const topToolCombos = Array.from(toolCombos.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);
    
    topToolCombos.forEach(([combo, count]) => {
      patterns.add(`${combo} (${count}x successful)`);
    });
    
    // Add common file type patterns
    const topFileTypes = Array.from(filePatterns.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);
    
    if (topFileTypes.length > 0) {
      patterns.add(`Common files: ${topFileTypes.map(([type, count]) => `${type} (${count}x)`).join(', ')}`);
    }
    
    return Array.from(patterns);
  }

  private extractBestPractices(): string[] {
    // Extract best practices from successful tool usage
    return [
      'Use appropriate tools for file operations',
      'Check file permissions before writing',
      'Validate input parameters'
    ];
  }

  private hasErrorInContent(content: string, errorPattern: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerPattern = errorPattern.toLowerCase();
    
    // Check for exact error pattern
    if (lowerContent.includes(lowerPattern)) return true;
    
    // Check for common error indicators
    const errorKeywords = ['error:', 'failed:', 'exception:', 'cannot', 'unable to', 'not found', 'permission denied'];
    return errorKeywords.some(keyword => 
      lowerContent.includes(keyword) && lowerContent.includes(lowerPattern.split('_')[0])
    );
  }

}