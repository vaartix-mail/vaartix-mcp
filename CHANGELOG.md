# Changelog

## 0.2.0

- New tools: `list_domains` and `get_domain`.
- Built on version 2 of the MCP TypeScript SDK: speaks protocol revision 2026-07-28 and still serves
  clients on the earlier, `initialize`-based revisions.
- The tool definitions are exported as `vaartix-mcp/tools`, so the hosted Vaartix MCP server offers
  exactly the same tools.
- Needs Node.js 20 or later (was 18).

## 0.1.0

- First release: `send_email`, `send_batch`, `get_email`, `list_emails` and `cancel_email` tools over
  stdio, configured with `VAARTIX_API_KEY`.
