import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;

// Only these top-level folders are served.
const ALLOWED_DIRS = ['src', 'data'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function resolveRequestPath(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname === '/' || pathname === '/index.html') {
    return path.join(ROOT_DIR, 'src', 'index.html');
  }
  const filePath = path.resolve(ROOT_DIR, '.' + pathname);
  const allowed = ALLOWED_DIRS.some(dir => filePath.startsWith(path.join(ROOT_DIR, dir) + path.sep));
  return allowed ? filePath : null;
}

export function createServer() {
  return http.createServer((req, res) => {
    const filePath = resolveRequestPath(req.url);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 - Not Found</h1>');
      return;
    }

    const contentType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>404 - Not Found</h1>');
        } else {
          res.writeHead(500);
          res.end(`Server Error: ${error.code}`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  createServer().listen(PORT, () => {
    console.log(`Trail 100 Tracker running at http://localhost:${PORT}`);
  });
}
