#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test MCP server communication
const server = spawn('node', [join(__dirname, 'dist/index.js')], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// MCP initialization
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "test-client",
      version: "1.0.0"
    }
  }
};

// Send initialization
server.stdin.write(JSON.stringify(initialize) + '\n');

// List tools request
const listTools = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list"
};

setTimeout(() => {
  server.stdin.write(JSON.stringify(listTools) + '\n');
}, 100);

// Search conversations request
const searchRequest = {
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "search_conversations",
    arguments: {
      query: "implement create build",
      limit: 3
    }
  }
};

setTimeout(() => {
  server.stdin.write(JSON.stringify(searchRequest) + '\n');
}, 200);

// Handle responses
server.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      console.log('Response:', JSON.stringify(response, null, 2));
    } catch (e) {
      console.log('Non-JSON output:', line);
    }
  });
});

server.stderr.on('data', (data) => {
  console.error('Error:', data.toString());
});

setTimeout(() => {
  server.kill();
}, 2000);