import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from './server.js';
import { type ApiRequest, registerTools, TOOLS } from './tools.js';

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(status = 200, payload: unknown = { id: 'em_abc123' }) {
  const calls: Call[] = [];
  const fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(payload === undefined ? '' : JSON.stringify(payload), { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

/** Each HTTP request the client made: its MCP-Protocol-Version and Mcp-Method headers. */
const wire: { version: string | null; method: string | null }[] = [];

/** A client on protocol revision 2026-07-28, served in-process by the same handler as HTTP. */
async function connectServer(build: () => McpServer) {
  const handler = createMcpHandler(build);
  wire.length = 0;
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp.test/'), {
    fetch: (url, init) => {
      const request = new Request(url, init);
      wire.push({
        version: request.headers.get('mcp-protocol-version'),
        method: request.headers.get('mcp-method'),
      });
      return handler.fetch(request);
    },
  });
  const client = new Client(
    { name: 'test', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(transport);
  closers.push(
    () => client.close(),
    () => handler.close(),
  );
  return client;
}

function connect(fetch: typeof globalThis.fetch) {
  return connectServer(() =>
    createServer({ apiKey: 'vx_test_key', baseUrl: 'https://api.example.test/', fetch }),
  );
}

function first(calls: Call[]): Call {
  const call = calls[0];
  if (!call) throw new Error('no API call was made');
  return call;
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  const first = (result.content as { type: string; text: string }[])[0];
  return first?.text ?? '';
}

describe('vaartix-mcp', () => {
  it('lists the tools with annotations', async () => {
    const client = await connect(fakeFetch().fetch);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'send_email',
      'send_batch',
      'get_email',
      'list_emails',
      'cancel_email',
      'list_domains',
      'get_domain',
    ]);
    expect(tools.find((t) => t.name === 'get_email')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'send_email')?.annotations?.readOnlyHint).toBeFalsy();
  });

  it('sends an email with auth, idempotency key and only the given fields', async () => {
    const { fetch, calls } = fakeFetch();
    const client = await connect(fetch);
    const result = await client.callTool({
      name: 'send_email',
      arguments: {
        from: 'Acme <hi@example.com>',
        to: 'priya@example.com',
        subject: 'Your login code',
        html: '<p>482913</p>',
        idempotencyKey: 'login-1',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('em_abc123');
    expect(calls).toHaveLength(1);
    const call = first(calls);
    expect(call.method).toBe('POST');
    expect(call.url.href).toBe('https://api.example.test/emails');
    expect(call.headers.Authorization).toBe('Bearer vx_test_key');
    expect(call.headers['Idempotency-Key']).toBe('login-1');
    expect(call.body).toEqual({
      from: 'Acme <hi@example.com>',
      to: 'priya@example.com',
      subject: 'Your login code',
      html: '<p>482913</p>',
    });
  });

  it('refuses an email without a body, without calling the API', async () => {
    const { fetch, calls } = fakeFetch();
    const client = await connect(fetch);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { from: 'hi@example.com', to: 'a@example.com', subject: 'S' },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('html or text');
    expect(calls).toHaveLength(0);
  });

  it('sends a batch as a list', async () => {
    const { fetch, calls } = fakeFetch(200, { data: [{ id: 'em_1' }, { id: 'em_2' }] });
    const client = await connect(fetch);
    const result = await client.callTool({
      name: 'send_batch',
      arguments: {
        emails: [
          { from: 'hi@example.com', to: 'a@example.com', subject: 'A', text: 'a' },
          { from: 'hi@example.com', to: ['b@example.com'], subject: 'B', text: 'b' },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(first(calls).url.pathname).toBe('/emails/batch');
    expect(Array.isArray(first(calls).body)).toBe(true);
    expect((first(calls).body as unknown[]).length).toBe(2);
  });

  it('reports API errors as tool errors with the API message', async () => {
    const { fetch } = fakeFetch(403, {
      error: { type: 'domain_not_verified', message: 'example.com is not verified.' },
    });
    const client = await connect(fetch);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { from: 'hi@example.com', to: 'a@example.com', subject: 'S', text: 'B' },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('domain_not_verified');
    expect(text(result)).toContain('HTTP 403');
    expect(text(result)).not.toContain('vx_test_key');
  });

  it('gets, lists and cancels emails', async () => {
    const { fetch, calls } = fakeFetch(200, { id: 'em_abc123', status: 'delivered' });
    const client = await connect(fetch);
    await client.callTool({ name: 'get_email', arguments: { id: 'em_abc123' } });
    await client.callTool({
      name: 'list_emails',
      arguments: { limit: 5, status: 'bounced', search: 'priya' },
    });
    await client.callTool({ name: 'cancel_email', arguments: { id: 'em_abc123' } });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`)).toEqual([
      'GET /emails/em_abc123',
      'GET /emails?limit=5&status=bounced&search=priya',
      'POST /emails/em_abc123/cancel',
    ]);
  });

  it('rejects invalid email IDs before calling the API', async () => {
    const { fetch, calls } = fakeFetch();
    const client = await connect(fetch);
    const result = await client.callTool({ name: 'get_email', arguments: { id: '../admin' } });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('reports network failures', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;
    const client = await connect(fetch);
    const result = await client.callTool({ name: 'get_email', arguments: { id: 'em_abc123' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Could not reach the Vaartix API');
  });

  it('speaks protocol revision 2026-07-28 over HTTP', async () => {
    const client = await connect(fakeFetch().fetch);
    await client.listTools();
    expect(wire.length).toBeGreaterThan(0);
    expect(wire.every((r) => r.version === '2026-07-28')).toBe(true);
    expect(wire.some((r) => r.method === 'initialize')).toBe(false);
    expect(wire.some((r) => r.method === 'tools/list')).toBe(true);
  });

  it('gets and lists domains', async () => {
    const { fetch, calls } = fakeFetch(200, { data: [] });
    const client = await connect(fetch);
    await client.callTool({ name: 'list_domains', arguments: {} });
    await client.callTool({ name: 'get_domain', arguments: { id: 'dom_5bvatg1v837anztd' } });
    const bad = await client.callTool({ name: 'get_domain', arguments: { id: 'em_abc' } });
    expect(bad.isError).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /domains',
      'GET /domains/dom_5bvatg1v837anztd',
    ]);
  });

  it('serves clients that open with initialize (protocol revisions before 2026-07-28)', async () => {
    const { fetch, calls } = fakeFetch();
    const server = createServer({ apiKey: 'k', baseUrl: 'https://api.example.test', fetch });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'legacy', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(() => client.close());
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOLS.length);
    await client.callTool({ name: 'get_email', arguments: { id: 'em_abc123' } });
    expect(first(calls).url.pathname).toBe('/emails/em_abc123');
  });
});

describe('shared tool definitions', () => {
  const sample: Record<string, Record<string, unknown>> = {
    send_email: { from: 'a@example.com', to: 'b@example.com', subject: 'S', text: 'T' },
    send_batch: {
      emails: [{ from: 'a@example.com', to: 'b@example.com', subject: 'S', text: 'T' }],
    },
    get_email: { id: 'em_abc123' },
    list_emails: {},
    cancel_email: { id: 'em_abc123' },
    list_domains: {},
    get_domain: { id: 'dom_abc123' },
  };

  it('each tool calls only the routes it declares, and has a scope', async () => {
    for (const tool of TOOLS) {
      const seen: string[] = [];
      const request: ApiRequest = async (method, path) => {
        seen.push(`${method} ${path}`);
        return {};
      };
      const input = sample[tool.name];
      expect(input, tool.name).toBeDefined();
      await tool.run(tool.inputSchema.parse(input) as Record<string, unknown>, request);
      const patterns = tool.routes.map((route) => {
        const [method, pattern] = route.split(' ');
        return new RegExp(`^${method} ${pattern?.replace(/:[a-z]+/g, '[^/]+')}$`);
      });
      expect(seen.length, tool.name).toBeGreaterThan(0);
      for (const call of seen)
        expect(
          patterns.some((p) => p.test(call)),
          call,
        ).toBe(true);
      expect(['send', 'read']).toContain(tool.scope);
      expect(tool.annotations.readOnlyHint === true).toBe(tool.scope === 'read');
    }
  });

  it('registerTools lets the host give each tool its own request function', async () => {
    const used: string[] = [];
    const client = await connectServer(() => {
      const server = new McpServer({ name: 'hosted', version: '1.0.0' });
      registerTools(
        server,
        async () => {
          throw new Error('the default request function should not be used');
        },
        {
          requestFor: (tool) => async (method, path) => {
            used.push(`${tool.name}: ${method} ${path}`);
            return { ok: true };
          },
        },
      );
      return server;
    });
    const result = await client.callTool({ name: 'list_domains', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(used).toEqual(['list_domains: GET /domains']);
  });
});
