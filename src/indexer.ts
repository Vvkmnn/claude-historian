import { stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';
import { ClaudeMessage, CompactMessage } from './types.js';
import { getClaudeProjectsPath, extractContentFromMessage } from './utils.js';

interface MessageIndex {
  uuid: string;
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  contentLength: number;
  hasFiles: boolean;
  hasTools: boolean;
  hasErrors: boolean;
  keywords: string[];
  projectDir: string;
  filename: string;
  lineNumber: number;
}

interface FileMetadata {
  projectDir: string;
  filename: string;
  size: number;
  messageCount: number;
  lastModified: string;
  hasRecentActivity: boolean;
  priority: number;
}

export class IntelligentIndexer {
  private index: Map<string, MessageIndex> = new Map();
  private fileMetadata: Map<string, FileMetadata> = new Map();
  private keywordMap: Map<string, Set<string>> = new Map(); // keyword -> message UUIDs
  private sessionMap: Map<string, Set<string>> = new Map(); // sessionId -> message UUIDs

  async buildIndex(projectDirs: string[]): Promise<void> {
    console.error('Building intelligent index...');
    const startTime = Date.now();
    const maxIndexTime = 30000; // Max 30 seconds for indexing
    const maxMemoryMessages = 50000; // Max messages in memory
    
    try {
      // First pass: collect file metadata and prioritize
      const fileQueue = await this.prioritizeFiles(projectDirs);
      
      // Second pass: index high-priority files first
      let indexedCount = 0;
      const maxFiles = Math.min(fileQueue.length, 100); // Limit for performance
      
      for (const file of fileQueue.slice(0, maxFiles)) {
        // Time-based circuit breaker
        if (Date.now() - startTime > maxIndexTime) {
          console.error(`Index building stopped after ${maxIndexTime}ms timeout`);
          break;
        }
        
        // Memory-based circuit breaker
        if (this.index.size > maxMemoryMessages) {
          console.error(`Index building stopped after reaching ${maxMemoryMessages} message limit`);
          break;
        }
        
        try {
          await this.indexFile(file);
          indexedCount++;
          
          if (indexedCount % 10 === 0) {
            const elapsed = Date.now() - startTime;
            console.error(`Indexed ${indexedCount}/${maxFiles} files... (${elapsed}ms)`);
          }
        } catch (fileError) {
          console.error(`Failed to index file ${file.filename}:`, fileError);
          // Continue with next file instead of crashing
          continue;
        }
      }
      
      const totalTime = Date.now() - startTime;
      console.error(`Index built: ${this.index.size} messages from ${indexedCount} files in ${totalTime}ms`);
      
    } catch (error) {
      console.error('Critical error during index building:', error);
      // Ensure we don't crash - return partial index
    }
  }

  private async prioritizeFiles(projectDirs: string[]): Promise<FileMetadata[]> {
    const files: FileMetadata[] = [];
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    for (const projectDir of projectDirs) {
      try {
        const projectPath = join(getClaudeProjectsPath(), projectDir);
        const { readdir } = await import('fs/promises');
        const entries = await readdir(projectPath);
        
        for (const filename of entries) {
          if (!filename.endsWith('.jsonl')) continue;
          
          const filePath = join(projectPath, filename);
          const stats = await stat(filePath);
          
          // Quick scan to estimate message count
          const messageCount = await this.estimateMessageCount(filePath);
          
          const hasRecentActivity = stats.mtime > oneWeekAgo;
          const priority = this.calculateFilePriority(stats.size, messageCount, hasRecentActivity);
          
          files.push({
            projectDir,
            filename,
            size: stats.size,
            messageCount,
            lastModified: stats.mtime.toISOString(),
            hasRecentActivity,
            priority
          });
        }
      } catch (error) {
        console.error(`Error processing project ${projectDir}:`, error);
      }
    }
    
    // Sort by priority (high priority first)
    return files.sort((a, b) => b.priority - a.priority);
  }

  private async estimateMessageCount(filePath: string): Promise<number> {
    // Quick line count estimation
    try {
      const fileStream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = createInterface({ input: fileStream });
      
      let count = 0;
      for await (const line of rl) {
        if (line.trim()) count++;
        if (count > 1000) break; // Cap estimation for performance
      }
      
      return count;
    } catch {
      return 0;
    }
  }

  private calculateFilePriority(size: number, messageCount: number, hasRecentActivity: boolean): number {
    let priority = 0;
    
    // Recent activity boost
    if (hasRecentActivity) priority += 100;
    
    // Moderate size files are often most useful (not too small, not too large)
    if (size > 10000 && size < 1000000) priority += 50;
    
    // Files with moderate message counts are typically more useful
    if (messageCount > 10 && messageCount < 500) priority += 30;
    
    // Penalize very large files (performance cost)
    if (size > 5000000) priority -= 50;
    
    return priority;
  }

  private async indexFile(file: FileMetadata): Promise<void> {
    const filePath = join(getClaudeProjectsPath(), file.projectDir, file.filename);
    const maxLinesPerFile = 5000; // Prevent runaway processing
    const maxLineSizeBytes = 100000; // 100KB max per line
    
    try {
      const fileStream = createReadStream(filePath, { 
        encoding: 'utf8',
        highWaterMark: 64 * 1024 // 64KB chunks for better memory management
      });
      const rl = createInterface({ 
        input: fileStream,
        crlfDelay: Infinity
      });
      
      let lineNumber = 0;
      let processedLines = 0;
      let skippedLines = 0;
      
      for await (const line of rl) {
        lineNumber++;
        
        // Circuit breakers for safety
        if (lineNumber > maxLinesPerFile) {
          console.error(`File ${file.filename} exceeded max lines (${maxLinesPerFile}), stopping processing`);
          break;
        }
        
        if (!line.trim()) continue;
        
        // Skip extremely large lines that could cause memory issues
        if (Buffer.byteLength(line, 'utf8') > maxLineSizeBytes) {
          skippedLines++;
          continue;
        }
        
        try {
          // Robust JSON parsing with size limits
          if (line.length > 500000) { // 500KB limit for JSON strings
            skippedLines++;
            continue;
          }
          
          const message: ClaudeMessage = JSON.parse(line);
          
          // Validate message structure to prevent crashes
          if (!this.isValidMessage(message)) {
            skippedLines++;
            continue;
          }
          
          const index = this.createMessageIndex(message, file, lineNumber);
          
          if (index) {
            this.index.set(index.uuid, index);
            this.updateMappings(index);
            processedLines++;
          }
          
        } catch (parseError) {
          // Skip malformed lines silently to prevent spam
          skippedLines++;
          continue;
        }
        
        // Yield control periodically to prevent blocking
        if (lineNumber % 1000 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      
      this.fileMetadata.set(`${file.projectDir}/${file.filename}`, file);
      
      if (skippedLines > 0) {
        console.error(`File ${file.filename}: processed ${processedLines}, skipped ${skippedLines} malformed/oversized lines`);
      }
      
    } catch (error) {
      console.error(`Error indexing file ${file.filename}:`, error);
      // Don't rethrow - continue with other files
    }
  }

  private isValidMessage(message: any): message is ClaudeMessage {
    try {
      return (
        message &&
        typeof message === 'object' &&
        typeof message.uuid === 'string' &&
        typeof message.sessionId === 'string' &&
        typeof message.timestamp === 'string' &&
        typeof message.type === 'string' &&
        message.uuid.length > 0 &&
        message.sessionId.length > 0 &&
        ['user', 'assistant', 'tool_use', 'tool_result'].includes(message.type)
      );
    } catch {
      return false;
    }
  }

  private createMessageIndex(
    message: ClaudeMessage, 
    file: FileMetadata, 
    lineNumber: number
  ): MessageIndex | null {
    try {
      const content = extractContentFromMessage(message.message || {});
      if (!content || content.length < 10 || content.length > 100000) return null;
      
      // Extract meaningful keywords (filter out common words) with safety limits
      const keywords = this.extractKeywords(content);
      if (keywords.length === 0) return null;
      
      const hasFiles = this.detectFileReferences(content);
      const hasTools = this.detectToolUsage(message);
      const hasErrors = this.detectErrors(content);
      
      return {
        uuid: message.uuid,
        sessionId: message.sessionId,
        timestamp: message.timestamp,
        type: message.type,
        contentLength: Math.min(content.length, 100000), // Cap for safety
        hasFiles,
        hasTools,
        hasErrors,
        keywords,
        projectDir: file.projectDir,
        filename: file.filename,
        lineNumber
      };
    } catch (error) {
      console.error(`Error creating message index for ${message.uuid}:`, error);
      return null;
    }
  }

  private extractKeywords(content: string): string[] {
    try {
      // Safety check for content size to prevent memory issues
      if (content.length > 50000) {
        content = content.substring(0, 50000);
      }
      
      const commonWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these', 'those',
        'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
        'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must',
        'file', 'code', 'function', 'class', 'method', 'variable', 'error', 'message'
      ]);
      
      const words = content
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => 
          word.length > 2 && 
          word.length < 30 && // Increased to catch technical terms
          !commonWords.has(word) &&
          !/^\d+$/.test(word)
        )
        .slice(0, 1000); // Limit processing to first 1000 words for performance
      
      // Return top keywords by frequency, but limit to prevent noise
      const wordCount = new Map<string, number>();
      words.forEach(word => {
        if (wordCount.size < 500) { // Limit map size for memory
          wordCount.set(word, (wordCount.get(word) || 0) + 1);
        }
      });
      
      return Array.from(wordCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15) // Slightly more keywords for better matching
        .map(([word]) => word);
        
    } catch (error) {
      console.error('Error extracting keywords:', error);
      return [];
    }
  }

  private detectFileReferences(content: string): boolean {
    const filePatterns = [
      /[\w\-\/\.]+\.(ts|js|json|md|py|java|cpp|c|h|css|html|yml|yaml|toml|rs|go)/i,
      /src\/[\w\-\/\.]+/i,
      /\.\/[\w\-\/\.]+/i,
      /\/[\w\-\/\.]+\//i
    ];
    
    return filePatterns.some(pattern => pattern.test(content));
  }

  private detectToolUsage(message: ClaudeMessage): boolean {
    if (message.type === 'tool_use' || message.type === 'tool_result') return true;
    
    const content = extractContentFromMessage(message.message || {});
    const toolKeywords = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'];
    
    return toolKeywords.some(tool => content.includes(tool));
  }

  private detectErrors(content: string): boolean {
    const errorPatterns = [
      /error[:\s]/i,
      /exception[:\s]/i,
      /failed[:\s]/i,
      /cannot[:\s]/i,
      /unable to[:\s]/i,
      /syntax error/i,
      /type error/i,
      /reference error/i
    ];
    
    return errorPatterns.some(pattern => pattern.test(content));
  }

  private updateMappings(index: MessageIndex): void {
    // Update keyword mappings
    index.keywords.forEach(keyword => {
      if (!this.keywordMap.has(keyword)) {
        this.keywordMap.set(keyword, new Set());
      }
      this.keywordMap.get(keyword)!.add(index.uuid);
    });
    
    // Update session mappings
    if (!this.sessionMap.has(index.sessionId)) {
      this.sessionMap.set(index.sessionId, new Set());
    }
    this.sessionMap.get(index.sessionId)!.add(index.uuid);
  }

  // Fast search methods using the index
  searchByKeywords(keywords: string[], limit: number = 50): MessageIndex[] {
    const keywordSet = new Set(keywords.map(k => k.toLowerCase()));
    const candidates = new Map<string, number>(); // uuid -> score
    
    // Find messages containing keywords
    keywordSet.forEach(keyword => {
      const messageIds = this.keywordMap.get(keyword) || new Set();
      messageIds.forEach(uuid => {
        candidates.set(uuid, (candidates.get(uuid) || 0) + 1);
      });
    });
    
    // Score and rank results
    return Array.from(candidates.entries())
      .map(([uuid, score]) => ({ 
        index: this.index.get(uuid)!, 
        score 
      }))
      .filter(item => item.index) // Remove any undefined entries
      .sort((a, b) => {
        // Primary sort: keyword matches
        if (b.score !== a.score) return b.score - a.score;
        
        // Secondary sort: content richness
        const aRichness = this.calculateContentRichness(a.index);
        const bRichness = this.calculateContentRichness(b.index);
        if (bRichness !== aRichness) return bRichness - aRichness;
        
        // Tertiary sort: recency
        return new Date(b.index.timestamp).getTime() - new Date(a.index.timestamp).getTime();
      })
      .slice(0, limit)
      .map(item => item.index);
  }

  searchByFilePattern(filePattern: string, limit: number = 20): MessageIndex[] {
    const pattern = filePattern.toLowerCase();
    
    return Array.from(this.index.values())
      .filter(idx => 
        idx.hasFiles && 
        idx.keywords.some(keyword => keyword.includes(pattern))
      )
      .sort((a, b) => {
        const aRichness = this.calculateContentRichness(a);
        const bRichness = this.calculateContentRichness(b);
        if (bRichness !== aRichness) return bRichness - aRichness;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      })
      .slice(0, limit);
  }

  searchErrorSolutions(errorPattern: string, limit: number = 10): MessageIndex[] {
    const pattern = errorPattern.toLowerCase();
    
    return Array.from(this.index.values())
      .filter(idx => 
        idx.hasErrors && 
        idx.keywords.some(keyword => keyword.includes(pattern))
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  getSessionMessages(sessionId: string): MessageIndex[] {
    const messageIds = this.sessionMap.get(sessionId) || new Set();
    return Array.from(messageIds)
      .map(uuid => this.index.get(uuid)!)
      .filter(Boolean)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  private calculateContentRichness(index: MessageIndex): number {
    let score = 0;
    
    if (index.hasFiles) score += 10;
    if (index.hasTools) score += 8;
    if (index.hasErrors) score += 5;
    if (index.contentLength > 100) score += 3;
    if (index.contentLength > 500) score += 2;
    if (index.keywords.length > 5) score += index.keywords.length;
    
    return score;
  }

  // Get index statistics
  getStats(): any {
    const totalMessages = this.index.size;
    const totalKeywords = this.keywordMap.size;
    const totalSessions = this.sessionMap.size;
    const filesWithTools = Array.from(this.index.values()).filter(idx => idx.hasTools).length;
    const filesWithErrors = Array.from(this.index.values()).filter(idx => idx.hasErrors).length;
    const filesWithFileRefs = Array.from(this.index.values()).filter(idx => idx.hasFiles).length;
    
    return {
      totalMessages,
      totalKeywords,
      totalSessions,
      filesWithTools,
      filesWithErrors,
      filesWithFileRefs,
      indexedFiles: this.fileMetadata.size
    };
  }

  // Fast message retrieval by index
  async getFullMessage(index: MessageIndex): Promise<ClaudeMessage | null> {
    const filePath = join(getClaudeProjectsPath(), index.projectDir, index.filename);
    
    try {
      const fileStream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = createInterface({ input: fileStream });
      
      let currentLine = 0;
      for await (const line of rl) {
        currentLine++;
        if (currentLine === index.lineNumber) {
          return JSON.parse(line);
        }
        if (currentLine > index.lineNumber) break;
      }
    } catch (error) {
      console.error(`Error retrieving message ${index.uuid}:`, error);
    }
    
    return null;
  }
}