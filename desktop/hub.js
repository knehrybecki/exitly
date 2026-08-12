const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function getHubRoot() {
  // desktop/ lives inside the repo
  return path.resolve(__dirname, "..");
}

function vpnBin() {
  return path.join(getHubRoot(), "bin", "vpn");
}

function readCountries() {
  const file = path.join(getHubRoot(), "countries.conf");
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

function envPath() {
  return path.join(getHubRoot(), ".env");
}

function envNeedsSetup() {
  const p = envPath();
  if (!fs.existsSync(p)) return true;
  const text = fs.readFileSync(p, "utf8");
  if (/PASTE_PRIVATE_KEY_HERE/.test(text)) return true;
  if (!/WIREGUARD_PRIVATE_KEY=\S+/.test(text)) return true;
  const m = text.match(/WIREGUARD_PRIVATE_KEY=(.*)/);
  if (!m || !m[1].trim()) return true;
  return false;
}

function setupEnv(privateKey) {
  if (!privateKey || privateKey.length < 20) {
    throw new Error("Private key looks too short");
  }
  const example = path.join(getHubRoot(), ".env.example");
  const dest = envPath();
  let body = fs.existsSync(dest)
    ? fs.readFileSync(dest, "utf8")
    : fs.readFileSync(example, "utf8");

  if (/^WIREGUARD_PRIVATE_KEY=/m.test(body)) {
    body = body.replace(
      /^WIREGUARD_PRIVATE_KEY=.*$/m,
      `WIREGUARD_PRIVATE_KEY=${privateKey}`
    );
  } else {
    body += `\nWIREGUARD_PRIVATE_KEY=${privateKey}\n`;
  }
  fs.writeFileSync(dest, body, { mode: 0o600 });
  return { ok: true, path: dest };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || getHubRoot(),
      env: { ...process.env, PATH: process.env.PATH },
      shell: false,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (opts.onLog) opts.onLog(d.toString().trimEnd());
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (opts.onLog) opts.onLog(d.toString().trimEnd());
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error((err || out || `exit ${code}`).trim()));
    });
  });
}

async function runVpn(args, onLog) {
  const bin = vpnBin();
  if (!fs.existsSync(bin)) {
    throw new Error(`vpn CLI missing: ${bin}`);
  }
  return run(bin, args, { onLog });
}

function readActive() {
  const activeFile = path.join(getHubRoot(), ".active");
  if (fs.existsSync(activeFile)) {
    return fs.readFileSync(activeFile, "utf8").trim().toLowerCase();
  }
  const env = envPath();
  if (fs.existsSync(env)) {
    const m = fs.readFileSync(env, "utf8").match(/^ACTIVE_COUNTRY=(.*)$/m);
    if (m) return m[1].trim().toLowerCase();
  }
  return "ro";
}

async function containerRunning(name) {
  try {
    const out = await run("docker", [
      "inspect",
      "-f",
      "{{.State.Running}}",
      name,
    ]);
    return out.trim() === "true";
  } catch {
    return false;
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
  readCountries,
  envNeedsSetup,
  setupEnv,
  runVpn,
  getSnapshot,
  fetchIpInfo,
};
