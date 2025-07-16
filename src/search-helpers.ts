import { CompactMessage, FileContext } from './types.js';

export class SearchHelpers {
  
  // Enhanced semantic query expansion for better search results
  static expandQuery(query: string): string[] {
    const baseQuery = query.toLowerCase().trim();
    const expansions = [baseQuery];
    
    // Technical term expansions
    const technicalExpansions: Record<string, string[]> = {
      'error': ['exception', 'fail', 'crash', 'bug', 'issue'],
      'fix': ['resolve', 'solve', 'repair', 'correct'],
      'implement': ['create', 'build', 'develop', 'add'],
      'optimize': ['improve', 'enhance', 'speed up', 'performance'],
      'debug': ['troubleshoot', 'diagnose', 'trace'],
      'deploy': ['publish', 'release', 'launch'],
      'test': ['verify', 'check', 'validate'],
      'config': ['configuration', 'settings', 'setup'],
      'auth': ['authentication', 'login', 'security'],
      'api': ['endpoint', 'service', 'request']
    };
    
    for (const [term, synonyms] of Object.entries(technicalExpansions)) {
      if (baseQuery.includes(term)) {
        expansions.push(...synonyms);
      }
    }
    
    // Pattern-based expansions
    if (baseQuery.includes('.ts')) expansions.push('typescript', 'type');
    if (baseQuery.includes('.js')) expansions.push('javascript');
    if (baseQuery.includes('npm')) expansions.push('package', 'dependency');
    if (baseQuery.includes('git')) expansions.push('version control', 'commit');
    
    return [...new Set(expansions)];
  }

  // Intelligent content deduplication
  static deduplicateByContent(messages: CompactMessage[]): CompactMessage[] {
    const seen = new Map<string, CompactMessage>();
    
    for (const message of messages) {
      const signature = this.createContentSignature(message);
      
      if (!seen.has(signature)) {
        seen.set(signature, message);
      } else {
        // Keep the message with higher relevance score
        const existing = seen.get(signature)!;
        if ((message.relevanceScore || 0) > (existing.relevanceScore || 0)) {
          seen.set(signature, message);
        }
      }
    }
    
    return Array.from(seen.values());
  }

  // Create a content signature for deduplication
  static createContentSignature(message: CompactMessage): string {
    const content = message.content.toLowerCase();
    
    // Extract key identifiers
    const files = (message.context?.filesReferenced || []).sort().join('|');
    const tools = (message.context?.toolsUsed || []).sort().join('|');
    const errors = (message.context?.errorPatterns || []).join('|');
    
    // Create normalized content hash
    const normalizedContent = content
      .replace(/\d+/g, 'N') // Replace numbers
      .replace(/['"]/g, '') // Remove quotes
      .replace(/\s+/g, ' ') // Normalize whitespace
      .substring(0, 200); // First 200 chars
    
    return `${files}:${tools}:${errors}:${normalizedContent}`;
  }

  // Enhanced relevance scoring for Claude's needs
  static calculateClaudeRelevance(message: CompactMessage, query: string): number {
    let score = message.relevanceScore || 0;
    const content = message.content.toLowerCase();
    const queryLower = query.toLowerCase();
    
    // Boost technical content
    const technicalBoosts = {
      'code': 2.0,
      'error': 1.8,
      'function': 1.5,
      'class': 1.5,
      'import': 1.3,
      'export': 1.3,
      'const': 1.2,
      'let': 1.2,
      'var': 1.2
    };
    
    for (const [term, boost] of Object.entries(technicalBoosts)) {
      if (content.includes(term)) {
        score *= boost;
      }
    }
    
    // Boost for query term matches
    const queryTerms = queryLower.split(/\s+/);
    queryTerms.forEach(term => {
      if (content.includes(term)) {
        score *= 1.1;
      }
    });
    
    // Boost recent messages
    const timestamp = new Date(message.timestamp);
    const now = new Date();
    const daysDiff = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysDiff < 1) score *= 1.5;
    else if (daysDiff < 7) score *= 1.2;
    else if (daysDiff < 30) score *= 1.1;
    
    // Boost based on content type
    if (message.context?.toolsUsed?.length) {
      score *= 1.3; // Messages with tool usage are more actionable
    }
    
    if (message.context?.filesReferenced?.length) {
      score *= 1.2; // File references provide concrete context
    }
    
    if (message.context?.errorPatterns?.length) {
      score *= 1.4; // Error patterns are valuable for debugging
    }
    
    // Boost assistant messages with solutions
    if (message.type === 'assistant' && 
        (content.includes('solution') || content.includes('fixed') || content.includes('resolved'))) {
      score *= 1.6;
    }
    
    return Math.min(score, 10); // Cap at 10
  }
  static inferOperationType(messages: CompactMessage[]): FileContext['operationType'] {
    const hasWrites = messages.some(
      (msg) =>
        msg.content.toLowerCase().includes('write') ||
        msg.content.toLowerCase().includes('edit') ||
        msg.context?.toolsUsed?.includes('Edit')
    );

    const hasReads = messages.some((msg) => msg.context?.toolsUsed?.includes('Read'));

    if (hasWrites) return 'edit';
    if (hasReads) return 'read';
    return 'read';
  }

  static calculateQuerySimilarity(query1: string, query2: string): number {
    const words1 = query1
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const words2 = query2
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (words1.length === 0 || words2.length === 0) return 0;

    // Enhanced semantic matching with technical term awareness
    const technicalSynonyms: Record<string, string[]> = {
      'error': ['exception', 'fail', 'crash', 'bug', 'issue', 'problem'],
      'fix': ['resolve', 'solve', 'repair', 'correct', 'solution'],
      'install': ['setup', 'configure', 'add', 'create'],
      'build': ['compile', 'bundle', 'deploy', 'package'],
      'test': ['verify', 'check', 'validate', 'debug'],
      'typescript': ['ts', 'type', 'interface'],
      'javascript': ['js', 'node', 'npm']
    };

    let totalScore = 0;
    const maxWords = Math.max(words1.length, words2.length);
    const minWords = Math.min(words1.length, words2.length);
    const matched2 = new Set<number>();

    for (let i = 0; i < words1.length; i++) {
      const word1 = words1[i];
      let bestMatch = 0;
      let bestIndex = -1;

      for (let j = 0; j < words2.length; j++) {
        if (matched2.has(j)) continue;

        const word2 = words2[j];
        let matchScore = 0;

        if (word1 === word2) {
          matchScore = 1.0;
        } else if (word1.includes(word2) || word2.includes(word1)) {
          const shorter = Math.min(word1.length, word2.length);
          const longer = Math.max(word1.length, word2.length);
          matchScore = 0.8 * (shorter / longer);
        } else if (this.isWordSimilar(word1, word2)) {
          matchScore = 0.6;
        } else {
          // Check semantic synonyms
          for (const [key, synonyms] of Object.entries(technicalSynonyms)) {
            if ((key === word1 && synonyms.includes(word2)) ||
                (key === word2 && synonyms.includes(word1)) ||
                (synonyms.includes(word1) && synonyms.includes(word2))) {
              matchScore = 0.7;
              break;
            }
          }
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

    // Boost score for technical queries
    const isTechnical = words1.some(w => ['error', 'fix', 'build', 'install', 'typescript', 'javascript'].includes(w)) ||
                       words2.some(w => ['error', 'fix', 'build', 'install', 'typescript', 'javascript'].includes(w));
    const technicalBoost = isTechnical ? 1.2 : 1.0;

    const lengthPenalty = minWords / maxWords;
    return Math.min((totalScore / maxWords) * lengthPenalty * technicalBoost, 1.0);
  }

  static hasExactKeywords(query1: string, query2: string): boolean {
    const keywords1 = query1
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const keywords2 = query2
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const techKeywords = [
      'error',
      'fix',
      'implement',
      'optimize',
      'debug',
      'build',
      'deploy',
      'test',
      'tool',
      'file',
      'code',
    ];
    const hasTechMatch = keywords1.some(
      (k1) => techKeywords.includes(k1) && keywords2.some((k2) => k2.includes(k1))
    );

    const sharedKeywords = keywords1.filter((k) =>
      keywords2.some((k2) => k === k2 || k.includes(k2) || k2.includes(k))
    );

    return hasTechMatch || sharedKeywords.length >= 2 || sharedKeywords.some((k) => k.length > 6);
  }

  static isWordSimilar(word1: string, word2: string): boolean {
    if (Math.abs(word1.length - word2.length) > 3) return false;

    const minLen = Math.min(word1.length, word2.length);
    if (minLen < 4) return false;

    const shared = minLen * 0.6;
    let matches = 0;

    for (let i = 0; i < minLen; i++) {
      if (word1[i] === word2[i]) matches++;
    }

    return matches >= shared;
  }

  static extractSolutionContext(messages: CompactMessage[]): string {
    return (
      messages
        .map((msg) => msg.content)
        .join(' ')
        .substring(0, 200) + '...'
    );
  }

  static extractCommonPatterns(messages: CompactMessage[]): string[] {
    const patterns = new Set<string>();
    const toolCombos = new Map<string, number>();
    const filePatterns = new Map<string, number>();

    messages.forEach((msg) => {
      if (msg.context?.toolsUsed && msg.context.toolsUsed.length > 0) {
        const toolCombo = msg.context.toolsUsed.sort().join(' → ');
        toolCombos.set(toolCombo, (toolCombos.get(toolCombo) || 0) + 1);
      }
      if (msg.context?.filesReferenced) {
        const fileTypes = msg.context.filesReferenced
          .map((f) => f.split('.').pop())
          .filter(Boolean);
        fileTypes.forEach((type) => filePatterns.set(type!, (filePatterns.get(type!) || 0) + 1));
      }
    });

    const topToolCombos = Array.from(toolCombos.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    topToolCombos.forEach(([combo, count]) => {
      patterns.add(`${combo} (${count}x successful)`);
    });

    const topFileTypes = Array.from(filePatterns.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    if (topFileTypes.length > 0) {
      patterns.add(
        `Common files: ${topFileTypes.map(([type, count]) => `${type} (${count}x)`).join(', ')}`
      );
    }

    return Array.from(patterns);
  }

  static extractBestPractices(): string[] {
    return [
      'Use appropriate tools for file operations',
      'Check file permissions before writing',
      'Validate input parameters',
    ];
  }

  static hasErrorInContent(content: string, errorPattern: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerPattern = errorPattern.toLowerCase();

    if (lowerContent.includes(lowerPattern)) return true;

    // Enhanced error pattern matching with fuzzy matching
    const errorKeywords = [
      'error:',
      'failed:',
      'exception:',
      'cannot',
      'unable to',
      'not found',
      'permission denied',
      'typeerror',
      'referenceerror', 
      'syntaxerror',
      'module not found',
      'compilation error'
    ];
    
    // Extract key words from error pattern for fuzzy matching
    const patternWords = lowerPattern.split(/[\s:_-]+/).filter(w => w.length > 2);
    
    return errorKeywords.some(
      (keyword) =>
        lowerContent.includes(keyword) && patternWords.some(word => lowerContent.includes(word))
    );
  }
}
