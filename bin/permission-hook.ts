#!/usr/bin/env bun
import { connect } from 'node:net';
import { stderr, stdin, stdout, exit, env } from 'node:process';

async function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stdin.on('data', c => chunks.push(Buffer.from(c)));
    stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stdin.on('error', reject);
  });
}

async function roundTrip(sockPath: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(sockPath);
    let buf = '';
    let done = false;
    sock.on('connect', () => sock.write(payload + '\n'));
    sock.on('data', chunk => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx >= 0 && !done) {
        done = true;
        resolve(buf.slice(0, idx));
        sock.end();
      }
    });
    sock.on('error', reject);
    sock.on('close', () => { if (!done) reject(new Error('socket closed before response')); });
  });
}

async function main() {
  const sock = env.COLLAB_SESSION_SOCK;
  if (!sock) { stderr.write('[permission-hook] COLLAB_SESSION_SOCK not set\n'); exit(2); }
  const raw = await readAllStdin();
  JSON.parse(raw); // sanity check
  const reply = await roundTrip(sock, raw.trim());
  stdout.write(reply + '\n');
  exit(0);
}

main().catch(err => { stderr.write(`[permission-hook] ${err?.message ?? err}\n`); exit(2); });
