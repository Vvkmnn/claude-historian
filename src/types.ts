export interface ClaudeMessage {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  message?: {
    role: string;
    content: string | any[];
    id?: string;
    model?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  uuid: string;
  timestamp: string;
  requestId?: string;
}

export interface CompactMessage {
  uuid: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  sessionId: string;
  projectPath?: string;
  relevanceScore?: number;
  context?: {
    filesReferenced?: string[];
    toolsUsed?: string[];
    errorPatterns?: string[];
  };
}

export interface SearchResult {
  messages: CompactMessage[];
  totalResults: number;
  searchQuery: string;
  executionTime: number;
}

export interface FileContext {
  filePath: string;
  lastModified: string;
  relatedMessages: CompactMessage[];
  operationType: 'read' | 'write' | 'edit' | 'delete';
}

export interface ErrorSolution {
  errorPattern: string;
  solution: CompactMessage[];
  context: string;
  frequency: number;
}

export interface ToolPattern {
  toolName: string;
  successfulUsages: CompactMessage[];
  commonPatterns: string[];
  bestPractices: string[];
}

export interface ConversationSession {
  sessionId: string;
  projectPath: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  summary?: string;
}