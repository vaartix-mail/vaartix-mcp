import type {
  CallToolResult,
  McpServer,
  ScopeChallengeHandler,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { VaartixApiError, VERSION } from './client.js';

export { VaartixApiError, VERSION };

/**
 * The tools the Vaartix MCP server offers, defined once and shared by the stdio server in this
 * package and the hosted server at https://mcp.vaartix.com, so the two never drift apart.
 *
 * A tool only talks to the Vaartix REST API through the `request` function it is given. The stdio
 * server passes one that calls the API with your API key; the hosted server passes one that calls
 * the same routes as the signed-in user.
 */

/**
 * What a tool needs when you sign in to the hosted server: `send` to send and cancel email, `read`
 * to look up emails and domains. With an API key, a send-only key has `send` and a full-access key
 * has both.
 */
export type Scope = 'send' | 'read';

export type HttpMethod = 'GET' | 'POST';

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
}

/** Calls the Vaartix API and returns the parsed JSON, or throws a VaartixApiError. */
export type ApiRequest = (
  method: HttpMethod,
  path: string,
  options?: RequestOptions,
) => Promise<unknown>;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** The permission the tool needs. */
  scope: Scope;
  /** The API routes the tool may call, as `METHOD /path/:param`. Nothing else is reachable. */
  routes: string[];
  run(input: Record<string, unknown>, request: ApiRequest): Promise<CallToolResult>;
}

const addresses = z
  .union([z.string().min(3), z.array(z.string().min(3)).min(1).max(50)])
  .describe('One address or a list, e.g. "priya@example.com" or "Priya <priya@example.com>"');

const emailId = z
  .string()
  .regex(/^em_[A-Za-z0-9]+$/, 'An email ID looks like em_...')
  .describe('Vaartix email ID, e.g. em_7hq2kv9xr4m1c8d3');

const domainId = z
  .string()
  .regex(/^dom_[A-Za-z0-9]+$/, 'A domain ID looks like dom_...')
  .describe('Vaartix domain ID, e.g. dom_5bvatg1v837anztd');

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

const EMAIL_STATUSES = [
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
] as const;

const READ_ACCESS =
  'Needs read access: a full-access API key, or the read permission when signed in.';

function withoutUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) body[key] = value;
  }
  return body;
}

function needsBody(input: { html?: unknown; text?: unknown }): string | null {
  return input.html || input.text ? null : 'Give an html or text body.';
}

export function ok(data: unknown, summary: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent:
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : { result: data },
  };
}

export function fail(error: unknown): CallToolResult {
  const message =
    error instanceof VaartixApiError
      ? `Vaartix API error (${error.type}${error.statusCode ? `, HTTP ${error.statusCode}` : ''}): ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

async function call(
  work: () => Promise<unknown>,
  summary: string | ((data: unknown) => string),
): Promise<CallToolResult> {
  try {
    const data = await work();
    return ok(data, typeof summary === 'function' ? summary(data) : summary);
  } catch (error) {
    return fail(error);
  }
}

const path = (template: string, id: string) => template.replace(/:id\b/, encodeURIComponent(id));

/** Every tool, in the order tools/list returns them (the spec asks for a stable order). */
export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'send_email',
    title: 'Send email',
    description:
      'Send one transactional email (login code, receipt, notification) through Vaartix. Delivers a real email. Returns the email ID.',
    inputSchema: z.object({
      ...emailFields,
      idempotencyKey: z
        .string()
        .max(256)
        .optional()
        .describe(
          'Retrying with the same key within 24 hours returns the first email instead of sending again',
        ),
    }),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    scope: 'send',
    routes: ['POST /emails'],
    async run({ idempotencyKey, ...input }, request) {
      const missing = needsBody(input);
      if (missing) return fail(new Error(missing));
      return call(
        () =>
          request('POST', '/emails', {
            body: withoutUndefined(input),
            idempotencyKey: idempotencyKey as string | undefined,
          }),
        'Email queued for sending.',
      );
    },
  },
  {
    name: 'send_batch',
    title: 'Send batch',
    description:
      'Send up to 100 transactional emails in one call. Delivers real emails. Returns their IDs in order.',
    inputSchema: z.object({
      emails: z.array(z.object(emailFields)).min(1).max(100),
      idempotencyKey: z.string().max(256).optional(),
    }),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    scope: 'send',
    routes: ['POST /emails/batch'],
    async run({ emails, idempotencyKey }, request) {
      const list = emails as Record<string, unknown>[];
      for (const [index, email] of list.entries()) {
        const missing = needsBody(email);
        if (missing) return fail(new Error(`Email ${index + 1}: ${missing}`));
      }
      return call(
        () =>
          request('POST', '/emails/batch', {
            body: list.map(withoutUndefined),
            idempotencyKey: idempotencyKey as string | undefined,
          }),
        `${list.length} email(s) queued for sending.`,
      );
    },
  },
  {
    name: 'get_email',
    title: 'Get email',
    description: `Get one email with its status (queued, sent, delivered, bounced, complained...) and event timeline. ${READ_ACCESS}`,
    inputSchema: z.object({ id: emailId }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    scope: 'read',
    routes: ['GET /emails/:id'],
    async run({ id }, request) {
      return call(() => request('GET', path('/emails/:id', id as string)), `Email ${id}:`);
    },
  },
  {
    name: 'list_emails',
    title: 'List emails',
    description: `List recent emails, newest first, with optional filters. ${READ_ACCESS}`,
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional().describe('1 to 100, default 20'),
      before: emailId.optional().describe('Return emails older than this email ID (paging)'),
      status: z.enum(EMAIL_STATUSES).optional(),
      search: z.string().max(200).optional().describe('Search recipient, sender or subject'),
      days: z.number().int().min(1).max(90).optional().describe('Only emails from the last N days'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    scope: 'read',
    routes: ['GET /emails'],
    async run(query, request) {
      return call(
        () =>
          request('GET', '/emails', {
            query: query as Record<string, string | number | undefined>,
          }),
        'Recent emails:',
      );
    },
  },
  {
    name: 'cancel_email',
    title: 'Cancel scheduled email',
    description:
      'Cancel a scheduled email before it is sent. Needs a full-access API key, or the send permission when signed in.',
    inputSchema: z.object({ id: emailId }),
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    scope: 'send',
    routes: ['POST /emails/:id/cancel'],
    async run({ id }, request) {
      return call(
        () => request('POST', path('/emails/:id/cancel', id as string)),
        `Email ${id} canceled.`,
      );
    },
  },
  {
    name: 'list_domains',
    title: 'List domains',
    description: `List the team's sending domains with their verification status and DNS records. ${READ_ACCESS}`,
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: true },
    scope: 'read',
    routes: ['GET /domains'],
    async run(_input, request) {
      return call(() => request('GET', '/domains'), 'Domains:');
    },
  },
  {
    name: 'get_domain',
    title: 'Get domain',
    description: `Get one sending domain: whether it is verified, and the DNS records it needs. ${READ_ACCESS}`,
    inputSchema: z.object({ id: domainId }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    scope: 'read',
    routes: ['GET /domains/:id'],
    async run({ id }, request) {
      return call(() => request('GET', path('/domains/:id', id as string)), `Domain ${id}:`);
    },
  },
];

export const INSTRUCTIONS =
  'Tools for the Vaartix transactional email API. Sending an email delivers a real message, so confirm the recipients and content with the user before calling send_email or send_batch.';

export interface RegisterOptions {
  /**
   * Per-tool scope checks (the hosted server uses them to ask the client for a missing
   * permission). Left out over stdio, where the API key decides.
   */
  scopeChallenge?: (tool: ToolDefinition) => ScopeChallengeHandler | undefined;
  /** Wraps each tool's request function, e.g. to limit it to the tool's own routes. */
  requestFor?: (tool: ToolDefinition) => ApiRequest;
}

/** Registers every Vaartix tool on an MCP server. */
export function registerTools(
  server: McpServer,
  request: ApiRequest,
  options: RegisterOptions = {},
): void {
  for (const tool of TOOLS) {
    const scopeChallenge = options.scopeChallenge?.(tool);
    const toolRequest = options.requestFor?.(tool) ?? request;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        ...(scopeChallenge ? { scopeChallenge } : {}),
      },
      async (input: unknown) => tool.run(input as Record<string, unknown>, toolRequest),
    );
  }
}
