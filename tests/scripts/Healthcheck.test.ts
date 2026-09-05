import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { spawn } from 'node:child_process';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function check(status: number, body: string, respond = true): Promise<number | null> {
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  const command = dockerfile.match(/CMD (\["node", "-e", .+\])/);
  expect(command, 'Docker HEALTHCHECK must execute Node without curl').not.toBeNull();
  const args: string[] = JSON.parse(command![1]);
  const server = createServer((_req, res) => {
    if (respond) res.writeHead(status).end(body);
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP test address');
  const script = args[2].replace('http://localhost:3000/health', `http://127.0.0.1:${address.port}/health`);
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['-e', script], { stdio: 'ignore', timeout: 9000 });
    process.on('error', reject);
    process.on('exit', resolve);
  });
}

describe('image HEALTHCHECK', () => {
  it('accepts a connected bot', async () => expect(await check(200, '{"bot":{"ready":true}}')).toBe(0));
  it.each(['{"bot":{"ready":false}}', '{}', '{"bot":{"ready":"true"}}'])('rejects a bot that is not ready: %s', async body => {
    expect(await check(200, body)).toBe(1);
  });
  it('rejects HTTP failure even with ready true', async () => expect(await check(500, '{"bot":{"ready":true}}')).toBe(1));
  it('rejects invalid JSON', async () => expect(await check(200, 'invalid')).toBe(1));
  it('bounds a hung health request', async () => expect(await check(200, '', false)).toBe(1), 10000);
});
