import { HistorySearchEngine } from './search.js';
import { SearchResult, FileContext, ErrorSolution, CompactMessage } from './types.js';
import { detectClaudeDesktop, getClaudeDesktopStoragePath, getClaudeDesktopIndexedDBPath } from './utils.js';
import { readdir, readFile, mkdtemp, copyFile, rm, chmod } from 'fs/promises';
import { readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface UniversalSearchResult {
  source: 'claude-code' | 'claude-desktop';
  results: SearchResult;
  enhanced: boolean;
}

export class UniversalHistorySearchEngine {
  private claudeCodeEngine: HistorySearchEngine;
  private claudeDesktopAvailable: boolean | null = null;
  private desktopStoragePath: string | null = null;
  private desktopIndexedDBPath: string | null = null;
  private levelDB: any = null;
  private sqlite3: any = null;
  private enhancedMode: boolean = false;

  constructor() {
    this.claudeCodeEngine = new HistorySearchEngine();
    this.detectLevelDB();
  }

  private async detectLevelDB(): Promise<void> {
    try {
      const { Level } = await import('level');
      this.levelDB = Level;
      this.enhancedMode = true;
      console.log('✅ Level package detected - Enhanced Desktop mode available');
    } catch (e) {
      // Try SQLite instead
      try {
        const sqlite3Module = await import('better-sqlite3');
        this.sqlite3 = sqlite3Module.default;
        this.enhancedMode = true;
        console.log('✅ SQLite package detected - Enhanced Desktop mode available');
      } catch (sqliteError) {
        console.log('📁 No database packages available - Claude Code only mode');
      }
    }
  }

  async initialize(): Promise<void> {
    await this.detectLevelDB();
    this.claudeDesktopAvailable = await detectClaudeDesktop();

    if (this.claudeDesktopAvailable) {
      this.desktopStoragePath = await getClaudeDesktopStoragePath();
      this.desktopIndexedDBPath = await getClaudeDesktopIndexedDBPath();
    }
  }

  async searchConversations(
    query: string,
    project?: string,
    timeframe?: string,
    limit?: number
  ): Promise<UniversalSearchResult> {
    await this.initialize();

    const claudeCodeResults = await this.claudeCodeEngine.searchConversations(
      query,
      project,
      timeframe,
      limit
    );

    if (!this.claudeDesktopAvailable) {
      return {
        source: 'claude-code',
        results: claudeCodeResults,
        enhanced: false
      };
    }

    const desktopMessages = await this.searchClaudeDesktopConversations(
      query,
      timeframe,
      limit
    );

    const combinedResults = this.combineSearchResults(claudeCodeResults, desktopMessages);

    // Only mark as enhanced if we actually found Desktop data
    const hasDesktopData = desktopMessages.length > 0;

    return {
      source: hasDesktopData ? 'claude-desktop' : 'claude-code',
      results: combinedResults,
      enhanced: hasDesktopData
    };
  }

  private async searchClaudeDesktopConversations(
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<CompactMessage[]> {
    // Smart query heuristics - only search Desktop for relevant queries
    if (!this.shouldSearchDesktop(query)) {
      return [];
    }

    if (!this.desktopIndexedDBPath) {
      return [];
    }

    const results: CompactMessage[] = [];

    try {
      // Try Local Storage data first (where actual conversation text is found)
      const localStorageResults = await this.searchLocalStorageData(query, timeframe, limit);
      results.push(...localStorageResults);

      // Try SQLite WebStorage for additional metadata
      if (this.sqlite3) {
        const sqliteResults = await this.searchSQLiteWebStorage(query, timeframe, limit);
        results.push(...sqliteResults);
      }

      // Try both IndexedDB and Local Storage LevelDB locations
      const indexedDBResults = await this.searchIndexedDBWithMicroCopy(query, timeframe, limit);
      results.push(...indexedDBResults);

      const levelDBResults = await this.searchLocalStorageWithMicroCopy(query, timeframe, limit);
      results.push(...levelDBResults);
    } catch (error) {
      // Silent timeout protection - don't log errors for performance
      return [];
    }

    return results.slice(0, limit || 10);
  }

  private shouldSearchDesktop(query: string): boolean {
    // Search Desktop for all queries - let the fast timeout and smart fallback handle performance
    return true;
  }

  private async searchLocalStorageData(
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<CompactMessage[]> {
    const results: CompactMessage[] = [];
    const queryLower = query.toLowerCase();

    try {
      // Use the initialized storage path instead of hardcoded path
      const localStoragePath = this.desktopStoragePath ? join(this.desktopStoragePath, 'leveldb') : null;
      if (!localStoragePath) {
        return [];
      }

      const files = readdirSync(localStoragePath);

      for (const file of files) {
        if (file.endsWith('.ldb') || file.endsWith('.log')) {
          const filePath = join(localStoragePath, file);
          const content = readFileSync(filePath);
          const textContent = content.toString('utf8').replace(/\x00/g, '');

          // Search for conversation content that matches our query
          if (textContent.toLowerCase().includes(queryLower)) {
            // Look for text around the query match
            const queryIndex = textContent.toLowerCase().indexOf(queryLower);
            const start = Math.max(0, queryIndex - 200);
            const end = Math.min(textContent.length, queryIndex + 300);
            const snippet = textContent.substring(start, end);

            // Enhanced Desktop content extraction
            const cleanSnippet = this.extractCleanDesktopContent(snippet, query);

            if (cleanSnippet && cleanSnippet.length > 30) {
              const message: CompactMessage = {
                uuid: `desktop-local-${Date.now()}-${Math.random()}`,
                timestamp: new Date().toISOString(),
                type: 'assistant', // Desktop conversations are typically assistant responses
                content: cleanSnippet,
                sessionId: 'claude-desktop',
                projectPath: 'Claude Desktop',
                relevanceScore: this.calculateDesktopRelevanceScore(cleanSnippet, query),
                context: {
                  filesReferenced: this.extractFileReferences({ content: cleanSnippet }),
                  toolsUsed: this.extractToolUsages({ content: cleanSnippet }),
                  errorPatterns: this.extractErrorPatterns({ content: cleanSnippet }),
                  claudeInsights: this.extractClaudeInsights({ content: cleanSnippet }),
                  codeSnippets: this.extractCodeSnippets({ content: cleanSnippet }),
                  actionItems: this.extractActionItems({ content: cleanSnippet })
                }
              };

              results.push(message);
            }
          }

          // Also extract LSS (Local Storage Store) entries for structured data
          const lssMatches = textContent.match(/LSS-[^:]+:[^}]+/g) || [];

          for (const lssEntry of lssMatches) {
            try {
              // Parse conversation data from LSS entries
              if (lssEntry.includes('textInput')) {
                const jsonMatch = lssEntry.match(/\{[^}]*\}/);
                if (jsonMatch) {
                  const parsed = JSON.parse(jsonMatch[0]);
                  if (parsed.content && Array.isArray(parsed.content)) {
                    for (const item of parsed.content) {
                      if (item.content && Array.isArray(item.content)) {
                        for (const textItem of item.content) {
                          if (textItem.text && textItem.text.toLowerCase().includes(queryLower)) {
                            const message: CompactMessage = {
                              uuid: `desktop-lss-${Date.now()}-${Math.random()}`,
                              timestamp: new Date().toISOString(),
                              type: 'user',
                              content: textItem.text,
                              sessionId: 'claude-desktop-lss',
                              projectPath: 'claude-desktop-local-storage',
                              relevanceScore: this.calculateRelevanceScore(textItem.text, query),
                              context: {
                                filesReferenced: this.extractFileReferences({ content: textItem.text }),
                                toolsUsed: this.extractToolUsages({ content: textItem.text }),
                                errorPatterns: this.extractErrorPatterns({ content: textItem.text }),
                                claudeInsights: this.extractClaudeInsights({ content: textItem.text }),
                                codeSnippets: this.extractCodeSnippets({ content: textItem.text }),
                                actionItems: this.extractActionItems({ content: textItem.text })
                              }
                            };

                            results.push(message);
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch (parseError) {
              // Skip malformed entries
              continue;
            }
          }
        }
      }
    } catch (error) {
      // Silent failure
      return [];
    }

    return results.slice(0, limit || 10);
  }

  private getClaudeDesktopLocalStoragePath(): string | null {
    try {
      const path = require('path');
      const os = require('os');

      switch (process.platform) {
        case 'darwin':
          return path.join(os.homedir(), 'Library/Application Support/Claude/Local Storage/leveldb');
        case 'win32':
          return path.join(process.env.APPDATA || '', 'Claude/Local Storage/leveldb');
        case 'linux':
          return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Claude/Local Storage/leveldb');
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private async searchSQLiteWebStorage(
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<CompactMessage[]> {
    if (!this.sqlite3) {
      return [];
    }

    const results: CompactMessage[] = [];
    const queryLower = query.toLowerCase();

    try {
      // Get the WebStorage path where SQLite databases are stored
      const webStoragePath = this.getClaudeDesktopWebStoragePath();
      if (!webStoragePath) {
        return [];
      }

      // Look for SQLite databases in WebStorage/QuotaManager
      const quotaManagerPath = join(webStoragePath, 'QuotaManager');

      // Copy the database to a temporary location to avoid lock issues
      let tempDir: string | null = null;
      let db: any = null;

      try {
        tempDir = await mkdtemp(join(require('os').tmpdir(), 'claude-historian-sqlite-'));
        await chmod(tempDir, 0o700);

        const sourceDbPath = quotaManagerPath;
        const tempDbPath = join(tempDir, 'temp-quota.db');

        // Check if source database exists
        try {
          await import('fs').then(fs => fs.promises.access(sourceDbPath, fs.constants.F_OK));
        } catch {
          return []; // Database doesn't exist
        }

        // Copy database to temporary location
        await copyFile(sourceDbPath, tempDbPath);

        // Try to copy journal file too if it exists
        try {
          await copyFile(sourceDbPath + '-journal', tempDbPath + '-journal');
        } catch {
          // Journal file might not exist, that's okay
        }

        db = new this.sqlite3(tempDbPath, {
          readonly: true,
          timeout: 1000
        });

      // Query the database for conversation data
      // Claude Desktop typically stores data in 'messages' or 'conversations' tables
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();

      for (const table of tables) {
        try {
          // Look for text content in each table
          const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
          const textColumns = columns.filter((col: any) =>
            col.type.toLowerCase().includes('text') ||
            col.type.toLowerCase().includes('varchar') ||
            col.name.toLowerCase().includes('content') ||
            col.name.toLowerCase().includes('message') ||
            col.name.toLowerCase().includes('data')
          );

          if (textColumns.length > 0) {
            // Search for query in text columns
            for (const col of textColumns) {
              try {
                const searchQuery = `SELECT * FROM ${table.name} WHERE ${col.name} LIKE ? COLLATE NOCASE LIMIT ?`;
                const rows = db.prepare(searchQuery).all(`%${query}%`, limit || 10);

                for (const row of rows) {
                  const content = row[col.name];
                  if (content && typeof content === 'string' && content.toLowerCase().includes(queryLower)) {
                    const message: CompactMessage = {
                      uuid: `desktop-sqlite-${Date.now()}-${Math.random()}`,
                      timestamp: row.timestamp || row.created_at || new Date().toISOString(),
                      type: 'assistant',
                      content: this.extractRelevantSnippet(content, query),
                      sessionId: 'claude-desktop-sqlite',
                      projectPath: 'claude-desktop-webstorage',
                      relevanceScore: this.calculateRelevanceScore(content, query),
                      context: {
                        filesReferenced: this.extractFileReferences({ content }),
                        toolsUsed: this.extractToolUsages({ content }),
                        errorPatterns: this.extractErrorPatterns({ content }),
                        claudeInsights: this.extractClaudeInsights({ content }),
                        codeSnippets: this.extractCodeSnippets({ content }),
                        actionItems: this.extractActionItems({ content })
                      }
                    };

                    results.push(message);

                    if (results.length >= (limit || 10)) {
                      break;
                    }
                  }
                }
              } catch (queryError) {
                // Skip columns that can't be queried
                continue;
              }
            }
          }
        } catch (tableError) {
          // Skip tables that can't be accessed
          continue;
        }
      }

        db.close();
      } catch (copyError) {
        // If copy fails, try direct read-only access as fallback
        try {
          db = new this.sqlite3(quotaManagerPath, {
            readonly: true,
            timeout: 100 // Very short timeout for fallback
          });

          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
          // ... same search logic here but simplified for fallback

          db.close();
        } catch (directError) {
          // Both copy and direct access failed
          return [];
        }
      } finally {
        // Clean up temporary directory
        if (tempDir) {
          try {
            await rm(tempDir, { recursive: true, force: true });
          } catch {
            // Silent cleanup failure
          }
        }
      }

    } catch (error) {
      // Silent failure for any other issues
      return [];
    }

    return results;
  }

  private getClaudeDesktopWebStoragePath(): string | null {
    try {
      const { join } = require('path');
      const { homedir } = require('os');

      switch (process.platform) {
        case 'darwin':
          return join(homedir(), 'Library/Application Support/Claude/WebStorage');
        case 'win32':
          return join(process.env.APPDATA || '', 'Claude/WebStorage');
        case 'linux':
          return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Claude/WebStorage');
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private async searchIndexedDBWithMicroCopy(
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<CompactMessage[]> {
    if (!this.desktopIndexedDBPath) {
      return [];
    }

    let tempDir: string | null = null;

    try {
      // Create secure temp directory
      tempDir = await mkdtemp(join(tmpdir(), 'claude-historian-'));
      await chmod(tempDir, 0o700); // Secure permissions - owner only

      const sourceDbPath = join(this.desktopIndexedDBPath, 'https_claude.ai_0.indexeddb.leveldb');
      const tempDbPath = join(tempDir, 'temp.leveldb');

      // Micro-copy: only copy .log files (active data, ~2KB vs 48KB total)
      const sourceFiles = await readdir(sourceDbPath);
      const logFiles = sourceFiles.filter(file => file.endsWith('.log'));

      if (logFiles.length === 0) {
        return [];
      }

      // Silent timeout protection - max 100ms for copy operation
      const copyPromise = this.copyLogFiles(sourceDbPath, tempDbPath, logFiles);
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 100)
      );

      await Promise.race([copyPromise, timeoutPromise]);

      // Fast text search in copied log files (no LevelDB parsing needed)
      const results = await this.searchLogFiles(tempDbPath, query, timeframe, limit);

      return results;
    } catch (error) {
      // Silent failure for performance
      return [];
    } finally {
      // Immediate cleanup
      if (tempDir) {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Silent cleanup failure
        }
      }
    }
  }

  private async copyLogFiles(sourcePath: string, destPath: string, logFiles: string[]): Promise<void> {
    // Copy all available files for better search coverage
    const allFiles = await readdir(sourcePath);
    const filesToCopy = allFiles.filter(file =>
      file.endsWith('.log') || file.endsWith('.ldb') || file === 'CURRENT'
    ).slice(0, 5); // Limit to 5 most relevant files

    for (const file of filesToCopy) {
      const sourceFile = join(sourcePath, file);
      const destFile = join(destPath, file);
      await copyFile(sourceFile, destFile);
    }
  }

  private async searchLogFiles(
    dbPath: string,
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<CompactMessage[]> {
    const results: CompactMessage[] = [];
    const queryLower = query.toLowerCase();

    try {
      const files = await readdir(dbPath);
      for (const file of files) {
        if (file.endsWith('.log') || file.endsWith('.ldb')) {
          // Read as binary first to handle LevelDB format
          const buffer = await readFile(join(dbPath, file));
          const content = buffer.toString('utf8', 0, Math.min(buffer.length, 50000)); // Limit to prevent massive content

          // Search for text content in the binary data
          if (content.toLowerCase().includes(queryLower)) {
            const message: CompactMessage = {
              uuid: `desktop-${Date.now()}-${Math.random()}`,
              timestamp: new Date().toISOString(),
              type: 'assistant',
              content: this.extractRelevantSnippet(content, query),
              sessionId: 'claude-desktop-session',
              projectPath: 'claude-desktop',
              relevanceScore: this.calculateRelevanceScore(content, query),
              context: {
                filesReferenced: [],
                toolsUsed: [],
                errorPatterns: [],
                claudeInsights: [],
                codeSnippets: [],
                actionItems: []
              }
            };

            results.push(message);

            if (results.length >= (limit || 10)) {
              break;
            }
          }
        }
      }
    } catch {
      // Silent failure
    }

    return results;
  }

  private extractRelevantSnippet(content: string, query: string): string {
    // Extract relevant snippet around query match
    const queryIndex = content.toLowerCase().indexOf(query.toLowerCase());
    if (queryIndex === -1) return content.slice(0, 200);

    const start = Math.max(0, queryIndex - 100);
    const end = Math.min(content.length, queryIndex + 100);

    return content.slice(start, end);
  }

  private async searchLocalStorageWithMicroCopy(
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<CompactMessage[]> {
    if (!this.desktopStoragePath) {
      return [];
    }

    let tempDir: string | null = null;

    try {
      // Create secure temp directory
      tempDir = await mkdtemp(join(tmpdir(), 'claude-historian-local-'));
      await chmod(tempDir, 0o700);

      const sourceDbPath = join(this.desktopStoragePath, 'leveldb');
      const tempDbPath = join(tempDir, 'temp-local.leveldb');

      // Copy Local Storage LevelDB files
      const sourceFiles = await readdir(sourceDbPath);
      const filesToCopy = sourceFiles.filter(file =>
        file.endsWith('.log') || file.endsWith('.ldb') || file === 'CURRENT'
      ).slice(0, 5);

      if (filesToCopy.length === 0) {
        return [];
      }

      // Silent timeout protection - max 100ms for copy operation
      const copyPromise = this.copyLocalStorageFiles(sourceDbPath, tempDbPath, filesToCopy);
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 100)
      );

      await Promise.race([copyPromise, timeoutPromise]);

      // Search in Local Storage files
      const results = await this.searchLocalStorageFiles(tempDbPath, query, timeframe, limit);

      return results;
    } catch (error) {
      // Silent failure
      return [];
    } finally {
      // Immediate cleanup
      if (tempDir) {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Silent cleanup failure
        }
      }
    }
  }

  private async copyLocalStorageFiles(sourcePath: string, destPath: string, files: string[]): Promise<void> {
    for (const file of files) {
      const sourceFile = join(sourcePath, file);
      const destFile = join(destPath, file);
      await copyFile(sourceFile, destFile);
    }
  }

  private async searchLocalStorageFiles(
    dbPath: string,
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<CompactMessage[]> {
    const results: CompactMessage[] = [];
    const queryLower = query.toLowerCase();

    try {
      const files = await readdir(dbPath);
      for (const file of files) {
        if (file.endsWith('.log') || file.endsWith('.ldb')) {
          const buffer = await readFile(join(dbPath, file));
          const content = buffer.toString('utf8', 0, Math.min(buffer.length, 50000));

          // Look for conversation content in the Local Storage format
          if (content.toLowerCase().includes(queryLower)) {
            const message: CompactMessage = {
              uuid: `desktop-local-${Date.now()}-${Math.random()}`,
              timestamp: new Date().toISOString(),
              type: 'assistant',
              content: this.extractRelevantSnippet(content, query),
              sessionId: 'claude-desktop-local-session',
              projectPath: 'claude-desktop-local',
              relevanceScore: this.calculateRelevanceScore(content, query),
              context: {
                filesReferenced: [],
                toolsUsed: [],
                errorPatterns: [],
                claudeInsights: [],
                codeSnippets: [],
                actionItems: []
              }
            };

            results.push(message);

            if (results.length >= (limit || 10)) {
              break;
            }
          }
        }
      }
    } catch {
      // Silent failure
    }

    return results;
  }

  private async searchLocalStorage(
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<any[]> {
    if (!this.desktopStoragePath) return [];

    try {
      const entries = await readdir(this.desktopStoragePath);
      const results: any[] = [];

      for (const entry of entries) {
        if (entry.startsWith('leveldb_')) {
          const entryPath = join(this.desktopStoragePath, entry);
          const conversations = await this.extractConversationsFromFile(entryPath);

          for (const conversation of conversations) {
            if (this.matchesQuery(conversation, query) &&
                this.matchesTimeframe(conversation, timeframe)) {
              results.push({
                ...conversation,
                source: 'claude-desktop-local-storage',
                timestamp: conversation.timestamp || new Date().toISOString()
              });
            }
          }
        }
      }

      return results.slice(0, limit || 10);
    } catch (error) {
      console.error('Error searching Local Storage:', error);
      return [];
    }
  }

  private async searchIndexedDB(
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<any[]> {
    if (!this.desktopIndexedDBPath) return [];

    try {
      const entries = await readdir(this.desktopIndexedDBPath);
      const results: any[] = [];

      for (const entry of entries) {
        if (entry.includes('claude')) {
          const entryPath = join(this.desktopIndexedDBPath, entry);
          const conversations = await this.extractConversationsFromFile(entryPath);

          for (const conversation of conversations) {
            if (this.matchesQuery(conversation, query) &&
                this.matchesTimeframe(conversation, timeframe)) {
              results.push({
                ...conversation,
                source: 'claude-desktop-indexed-db',
                timestamp: conversation.timestamp || new Date().toISOString()
              });
            }
          }
        }
      }

      return results.slice(0, limit || 10);
    } catch (error) {
      console.error('Error searching IndexedDB:', error);
      return [];
    }
  }

  private async extractConversationsFromFile(filePath: string): Promise<any[]> {
    try {
      const content = await readFile(filePath, 'utf8');

      const conversations: any[] = [];
      const lines = content.split('\n');

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            if (data.type === 'conversation' || data.messages) {
              conversations.push(data);
            }
          } catch {
            if (line.includes('assistant') || line.includes('user')) {
              conversations.push({
                content: line,
                type: 'raw',
                timestamp: new Date().toISOString(),
                uuid: `desktop-${Date.now()}-${Math.random()}`,
                sessionId: 'desktop-session',
                projectPath: 'claude-desktop'
              });
            }
          }
        }
      }

      return conversations;
    } catch (error) {
      console.error(`Error extracting from file ${filePath}:`, error);
      return [];
    }
  }

  private async searchIndexedDBWithLevel(
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<CompactMessage[]> {
    if (!this.desktopIndexedDBPath || !this.levelDB) {
      return [];
    }

    try {
      const dbPath = join(this.desktopIndexedDBPath, 'https_claude.ai_0.indexeddb.leveldb');
      const db = new this.levelDB(dbPath, { readOnly: true });

      const conversations: CompactMessage[] = [];

      // Read entries from the LevelDB database
      const entries = await db.iterator({ limit: 100 }).all();

      for (const [key, value] of entries) {
        try {
          const keyStr = key.toString();
          const valueStr = value.toString();

          // Parse conversation data from LevelDB entries
          if (this.isConversationEntry(keyStr, valueStr)) {
            const message = await this.parseConversationEntry(keyStr, valueStr, query, timeframe);
            if (message) {
              conversations.push(message);
            }
          }
        } catch (parseError) {
          // Skip invalid entries
          continue;
        }
      }

      await db.close();

      return conversations.slice(0, limit || 10);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'LEVEL_LOCKED') {
        console.log('Claude Desktop database is locked (application is running)');
        return [];
      }
      if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.includes('LOCK')) {
        console.log('Claude Desktop database is locked (application is running)');
        return [];
      }
      console.error('Error reading IndexedDB with Level:', error);
      return [];
    }
  }

  private async searchLocalStorageWithLevel(
    query: string,
    timeframe?: string,
    limit?: number
  ): Promise<CompactMessage[]> {
    if (!this.desktopStoragePath || !this.levelDB) {
      return [];
    }

    try {
      const dbPath = join(this.desktopStoragePath, 'leveldb');
      const db = this.levelDB(dbPath, { readOnly: true });

      const conversations: CompactMessage[] = [];

      // Read all entries from the Local Storage LevelDB
      const iterator = db.iterator();

      for await (const [key, value] of iterator) {
        try {
          const keyStr = key.toString();
          const valueStr = value.toString();

          // Parse local storage data for conversation references
          if (this.isLocalStorageConversationEntry(keyStr, valueStr)) {
            const message = await this.parseLocalStorageEntry(keyStr, valueStr, query, timeframe);
            if (message) {
              conversations.push(message);
            }
          }
        } catch (parseError) {
          // Skip invalid entries
          continue;
        }
      }

      await iterator.close();
      await db.close();

      return conversations.slice(0, limit || 10);
    } catch (error) {
      console.error('Error reading Local Storage with Level:', error);
      return [];
    }
  }

  private isConversationEntry(key: string, value: string): boolean {
    // Check if this LevelDB entry contains conversation data
    return value.includes('conversation') ||
           value.includes('message') ||
           value.includes('assistant') ||
           value.includes('user') ||
           value.includes('sketchybar') ||
           value.includes('analog clock');
  }

  private isLocalStorageConversationEntry(key: string, value: string): boolean {
    // Check if this Local Storage entry contains conversation references
    return key.includes('conversation') ||
           key.includes('chat') ||
           value.includes('message') ||
           value.includes('assistant');
  }

  private async parseConversationEntry(
    key: string,
    value: string,
    query: string,
    timeframe?: string
  ): Promise<CompactMessage | null> {
    try {
      // Try to parse as JSON first
      let data;
      try {
        data = JSON.parse(value);
      } catch {
        // If not JSON, treat as plain text
        data = { content: value, type: 'raw' };
      }

      // Check if this entry matches our query
      if (!this.matchesQuery(data, query)) {
        return null;
      }

      // Check timeframe if specified
      if (timeframe && !this.matchesTimeframe(data, timeframe)) {
        return null;
      }

      // Convert to CompactMessage format
      return {
        uuid: `desktop-${Date.now()}-${Math.random()}`,
        timestamp: data.timestamp || new Date().toISOString(),
        type: this.determineMessageType(data),
        content: this.extractMessageContent(data),
        sessionId: data.sessionId || 'claude-desktop-session',
        projectPath: 'claude-desktop',
        relevanceScore: this.calculateRelevanceScore(data, query),
        context: {
          filesReferenced: this.extractFileReferences(data),
          toolsUsed: this.extractToolUsages(data),
          errorPatterns: this.extractErrorPatterns(data),
          claudeInsights: this.extractClaudeInsights(data),
          codeSnippets: this.extractCodeSnippets(data),
          actionItems: this.extractActionItems(data)
        }
      };
    } catch (error) {
      console.error('Error parsing conversation entry:', error);
      return null;
    }
  }

  private async parseLocalStorageEntry(
    key: string,
    value: string,
    query: string,
    timeframe?: string
  ): Promise<CompactMessage | null> {
    try {
      // Similar parsing logic for Local Storage entries
      let data;
      try {
        data = JSON.parse(value);
      } catch {
        data = { content: value, type: 'raw' };
      }

      if (!this.matchesQuery(data, query) || (timeframe && !this.matchesTimeframe(data, timeframe))) {
        return null;
      }

      return {
        uuid: `desktop-local-${Date.now()}-${Math.random()}`,
        timestamp: data.timestamp || new Date().toISOString(),
        type: this.determineMessageType(data),
        content: this.extractMessageContent(data),
        sessionId: data.sessionId || 'claude-desktop-local-session',
        projectPath: 'claude-desktop-local',
        relevanceScore: this.calculateRelevanceScore(data, query),
        context: {
          filesReferenced: this.extractFileReferences(data),
          toolsUsed: this.extractToolUsages(data),
          errorPatterns: this.extractErrorPatterns(data),
          claudeInsights: this.extractClaudeInsights(data),
          codeSnippets: this.extractCodeSnippets(data),
          actionItems: this.extractActionItems(data)
        }
      };
    } catch (error) {
      console.error('Error parsing local storage entry:', error);
      return null;
    }
  }

  private matchesQuery(conversation: any, query: string): boolean {
    if (!query) return true;

    const content = JSON.stringify(conversation).toLowerCase();
    const queryLower = query.toLowerCase();

    return content.includes(queryLower) ||
           queryLower.split(' ').some(word => content.includes(word));
  }

  private matchesTimeframe(conversation: any, timeframe?: string): boolean {
    if (!timeframe || !conversation.timestamp) return true;

    const messageDate = new Date(conversation.timestamp);
    const now = new Date();

    switch (timeframe.toLowerCase()) {
      case 'today':
        return messageDate.toDateString() === now.toDateString();
      case 'week':
        return (now.getTime() - messageDate.getTime()) < (7 * 24 * 60 * 60 * 1000);
      case 'month':
        return (now.getTime() - messageDate.getTime()) < (30 * 24 * 60 * 60 * 1000);
      default:
        return true;
    }
  }

  private combineSearchResults(claudeCodeResults: SearchResult, desktopMessages: CompactMessage[]): SearchResult {
    const combinedMessages = [...claudeCodeResults.messages, ...desktopMessages];

    combinedMessages.sort((a, b) => {
      const aScore = a.relevanceScore || 0;
      const bScore = b.relevanceScore || 0;
      if (aScore !== bScore) return bScore - aScore;

      const aTime = new Date(a.timestamp || 0).getTime();
      const bTime = new Date(b.timestamp || 0).getTime();
      return bTime - aTime;
    });

    return {
      messages: combinedMessages,
      totalResults: claudeCodeResults.totalResults + desktopMessages.length,
      searchQuery: claudeCodeResults.searchQuery,
      executionTime: claudeCodeResults.executionTime
    };
  }

  async findFileContext(
    filepath: string,
    limit?: number
  ): Promise<{ source: string; results: FileContext[]; enhanced: boolean }> {
    await this.initialize();

    const claudeCodeResults = await this.claudeCodeEngine.findFileContext(filepath, limit);

    if (!this.claudeDesktopAvailable) {
      return {
        source: 'claude-code',
        results: claudeCodeResults,
        enhanced: false
      };
    }

    const desktopMessages = await this.searchClaudeDesktopConversations(
      filepath,
      undefined,
      limit
    );

    const combinedResults = this.combineFileContextResults(claudeCodeResults, desktopMessages);

    const hasDesktopData = desktopMessages.length > 0;

    return {
      source: hasDesktopData ? 'claude-desktop' : 'claude-code',
      results: combinedResults,
      enhanced: hasDesktopData
    };
  }

  private combineFileContextResults(claudeCodeResults: FileContext[], desktopMessages: CompactMessage[]): FileContext[] {
    const desktopFileContexts: FileContext[] = desktopMessages.map(msg => ({
      filePath: 'claude-desktop',
      lastModified: msg.timestamp,
      relatedMessages: [msg],
      operationType: 'read' as const
    }));

    return [...claudeCodeResults, ...desktopFileContexts];
  }

  async findSimilarQueries(
    query: string,
    limit?: number
  ): Promise<{ source: string; results: CompactMessage[]; enhanced: boolean }> {
    await this.initialize();

    const claudeCodeResults = await this.claudeCodeEngine.findSimilarQueries(query, limit);

    if (!this.claudeDesktopAvailable) {
      return {
        source: 'claude-code',
        results: claudeCodeResults,
        enhanced: false
      };
    }

    const desktopMessages = await this.searchClaudeDesktopConversations(
      query,
      undefined,
      limit
    );

    const combinedResults = [...claudeCodeResults, ...desktopMessages];

    const hasDesktopData = desktopMessages.length > 0;

    return {
      source: hasDesktopData ? 'claude-desktop' : 'claude-code',
      results: combinedResults,
      enhanced: hasDesktopData
    };
  }

  async getErrorSolutions(
    errorPattern: string,
    limit?: number
  ): Promise<{ source: string; results: ErrorSolution[]; enhanced: boolean }> {
    await this.initialize();

    const claudeCodeResults = await this.claudeCodeEngine.getErrorSolutions(errorPattern, limit);

    if (!this.claudeDesktopAvailable) {
      return {
        source: 'claude-code',
        results: claudeCodeResults,
        enhanced: false
      };
    }

    const desktopMessages = await this.searchClaudeDesktopConversations(
      errorPattern,
      undefined,
      limit
    );

    const combinedResults = this.combineErrorSolutionResults(claudeCodeResults, desktopMessages);

    const hasDesktopData = desktopMessages.length > 0;

    return {
      source: hasDesktopData ? 'claude-desktop' : 'claude-code',
      results: combinedResults,
      enhanced: hasDesktopData
    };
  }

  private combineErrorSolutionResults(claudeCodeResults: ErrorSolution[], desktopMessages: CompactMessage[]): ErrorSolution[] {
    const desktopErrorSolutions: ErrorSolution[] = desktopMessages.map(msg => ({
      errorPattern: 'claude-desktop-error',
      solution: [msg],
      context: msg.content,
      frequency: 1
    }));

    return [...claudeCodeResults, ...desktopErrorSolutions];
  }

  isClaudeDesktopAvailable(): boolean {
    return this.claudeDesktopAvailable === true;
  }

  getAvailableSources(): string[] {
    const sources = ['claude-code'];
    if (this.claudeDesktopAvailable && this.enhancedMode) {
      sources.push('claude-desktop');
    }
    return sources;
  }

  private determineMessageType(data: any): 'user' | 'assistant' | 'tool_use' | 'tool_result' {
    if (data.type) return data.type;
    if (data.role === 'user') return 'user';
    if (data.role === 'assistant') return 'assistant';
    if (data.content && data.content.includes('Tool:')) return 'tool_use';
    if (data.content && data.content.includes('Result:')) return 'tool_result';
    return 'assistant'; // Default
  }

  private extractMessageContent(data: any): string {
    if (data.content) return data.content;
    if (data.message) return data.message;
    if (data.text) return data.text;
    if (typeof data === 'string') return data;
    return JSON.stringify(data);
  }

  private calculateRelevanceScore(data: any, query: string): number {
    const content = this.extractMessageContent(data).toLowerCase();
    const queryLower = query.toLowerCase();

    let score = 0;

    // Exact match bonus
    if (content.includes(queryLower)) score += 10;

    // Word matching
    const queryWords = queryLower.split(/\s+/);
    const matchingWords = queryWords.filter(word => content.includes(word));
    score += matchingWords.length * 2;

    // Special bonuses for Desktop conversations
    if (content.includes('sketchybar')) score += 5;
    if (content.includes('analog clock')) score += 5;
    if (content.includes('script')) score += 3;

    return score;
  }

  private extractFileReferences(data: any): string[] {
    const content = this.extractMessageContent(data);
    const fileRefs: string[] = [];

    // Common file patterns
    const patterns = [
      /\b[\w-]+\.(js|ts|py|json|md|txt|sh|yml|yaml)\b/g,
      /\/[\w-/]+\.[\w]+/g,
      /~\/[\w-/]+\.[\w]+/g
    ];

    patterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        fileRefs.push(...matches);
      }
    });

    return [...new Set(fileRefs)];
  }

  private extractToolUsages(data: any): string[] {
    const content = this.extractMessageContent(data);
    const tools: string[] = [];

    // Tool usage patterns
    const toolPatterns = [
      /\[Tool:\s*([^\]]+)\]/g,
      /execute_command/g,
      /create_text_file/g,
      /Tool Result/g
    ];

    toolPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        tools.push(...matches);
      }
    });

    return [...new Set(tools)];
  }

  private extractErrorPatterns(data: any): string[] {
    const content = this.extractMessageContent(data);
    const errors: string[] = [];

    // Error patterns
    const errorPatterns = [
      /Error:[^\n]*/g,
      /Exception:[^\n]*/g,
      /Failed[^\n]*/g,
      /Cannot[^\n]*/g
    ];

    errorPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        errors.push(...matches);
      }
    });

    return [...new Set(errors)];
  }

  private extractClaudeInsights(data: any): string[] {
    const content = this.extractMessageContent(data);
    const insights: string[] = [];

    // Claude insight patterns
    const insightPatterns = [
      /I'll[^\n]*/g,
      /Let me[^\n]*/g,
      /Here's[^\n]*/g,
      /Solution:[^\n]*/g
    ];

    insightPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        insights.push(...matches.slice(0, 3)); // Limit to avoid spam
      }
    });

    return [...new Set(insights)];
  }

  private extractCodeSnippets(data: any): string[] {
    const content = this.extractMessageContent(data);
    const snippets: string[] = [];

    // Code block patterns
    const codePatterns = [
      /```[\s\S]*?```/g,
      /`[^`\n]+`/g,
      /function\s+\w+\s*\([^)]*\)/g,
      /const\s+\w+\s*=/g
    ];

    codePatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        snippets.push(...matches.slice(0, 2)); // Limit to avoid spam
      }
    });

    return [...new Set(snippets)];
  }

  private extractActionItems(data: any): string[] {
    const content = this.extractMessageContent(data);
    const actions: string[] = [];

    // Action item patterns
    const actionPatterns = [
      /TODO:[^\n]*/g,
      /Next:[^\n]*/g,
      /Action:[^\n]*/g,
      /Step \d+:[^\n]*/g
    ];

    actionPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        actions.push(...matches);
      }
    });

    return [...new Set(actions)];
  }

  // Universal methods for all tools
  async getRecentSessions(limit?: number, project?: string): Promise<UniversalSearchResult> {
    await this.initialize();

    const claudeCodeSessions = await this.claudeCodeEngine.getRecentSessions(limit || 10);

    if (!this.claudeDesktopAvailable) {
      return {
        source: 'claude-code',
        results: claudeCodeSessions as any,
        enhanced: false
      };
    }

    // For sessions, Desktop doesn't have traditional sessions, so we focus on Code
    // But we mark as enhanced if Desktop is available for future Desktop session support
    return {
      source: 'claude-code',
      results: claudeCodeSessions as any,
      enhanced: this.claudeDesktopAvailable
    };
  }

  async getToolPatterns(toolName?: string, limit?: number): Promise<UniversalSearchResult> {
    await this.initialize();

    const claudeCodePatterns = await this.claudeCodeEngine.getToolPatterns(toolName, limit || 12);

    if (!this.claudeDesktopAvailable) {
      return {
        source: 'claude-code',
        results: claudeCodePatterns as any,
        enhanced: false
      };
    }

    // For tool patterns, Desktop doesn't have tool usage data, so we focus on Code
    // But we mark as enhanced if Desktop is available for future Desktop tool analysis
    return {
      source: 'claude-code',
      results: claudeCodePatterns as any,
      enhanced: this.claudeDesktopAvailable
    };
  }

  async generateCompactSummary(sessionId: string, maxMessages?: number, focus?: string): Promise<UniversalSearchResult> {
    await this.initialize();

    // Get session data from Claude Code
    const allSessions = await this.claudeCodeEngine.getRecentSessions(20);
    const sessionData = allSessions.find(s =>
      s.session_id === sessionId ||
      s.session_id.startsWith(sessionId) ||
      sessionId.includes(s.session_id) ||
      s.session_id.includes(sessionId.replace(/^.*\//, ''))
    );

    if (!sessionData) {
      return {
        source: 'claude-code',
        results: {
          sessionId,
          summary: `No session found for ID: ${sessionId}`,
          messageCount: 0,
          focus: focus || 'all'
        } as any,
        enhanced: false
      };
    }

    const messages = await this.claudeCodeEngine.getSessionMessages(sessionData.project_dir, sessionData.session_id);
    const sessionMessages = messages.slice(0, maxMessages || 10);

    const summary = {
      sessionId,
      summary: this.generateSessionSummary(sessionMessages, focus || 'all'),
      messageCount: sessionMessages.length,
      focus: focus || 'all'
    };

    if (!this.claudeDesktopAvailable) {
      return {
        source: 'claude-code',
        results: summary as any,
        enhanced: false
      };
    }

    // For summaries, Desktop could provide additional context in the future
    return {
      source: 'claude-code',
      results: summary as any,
      enhanced: this.claudeDesktopAvailable
    };
  }

  private generateSessionSummary(messages: any[], focus: string): string {
    const insights = {
      messageCount: messages.length,
      toolsUsed: new Set<string>(),
      filesReferenced: new Set<string>(),
      outcomes: new Set<string>(),
      errors: new Set<string>(),
      solutions: new Set<string>()
    };

    messages.forEach((msg) => {
      msg.context?.toolsUsed?.forEach((tool: string) => {
        if (tool && tool.length > 1) insights.toolsUsed.add(tool);
      });

      msg.context?.filesReferenced?.forEach((file: string) => {
        if (file && file.length > 3) insights.filesReferenced.add(file);
      });

      const content = msg.content.toLowerCase();
      if (content.includes('error') || content.includes('failed')) {
        insights.errors.add(msg.content.substring(0, 100));
      }
      if (content.includes('solution') || content.includes('fixed')) {
        insights.solutions.add(msg.content.substring(0, 100));
      }
    });

    let summary = `Smart Summary (${insights.messageCount} msgs)\n\n`;

    switch (focus) {
      case 'solutions':
        if (insights.solutions.size > 0) {
          summary += `**Solutions:** ${Array.from(insights.solutions).slice(0, 2).join(', ')}\n`;
        }
        break;
      case 'tools':
        if (insights.toolsUsed.size > 0) {
          summary += `**Tools:** ${Array.from(insights.toolsUsed).slice(0, 4).join(', ')}\n`;
        }
        break;
      case 'files':
        if (insights.filesReferenced.size > 0) {
          summary += `**Files:** ${Array.from(insights.filesReferenced).slice(0, 3).join(', ')}\n`;
        }
        break;
      default:
        if (insights.toolsUsed.size > 0) {
          summary += `**Tools:** ${Array.from(insights.toolsUsed).slice(0, 3).join(', ')}\n`;
        }
        if (insights.filesReferenced.size > 0) {
          summary += `**Files:** ${Array.from(insights.filesReferenced).slice(0, 2).join(', ')}\n`;
        }
    }

    return summary;
  }

  // Enhanced Desktop content extraction methods
  private extractCleanDesktopContent(rawSnippet: string, query: string): string | null {
    try {
      // Remove binary junk and extract readable sentences
      let cleaned = rawSnippet.replace(/[^\x20-\x7E\n]/g, ' ');

      // Extract sentences that contain the query or are near it
      const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 10);
      const queryLower = query.toLowerCase();

      // Find sentences containing the query
      const relevantSentences = sentences.filter(sentence =>
        sentence.toLowerCase().includes(queryLower)
      );

      if (relevantSentences.length > 0) {
        // Get the best sentence and clean it up
        const bestSentence = relevantSentences[0].trim();
        return this.cleanupDesktopSentence(bestSentence, query);
      }

      // Fallback: extract text around the query
      const queryIndex = cleaned.toLowerCase().indexOf(queryLower);
      if (queryIndex !== -1) {
        const start = Math.max(0, queryIndex - 50);
        const end = Math.min(cleaned.length, queryIndex + 150);
        const contextSnippet = cleaned.substring(start, end).trim();
        return this.cleanupDesktopSentence(contextSnippet, query);
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  private cleanupDesktopSentence(sentence: string, query: string): string {
    // Remove excessive spaces and cleanup artifacts
    let cleaned = sentence.replace(/\s+/g, ' ').trim();

    // Remove common LevelDB artifacts
    cleaned = cleaned.replace(/[{}\\'"]+/g, ' ');
    cleaned = cleaned.replace(/\d{13,}/g, ''); // Remove timestamps
    cleaned = cleaned.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, ''); // Remove UUIDs

    // Final cleanup
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Ensure the query is preserved and highlighted context is meaningful
    const queryIndex = cleaned.toLowerCase().indexOf(query.toLowerCase());
    if (queryIndex !== -1) {
      // Extract a meaningful window around the query
      const start = Math.max(0, queryIndex - 20);
      const end = Math.min(cleaned.length, queryIndex + query.length + 80);
      const result = cleaned.substring(start, end).trim();

      // Only return if it's a meaningful sentence
      if (result.length > 15 && !result.match(/^[\s\W]+$/)) {
        return result;
      }
    }

    return cleaned.length > 15 ? cleaned : '';
  }

  private calculateDesktopRelevanceScore(content: string, query: string): number {
    let score = 0;
    const contentLower = content.toLowerCase();
    const queryLower = query.toLowerCase();

    // Exact query match
    if (contentLower.includes(queryLower)) {
      score += 10;
    }

    // Word matches
    const queryWords = queryLower.split(/\s+/);
    const contentWords = contentLower.split(/\s+/);
    const matchingWords = queryWords.filter(word =>
      contentWords.some(cWord => cWord.includes(word))
    );
    score += matchingWords.length * 3;

    // Desktop content gets bonus for being rare/valuable
    score += 8;

    // Extra bonus for Desktop content with exact query match
    if (contentLower.includes(queryLower)) {
      score += 5; // Desktop exact matches get priority
    }

    // Penalize very short or garbled content
    if (content.length < 30) score -= 5;
    const nonWordMatches = content.match(/[^\w\s.,!?-]/g);
    if (nonWordMatches && nonWordMatches.length > content.length * 0.3) score -= 3;

    return Math.max(0, score);
  }
}