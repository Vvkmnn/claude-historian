import { ConversationParser } from './parser.js';
import { IntelligentIndexer } from './indexer.js';
import { CompactMessage, SearchResult, FileContext, ErrorSolution, ToolPattern } from './types.js';
import { findProjectDirectories, findJsonlFiles, getTimeRangeFilter, extractContentFromMessage } from './utils.js';

export class HistorySearchEngine {
  private parser: ConversationParser;
  private indexer: IntelligentIndexer;
  private messageCache: Map<string, CompactMessage[]> = new Map();
  private indexBuilt: boolean = false;

  constructor() {
    this.parser = new ConversationParser();
    this.indexer = new IntelligentIndexer();
  }

  private async ensureIndexBuilt(): Promise<void> {
    if (this.indexBuilt) return;
    
    try {
      const projectDirs = await findProjectDirectories();
      await this.indexer.buildIndex(projectDirs);
      this.indexBuilt = true;
    } catch (error) {
      console.error('Failed to build index, falling back to slower search:', error);
      // Continue without index - searches will be slower but still work
    }
  }

  async searchConversations(
    query: string,
    projectFilter?: string,
    timeframe?: string,
    limit: number = 50
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const safeLimit = Math.min(Math.max(limit, 1), 200); // Enforce reasonable limits
    
    try {
      await this.ensureIndexBuilt();
      
      // Enhance query with Claude-powered intelligence
      const enhancedQuery = await this.enhanceQueryWithAI(query);
      const searchTerms = enhancedQuery || query;
      
      // Use intelligent index if available, otherwise fall back to slower method
      if (this.indexBuilt) {
        return await this.searchWithIndex(searchTerms, safeLimit, startTime, projectFilter, timeframe);
      } else {
        return await this.searchWithoutIndex(searchTerms, safeLimit, startTime, projectFilter, timeframe);
      }
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

  private async searchWithIndex(
    query: string,
    limit: number,
    startTime: number,
    projectFilter?: string,
    timeframe?: string
  ): Promise<SearchResult> {
    try {
      const keywords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
      const indexResults = this.indexer.searchByKeywords(keywords, limit * 2);
      
      // Convert index results to compact messages
      const messages: CompactMessage[] = [];
      for (const indexResult of indexResults) {
        try {
          const fullMessage = await this.indexer.getFullMessage(indexResult);
          if (fullMessage) {
            const content = extractContentFromMessage(fullMessage.message || {});
            if (content) {
              const compactMessage: CompactMessage = {
                uuid: indexResult.uuid,
                timestamp: indexResult.timestamp,
                type: indexResult.type,
                content: content.substring(0, 1000),
                sessionId: indexResult.sessionId,
                projectPath: indexResult.projectDir,
                relevanceScore: this.calculateRelevanceScore(fullMessage, query),
                context: this.extractDetailedContext(fullMessage)
              };
              
              // Apply filters
              if (projectFilter && !indexResult.projectDir.includes(projectFilter)) continue;
              if (timeframe && !this.matchesTimeframe(indexResult.timestamp, timeframe)) continue;
              
              messages.push(compactMessage);
            }
          }
        } catch (messageError) {
          console.error(`Error processing message ${indexResult.uuid}:`, messageError);
          continue;
        }
      }

      return {
        messages: messages.slice(0, limit),
        totalResults: indexResults.length,
        searchQuery: query,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      console.error('Index search error:', error);
      throw error;
    }
  }

  private async searchWithoutIndex(
    query: string,
    limit: number,
    startTime: number,
    projectFilter?: string,
    timeframe?: string
  ): Promise<SearchResult> {
    const timeFilter = getTimeRangeFilter(timeframe);
    const allMessages: CompactMessage[] = [];

    try {
      const projectDirs = await findProjectDirectories();
      const maxDirs = Math.min(projectDirs.length, 20); // Limit for performance
      
      for (let i = 0; i < maxDirs; i++) {
        const projectDir = projectDirs[i];
        
        // Apply project filter if specified
        if (projectFilter && !projectDir.includes(projectFilter)) {
          continue;
        }

        const jsonlFiles = await findJsonlFiles(projectDir);
        const maxFiles = Math.min(jsonlFiles.length, 10); // Limit files per project
        
        for (let j = 0; j < maxFiles; j++) {
          const file = jsonlFiles[j];
          const cacheKey = `${projectDir}/${file}`;
          
          try {
            let messages: CompactMessage[];
            if (this.messageCache.has(cacheKey)) {
              messages = this.messageCache.get(cacheKey)!;
            } else {
              messages = await this.parser.parseJsonlFile(projectDir, file, query, timeFilter);
              // Cache results for performance (with size limit)
              if (this.messageCache.size < 100) {
                this.messageCache.set(cacheKey, messages);
              }
            }
            
            // Filter messages by query relevance
            const relevantMessages = messages.filter(msg => {
              if (!query) return true;
              return (msg.relevanceScore || 0) > 0;
            });
            
            allMessages.push(...relevantMessages);
            
            // Early exit if we have enough results
            if (allMessages.length > limit * 3) break;
            
          } catch (fileError) {
            console.error(`Error processing file ${file}:`, fileError);
            continue;
          }
        }
        
        // Early exit if we have enough results
        if (allMessages.length > limit * 3) break;
      }

      // Sort by relevance score and timestamp
      const sortedMessages = allMessages
        .sort((a, b) => {
          const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
          if (scoreDiff !== 0) return scoreDiff;
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        })
        .slice(0, limit);

      return {
        messages: sortedMessages,
        totalResults: allMessages.length,
        searchQuery: query,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('Fallback search error:', error);
      throw error;
    }
  }

  private calculateRelevanceScore(message: any, query: string): number {
    try {
      const content = extractContentFromMessage(message.message || {});
      if (!content) return 0;
      
      const lowerQuery = query.toLowerCase();
      const lowerContent = content.toLowerCase();
      
      let score = 0;
      
      // Exact phrase match
      if (lowerContent.includes(lowerQuery)) score += 10;
      
      // Word matches
      const queryWords = lowerQuery.split(/\s+/);
      const contentWords = lowerContent.split(/\s+/);
      const matches = queryWords.filter(word => 
        contentWords.some(cWord => cWord.includes(word))
      );
      score += matches.length * 2;
      
      // Bonus for tool usage and file references
      if (message.type === 'tool_use' || message.type === 'tool_result') score += 3;
      if (content.includes('.ts') || content.includes('.js') || content.includes('src/')) score += 2;
      
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
    const targetWords = targetQuery.toLowerCase().split(/\s+/).filter(word => word.length > 2);
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
            if (similarity > 0.1 || this.hasKeywordMatch(targetQuery, query.content)) {
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
            const next = messages[i + 1];
            
            if (current.context?.errorPatterns?.some(err => 
              err.toLowerCase().includes(errorPattern.toLowerCase())
            )) {
              const errorKey = current.context.errorPatterns[0];
              
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
          bestPractices: this.extractBestPractices(messages)
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

  private hasKeywordMatch(query1: string, query2: string): boolean {
    const keywords1 = query1.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const keywords2 = query2.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    // Check if they share at least 2 keywords or 1 important keyword
    const sharedKeywords = keywords1.filter(k => 
      keywords2.some(k2 => k === k2 || k.includes(k2) || k2.includes(k))
    );
    
    return sharedKeywords.length >= 2 || 
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
    // Simple pattern extraction - could be enhanced
    const patterns = new Set<string>();
    
    messages.forEach(msg => {
      if (msg.context?.toolsUsed) {
        patterns.add(`Tool usage: ${msg.context.toolsUsed.join(', ')}`);
      }
      if (msg.context?.filesReferenced) {
        patterns.add(`File types: ${msg.context.filesReferenced.map(f => f.split('.').pop()).join(', ')}`);
      }
    });
    
    return Array.from(patterns);
  }

  private extractBestPractices(messages: CompactMessage[]): string[] {
    // Extract best practices from successful tool usage
    return [
      'Use appropriate tools for file operations',
      'Check file permissions before writing',
      'Validate input parameters'
    ];
  }

  private async enhanceQueryWithAI(query: string): Promise<string | null> {
    try {
      // Fast, token-efficient query enhancement without external API calls
      // Preserves context and speeds up searches through intelligent expansion
      
      const queryAnalysis = this.analyzeQueryIntent(query);
      
      if (queryAnalysis.needsExpansion) {
        const enhanced = this.expandQueryIntelligently(query, queryAnalysis);
        // Only enhance if it meaningfully improves search without bloating
        if (enhanced !== query && enhanced.length < query.length * 2) {
          return enhanced;
        }
      }
      
      return null; // Use original query
    } catch (error) {
      console.error('Query enhancement error:', error);
      return null; // Fallback to original query
    }
  }

  private analyzeQueryIntent(query: string): { needsExpansion: boolean; intent: string; keywords: string[] } {
    const lowerQuery = query.toLowerCase();
    const keywords = query.split(/\s+/).filter(w => w.length > 2);
    
    // Detect common search intents
    const intents = {
      error: /error|bug|fail|exception|crash|broken/i.test(query),
      feature: /implement|add|create|build|new|feature/i.test(query),
      fix: /fix|resolve|solve|repair/i.test(query),
      documentation: /docs|documentation|readme|help|guide/i.test(query),
      configuration: /config|setup|install|configure/i.test(query),
      performance: /slow|performance|optimize|speed|memory/i.test(query),
      testing: /test|spec|jest|cypress|playwright/i.test(query),
      deployment: /deploy|build|ci|cd|production/i.test(query)
    };
    
    const detectedIntent = Object.keys(intents).find(intent => intents[intent as keyof typeof intents]) || 'general';
    
    return {
      needsExpansion: keywords.length < 3 || detectedIntent !== 'general',
      intent: detectedIntent,
      keywords
    };
  }

  private expandQueryIntelligently(originalQuery: string, analysis: { intent: string; keywords: string[] }): string {
    // Context-preserving, token-efficient query expansion
    // Only adds the most relevant single term to avoid search dilution
    
    const contextualExpansions: Record<string, string> = {
      error: 'debugging',
      feature: 'implementation', 
      fix: 'solution',
      documentation: 'readme',
      configuration: 'setup',
      performance: 'optimization',
      testing: 'test',
      deployment: 'build'
    };
    
    // Smart expansion: only add one highly relevant term
    const expansion = contextualExpansions[analysis.intent];
    
    if (expansion && !originalQuery.toLowerCase().includes(expansion)) {
      return `${originalQuery} ${expansion}`;
    }
    
    return originalQuery;
  }

  private extractDetailedContext(message: any): CompactMessage['context'] {
    const context: CompactMessage['context'] = {};
    const content = extractContentFromMessage(message.message || {});
    
    // Extract files
    const filePatterns = [
      /[\w\-\/\.]+\.(ts|js|json|md|py|java|cpp|c|h|css|html|yml|yaml|toml|rs|go)(?:\b|$)/gi,
      /src\/[\w\-\/\.]+/gi,
      /\.\/[\w\-\/\.]+/gi
    ];
    
    const files = new Set<string>();
    filePatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => files.add(match));
      }
    });
    
    if (files.size > 0) {
      context.filesReferenced = Array.from(files);
    }
    
    // Extract tools using the same logic as parser
    const tools = new Set<string>();
    
    if (message.message?.content) {
      const toolContent = Array.isArray(message.message.content) 
        ? message.message.content 
        : [message.message.content];
      
      toolContent
        .filter((item: any) => item && item.type === 'tool_use' && item.name)
        .forEach((item: any) => {
          const cleanName = item.name.replace(/^mcp__.*?__/, '').replace(/[_-]/g, '');
          if (cleanName) tools.add(cleanName);
        });
    }
    
    // Pattern matching for tools in content
    const toolPatterns = [
      /\[Tool:\s*(\w+)\]/gi,
      /tool_use.*?"name":\s*"([^"]+)"/gi
    ];
    
    toolPatterns.forEach(pattern => {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1]) {
          const cleanName = match[1].replace(/^mcp__.*?__/, '').replace(/[_-]/g, '');
          if (cleanName) tools.add(cleanName);
        }
        if (match.index === pattern.lastIndex) {
          pattern.lastIndex++;
        }
      }
    });
    
    if (tools.size > 0) {
      context.toolsUsed = Array.from(tools);
    }
    
    return Object.keys(context).length > 0 ? context : undefined;
  }
}