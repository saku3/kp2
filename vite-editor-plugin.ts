// Browser VS Code (code-server) integration.
//
//   GET  /api/editor          -> { available, url, workspace }
//   POST /api/open            <- { file, line? }   opens the file in the running code-server
//   /code/*                   -> proxied to code-server (configured in vite.config.ts)
//
// code-server is optional: when it is not running, /api/editor reports available:false and the
// UI hides the editor pane. Opening a file uses `code-server -r`, which talks to the running
// instance through the IPC socket in its user-data-dir (so both must use the same directory).
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface EditorOptions {
  codeServerUrl: string; // e.g. http://127.0.0.1:7682
  workspace: string;
  dataDir: string;
}

export function editorDefaults(): EditorOptions {
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return {
    codeServerUrl: process.env.CODE_SERVER_URL ?? `http://127.0.0.1:${process.env.CODE_SERVER_PORT ?? '7682'}`,
    workspace: path.resolve(process.env.KP2_WORKSPACE ?? process.cwd()),
    dataDir: process.env.KP2_CODE_SERVER_DATA ?? path.join(xdgData, 'kp2', 'code-server'),
  };
}

async function isRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) reject(new Error('Body too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function runCodeServer(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('code-server', args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });
}

export function editorPlugin(opts: EditorOptions): Plugin {
  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/editor' && req.method === 'GET') {
        return sendJson(res, 200, {
          available: await isRunning(opts.codeServerUrl),
          url: `/code/?folder=${encodeURIComponent(opts.workspace)}`,
          workspace: opts.workspace,
        });
      }
      if (url.pathname === '/api/open' && req.method === 'POST') {
        const { file, line } = JSON.parse(await readBody(req)) as { file?: unknown; line?: unknown };
        if (typeof file !== 'string' || !file.trim()) return sendJson(res, 400, { error: 'file is required' });
        if (line !== undefined && !(Number.isInteger(line) && (line as number) > 0)) return sendJson(res, 400, { error: 'line must be a positive integer' });
        const full = path.resolve(opts.workspace, file);
        const stat = await fs.stat(full).catch(() => null);
        if (!stat?.isFile()) return sendJson(res, 404, { error: `Not a file: ${full}` });
        if (!(await isRunning(opts.codeServerUrl))) return sendJson(res, 503, { error: 'code-server is not running' });
        await runCodeServer(['--user-data-dir', opts.dataDir, '-r', line ? `${full}:${line}` : full]);
        return sendJson(res, 200, { opened: full, line: line ?? null });
      }
      return next();
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  };

  return {
    name: 'kp2-editor',
    configureServer(server) {
      console.log(`  ➜  editor:  ${opts.workspace} via ${opts.codeServerUrl} (optional)`);
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
