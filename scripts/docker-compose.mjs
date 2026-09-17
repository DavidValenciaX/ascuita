import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function getComposeInvocation() {
  const modern = spawnSync('docker', ['compose', 'version'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  if (!modern.error && modern.status === 0) {
    return ['docker', ['compose']];
  }

  const legacy = spawnSync('docker-compose', ['version'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  if (!legacy.error && legacy.status === 0) {
    return ['docker-compose', []];
  }

  return null;
}

export function runDockerCompose(args, options = {}) {
  const invocation = getComposeInvocation();
  if (!invocation) {
    return {
      error: new Error(
        'Docker Compose no está disponible como "docker compose" ni como "docker-compose".'
      ),
      status: 1,
    };
  }

  const [command, prefixArgs] = invocation;
  return spawnSync(command, [...prefixArgs, ...args], {
    windowsHide: true,
    ...options,
  });
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const result = runDockerCompose(process.argv.slice(2), { stdio: 'inherit' });

  if (result.error) {
    console.error(`[docker-compose] ${result.error.message}`);
  }

  process.exit(result.status ?? 1);
}
