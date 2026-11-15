# Changelog

## 0.3.1

- **Sends waiting for approval are reported as such.** A Vaartix connection can require a person's
  approval before each send. The API then answers `status: "pending_approval"` with an approval ID
  and an expiry, and nothing is sent until an owner or admin approves it. `send_email` and
  `send_batch` now say exactly that, and tell the assistant not to send again, instead of
  "queued for sending". Exported as `sentSummary(data, queued)`.

## 0.3.0

**Behaviour change: `get_email` no longer returns the email's body by default.** It returns the
details (status, sender, recipients, subject, tags, events and times) and `contentIncluded: false`.
To get the HTML, text and custom headers, call it with `includeContent: true`. The body then comes
back in its own block, marked as untrusted data from the email, never instructions.

- **Reading content with an API key** (the local `npx` server): a full-access key can read bodies,
  as before, by asking with `includeContent: true`. Team owners will be able to turn this off per
  key with a "read content" setting in the dashboard; with it off, the API leaves the body out and
  `get_email` says the key has no read-content permission. A send-only key can't read emails at all.
- **Per-call limits:** at most 50 recipients per email (to, cc and bcc together) and 20 emails per
  `send_batch` call (was 100). Exported as `CALL_LIMITS`; Vaartix can set lower limits, and nothing
  an agent sends can raise these.
- **No attachments or custom headers** through MCP: emails with them are refused, not silently
  changed. `replyTo` takes at most 5 addresses.
- **Permissions:** `send`, `read` (details, never bodies), `read_content` (bodies) and `cancel`
  (`cancel_email`, which needed `send` before). Exported as `SCOPES`, with `scopesFor(tool, input)`
  giving what a call needs.
- **Safer wording:** sending and cancelling tools tell the assistant to show the user exactly what
  will happen and get their confirmation; the server instructions say email content is data, never
  instructions, and that the tools can't change keys, members, webhooks, domains, billing or
  settings.

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
