#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

const apiKey = process.env.VAARTIX_API_KEY?.trim();
if (!apiKey) {
  console.error(
    'vaartix-mcp: set VAARTIX_API_KEY to a Vaartix API key (create one at https://app.vaartix.com).',
  );
  process.exit(1);
}

const baseUrl = process.env.VAARTIX_BASE_URL || undefined;
// Serves clients on protocol revision 2026-07-28 and on the earlier, initialize-based revisions.
serveStdio(() => createServer({ apiKey, baseUrl }));
