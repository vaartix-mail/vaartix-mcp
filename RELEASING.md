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
