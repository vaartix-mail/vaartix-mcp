# Releasing

Releases are published to npm by GitHub Actions with trusted publishing (OIDC), staged so that a
maintainer approves each one with their npm 2FA code. No npm token is stored anywhere.

## First release (one time)

npm can only add a trusted publisher to a package that already exists, so `vaartix-mcp` 0.1.0 is
published by hand once:

1. `npm login` (as the vaartix npm account, with 2FA).
2. On `main`: `npm ci && npm run build && npm publish --access public` and enter your 2FA code.
3. On npmjs.com → vaartix-mcp → Settings:
   - **Trusted Publisher** → GitHub Actions: organization `vaartix-mail`, repository `vaartix-mcp`,
     workflow `publish.yml`, environment `npm`, with "stage publish" permission only.
   - **Publishing access** → require 2FA and disallow tokens.
4. In GitHub → Settings → Environments, create `npm` with a deployment tag rule `v*`.

## Every later release

1. Bump `version` in `package.json` and `VERSION` in `src/client.ts`, update `CHANGELOG.md`,
   merge to `main` through a pull request.
2. Create a GitHub release with the tag `v<version>` on `main`. The Publish workflow stages it.
3. `npm stage list vaartix-mcp`, then `npm stage approve <id>` with your 2FA code.

## MCP Registry listing

`server.json` lists Vaartix in the [MCP Registry](https://registry.modelcontextprotocol.io) as
`com.vaartix/mcp`: the hosted server (`https://mcp.vaartix.com`) and this npm package. It's
published with the registry's `mcp-publisher` CLI, not through a pull request anywhere. The steps
below follow the registry's own docs (`docs/modelcontextprotocol-io/quickstart.mdx` and
`authentication.mdx` in github.com/modelcontextprotocol/registry); check them there first, as the
registry is in preview and may change.

1. **Release first.** The registry checks that the npm package version in `server.json` exists on
   npm and that its `package.json` has `"mcpName": "com.vaartix/mcp"`. So release the version
   `server.json` names (see above) before publishing to the registry.
2. **Prove we own vaartix.com, once.** Names under `com.vaartix/` need domain verification, either:
   - **DNS:** a TXT record on the apex `vaartix.com` (not a subdomain) of the form
     `v=MCPv1; k=ed25519; p=<public key>`, made from a key pair you keep:
     ```sh
     openssl genpkey -algorithm Ed25519 -out key.pem
     PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
     echo "vaartix.com. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
     ```
     Then log in:
     ```sh
     MCP_PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | sed -n '/priv:/,/pub:/p' | sed '1d;$d' | tr -d ' :\n')" \
       mcp-publisher login dns --domain vaartix.com
     ```
   - **HTTP:** the same `v=MCPv1; k=ed25519; p=<public key>` line served at
     `https://vaartix.com/.well-known/mcp-registry-auth`, then `mcp-publisher login http --domain vaartix.com`.

   Keep `key.pem` private (a password manager, not the repository). Remove an old TXT record when
   you rotate the key.
3. **Publish:** from this repository, `mcp-publisher publish`. Each new release needs a new
   `version` in `server.json` (matching the npm package) and another publish.
4. **Check:** `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.vaartix/mcp"`.

