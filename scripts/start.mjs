import { buildProject } from './build.mjs';
import { publicError } from './project.mjs';
try {
  await buildProject();
  await import('../server.mjs');
} catch (error) {
  // Avoid printing an absolute local path via a Node stack trace.
  console.error(publicError(error));
  process.exitCode = 1;
}
