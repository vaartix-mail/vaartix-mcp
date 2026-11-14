import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type ClientOptions, VaartixApiError, VaartixClient, VERSION } from './client.js';

const addresses = z
  .union([z.string().min(3), z.array(z.string().min(3)).min(1).max(50)])
  .describe('One address or a list, e.g. "priya@example.com" or "Priya <priya@example.com>"');

const emailId = z
  .string()
  .regex(/^em_[A-Za-z0-9]+$/, 'An email ID looks like em_...')
  .describe('Vaartix email ID, e.g. em_7hq2kv9xr4m1c8d3');

const tag = z.object({
  name: z.string().min(1).max(256),
  value: z.string().min(1).max(256),
});

const emailFields = {
  from: z
    .string()
    .min(3)
    .describe('Sender on a domain verified in Vaartix, e.g. "Acme <hello@notify.acme.in>"'),
  to: addresses,
  subject: z.string().min(1).max(998),
  html: z.string().optional().describe('HTML body. Give html, text or both.'),
  text: z.string().optional().describe('Plain-text body. Give html, text or both.'),
  cc: addresses.optional(),
  bcc: addresses.optional(),
  replyTo: addresses.optional(),
  tags: z.array(tag).max(50).optional().describe('Name/value tags to filter and group emails'),
  scheduledAt: z
    .string()
    .optional()
    .describe('ISO 8601 date-time to send later, e.g. 2026-12-01T09:00:00+05:30'),
};

function toEmailBody(input: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) body[key] = value;
  }
  return body;
}

function needsBody(input: { html?: string; text?: string }): string | null {
  return input.html || input.text ? null : 'Give an html or text body.';
}

function ok(data: unknown, summary: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent:
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : { result: data },
  };
}

function fail(error: unknown): CallToolResult {
  const message =
    error instanceof VaartixApiError
      ? `Vaartix API error (${error.type}${error.statusCode ? `, HTTP ${error.statusCode}` : ''}): ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Builds the Vaartix MCP server with its tools. */
export function createServer(options: ClientOptions): McpServer {
  const client = new VaartixClient(options);
  const server = new McpServer(
    { name: 'vaartix', version: VERSION },
    {
      instructions:
        'Tools for the Vaartix transactional email API. Sending an email delivers a real message, so confirm the recipients and content with the user before calling send_email or send_batch.',
    },
  );

  server.registerTool(
    'send_email',
    {
      title: 'Send email',
      description:
        'Send one transactional email (login code, receipt, notification) through Vaartix. Delivers a real email. Returns the email ID.',
      inputSchema: {
        ...emailFields,
        idempotencyKey: z
          .string()
          .max(256)
          .optional()
          .describe(
            'Retrying with the same key within 24 hours returns the first email instead of sending again',
          ),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ idempotencyKey, ...input }) => {
      const missing = needsBody(input);
      if (missing) return fail(new Error(missing));
      try {
        const result = await client.request('POST', '/emails', {
          body: toEmailBody(input),
          idempotencyKey,
        });
        return ok(result, 'Email queued for sending.');
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'send_batch',
    {
      title: 'Send batch',
      description:
        'Send up to 100 transactional emails in one call. Delivers real emails. Returns their IDs in order.',
      inputSchema: {
        emails: z.array(z.object(emailFields)).min(1).max(100),
        idempotencyKey: z.string().max(256).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ emails, idempotencyKey }) => {
      for (const [index, email] of emails.entries()) {
        const missing = needsBody(email);
        if (missing) return fail(new Error(`Email ${index + 1}: ${missing}`));
      }
      try {
        const result = await client.request('POST', '/emails/batch', {
          body: emails.map(toEmailBody),
          idempotencyKey,
        });
        return ok(result, `${emails.length} email(s) queued for sending.`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'get_email',
    {
      title: 'Get email',
      description:
        'Get one email with its status (queued, sent, delivered, bounced, complained...) and event timeline. Needs a full-access API key.',
      inputSchema: { id: emailId },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        return ok(await client.request('GET', `/emails/${encodeURIComponent(id)}`), `Email ${id}:`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'list_emails',
    {
      title: 'List emails',
      description:
        'List recent emails, newest first, with optional filters. Needs a full-access API key.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('1 to 100, default 20'),
        before: emailId.optional().describe('Return emails older than this email ID (paging)'),
        status: z
          .enum([
            'queued',
            'scheduled',
            'sending',
            'sent',
            'delivered',
            'delivery_delayed',
            'bounced',
            'complained',
            'suppressed',
            'failed',
            'canceled',
          ])
          .optional(),
        search: z.string().max(200).optional().describe('Search recipient, sender or subject'),
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe('Only emails from the last N days'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (query) => {
      try {
        return ok(await client.request('GET', '/emails', { query }), 'Recent emails:');
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'cancel_email',
    {
      title: 'Cancel scheduled email',
      description: 'Cancel a scheduled email before it is sent. Needs a full-access API key.',
      inputSchema: { id: emailId },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        return ok(
          await client.request('POST', `/emails/${encodeURIComponent(id)}/cancel`),
          `Email ${id} canceled.`,
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
