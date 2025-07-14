import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export function getClaudeProjectsPath(): string {
  return join(homedir(), '.claude', 'projects');
}

export function decodeProjectPath(encodedPath: string): string {
  // Claude encodes paths by replacing '/' with '-'
  return encodedPath.replace(/-/g, '/');
}

export function encodeProjectPath(path: string): string {
  // Encode path for Claude projects directory naming
  return path.replace(/\//g, '-');
}

export async function findProjectDirectories(): Promise<string[]> {
  try {
    const projectsPath = getClaudeProjectsPath();
    const entries = await readdir(projectsPath);
    
    const directories = [];
    for (const entry of entries) {
      const fullPath = join(projectsPath, entry);
      const stats = await stat(fullPath);
      if (stats.isDirectory()) {
        directories.push(entry);
      }
    }
    
    return directories;
  } catch (error) {
    console.error('Error finding project directories:', error);
    return [];
  }
}

export async function findJsonlFiles(projectDir: string): Promise<string[]> {
  try {
    const projectsPath = getClaudeProjectsPath();
    const fullPath = join(projectsPath, projectDir);
    const entries = await readdir(fullPath);
    
    return entries.filter(file => file.endsWith('.jsonl'));
  } catch (error) {
    console.error(`Error finding JSONL files in ${projectDir}:`, error);
    return [];
  }
}

export function extractContentFromMessage(message: any): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  
  if (Array.isArray(message.content)) {
    return message.content
      .map((item: any) => {
        if (item.type === 'text') return item.text;
        if (item.type === 'tool_use') return `[Tool: ${item.name}]`;
        if (item.type === 'tool_result') return `[Tool Result]`;
        return '';
      })
      .join(' ')
      .trim();
  }
  
  return '';
}

export function calculateRelevanceScore(
  message: any, 
  query: string, 
  projectPath?: string
): number {
  let score = 0;
  const content = extractContentFromMessage(message.message || {});
  const lowerQuery = query.toLowerCase();
  const lowerContent = content.toLowerCase();
  
  // Basic text matching
  if (lowerContent.includes(lowerQuery)) {
    score += 10;
  }
  
  // Word matching
  const queryWords = lowerQuery.split(/\s+/);
  const contentWords = lowerContent.split(/\s+/);
  const matchingWords = queryWords.filter(word => 
    contentWords.some(cWord => cWord.includes(word))
  );
  score += matchingWords.length * 2;
  
  // Tool usage bonus
  if (message.type === 'tool_use' || message.type === 'tool_result') {
    score += 5;
  }
  
  // File reference bonus
  if (content.includes('src/') || content.includes('.ts') || content.includes('.js')) {
    score += 3;
  }
  
  // Project path matching bonus
  if (projectPath && message.cwd && message.cwd.includes(projectPath)) {
    score += 5;
  }
  
  return score;
}

export function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

export function getTimeRangeFilter(timeframe?: string): (timestamp: string) => boolean {
  if (!timeframe) return () => true;
  
  const now = new Date();
  const cutoff = new Date();
  
  switch (timeframe.toLowerCase()) {
    case 'today':
      cutoff.setHours(0, 0, 0, 0);
      break;
    case 'yesterday':
      cutoff.setDate(now.getDate() - 1);
      cutoff.setHours(0, 0, 0, 0);
      break;
    case 'week':
    case 'last-week':
      cutoff.setDate(now.getDate() - 7);
      break;
    case 'month':
    case 'last-month':
      cutoff.setMonth(now.getMonth() - 1);
      break;
    default:
      return () => true;
  }
  
  return (timestamp: string) => {
    const messageDate = new Date(timestamp);
    return messageDate >= cutoff;
  };
}