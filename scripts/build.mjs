import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { ensureSource } from './setup-source.mjs';
import { publicError } from './project.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildProject() {
  ensureSource();
  fs.cpSync(path.join(root, 'src'), path.join(root, 'dist'), { recursive: true });
  await import('./build-source.mjs');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await buildProject();
  } catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
  }
}
