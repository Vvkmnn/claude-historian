import { ConversationParser } from './parser.js';
import { CompactMessage, SearchResult, FileContext, ErrorSolution, ToolPattern } from './types.js';
import {
  findProjectDirectories,
  findJsonlFiles,
  getTimeRangeFilter,
  extractContentFromMessage,
} from './utils.js';
import { SearchHelpers } from './search-helpers.js';

export class HistorySearchEngine {
  private parser: ConversationParser;
  private messageCache: Map<string, CompactMessage[]> = new Map();

  constructor() {
    this.parser = new ConversationParser();
  }

  // Optimized search for maximum relevance with minimal tokens

  async searchConversations(
    query: string,
    projectFilter?: string,
    timeframe?: string,
    limit: number = 15 // Default to 15 for better coverage
  ): Promise<SearchResult> {
    const startTime = Date.now();
    
    // Intelligent query analysis and classification
    const queryAnalysis = this.analyzeQueryIntent(query);
    const requestedLimit = limit; // Use exactly what user requested

    try {
      // Multi-stage optimized search
      return await this.performOptimizedSearch(
        query,
        queryAnalysis,
        requestedLimit,
        startTime,
        projectFilter,
        timeframe
      );
    } catch (error) {
      console.error('Search error:', error);
      return {
        messages: [],
        totalResults: 0,
        searchQuery: query,
        executionTime: Date.now() - startTime,
      };
    }
  }

  private analyzeQueryIntent(query: string): any {
    const lowerQuery = query.toLowerCase();
    
    return {
      type: this.classifyQueryType(query),
      urgency: lowerQuery.includes('error') || lowerQuery.includes('failed') ? 'high' : 'medium',
      scope: lowerQuery.includes('project') || lowerQuery.includes('all') ? 'broad' : 'focused',
      expectsCode: lowerQuery.includes('function') || lowerQuery.includes('implement') || lowerQuery.includes('code'),
      expectsSolution: lowerQuery.includes('how') || lowerQuery.includes('fix') || lowerQuery.includes('solve'),
      keywords: lowerQuery.split(/\s+/).filter(w => w.length > 2),
      semanticBoosts: this.getSemanticBoosts(lowerQuery)
    };
  }

  private getSemanticBoosts(query: string): Record<string, number> {
    const boosts: Record<string, number> = {};
    
    // Technical content gets massive boosts
    if (query.includes('error')) boosts.errorResolution = 3.0;
    if (query.includes('implement')) boosts.implementation = 2.5;
    if (query.includes('optimize')) boosts.optimization = 2.0;
    if (query.includes('fix')) boosts.solutions = 2.8;
    if (query.includes('file')) boosts.fileOperations = 2.0;
    if (query.includes('tool')) boosts.toolUsage = 2.2;
    
    return boosts;
  }

  private async performOptimizedSearch(
    query: string,
    analysis: any,
    limit: number,
    startTime: number,
    projectFilter?: string,
    timeframe?: string
  ): Promise<SearchResult> {
    const timeFilter = getTimeRangeFilter(timeframe);
    
    try {
      const projectDirs = await findProjectDirectories();
      
      // Pre-validate: Don't waste time on queries that won't return value
      if (query.length < 3) {
        return {
          messages: [],
          totalResults: 0,
          searchQuery: query,
          executionTime: Date.now() - startTime,
        };
      }
      
      // Smart project selection - focus on most relevant projects first
      const maxProjects = Math.min(projectDirs.length, Math.max(8, Math.ceil(limit / 2)));
      const targetDirs = projectFilter 
        ? projectDirs.filter(dir => dir.includes(projectFilter))
        : projectDirs.slice(0, maxProjects);

      // Parallel processing with quality threshold
      const candidates = await this.gatherRelevantCandidates(
        targetDirs, 
        query, 
        analysis, 
        timeFilter, 
        limit * 2 // Gather 2x but with higher quality threshold
      );

      // Intelligent relevance scoring and selection with quality guarantee
      const topRelevant = this.selectTopRelevantResults(
        candidates,
        query,
        analysis,
        limit
      );

      // Quality gate: Only return results that meet minimum value threshold
      const qualityResults = topRelevant.filter(msg => 
        (msg.relevanceScore || 0) >= 1.5 && // Must be reasonably relevant
        msg.content.length >= 40 && // Must have substantial content
        !this.isLowValueContent(msg.content) // Must not be filler
      );

      return {
        messages: qualityResults,
        totalResults: candidates.length,
        searchQuery: query,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      console.error('Optimized search error:', error);
      throw error;
    }
  }

  private async gatherRelevantCandidates(
    projectDirs: string[],
    query: string,
    analysis: any,
    timeFilter: ((timestamp: string) => boolean) | undefined,
    targetCount: number
  ): Promise<CompactMessage[]> {
    const candidates: CompactMessage[] = [];
    
    // Process projects in parallel with intelligent early stopping
    const projectResults = await Promise.allSettled(
      projectDirs.map(async (projectDir) => {
        const dirCandidates = await this.processProjectFocused(
          projectDir,
          query,
          analysis,
          timeFilter,
          Math.ceil(targetCount / projectDirs.length)
        );
        return dirCandidates;
      })
    );

    // Aggregate with aggressive noise filtering
    for (const result of projectResults) {
      if (result.status === 'fulfilled') {
        const dirMessages = result.value.filter(msg => 
          this.isHighlyRelevant(msg, query, analysis)
        );
        candidates.push(...dirMessages);
        
        // Early termination if we have enough high-quality candidates
        if (candidates.length >= targetCount) break;
      }
    }

    return candidates;
  }

  private async processProjectFocused(
    projectDir: string,
    query: string,
    analysis: any,
    timeFilter: ((timestamp: string) => boolean) | undefined,
    targetPerProject: number
  ): Promise<CompactMessage[]> {
    const messages: CompactMessage[] = [];
    
    try {
      const jsonlFiles = await findJsonlFiles(projectDir);
      
      // Process only most relevant files (max 4 per project)
      const priorityFiles = jsonlFiles.slice(0, Math.min(4, jsonlFiles.length));
      
      for (const file of priorityFiles) {
        const fileMessages = await this.processJsonlFile(projectDir, file, query, timeFilter);
        
        // Balanced filtering per file
        const relevant = fileMessages
          .filter(msg => (msg.relevanceScore || 0) >= 1) // Lower threshold for usefulness
          .filter(msg => this.matchesQueryIntent(msg, analysis))
          .slice(0, Math.ceil(targetPerProject / priorityFiles.length));
        
        messages.push(...relevant);
        
        if (messages.length >= targetPerProject) break;
      }
    } catch (error) {
      console.error(`Focused processing error for ${projectDir}:`, error);
    }
    
    return messages;
  }

  private isHighlyRelevant(message: CompactMessage, query: string, analysis: any): boolean {
    const content = message.content.toLowerCase();
    
    // Eliminate all noise patterns aggressively
    const noisePatterns = [
      'this session is being continued',
      'caveat:',
      'command-name>',
      'local-command-stdout',
      'system-reminder',
      'command-message>',
      'much better! now i can see',
      'package.js',
      'export interface'
    ];
    
    if (noisePatterns.some(pattern => content.includes(pattern)) || content.length < 40) {
      return false;
    }
    
    // Must have reasonable relevance score  
    if ((message.relevanceScore || 0) < 1) return false;
    
    // Must match query intent
    return this.matchesQueryIntent(message, analysis);
  }

  private matchesQueryIntent(message: CompactMessage, analysis: any): boolean {
    const content = message.content.toLowerCase();
    
    // Intent-based matching
    switch (analysis.type) {
      case 'error':
        return content.includes('error') || content.includes('fix') || content.includes('solution') ||
               (message.context?.errorPatterns?.length || 0) > 0;
      
      case 'implementation':
        return content.includes('implement') || content.includes('create') || content.includes('function') ||
               (message.context?.codeSnippets?.length || 0) > 0;
      
      case 'analysis':
        return content.includes('analyze') || content.includes('understand') || content.includes('explain') ||
               message.type === 'assistant' && content.length > 100;
      
      default:
        // General: must have tool usage or be substantial assistant response
        return (message.context?.toolsUsed?.length || 0) > 0 || 
               (message.type === 'assistant' && content.length > 80);
    }
  }

  private selectTopRelevantResults(
    candidates: CompactMessage[],
    query: string,
    analysis: any,
    limit: number
  ): CompactMessage[] {
    // Enhanced scoring with semantic boosts
    const scoredCandidates = candidates.map(msg => {
      let score = msg.relevanceScore || 0;
      
      // Apply semantic boosts from analysis
      Object.entries(analysis.semanticBoosts).forEach(([type, boost]) => {
        if (this.messageMatchesSemanticType(msg, type)) {
          score *= (boost as number);
        }
      });
      
      // Recency boost for time-sensitive queries
      if (analysis.urgency === 'high') {
        const timestamp = new Date(msg.timestamp);
        const now = new Date();
        const hoursDiff = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
        if (hoursDiff < 24) score *= 1.5;
      }
      
      return { ...msg, finalScore: score };
    });
    
    // Sort by final score and deduplicate
    const sorted = scoredCandidates
      .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
    
    const deduped = this.intelligentDeduplicate(sorted);
    
    return deduped.slice(0, limit);
  }

  private messageMatchesSemanticType(message: CompactMessage, type: string): boolean {
    const content = message.content.toLowerCase();
    
    switch (type) {
      case 'errorResolution':
        return content.includes('error') || content.includes('exception') || 
               (message.context?.errorPatterns?.length || 0) > 0;
      case 'implementation':
        return content.includes('function') || content.includes('implement') ||
               (message.context?.codeSnippets?.length || 0) > 0;
      case 'optimization':
        return content.includes('optimize') || content.includes('performance') ||
               content.includes('faster');
      case 'solutions':
        return content.includes('solution') || content.includes('fix') || content.includes('resolve');
      case 'fileOperations':
        return (message.context?.filesReferenced?.length || 0) > 0;
      case 'toolUsage':
        return (message.context?.toolsUsed?.length || 0) > 0;
      default:
        return false;
    }
  }

  private intelligentDeduplicate(messages: any[]): CompactMessage[] {
    const seen = new Map<string, CompactMessage>();
    
    for (const message of messages) {
      // Intelligent deduplication using content signature
      const signature = this.createIntelligentSignature(message);
      
      if (!seen.has(signature)) {
        seen.set(signature, message);
      } else {
        // Keep the one with higher final score
        const existing = seen.get(signature)!;
        if ((message.finalScore || 0) > (existing.finalScore || 0)) {
          seen.set(signature, message);
        }
      }
    }
    
    return Array.from(seen.values());
  }

  private createIntelligentSignature(message: CompactMessage): string {
    // Create an intelligent signature for deduplication
    const contentHash = message.content
      .toLowerCase()
      .replace(/\d+/g, 'N')
      .replace(/["']/g, '')
      .replace(/\s+/g, ' ')
      .substring(0, 80);
    
    const tools = (message.context?.toolsUsed || []).sort().join('|');
    const files = (message.context?.filesReferenced || []).length > 0 ? 'files' : 'nofiles';
    
    return `${message.type}:${tools}:${files}:${contentHash}`;
  }

  private async processProjectDirectory(
    projectDir: string,
    query: string,
    timeFilter: ((timestamp: string) => boolean) | undefined,
    targetLimit: number
  ): Promise<{ summary: CompactMessage[], regular: CompactMessage[] }> {
    const summaryMessages: CompactMessage[] = [];
    const regularMessages: CompactMessage[] = [];

    try {
      const jsonlFiles = await findJsonlFiles(projectDir);
      
      // Parallel processing of files within the project
      const fileResults = await Promise.allSettled(
        jsonlFiles.slice(0, Math.min(jsonlFiles.length, 8)).map(file => 
          this.processJsonlFile(projectDir, file, query, timeFilter)
        )
      );

      // Aggregate results from all files
      for (const result of fileResults) {
        if (result.status === 'fulfilled') {
          const messages = result.value;
          
          // Fast pre-filter: only process messages with minimum relevance
          const qualifyingMessages = messages.filter((msg) => (msg.relevanceScore || 0) >= 1);

          // Intelligent message categorization for Claude Code
          qualifyingMessages.forEach((msg) => {
            if (this.isSummaryMessage(msg)) {
              summaryMessages.push(msg);
            } else if (this.isHighValueMessage(msg)) {
              regularMessages.push(msg);
            }
          });

          // Early exit if we have enough results
          if (summaryMessages.length + regularMessages.length >= targetLimit) {
            break;
          }
        }
      }
    } catch (error) {
      console.error(`Error processing project ${projectDir}:`, error);
    }

    return { summary: summaryMessages, regular: regularMessages };
  }

  private async processJsonlFile(
    projectDir: string,
    file: string,
    query: string,
    timeFilter: ((timestamp: string) => boolean) | undefined
  ): Promise<CompactMessage[]> {
    const cacheKey = `${projectDir}/${file}`;

    // Check cache first
    if (this.messageCache.has(cacheKey)) {
      return this.messageCache.get(cacheKey)!;
    }

    // Parse file
    const messages = await this.parser.parseJsonlFile(projectDir, file, query, timeFilter);
    
    // Enhanced caching with increased size limit
    if (this.messageCache.size < 500) { // Increased from 100
      this.messageCache.set(cacheKey, messages);
    } else if (messages.some((m) => (m.relevanceScore || 0) > 8)) {
      // Replace least valuable cache entry with high-value content
      const cacheEntries = Array.from(this.messageCache.entries());
      const leastValuable = cacheEntries.reduce(
        (min, [key, msgs]) => {
          const avgScore = msgs.reduce((sum, m) => sum + (m.relevanceScore || 0), 0) / msgs.length;
          return avgScore < (min.avgScore || Infinity) ? { key, avgScore } : min;
        },
        { key: '', avgScore: Infinity }
      );

      if (leastValuable.key) {
        this.messageCache.delete(leastValuable.key);
        this.messageCache.set(cacheKey, messages);
      }
    }

    return messages;
  }

  private prioritizeResultsForClaudeCode(
    summaryMessages: CompactMessage[],
    allMessages: CompactMessage[],
    query: string,
    limit: number
  ): CompactMessage[] {
    // Sort by relevance and recency
    const sortedSummaries = summaryMessages
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, Math.ceil(limit * 0.3)); // 30% summaries

    const sortedRegular = allMessages
      .sort((a, b) => {
        const relevanceDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (Math.abs(relevanceDiff) > 1) return relevanceDiff;
        
        // Secondary sort by recency for similar relevance
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      })
      .slice(0, limit - sortedSummaries.length);

    // Combine and deduplicate
    const combined = [...sortedSummaries, ...sortedRegular];
    const deduped = this.deduplicateMessages(combined);
    
    return deduped.slice(0, limit);
  }

  private deduplicateMessages(messages: CompactMessage[]): CompactMessage[] {
    const seen = new Set<string>();
    const unique: CompactMessage[] = [];

    for (const message of messages) {
      // Create a simple content hash for deduplication
      const contentHash = message.content.substring(0, 100).toLowerCase().replace(/\s+/g, '');
      
      if (!seen.has(contentHash)) {
        seen.add(contentHash);
        unique.push(message);
      }
    }

    return unique;
  }

  private isSummaryMessage(message: CompactMessage): boolean {
    const content = message.content.toLowerCase();
    const summaryIndicators = [
      'summary:',
      'in summary',
      'to recap',
      "here's what we accomplished",
      'let me summarize',
      'to sum up',
      'overview:',
      'in conclusion',
      'final summary',
      'session summary',
    ];

    return (
      summaryIndicators.some((indicator) => content.includes(indicator)) ||
      (message.type === 'assistant' && content.includes('summary') && content.length > 100)
    );
  }

  private isHighValueMessage(message: CompactMessage): boolean {
    const relevanceScore = message.relevanceScore || 0;
    const content = message.content.toLowerCase();

    // Always include high relevance scores
    if (relevanceScore >= 5) return true;

    // Include tool usage messages - crucial for Claude Code
    if (message.context?.toolsUsed && (message.context.toolsUsed.length || 0) > 0) return true;

    // Include error resolution messages
    if (message.context?.errorPatterns && (message.context.errorPatterns.length || 0) > 0) return true;

    // Include file operation messages
    if (message.context?.filesReferenced && (message.context.filesReferenced.length || 0) > 0) return true;

    // Include assistant messages with substantial solutions
    if (message.type === 'assistant' && content.length > 200 && relevanceScore > 0) return true;

    // Include user messages that are substantial queries
    if (
      message.type === 'user' &&
      content.length > 50 &&
      content.length < 500 &&
      relevanceScore > 0
    )
      return true;

    return false;
  }

  private classifyQueryType(query: string): 'error' | 'implementation' | 'analysis' | 'general' {
    const lowerQuery = query.toLowerCase();

    if (
      lowerQuery.includes('error') ||
      lowerQuery.includes('bug') ||
      lowerQuery.includes('fix') ||
      lowerQuery.includes('issue')
    ) {
      return 'error';
    }
    if (
      lowerQuery.includes('implement') ||
      lowerQuery.includes('create') ||
      lowerQuery.includes('build') ||
      lowerQuery.includes('add')
    ) {
      return 'implementation';
    }
    if (
      lowerQuery.includes('how') ||
      lowerQuery.includes('why') ||
      lowerQuery.includes('analyze') ||
      lowerQuery.includes('understand')
    ) {
      return 'analysis';
    }
    return 'general';
  }

  private getOptimalLimit(queryType: string, requestedLimit: number): number {
    // Return exactly what the user requested - no artificial caps
    return requestedLimit;
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
      const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 2);
      const contentWords = lowerContent.split(/\s+/);
      const matches = queryWords.filter((word) =>
        contentWords.some((cWord) => cWord.includes(word))
      );
      score += matches.length * 3;

      // High bonus for tool usage - essential for Claude Code queries
      if (message.type === 'tool_use' || message.type === 'tool_result') score += 8;
      if (lowerContent.includes('tool_use') || lowerContent.includes('called the')) score += 6;

      // Code file references - crucial for development queries
      if (content.includes('.ts') || content.includes('.js') || content.includes('src/'))
        score += 4;
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

  async findFileContext(filePath: string, limit: number = 25): Promise<FileContext[]> {
    const fileContexts: FileContext[] = [];

    try {
      const projectDirs = await findProjectDirectories();
      
      // COMPREHENSIVE: Process more projects to match GLOBAL's reach
      const limitedDirs = projectDirs.slice(0, 15); // Increased significantly to match GLOBAL scope

      // PARALLEL PROCESSING: Process all projects concurrently
      const projectResults = await Promise.allSettled(
        limitedDirs.map(async (projectDir) => {
          const jsonlFiles = await findJsonlFiles(projectDir);
          
          // COMPREHENSIVE: Process more files to match GLOBAL's reach
          const limitedFiles = jsonlFiles.slice(0, 10); // Increased to match GLOBAL scope
          
          const fileResults = await Promise.allSettled(
            limitedFiles.map(async (file) => {
              const messages = await this.parser.parseJsonlFile(projectDir, file);
              

              const fileMessages = messages.filter((msg) => {
                // ENHANCED file matching logic like GLOBAL with more patterns
                const hasFileRef = msg.context?.filesReferenced?.some(
                  (ref) => {
                    const refLower = ref.toLowerCase();
                    const pathLower = filePath.toLowerCase();
                    // More comprehensive matching patterns
                    return refLower.includes(pathLower) || 
                           pathLower.includes(refLower) ||
                           refLower.endsWith('/' + pathLower) ||
                           pathLower.endsWith('/' + refLower) ||
                           refLower.split('/').pop() === pathLower ||
                           pathLower.split('/').pop() === refLower ||
                           refLower === pathLower ||
                           refLower.includes(pathLower.replace(/\\/g, '/')) ||
                           refLower.includes(pathLower.replace(/\//g, '\\'));
                  }
                );
                
                // Enhanced content matching with case variations and path separators
                const contentLower = msg.content.toLowerCase();
                const pathVariations = [
                  filePath.toLowerCase(),
                  filePath.toLowerCase().replace(/\\/g, '/'),
                  filePath.toLowerCase().replace(/\//g, '\\'),
                  filePath.toLowerCase().split('/').pop() || '',
                  filePath.toLowerCase().split('\\').pop() || ''
                ];
                
                const hasContentRef = pathVariations.some(variation => 
                  variation.length > 0 && contentLower.includes(variation)
                );
                
                // Enhanced git pattern matching
                const hasGitRef = /(?:modified|added|deleted|new file|renamed|M\s+|A\s+|D\s+)[\s:]*[^\n]*/.test(msg.content) && 
                                  pathVariations.some(variation => 
                                    variation.length > 0 && contentLower.includes(variation)
                                  );
                                  
                
                return hasFileRef || hasContentRef || hasGitRef;
              });

              if (fileMessages.length > 0) {
                // Claude-optimized filtering - preserve valuable context
                const cleanFileMessages = fileMessages.filter(msg => {
                  return msg.content.length > 15 && !this.isLowValueContent(msg.content);
                });
                
                const dedupedMessages = SearchHelpers.deduplicateByContent(cleanFileMessages);
                
                if (dedupedMessages.length > 0) {
                  // Group by operation type (heuristic)
                  const operationType = SearchHelpers.inferOperationType(dedupedMessages);

                  return {
                    filePath,
                    lastModified: dedupedMessages[0]?.timestamp || '',
                    relatedMessages: dedupedMessages.slice(0, Math.min(limit, 10)), // More context for Claude
                    operationType,
                  };
                }
              }
              return null;
            })
          );
          
          // Collect successful file results
          const validContexts: FileContext[] = [];
          for (const result of fileResults) {
            if (result.status === 'fulfilled' && result.value) {
              validContexts.push(result.value);
            }
          }
          
          return validContexts;
        })
      );

      // Aggregate all results from parallel processing
      for (const result of projectResults) {
        if (result.status === 'fulfilled') {
          fileContexts.push(...result.value);
        }
      }

      return fileContexts.sort(
        (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
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
      
      // BALANCED: More projects for better coverage, early termination for speed
      const limitedDirs = projectDirs.slice(0, 8);

      for (const projectDir of limitedDirs) {
        const jsonlFiles = await findJsonlFiles(projectDir);
        
        // BALANCED: More files per project for better context
        const limitedFiles = jsonlFiles.slice(0, 5);

        for (const file of limitedFiles) {
          const messages = await this.parser.parseJsonlFile(projectDir, file);

          // Find user messages (queries) that are similar and valuable
          const userQueries = messages.filter(
            (msg) => msg.type === 'user' && 
                     msg.content.length > 15 && 
                     msg.content.length < 800 && 
                     !this.isLowValueContent(msg.content) // Only quality queries
          );

          for (const query of userQueries) {
            const similarity = SearchHelpers.calculateQuerySimilarity(targetQuery, query.content);
            // Lowered threshold from 0.3 to 0.1 and added partial matching
            if (similarity > 0.2 || SearchHelpers.hasExactKeywords(targetQuery, query.content)) {
              query.relevanceScore = similarity;
              allMessages.push(query);
            }
          }
          
          // SPEED FIX: Early termination when we have enough candidates
          if (allMessages.length >= limit * 4) break;
        }
        
        if (allMessages.length >= limit * 4) break;
      }

      // Quality filter and return only if we have valuable results
      const qualityResults = allMessages
        .filter(msg => !this.isLowValueContent(msg.content))
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, limit);
        
      return qualityResults;
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

      // BALANCED: More projects for better coverage, still much faster than sequential
      const limitedDirs = projectDirs.slice(0, 12); // Increased for better coverage

      // PARALLEL PROCESSING: Process all projects concurrently
      const projectResults = await Promise.allSettled(
        limitedDirs.map(async (projectDir) => {
          const jsonlFiles = await findJsonlFiles(projectDir);
          
          // BALANCED: More files for better coverage 
          const limitedFiles = jsonlFiles.slice(0, 6);
          
          const projectErrorMap = new Map<string, CompactMessage[]>();
          
          // PARALLEL: Process files within project simultaneously
          const fileResults = await Promise.allSettled(
            limitedFiles.map(async (file) => {
              const messages = await this.parser.parseJsonlFile(projectDir, file);

              // Find error patterns and their solutions
              for (let i = 0; i < messages.length - 1; i++) {
                const current = messages[i];

                if (
                  current.context?.errorPatterns?.some((err) =>
                    err.toLowerCase().includes(errorPattern.toLowerCase())
                  ) ||
                  SearchHelpers.hasErrorInContent(current.content, errorPattern)
                ) {
                  const errorKey = current.context?.errorPatterns?.[0] || errorPattern;

                  if (!projectErrorMap.has(errorKey)) {
                    projectErrorMap.set(errorKey, []);
                  }

                  // Include the error message and the next few messages as potential solutions
                  const solutionMessages = messages
                    .slice(i, i + 5) // Get more context for better solutions
                    .filter((msg) => 
                      msg.type === 'assistant' || 
                      msg.type === 'tool_result' ||
                      (msg.type === 'user' && msg.content.length < 200) // Include short user clarifications
                    );

                  projectErrorMap.get(errorKey)!.push(...solutionMessages);
                }
              }
            })
          );
          
          return projectErrorMap;
        })
      );

      // Aggregate results from parallel processing
      for (const result of projectResults) {
        if (result.status === 'fulfilled') {
          const projectErrorMap = result.value;
          for (const [pattern, msgs] of projectErrorMap.entries()) {
            if (!errorMap.has(pattern)) {
              errorMap.set(pattern, []);
            }
            errorMap.get(pattern)!.push(...msgs);
          }
        }
      }

      // Convert to ErrorSolution format
      for (const [pattern, msgs] of errorMap.entries()) {
        // Only include solutions with substantial, actionable content
        const qualitySolutions = msgs.filter(msg => 
          !this.isLowValueContent(msg.content) && 
          msg.content.length >= 60 && // Must be substantial
          (msg.content.includes('solution') || msg.content.includes('fix') || msg.content.includes('resolved'))
        );
        
        if (qualitySolutions.length > 0) {
          solutions.push({
            errorPattern: pattern,
            solution: qualitySolutions.slice(0, 3),
            context: SearchHelpers.extractSolutionContext(qualitySolutions),
            frequency: msgs.length,
          });
        }
      }

      return solutions.sort((a, b) => b.frequency - a.frequency).slice(0, limit);
    } catch (error) {
      console.error('Error solution search error:', error);
      return [];
    }
  }

  async getToolPatterns(toolName?: string, limit: number = 20): Promise<ToolPattern[]> {
    const toolMap = new Map<string, CompactMessage[]>();
    const workflowMap = new Map<string, CompactMessage[]>();

    try {
      const projectDirs = await findProjectDirectories();
      const limitedDirs = projectDirs.slice(0, 15);

      // Focus on core Claude Code tools that GLOBAL would recognize
      const coreTools = new Set(['Edit', 'Read', 'Bash', 'Grep', 'Glob', 'Write', 'Task', 'MultiEdit', 'Notebook']);

      // PARALLEL PROCESSING: Process all projects concurrently
      const projectResults = await Promise.allSettled(
        limitedDirs.map(async (projectDir) => {
          const jsonlFiles = await findJsonlFiles(projectDir);
          const limitedFiles = jsonlFiles.slice(0, 8);
          
          const projectToolMap = new Map<string, CompactMessage[]>();
          const projectWorkflowMap = new Map<string, CompactMessage[]>();
          
          // PARALLEL: Process files within project simultaneously
          const fileResults = await Promise.allSettled(
            limitedFiles.map(async (file) => {
              const messages = await this.parser.parseJsonlFile(projectDir, file);

              // Extract individual tool usage patterns
              for (const msg of messages) {
                if (msg.context?.toolsUsed?.length) {
                  for (const tool of msg.context.toolsUsed) {
                    // Only track core tools to match GLOBAL's focus
                    if (coreTools.has(tool) || !toolName || tool === toolName) {
                      if (!projectToolMap.has(tool)) {
                        projectToolMap.set(tool, []);
                      }
                      projectToolMap.get(tool)!.push(msg);
                    }
                  }
                }
              }

              // Extract workflow patterns (tool sequences)
              for (let i = 0; i < messages.length - 1; i++) {
                const current = messages[i];
                const next = messages[i + 1];
                
                if (current.context?.toolsUsed?.length && next.context?.toolsUsed?.length) {
                  // Create focused workflow patterns like GLOBAL: "Edit → Read"
                  for (const currentTool of current.context.toolsUsed) {
                    for (const nextTool of next.context.toolsUsed) {
                      // Only create workflows with core tools
                      if ((coreTools.has(currentTool) || !toolName || currentTool === toolName) &&
                          (coreTools.has(nextTool) || !toolName || nextTool === toolName)) {
                        const workflowKey = `${currentTool} → ${nextTool}`;
                        if (!projectWorkflowMap.has(workflowKey)) {
                          projectWorkflowMap.set(workflowKey, []);
                        }
                        projectWorkflowMap.get(workflowKey)!.push(current, next);
                      }
                    }
                  }
                }
              }

              // Also create longer sequences for complex workflows
              for (let i = 0; i < messages.length - 2; i++) {
                const first = messages[i];
                const second = messages[i + 1];
                const third = messages[i + 2];
                
                if (first.context?.toolsUsed?.length && 
                    second.context?.toolsUsed?.length && 
                    third.context?.toolsUsed?.length) {
                  
                  for (const firstTool of first.context.toolsUsed) {
                    for (const secondTool of second.context.toolsUsed) {
                      for (const thirdTool of third.context.toolsUsed) {
                        // Create 3-step workflows like "Edit → Read → findtoolpatterns"
                        if (coreTools.has(firstTool) && coreTools.has(secondTool)) {
                          const workflowKey = `${firstTool} → ${secondTool} → ${thirdTool}`;
                          if (!projectWorkflowMap.has(workflowKey)) {
                            projectWorkflowMap.set(workflowKey, []);
                          }
                          projectWorkflowMap.get(workflowKey)!.push(first, second, third);
                        }
                      }
                    }
                  }
                }
              }
            })
          );
          
          return { tools: projectToolMap, workflows: projectWorkflowMap };
        })
      );

      // Aggregate results from parallel processing
      for (const result of projectResults) {
        if (result.status === 'fulfilled') {
          // Aggregate individual tools
          for (const [tool, messages] of result.value.tools.entries()) {
            if (!toolMap.has(tool)) {
              toolMap.set(tool, []);
            }
            toolMap.get(tool)!.push(...messages);
          }
          
          // Aggregate workflows
          for (const [workflow, messages] of result.value.workflows.entries()) {
            if (!workflowMap.has(workflow)) {
              workflowMap.set(workflow, []);
            }
            workflowMap.get(workflow)!.push(...messages);
          }
        }
      }

      const patterns: ToolPattern[] = [];
      
      // ENHANCED: Create diverse patterns like GLOBAL showing related tools with workflows
      const toolFrequency = new Map<string, number>();
      
      // First pass: Calculate tool frequencies for prioritization
      for (const [tool, messages] of toolMap.entries()) {
        toolFrequency.set(tool, messages.length);
      }
      
      // Add diverse individual tool patterns (different tools, not just highest frequency)
      const usedTools = new Set<string>();
      for (const [tool, messages] of Array.from(toolMap.entries()).sort((a, b) => b[1].length - a[1].length)) {
        if (messages.length >= 1 && !usedTools.has(tool) && patterns.length < limit) {
          const uniqueMessages = SearchHelpers.deduplicateByContent(messages);
          patterns.push({
            toolName: tool,
            successfulUsages: uniqueMessages.slice(0, 10),
            commonPatterns: [`${tool} usage pattern`],
            bestPractices: [`${tool} used ${uniqueMessages.length}x successfully`],
          });
          usedTools.add(tool);
        }
      }

      // Add related workflow patterns for each tool (like GLOBAL's approach)
      for (const tool of usedTools) {
        // Find workflows involving this tool
        for (const [workflow, messages] of workflowMap.entries()) {
          if (workflow.includes(tool) && workflow.includes('→') && messages.length >= 1) {
            const uniqueMessages = SearchHelpers.deduplicateByContent(messages);
            // Only add if not already added and we have space
            if (!patterns.some(p => p.toolName === workflow) && patterns.length < limit) {
              patterns.push({
                toolName: workflow,
                successfulUsages: uniqueMessages.slice(0, 10),
                commonPatterns: [workflow],
                bestPractices: [`${workflow} workflow (${uniqueMessages.length}x successful)`],
              });
            }
          }
        }
      }

      // If we still have space, add any remaining high-frequency workflows
      for (const [workflow, messages] of Array.from(workflowMap.entries()).sort((a, b) => b[1].length - a[1].length)) {
        if (workflow.includes('→') && messages.length >= 1 && patterns.length < limit) {
          if (!patterns.some(p => p.toolName === workflow)) {
            const uniqueMessages = SearchHelpers.deduplicateByContent(messages);
            patterns.push({
              toolName: workflow,
              successfulUsages: uniqueMessages.slice(0, 10),
              commonPatterns: [workflow],
              bestPractices: [`${workflow} workflow (${uniqueMessages.length}x successful)`],
            });
          }
        }
      }

      // Sort to prioritize individual tools, then their related workflows
      return patterns
        .sort((a, b) => {
          const aIsWorkflow = a.toolName.includes('→');
          const bIsWorkflow = b.toolName.includes('→');
          
          // Individual tools first, then workflows, then by usage frequency
          if (aIsWorkflow !== bIsWorkflow) {
            return aIsWorkflow ? 1 : -1;
          }
          
          return b.successfulUsages.length - a.successfulUsages.length;
        })
        .slice(0, limit);
    } catch (error) {
      console.error('Tool pattern search error:', error);
      return [];
    }
  }

  async getRecentSessions(limit: number = 10): Promise<any[]> {
    try {
      // OPTIMIZED: Fast session discovery with parallel processing and early termination
      const projectDirs = await findProjectDirectories();
      
      // PERFORMANCE: Limit projects and use parallel processing like GLOBAL
      const limitedDirs = projectDirs.slice(0, 10); // Limit projects for speed
      
      // PARALLEL PROCESSING: Process projects concurrently
      const projectResults = await Promise.allSettled(
        limitedDirs.map(async (projectDir) => {
          const jsonlFiles = await findJsonlFiles(projectDir);
          const decodedPath = projectDir.replace(/-/g, '/');
          const projectName = decodedPath.split('/').pop() || 'unknown';
          
          // PERFORMANCE: Limit files per project and process in parallel
          const limitedFiles = jsonlFiles.slice(0, 5); // Limit files for speed
          
          const sessionResults = await Promise.allSettled(
            limitedFiles.map(async (file) => {
              const messages = await this.parser.parseJsonlFile(projectDir, file);
              
              if (messages.length === 0) return null;
              
              // Fast extraction of session data
              const toolsUsed = [...new Set(messages.flatMap(m => m.context?.toolsUsed || []))];
              const startTime = messages[0]?.timestamp;
              const endTime = messages[messages.length - 1]?.timestamp;
              
              // Quick duration calculation
              let realDuration = 0;
              if (startTime && endTime) {
                realDuration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
              }
              
              return {
                session_id: file.replace('.jsonl', ''),
                project_path: decodedPath,
                project_dir: projectDir,
                project_name: projectName,
                message_count: messages.length,
                duration_minutes: realDuration,
                end_time: endTime,
                start_time: startTime,
                tools_used: toolsUsed.slice(0, 5), // Limit tools for speed
                assistant_count: messages.filter(m => m.type === 'assistant').length,
                error_count: messages.filter(m => m.context?.errorPatterns?.length).length,
                session_quality: this.calculateSessionQuality(messages, toolsUsed, [])
              };
            })
          );
          
          // Collect successful session results
          return sessionResults
            .filter(result => result.status === 'fulfilled' && result.value)
            .map(result => (result as PromiseFulfilledResult<any>).value);
        })
      );
      
      // Flatten and collect all sessions
      const realSessions: any[] = [];
      for (const result of projectResults) {
        if (result.status === 'fulfilled') {
          realSessions.push(...result.value);
        }
      }

      // Sort by real end time
      return realSessions
        .filter(s => s.end_time) // Only sessions with real timestamps
        .sort((a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime())
        .slice(0, limit);
    } catch (error) {
      console.error('Recent sessions error:', error);
      return [];
    }
  }

  private calculateSessionQuality(messages: any[], toolsUsed: string[], errorMessages: any[]): string {
    const score = toolsUsed.length * 10 + (messages.length * 0.5) - (errorMessages.length * 5);
    if (score > 50) return 'excellent';
    if (score > 25) return 'good';
    if (score > 10) return 'average';
    return 'poor';
  }

  async getSessionMessages(encodedProjectDir: string, sessionId: string): Promise<any[]> {
    try {
      // Direct access to specific session file
      const jsonlFile = `${sessionId}.jsonl`;
      
      const messages = await this.parser.parseJsonlFile(encodedProjectDir, jsonlFile);
      return messages;
    } catch (error) {
      console.error(`Error getting session messages for ${sessionId} in ${encodedProjectDir}:`, error);
      return [];
    }
  }

  private isLowValueContent(content: string): boolean {
    const lowerContent = content.toLowerCase();
    
    // Filter out only genuinely useless content - be conservative
    const lowValuePatterns = [
      'local-command-stdout>(no content)',
      'command-name>/doctor',
      'system-reminder>',
      'much better! now i can see',
      /^(ok|yes|no|sure|thanks)\.?$/,
      /^error:\s*$/,
      /^warning:\s*$/
    ];
    
    return lowValuePatterns.some(pattern => 
      typeof pattern === 'string' ? lowerContent.includes(pattern) : pattern.test(lowerContent)
    ) || content.trim().length < 20;
  }
}
