import fs from 'node:fs';
import path from 'node:path';

export const contentTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain',
  '.py': 'text/plain',
  '.rs': 'text/plain',
  '.cu': 'text/plain',
  '.h': 'text/plain',
  '.cuh': 'text/plain',
};

export function requestError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Source reading and editor links share the same allowlist and canonical boundary.
export function resolvePublicFile(base, name) {
  if (
    !name ||
    /[\x00-\x1f\x7f]/.test(name) ||
    path.posix.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    /^[a-z]:/i.test(name) ||
    name.split(/[\\/]/).some((part) => part.startsWith('.'))
  )
    throw requestError(403, 'Forbidden');
  const full = path.resolve(base, name);
  const allowed = (file) => {
    const relative = path.relative(base, file);
    return (
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !relative.split(/[\\/]/).some((part) => part.startsWith('.')) &&
      Object.hasOwn(contentTypes, path.extname(file))
    );
  };
  if (!allowed(full)) throw requestError(403, 'Forbidden');
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw requestError(404, 'Not found');
  const real = fs.realpathSync(full);
  if (!allowed(real)) throw requestError(403, 'Forbidden');
  return { file: real, type: contentTypes[path.extname(real)] };
}

export function vscodeFileTarget(file, line = 1) {
  if (!Number.isSafeInteger(line) || line < 1 || line > 1_000_000)
    throw requestError(400, 'Invalid line');
  if (
    (!path.posix.isAbsolute(file) && !path.win32.isAbsolute(file)) ||
    /[\x00-\x1f\x7f]/.test(file)
  )
    throw requestError(400, 'Invalid file');
  const normalized = file.replaceAll('\\', '/');
  const pathname = normalized.startsWith('/') ? normalized : '/' + normalized;
  // Encode each path component; keep the Windows drive colon, and append the
  // location suffix separately so #, %, spaces and Unicode cannot change it.
  const encoded = pathname
    .split('/')
    .map((part, index) => (index === 1 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)))
    .join('/');
  return { url: `vscode://file${encoded}:${line}:1`, location: `${file}:${line}:1` };
}

export function assertEditorRequest(req, port) {
  const host = req.headers.host;
  if (
    ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host) ||
    (req.headers.origin && req.headers.origin !== `http://${host}`) ||
    (req.headers['sec-fetch-site'] &&
      !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
  )
    throw requestError(403, 'Forbidden');
}

export function editorTarget(repo, params) {
  if (
    params.getAll('path').length !== 1 ||
    params.getAll('line').length > 1 ||
    [...params.keys()].some((key) => !['path', 'line'].includes(key))
  )
    throw requestError(400, 'Invalid parameters');
  const raw = params.get('line') ?? '1';
  if (!/^[1-9]\d{0,6}$/.test(raw)) throw requestError(400, 'Invalid line');
  const line = Number(raw);
  if (line > 1_000_000) throw requestError(400, 'Invalid line');
  const { file } = resolvePublicFile(repo, params.get('path'));
  return vscodeFileTarget(file, line);
}
