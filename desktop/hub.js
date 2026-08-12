const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function tryElectronApp() {
  try {
    // eslint-disable-next-line global-require
    return require("electron").app;
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
  return path.resolve(__dirname, "..");
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
  return path.resolve(__dirname, "..");
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

/** Sync compose/countries from resources; never overwrite .env */
function ensureWorkspace() {
  const root = getHubRoot();
  const res = getResourcesHub();
  ensureDir(root);

  copyFile(
    path.join(res, "docker-compose.yml"),
    path.join(root, "docker-compose.yml"),
    { overwrite: true }
  );
  copyFile(
    path.join(res, "countries.conf"),
    path.join(root, "countries.conf"),
    { overwrite: true }
  );
  copyFile(
    path.join(res, ".env.example"),
    path.join(root, ".env.example"),
    { overwrite: true }
  );

  const envDest = path.join(root, ".env");
  if (!fs.existsSync(envDest)) {
    copyFile(path.join(res, ".env.example"), envDest, { overwrite: true });
  }
  return root;
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

function composeFile() {
  ensureWorkspace();
  return path.join(getHubRoot(), "docker-compose.yml");
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

async function fetchIpInfo(onLog) {
  const running = await containerRunning("proton-vpn");
  if (!running) {
    return { connected: false, raw: "", ip: "", country: "", org: "" };
  }
  try {
    const raw = (
      await run(
        "docker",
        ["exec", "proton-vpn", "wget", "-qO-", "https://ipinfo.io/json"],
        { onLog }
      )
    ).trim();
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { ip: raw };
    }
    return {
      connected: true,
      raw,
      ip: parsed.ip || "",
      country: parsed.country || "",
      org: parsed.org || "",
      city: parsed.city || "",
    };
  } catch (err) {
    return {
      connected: true,
      raw: "",
      ip: "",
      country: "",
      org: "",
      error: err.message,
    };
  }
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
    snippets: {
      networkMode: 'network_mode: "container:proton-vpn"',
      composeBlock: [
        "services:",
        "  app:",
        "    build: .",
        '    network_mode: "container:proton-vpn"',
      ].join("\n"),
      proxyHost: "http://127.0.0.1:8888",
      proxyEnv: [
        "HTTP_PROXY=http://127.0.0.1:8888",
        "HTTPS_PROXY=http://127.0.0.1:8888",
        "NO_PROXY=localhost,127.0.0.1",
      ].join("\n"),
      fixedRo: 'network_mode: "container:vpn-ro"',
      fixedHu: 'network_mode: "container:vpn-hu"',
      fixedBg: 'network_mode: "container:vpn-bg"',
    },
  };
}

module.exports = {
  getHubRoot,
  getResourcesHub,
  ensureWorkspace,
  readCountries,
  envNeedsSetup,
  setupEnv,
  runVpn,
  getSnapshot,
  fetchIpInfo,
};
