import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from './server.js';

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

async function connect(fetch: typeof globalThis.fetch) {
  const server = createServer({
    apiKey: 'vx_test_key',
    baseUrl: 'https://api.example.test/',
    fetch,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
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
    expect(tools.map((t) => t.name).sort()).toEqual([
      'cancel_email',
      'get_email',
      'list_emails',
      'send_batch',
      'send_email',
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
});
