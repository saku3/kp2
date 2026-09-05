// Favorites: folders and documents the user pinned, stored in a JSON file so they survive
// browser changes and can be edited by hand or kept in dotfiles.
//
//   GET /api/favorites            -> { path, favorites: Favorite[] }
//   PUT /api/favorites            <- { favorites: Favorite[] }   (replaces the whole list)
//
// File: $KP2_CONFIG_DIR/favorites.json, else $XDG_CONFIG_HOME/kp2/favorites.json,
// else ~/.config/kp2/favorites.json. Format: { "favorites": [ { "dir": "~/notes", "doc": "a.md" } ] }
// Directories are returned expanded to absolute paths; "~" is fine in the file.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface Favorite {
  dir: string;
  doc?: string;
  label?: string;
}

const MAX_BODY = 256 * 1024;

export function favoritesFile(): string {
  const base =
    process.env.KP2_CONFIG_DIR ??
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'kp2');
  return path.join(base, 'favorites.json');
}

function expandDir(dir: string): string {
  if (dir === '~' || dir.startsWith('~/')) dir = path.join(os.homedir(), dir.slice(1));
  return path.resolve(dir);
}

function sanitize(input: unknown): Favorite[] | null {
  if (!Array.isArray(input)) return null;
  const out: Favorite[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const { dir, doc, label } = item as Record<string, unknown>;
    if (typeof dir !== 'string' || !dir.trim()) return null;
    if (doc !== undefined && (typeof doc !== 'string' || !doc.endsWith('.md') || doc.includes('..'))) return null;
    if (label !== undefined && typeof label !== 'string') return null;
    const fav: Favorite = { dir: dir.trim() };
    if (doc) fav.doc = doc;
    if (label?.trim()) fav.label = label.trim();
    const key = `${expandDir(fav.dir)}\0${fav.doc ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fav);
  }
  return out;
}

async function readFavorites(file: string): Promise<Favorite[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return sanitize(parsed?.favorites) ?? [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeFavorites(file: string, favorites: Favorite[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ favorites }, null, 2) + '\n');
  await fs.rename(tmp, file);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) reject(new Error('Body too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function favoritesPlugin(): Plugin {
  const file = favoritesFile();
  const expanded = (list: Favorite[]) => list.map((f) => ({ ...f, dir: expandDir(f.dir) }));

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/favorites') return next();
    try {
      if (req.method === 'GET') {
        return sendJson(res, 200, { path: file, favorites: expanded(await readFavorites(file)) });
      }
      if (req.method === 'PUT') {
        const parsed = JSON.parse(await readBody(req));
        const favorites = sanitize(parsed?.favorites);
        if (!favorites) return sendJson(res, 400, { error: 'favorites must be [{ dir, doc?, label? }]' });
        await writeFavorites(file, favorites);
        return sendJson(res, 200, { path: file, favorites: expanded(favorites) });
      }
      return sendJson(res, 405, { error: 'GET or PUT' });
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  };

  return {
    name: 'kp2-favorites',
    configureServer(server) {
      console.log(`  ➜  favs:    ${file}`);
      // Hand edits to the file show up in the browser without a reload.
      server.watcher.add(path.dirname(file));
      server.watcher.on('all', (_event, changed) => {
        if (path.resolve(changed) === file) server.ws.send({ type: 'custom', event: 'favorites:changed' });
      });
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
