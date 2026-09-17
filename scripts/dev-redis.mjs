import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(here, '..', 'compose.redis.yaml');

const result = spawnSync(
  'docker',
  ['compose', '-f', composeFile, 'up', '-d', '--wait', 'redis'],
  { stdio: 'inherit', shell: true }
);

if (result.error || result.status !== 0) {
  console.warn(
    '\n[dev:redis] No se pudo iniciar Redis con Docker ' +
      '(¿Docker Desktop está corriendo?). ' +
      'La API usará el backend en memoria (rate-limit/leases no persistentes).\n'
  );
  process.exit(0);
}

console.log('[dev:redis] Redis listo en 127.0.0.1:6379.');
