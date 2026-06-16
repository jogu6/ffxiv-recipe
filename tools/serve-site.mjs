import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repositoryRoot, 'site');
const args = new Map(process.argv.slice(2).map((arg, index, all) => [arg, all[index + 1]]));
const port = Number(args.get('--port') || process.env.PORT || 4173);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

function resolveRequestPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0]);
  const normalizedPath = path.normalize(decodedPath).replace(/^([/\\])+/, '');
  const requestedPath = path.join(siteRoot, normalizedPath || 'index.html');
  const resolvedPath = fs.statSync(requestedPath, { throwIfNoEntry: false })?.isDirectory()
    ? path.join(requestedPath, 'index.html')
    : requestedPath;

  if (!resolvedPath.startsWith(siteRoot)) return null;
  return resolvedPath;
}

const server = http.createServer((request, response) => {
  const filePath = resolveRequestPath(request.url || '/');

  if (!filePath || !fs.existsSync(filePath)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const contentType = contentTypes.get(path.extname(filePath)) || 'application/octet-stream';
  response.writeHead(200, { 'content-type': contentType });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${siteRoot} at http://127.0.0.1:${port}`);
});
