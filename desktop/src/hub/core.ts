// @ts-nocheck
/** Hub core migrated from hub.js; util/* is strict TypeScript. */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import https from "https";
import net from "net";
import { createRequire } from "module";
import {
  slugifyName,
  sanitizeContainerName,
  containerNamesForSlug,
  uniqueProjectDir,
  resolveTargetProjectDir,
  newCrawlerId,
} from "./util/names";
import {
  parseCommand,
  shellQuote,
  powershellQuote,
  normalizeCliArgs,
} from "./util/command";
import {
  slugOptionId,
  normalizeStartOptions,
  normalizeOptionValues,
  applyStartOptions,
} from "./util/options";
import { shouldSkipExportEntry } from "./util/export-filter";

const nodeRequire = createRequire(__filename);

function desktopRoot() {
  // Compiled to lib/hub/*.js → desktop package root is ../..
  return path.resolve(__dirname, "..", "..");
}

function tryElectronApp() {
  try {
    return nodeRequire("electron").app;
  } catch {
    return null;
  }
}

function isPackaged() {
  const electronApp = tryElectronApp();
  return !!(electronApp && electronApp.isPackaged);
}

/** Read-only templates shipped with the app / repo */
function getResourcesHub() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, "hub");
  }
  return path.resolve(desktopRoot(), "..");
}

/**
 * Writable hub workspace (.env, .active, compose working copy).
 * Packaged: userData/hub — Dev: repo root.
 */
function getHubRoot() {
  if (isPackaged()) {
    const electronApp = tryElectronApp();
    return path.join(electronApp.getPath("userData"), "hub");
  }
  return path.resolve(desktopRoot(), "..");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest, { overwrite = false } = {}) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest) && !overwrite) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

/** Sync compose/countries from resources; never overwrite .env / endpoints */
function ensureWorkspace() {
  const root = getHubRoot();
  const res = getResourcesHub();
  ensureDir(root);

  copyFile(path.join(res, 'docker-compose.yml'), path.join(root, 'docker-compose.yml'), { overwrite: true });
  copyFile(path.join(res, 'countries.conf'), path.join(root, 'countries.conf'), { overwrite: true });
  copyFile(path.join(res, '.env.example'), path.join(root, '.env.example'), { overwrite: true });

  const envDest = path.join(root, '.env');
  if (!fs.existsSync(envDest)) {
    copyFile(path.join(res, '.env.example'), envDest, { overwrite: true });
  }

  // Re-apply published ports without going through endpointsPath() (avoids recursion)
  let saved = [];
  const epFile = path.join(root, 'endpoints.json');
  if (fs.existsSync(epFile)) {
    try {
      saved = JSON.parse(fs.readFileSync(epFile, 'utf8'));
    } catch {
      saved = [];
    }
  }
  writeOverrideFile(root, normalizeEndpointsSafe(saved));
  return root;
}

function normalizeEndpointsSafe(list) {
  try {
    return normalizeEndpoints(list);
  } catch {
    return [];
  }
}

function countriesPath() {
  ensureWorkspace();
  return path.join(getHubRoot(), "countries.conf");
}

function envPath() {
  ensureWorkspace();
  return path.join(getHubRoot(), ".env");
}

function activePath() {
  ensureWorkspace();
  return path.join(getHubRoot(), ".active");
}

function endpointsPath() {
  ensureWorkspace();
  return path.join(getHubRoot(), 'endpoints.json');
}

function crawlersPath() {
  ensureWorkspace();
  return path.join(getHubRoot(), 'crawlers.json');
}

function settingsPath() {
  ensureWorkspace();
  return path.join(getHubRoot(), 'settings.json');
}

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_CRAWL_MODEL = 'qwen2.5:14b';
const DEFAULT_ANTIBOT_MODEL = 'captchamind:7b';
const DEFAULT_WORKERS = 1;
const MIN_WORKERS = 1;
const MAX_WORKERS = 8;

/** Known agent CLIs for Exitly project cards (OpenCode / Codex / …). */
const CLI_SHELL_PRESETS = [
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'claude', label: 'Claude Code', command: 'claude' },
];

function defaultSettings() {
  return {
    ollama: {
      enabled: true,
      baseUrl: DEFAULT_OLLAMA_URL,
    },
    serper: {
      enabled: true,
      apiKey: '',
    },
    hostWg: {
      name: 'wg0',
    },
  };
}

function normalizeModelName(value, fallback) {
  const name = String(value || '')
    .trim()
    .slice(0, 120);
  return name || fallback;
}

function normalizeWorkers(value, fallback = DEFAULT_WORKERS) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_WORKERS, Math.max(MIN_WORKERS, n));
}

function normalizeOllamaSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  let baseUrl = String(src.baseUrl || DEFAULT_OLLAMA_URL).trim();
  if (!baseUrl) baseUrl = DEFAULT_OLLAMA_URL;
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('invalid');
    }
    baseUrl = u.toString().replace(/\/$/, '');
  } catch {
    baseUrl = DEFAULT_OLLAMA_URL;
  }
  return {
    enabled: src.enabled !== false,
    baseUrl,
  };
}

function normalizeSerperSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled !== false,
    apiKey: String(src.apiKey || '')
      .trim()
      .slice(0, 200),
  };
}

function normalizeHostWgSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  let name = String(src.name || 'wg0')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32);
  if (!name) name = 'wg0';
  // enabled jest tylko per projekt (useHostWg) — tu trzymamy sam conf
  return { name };
}

function hostWgDir() {
  const dir = path.join(getHubRoot(), 'wireguard');
  ensureDir(dir);
  return dir;
}

function hostWgConfPath() {
  return path.join(hostWgDir(), 'host.conf');
}

function hostWgConfigured() {
  const p = hostWgConfPath();
  if (!fs.existsSync(p)) return false;
  try {
    const text = fs.readFileSync(p, 'utf8');
    return /\[Interface\]/i.test(text) && /PrivateKey\s*=/i.test(text);
  } catch {
    return false;
  }
}

function readHostWgConfigText() {
  const p = hostWgConfPath();
  if (!fs.existsSync(p)) return '';
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function getHostWgSettings() {
  const cfg = normalizeHostWgSettings(readSettings().hostWg);
  return {
    ...cfg,
    configured: hostWgConfigured(),
    confPath: hostWgConfPath(),
    configText: readHostWgConfigText(),
  };
}

function setHostWgSettings(input = {}, { onLog } = {}) {
  const current = getHostWgSettings();
  const next = normalizeHostWgSettings({
    name: input.name != null ? input.name : current.name,
  });
  writeSettings({ hostWg: next });

  if (typeof input.configText === 'string') {
    const text = input.configText.trim();
    if (text) {
      if (!/\[Interface\]/i.test(text) || !/PrivateKey\s*=/i.test(text)) {
        throw new Error(
          'Config WireGuard wygląda niepoprawnie (brak [Interface] / PrivateKey)'
        );
      }
      fs.writeFileSync(hostWgConfPath(), `${text.replace(/\s*$/, '')}\n`, {
        mode: 0o600,
      });
      if (onLog) onLog(`Zapisano host WG → ${hostWgConfPath()}`);
    }
  }

  return getHostWgSettings();
}

/** Sync FurniLead/host WG env into project .env based on per-project toggle. */
function applyHostWgToProjectEnv(projectDir, useHostWg, { runMode } = {}) {
  const hg = getHostWgSettings();
  const updates = {};
  if (useHostWg && hg.configured) {
    // CRM zawsze przez Docker crm-lan (CLI i Docker) — bez host WG
    updates.EXITLY_DOCKER_CRM = '1';
    updates.EXITLY_HOST_WG = '0';
    updates.FURNILEAD_WG_AUTO = '0';
    updates.FURNILEAD_WG_NAME = hg.name || 'wg0';
    updates.FURNILEAD_WG_CONF = hg.confPath;
    updates.FURNILEAD_WG_STICKY = '0';
    updates.FURNILEAD_WG_SESSION_HOLD = '0';
  } else {
    updates.EXITLY_HOST_WG = '0';
    updates.EXITLY_DOCKER_CRM = '0';
    updates.FURNILEAD_WG_AUTO = '0';
  }
  upsertDotEnvFile(path.join(projectDir, '.env'), updates);
  return updates;
}

async function hostWgInterfaceUp(name) {
  const iface = String(name || 'wg0').trim();
  if (!iface) return false;
  try {
    const out = await run('wg', ['show', 'interfaces'], { cwd: getHubRoot() });
    return out
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .includes(iface);
  } catch {
    try {
      await run('wg', ['show', iface], { cwd: getHubRoot() });
      return true;
    } catch {
      return false;
    }
  }
}

async function scutilVpnConnected(name) {
  try {
    const out = await run('scutil', ['--nc', 'status', name], { cwd: getHubRoot() });
    return /Connected/i.test(out);
  } catch {
    return false;
  }
}

async function hostWgIsUp(name) {
  return (await scutilVpnConnected(name)) || (await hostWgInterfaceUp(name));
}

function hostWgRuntimeConfPath(name) {
  const runtimeDir = path.join(hostWgDir(), 'runtime');
  ensureDir(runtimeDir);
  return path.join(runtimeDir, `${String(name || 'wg0').trim() || 'wg0'}.conf`);
}

function prepareHostWgRuntimeConf(name) {
  const hg = getHostWgSettings();
  const runtimeConf = hostWgRuntimeConfPath(name);
  fs.copyFileSync(hg.confPath, runtimeConf);
  try {
    fs.chmodSync(runtimeConf, 0o600);
  } catch {
    /* ignore */
  }
  return runtimeConf;
}

let _hostWgAdminTried = false;

async function wgQuickUpPrivileged(runtimeConf, { onLog } = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('Podniesienie WG z hasłem tylko na macOS');
  }
  const wgQuick =
    ['/opt/homebrew/bin/wg-quick', '/usr/local/bin/wg-quick'].find((p) =>
      fs.existsSync(p),
    ) || 'wg-quick';
  const shellCmd = `${JSON.stringify(wgQuick)} up ${JSON.stringify(runtimeConf)}`;
  if (onLog) onLog('Host WG: prośba o hasło administratora (Exitly podnosi tunel)…');
  await run(
    'osascript',
    ['-e', `do shell script ${JSON.stringify(shellCmd)} with administrator privileges`],
    { onLog },
  );
}

/**
 * Podnieś host WG z poziomu Exitly (LAN → CRM). Crawl Proton = Gluetun.
 * Nie wymaga ręcznego klikania w WireGuard.app — apka woła scutil / wg-quick.
 */
async function ensureHostWgUp({ onLog, allowAdminPrompt = true } = {}) {
  const hg = getHostWgSettings();
  if (!hg.configured) {
    throw new Error('Brak configu WireGuard host — Ustawienia → wklej conf i Zapisz');
  }
  const name = String(hg.name || 'wg0').trim() || 'wg0';
  if (await hostWgIsUp(name)) {
    if (onLog) onLog(`Host WG ${name}: aktywny (Exitly)`);
    return { ok: true, name, already: true };
  }

  let lastErr = '';

  // 1) Network Extension / WireGuard.app (bez hasła, jeśli tunel już zaimportowany)
  try {
    if (onLog) onLog(`Host WG ${name}: start (Exitly / scutil)…`);
    await run('scutil', ['--nc', 'start', name], { onLog });
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      if (await hostWgIsUp(name)) {
        if (onLog) onLog(`Host WG ${name}: UP — Exitly`);
        return { ok: true, name, via: 'scutil' };
      }
    }
  } catch (err) {
    lastErr = err.message || String(err);
    if (onLog) onLog(`scutil: ${lastErr}`);
  }

  const runtimeConf = prepareHostWgRuntimeConf(name);

  // 2) wg-quick bez sudo
  try {
    if (onLog) onLog(`Host WG ${name}: wg-quick up…`);
    await run('wg-quick', ['up', runtimeConf], { onLog, cwd: path.dirname(runtimeConf) });
    if (await hostWgIsUp(name)) {
      if (onLog) onLog(`Host WG ${name}: UP (wg-quick)`);
      return { ok: true, name, via: 'wg-quick' };
    }
  } catch (err) {
    lastErr = err.message || String(err);
    if (onLog) onLog(`wg-quick: ${lastErr}`);
  }

  // 3) Jednorazowo: hasło admina z poziomu Exitly (bez ręcznego Terminala)
  if (allowAdminPrompt && !_hostWgAdminTried && process.platform === 'darwin') {
    _hostWgAdminTried = true;
    try {
      await wgQuickUpPrivileged(runtimeConf, { onLog });
      for (let i = 0; i < 8; i += 1) {
        await new Promise((r) => setTimeout(r, 400));
        if (await hostWgIsUp(name)) {
          if (onLog) onLog(`Host WG ${name}: UP (Exitly + hasło)`);
          return { ok: true, name, via: 'wg-quick-admin' };
        }
      }
    } catch (err) {
      lastErr = err.message || String(err);
      if (onLog) onLog(`wg-quick (admin): ${lastErr}`);
    }
  }

  throw new Error(
    `Exitly nie podniosło tunelu CRM („${name}”). Zapisz conf w Ustawieniach ` +
      `i raz zaimportuj go do WireGuard.app jako „${name}” (potem Exitly startuje samo).` +
      `${lastErr ? ` (${lastErr})` : ''}`,
  );
}

function anyProjectNeedsHostWg() {
  // Host WG wyłączony — CRM zawsze przez Docker crm-lan
  return false;
}

/**
 * Exitly trzyma tunel CRM, gdy którykolwiek projekt ma „CRM (Exitly)”.
 */
async function syncAppHostWg({ onLog, allowAdminPrompt = true } = {}) {
  if (!anyProjectNeedsHostWg()) {
    return { ok: true, skipped: true, reason: 'no_host_wg_projects' };
  }
  const hg = getHostWgSettings();
  if (!hg.configured) {
    return {
      ok: false,
      error: 'Brak configu host WG w Ustawieniach Exitly',
    };
  }
  try {
    const up = await ensureHostWgUp({ onLog, allowAdminPrompt });
    return { ok: true, ...up, managed: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err), managed: true };
  }
}

let _hostWgWatchdog = null;

function startHostWgWatchdog({ onLog, intervalMs = 45000 } = {}) {
  if (_hostWgWatchdog) return;
  const tick = async () => {
    if (!anyProjectNeedsHostWg()) return;
    try {
      const hg = getHostWgSettings();
      if (!hg.configured) return;
      if (await hostWgIsUp(hg.name || 'wg0')) return;
      if (onLog) onLog('Host WG: padł — Exitly podnosi ponownie…');
      await ensureHostWgUp({ onLog, allowAdminPrompt: false });
    } catch (err) {
      if (onLog) onLog(`Host WG watchdog: ${err.message || err}`);
    }
  };
  // nie blokuj startu UI
  setTimeout(() => {
    tick().catch(() => {});
  }, 1500);
  _hostWgWatchdog = setInterval(() => {
    tick().catch(() => {});
  }, Math.max(15000, Number(intervalMs) || 45000));
  if (_hostWgWatchdog.unref) _hostWgWatchdog.unref();
}

function stopHostWgWatchdog() {
  if (!_hostWgWatchdog) return;
  clearInterval(_hostWgWatchdog);
  _hostWgWatchdog = null;
}

function parseMcpEndpoint(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const host = u.hostname;
    if (!host) return null;
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    return { url: raw, host, port };
  } catch {
    return null;
  }
}

function probeTcpHostPort(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) }, () => {
      socket.end();
      resolve({ ok: true });
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    socket.on('error', (err) => {
      resolve({ ok: false, error: err.message || String(err) });
    });
  });
}

function httpJsonRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch (err) {
      resolve({ ok: false, error: err.message || 'bad url' });
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body == null ? null : Buffer.from(String(body), 'utf8');
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers: {
          ...headers,
          ...(payload ? { 'Content-Length': String(payload.length) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* ignore */
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: text.slice(0, 400),
            json,
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message || String(err) });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** HTTP + (opcjonalnie) Bearer ping zdalnego MCP — TCP bywa zawodny przez utun. */
async function probeProjectMcp(projectDir, { onLog, timeoutMs = 6000 } = {}) {
  const env = parseDotEnvFile(path.join(projectDir, '.env'));
  const ep = parseMcpEndpoint(env.FURNILEAD_MCP_URL);
  if (!ep) {
    return { ok: false, skipped: true, error: 'Brak FURNILEAD_MCP_URL w .env projektu' };
  }
  const token = String(env.FURNILEAD_MCP_TOKEN || '').trim();
  if (onLog) onLog(`Zdalny MCP ${ep.host}:${ep.port}…`);

  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // 1) lekki GET /api/mcp → {"status":"ok"}
    const get = await httpJsonRequest(ep.url, { method: 'GET', timeoutMs });
    if (!get.ok) {
      lastErr = get.error || `HTTP ${get.status || '?'}`;
      // fallback TCP tylko gdy HTTP padł
      const tcp = await probeTcpHostPort(ep.host, ep.port, Math.min(4000, timeoutMs));
      if (!tcp.ok) lastErr = tcp.error || lastErr;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      break;
    }

    if (!token) {
      if (onLog) onLog(`Zdalny MCP OK (HTTP): ${ep.host}:${ep.port}`);
      return { ok: true, host: ep.host, port: ep.port, url: ep.url, mode: 'http' };
    }

    // 2) autentyczny ping jak doctor FurniLead
    const post = await httpJsonRequest(ep.url, {
      method: 'POST',
      timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ tool: 'ping', arguments: {} }),
    });
    if (post.ok && (post.json?.result?.ok === true || post.json?.ok === true || !post.json?.error)) {
      if (onLog) onLog(`Zdalny MCP OK (ping): ${ep.host}:${ep.port}`);
      return {
        ok: true,
        host: ep.host,
        port: ep.port,
        url: ep.url,
        mode: 'ping',
      };
    }
    if (post.status === 401 || post.status === 403) {
      return {
        ok: false,
        host: ep.host,
        port: ep.port,
        url: ep.url,
        error:
          `MCP ${ep.host}:${ep.port} — unauthorized (zły FURNILEAD_MCP_TOKEN vs CRM)`,
      };
    }
    lastErr = post.error || `HTTP ${post.status || '?'} ${String(post.text || '').slice(0, 120)}`;
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      continue;
    }
  }

  return {
    ok: false,
    host: ep.host,
    port: ep.port,
    url: ep.url,
    error: `Zdalny MCP ${ep.host}:${ep.port} — ${lastErr || 'brak odpowiedzi'}`,
  };
}

/**
 * CRM LAN tylko w Dockerze (crm-lan + socat → localhost).
 * Exitly NIE łączy się z Orb / SSH.
 */
async function ensureProjectCrmAccess(crawler, { onLog, requireMcp = true } = {}) {
  if (!crawler.useHostWg) {
    return { ok: true, skipped: true, reason: 'host_wg_off' };
  }
  const hg = getHostWgSettings();
  if (!hg.configured) {
    throw new Error('Brak configu CRM LAN w Ustawieniach Exitly — wklej conf i Zapisz');
  }

  if (crawler.runMode === 'docker') {
    applyHostWgToProjectEnv(crawler.path, true, { runMode: 'docker' });
    if (onLog) onLog('CRM LAN: Docker crm-lan · crawl → Proton VPN');
    return { ok: true, skipped: true, reason: 'docker_crm_lan' };
  }

  applyHostWgToProjectEnv(crawler.path, true, { runMode: 'cli' });
  const stack = await ensureCliVpnTunnel(crawler, {
    country: crawler.country,
    recreate: false,
    waitReady: false,
    onLog,
  });
  if (stack.dockerCrm && stack.mcpPort) {
    const remote = stack.crmRemote || resolveCliCrmRemote(crawler);
    const localUrl = `http://127.0.0.1:${stack.mcpPort}${remote.pathname || '/api/mcp'}`;
    upsertDotEnvFile(path.join(crawler.path, '.env'), {
      EXITLY_DOCKER_CRM: '1',
      EXITLY_ORB_CRM: '0',
      EXITLY_HOST_WG: '0',
      FURNILEAD_WG_AUTO: '0',
      FURNILEAD_ORB_HOST: '',
      EXITLY_MCP_REMOTE:
        remote.url || `http://${remote.host}:${remote.port}${remote.pathname || '/api/mcp'}`,
      FURNILEAD_MCP_URL: localUrl,
    });
    if (onLog) {
      onLog(
        `CRM LAN Docker: ${stack.crmContainerName} · MCP ${localUrl} → ${remote.host}:${remote.port}`,
      );
    }
    let mcp = { ok: false };
    for (let i = 0; i < 20; i += 1) {
      if (stack.crmContainerName && !(await containerRunning(stack.crmContainerName))) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      mcp = await probeProjectMcp(crawler.path, {
        onLog: i === 0 || i === 19 ? onLog : null,
      });
      if (mcp.ok) break;
      // Jednorazowy recreate gdy forward stoi, ale health pada
      if (i === 8) {
        if (onLog) onLog('CRM MCP nie wstaje — recreate stacka Docker…');
        await ensureCliVpnTunnel(crawler, {
          country: crawler.country,
          recreate: true,
          waitReady: true,
          onLog,
        });
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (requireMcp && !mcp.ok && !mcp.skipped) {
      throw new Error(
        `${mcp.error || 'MCP timeout'}. Docker crm-lan nie doszedł do CRM ` +
          `(${remote.host}:${remote.port}) — sprawdź conf LAN i VM.`,
      );
    }
    return { ok: !!mcp.ok || !!mcp.skipped, mcp, dockerCrm: true };
  }
  if (requireMcp) {
    throw new Error('CRM offline — Docker crm-lan niedostępne');
  }
  return { ok: true, skipped: true, reason: 'no_mcp_port' };
}

function readSettings() {
  const file = settingsPath();
  const defaults = defaultSettings();
  if (!fs.existsSync(file)) return defaults;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ollama: normalizeOllamaSettings(raw && raw.ollama),
      serper: normalizeSerperSettings(raw && raw.serper),
      hostWg: normalizeHostWgSettings(raw && raw.hostWg),
    };
  } catch {
    return defaults;
  }
}

function writeSettings(next) {
  const current = readSettings();
  const merged = {
    ollama: normalizeOllamaSettings(
      next && next.ollama != null ? next.ollama : current.ollama
    ),
    serper: normalizeSerperSettings(
      next && next.serper != null ? next.serper : current.serper
    ),
    hostWg: normalizeHostWgSettings(
      next && next.hostWg != null ? next.hostWg : current.hostWg
    ),
  };
  fs.writeFileSync(settingsPath(), `${JSON.stringify(merged, null, 2)}\n`, {
    mode: 0o600,
  });
  return merged;
}

function getOllamaSettings() {
  return readSettings().ollama;
}

function setOllamaSettings(input) {
  const settings = writeSettings({
    ollama: normalizeOllamaSettings(input || {}),
  });
  return settings.ollama;
}

function getSerperSettings() {
  return readSettings().serper;
}

function setSerperSettings(input) {
  const settings = writeSettings({
    serper: normalizeSerperSettings(input || {}),
  });
  return settings.serper;
}

function maskSecret(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

async function checkSerper(apiKey) {
  const key = String(apiKey || getSerperSettings().apiKey || '').trim();
  if (!key) {
    return { ok: false, error: 'brak klucza API', masked: '' };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: 'exitly ping', num: 1 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `HTTP ${res.status}${text ? `: ${text.slice(0, 80)}` : ''}`,
        masked: maskSecret(key),
      };
    }
    return { ok: true, error: '', masked: maskSecret(key) };
  } catch (err) {
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'timeout' : err.message || String(err),
      masked: maskSecret(key),
    };
  }
}

/** Host URL from settings → URL reachable inside Gluetun/app network */
function ollamaUrlForContainer(baseUrl) {
  try {
    const u = new URL(String(baseUrl || DEFAULT_OLLAMA_URL));
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      u.hostname = 'host.docker.internal';
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return 'http://host.docker.internal:11434';
  }
}

async function checkOllama(baseUrl) {
  const url = normalizeOllamaSettings({ baseUrl }).baseUrl;
  const target = `${url}/api/tags`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(target, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        ok: false,
        baseUrl: url,
        error: `HTTP ${res.status}`,
        models: [],
      };
    }
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models.map((m) => m.name || m.model).filter(Boolean) : [];
    return { ok: true, baseUrl: url, models, error: '' };
  } catch (err) {
    return {
      ok: false,
      baseUrl: url,
      models: [],
      error: err.name === 'AbortError' ? 'timeout' : err.message || String(err),
    };
  }
}

const CRAWLER_EXITS = [
  { id: 'proton-vpn', label: 'Shared hub (proton-vpn)' },
  { id: 'vpn-ro', label: 'Parallel RO (vpn-ro)' },
  { id: 'vpn-hu', label: 'Parallel HU (vpn-hu)' },
  { id: 'vpn-bg', label: 'Parallel BG (vpn-bg)' },
];

/** Map legacy shared-exit ids → country code for per-project tunnels */
function resolveProjectCountry(value, fallback = 'ro') {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (!v || v === 'proton-vpn') {
    try {
      return resolveCountry(fallback || readActive()).code;
    } catch {
      return 'ro';
    }
  }
  const m = v.match(/^vpn-([a-z]{2})$/);
  if (m) return resolveCountry(m[1]).code;
  return resolveCountry(v).code;
}

function normalizeCrawler(item) {
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid crawler');
  }
  const name = String(item.name || '')
    .trim()
    .slice(0, 60);
  if (!name) throw new Error('Name is required');

  const id = String(item.id || newCrawlerId()).replace(/[^a-zA-Z0-9_-]/g, '') || newCrawlerId();

  const projectPath = item.path ? path.resolve(String(item.path)) : '';
  const kind = item.kind === 'project' || projectPath ? 'project' : 'image';

  if (kind === 'project') {
    if (!projectPath) throw new Error('Project path is required');
    const country = resolveProjectCountry(item.country || item.exit, item.country || 'ro');
    const slug = slugifyName(name);
    const vpnContainerName = String(item.vpnContainerName || '').trim() || `exitly-vpn-${slug}-${id.slice(-4)}`;
    const containerName = String(item.containerName || '').trim() || `exitly-proj-${slug}-${id.slice(-4)}`;
    const runMode = item.runMode === 'cli' ? 'cli' : 'docker';
    const cliCommand = String(item.cliCommand || '')
      .trim()
      .slice(0, 300);
    const cliArgs = normalizeCliArgs(item.cliArgs);
    const cliTerminal = item.cliTerminal !== false;
    const options = normalizeStartOptions(item.options);
    const optionValues = normalizeOptionValues(item.optionValues, options);
    const useHostWg = item.useHostWg === true;
    return {
      id,
      kind: 'project',
      name,
      path: projectPath,
      service: String(item.service || 'app').trim() || 'app',
      country,
      runMode,
      cliCommand,
      cliArgs,
      cliTerminal,
      options,
      optionValues,
      useHostWg,
      // dedicated tunnel container (not shared proton-vpn)
      vpnContainerName,
      exit: vpnContainerName,
      containerName,
      image: '',
      command: '',
      crawlModel: normalizeModelName(item.crawlModel, DEFAULT_CRAWL_MODEL),
      antibotModel: normalizeModelName(item.antibotModel, DEFAULT_ANTIBOT_MODEL),
      workers: normalizeWorkers(item.workers, DEFAULT_WORKERS),
    };
  }

  const image = String(item.image || '')
    .trim()
    .slice(0, 200);
  if (!image) throw new Error('Docker image is required');
  const command = String(item.command || '')
    .trim()
    .slice(0, 500);
  const exitIds = new Set(CRAWLER_EXITS.map((e) => e.id));
  const exit = exitIds.has(item.exit) ? item.exit : 'proton-vpn';
  return {
    id,
    kind: 'image',
    name,
    image,
    command,
    exit,
    country: '',
    vpnContainerName: '',
    path: '',
    service: '',
    containerName: sanitizeContainerName(id),
  };
}

function readCrawlers() {
  const file = crawlersPath();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        try {
          return normalizeCrawler(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeCrawlers(list) {
  const normalized = (Array.isArray(list) ? list : []).map((item) => normalizeCrawler(item));
  fs.writeFileSync(crawlersPath(), `${JSON.stringify(normalized, null, 2)}\n`, {
    mode: 0o600,
  });
  return normalized;
}

function findCrawler(id) {
  const hit = readCrawlers().find((c) => c.id === id);
  if (!hit) throw new Error(`Crawler not found: ${id}`);
  return hit;
}

async function containerState(name) {
  try {
    const out = await run('docker', ['inspect', '-f', '{{.State.Status}}|{{.State.Running}}', name], {
      cwd: getHubRoot(),
    });
    const [status, running] = out.trim().split('|');
    return {
      exists: true,
      running: running === 'true',
      status: status || 'unknown',
    };
  } catch {
    return { exists: false, running: false, status: 'missing' };
  }
}

async function listCrawlersWithStatus() {
  const list = readCrawlers();
  const out = [];
  for (const c of list) {
    let running = false;
    let appState = { exists: false, running: false, status: 'missing' };
    let vpnState = { exists: false, running: false, status: 'n/a' };

    if (c.kind === 'project' && c.runMode === 'cli') {
      running = isCliSessionRunning(c.id);
      appState = {
        exists: running,
        running,
        status: running ? 'running' : 'stopped',
      };
    } else {
      appState = await containerState(c.containerName);
      vpnState =
        c.kind === 'project' && c.vpnContainerName
          ? await containerState(c.vpnContainerName)
          : { exists: false, running: false, status: 'n/a' };
      running = !!(appState.running || vpnState.running);
    }

    const countryName =
      c.kind === 'project' ? readCountries().find((x) => x.code === c.country)?.name || c.country : '';
    let envReady = true;
    let envMissing = [];
    let envFieldCount = 0;
    let envFields = [];
    let options = normalizeStartOptions(c.options);
    let optionValues = normalizeOptionValues(c.optionValues, options);
    let crawlModel = c.crawlModel;
    let antibotModel = c.antibotModel;
    if (c.kind === 'project' && fs.existsSync(c.path)) {
      try {
        const values = parseDotEnvFile(path.join(c.path, '.env'));
        if (c.runMode === 'cli') {
          const fromEnvCrawl =
            String(values.OLLAMA_MODEL || values.OLLAMA_CRAWL_MODEL || '').trim();
          const fromEnvAntibot = String(
            values.FURNILEAD_CRAWL_CAPTCHAMIND_MODEL ||
              values.OLLAMA_ANTIBOT_MODEL ||
              '',
          ).trim();
          if (fromEnvCrawl) crawlModel = fromEnvCrawl;
          if (fromEnvAntibot) antibotModel = fromEnvAntibot;
        }
        const fields = resolveProjectEnvFields(c.path, c);
        envFieldCount = fields.length;
        if (fields.length) {
          envFields = fields.map((f) => ({
            ...f,
            value: values[f.key] ?? '',
            filled: String(values[f.key] || '').trim().length > 0,
            missing: !!f.required && !String(values[f.key] || '').trim().length,
          }));
          envMissing = envFields.filter((f) => f.missing).map((f) => f.key);
          envReady = envMissing.length === 0;
        }
        options = resolveProjectStartOptions(c.path, c);
        optionValues = resolveProjectOptionValues(c.path, c);
      } catch {
        /* ignore */
      }
    }
    out.push({
      ...c,
      crawlModel,
      antibotModel,
      options,
      optionValues,
      running,
      status: running ? 'running' : appState.exists || vpnState.exists ? appState.status || vpnState.status : 'stopped',
      vpnRunning: !!vpnState.running,
      countryName,
      exitLabel:
        c.kind === 'project'
          ? c.runMode === 'cli'
            ? `CLI · ${String(c.country || '').toUpperCase()}`
            : `${String(c.country || '').toUpperCase()} tunnel`
          : CRAWLER_EXITS.find((e) => e.id === c.exit)?.label || c.exit,
      missing: c.kind === 'project' ? !fs.existsSync(c.path) : false,
      envReady,
      envMissing,
      envFieldCount,
      envFields,
    });
  }
  return out;
}

async function addCrawler(input) {
  const list = readCrawlers();
  const crawler = normalizeCrawler({
    ...input,
    id: input && input.id ? input.id : newCrawlerId(),
  });
  if (list.some((c) => c.name.toLowerCase() === crawler.name.toLowerCase())) {
    throw new Error(`"${crawler.name}" already exists`);
  }
  if (crawler.kind === 'project' && list.some((c) => c.kind === 'project' && c.path === crawler.path)) {
    throw new Error(`Projekt już na liście: ${crawler.path}`);
  }
  list.push(crawler);
  writeCrawlers(list);
  return crawler;
}

async function removeCrawler(id, { onLog } = {}) {
  const list = readCrawlers();
  const crawler = list.find((c) => c.id === id);
  if (!crawler) throw new Error(`Not found: ${id}`);
  try {
    if (crawler.kind === 'project' && crawler.runMode === 'cli') {
      await stopCliSession(id, { onLog });
      await stopCliVpnTunnel(crawler, { onLog });
    } else if (crawler.kind === 'project' && crawler.path) {
      await projectCompose(crawler, ['down', '--remove-orphans'], { onLog });
    } else {
      await run('docker', ['rm', '-f', crawler.containerName], { onLog });
    }
  } catch {
    /* ignore */
  }
  if (crawler.runMode !== 'cli' && crawler.vpnContainerName) {
    try {
      await run('docker', ['rm', '-f', crawler.vpnContainerName], { onLog });
    } catch {
      /* ignore */
    }
  }
  cliLogBuffers.delete(id);
  writeCrawlers(list.filter((c) => c.id !== id));
  return true;
}

function projectComposeFile(crawler) {
  return path.join(crawler.path, 'docker-compose.yml');
}

async function projectCompose(crawler, args, opts = {}) {
  const file = projectComposeFile(crawler);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing docker-compose.yml in ${crawler.path}`);
  }
  return run('docker', ['compose', '-f', file, '--project-directory', crawler.path, ...args], opts);
}

function readHubWireguardKey() {
  const p = envPath();
  if (!fs.existsSync(p)) return '';
  const m = fs.readFileSync(p, 'utf8').match(/^WIREGUARD_PRIVATE_KEY=(.*)$/m);
  return m ? m[1].trim() : '';
}

function syncProjectEnv(projectDir, { country, crawlModel, antibotModel, workers } = {}) {
  const key = readHubWireguardKey();
  if (!key || /PASTE_PRIVATE_KEY_HERE/.test(key)) {
    throw new Error('WireGuard key missing — complete Exitly setup first');
  }
  const { code, name } = resolveCountry(country || 'ro');
  const ollama = getOllamaSettings();
  const serper = getSerperSettings();
  const crawl = normalizeModelName(crawlModel, DEFAULT_CRAWL_MODEL);
  const antibot = normalizeModelName(antibotModel, DEFAULT_ANTIBOT_MODEL);
  const workerCount = normalizeWorkers(workers, DEFAULT_WORKERS);
  const updates = {
    VPN_SERVICE_PROVIDER: 'protonvpn',
    VPN_TYPE: 'wireguard',
    WIREGUARD_PRIVATE_KEY: key,
    ACTIVE_COUNTRY: code,
    SERVER_COUNTRIES: name,
    CRAWL_WORKERS: String(workerCount),
  };
  if (ollama.enabled) {
    const containerUrl = ollamaUrlForContainer(ollama.baseUrl);
    updates.OLLAMA_BASE_URL = containerUrl;
    updates.OLLAMA_HOST = containerUrl;
    updates.OLLAMA_MODEL = crawl;
    updates.OLLAMA_CRAWL_MODEL = crawl;
    updates.OLLAMA_ANTIBOT_MODEL = antibot;
  } else {
    updates.OLLAMA_BASE_URL = '';
    updates.OLLAMA_HOST = '';
    updates.OLLAMA_MODEL = '';
    updates.OLLAMA_CRAWL_MODEL = '';
    updates.OLLAMA_ANTIBOT_MODEL = '';
  }
  if (serper.enabled && serper.apiKey) {
    updates.SERPER_API_KEY = serper.apiKey;
  } else {
    updates.SERPER_API_KEY = '';
  }
  const envFile = path.join(projectDir, '.env');
  if (!fs.existsSync(envFile)) {
    fs.writeFileSync(envFile, '# Synced from Exitly hub — do not commit.\n', { mode: 0o600 });
  }
  upsertDotEnvFile(envFile, updates);
  return {
    code,
    name,
    ollama,
    serper,
    crawlModel: crawl,
    antibotModel: antibot,
    workers: workerCount,
  };
}

/** Keep compose `environment.CRAWL_WORKERS` in sync when present (else .env wins). */
function writeProjectWorkersCompose(composePath, workers) {
  if (!fs.existsSync(composePath)) return false;
  let body = fs.readFileSync(composePath, 'utf8');
  const n = normalizeWorkers(workers, DEFAULT_WORKERS);
  if (/CRAWL_WORKERS:\s*.+$/m.test(body)) {
    body = body.replace(/CRAWL_WORKERS:\s*.+$/m, `CRAWL_WORKERS: "${n}"`);
    fs.writeFileSync(composePath, body);
    return true;
  }
  return false;
}

function writeProjectServerCountry(composePath, countryName) {
  let body = fs.readFileSync(composePath, 'utf8');
  if (/SERVER_COUNTRIES:\s*.+$/m.test(body)) {
    body = body.replace(/SERVER_COUNTRIES:\s*.+$/m, `SERVER_COUNTRIES: ${countryName}`);
  } else {
    throw new Error('docker-compose.yml missing SERVER_COUNTRIES');
  }
  fs.writeFileSync(composePath, body);
}

function writeProjectMeta(projectDir, meta) {
  fs.writeFileSync(path.join(projectDir, 'exitly.project.json'), `${JSON.stringify(meta, null, 2)}\n`);
}

function readProjectMeta(projectDir) {
  const file = path.join(projectDir, 'exitly.project.json');
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

/** Keys managed in Exitly Settings — never show in project Env UI. */
const GLOBAL_ENV_KEYS = new Set([
  'SERPER_API_KEY',
  'OLLAMA_BASE_URL',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'OLLAMA_CRAWL_MODEL',
  'OLLAMA_ANTIBOT_MODEL',
  'CRAWL_WORKERS',
  'WIREGUARD_PRIVATE_KEY',
  'VPN_SERVICE_PROVIDER',
  'VPN_TYPE',
  'ACTIVE_COUNTRY',
  'SERVER_COUNTRIES',
  'HTTPPROXY',
]);

/** Env fields editable in Exitly UI (per stack) — only project-specific. */
const ENV_PRESETS = {
  // Docker crawl: modele na karcie, Serper/Ollama w Ustawieniach
  crawl4ai: [],
  'opencode+mcp': [
    {
      key: 'FURNILEAD_MCP_URL',
      label: 'CRM MCP URL',
      secret: false,
      required: true,
      placeholder: 'http://127.0.0.1:3000/api/mcp',
    },
    {
      key: 'FURNILEAD_MCP_TOKEN',
      label: 'CRM MCP token',
      secret: true,
      required: true,
      placeholder: 'silny sekret (jak w CRM)',
    },
    {
      key: 'CF_ACCOUNT_ID',
      label: 'Cloudflare Account ID',
      secret: false,
      required: false,
    },
    {
      key: 'CF_API_TOKEN',
      label: 'Cloudflare API token',
      secret: true,
      required: false,
    },
  ],
  cli: [],
};

function normalizeEnvFields(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const key = String(item.key || '')
        .trim()
        .replace(/[^A-Za-z0-9_]/g, '');
      if (!key || GLOBAL_ENV_KEYS.has(key)) return null;
      return {
        key,
        label: String(item.label || key)
          .trim()
          .slice(0, 80),
        secret: !!item.secret,
        required: !!item.required,
        placeholder: String(item.placeholder || item.default || '').slice(0, 200),
      };
    })
    .filter(Boolean)
    .slice(0, 40);
}

function resolveProjectEnvFields(projectDir, crawler = null) {
  const meta = readProjectMeta(projectDir) || {};
  if (Array.isArray(meta.envFields) && meta.envFields.length) {
    return normalizeEnvFields(meta.envFields);
  }
  const stack = String(meta.stack || crawler?.stack || '').trim();
  if (stack && ENV_PRESETS[stack]) return normalizeEnvFields(ENV_PRESETS[stack]);
  if ((crawler && crawler.runMode === 'cli') || meta.runMode === 'cli') {
    if (stack.includes('opencode') || meta.cli) {
      return normalizeEnvFields(ENV_PRESETS['opencode+mcp']);
    }
    return normalizeEnvFields(ENV_PRESETS.cli);
  }
  if (
    meta.tunnel === 'dedicated' ||
    meta.stack === 'crawl4ai' ||
    (crawler && crawler.runMode !== 'cli') ||
    fs.existsSync(path.join(projectDir, 'docker-compose.yml'))
  ) {
    return normalizeEnvFields(ENV_PRESETS.crawl4ai);
  }
  return [];
}

/** Merge hub Serper/Ollama into project .env without wiping other keys (CLI). */
function syncHubGlobalsIntoProjectEnv(projectDir, { hostOllama = true } = {}) {
  const ollama = getOllamaSettings();
  const serper = getSerperSettings();
  const envPath = path.join(projectDir, '.env');
  const existing = parseDotEnvFile(envPath);
  const updates = {};
  if (serper.enabled && serper.apiKey) {
    updates.SERPER_API_KEY = serper.apiKey;
  }
  if (ollama.enabled && ollama.baseUrl) {
    const url = hostOllama ? String(ollama.baseUrl).replace(/\/$/, '') : ollamaUrlForContainer(ollama.baseUrl);
    updates.OLLAMA_BASE_URL = url;
    updates.OLLAMA_HOST = url;
    if (!String(existing.OLLAMA_MODEL || '').trim()) {
      updates.OLLAMA_MODEL = DEFAULT_CRAWL_MODEL;
    }
  }
  if (Object.keys(updates).length) {
    upsertDotEnvFile(envPath, updates);
  }
  return updates;
}

/** CLI projects: push Exitly country into .env without rewriting secrets. */
function syncCliCountryIntoProjectEnv(projectDir, country, extra = {}) {
  const { code, name } = resolveCountry(country || 'ro');
  const updates = {
    ACTIVE_COUNTRY: code,
    SERVER_COUNTRIES: name,
    EXITLY_COUNTRY: code,
    ...extra,
  };
  ensureProjectEnvScaffold(projectDir);
  upsertDotEnvFile(path.join(projectDir, '.env'), updates);
  return updates;
}

function cliVpnWorkDir(crawler) {
  return path.join(getHubRoot(), 'cli-vpn', String(crawler.id || 'x'));
}

function cliVpnHttpPort(crawler) {
  let h = 0;
  const s = String(crawler.id || 'x');
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 33 + s.charCodeAt(i)) >>> 0;
  }
  return 18100 + (h % 800);
}

function cliVpnMcpPort(crawler) {
  return 19100 + (cliVpnHttpPort(crawler) - 18100);
}

function resolveCliCrmRemote(crawler) {
  let env = {};
  try {
    if (crawler?.path) env = parseDotEnvFile(path.join(crawler.path, '.env'));
  } catch {
    /* ignore */
  }
  const isLoop = (host) => {
    const h = String(host || '').toLowerCase();
    return !h || h === 'localhost' || h === '127.0.0.1' || h === '::1';
  };
  const pick = (raw) => {
    const ep = parseMcpEndpoint(String(raw || '').trim());
    if (!ep || isLoop(ep.host)) return null;
    let pathname = '/api/mcp';
    try {
      pathname =
        new URL(ep.url.includes('://') ? ep.url : `http://${ep.url}`).pathname ||
        pathname;
    } catch {
      /* ignore */
    }
    return { host: ep.host, port: ep.port, pathname, url: ep.url };
  };
  return (
    pick(env.EXITLY_MCP_REMOTE) ||
    pick(env.FURNILEAD_MCP_URL) || {
      host: '192.168.88.130',
      port: 3370,
      pathname: '/api/mcp',
      url: 'http://192.168.88.130:3370/api/mcp',
    }
  );
}

/**
 * Conf wg jak na Orb: Table=off (nie rusza default/Proton) + ręczna trasa LAN.
 * Endpoint WG pinowany na eth0 (handshake nie idzie przez Proton).
 */
function buildCrm0ConfContent(parsed) {
  const ka = String(parsed.keepalive || '25').replace(/s$/i, '');
  const lan = String(parsed.allowedIps || '192.168.88.0/24').split(',')[0].trim();
  const ep = `${parsed.endpointIp}`;
  // Table=off jak Orb; po up: pin endpoint + LAN na crm0 + dziura w firewallu Gluetun.
  return [
    '# Exitly CRM LAN — jak Orb wg0 obok Proton (Table = off).',
    '[Interface]',
    `PrivateKey = ${parsed.privateKey}`,
    `Address = ${parsed.address}`,
    'Table = off',
    `PostUp = ep="${ep}"; gw=$(ip -4 route show default | awk '{print $3; exit}'); ` +
      `if [ -n "$gw" ] && [ -n "$ep" ]; then ip route replace "$ep" via "$gw" 2>/dev/null || true; fi; ` +
      `ip route replace ${lan} dev crm0 2>/dev/null || true; ` +
      `ip rule add to ${lan} lookup main priority 90 2>/dev/null || true; ` +
      `iptables -C OUTPUT -o crm0 -j ACCEPT 2>/dev/null || iptables -I OUTPUT 1 -o crm0 -j ACCEPT; ` +
      `iptables -C INPUT -i crm0 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i crm0 -j ACCEPT`,
    `PreDown = iptables -D OUTPUT -o crm0 -j ACCEPT 2>/dev/null || true; ` +
      `iptables -D INPUT -i crm0 -j ACCEPT 2>/dev/null || true; ` +
      `ip rule del to ${lan} lookup main priority 90 2>/dev/null || true; ` +
      `ip route del ${lan} dev crm0 2>/dev/null || true; ` +
      `ep="${ep}"; gw=$(ip -4 route show default | awk '{print $3; exit}'); ` +
      `if [ -n "$gw" ] && [ -n "$ep" ]; then ip route del "$ep" via "$gw" 2>/dev/null || true; fi`,
    '',
    '[Peer]',
    `PublicKey = ${parsed.peerPublicKey}`,
    `AllowedIPs = ${parsed.allowedIps}`,
    `Endpoint = ${parsed.endpointIp}:${parsed.endpointPort}`,
    `PersistentKeepalive = ${ka}`,
    '',
  ].join('\n');
}

function writeCrm0ConfFile(dir, parsed) {
  ensureDir(dir);
  const confPath = path.join(dir, 'crm0.conf');
  fs.writeFileSync(confPath, buildCrm0ConfContent(parsed), { mode: 0o600 });
  return confPath;
}

/** Obraz z wireguard-tools — apk w netns Proton nie działa. */
function ensureCrmWgBuildContext(dir) {
  const dest = path.join(dir, 'crm-wg');
  ensureDir(dest);
  const src = path.join(desktopRoot(), 'templates', 'crm-wg', 'Dockerfile');
  fs.copyFileSync(src, path.join(dest, 'Dockerfile'));
  return dest;
}

function crmWgComposeSnippet(crmLan) {
  return [
    '  crm-wg:',
    '    build: ./crm-wg',
    '    image: exitly-crm-wg:local',
    `    container_name: ${crmLan.containerName}`,
    '    network_mode: "service:vpn"',
    '    cap_add:',
    '      - NET_ADMIN',
    '    devices:',
    '      - /dev/net/tun:/dev/net/tun',
    '    depends_on:',
    '      - vpn',
    '    volumes:',
    '      - ./crm0.conf:/etc/wireguard/crm0.conf:ro',
    '    entrypoint: ["/bin/sh", "-c"]',
    '    command:',
    '      - |',
    '        set -e',
    '        wg-quick down crm0 2>/dev/null || true',
    '        wg-quick up crm0',
    '        echo "crm0 up (LAN obok Proton)"',
    '        sleep infinity',
    '    restart: unless-stopped',
    '',
  ];
}

/**
 * Jak Orb: jedna netns — Proton (default) + crm0 (tylko LAN).
 * crm-wg / crm-mcp dzielą network_mode: service:vpn.
 */
function buildCliVpnCompose({
  countryName,
  vpnContainerName,
  httpProxyPort,
  crmLan = null,
  mcpPort = 0,
  crmRemote = null,
}) {
  const dual = !!(crmLan && crmRemote && mcpPort);
  const lines = [
    'services:',
    '  vpn:',
    '    image: qmcgaw/gluetun:latest',
    `    container_name: ${vpnContainerName}`,
    '    cap_add:',
    '      - NET_ADMIN',
    '    devices:',
    '      - /dev/net/tun:/dev/net/tun',
    '    env_file:',
    '      - .env',
    '    environment:',
    '      VPN_SERVICE_PROVIDER: protonvpn',
    '      VPN_TYPE: wireguard',
    `      SERVER_COUNTRIES: ${countryName}`,
    '      HTTPPROXY: "on"',
    '      HTTPPROXY_LISTENING_ADDRESS: ":8888"',
    '      HTTPPROXY_STEALTH: "on"',
  ];
  if (dual) {
    // Jak Orb: bez kill-switch — drugi tunel CRM w tej samej netns
    lines.push(
      '      FIREWALL: "off"',
      // Bez 192.168.0.0/16 — inaczej Gluetun pcha CRM LAN na eth0 zamiast crm0
      '      FIREWALL_OUTBOUND_SUBNETS: "10.0.0.0/8,172.16.0.0/12"',
      '      FIREWALL_INPUT_PORTS: "8888,3370"',
      '    ports:',
      `      - "127.0.0.1:${httpProxyPort}:8888"`,
      `      - "127.0.0.1:${mcpPort}:3370"`,
      '    restart: unless-stopped',
      '',
      ...crmWgComposeSnippet(crmLan),
      '  crm-mcp:',
      '    image: alpine/socat:1.8.0.0',
      '    network_mode: "service:vpn"',
      '    depends_on:',
      '      - vpn',
      '      - crm-wg',
      '    entrypoint: ["/bin/sh", "-c"]',
      `    command: ["sleep 4; exec socat TCP-LISTEN:3370,fork,reuseaddr TCP:${crmRemote.host}:${crmRemote.port}"]`,
      '    restart: unless-stopped',
      '',
    );
  } else {
    lines.push(
      '      FIREWALL_OUTBOUND_SUBNETS: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"',
      '    ports:',
      `      - "127.0.0.1:${httpProxyPort}:8888"`,
      '    restart: unless-stopped',
      '',
    );
  }
  return lines.join('\n');
}

function writeCliVpnStack(crawler, country) {
  const key = readHubWireguardKey();
  if (!key || /PASTE_PRIVATE_KEY_HERE/.test(key)) {
    throw new Error('WireGuard key missing — complete Exitly setup first');
  }
  const { code, name } = resolveCountry(country || crawler.country || 'ro');
  const vpnContainerName =
    String(crawler.vpnContainerName || '').trim() ||
    `exitly-vpn-cli-${String(crawler.id || 'x').slice(-6)}`;
  const dir = cliVpnWorkDir(crawler);
  const httpProxyPort = cliVpnHttpPort(crawler);
  const mcpPort = cliVpnMcpPort(crawler);
  const wantCrm = !!crawler.useHostWg;
  let crmLan = null;
  let crmRemote = null;
  if (wantCrm) {
    crmLan = resolveCrmLanComposeSpec(crawler);
    crmRemote = resolveCliCrmRemote(crawler);
    writeCrm0ConfFile(dir, crmLan);
    ensureCrmWgBuildContext(dir);
  }
  ensureDir(dir);
  fs.writeFileSync(
    path.join(dir, '.env'),
    [
      '# Exitly CLI VPN sidecar — do not commit',
      'VPN_SERVICE_PROVIDER=protonvpn',
      'VPN_TYPE=wireguard',
      `WIREGUARD_PRIVATE_KEY=${key}`,
      `ACTIVE_COUNTRY=${code}`,
      `SERVER_COUNTRIES=${name}`,
      'HTTPPROXY=on',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(dir, 'docker-compose.yml'),
    buildCliVpnCompose({
      countryName: name,
      vpnContainerName,
      httpProxyPort,
      crmLan,
      mcpPort: wantCrm ? mcpPort : 0,
      crmRemote,
    }),
  );
  return {
    dir,
    code,
    name,
    vpnContainerName,
    httpProxyPort,
    mcpPort: wantCrm ? mcpPort : 0,
    crmContainerName: crmLan ? crmLan.containerName : '',
    crmRemote,
    dockerCrm: wantCrm,
  };
}

async function cliVpnCompose(crawler, args, opts = {}) {
  const dir = cliVpnWorkDir(crawler);
  const file = path.join(dir, 'docker-compose.yml');
  if (!fs.existsSync(file)) {
    throw new Error(`Brak stacka VPN CLI: ${file}`);
  }
  return run(
    'docker',
    ['compose', '-f', file, '--project-directory', dir, ...args],
    { ...opts, cwd: dir },
  );
}

async function waitCliVpnReady(vpnContainerName, { onLog, attempts = 24 } = {}) {
  let lastErr = '';
  for (let i = 0; i < attempts; i += 1) {
    if (!(await containerRunning(vpnContainerName))) {
      lastErr = 'kontener VPN nie działa';
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    const info = await fetchContainerIpInfo(vpnContainerName, null);
    if (info.ip && !info.error) {
      if (onLog) {
        onLog(
          `VPN gotowy: ${info.ip}${info.country ? ` · ${info.country}` : ''}${
            info.org ? ` · ${info.org}` : ''
          }`,
        );
      }
      return info;
    }
    lastErr = info.error || 'czekam na tunel…';
    if (onLog && i % 4 === 3) onLog(`VPN: ${lastErr}`);
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`VPN CLI nie wstał: ${lastErr}`);
}

/** Env for OpenCode / FurniLead — crawl via Proton proxy; CRM via Docker crm-lan→localhost. */
function buildCliTunnelProcessEnv(stack, projectDir, { useHostWg = false } = {}) {
  const proxy = stack.proxy || `http://127.0.0.1:${stack.httpProxyPort}`;
  const noProxy = [
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '.local',
    'host.docker.internal',
    'ollama',
  ];
  try {
    const existing = parseDotEnvFile(path.join(projectDir, '.env'));
    for (const key of ['FURNILEAD_MCP_URL', 'EXITLY_MCP_REMOTE', 'OLLAMA_BASE_URL', 'OLLAMA_HOST']) {
      const raw = String(existing[key] || '').trim();
      if (!raw) continue;
      try {
        const host = new URL(raw.includes('://') ? raw : `http://${raw}`).hostname;
        if (host && !noProxy.includes(host)) noProxy.push(host);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const ollama = getOllamaSettings();
    if (ollama?.baseUrl) {
      const host = new URL(String(ollama.baseUrl)).hostname;
      if (host && !noProxy.includes(host)) noProxy.push(host);
    }
  } catch {
    /* ignore */
  }
  const no = [...new Set(noProxy)].join(',');
  const dockerCrm = !!(useHostWg && stack.dockerCrm && stack.mcpPort);
  const out = {
    EXITLY_HTTP_PROXY: proxy,
    EXITLY_VPN_CONTAINER: stack.vpnContainerName,
    EXITLY_COUNTRY: stack.code,
    ACTIVE_COUNTRY: stack.code,
    SERVER_COUNTRIES: stack.name,
    FURNILEAD_CRAWL_PROXY: proxy,
    EXITLY_DOCKER_CRM: dockerCrm ? '1' : '0',
    EXITLY_HOST_WG: '0',
    FURNILEAD_WG_AUTO: '0',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
    NO_PROXY: no,
    no_proxy: no,
  };
  if (dockerCrm) {
    const remote = stack.crmRemote || resolveCliCrmRemote({ path: projectDir });
    const remoteUrl =
      remote.url ||
      `http://${remote.host}:${remote.port}${remote.pathname || '/api/mcp'}`;
    out.EXITLY_MCP_REMOTE = remoteUrl;
    out.FURNILEAD_MCP_URL = `http://127.0.0.1:${stack.mcpPort}${remote.pathname || '/api/mcp'}`;
  }
  return out;
}

/** Ollama always direct (never via Exitly tunnel proxy). */
function buildCliOllamaProcessEnv() {
  const ollama = getOllamaSettings();
  if (!ollama.enabled || !ollama.baseUrl) {
    return {};
  }
  const url = String(ollama.baseUrl).replace(/\/$/, '');
  return {
    OLLAMA_BASE_URL: url,
    OLLAMA_HOST: url,
    // OpenCode / klienty Ollamy
    OLLAMA_API_BASE: url,
  };
}

async function ensureCliVpnTunnel(
  crawler,
  { country, recreate = false, waitReady = true, onLog } = {},
) {
  if (envNeedsSetup()) {
    throw new Error('Brak klucza WireGuard — dokończ konfigurację Exitly');
  }
  const cc = resolveProjectCountry(country || crawler.country, 'ro');
  const stack = writeCliVpnStack(crawler, cc);
  const running = await containerRunning(stack.vpnContainerName);
  const crmRunning = stack.crmContainerName
    ? await containerRunning(stack.crmContainerName)
    : true;
  const needUp = !running || recreate || (stack.dockerCrm && !crmRunning);
  if (needUp) {
    if (onLog) {
      onLog(
        `${crawler.name}: Docker VPN${stack.dockerCrm ? ' + crm0' : ''} → ${String(cc).toUpperCase()}…`,
      );
    }
    // force-recreate TYLKO gdy recreate=true albo kontenera nie ma —
    // inaczej każde Uruchom zabija :19360 i Codex widzi puste odpowiedzi.
    const upArgs = [
      'up',
      '-d',
      '--remove-orphans',
      ...(recreate || !running ? ['--force-recreate'] : []),
      ...(stack.dockerCrm && (recreate || !crmRunning) ? ['--build'] : []),
    ];
    await cliVpnCompose(
      { ...crawler, vpnContainerName: stack.vpnContainerName },
      upArgs,
      { onLog },
    );
    if (waitReady) {
      await waitCliVpnReady(stack.vpnContainerName, { onLog });
    }
  } else if (waitReady) {
    try {
      await waitCliVpnReady(stack.vpnContainerName, { onLog, attempts: 6 });
    } catch {
      if (onLog) onLog(`${crawler.name}: VPN stoi, ale bez IP — recreate…`);
      await cliVpnCompose(
        { ...crawler, vpnContainerName: stack.vpnContainerName },
        [
          'up',
          '-d',
          '--force-recreate',
          '--remove-orphans',
          ...(stack.dockerCrm ? ['--build'] : []),
        ],
        { onLog },
      );
      await waitCliVpnReady(stack.vpnContainerName, { onLog });
    }
  }
  const proxy = `http://127.0.0.1:${stack.httpProxyPort}`;
  const full = { ...stack, proxy };
  const tunnelEnv = buildCliTunnelProcessEnv(full, crawler.path, {
    useHostWg: !!crawler.useHostWg,
  });
  if (fs.existsSync(crawler.path)) {
    syncCliCountryIntoProjectEnv(crawler.path, cc, tunnelEnv);
  }
  return { ...full, tunnelEnv };
}

async function stopCliVpnTunnel(crawler, { onLog } = {}) {
  const dir = cliVpnWorkDir(crawler);
  const vpnName = String(crawler.vpnContainerName || '').trim();
  if (onLog) onLog(`Usuwam VPN CLI${vpnName ? ` (${vpnName})` : ''}…`);
  if (fs.existsSync(path.join(dir, 'docker-compose.yml'))) {
    try {
      await cliVpnCompose(crawler, ['down', '--remove-orphans', '-v'], { onLog });
    } catch (err) {
      if (onLog) onLog(`compose down: ${err.message || err}`);
    }
  }
  if (vpnName) {
    try {
      await run('docker', ['rm', '-f', vpnName], { onLog });
    } catch {
      /* already gone */
    }
  }
  try {
    const crmName = crmLanContainerName(crawler);
    if (crmName) await run('docker', ['rm', '-f', crmName], { onLog });
  } catch {
    /* ignore */
  }
  if (crawler.path && fs.existsSync(crawler.path)) {
    try {
      upsertDotEnvFile(path.join(crawler.path, '.env'), {
        EXITLY_HTTP_PROXY: '',
        EXITLY_VPN_CONTAINER: '',
        FURNILEAD_CRAWL_PROXY: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        ALL_PROXY: '',
        http_proxy: '',
        https_proxy: '',
        all_proxy: '',
      });
    } catch {
      /* ignore */
    }
  }
}

function parseDotEnvFile(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    map[key] = line.slice(i + 1);
  }
  return map;
}

function upsertDotEnvFile(filePath, updates) {
  const entries = updates && typeof updates === 'object' && !Array.isArray(updates) ? Object.entries(updates) : [];
  if (!entries.length) return parseDotEnvFile(filePath);

  let body = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  if (!body && fs.existsSync(`${filePath}.example`)) {
    // seed structure from example when creating fresh .env
    try {
      body = fs.readFileSync(`${filePath}.example`, 'utf8');
    } catch {
      body = '';
    }
  }

  for (const [rawKey, rawVal] of entries) {
    const key = String(rawKey || '')
      .trim()
      .replace(/[^A-Za-z0-9_]/g, '');
    if (!key) continue;
    const value = String(rawVal ?? '');
    const line = `${key}=${value}`;
    if (new RegExp(`^${key}=`, 'm').test(body)) {
      body = body.replace(new RegExp(`^${key}=.*$`, 'm'), line);
    } else {
      body = `${body.replace(/\s*$/, '')}\n${line}\n`;
    }
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, body.endsWith('\n') ? body : `${body}\n`, {
    mode: 0o600,
  });
  return parseDotEnvFile(filePath);
}

function ensureProjectEnvScaffold(projectDir, { onLog } = {}) {
  const envFile = path.join(projectDir, '.env');
  const example = path.join(projectDir, '.env.example');
  if (!fs.existsSync(envFile) && fs.existsSync(example)) {
    fs.copyFileSync(example, envFile);
    fs.chmodSync(envFile, 0o600);
    if (onLog) onLog('Utworzono .env z .env.example — uzupełnij klucze w Exitly');
  }
  if (!fs.existsSync(envFile) && !fs.existsSync(example)) {
    fs.writeFileSync(envFile, '# Exitly project env\n', { mode: 0o600 });
  }
  // Merge missing keys from example (empty values only — never overwrite)
  if (fs.existsSync(example) && fs.existsSync(envFile)) {
    const cur = parseDotEnvFile(envFile);
    const ex = parseDotEnvFile(example);
    const missing = {};
    for (const [k, v] of Object.entries(ex)) {
      if (!(k in cur)) missing[k] = v;
    }
    if (Object.keys(missing).length) {
      upsertDotEnvFile(envFile, missing);
      if (onLog) {
        onLog(`Dopisano ${Object.keys(missing).length} pustych kluczy z .env.example`);
      }
    }
  }
  // Also ensure keys from envFields schema exist (e.g. FURNILEAD_MCP_*)
  try {
    const fields = resolveProjectEnvFields(projectDir);
    if (fields.length && fs.existsSync(envFile)) {
      const cur = parseDotEnvFile(envFile);
      const missing = {};
      for (const f of fields) {
        if (!(f.key in cur)) {
          missing[f.key] = f.placeholder && !f.secret ? f.placeholder : '';
        }
      }
      if (Object.keys(missing).length) {
        upsertDotEnvFile(envFile, missing);
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

function getProjectEnv(id) {
  const crawler = findCrawler(id);
  if (crawler.kind !== 'project') {
    throw new Error('Env tylko dla projektów');
  }
  ensureProjectEnvScaffold(crawler.path);
  const fields = resolveProjectEnvFields(crawler.path, crawler);
  const values = parseDotEnvFile(path.join(crawler.path, '.env'));
  const enriched = fields.map((f) => {
    const value = values[f.key] ?? '';
    const filled = String(value).trim().length > 0;
    return {
      ...f,
      value,
      filled,
      missing: !!f.required && !filled,
    };
  });
  const missingRequired = enriched.filter((f) => f.missing).map((f) => f.key);
  return {
    ok: true,
    id: crawler.id,
    path: path.join(crawler.path, '.env'),
    fields: enriched,
    missingRequired,
    ready: missingRequired.length === 0,
  };
}

async function setProjectEnv(id, values, { onLog } = {}) {
  const crawler = findCrawler(id);
  if (crawler.kind !== 'project') {
    throw new Error('Env tylko dla projektów');
  }
  if (!values || typeof values !== 'object') {
    throw new Error('Brak wartości env');
  }
  ensureProjectEnvScaffold(crawler.path, { onLog });
  const allowed = new Set(resolveProjectEnvFields(crawler.path, crawler).map((f) => f.key));
  // Also allow any KEY= from payload that looks like env (for custom fields)
  const updates = {};
  for (const [k, v] of Object.entries(values)) {
    const key = String(k || '')
      .trim()
      .replace(/[^A-Za-z0-9_]/g, '');
    if (!key) continue;
    if (allowed.size && !allowed.has(key)) continue;
    updates[key] = String(v ?? '');
  }
  if (!Object.keys(updates).length) {
    throw new Error('Brak dozwolonych kluczy do zapisu');
  }
  upsertDotEnvFile(path.join(crawler.path, '.env'), updates);

  // Persist schema on meta if missing
  const meta = readProjectMeta(crawler.path) || {};
  if (!Array.isArray(meta.envFields) || !meta.envFields.length) {
    const fields = resolveProjectEnvFields(crawler.path, crawler);
    if (fields.length) {
      writeProjectMeta(crawler.path, {
        ...meta,
        envFields: fields.map(({ key, label, secret, required, placeholder }) => ({
          key,
          label,
          secret,
          required,
          placeholder,
        })),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (onLog) onLog(`${crawler.name}: zapisano .env (${Object.keys(updates).length} pól)`);
  return getProjectEnv(id);
}

function resolveProjectStartOptions(projectDir, crawler = null) {
  const meta = readProjectMeta(projectDir) || {};
  const fromMeta = normalizeStartOptions(meta.options);
  if (fromMeta.length) return fromMeta;
  return normalizeStartOptions(crawler?.options);
}

function resolveProjectOptionValues(projectDir, crawler = null) {
  const options = resolveProjectStartOptions(projectDir, crawler);
  const meta = readProjectMeta(projectDir) || {};
  return normalizeOptionValues({ ...(meta.optionValues || {}), ...(crawler?.optionValues || {}) }, options);
}

/** Build env + CLI args from option values for start. */
function parsePyprojectScripts(projectDir) {
  const file = path.join(projectDir, 'pyproject.toml');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const section = text.match(/\[project\.scripts\]\s*([\s\S]*?)(?=\n\[|$)/);
  if (!section) return [];
  const names = [];
  for (const line of section[1].split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/);
    if (m) names.push(m[1]);
  }
  return names;
}

/** Detect host CLI (furnilead, npm bin, exitly.project.json). */
function detectCliSpec(projectDir) {
  const meta = readProjectMeta(projectDir);
  if (meta && meta.cli && meta.cli.command) {
    return {
      command: String(meta.cli.command).trim(),
      args: normalizeCliArgs(meta.cli.args),
      terminal: meta.cli.terminal !== false,
      activateVenv: meta.cli.activateVenv === true,
    };
  }

  const scripts = parsePyprojectScripts(projectDir);
  for (const name of scripts) {
    const venvBin = path.join(projectDir, '.venv', 'bin', name);
    if (fs.existsSync(venvBin)) {
      return {
        command: venvBin,
        args: [],
        terminal: true,
        activateVenv: false,
      };
    }
  }
  if (scripts.length) {
    return {
      command: scripts[0],
      args: [],
      terminal: true,
      activateVenv: fs.existsSync(path.join(projectDir, '.venv', 'bin', 'activate')),
    };
  }

  for (const name of ['furnilead', 'furnilead-mcp']) {
    const venvBin = path.join(projectDir, '.venv', 'bin', name);
    if (fs.existsSync(venvBin)) {
      return {
        command: venvBin,
        args: [],
        terminal: true,
        activateVenv: false,
      };
    }
  }

  const pkgFile = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      if (pkg.scripts && pkg.scripts.start) {
        const pm = fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'))
          ? 'pnpm'
          : fs.existsSync(path.join(projectDir, 'yarn.lock'))
            ? 'yarn'
            : 'npm';
        return {
          command: pm,
          args: ['start'],
          terminal: true,
          activateVenv: false,
        };
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

function detectRunMode(projectDir) {
  const meta = readProjectMeta(projectDir);
  if (meta) {
    if (meta.runMode === 'cli' || meta.stack === 'cli' || meta.cli) return 'cli';
    if (meta.runMode === 'docker') return 'docker';
  }
  if (fs.existsSync(path.join(projectDir, 'docker-compose.yml'))) return 'docker';
  if (detectCliSpec(projectDir)) return 'cli';
  return null;
}

function resolveCliSpec(crawler) {
  let spec;
  if (crawler.cliCommand) {
    spec = {
      command: crawler.cliCommand,
      args: normalizeCliArgs(crawler.cliArgs),
      terminal: crawler.cliTerminal !== false,
      activateVenv: false,
    };
  } else {
    spec = detectCliSpec(crawler.path);
    if (!spec) {
      throw new Error(`Brak komendy CLI w ${crawler.path} — ustaw cli.command w exitly.project.json`);
    }
  }
  if (spec.command && !path.isAbsolute(spec.command) && spec.command.includes('/')) {
    const abs = path.join(crawler.path, spec.command);
    if (fs.existsSync(abs)) {
      spec = { ...spec, command: abs };
    }
  }
  if (spec.command && !path.isAbsolute(spec.command) && !spec.command.includes('/')) {
    const resolved = resolveCliExecutable(spec.command);
    if (resolved) spec = { ...spec, command: resolved };
  }
  // Codex: lokalna Ollama bez logowania OpenAI (--oss)
  spec = applyCliShellDefaults(spec, crawler);
  return spec;
}

/** Codex → --oss + ollama; model z karty projektu (crawlModel). */
function applyCliShellDefaults(spec, crawler) {
  if (!spec || !spec.command) return spec;
  const base = cliShellBasename(spec.command).toLowerCase();
  const args = normalizeCliArgs(spec.args);
  if (base === 'codex' || base.startsWith('codex.')) {
    const next = [...args];
    const has = (flag) => next.includes(flag);
    if (!has('--oss')) next.unshift('--oss');
    if (!has('--local-provider')) {
      const ossIdx = next.indexOf('--oss');
      next.splice(ossIdx + 1, 0, '--local-provider', 'ollama');
    }
    const model = String(crawler?.crawlModel || '').trim();
    if (model && !has('-m') && !has('--model')) {
      next.push('-m', model);
    }
    return { ...spec, args: next };
  }
  return { ...spec, args };
}

/** Find bare commands (opencode) — Electron PATH often misses ~/.local/bin. */
function resolveCliExecutable(command) {
  const name = String(command || '').trim();
  if (!name || name.includes('/') || name.includes('\\')) return '';
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.nvm', 'current', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    ...(String(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)),
  ];
  const seen = new Set();
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  return '';
}

function cliShellBasename(command) {
  const s = String(command || '').trim();
  if (!s) return '';
  const base = path.basename(s);
  return base.replace(/\.(exe|cmd|bat)$/i, '');
}

function listAvailableCliShells() {
  return CLI_SHELL_PRESETS.map((p) => {
    const resolved = resolveCliExecutable(p.command);
    return {
      id: p.id,
      label: p.label,
      command: p.command,
      resolved: resolved || '',
      available: !!resolved,
    };
  });
}

function matchCliShellPreset(command) {
  const base = cliShellBasename(command).toLowerCase();
  if (!base) return null;
  return CLI_SHELL_PRESETS.find((p) => p.command === base || p.id === base) || null;
}

async function setProjectCliShell(id, { command, args } = {}, { onLog } = {}) {
  const list = readCrawlers();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error(`Not found: ${id}`);
  const crawler = list[idx];
  if (crawler.kind !== 'project' || crawler.runMode !== 'cli') {
    throw new Error('Shell CLI tylko dla projektów CLI');
  }
  const raw = String(command || '').trim().slice(0, 300);
  if (!raw) throw new Error('Podaj komendę CLI (opencode / codex / …)');
  const bare = cliShellBasename(raw) || raw;
  const resolved = path.isAbsolute(raw)
    ? raw
    : resolveCliExecutable(bare) || resolveCliExecutable(raw);
  if (!resolved && !path.isAbsolute(raw) && !raw.includes('/')) {
    throw new Error(
      `Nie znaleziono „${bare}” w PATH (~/.local/bin). Zainstaluj albo podaj pełną ścieżkę.`,
    );
  }
  const nextCmd = resolved || raw;
  const preset = matchCliShellPreset(nextCmd);
  let nextArgs =
    args != null ? normalizeCliArgs(args) : normalizeCliArgs(crawler.cliArgs);
  // Przy wyborze Codex domyślnie OSS/Ollama (bez logowania ChatGPT)
  if (preset?.id === 'codex' || bare === 'codex') {
    const draft = applyCliShellDefaults(
      { command: nextCmd, args: nextArgs },
      crawler,
    );
    nextArgs = draft.args;
  }
  crawler.cliCommand = nextCmd;
  crawler.cliArgs = nextArgs;
  list[idx] = crawler;
  writeCrawlers(list);
  if (fs.existsSync(crawler.path)) {
    const meta = readProjectMeta(crawler.path) || {};
    writeProjectMeta(crawler.path, {
      ...meta,
      cli: {
        ...(meta.cli && typeof meta.cli === 'object' ? meta.cli : {}),
        command: bare,
        args: nextArgs,
        terminal: crawler.cliTerminal !== false,
        resolved: nextCmd,
        shell: preset?.id || bare,
      },
      updatedAt: new Date().toISOString(),
    });
  }
  const label = preset?.label || bare;
  if (onLog) {
    onLog(
      `${crawler.name}: shell → ${label}${
        preset?.id === 'codex' ? ' (Ollama --oss, bez logowania)' : ''
      }`,
    );
  }
  return findCrawler(id);
}

/** In-memory CLI sessions (terminal launch or background process). */
const cliSessions = new Map();
const cliLogBuffers = new Map();

function appendCliLog(id, line) {
  const prev = cliLogBuffers.get(id) || '';
  const next = `${prev}${line}\n`.slice(-80_000);
  cliLogBuffers.set(id, next);
}

function isCliSessionRunning(id) {
  const session = cliSessions.get(id);
  if (!session) return false;
  if (session.mode === 'terminal') return true;
  if (session.child && session.child.exitCode == null && !session.child.killed) {
    return true;
  }
  cliSessions.delete(id);
  return false;
}

function buildCliShellCommand(projectDir, cli, { extraEnv = {} } = {}) {
  const parts = [shellQuote(cli.command), ...cli.args.map(shellQuote)];
  const run = parts.join(' ');
  const lines = [
    'set -e',
    `cd ${shellQuote(projectDir)}`,
    // Electron → Terminal często bez ~/.local/bin
    'export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
  ];
  for (const [k, v] of Object.entries(extraEnv || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    // Puste = unset (żeby stary HTTP_PROXY z sesji nie psuł Ollamy)
    if (v === '' || v == null) {
      lines.push(`unset ${k}`);
    } else {
      lines.push(`export ${k}=${shellQuote(String(v))}`);
    }
  }
  const proxy = String(
    extraEnv.FURNILEAD_CRAWL_PROXY || extraEnv.EXITLY_HTTP_PROXY || '',
  ).trim();
  const country = String(extraEnv.EXITLY_COUNTRY || extraEnv.ACTIVE_COUNTRY || '').trim();
  const ollama = String(extraEnv.OLLAMA_HOST || extraEnv.OLLAMA_BASE_URL || '').trim();
  if (proxy) {
    lines.push(
      `echo ${shellQuote(
        `Exitly crawl-proxy ${country ? `${String(country).toUpperCase()} ` : ''}-> ${proxy}`,
      )}`,
    );
  }
  const mcpUrl = String(extraEnv.FURNILEAD_MCP_URL || '').trim();
  if (mcpUrl) {
    lines.push(`echo ${shellQuote(`Exitly CRM MCP → ${mcpUrl}`)}`);
  }
  if (ollama) {
    lines.push(`echo ${shellQuote(`Ollama (direct): ${ollama}`)}`);
  }
  lines.push(`command -v ${shellQuote(cli.command)} >/dev/null || { echo "Nie znaleziono: ${cli.command}"; echo "PATH=$PATH"; exit 127; }`);
  if (cli.activateVenv && fs.existsSync(path.join(projectDir, '.venv', 'bin', 'activate'))) {
    lines.push('source .venv/bin/activate');
  }
  lines.push(`exec ${run}`);
  return lines.join('\n');
}

async function openCliInSystemTerminal(projectDir, cli, { onLog, extraEnv } = {}) {
  const shellCmd = buildCliShellCommand(projectDir, cli, { extraEnv });
  if (onLog) onLog(`Terminal: ${cli.command}${cli.args.length ? ` ${cli.args.join(' ')}` : ''}`);

  // Skrypt w pliku — pewniejszy niż długa linia w osascript (env + PATH)
  const scriptPath = path.join(
    os.tmpdir(),
    `exitly-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`,
  );
  fs.writeFileSync(scriptPath, `#!/bin/zsh\n${shellCmd}\n`, { mode: 0o700 });

  try {
    if (process.platform === 'darwin') {
      const script = `tell application "Terminal" to do script ${JSON.stringify(
        `exec /bin/zsh ${shellQuote(scriptPath)}`,
      )}`;
      await run('osascript', ['-e', script], { cwd: projectDir, onLog });
      try {
        await run('osascript', ['-e', 'tell application "Terminal" to activate'], {
          cwd: projectDir,
        });
      } catch {
        /* ignore */
      }
      return;
    }

    if (process.platform === 'win32') {
      await new Promise((resolve, reject) => {
        const child = spawn(
          'cmd.exe',
          ['/c', 'start', 'cmd.exe', '/k', `call ${scriptPath}`],
          {
            cwd: projectDir,
            env: { ...process.env, ...(extraEnv || {}) },
            shell: false,
            windowsHide: false,
            detached: true,
            stdio: 'ignore',
          },
        );
        child.on('error', reject);
        child.unref();
        child.on('spawn', () => resolve());
      });
      return;
    }

    const linuxTerms = [
      ['gnome-terminal', ['--', 'bash', scriptPath]],
      ['konsole', ['-e', 'bash', scriptPath]],
      ['xfce4-terminal', ['-e', `bash ${shellQuote(scriptPath)}`]],
      ['x-terminal-emulator', ['-e', 'bash', scriptPath]],
      ['xterm', ['-e', 'bash', scriptPath]],
    ];
    let lastErr = null;
    for (const [cmd, args] of linuxTerms) {
      try {
        await run(cmd, args, { cwd: projectDir, onLog });
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Nie znaleziono emulatora terminala');
  } finally {
    // Terminal czyta skrypt asynchronicznie — skasuj później
    setTimeout(() => {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        /* ignore */
      }
    }, 60_000);
  }
}

function startCliBackgroundProcess(id, projectDir, cli, { onLog, onLine, extraEnv } = {}) {
  const env = { ...process.env, ...(extraEnv || {}) };
  const args = [...cli.args];
  let cmd = cli.command;
  if (cli.activateVenv && fs.existsSync(path.join(projectDir, '.venv', 'bin', cmd))) {
    cmd = path.join(projectDir, '.venv', 'bin', cmd);
  }

  const child = spawn(cmd, args, {
    cwd: projectDir,
    env,
    shell: false,
    windowsHide: true,
  });

  cliSessions.set(id, { mode: 'process', child, startedAt: Date.now() });
  appendCliLog(id, `$ ${cmd} ${args.join(' ')}`.trim());

  const pump = (buf) => {
    String(buf)
      .split(/\r?\n/)
      .filter((line) => line.length)
      .forEach((line) => {
        appendCliLog(id, line);
        if (onLine) onLine(line);
        if (onLog) onLog(line);
      });
  };
  child.stdout.on('data', pump);
  child.stderr.on('data', pump);
  child.on('close', (code) => {
    appendCliLog(id, `(CLI zakończone, kod ${code})`);
    if (onLog) onLog(`CLI zakończone (kod ${code})`);
    const cur = cliSessions.get(id);
    if (cur && cur.child === child) cliSessions.delete(id);
  });
  child.on('error', (err) => {
    appendCliLog(id, `Błąd: ${err.message || err}`);
    if (onLog) onLog(String(err.message || err));
    cliSessions.delete(id);
  });
  return child;
}

async function stopCliSession(id, { onLog } = {}) {
  const session = cliSessions.get(id);
  if (!session) {
    if (onLog) onLog('CLI już wyłączone');
    return false;
  }
  if (session.mode === 'process' && session.child) {
    try {
      session.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        if (!session.child.killed) session.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 1500);
  } else if (onLog) {
    onLog('Zamknij okno Terminala ręcznie (sesja interaktywna)');
  }
  cliSessions.delete(id);
  return true;
}

function parseHostWgConfText(text) {
  const raw = String(text || '');
  const grab = (key) => {
    const m = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'im'));
    return m ? m[1].trim() : '';
  };
  const privateKey = grab('PrivateKey');
  const address = grab('Address');
  const peerPublicKey = (() => {
    const peer = raw.split(/\[Peer\]/i)[1] || '';
    const m = peer.match(/^\s*PublicKey\s*=\s*(.+)$/im);
    return m ? m[1].trim() : '';
  })();
  const allowedIps = grab('AllowedIPs') || '192.168.88.0/24';
  const endpoint = grab('Endpoint');
  const keepalive = grab('PersistentKeepalive') || '25';
  let endpointIp = '';
  let endpointPort = '51820';
  if (endpoint.includes(':')) {
    const idx = endpoint.lastIndexOf(':');
    endpointIp = endpoint.slice(0, idx).trim();
    endpointPort = endpoint.slice(idx + 1).trim() || '51820';
  } else {
    endpointIp = endpoint;
  }
  if (!privateKey || !address || !peerPublicKey || !endpointIp) {
    return null;
  }
  return {
    privateKey,
    address,
    peerPublicKey,
    allowedIps,
    endpointIp,
    endpointPort,
    keepalive,
  };
}

function crmLanContainerName(crawler) {
  const base = String(crawler.vpnContainerName || crawler.containerName || crawler.id || 'x')
    .replace(/^exitly-vpn-/, 'exitly-crm-')
    .replace(/^exitly-proj-/, 'exitly-crm-');
  if (base.startsWith('exitly-crm-')) return base;
  return `exitly-crm-${String(crawler.id || 'x').slice(-6)}`;
}

function crmLanHealthTarget(allowedIps) {
  const first = String(allowedIps || '192.168.88.0/24').split(',')[0].trim();
  const m = first.match(/^(\d+\.\d+\.\d+)\.0\/\d+$/);
  if (m) return `${m[1]}.1:53`;
  const ip = first.match(/^(\d+\.\d+\.\d+\.\d+)/);
  if (ip) return `${ip[1]}:3370`;
  return '192.168.88.1:53';
}

/**
 * Compose: Proton VPN (crawl) + opcjonalnie crm-lan (CRM) w Dockerze.
 * CRM mode: app siedzi na crm-lan, crawl idzie HTTP proxy → vpn.
 */
function extractAppComposeExtras(composeBody) {
  const volumes = [];
  const env = [];
  const appMatch = String(composeBody || '').match(
    /\n  app:\n([\s\S]*?)(?=\n  [a-zA-Z]|\n*$)/,
  );
  if (!appMatch) {
    return { volumes: ['      - ./output:/app/output'], env: [] };
  }
  const block = appMatch[1];
  const volSection = block.match(/\n    volumes:\n((?:      - .+\n?)*)/);
  if (volSection) {
    for (const line of volSection[1].split('\n')) {
      if (/^\s+-\s+/.test(line)) volumes.push(line.replace(/\s+$/, ''));
    }
  }
  if (!volumes.length) volumes.push('      - ./output:/app/output');
  const envSection = block.match(/\n    environment:\n((?:      .+\n?)*)/);
  if (envSection) {
    const skip =
      /^(EXITLY_CONTAINER|EXITLY_DOCKER_CRM|HTTP_PROXY|HTTPS_PROXY|http_proxy|https_proxy|FURNILEAD_CRAWL_PROXY|EXITLY_HTTP_PROXY|NO_PROXY|no_proxy)\s*:/;
    for (const line of envSection[1].split('\n')) {
      if (!/^\s{6}\S/.test(line)) continue;
      const trimmed = line.replace(/\s+$/, '');
      const key = trimmed.trim();
      if (skip.test(key)) continue;
      env.push(trimmed);
    }
  }
  return { volumes, env };
}

function buildDedicatedCompose({
  countryName,
  vpnContainerName,
  containerName,
  crmLan = null,
  httpProxyPort = 0,
  appExtras = null,
}) {
  const volumes =
    appExtras?.volumes?.length > 0
      ? appExtras.volumes
      : ['      - ./output:/app/output'];
  const extraEnv = appExtras?.env || [];
  const dual = !!crmLan;
  const lines = [
    'services:',
    '  vpn:',
    '    image: qmcgaw/gluetun:latest',
    `    container_name: ${vpnContainerName}`,
    '    cap_add:',
    '      - NET_ADMIN',
    '    devices:',
    '      - /dev/net/tun:/dev/net/tun',
    '    env_file:',
    '      - .env',
    '    extra_hosts:',
    '      - "host.docker.internal:host-gateway"',
    '    environment:',
    '      VPN_SERVICE_PROVIDER: protonvpn',
    '      VPN_TYPE: wireguard',
    `      SERVER_COUNTRIES: ${countryName}`,
  ];

  if (dual) {
    // Jak Orb: jedna netns — Proton (default) + crm0 (LAN). App bez HTTP_PROXY.
    lines.push(
      '      HTTPPROXY: "off"',
      '      FIREWALL: "off"',
      '      FIREWALL_OUTBOUND_SUBNETS: "10.0.0.0/8,172.16.0.0/12"',
      '    restart: unless-stopped',
      '',
      ...crmWgComposeSnippet(crmLan),
      '  app:',
      '    build: .',
      `    container_name: ${containerName}`,
      '    network_mode: "service:vpn"',
      '    depends_on:',
      '      - vpn',
      '      - crm-wg',
      '    env_file:',
      '      - .env',
      '    environment:',
      '      EXITLY_CONTAINER: "1"',
      '      EXITLY_DOCKER_CRM: "1"',
      '      HTTP_PROXY: ""',
      '      HTTPS_PROXY: ""',
      '      http_proxy: ""',
      '      https_proxy: ""',
      '      FURNILEAD_CRAWL_PROXY: ""',
      '      EXITLY_HTTP_PROXY: ""',
      '      NO_PROXY: localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,host.docker.internal,ollama',
      '      no_proxy: localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,host.docker.internal,ollama',
      ...extraEnv,
      '    volumes:',
      ...volumes,
      '    restart: unless-stopped',
      '',
    );
  } else {
    lines.push(
      '      HTTPPROXY: "off"',
      '      FIREWALL_OUTBOUND_SUBNETS: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"',
      '    restart: unless-stopped',
      '',
      '  app:',
      '    build: .',
      `    container_name: ${containerName}`,
      '    network_mode: "service:vpn"',
      '    depends_on:',
      '      - vpn',
      '    env_file:',
      '      - .env',
      ...(extraEnv.length
        ? ['    environment:', '      EXITLY_CONTAINER: "1"', ...extraEnv]
        : []),
      '    volumes:',
      ...volumes,
      '    restart: unless-stopped',
      '',
    );
  }
  return lines.join('\n');
}

function resolveCrmLanComposeSpec(crawler) {
  if (!crawler || !crawler.useHostWg) return null;
  const hg = getHostWgSettings();
  if (!hg.configured) {
    throw new Error(
      'CRM LAN wymaga conf w Ustawieniach Exitly (CRM LAN) — wklej i Zapisz',
    );
  }
  const parsed = parseHostWgConfText(hg.configText || readHostWgConfigText());
  if (!parsed) {
    throw new Error('Config CRM LAN niekompletny (PrivateKey / Address / Peer / Endpoint)');
  }
  return {
    ...parsed,
    containerName: crmLanContainerName(crawler),
  };
}

/** Sync dedicated vpn(+crm0)+app compose — jak Orb: Proton + LAN w jednej netns. */
function ensureDedicatedTunnelCompose(crawler) {
  const composePath = projectComposeFile(crawler);
  if (!fs.existsSync(composePath)) {
    throw new Error(`Missing docker-compose.yml in ${crawler.path}`);
  }
  const prev = fs.readFileSync(composePath, 'utf8');
  const { name } = resolveCountry(crawler.country || 'ro');
  const crmLan = resolveCrmLanComposeSpec(crawler);
  const httpProxyPort = crmLan ? cliVpnHttpPort(crawler) : 0;
  if (crmLan) {
    writeCrm0ConfFile(crawler.path, crmLan);
    ensureCrmWgBuildContext(crawler.path);
  }
  const appExtras = extractAppComposeExtras(prev);
  const next = buildDedicatedCompose({
    countryName: name,
    vpnContainerName: crawler.vpnContainerName,
    containerName: crawler.containerName,
    crmLan,
    httpProxyPort,
    appExtras,
  });
  fs.writeFileSync(composePath, next);
  writeProjectMeta(crawler.path, {
    ...(readProjectMeta(crawler.path) || {}),
    name: crawler.name,
    country: crawler.country,
    vpnContainerName: crawler.vpnContainerName,
    containerName: crawler.containerName,
    service: crawler.service || 'app',
    tunnel: 'dedicated',
    dockerCrm: !!crmLan,
    useHostWg: !!crawler.useHostWg,
    ollama: getOllamaSettings().enabled,
    upgradedAt: new Date().toISOString(),
  });
  return true;
}

function projectTemplateRoot() {
  return path.join(desktopRoot(), 'templates', 'project');
}

function copyTemplateTree(srcDir, destDir, { replace = {} } = {}) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplateTree(from, to, { replace });
      continue;
    }
    let body = fs.readFileSync(from);
    const isText =
      /\.(py|txt|md|yml|yaml|json|mdc|gitignore|Dockerfile)$/i.test(entry.name) || entry.name === 'Dockerfile';
    if (isText) {
      let text = body.toString('utf8');
      for (const [key, value] of Object.entries(replace)) {
        text = text.split(key).join(value);
      }
      fs.writeFileSync(to, text);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function scaffoldProjectFiles({
  projectDir,
  name,
  country,
  countryName,
  vpnContainerName,
  containerName,
  crawlModel,
  antibotModel,
  workers,
  options = [],
  optionValues = {},
}) {
  ensureDir(projectDir);
  ensureDir(path.join(projectDir, '.cursor', 'rules'));

  const ollama = getOllamaSettings();
  const ollamaEnabled = !!ollama.enabled;
  const crawl = normalizeModelName(crawlModel, DEFAULT_CRAWL_MODEL);
  const antibot = normalizeModelName(antibotModel, DEFAULT_ANTIBOT_MODEL);
  const workerCount = normalizeWorkers(workers, DEFAULT_WORKERS);
  const templateRoot = projectTemplateRoot();
  if (!fs.existsSync(templateRoot)) {
    throw new Error(`Brak szablonu projektu: ${templateRoot}`);
  }

  copyTemplateTree(templateRoot, projectDir, {
    replace: { '{{PROJECT_NAME}}': name },
  });

  fs.writeFileSync(
    path.join(projectDir, 'docker-compose.yml'),
    buildDedicatedCompose({
      countryName,
      vpnContainerName,
      containerName,
    }),
  );

  fs.writeFileSync(
    path.join(projectDir, '.gitignore'),
    ['.venv/', '__pycache__/', '*.py[cod]', '.env', '*.log', '.DS_Store', 'dist/', '.crawl4ai/', ''].join('\n'),
  );

  const agentsLines = [
    `# ${name}`,
    '',
    'Projekt Exitly: **crawl4ai** + antybot Ollama (CaptchaMind).',
    'Start lokalnie: `python -u -m src.main` (po `pip install -r requirements.txt`).',
    'Start/Stop w Exitly = VPN + app. Nie ruszaj `docker-compose.yml`.',
    '',
    'Env (Exitly synchronizuje przy starcie):',
    '- `OLLAMA_BASE_URL` / `OLLAMA_HOST` (globalnie)',
    `- \`OLLAMA_CRAWL_MODEL\` — LLM pod crawl4ai (per projekt: \`${crawl}\`)`,
    `- \`OLLAMA_ANTIBOT_MODEL\` — vision (per projekt: \`${antibot}\`)`,
    `- \`CRAWL_WORKERS\` — workery (per projekt: \`${workerCount}\`)`,
    '- `SERPER_API_KEY` — Serper (globalnie z ustawień Exitly)',
    '',
    'Antybot: `src/antibot_ollama.py` (`try_solve_with_ollama`).',
    'CaptchaMind: https://github.com/AlibabaResearch/captcha-mind',
    'Serper: https://serper.dev',
    '',
  ];
  fs.writeFileSync(path.join(projectDir, 'AGENTS.md'), agentsLines.join('\n'));

  fs.writeFileSync(
    path.join(projectDir, '.cursor', 'rules', 'exitly.mdc'),
    [
      '---',
      'description: Exitly crawl project',
      'alwaysApply: true',
      '---',
      '',
      `# ${name}`,
      '',
      'Stack: crawl4ai + Ollama antibot + Serper.',
      'Models (`OLLAMA_CRAWL_MODEL` / `OLLAMA_ANTIBOT_MODEL`) are per-project.',
      '`CRAWL_WORKERS` is per-project (Exitly card).',
      '`SERPER_API_KEY` comes from Exitly global settings.',
      'Implement crawl in `src/main.py`. Use `src/antibot_ollama.py` for captchas.',
      'Exitly Start/Stop = VPN + app — do not edit `docker-compose.yml`.',
      'CaptchaMind: https://github.com/AlibabaResearch/captcha-mind',
      '',
    ].join('\n'),
  );

  writeProjectMeta(projectDir, {
    name,
    country,
    vpnContainerName,
    containerName,
    service: 'app',
    tunnel: 'dedicated',
    stack: 'crawl4ai',
    ollama: ollamaEnabled,
    crawlModel: crawl,
    antibotModel: antibot,
    workers: workerCount,
    envFields: ENV_PRESETS.crawl4ai,
    options: normalizeStartOptions(options),
    optionValues: normalizeOptionValues(optionValues, options),
    createdAt: new Date().toISOString(),
  });
}

async function createProject(
  {
    name,
    parentDir,
    country,
    exit,
    crawlModel,
    antibotModel,
    workers,
    options = [],
    optionValues = {},
    openCursor = true,
  },
  { onLog } = {},
) {
  const cleanName = String(name || '')
    .trim()
    .slice(0, 60);
  if (!cleanName) throw new Error('Podaj nazwę projektu');
  const parent = path.resolve(String(parentDir || '').trim());
  if (!parent || !fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error('Wybierz istniejący folder nadrzędny');
  }

  const folder = slugifyName(cleanName);
  const projectDir = path.join(parent, folder);
  if (fs.existsSync(projectDir)) {
    throw new Error(`Folder już istnieje: ${projectDir}`);
  }

  const id = newCrawlerId();
  const chosen = resolveProjectCountry(country || exit || readActive(), 'ro');
  const { name: countryName } = resolveCountry(chosen);
  const { vpnContainerName, containerName } = containerNamesForSlug(folder, id);
  const crawl = normalizeModelName(crawlModel, DEFAULT_CRAWL_MODEL);
  const antibot = normalizeModelName(antibotModel, DEFAULT_ANTIBOT_MODEL);
  const workerCount = normalizeWorkers(workers, DEFAULT_WORKERS);
  const startOptions = normalizeStartOptions(options);
  const startValues = normalizeOptionValues(optionValues, startOptions);

  if (onLog) onLog(`Tworzę ${cleanName} → ${projectDir} (${chosen})`);
  scaffoldProjectFiles({
    projectDir,
    name: cleanName,
    country: chosen,
    countryName,
    vpnContainerName,
    containerName,
    crawlModel: crawl,
    antibotModel: antibot,
    workers: workerCount,
    options: startOptions,
    optionValues: startValues,
  });
  syncProjectEnv(projectDir, {
    country: chosen,
    crawlModel: crawl,
    antibotModel: antibot,
    workers: workerCount,
  });

  let crawler;
  try {
    crawler = await addCrawler({
      id,
      kind: 'project',
      name: cleanName,
      path: projectDir,
      country: chosen,
      runMode: 'docker',
      vpnContainerName,
      containerName,
      service: 'app',
      crawlModel: crawl,
      antibotModel: antibot,
      workers: workerCount,
      options: startOptions,
      optionValues: startValues,
    });
  } catch (err) {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort rollback */
    }
    throw err;
  }

  if (openCursor) {
    try {
      await openInCursor(projectDir, { onLog });
    } catch (err) {
      if (onLog) onLog(`Nie udało się otworzyć Cursor: ${err.message || err}`);
    }
  }

  return crawler;
}

function copyProjectTreeFiltered(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (shouldSkipExportEntry(entry.name, entry.isDirectory())) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyProjectTreeFiltered(from, to);
      continue;
    }
    if (entry.isSymbolicLink()) continue;
    fs.copyFileSync(from, to);
  }
}

function looksLikeProjectRoot(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  return !!(
    fs.existsSync(path.join(dir, 'exitly.project.json')) ||
    fs.existsSync(path.join(dir, 'docker-compose.yml')) ||
    detectRunMode(dir)
  );
}

function resolveExtractedProjectRoot(extractDir) {
  if (looksLikeProjectRoot(extractDir)) return extractDir;
  const kids = fs
    .readdirSync(extractDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('__MACOSX') && e.name !== '.DS_Store');
  if (kids.length === 1) {
    const only = path.join(extractDir, kids[0].name);
    if (looksLikeProjectRoot(only)) return only;
  }
  for (const kid of kids) {
    const candidate = path.join(extractDir, kid.name);
    if (looksLikeProjectRoot(candidate)) return candidate;
  }
  throw new Error('W archiwum nie znaleziono projektu Exitly (brak docker-compose / CLI meta)');
}

async function zipDirectory(folderPath, zipPath, { onLog } = {}) {
  ensureDir(path.dirname(zipPath));
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const parent = path.dirname(folderPath);
  const base = path.basename(folderPath);
  if (process.platform === 'win32') {
    const ps = `Compress-Archive -LiteralPath ${powershellQuote(
      folderPath,
    )} -DestinationPath ${powershellQuote(zipPath)} -Force`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { onLog });
  } else {
    await run('zip', ['-r', '-q', zipPath, base], { cwd: parent, onLog });
  }
  if (!fs.existsSync(zipPath)) {
    throw new Error('Nie udało się utworzyć archiwum ZIP');
  }
}

async function unzipArchive(zipPath, destDir, { onLog } = {}) {
  ensureDir(destDir);
  if (process.platform === 'win32') {
    const ps = `Expand-Archive -LiteralPath ${powershellQuote(
      zipPath,
    )} -DestinationPath ${powershellQuote(destDir)} -Force`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { onLog });
  } else {
    await run('unzip', ['-q', '-o', zipPath, '-d', destDir], { onLog });
  }
}

async function exportProject(id, destZipPath, { onLog } = {}) {
  const crawler = findCrawler(id);
  if (crawler.kind !== 'project') throw new Error('Eksport tylko dla projektów');
  const src = path.resolve(crawler.path || '');
  if (!src || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    throw new Error(`Brak folderu projektu: ${src}`);
  }

  const zipPath = path.resolve(String(destZipPath || '').trim());
  if (!zipPath || !zipPath.toLowerCase().endsWith('.zip')) {
    throw new Error('Podaj ścieżkę pliku .zip');
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'exitly-export-'));
  const packName = slugifyName(crawler.name || path.basename(src));
  const staged = path.join(tmpRoot, packName);
  try {
    if (onLog) onLog(`Pakuję ${crawler.name} → ${zipPath}`);
    copyProjectTreeFiltered(src, staged);
    await zipDirectory(staged, zipPath, { onLog });
    if (onLog) onLog(`Wyeksportowano: ${zipPath}`);
    return { ok: true, path: zipPath, name: crawler.name };
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function importProject(
  { zipPath, parentDir, name, country, openCursor = false },
  { onLog } = {},
) {
  const archive = path.resolve(String(zipPath || '').trim());
  if (!archive || !fs.existsSync(archive) || !fs.statSync(archive).isFile()) {
    throw new Error('Wybierz plik ZIP projektu');
  }
  if (!/\.zip$/i.test(archive)) {
    throw new Error('Import obsługuje tylko pliki .zip');
  }
  const parent = path.resolve(String(parentDir || '').trim());
  if (!parent || !fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error('Wybierz folder docelowy');
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'exitly-import-'));
  try {
    if (onLog) onLog(`Rozpakowuję ${path.basename(archive)}`);
    await unzipArchive(archive, tmpRoot, { onLog });
    const extractedRoot = resolveExtractedProjectRoot(tmpRoot);
    const meta = readProjectMeta(extractedRoot);
    const preferred =
      String(name || meta?.name || path.basename(extractedRoot, path.extname(extractedRoot)))
        .trim()
        .slice(0, 60) || 'project';
    const projectDir = uniqueProjectDir(parent, preferred);
    ensureDir(path.dirname(projectDir));
    if (extractedRoot === tmpRoot) {
      copyProjectTreeFiltered(extractedRoot, projectDir);
    } else {
      fs.renameSync(extractedRoot, projectDir);
    }
    if (onLog) onLog(`Import → ${projectDir}`);

    const crawler = await registerProject(
      {
        projectPath: projectDir,
        name: preferred,
        country: country || meta?.country,
        rewriteContainers: true,
      },
      { onLog },
    );

    if (openCursor) {
      try {
        await openInCursor(projectDir, { onLog });
      } catch (err) {
        if (onLog) onLog(`Nie udało się otworzyć Cursor: ${err.message || err}`);
      }
    }
    return crawler;
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function duplicateProject(
  { id, name, folderName, parentDir, openCursor = false },
  { onLog } = {},
) {
  const source = findCrawler(id);
  if (!source || source.kind !== 'project') {
    throw new Error('Duplikacja tylko dla projektów');
  }
  const srcPath = path.resolve(source.path || '');
  if (!srcPath || !fs.existsSync(srcPath) || !fs.statSync(srcPath).isDirectory()) {
    throw new Error(`Brak folderu projektu: ${srcPath}`);
  }

  const { cleanName, folder, projectDir } = resolveTargetProjectDir({
    name,
    folderName,
    parentDir,
    sourcePath: srcPath,
  });
  if (fs.existsSync(projectDir)) {
    throw new Error(`Folder już istnieje: ${projectDir}`);
  }
  if (path.resolve(projectDir) === srcPath) {
    throw new Error('Folder docelowy nie może być taki sam jak źródło');
  }

  if (onLog) {
    onLog(`Duplikuję ${source.name} → ${cleanName} (${projectDir})`);
  }
  copyProjectTreeFiltered(srcPath, projectDir);

  try {
    const crawler = await registerProject(
      {
        projectPath: projectDir,
        name: cleanName,
        folderSlug: folder,
        country: source.country || source.exit,
        crawlModel: source.crawlModel,
        antibotModel: source.antibotModel,
        workers: source.workers,
        rewriteContainers: true,
      },
      { onLog },
    );

    if (openCursor) {
      try {
        await openInCursor(projectDir, { onLog });
      } catch (err) {
        if (onLog) onLog(`Nie udało się otworzyć Cursor: ${err.message || err}`);
      }
    }
    return crawler;
  } catch (err) {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort rollback */
    }
    throw err;
  }
}

async function registerProject(
  { projectPath, name, country, exit, crawlModel, antibotModel, workers, folderSlug, rewriteContainers = false },
  { onLog } = {},
) {
  const dir = path.resolve(String(projectPath || '').trim());
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('Wybierz folder projektu');
  }

  const runMode = detectRunMode(dir);
  if (!runMode) {
    throw new Error('Brak docker-compose.yml ani CLI (exitly.project.json / pyproject scripts / package.json)');
  }

  const folderName = path.basename(dir);
  const meta = readProjectMeta(dir);
  const cleanName = String(name || meta?.name || folderName)
    .trim()
    .slice(0, 60);
  if (!cleanName) throw new Error('Podaj nazwę projektu');

  const id = newCrawlerId();
  const chosen = resolveProjectCountry(country || exit || meta?.country || readActive(), 'ro');
  const slug = slugifyName(folderSlug || folderName || cleanName);
  const { vpnContainerName, containerName } = containerNamesForSlug(slug, id);

  if (runMode === 'cli') {
    const cli = detectCliSpec(dir);
    if (!cli) {
      throw new Error('Nie wykryto komendy CLI — dodaj cli.command w exitly.project.json');
    }
    if (onLog) {
      onLog(`Dodaję CLI ${cleanName} → ${cli.command} (${chosen})`);
    }
    ensureProjectEnvScaffold(dir, { onLog });
    const envFields = resolveProjectEnvFields(dir, {
      runMode: 'cli',
      stack: meta?.stack || 'opencode+mcp',
    });
    const relativeCmd = path.isAbsolute(cli.command)
      ? (() => {
          const rel = path.relative(dir, cli.command);
          return rel && !rel.startsWith('..') ? rel : cli.command;
        })()
      : cli.command;
    const useHostWg = meta?.useHostWg === true;
    const nextMeta = {
      ...(meta || {}),
      name: cleanName,
      country: chosen,
      runMode: 'cli',
      stack: meta?.stack || 'opencode+mcp',
      useHostWg,
      cli: (meta && meta.cli) || {
        command: relativeCmd,
        args: cli.args,
        terminal: cli.terminal !== false,
        activateVenv: !!cli.activateVenv,
      },
      envFields: Array.isArray(meta?.envFields) && meta.envFields.length ? meta.envFields : envFields,
      updatedAt: new Date().toISOString(),
    };
    writeProjectMeta(dir, nextMeta);
    syncCliCountryIntoProjectEnv(dir, chosen);
    return addCrawler({
      id,
      kind: 'project',
      name: cleanName,
      path: dir,
      country: chosen,
      runMode: 'cli',
      cliCommand:
        path.isAbsolute(cli.command) || cli.command.includes('/') || cli.command.includes('\\')
          ? path.isAbsolute(cli.command)
            ? cli.command
            : path.join(dir, cli.command)
          : cli.command,
      cliArgs: cli.args,
      cliTerminal: cli.terminal !== false,
      useHostWg,
      vpnContainerName,
      containerName,
      service: 'app',
    });
  }

  const compose = path.join(dir, 'docker-compose.yml');
  if (!fs.existsSync(compose)) {
    throw new Error('Brak docker-compose.yml w tym folderze');
  }

  const body = fs.readFileSync(compose, 'utf8');
  const namedApp = body.match(/container_name:\s*["']?(exitly-proj-[a-zA-Z0-9_.-]+)["']?/);
  const namedVpn = body.match(/container_name:\s*["']?(exitly-vpn-[a-zA-Z0-9_.-]+)["']?/);
  const resolvedContainer = rewriteContainers
    ? containerName
    : (namedApp && namedApp[1]) || containerName;
  const resolvedVpn = rewriteContainers
    ? vpnContainerName
    : (namedVpn && namedVpn[1]) || vpnContainerName;

  const crawlerDraft = normalizeCrawler({
    id,
    kind: 'project',
    name: cleanName,
    path: dir,
    country: chosen,
    runMode: 'docker',
    vpnContainerName: resolvedVpn,
    containerName: resolvedContainer,
    service: 'app',
    crawlModel: crawlModel || meta?.crawlModel,
    antibotModel: antibotModel || meta?.antibotModel,
    workers: workers ?? meta?.workers,
    useHostWg: meta?.useHostWg === true,
  });

  if (onLog) onLog(`Dodaję projekt ${cleanName} (${chosen})`);
  if (rewriteContainers) {
    const { name: countryName } = resolveCountry(chosen);
    fs.writeFileSync(
      compose,
      buildDedicatedCompose({
        countryName,
        vpnContainerName: resolvedVpn,
        containerName: resolvedContainer,
      }),
    );
    writeProjectMeta(dir, {
      ...(meta || {}),
      name: cleanName,
      country: chosen,
      vpnContainerName: resolvedVpn,
      containerName: resolvedContainer,
      service: 'app',
      tunnel: 'dedicated',
      crawlModel: crawlerDraft.crawlModel,
      antibotModel: crawlerDraft.antibotModel,
      workers: crawlerDraft.workers,
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } else {
    ensureDedicatedTunnelCompose(crawlerDraft);
  }
  syncProjectEnv(dir, {
    country: chosen,
    crawlModel: crawlerDraft.crawlModel,
    antibotModel: crawlerDraft.antibotModel,
    workers: crawlerDraft.workers,
  });
  writeProjectWorkersCompose(projectComposeFile(crawlerDraft), crawlerDraft.workers);

  return addCrawler(crawlerDraft);
}

async function openInCursor(projectPath, { onLog } = {}) {
  const target = path.resolve(projectPath);
  if (!fs.existsSync(target)) throw new Error(`Missing path: ${target}`);

  const tryCmds = [
    ['cursor', [target]],
    ['cursor', ['-n', target]],
  ];
  if (process.platform === 'darwin') {
    tryCmds.push(['open', ['-a', 'Cursor', target]]);
  } else if (process.platform === 'win32') {
    tryCmds.push(['cmd', ['/c', 'start', '', 'cursor', target]]);
  }

  let lastErr = null;
  for (const [cmd, args] of tryCmds) {
    try {
      await run(cmd, args, { cwd: target, onLog });
      if (onLog) onLog(`Otwarto w Cursorze: ${target}`);
      return true;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Nie znaleziono Cursor CLI');
}

async function setCrawlerExit(id, exitOrCountry, { onLog } = {}) {
  const list = readCrawlers();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error(`Not found: ${id}`);
  const crawler = list[idx];

  if (crawler.kind !== 'project') {
    const exitIds = new Set(CRAWLER_EXITS.map((e) => e.id));
    if (!exitIds.has(exitOrCountry)) {
      throw new Error(`Unknown exit: ${exitOrCountry}`);
    }
    const wasRunning = (await containerState(crawler.containerName)).running;
    if (wasRunning || (await containerState(crawler.containerName)).exists) {
      try {
        await run('docker', ['rm', '-f', crawler.containerName], { onLog });
      } catch {
        /* ignore */
      }
    }
    crawler.exit = exitOrCountry;
    list[idx] = crawler;
    writeCrawlers(list);
    if (wasRunning) await startCrawler(id, { onLog });
    return findCrawler(id);
  }

  const country = resolveProjectCountry(exitOrCountry, crawler.country);
  if (crawler.country === country) {
    if (crawler.runMode === 'cli' && fs.existsSync(crawler.path)) {
      syncCliCountryIntoProjectEnv(crawler.path, country);
      await ensureCliVpnTunnel(crawler, { country, recreate: false, onLog });
      if (onLog) onLog(`${crawler.name}: VPN CLI ${String(country).toUpperCase()}`);
    }
    return findCrawler(id);
  }

  if (crawler.runMode === 'cli') {
    const meta = readProjectMeta(crawler.path) || {};
    writeProjectMeta(crawler.path, {
      ...meta,
      name: crawler.name,
      country,
      runMode: 'cli',
      useHostWg: meta.useHostWg === true || crawler.useHostWg === true,
      cli: meta.cli || {
        command: crawler.cliCommand,
        args: crawler.cliArgs,
        terminal: crawler.cliTerminal !== false,
      },
      updatedAt: new Date().toISOString(),
    });
    crawler.country = country;
    list[idx] = crawler;
    writeCrawlers(list);
    if (fs.existsSync(crawler.path)) {
      syncCliCountryIntoProjectEnv(crawler.path, country);
    }
    await ensureCliVpnTunnel(crawler, { country, recreate: true, onLog });
    if (onLog) onLog(`${crawler.name} → ${String(country).toUpperCase()} (CLI VPN)`);
    return findCrawler(id);
  }

  const { name: countryName } = resolveCountry(country);
  const wasRunning =
    (await containerState(crawler.containerName)).running || (await containerState(crawler.vpnContainerName)).running;

  ensureDedicatedTunnelCompose(crawler);
  writeProjectServerCountry(projectComposeFile(crawler), countryName);
  syncProjectEnv(crawler.path, {
    country,
    crawlModel: crawler.crawlModel,
    antibotModel: crawler.antibotModel,
    workers: crawler.workers,
  });
  writeProjectWorkersCompose(projectComposeFile(crawler), crawler.workers);
  writeProjectMeta(crawler.path, {
    name: crawler.name,
    country,
    vpnContainerName: crawler.vpnContainerName,
    containerName: crawler.containerName,
    service: crawler.service || 'app',
    tunnel: 'dedicated',
    crawlModel: crawler.crawlModel,
    antibotModel: crawler.antibotModel,
    workers: crawler.workers,
    updatedAt: new Date().toISOString(),
  });

  crawler.country = country;
  crawler.exit = crawler.vpnContainerName;
  list[idx] = crawler;
  writeCrawlers(list);
  if (onLog) onLog(`${crawler.name} → ${String(country).toUpperCase()}`);

  if (wasRunning) {
    await startCrawler(id, { onLog });
  }
  return findCrawler(id);
}

async function setProjectModels(
  id,
  { crawlModel, antibotModel, workers } = {},
  { onLog } = {},
) {
  const list = readCrawlers();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error(`Not found: ${id}`);
  const crawler = list[idx];
  if (crawler.kind !== 'project') {
    throw new Error('Modele tylko dla projektów');
  }

  const crawl = normalizeModelName(crawlModel, crawler.crawlModel || DEFAULT_CRAWL_MODEL);
  const antibot = normalizeModelName(
    antibotModel,
    crawler.antibotModel || DEFAULT_ANTIBOT_MODEL,
  );
  const workerCount = normalizeWorkers(
    workers != null ? workers : crawler.workers,
    crawler.workers || DEFAULT_WORKERS,
  );

  const sameModels =
    crawler.crawlModel === crawl &&
    crawler.antibotModel === antibot &&
    (crawler.runMode === 'cli' || crawler.workers === workerCount);
  if (sameModels) {
    return findCrawler(id);
  }

  crawler.crawlModel = crawl;
  crawler.antibotModel = antibot;
  if (crawler.runMode !== 'cli') {
    crawler.workers = workerCount;
  }
  list[idx] = crawler;
  writeCrawlers(list);

  if (fs.existsSync(crawler.path)) {
    const meta = readProjectMeta(crawler.path) || {};
    if (crawler.runMode === 'cli') {
      upsertDotEnvFile(path.join(crawler.path, '.env'), {
        OLLAMA_MODEL: crawl,
        OLLAMA_CRAWL_MODEL: crawl,
        OLLAMA_ANTIBOT_MODEL: antibot,
        FURNILEAD_CRAWL_CAPTCHAMIND_MODEL: antibot,
      });
      writeProjectMeta(crawler.path, {
        ...meta,
        name: crawler.name,
        crawlModel: crawl,
        antibotModel: antibot,
        updatedAt: new Date().toISOString(),
      });
    } else {
      syncProjectEnv(crawler.path, {
        country: crawler.country,
        crawlModel: crawl,
        antibotModel: antibot,
        workers: workerCount,
      });
      writeProjectWorkersCompose(projectComposeFile(crawler), workerCount);
      writeProjectMeta(crawler.path, {
        ...meta,
        name: crawler.name,
        country: crawler.country,
        vpnContainerName: crawler.vpnContainerName,
        containerName: crawler.containerName,
        service: crawler.service || 'app',
        tunnel: 'dedicated',
        stack: meta.stack || 'crawl4ai',
        crawlModel: crawl,
        antibotModel: antibot,
        workers: workerCount,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (onLog) {
    onLog(
      `${crawler.name}: ollama=${crawl} · captcha=${antibot}${
        crawler.runMode === 'cli' ? '' : ` · workers=${workerCount}`
      }`,
    );
  }
  return findCrawler(id);
}

async function setProjectStartOptions(id, { options, optionValues } = {}, { onLog } = {}) {
  const list = readCrawlers();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error(`Not found: ${id}`);
  const crawler = list[idx];
  if (crawler.kind !== 'project') throw new Error('Opcje tylko dla projektów');

  const nextOptions =
    options != null ? normalizeStartOptions(options) : resolveProjectStartOptions(crawler.path, crawler);
  const nextValues = normalizeOptionValues(optionValues != null ? optionValues : crawler.optionValues, nextOptions);

  crawler.options = nextOptions;
  crawler.optionValues = nextValues;
  list[idx] = crawler;
  writeCrawlers(list);

  if (fs.existsSync(crawler.path)) {
    const meta = readProjectMeta(crawler.path) || {};
    writeProjectMeta(crawler.path, {
      ...meta,
      name: crawler.name,
      options: nextOptions,
      optionValues: nextValues,
      updatedAt: new Date().toISOString(),
    });
  }
  if (onLog) onLog(`${crawler.name}: zapisano ${nextOptions.length} opcji startu`);
  return findCrawler(id);
}

async function setProjectUseHostWg(id, enabled, { onLog } = {}) {
  const list = readCrawlers();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error(`Not found: ${id}`);
  const crawler = list[idx];
  if (crawler.kind !== 'project') {
    throw new Error('Host WG tylko dla projektów');
  }
  const on = !!enabled;
  if (on) {
    const hg = getHostWgSettings();
    if (!hg.configured) {
      throw new Error(
        'Brak configu WireGuard w Ustawieniach — wklej conf (CRM LAN) i zapisz'
      );
    }
  }
  crawler.useHostWg = on;
  list[idx] = crawler;
  writeCrawlers(list);
  if (fs.existsSync(crawler.path)) {
    const meta = readProjectMeta(crawler.path) || {};
    writeProjectMeta(crawler.path, {
      ...meta,
      useHostWg: on,
      updatedAt: new Date().toISOString(),
    });
    ensureProjectEnvScaffold(crawler.path);
    applyHostWgToProjectEnv(crawler.path, on, { runMode: crawler.runMode });
    if (crawler.runMode === 'docker') {
      ensureDedicatedTunnelCompose(crawler);
    }
  }
  if (on) {
    await ensureProjectCrmAccess(crawler, { onLog, requireMcp: crawler.runMode === 'cli' });
  }
  if (onLog) {
    onLog(
      crawler.runMode === 'docker'
        ? `${crawler.name}: CRM LAN w Dockerze ${on ? 'WŁĄCZONE (crm-lan + Proton)' : 'wyłączone'}`
        : `${crawler.name}: CRM (Exitly) ${on ? 'WŁĄCZONE — apka trzyma tunel LAN' : 'wyłączone'}`,
    );
  }
  return findCrawler(id);
}

async function startCrawler(id, { onLog, onCliLine, optionValues } = {}) {
  const crawler = findCrawler(id);

  if (crawler.kind === 'project' && crawler.runMode === 'cli') {
    if (!fs.existsSync(crawler.path)) {
      throw new Error(`Brak folderu projektu: ${crawler.path}`);
    }
    // Terminal: pozwól odpalić OpenCode ponownie (sesja „running” nie blokuje)
    if (isCliSessionRunning(id)) {
      const session = cliSessions.get(id);
      if (session?.mode !== 'terminal') {
        if (onLog) onLog(`${crawler.name} już uruchomione`);
        return crawler;
      }
      if (onLog) onLog(`${crawler.name}: ponawiam Terminal / OpenCode…`);
    }
    ensureProjectEnvScaffold(crawler.path, { onLog });
    const ollamaEnv = {
      ...syncHubGlobalsIntoProjectEnv(crawler.path, { hostOllama: true }),
      ...buildCliOllamaProcessEnv(),
    };

    let tunnelEnv = syncCliCountryIntoProjectEnv(
      crawler.path,
      crawler.country || readActive(),
    );
    let stack = null;
    try {
      // Nie zabijaj zdrowego stacka przy każdym Uruchom — Codex traci :19360.
      stack = await ensureCliVpnTunnel(crawler, {
        country: crawler.country,
        recreate: false,
        waitReady: false,
        onLog,
      });
      tunnelEnv =
        stack.tunnelEnv ||
        buildCliTunnelProcessEnv(stack, crawler.path, {
          useHostWg: !!crawler.useHostWg,
        });
      if (onLog) {
        onLog(
          `CLI → crawl Proton ${String(stack.code || crawler.country || '').toUpperCase()} · ${stack.proxy}` +
            (crawler.useHostWg ? ' · CRM Docker crm0' : ''),
        );
      }
      // W tle dociągnij IP (nie blokuje Terminala)
      waitCliVpnReady(stack.vpnContainerName, { onLog, attempts: 20 }).catch((err) => {
        if (onLog) onLog(`VPN (tło): ${err.message || err}`);
      });
    } catch (err) {
      if (onLog) {
        onLog(
          `Tunel VPN niedostępny — OpenCode i tak startuje (${err.message || err})`,
        );
      }
    }

    const wgEnv = applyHostWgToProjectEnv(crawler.path, !!crawler.useHostWg, {
      runMode: 'cli',
    });
    if (crawler.useHostWg) {
      const hg = getHostWgSettings();
      if (!hg.configured) {
        throw new Error(
          'Projekt wymaga CRM LAN — wklej config w Ustawieniach Exitly',
        );
      }
      if (onLog) onLog(`CRM LAN: Docker crm0 ← ${hg.confPath}`);
      await ensureProjectCrmAccess(crawler, { onLog, requireMcp: true });
    }

    const options = resolveProjectStartOptions(crawler.path, crawler);
    const applied = applyStartOptions(
      options,
      optionValues != null ? optionValues : resolveProjectOptionValues(crawler.path, crawler),
    );
    if (applied.missing.length) {
      throw new Error(`Uzupełnij opcje: ${applied.missing.join(', ')}`);
    }
    // wgEnv po tunnelEnv — FURNILEAD_WG_* / conf z host WG wygrywają gdy useHostWg
    Object.assign(applied.env, tunnelEnv, wgEnv, ollamaEnv);
    if (crawler.useHostWg && onLog) {
      onLog('CRM → Docker crm0 (localhost MCP); crawl → Proton Docker');
    }
    if (ollamaEnv.OLLAMA_HOST && onLog) {
      onLog(`Ollama (lokalnie): ${ollamaEnv.OLLAMA_HOST}`);
    }
    if (options.length) {
      await setProjectStartOptions(id, { optionValues: applied.values }, { onLog: null });
    }
    if (Object.keys(applied.env).length) {
      upsertDotEnvFile(path.join(crawler.path, '.env'), applied.env);
    }

    const cli = resolveCliSpec(crawler);
    if (!cli.command) {
      throw new Error('Brak komendy CLI (opencode) — sprawdź exitly.project.json');
    }
    cli.args = [...(cli.args || []), ...applied.args];

    if (onLog) {
      onLog(
        `Uruchamiam CLI ${crawler.name}: ${cli.command}${
          cli.args.length ? ` ${cli.args.join(' ')}` : ''
        }`,
      );
    }
    if (cli.terminal !== false) {
      await openCliInSystemTerminal(crawler.path, cli, {
        onLog,
        extraEnv: applied.env,
      });
      cliSessions.set(id, { mode: 'terminal', startedAt: Date.now() });
      appendCliLog(
        id,
        `(Terminal OpenCode${stack?.proxy ? ` · tunel ${stack.proxy}` : ''})`,
      );
      if (onLog) onLog(`${crawler.name}: OpenCode w Terminalu`);
      return findCrawler(id);
    }
    startCliBackgroundProcess(id, crawler.path, cli, {
      onLog,
      onLine: onCliLine,
      extraEnv: applied.env,
    });
    if (onLog) onLog(`${crawler.name}: CLI w tle`);
    return findCrawler(id);
  }

  if (crawler.kind === 'project') {
    if (envNeedsSetup()) {
      throw new Error('Brak klucza WireGuard — dokończ konfigurację');
    }
    if (!fs.existsSync(crawler.path)) {
      throw new Error(`Brak folderu projektu: ${crawler.path}`);
    }

    const options = resolveProjectStartOptions(crawler.path, crawler);
    const applied = applyStartOptions(
      options,
      optionValues != null ? optionValues : resolveProjectOptionValues(crawler.path, crawler),
    );
    if (applied.missing.length) {
      throw new Error(`Uzupełnij opcje: ${applied.missing.join(', ')}`);
    }
    if (options.length) {
      await setProjectStartOptions(id, { optionValues: applied.values }, { onLog: null });
    }

    if (onLog) {
      onLog(
        crawler.useHostWg
          ? `Uruchamiam ${crawler.name}: Proton VPN (crawl) + CRM LAN (Docker)…`
          : `Uruchamiam ${crawler.name}: VPN + app (${String(crawler.country).toUpperCase()})…`,
      );
    }
    ensureDedicatedTunnelCompose(crawler);
    syncProjectEnv(crawler.path, {
      country: crawler.country,
      crawlModel: crawler.crawlModel,
      antibotModel: crawler.antibotModel,
      workers: crawler.workers,
    });
    const wgEnv = applyHostWgToProjectEnv(crawler.path, !!crawler.useHostWg, {
      runMode: 'docker',
    });
    if (crawler.useHostWg) {
      const hg = getHostWgSettings();
      if (!hg.configured) {
        throw new Error(
          'Projekt wymaga CRM LAN — wklej config w Ustawieniach Exitly',
        );
      }
      if (onLog) {
        onLog(`Docker: Proton + crm0 (jak Orb) ← ${hg.confPath}`);
      }
      // Jedna netns z Proton — crawl bez HTTP_PROXY
      Object.assign(wgEnv, {
        EXITLY_HTTP_PROXY: '',
        FURNILEAD_CRAWL_PROXY: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
      });
    }
    Object.assign(applied.env, wgEnv);
    writeProjectWorkersCompose(projectComposeFile(crawler), crawler.workers);
    if (Object.keys(applied.env).length) {
      upsertDotEnvFile(path.join(crawler.path, '.env'), applied.env);
    }
    await projectCompose(crawler, ['up', '-d', '--build', '--remove-orphans'], {
      onLog,
    });
    if (onLog) {
      onLog(
        crawler.useHostWg
          ? `${crawler.name}: vpn + crm-lan + app włączone`
          : `${crawler.name}: VPN i aplikacja włączone`,
      );
    }
    return findCrawler(id);
  }

  if (!(await containerRunning(crawler.exit))) {
    throw new Error(`VPN „${crawler.exit}” nie działa — najpierw włącz VPN w Ustawieniach`);
  }

  const state = await containerState(crawler.containerName);
  if (state.running) {
    if (onLog) onLog(`${crawler.name} już działa`);
    return crawler;
  }
  if (state.exists) {
    if (onLog) onLog(`Uruchamiam ${crawler.name}…`);
    await run('docker', ['start', crawler.containerName], { onLog });
    return crawler;
  }
  const args = [
    'run',
    '-d',
    '--name',
    crawler.containerName,
    `--network=container:${crawler.exit}`,
    '--restart',
    'unless-stopped',
    crawler.image,
    ...parseCommand(crawler.command),
  ];
  if (onLog) onLog(`Tworzę ${crawler.name} → ${crawler.exit}…`);
  await run('docker', args, { onLog });
  return crawler;
}

async function stopCrawler(id, { onLog } = {}) {
  const crawler = findCrawler(id);

  if (crawler.kind === 'project' && crawler.runMode === 'cli') {
    if (onLog) onLog(`Zatrzymuję CLI ${crawler.name}…`);
    await stopCliSession(id, { onLog });
    await stopCliVpnTunnel(crawler, { onLog });
    if (onLog) onLog(`${crawler.name}: CLI + Docker VPN wyłączone`);
    return crawler;
  }

  if (crawler.kind === 'project') {
    if (onLog) onLog(`Zatrzymuję ${crawler.name}…`);
    try {
      await projectCompose(crawler, ['down', '--remove-orphans'], { onLog });
    } catch {
      try {
        await run('docker', ['rm', '-f', crawler.containerName, crawler.vpnContainerName], { onLog });
      } catch {
        /* ignore */
      }
    }
    return crawler;
  }

  const state = await containerState(crawler.containerName);
  if (!state.exists) {
    if (onLog) onLog(`${crawler.name} już wyłączony`);
    return crawler;
  }
  if (onLog) onLog(`Zatrzymuję ${crawler.name}…`);
  try {
    await run('docker', ['stop', crawler.containerName], { onLog });
  } catch {
    await run('docker', ['rm', '-f', crawler.containerName], { onLog });
  }
  return crawler;
}

function composeFile() {
  ensureWorkspace();
  return path.join(getHubRoot(), "docker-compose.yml");
}

/** Well-known app ports published on the VPN hub container */
const ENDPOINT_PRESETS = [
  {
    id: "ollama",
    label: "Ollama",
    port: 11434,
    hint: "Local LLM API at http://127.0.0.1:11434",
  },
];

function normalizeEndpoints(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const port = Number(item && item.port != null ? item.port : item);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${item && item.port != null ? item.port : item}`);
    }
    if (port === 8888) {
      throw new Error("Port 8888 is reserved for the HTTP proxy");
    }
    if (seen.has(port)) continue;
    seen.add(port);
    const label =
      item && typeof item.label === "string" && item.label.trim()
        ? item.label.trim().slice(0, 40)
        : ENDPOINT_PRESETS.find((p) => p.port === port)?.label || `Port ${port}`;
    out.push({ port, label });
  }
  out.sort((a, b) => a.port - b.port);
  return out;
}

function readEndpoints() {
  const file = endpointsPath();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeEndpoints(raw);
  } catch {
    return [];
  }
}

function writeEndpoints(list) {
  const ports = normalizeEndpoints(list);
  fs.writeFileSync(endpointsPath(), `${JSON.stringify(ports, null, 2)}\n`, {
    mode: 0o600,
  });
  return ports;
}

/**
 * Publish app ports on proton-vpn (required when using network_mode: container:…).
 * Written as docker-compose.override.yml so the shipped compose stays untouched.
 */
function writeOverrideFile(root, ports) {
  const dest = path.join(root, "docker-compose.override.yml");
  if (!ports.length) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    return;
  }
  const portLines = ports
    .map((p) => `      - "${p.port}:${p.port}/tcp"  # ${p.label}`)
    .join("\n");
  const firewall = ports.map((p) => p.port).join(",");
  const body = [
    "# Generated by Exitly — published app endpoints on the VPN hub.",
    "# Apps that use network_mode: \"container:proton-vpn\" expose ports here,",
    "# not on their own service (Docker limitation).",
    "",
    "services:",
    "  vpn:",
    "    ports:",
    portLines,
    "    environment:",
    `      FIREWALL_INPUT_PORTS: "${firewall}"`,
    "",
  ].join("\n");
  fs.writeFileSync(dest, body, { mode: 0o600 });
}

function syncOverrideCompose(list) {
  const root = getHubRoot();
  ensureDir(root);
  const ports = normalizeEndpoints(list == null ? readEndpoints() : list);
  writeOverrideFile(root, ports);
  return ports;
}

function ollamaSnippet(endpoints) {
  const hasOllama = (endpoints || []).some((e) => e.port === 11434);
  return [
    "# 1) In Exitly → Endpoints, add Ollama (publishes 11434 on proton-vpn)",
    hasOllama
      ? "#    ✓ Port 11434 is already published"
      : "#    (Connect / reconnect after adding so Docker picks up the port)",
    "# 2) Run Ollama sharing the hub network:",
    "",
    "services:",
    "  ollama:",
    "    image: ollama/ollama",
    '    network_mode: "container:proton-vpn"',
    "    volumes:",
    "      - ollama:/root/.ollama",
    "",
    "volumes:",
    "  ollama:",
    "",
    "# Then: curl http://127.0.0.1:11434/api/tags",
    "# Clients (Open WebUI, Continue, etc.): base URL http://127.0.0.1:11434",
  ].join("\n");
}

async function setEndpoints(list, { recreate = true, onLog } = {}) {
  const ports = writeEndpoints(list);
  syncOverrideCompose(ports);
  if (onLog) {
    onLog(
      ports.length
        ? `Endpoints: ${ports.map((p) => `${p.label}:${p.port}`).join(", ")}`
        : "Endpoints cleared"
    );
  }
  if (recreate && (await containerRunning("proton-vpn"))) {
    if (envNeedsSetup()) {
      throw new Error("WireGuard key missing — complete setup first");
    }
    const code = readActive();
    const { name } = resolveCountry(code);
    if (onLog) onLog("Recreating proton-vpn to apply published ports…");
    await dockerCompose(["up", "-d", "--force-recreate", "--remove-orphans", "vpn"], {
      env: { SERVER_COUNTRIES: name },
      onLog,
    });
  }
  return ports;
}

function readCountries() {
  const file = countriesPath();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return {
        code: l.slice(0, i).trim().toLowerCase(),
        name: l.slice(i + 1).trim(),
      };
    });
}

function resolveCountry(code) {
  const c = String(code || "")
    .trim()
    .toLowerCase();
  const hit = readCountries().find((x) => x.code === c);
  if (!hit) throw new Error(`Unknown country '${code}'`);
  return hit;
}

function envNeedsSetup() {
  const p = envPath();
  if (!fs.existsSync(p)) return true;
  const text = fs.readFileSync(p, "utf8");
  if (/PASTE_PRIVATE_KEY_HERE/.test(text)) return true;
  const m = text.match(/^WIREGUARD_PRIVATE_KEY=(.*)$/m);
  if (!m || !m[1].trim()) return true;
  return false;
}

function upsertEnv(key, value) {
  const p = envPath();
  let body = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, "m").test(body)) {
    body = body.replace(new RegExp(`^${key}=.*$`, "m"), line);
  } else {
    body = `${body.replace(/\s*$/, "")}\n${line}\n`;
  }
  fs.writeFileSync(p, body, { mode: 0o600 });
}

function setupEnv(privateKey) {
  if (!privateKey || privateKey.length < 20) {
    throw new Error("Private key looks too short");
  }
  ensureWorkspace();
  const example = path.join(getHubRoot(), ".env.example");
  const dest = envPath();
  if (!fs.existsSync(dest) && fs.existsSync(example)) {
    fs.copyFileSync(example, dest);
  }
  upsertEnv("WIREGUARD_PRIVATE_KEY", privateKey);
  return { ok: true, path: dest };
}

function readActive() {
  const af = activePath();
  if (fs.existsSync(af)) {
    return fs.readFileSync(af, "utf8").trim().toLowerCase();
  }
  const env = envPath();
  if (fs.existsSync(env)) {
    const m = fs.readFileSync(env, "utf8").match(/^ACTIVE_COUNTRY=(.*)$/m);
    if (m) return m[1].trim().toLowerCase();
  }
  return "ro";
}

function writeActive(code, name) {
  fs.writeFileSync(activePath(), `${code}\n`);
  upsertEnv("ACTIVE_COUNTRY", code);
  upsertEnv("SERVER_COUNTRIES", name);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || getHubRoot(),
      env: { ...process.env, ...(opts.env || {}) },
      shell: false,
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (opts.onLog) {
        d.toString()
          .split(/\r?\n/)
          .filter(Boolean)
          .forEach((line) => opts.onLog(line));
      }
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (opts.onLog) {
        d.toString()
          .split(/\r?\n/)
          .filter(Boolean)
          .forEach((line) => opts.onLog(line));
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error((err || out || `exit ${code}`).trim()));
    });
  });
}

async function dockerCompose(args, opts = {}) {
  ensureWorkspace();
  const file = composeFile();
  return run(
    "docker",
    ["compose", "-f", file, "--project-directory", getHubRoot(), ...args],
    opts
  );
}

async function containerRunning(name) {
  try {
    const out = await run("docker", ["inspect", "-f", "{{.State.Running}}", name], {
      cwd: getHubRoot(),
    });
    return out.trim() === "true";
  } catch {
    return false;
  }
}

async function vpnUse(country, onLog) {
  if (envNeedsSetup()) {
    throw new Error("WireGuard key missing — complete setup first");
  }
  const { code, name } = resolveCountry(country);
  writeActive(code, name);
  if (onLog) onLog(`Active country: ${code} (${name})`);
  await dockerCompose(
    ["up", "-d", "--force-recreate", "--remove-orphans", "vpn"],
    {
      env: { SERVER_COUNTRIES: name },
      onLog,
    }
  );
  return `proton-vpn → ${code}`;
}

async function vpnDown(targets, onLog) {
  const list = Array.isArray(targets) ? targets : [];
  if (!list.length || list[0] === "active") {
    try {
      await dockerCompose(["stop", "vpn"], { onLog });
      await dockerCompose(["rm", "-f", "vpn"], { onLog });
    } catch {
      /* ignore */
    }
    try {
      await run("docker", ["rm", "-f", "proton-vpn"], { onLog });
    } catch {
      /* ignore */
    }
    return "proton-vpn DOWN";
  }
  if (list[0] === "all") {
    try {
      await dockerCompose(["--profile", "all", "down", "--remove-orphans"], {
        onLog,
      });
    } catch {
      /* ignore */
    }
    try {
      await run(
        "docker",
        ["rm", "-f", "proton-vpn", "vpn-ro", "vpn-hu", "vpn-bg"],
        { onLog }
      );
    } catch {
      /* ignore */
    }
    return "All VPN containers DOWN";
  }
  for (const c of list) {
    const code = String(c).toLowerCase();
    try {
      await run("docker", ["rm", "-f", `vpn-${code}`], { onLog });
    } catch {
      /* ignore */
    }
  }
  return `Stopped: ${list.join(", ")}`;
}

async function vpnUpParallel(codes, onLog) {
  if (envNeedsSetup()) {
    throw new Error("WireGuard key missing — complete setup first");
  }
  const list = codes.map((c) => String(c).toLowerCase());
  if (list.length === 1 && list[0] === "all") {
    await dockerCompose(
      ["--profile", "all", "up", "-d", "vpn-ro", "vpn-hu", "vpn-bg"],
      { onLog }
    );
    return "UP: vpn-ro vpn-hu vpn-bg";
  }
  const profiles = [];
  const services = [];
  for (const c of list) {
    if (!["ro", "hu", "bg"].includes(c)) {
      throw new Error(
        `Parallel exits shipped for ro|hu|bg only. For others use Connect with country ${c}`
      );
    }
    profiles.push("--profile", c);
    services.push(`vpn-${c}`);
  }
  await dockerCompose([...profiles, "up", "-d", ...services], { onLog });
  return `UP: ${services.join(" ")}`;
}

async function vpnUpActive(onLog) {
  if (envNeedsSetup()) {
    throw new Error("WireGuard key missing — complete setup first");
  }
  const code = readActive();
  const { name } = resolveCountry(code);
  writeActive(code, name);
  await dockerCompose(["up", "-d", "vpn"], {
    env: { SERVER_COUNTRIES: name },
    onLog,
  });
  return `proton-vpn UP (${code})`;
}

/** CLI-compatible entry used by the desktop app */
async function runVpn(args, onLog) {
  const [cmd, ...rest] = args;
  switch (cmd) {
    case "use":
    case "switch":
      return vpnUse(rest[0], onLog);
    case "down":
    case "stop":
      return vpnDown(rest, onLog);
    case "up":
      if (!rest.length) return vpnUpActive(onLog);
      return vpnUpParallel(rest, onLog);
    default:
      throw new Error(`Unsupported vpn command in app: ${cmd}`);
  }
}

function parseIpInfoPayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ip: '', country: '', org: '', city: '', raw: '' };
  try {
    const parsed = JSON.parse(text);
    return {
      ip: parsed.ip || '',
      country: parsed.country || '',
      org: parsed.org || '',
      city: parsed.city || '',
      raw: text,
    };
  } catch {
    const ip = text.split(/\s|\n/)[0] || text;
    return { ip, country: '', org: '', city: '', raw: text };
  }
}

async function fetchHostIpInfo() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch('https://ipinfo.io/json', { signal: ctrl.signal });
    clearTimeout(timer);
    const raw = await res.text();
    if (!res.ok) {
      return {
        connected: false,
        via: 'host',
        container: '',
        error: `HTTP ${res.status}`,
        ...parseIpInfoPayload(''),
      };
    }
    return {
      connected: true,
      via: 'host',
      container: '',
      error: '',
      ...parseIpInfoPayload(raw),
    };
  } catch (err) {
    return {
      connected: false,
      via: 'host',
      container: '',
      ip: '',
      country: '',
      org: '',
      city: '',
      raw: '',
      error: err.message || String(err),
    };
  }
}

async function fetchContainerIpInfo(containerName, onLog) {
  const name = String(containerName || '').trim();
  if (!name) {
    return {
      connected: false,
      via: 'none',
      container: '',
      ip: '',
      country: '',
      org: '',
      city: '',
      raw: '',
      error: 'brak kontenera VPN',
    };
  }
  const running = await containerRunning(name);
  if (!running) {
    return {
      connected: false,
      via: 'container',
      container: name,
      ip: '',
      country: '',
      org: '',
      city: '',
      raw: '',
      error: `kontener ${name} nie działa`,
    };
  }
  try {
    let raw = '';
    try {
      raw = (await run('docker', ['exec', name, 'wget', '-qO-', 'https://ipinfo.io/json'], { onLog })).trim();
    } catch {
      raw = (await run('docker', ['exec', name, 'wget', '-qO-', 'https://ifconfig.me'], { onLog })).trim();
    }
    return {
      connected: true,
      via: 'container',
      container: name,
      error: '',
      ...parseIpInfoPayload(raw),
    };
  } catch (err) {
    return {
      connected: true,
      via: 'container',
      container: name,
      ip: '',
      country: '',
      org: '',
      city: '',
      raw: '',
      error: err.message || String(err),
    };
  }
}

async function fetchIpInfo(onLog) {
  return fetchContainerIpInfo('proton-vpn', onLog);
}

async function checkProjectIp(id, { onLog } = {}) {
  const crawler = findCrawler(id);
  if (!crawler || crawler.kind !== 'project') {
    throw new Error('Projekt nie znaleziony');
  }

  const vpnName = String(crawler.vpnContainerName || '').trim();
  if (vpnName && (await containerRunning(vpnName))) {
    if (onLog) onLog(`${crawler.name}: check IP przez ${vpnName}…`);
    const info = await fetchContainerIpInfo(vpnName, onLog);
    if (onLog) {
      if (info.ip) {
        onLog(
          `${crawler.name}: ${info.ip}${info.country ? ` · ${info.country}` : ''}${info.org ? ` · ${info.org}` : ''}`,
        );
      } else if (info.error) {
        onLog(`${crawler.name}: check IP — ${info.error}`);
      }
    }
    return { ...info, projectId: crawler.id, projectName: crawler.name };
  }

  if (crawler.runMode === 'cli') {
    try {
      const stack = await ensureCliVpnTunnel(crawler, {
        country: crawler.country,
        recreate: false,
        onLog,
      });
      if (onLog) onLog(`${crawler.name}: check IP przez ${stack.vpnContainerName}…`);
      let info = await fetchContainerIpInfo(stack.vpnContainerName, onLog);
      if (!info.ip || info.error) {
        if (onLog) onLog(`${crawler.name}: VPN jeszcze nie gotowy — czekam…`);
        info = await waitCliVpnReady(stack.vpnContainerName, { onLog });
      }
      if (onLog && info.ip) {
        onLog(
          `${crawler.name}: ${info.ip}${info.country ? ` · ${info.country}` : ''}${
            info.org ? ` · ${info.org}` : ''
          } (VPN CLI)`,
        );
      }
      return {
        ...info,
        connected: !!info.ip,
        via: 'cli-vpn',
        container: stack.vpnContainerName,
        proxy: stack.proxy,
        projectId: crawler.id,
        projectName: crawler.name,
      };
    } catch (err) {
      if (onLog) onLog(`${crawler.name}: VPN CLI — ${err.message || err}`);
      return {
        connected: false,
        via: 'cli-vpn',
        ip: '',
        country: '',
        org: '',
        city: '',
        raw: '',
        error: err.message || String(err),
        projectId: crawler.id,
        projectName: crawler.name,
      };
    }
  }

  if (vpnName) {
    if (onLog) {
      onLog(`${crawler.name}: VPN wyłączony (${vpnName}) — włącz projekt, potem IP`);
    }
    return {
      connected: false,
      via: 'container',
      container: vpnName,
      ip: '',
      country: '',
      org: '',
      city: '',
      raw: '',
      error: 'VPN projektu wyłączony — najpierw Włącz',
      projectId: crawler.id,
      projectName: crawler.name,
    };
  }

  throw new Error(`${crawler.name}: brak kontenera VPN`);
}

async function getSnapshot(onLog) {
  ensureWorkspace();
  const countries = readCountries();
  const setupNeeded = envNeedsSetup();
  const active = readActive();
  const connected = await containerRunning("proton-vpn");
  const parallel = {
    ro: await containerRunning("vpn-ro"),
    hu: await containerRunning("vpn-hu"),
    bg: await containerRunning("vpn-bg"),
  };

  let ipInfo = {
    connected,
    ip: "",
    country: "",
    org: "",
    city: "",
    raw: "",
  };
  if (connected && !setupNeeded) {
    ipInfo = await fetchIpInfo(onLog);
  }

  const activeName =
    countries.find((c) => c.code === active)?.name || active.toUpperCase();

  const endpoints = readEndpoints();
  syncOverrideCompose(endpoints);
  const crawlers = setupNeeded ? [] : await listCrawlersWithStatus();

  const ollamaSettings = getOllamaSettings();
  let ollama = {
    enabled: ollamaSettings.enabled,
    baseUrl: ollamaSettings.baseUrl,
    ok: false,
    models: [],
    error: ollamaSettings.enabled ? '' : 'disabled',
    defaults: {
      crawlModel: DEFAULT_CRAWL_MODEL,
      antibotModel: DEFAULT_ANTIBOT_MODEL,
    },
  };
  if (ollamaSettings.enabled) {
    const check = await checkOllama(ollamaSettings.baseUrl);
    ollama = {
      ...ollama,
      baseUrl: check.baseUrl,
      ok: check.ok,
      models: check.models || [],
      error: check.error || '',
    };
  }

  const serperSettings = getSerperSettings();
  const serper = {
    enabled: serperSettings.enabled,
    apiKey: serperSettings.apiKey,
    configured: !!(serperSettings.enabled && serperSettings.apiKey),
    masked: maskSecret(serperSettings.apiKey),
  };

  const hostWgBase = getHostWgSettings();
  let hostWgUp = false;
  try {
    hostWgUp = hostWgBase.configured
      ? await hostWgIsUp(hostWgBase.name || 'wg0')
      : false;
  } catch {
    hostWgUp = false;
  }
  const hostWg = {
    ...hostWgBase,
    up: hostWgUp,
    managed: anyProjectNeedsHostWg(),
  };

  return {
    ok: true,
    setupNeeded,
    root: getHubRoot(),
    packaged: isPackaged(),
    countries,
    active,
    activeName,
    connected,
    parallel,
    ipInfo,
    endpoints,
    endpointPresets: ENDPOINT_PRESETS,
    crawlers,
    crawlerExits: CRAWLER_EXITS,
    cliShells: listAvailableCliShells(),
    ollama,
    serper,
    hostWg,
    snippets: {
      networkMode: 'network_mode: "container:proton-vpn"',
      composeBlock: ['services:', '  app:', '    build: .', '    network_mode: "container:proton-vpn"'].join('\n'),
      proxyHost: 'http://127.0.0.1:8888',
      proxyEnv: [
        'HTTP_PROXY=http://127.0.0.1:8888',
        'HTTPS_PROXY=http://127.0.0.1:8888',
        'NO_PROXY=localhost,127.0.0.1',
      ].join('\n'),
      fixedRo: 'network_mode: "container:vpn-ro"',
      fixedHu: 'network_mode: "container:vpn-hu"',
      fixedBg: 'network_mode: "container:vpn-bg"',
      ollama: ollamaSnippet(endpoints),
    },
  };
}

function stopAllCliSessions() {
  for (const id of [...cliSessions.keys()]) {
    stopCliSession(id).catch(() => {});
  }
}

const projectLogFollows = new Map();

async function getProjectLogs(id, { tail = 200 } = {}) {
  const crawler = findCrawler(id);
  if (crawler.kind !== 'project') {
    throw new Error('Logs are available for projects only');
  }

  if (crawler.runMode === 'cli') {
    const running = isCliSessionRunning(id);
    const buf = cliLogBuffers.get(id) || '';
    const lines = buf.split(/\n/).filter((l, i, arr) => l.length || i < arr.length - 1);
    const sliced = lines.slice(-tail).join('\n');
    const session = cliSessions.get(id);
    let text = sliced;
    if (!text) {
      text = running
        ? session?.mode === 'terminal'
          ? '(CLI w Terminalu — logi są w oknie Terminala)\n'
          : '(brak logów jeszcze)\n'
        : '(CLI wyłączone — kliknij Uruchom)\n';
    } else if (running && session?.mode === 'terminal' && !text.includes('Terminal')) {
      text = `${text}\n(interaktywne UI — patrz okno Terminala)\n`;
    }
    return { ok: true, running, text: text.endsWith('\n') ? text : `${text}\n` };
  }

  const state = await containerState(crawler.containerName);
  if (!state.exists) {
    return {
      ok: true,
      running: false,
      text: '(brak kontenera app — włącz crawl, żeby zobaczyć logi)\n',
    };
  }
  try {
    const text = await run('docker', ['logs', '--tail', String(tail), crawler.containerName], { cwd: crawler.path });
    return { ok: true, running: state.running, text: text || '(puste logi)\n' };
  } catch (err) {
    return {
      ok: false,
      running: state.running,
      text: String(err.message || err),
    };
  }
}

function stopProjectLogFollow(id) {
  const child = projectLogFollows.get(id);
  if (!child) return false;
  try {
    if (typeof child.kill === 'function') child.kill('SIGTERM');
    if (typeof child === 'object' && child.timer) clearInterval(child.timer);
  } catch {
    /* ignore */
  }
  projectLogFollows.delete(id);
  return true;
}

function stopAllProjectLogFollows() {
  for (const id of [...projectLogFollows.keys()]) {
    stopProjectLogFollow(id);
  }
}

function followProjectLogs(id, { onLine, tail = 100 } = {}) {
  const crawler = findCrawler(id);
  if (crawler.kind !== 'project') {
    throw new Error('Logs are available for projects only');
  }
  stopProjectLogFollow(id);

  if (crawler.runMode === 'cli') {
    const session = cliSessions.get(id);
    if (session?.mode === 'process' && session.child) {
      const pump = (buf) => {
        String(buf)
          .split(/\r?\n/)
          .filter((line) => line.length)
          .forEach((line) => {
            if (onLine) onLine(line);
          });
      };
      session.child.stdout.on('data', pump);
      session.child.stderr.on('data', pump);
      projectLogFollows.set(id, {
        kill() {
          session.child.stdout.off('data', pump);
          session.child.stderr.off('data', pump);
        },
      });
      return true;
    }
    // Terminal / idle: poll buffer for new lines
    let lastLen = (cliLogBuffers.get(id) || '').length;
    const buf = cliLogBuffers.get(id) || '';
    buf
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-tail)
      .forEach((line) => {
        if (onLine) onLine(line);
      });
    const timer = setInterval(() => {
      const cur = cliLogBuffers.get(id) || '';
      if (cur.length <= lastLen) return;
      const added = cur.slice(lastLen);
      lastLen = cur.length;
      added
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => {
          if (onLine) onLine(line);
        });
    }, 800);
    projectLogFollows.set(id, {
      timer,
      kill() {
        clearInterval(timer);
      },
    });
    return true;
  }

  const child = spawn('docker', ['logs', '-f', '--tail', String(tail), crawler.containerName], {
    cwd: crawler.path,
    env: process.env,
    shell: false,
    windowsHide: true,
  });
  projectLogFollows.set(id, child);

  const pump = (buf) => {
    String(buf)
      .split(/\r?\n/)
      .filter((line) => line.length)
      .forEach((line) => {
        if (onLine) onLine(line);
      });
  };
  child.stdout.on('data', pump);
  child.stderr.on('data', pump);
  child.on('close', () => {
    if (projectLogFollows.get(id) === child) {
      projectLogFollows.delete(id);
    }
  });
  child.on('error', () => {
    if (projectLogFollows.get(id) === child) {
      projectLogFollows.delete(id);
    }
  });
  return true;
}

const hubApi = {
  getHubRoot,
  getResourcesHub,
  ensureWorkspace,
  readCountries,
  envNeedsSetup,
  setupEnv,
  runVpn,
  getSnapshot,
  fetchIpInfo,
  fetchContainerIpInfo,
  checkProjectIp,
  readEndpoints,
  setEndpoints,
  getOllamaSettings,
  setOllamaSettings,
  checkOllama,
  getSerperSettings,
  setSerperSettings,
  checkSerper,
  getHostWgSettings,
  setHostWgSettings,
  setProjectUseHostWg,
  ensureHostWgUp,
  syncAppHostWg,
  startHostWgWatchdog,
  stopHostWgWatchdog,
  probeProjectMcp,
  ensureProjectCrmAccess,
  ensureCliVpnTunnel,
  writeCliVpnStack,
  setProjectCliShell,
  listAvailableCliShells,
  CLI_SHELL_PRESETS,
  ENDPOINT_PRESETS,
  CRAWLER_EXITS,
  listCrawlersWithStatus,
  addCrawler,
  removeCrawler,
  startCrawler,
  stopCrawler,
  createProject,
  registerProject,
  duplicateProject,
  exportProject,
  importProject,
  setCrawlerExit,
  setProjectModels,
  setProjectStartOptions,
  getProjectEnv,
  setProjectEnv,
  openInCursor,
  getProjectLogs,
  followProjectLogs,
  stopProjectLogFollow,
  stopAllProjectLogFollows,
  stopAllCliSessions,
};

export default hubApi;
module.exports = hubApi;

