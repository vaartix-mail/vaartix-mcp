#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const apiKey = process.env.VAARTIX_API_KEY?.trim();
if (!apiKey) {
  console.error(
    'vaartix-mcp: set VAARTIX_API_KEY to a Vaartix API key (create one at https://app.vaartix.com).',
  );
  process.exit(1);
}

const server = createServer({ apiKey, baseUrl: process.env.VAARTIX_BASE_URL || undefined });
await server.connect(new StdioServerTransport());
