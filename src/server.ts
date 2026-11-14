import { McpServer } from '@modelcontextprotocol/server';
import { type ClientOptions, VaartixClient, VERSION } from './client.js';
import { INSTRUCTIONS, registerTools } from './tools.js';

/** Builds the Vaartix MCP server with its tools, calling the API with an API key. */
export function createServer(options: ClientOptions): McpServer {
  const client = new VaartixClient(options);
  const server = new McpServer(
    { name: 'vaartix', version: VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, (method, path, requestOptions) =>
    client.request(method, path, requestOptions),
  );
  return server;
}
