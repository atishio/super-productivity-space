import { spawn, ChildProcess, execSync } from 'child_process';
import { Worker } from 'worker_threads';
import { log, warn } from 'electron-log/main';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

interface ServiceManifest {
  entryPoint: string;
  port: number;
  mode?: 'worker' | 'process';
  args?: string[];
  env?: Record<string, string>;
}

interface PluginManifest {
  id: string;
  name: string;
  service?: ServiceManifest;
}

interface RunningService {
  name: string;
  mode: 'worker' | 'process';
  worker?: Worker;
  process?: ChildProcess;
}

const runningServices: Map<string, RunningService> = new Map();

const getNodePath = (): string => {
  const candidates = ['/usr/local/bin/node', '/opt/homebrew/bin/node'];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    return execSync('which node', { encoding: 'utf-8' }).trim();
  } catch {
    return 'node';
  }
};

const getPluginScanDirs = (): string[] => {
  const dirs: string[] = [];
  const home = process.env.HOME || '';
  const candidates = [
    join(home, 'Documents', 'productivity-plugins', 'plugins'),
    join(home, '.super-productivity', 'plugins'),
  ];
  for (const d of candidates) {
    if (existsSync(d)) dirs.push(d);
  }
  return dirs;
};

const discoverServices = (): Array<{
  pluginId: string;
  name: string;
  service: ServiceManifest;
  scriptPath: string;
}> => {
  const pluginDirs = getPluginScanDirs();
  const found: Array<{
    pluginId: string;
    name: string;
    service: ServiceManifest;
    scriptPath: string;
  }> = [];

  for (const dir of pluginDirs) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const manifestPath = join(dir, entry.name, 'manifest.json');
      if (!existsSync(manifestPath)) continue;

      try {
        const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (!manifest.service) continue;

        const repoRoot = join(dir, '..');
        const scriptPath = manifest.service.entryPoint.startsWith('/')
          ? manifest.service.entryPoint
          : join(repoRoot, manifest.service.entryPoint);
        if (!existsSync(scriptPath)) {
          warn(
            `[service-launcher] ${manifest.id}: entryPoint not found at ${scriptPath}`,
          );
          continue;
        }

        found.push({
          pluginId: manifest.id,
          name: manifest.name,
          service: manifest.service,
          scriptPath,
        });
      } catch (e) {
        warn(
          `[service-launcher] Failed to read manifest at ${manifestPath}: ${(e as Error).message}`,
        );
      }
    }
  }

  return found;
};

const launchAsWorker = (
  name: string,
  scriptPath: string,
  service: ServiceManifest,
): void => {
  const tag = `[${name}]`;
  log(`${tag} Starting as worker thread from ${scriptPath} on port ${service.port}`);

  const worker = new Worker(scriptPath, {
    argv: service.args || [],
    env: { ...process.env, ...service.env } as NodeJS.Dict<string>,
    stdout: true,
    stderr: true,
  });

  worker.stdout.on('data', (data: Buffer) => {
    log(`${tag} ${data.toString().trim()}`);
  });

  worker.stderr.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) log(`${tag} ${msg}`);
  });

  worker.on('exit', (code) => {
    if (code !== null && code !== 0) {
      warn(`${tag} Worker exited with code ${code}`);
    }
    runningServices.delete(name);
  });

  worker.on('error', (err) => {
    warn(`${tag} Worker error: ${err.message}`);
    runningServices.delete(name);
  });

  runningServices.set(name, { name, mode: 'worker', worker });
};

const launchAsProcess = (
  name: string,
  scriptPath: string,
  service: ServiceManifest,
): void => {
  const tag = `[${name}]`;
  const nodePath = getNodePath();
  log(
    `${tag} Starting as child process from ${scriptPath} on port ${service.port} (node: ${nodePath})`,
  );

  const child = spawn(nodePath, [scriptPath, ...(service.args || [])], {
    env: { ...process.env, ...service.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (data: Buffer) => {
    log(`${tag} ${data.toString().trim()}`);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) log(`${tag} ${msg}`);
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      warn(`${tag} Process exited with code ${code}`);
    }
    runningServices.delete(name);
  });

  child.on('error', (err) => {
    warn(`${tag} Failed to start process: ${err.message}`);
    runningServices.delete(name);
  });

  runningServices.set(name, { name, mode: 'process', process: child });
};

export const initServices = (): void => {
  const services = discoverServices();

  if (services.length === 0) {
    log('[service-launcher] No plugin services found.');
    return;
  }

  for (const { pluginId, name, service, scriptPath } of services) {
    const mode = service.mode || 'worker';
    log(
      `[service-launcher] Discovered service from plugin "${pluginId}" (mode: ${mode})`,
    );

    if (mode === 'worker') {
      launchAsWorker(name, scriptPath, service);
    } else {
      launchAsProcess(name, scriptPath, service);
    }
  }
};

export const stopServices = (): void => {
  for (const [name, svc] of runningServices) {
    log(`[${name}] Stopping (${svc.mode})...`);
    if (svc.mode === 'worker' && svc.worker) {
      svc.worker.terminate();
    } else if (svc.process) {
      svc.process.kill('SIGTERM');
    }
  }
  runningServices.clear();
};
