export const DEFAULT_BASE_URL = 'https://api.vaartix.com';
export const VERSION = '0.2.0';

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** An error returned by the Vaartix API, or a network failure. */
export class VaartixApiError extends Error {
  constructor(
    readonly type: string,
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = 'VaartixApiError';
  }
}

function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

/** A small client for the Vaartix REST API, used by the MCP tools. */
export class VaartixClient {
  readonly #key: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: ClientOptions) {
    if (!options.apiKey) throw new Error('Missing Vaartix API key (set VAARTIX_API_KEY).');
    this.#key = options.apiKey;
    this.#baseUrl = trimTrailingSlashes(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      idempotencyKey?: string;
    } = {},
  ): Promise<unknown> {
    const url = new URL(this.#baseUrl + path);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#key}`,
      Accept: 'application/json',
      'User-Agent': `vaartix-mcp/${VERSION}`,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'error',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new VaartixApiError(
        'network_error',
        `Could not reach the Vaartix API: ${reason}`,
        null,
      );
    }

    const raw = await response.text();
    let payload: unknown = null;
    if (raw !== '') {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const error =
        payload && typeof payload === 'object' && 'error' in payload
          ? (payload as { error?: { type?: unknown; message?: unknown } }).error
          : undefined;
      throw new VaartixApiError(
        typeof error?.type === 'string' ? error.type : 'api_error',
        typeof error?.message === 'string'
          ? error.message
          : `Request failed with status ${response.status}`,
        response.status,
      );
    }
    return payload;
  }
}
