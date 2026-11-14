# Vaartix MCP server

Let Claude, Cursor and other AI tools send and look up transactional email through
[Vaartix](https://vaartix.com), the email API built in India.

```
"Send the login code 482913 to priya@example.com from noreply@notify.acme.in"
"Did the order confirmation to ravi@example.com get delivered?"
"Show me emails that bounced in the last 7 days"
```

## Tools

| Tool | What it does | API key |
|---|---|---|
| `send_email` | Send one email (HTML and/or text, cc, bcc, reply-to, tags, scheduled sending, idempotency key) | Send-only or full access |
| `send_batch` | Send up to 100 emails in one call | Send-only or full access |
| `get_email` | One email with its status and event timeline | Full access |
| `list_emails` | Recent emails, filtered by status, search text or days | Full access |
| `cancel_email` | Cancel a scheduled email | Full access |
| `list_domains` | Your sending domains, with verification status and DNS records | Full access |
| `get_domain` | One domain: whether it's verified and the DNS records it needs | Full access |

Sending tools deliver **real email**. Most MCP clients ask you to approve each tool call, so check
the recipients and content before you approve.

## Setup

You need a Vaartix API key from [app.vaartix.com](https://app.vaartix.com) → API keys. For sending
only, create a **send-only key limited to your domain**. Use a full-access key only if you also want
the AI tool to read your email logs.

### Claude Desktop

Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "vaartix": {
      "command": "npx",
      "args": ["-y", "vaartix-mcp"],
      "env": { "VAARTIX_API_KEY": "vx_your_api_key" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add vaartix --env VAARTIX_API_KEY=vx_your_api_key -- npx -y vaartix-mcp
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "vaartix": {
      "command": "npx",
      "args": ["-y", "vaartix-mcp"],
      "env": { "VAARTIX_API_KEY": "vx_your_api_key" }
    }
  }
}
```

### Other clients

Any MCP client that runs stdio servers works: run `npx -y vaartix-mcp` with `VAARTIX_API_KEY` set.

It needs Node.js 20 or later.

## Configuration

| Variable | Required | Default |
|---|---|---|
| `VAARTIX_API_KEY` | Yes | |
| `VAARTIX_BASE_URL` | No | `https://api.vaartix.com` |

Keep the key out of shared or committed config files. Anyone who can read the config can send
email as you.

## Development

```bash
npm install
npm test          # tool tests against a fake API
npm run lint
npm run typecheck
npm run build     # outputs dist/index.js (the vaartix-mcp command)
```

## Using the tool definitions

The tools are defined once in `vaartix-mcp/tools` (name, input schema, annotations, the permission
each needs and the API routes it calls), so other MCP servers can offer exactly the same tools:

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { registerTools, TOOLS } from 'vaartix-mcp/tools';

const server = new McpServer({ name: 'vaartix', version: '1.0.0' });
registerTools(server, async (method, path, options) => {
  // Call the Vaartix API and return the parsed JSON.
});
```

## License

MIT. Vaartix is a product of NAP Designs, Bengaluru.
