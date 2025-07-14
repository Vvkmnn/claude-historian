import { CompactMessage, FileContext } from './types.js';

export class SearchHelpers {
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
          matchScore = 0.7 * (shorter / longer);
        } else if (this.isWordSimilar(word1, word2)) {
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

    const lengthPenalty = minWords / maxWords;
    return Math.min((totalScore / maxWords) * lengthPenalty, 1.0);
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

    const errorKeywords = [
      'error:',
      'failed:',
      'exception:',
      'cannot',
      'unable to',
      'not found',
      'permission denied',
    ];
    return errorKeywords.some(
      (keyword) =>
        lowerContent.includes(keyword) && lowerContent.includes(lowerPattern.split('_')[0])
    );
  }
}
