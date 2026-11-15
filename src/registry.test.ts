import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './client.js';

const read = (file: string) =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));

// The MCP Registry checks that the npm package's mcpName matches server.json's name, and that the
// package version server.json names exists on npm: keep the three in step for every release.
describe('MCP Registry listing (server.json)', () => {
  const pkg = read('package.json');
  const server = read('server.json');

  it('names the package and this version', () => {
    expect(pkg.mcpName).toBe(server.name);
    expect(server.version).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
    const npm = server.packages.find((p: { registryType: string }) => p.registryType === 'npm');
    expect(npm).toMatchObject({ identifier: pkg.name, version: pkg.version });
  });

  it('lists the hosted server over Streamable HTTP', () => {
    expect(server.remotes).toEqual([{ type: 'streamable-http', url: 'https://mcp.vaartix.com' }]);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });
});
