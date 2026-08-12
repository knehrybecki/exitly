const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const el = {
  setup: $("#setup"),
  main: $("#main-ui"),
  country: $("#country"),
  statusDot: $("#status-dot"),
  statusLabel: $("#status-label"),
  statusSub: $("#status-sub"),
  ipValue: $("#ip-value"),
  ipGeo: $("#ip-geo"),
  log: $("#log"),
  error: $("#error"),
  rootPath: $("#root-path"),
  snippetCompose: $("#snippet-compose"),
  snippetProxy: $("#snippet-proxy"),
  snippetParallel: $("#snippet-parallel"),
  btnConnect: $("#btn-connect"),
  btnDisconnect: $("#btn-disconnect"),
  privateKey: $("#private-key"),
  updateBanner: $("#update-banner"),
  updateTitle: $("#update-title"),
  updateDetail: $("#update-detail"),
  updateProgress: $("#update-progress"),
  updateProgressBar: $("#update-progress-bar"),
  btnUpdateCheck: $("#btn-update-check"),
  btnUpdateDownload: $("#btn-update-download"),
  btnUpdateInstall: $("#btn-update-install"),
  appVersion: $("#app-version"),
};

let busy = false;
let snapshot = null;

function log(line) {
  const stamp = new Date().toLocaleTimeString();
  el.log.textContent += `[${stamp}] ${line}\n`;
  el.log.scrollTop = el.log.scrollHeight;
}

function setError(msg) {
  if (!msg) {
    el.error.classList.add("hidden");
    el.error.textContent = "";
    return;
  }
  el.error.classList.remove("hidden");
  el.error.textContent = msg;
}

function setBusy(on) {
  busy = on;
  const ids = [
    "btn-connect",
    "btn-disconnect",
    "btn-save-key",
    "btn-ip",
    "btn-refresh",
    "btn-parallel-up",
    "btn-parallel-down",
    "country",
    "private-key",
  ];
  for (const id of ids) {
    const node = document.getElementById(id);
    if (node) node.disabled = on;
  }
  if (!on && snapshot) applyConnectionButtons(snapshot);
}

function applyConnectionButtons(snap) {
  el.btnConnect.disabled = false;
  el.btnDisconnect.disabled = !snap.connected;
  el.btnConnect.textContent = snap.connected ? "Switch / reconnect" : "Connect";
}

function fillCountries(countries, active) {
  el.country.innerHTML = "";
  for (const c of countries) {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = `${c.code.toUpperCase()} — ${c.name}`;
    if (c.code === active) opt.selected = true;
    el.country.appendChild(opt);
  }
}

function renderSnippets(snap) {
  el.snippetCompose.textContent = snap.snippets.composeBlock;
  el.snippetProxy.textContent = snap.snippets.proxyEnv;
  el.snippetParallel.textContent = [
    "# Project RO",
    snap.snippets.fixedRo,
    "",
    "# Project HU",
    snap.snippets.fixedHu,
    "",
    "# Project BG",
    snap.snippets.fixedBg,
  ].join("\n");
}

function renderSnapshot(snap) {
  snapshot = snap;
  el.rootPath.textContent = snap.root || "";

  if (snap.setupNeeded) {
    el.setup.classList.remove("hidden");
    el.main.classList.add("hidden");
    return;
  }

  el.setup.classList.add("hidden");
  el.main.classList.remove("hidden");

  fillCountries(snap.countries || [], snap.active);
  renderSnippets(snap);

  const on = !!snap.connected;
  el.statusDot.classList.toggle("on", on);
  el.statusDot.classList.toggle("off", !on);
  el.statusLabel.textContent = on ? "Connected" : "Disconnected";
  el.statusSub.textContent = on
    ? `Exit: ${snap.activeName} (${snap.active}) · container proton-vpn`
    : `Ready · last country ${snap.activeName} (${snap.active})`;

  const ip = snap.ipInfo || {};
  el.ipValue.textContent = ip.ip || (on ? "resolving…" : "—");
  el.ipGeo.textContent = [ip.city, ip.country, ip.org].filter(Boolean).join(" · ") || "—";

  // parallel checkbox state
  $$("#parallel-chips input").forEach((input) => {
    input.checked = !!(snap.parallel && snap.parallel[input.value]);
  });

  applyConnectionButtons(snap);
}

async function refresh() {
  setError("");
  try {
    const snap = await window.vpnHub.getSnapshot();
    if (!snap.ok && snap.error) setError(snap.error);
    renderSnapshot(snap);
  } catch (err) {
    setError(err.message || String(err));
  }
}

async function withBusy(fn) {
  if (busy) return;
  setBusy(true);
  setError("");
  try {
    const snap = await fn();
    if (snap) renderSnapshot(snap);
  } catch (err) {
    setError(err.message || String(err));
    log(`ERROR: ${err.message || err}`);
  } finally {
    setBusy(false);
  }
}

// tabs
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const id = tab.dataset.tab;
    ["docker", "proxy", "parallel"].forEach((name) => {
      $(`#tab-${name}`).classList.toggle("hidden", name !== id);
    });
  });
});

$$("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const id = btn.getAttribute("data-copy");
    const text = $(`#${id}`)?.textContent || "";
    await window.vpnHub.copy(text);
    const old = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.textContent = old;
    }, 1200);
  });
});

$("#btn-save-key").addEventListener("click", () =>
  withBusy(async () => {
    await window.vpnHub.setupEnv(el.privateKey.value);
    log("Saved WireGuard key to .env");
    return window.vpnHub.getSnapshot();
  })
);

$("#btn-key-help").addEventListener("click", () => window.vpnHub.pickEnvHelp());
$("#btn-reveal").addEventListener("click", () => window.vpnHub.revealRoot());
$("#btn-refresh").addEventListener("click", () => refresh());

el.btnConnect.addEventListener("click", () =>
  withBusy(async () => {
    log(`Connect requested: ${el.country.value}`);
    return window.vpnHub.connect(el.country.value);
  })
);

el.btnDisconnect.addEventListener("click", () =>
  withBusy(async () => {
    log("Disconnect requested");
    return window.vpnHub.disconnect();
  })
);

$("#btn-ip").addEventListener("click", () =>
  withBusy(async () => {
    const ip = await window.vpnHub.refreshIp();
    if (snapshot) {
      snapshot.ipInfo = ip;
      snapshot.connected = !!ip.connected;
      renderSnapshot(snapshot);
    }
    log(ip.ip ? `IP ${ip.ip} (${ip.country || "?"})` : "No IP (disconnected?)");
    return null;
  })
);

$("#btn-parallel-up").addEventListener("click", () =>
  withBusy(async () => {
    const codes = $$("#parallel-chips input:checked").map((i) => i.value);
    return window.vpnHub.parallelUp(codes);
  })
);

$("#btn-parallel-down").addEventListener("click", () =>
  withBusy(async () => {
    const codes = $$("#parallel-chips input:checked").map((i) => i.value);
    return window.vpnHub.parallelDown(codes);
  })
);

window.vpnHub.onLog((line) => {
  if (line) log(line);
});

function showUpdateBanner(visible) {
  el.updateBanner.classList.toggle("hidden", !visible);
}

function setUpdateButtons({ download = false, install = false } = {}) {
  el.btnUpdateDownload.classList.toggle("hidden", !download);
  el.btnUpdateInstall.classList.toggle("hidden", !install);
}

function handleUpdateStatus(payload) {
  if (!payload) return;
  showUpdateBanner(true);
  el.updateProgress.classList.add("hidden");
  setUpdateButtons({});

  switch (payload.state) {
    case "checking":
      el.updateTitle.textContent = "Checking for updates…";
      el.updateDetail.textContent = "";
      break;
    case "available":
      el.updateTitle.textContent = `Update ${payload.version} available`;
      el.updateDetail.textContent = "Download and install without leaving the app.";
      setUpdateButtons({ download: true });
      log(`Update available: ${payload.version}`);
      break;
    case "not-available":
      el.updateTitle.textContent = "You're up to date";
      el.updateDetail.textContent = payload.version ? `Current ${payload.version}` : "";
      break;
    case "downloading": {
      const pct = Math.max(0, Math.min(100, payload.percent || 0));
      el.updateTitle.textContent = "Downloading update…";
      el.updateDetail.textContent = `${pct.toFixed(0)}%`;
      el.updateProgress.classList.remove("hidden");
      el.updateProgressBar.style.width = `${pct}%`;
      break;
    }
    case "downloaded":
      el.updateTitle.textContent = `Update ${payload.version} ready`;
      el.updateDetail.textContent = "Restart to install.";
      setUpdateButtons({ install: true });
      log(`Update downloaded: ${payload.version}`);
      break;
    case "error":
      el.updateTitle.textContent = "Update error";
      el.updateDetail.textContent = payload.message || "Unknown error";
      log(`Update error: ${payload.message || "?"}`);
      break;
    default:
      break;
  }
}

el.btnUpdateCheck.addEventListener("click", async () => {
  showUpdateBanner(true);
  el.updateTitle.textContent = "Checking for updates…";
  el.updateDetail.textContent = "";
  const res = await window.vpnHub.checkForUpdates();
  if (res && res.reason === "dev") {
    el.updateTitle.textContent = "Updates need a packaged build";
    el.updateDetail.textContent = "Run an installed release to use auto-update.";
  }
});

el.btnUpdateDownload.addEventListener("click", async () => {
  try {
    await window.vpnHub.downloadUpdate();
  } catch (err) {
    setError(err.message || String(err));
  }
});

el.btnUpdateInstall.addEventListener("click", () => {
  window.vpnHub.installUpdate();
});

window.vpnHub.onUpdateStatus(handleUpdateStatus);

(async () => {
  try {
    const info = await window.vpnHub.getAppInfo();
    el.appVersion.textContent = `v${info.version} · ${info.platform}/${info.arch}${
      info.packaged ? "" : " · dev"
    }`;
    showUpdateBanner(true);
    el.updateTitle.textContent = info.packaged
      ? "Auto-update enabled"
      : "Dev mode";
    el.updateDetail.textContent = info.packaged
      ? "Checks GitHub Releases in the background."
      : "Install a release build to enable in-app updates.";
  } catch {
    /* ignore */
  }
  refresh();
})();

setInterval(() => {
  if (!busy) refresh();
}, 15000);
