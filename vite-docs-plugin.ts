// Serves markdown files from an arbitrary local directory to the browser.
//
//   GET /api/docs?dir=<path>            -> { dir: <resolved absolute path>, names: string[] }
//   GET /api/doc?dir=<path>&name=<rel>  -> markdown text
//
// `dir` may be absolute, relative to the repo, or start with "~". It defaults to DOCS_DIR
// (or ./docs). Only *.md files inside the directory are ever returned. In dev mode the
// directory is watched and changes are pushed to the browser as the "docs:changed" HMR event.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const SKIP_DIRS = new Set(['node_modules', '.git']);

function expandDir(input: string | null | undefined, fallback: string): string {
  let dir = input?.trim() || fallback;
  if (dir === '~' || dir.startsWith('~/')) dir = path.join(os.homedir(), dir.slice(1));
  return path.resolve(dir);
}

async function listMarkdown(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(path.join(dir, prefix), { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listMarkdown(dir, rel)));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(rel);
  }
  return out.sort();
}

function resolveDocPath(dir: string, name: string): string | null {
  if (!name.endsWith('.md') || name.includes('\0')) return null;
  const full = path.resolve(dir, name);
  if (full !== dir && !full.startsWith(dir + path.sep)) return null; // path traversal
  return full;
}

export function docsPlugin(defaultDir: string): Plugin {
  const resolvedDefault = expandDir(defaultDir, 'docs');
  let onDirUsed: (dir: string) => void = () => {};

  const send = (res: ServerResponse, status: number, body: string, type: string) => {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  };
  const sendJson = (res: ServerResponse, status: number, body: unknown) =>
    send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/docs' && url.pathname !== '/api/doc') return next();
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET only' });

    const dir = expandDir(url.searchParams.get('dir'), resolvedDefault);
    try {
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) return sendJson(res, 404, { error: `Not a directory: ${dir}` });

      if (url.pathname === '/api/docs') {
        onDirUsed(dir);
        return sendJson(res, 200, { dir, names: await listMarkdown(dir) });
      }

      const full = resolveDocPath(dir, url.searchParams.get('name') ?? '');
      if (!full) return sendJson(res, 400, { error: 'Invalid document name' });
      const text = await fs.readFile(full, 'utf8').catch(() => null);
      if (text === null) return sendJson(res, 404, { error: `Not found: ${full}` });
      return send(res, 200, text, 'text/markdown; charset=utf-8');
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  };

  return {
    name: 'kp2-docs',
    configureServer(server) {
      console.log(`  ➜  docs:    ${resolvedDefault} (default; DOCS_DIR or the UI can change it)`);
      const watched = new Set<string>();
      onDirUsed = (dir) => {
        if (watched.has(dir)) return;
        watched.add(dir);
        server.watcher.add(dir);
      };
      server.watcher.on('all', (event, file) => {
        if (!file.endsWith('.md')) return;
        for (const dir of watched) {
          if (!file.startsWith(dir + path.sep)) continue;
          const name = path.relative(dir, file).split(path.sep).join('/');
          server.ws.send({ type: 'custom', event: 'docs:changed', data: { dir, name, event } });
        }
      });
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
