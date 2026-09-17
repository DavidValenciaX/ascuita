import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runDockerCompose } from './docker-compose.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(here, '..', 'compose.redis.yaml');
const dockerStartTimeoutMs = 60_000;
const required = process.argv.includes('--required');

function isDockerAvailable() {
  const result = spawnSync('docker', ['info'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  return !result.error && result.status === 0;
}

function launchInstalledDockerDesktop() {
  if (process.platform !== 'win32') {
    return false;
  }

  const candidates = [
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        'Programs',
        'DockerDesktop',
        'Docker Desktop.exe'
      ),
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, 'Docker', 'Docker', 'Docker Desktop.exe'),
    process.env.ProgramW6432 &&
      path.join(process.env.ProgramW6432, 'Docker', 'Docker', 'Docker Desktop.exe'),
  ].filter(Boolean);

  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) {
    return false;
  }

  const desktop = spawn(executable, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  desktop.unref();
  return true;
}

function requestDockerDesktopStart() {
  const cliResult = spawnSync('docker', ['desktop', 'start', '--detach'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  if (!cliResult.error && cliResult.status === 0) {
    return true;
  }

  const desktopPluginCandidates = [
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        'Programs',
        'DockerDesktop',
        'resources',
        'cli-plugins',
        'docker-desktop.exe'
      ),
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        'Programs',
        'DockerDesktop',
        'resources',
        'bin',
        'docker-desktop.exe'
      ),
  ].filter(Boolean);

  const desktopPlugin = desktopPluginCandidates.find(candidate =>
    existsSync(candidate)
  );
  if (desktopPlugin) {
    const pluginResult = spawnSync(desktopPlugin, ['start', '--detach'], {
      stdio: 'ignore',
      windowsHide: true,
    });

    if (!pluginResult.error && pluginResult.status === 0) {
      return true;
    }
  }

  return launchInstalledDockerDesktop();
}

async function waitForDocker() {
  const deadline = Date.now() + dockerStartTimeoutMs;

  while (Date.now() < deadline) {
    if (isDockerAvailable()) {
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return isDockerAvailable();
}

async function ensureDockerAvailable() {
  if (isDockerAvailable()) {
    return true;
  }

  if (process.env.ASCUITA_AUTO_START_DOCKER === '0') {
    console.warn(
      '[dev:redis] Docker no está disponible y el auto-inicio está desactivado ' +
        '(ASCUITA_AUTO_START_DOCKER=0).'
    );
    return false;
  }

  console.log(
    '[dev:redis] Docker no está disponible. Intentando iniciar Docker Desktop...'
  );

  if (!requestDockerDesktopStart()) {
    return false;
  }

  console.log('[dev:redis] Esperando a que el daemon de Docker esté listo...');
  return waitForDocker();
}

const dockerAvailable = await ensureDockerAvailable();

if (!dockerAvailable) {
  const message =
    'No se pudo iniciar Docker Desktop automáticamente. Inícialo manualmente ' +
    'y vuelve a ejecutar el comando si necesitas Redis.';

  if (required) {
    console.error(`\n[dev:redis] ${message}\n`);
    process.exit(1);
  }

  console.warn(
    `\n[dev:redis] ${message} La API usará el backend en memoria ` +
      '(rate-limit/leases no persistentes).\n'
  );
  process.exit(0);
}

const result = runDockerCompose(
  ['-f', composeFile, 'up', '-d', '--wait', 'redis'],
  { stdio: 'inherit' }
);

if (result.error || result.status !== 0) {
  if (required) {
    console.error(
      '\n[dev:redis] No se pudo iniciar Redis con Docker ' +
        '(¿Docker Desktop y Docker Compose están disponibles?).\n'
    );
    process.exit(result.status || 1);
  }

  console.warn(
    '\n[dev:redis] No se pudo iniciar Redis con Docker ' +
      '(¿Docker Desktop y Docker Compose están disponibles?). ' +
      'La API usará el backend en memoria (rate-limit/leases no persistentes).\n'
  );
  process.exit(0);
}

console.log('[dev:redis] Redis listo en 127.0.0.1:6379.');
