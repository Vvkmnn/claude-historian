#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const server = spawn('node', [join(__dirname, 'dist/index.js')], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let requestId = 1;

function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: "2.0",
    id: requestId++,
    method,
    ...params
  };
  server.stdin.write(JSON.stringify(request) + '\n');
}

// Initialize server
sendRequest("initialize", {
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" }
  }
});

// Test all tools
setTimeout(() => {
  console.log('\n=== Testing find_file_context ===');
  sendRequest("tools/call", {
    params: {
      name: "find_file_context",
      arguments: { filepath: "package.json", limit: 2 }
    }
  });
}, 200);

setTimeout(() => {
  console.log('\n=== Testing find_similar_queries ===');
  sendRequest("tools/call", {
    params: {
      name: "find_similar_queries", 
      arguments: { query: "error debugging", limit: 2 }
    }
  });
}, 400);

setTimeout(() => {
  console.log('\n=== Testing get_error_solutions ===');
  sendRequest("tools/call", {
    params: {
      name: "get_error_solutions",
      arguments: { error_pattern: "MODULE_NOT_FOUND", limit: 2 }
    }
  });
}, 600);

setTimeout(() => {
  console.log('\n=== Testing list_recent_sessions ===');
  sendRequest("tools/call", {
    params: {
      name: "list_recent_sessions",
      arguments: { limit: 3 }
    }
  });
}, 800);

setTimeout(() => {
  console.log('\n=== Testing find_tool_patterns ===');
  sendRequest("tools/call", {
    params: {
      name: "find_tool_patterns",
      arguments: { tool_name: "Read", limit: 2 }
    }
  });
}, 1000);

// Handle responses
server.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      if (response.result && response.result.content) {
        console.log(response.result.content[0].text.substring(0, 300) + '...');
      }
    } catch (e) {
      // Ignore non-JSON
    }
  });
});

setTimeout(() => {
  server.kill();
  console.log('\n=== All tools tested ===');
}, 2000);