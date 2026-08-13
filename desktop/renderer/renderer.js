"use strict";
(() => {
  // src/renderer/api.ts
  function api() {
    const hub = window.vpnHub;
    if (!hub) {
      throw new Error("vpnHub niedost\u0119pne \u2014 preload nie za\u0142adowa\u0142 si\u0119 (sandbox / build).");
    }
    return hub;
  }

  // src/renderer/ui.ts
  var $ = (sel) => document.querySelector(sel);
  var $$ = (sel) => Array.from(document.querySelectorAll(sel));
  function requireEl(root, sel) {
    const node = root.querySelector(sel);
    if (!node) throw new Error(`Missing element: ${sel}`);
    return node;
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var busy = false;
  function isBusy() {
    return busy;
  }
  function log(el2, line) {
    if (!el2) return;
    const stamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("pl-PL");
    el2.textContent += `[${stamp}] ${line}
`;
    el2.scrollTop = el2.scrollHeight;
  }
  function setError(el2, msg) {
    if (!msg) {
      el2.classList.add("hidden");
      el2.textContent = "";
      return;
    }
    el2.classList.remove("hidden");
    el2.textContent = msg;
  }
  function setBusy(busyBar, on, opts) {
    busy = on;
    busyBar.classList.toggle("hidden", !on);
    const preserve = new Set(opts?.preserveIds || []);
    $$("button, input, select").forEach((node) => {
      const el2 = node;
      if (preserve.has(el2.id)) return;
      if (el2.closest(".update-banner")) return;
      if (el2.closest(".project-logs")) return;
      el2.disabled = on;
    });
  }

  // src/renderer/modals/helpers.ts
  function slugifyFolderName(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
  }
  function parentDirOf(filePath) {
    const s = String(filePath || "").replace(/[/\\]+$/, "");
    const idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return idx > 0 ? s.slice(0, idx) : s;
  }

  // src/renderer/projects/preview.ts
  var MAX_STREAM = 4;
  var states = /* @__PURE__ */ new Map();
  var pingAt = /* @__PURE__ */ new Map();
  function getPreviewState(id) {
    let state = states.get(id);
    if (!state) {
      state = { kind: "idle", lines: [], running: false };
      states.set(id, state);
    }
    return state;
  }
  function dropPreviewState(id) {
    states.delete(id);
    pingAt.delete(id);
  }
  function classifyLogLine(line) {
    const s = line.toLowerCase();
    if (/error|exception|fatal|traceback|failed|eacces|denied|cannot|crash/.test(s)) {
      return "error";
    }
    if (/warn|retry|timeout|captcha|blocked|429|rate.?limit/.test(s)) {
      return "warn";
    }
    if (/wireguard|wg0|vpn|proton|connected|exit node|tunnel/.test(s)) {
      return "vpn";
    }
    if (/\bmcp\b|json-?rpc|jsonrpc/.test(s)) return "mcp";
    if (/https?:\/\/|\bget |\bpost |\bcrawl|fetch|scrap|visit|url=|request/.test(s)) {
      return "crawl";
    }
    if (/listening|started|ready|ok\b|done|saved|success/.test(s)) return "ok";
    if (/start|boot|init|compos|pulling|creating/.test(s)) return "boot";
    return "crawl";
  }
  function ingestPreviewLine(id, line, opts) {
    const text = String(line || "").replace(/\s+/g, " ").trim();
    if (!text) return getPreviewState(id);
    const state = getPreviewState(id);
    state.kind = classifyLogLine(text);
    if (opts?.running != null) state.running = opts.running;
    state.lines = [...state.lines, text].slice(-MAX_STREAM);
    const card = document.querySelector(
      `.project-card[data-id="${cssEscape(id)}"]`
    );
    if (card) applyPreviewToCard(card, id, state.running);
    if (opts?.ping !== false) maybePing(id, state.kind);
    return state;
  }
  function seedPreviewLines(id, text, running) {
    const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l && !/^\(/.test(l)).slice(-MAX_STREAM);
    const state = getPreviewState(id);
    state.running = running;
    if (lines.length) {
      state.lines = lines;
      state.kind = classifyLogLine(lines[lines.length - 1] || "");
    } else if (!running) {
      state.kind = "idle";
    }
    return state;
  }
  function svgId(projectId, name) {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 28) || "p";
    return `pv-${safe}-${name}`;
  }
  var CRAWL_PATH = "M48 54 C70 40 96 30 120 28 C150 36 178 46 200 50 C220 36 234 24 248 22 C280 28 310 36 332 40 C348 52 356 68 360 78 C330 82 290 76 268 72 C240 80 210 86 186 88 C156 84 138 80 128 78 C88 72 62 64 48 54";
  var CRAWL_NODES = [
    { x: 48, y: 54, seed: true },
    { x: 120, y: 28 },
    { x: 128, y: 78 },
    { x: 200, y: 50 },
    { x: 248, y: 22 },
    { x: 268, y: 72 },
    { x: 186, y: 88 },
    { x: 332, y: 40 },
    { x: 360, y: 78 }
  ];
  function pageNode(x, y, seed = false) {
    const extra = seed ? " seed" : "";
    return `<g class="preview-node${extra}" transform="translate(${x} ${y})">
    <rect x="-7" y="-9" width="14" height="17" rx="2"/>
    <path d="M-3.5 -4 h7 M-3.5 0 h7 M-3.5 4 h4.5"/>
  </g>`;
  }
  function renderPreviewHtml(projectId, running) {
    const glow = svgId(projectId, "g");
    const state = getPreviewState(projectId);
    state.running = running;
    const kind = running ? state.kind || "boot" : "idle";
    const stream = previewStreamHtml(state, running);
    return `
    <div class="project-preview" data-role="preview" data-running="${running ? "true" : "false"}" data-kind="${kind}">
      <svg class="preview-scene" viewBox="0 0 400 108" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="${glow}" cx="30%" cy="50%" r="70%">
            <stop offset="0" stop-color="#b6e34a" stop-opacity="0.16"/>
            <stop offset="1" stop-color="#064644" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="400" height="108" fill="#02140f"/>
        <rect width="400" height="108" fill="url(#${glow})"/>
        <g class="preview-web" fill="none" stroke="#39ff88">
          <path class="preview-link" d="M48 54 L120 28 L200 50 L248 22 L332 40 L360 78"/>
          <path class="preview-link alt" d="M48 54 L128 78 L186 88 L268 72 L360 78"/>
          <path class="preview-link" d="M120 28 L128 78 M200 50 L268 72 M248 22 L200 50 L186 88"/>
          <path class="preview-route" d="${CRAWL_PATH}"/>
        </g>
        ${CRAWL_NODES.map((n) => pageNode(n.x, n.y, n.seed)).join("")}
        <circle class="preview-fetch" r="2.4" fill="#b6e34a"/>
        <circle class="preview-fetch delay" r="1.8" fill="#9dffc2"/>
        <g class="preview-spider">
          <path class="leg a" d="M0 0 L-9 -7"/>
          <path class="leg b" d="M0 0 L-10 -1"/>
          <path class="leg a" d="M0 0 L-9 6"/>
          <path class="leg b" d="M0 0 L-7 8"/>
          <path class="leg a" d="M0 0 L9 -7"/>
          <path class="leg b" d="M0 0 L10 -1"/>
          <path class="leg a" d="M0 0 L9 6"/>
          <path class="leg b" d="M0 0 L7 8"/>
          <ellipse class="abdomen" cx="-3.2" cy="1.2" rx="5.2" ry="3.4"/>
          <circle class="cephalon" cx="3.4" cy="-0.4" r="3.1"/>
        </g>
      </svg>
      <div class="preview-pings" data-role="preview-pings"></div>
      <div class="preview-live"><span></span> crawl</div>
      <div class="preview-stream" data-role="preview-stream">${stream}</div>
    </div>`;
  }
  function previewStreamHtml(state, running) {
    const lines = state.lines.slice(-MAX_STREAM);
    if (!lines.length) {
      const fallback = running ? "nas\u0142uchiwanie log\xF3w\u2026" : "projekt w u\u015Bpieniu";
      return `<p class="preview-line muted">${escapePreview(fallback)}</p>`;
    }
    return lines.map(
      (line, i) => `<p class="preview-line${i === lines.length - 1 ? " current" : ""}">${escapePreview(
        line
      )}</p>`
    ).join("");
  }
  function escapePreview(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function applyPreviewToCard(card, id, running) {
    const root = card.querySelector('[data-role="preview"]');
    if (!root) return;
    const state = getPreviewState(id);
    state.running = running;
    root.dataset.running = running ? "true" : "false";
    root.dataset.kind = running ? state.kind || "boot" : "idle";
    const stream = root.querySelector('[data-role="preview-stream"]');
    if (stream) stream.innerHTML = previewStreamHtml(state, running);
  }
  function spawnPreviewPing(card, kind) {
    const nodes = card.querySelectorAll(".preview-node");
    if (!nodes.length) return;
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    node.classList.remove("hot", "kind-error", "kind-warn", "kind-vpn");
    const extra = kind === "error" || kind === "warn" ? `kind-${kind}` : kind === "vpn" || kind === "mcp" ? "kind-vpn" : "";
    requestAnimationFrame(() => {
      node.classList.add("hot");
      if (extra) node.classList.add(extra);
    });
    window.setTimeout(() => {
      node.classList.remove("hot", "kind-error", "kind-warn", "kind-vpn");
    }, 720);
  }
  function maybePing(id, kind) {
    const now = Date.now();
    const last = pingAt.get(id) || 0;
    if (now - last < 90) return;
    pingAt.set(id, now);
    const card = document.querySelector(`.project-card[data-id="${cssEscape(id)}"]`);
    if (!card) return;
    spawnPreviewPing(card, kind);
  }
  function cssEscape(id) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(id);
    }
    return id.replace(/"/g, '\\"');
  }

  // src/renderer/main.ts
  function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
  }
  var el = {
    setup: $("#setup"),
    main: $("#main-ui"),
    settings: $("#settings"),
    projectList: $("#project-list"),
    newCountry: $("#new-country"),
    newName: $("#new-name"),
    newParent: $("#new-parent"),
    newOpenCursor: $("#new-open-cursor"),
    modalNew: $("#modal-new"),
    busyBar: $("#busy-bar"),
    log: $("#log"),
    error: $("#error"),
    privateKey: $("#private-key"),
    updateBanner: $("#update-banner"),
    updateTitle: $("#update-title"),
    updateDetail: $("#update-detail"),
    updateProgress: $("#update-progress"),
    updateProgressBar: $("#update-progress-bar"),
    btnUpdateDownload: $("#btn-update-download"),
    btnUpdateInstall: $("#btn-update-install"),
    appVersion: $("#app-version"),
    ollamaEnabled: $("#ollama-enabled"),
    ollamaUrl: $("#ollama-url"),
    ollamaStatus: $("#ollama-status"),
    serperEnabled: $("#serper-enabled"),
    serperKey: $("#serper-key"),
    serperStatus: $("#serper-status"),
    hostWgName: $("#hostwg-name"),
    hostWgConfig: $("#hostwg-config"),
    hostWgStatus: $("#hostwg-status"),
    newCrawlModel: $("#new-crawl-model"),
    newAntibotModel: $("#new-antibot-model"),
    newWorkers: $("#new-workers"),
    newOptionsList: $("#new-options-list"),
    modalEnv: $("#modal-env"),
    envFields: $("#env-fields"),
    envProjectName: $("#env-project-name"),
    envHint: $("#env-hint"),
    modalDup: $("#modal-dup"),
    dupSourceLabel: $("#dup-source-label"),
    dupName: $("#dup-name"),
    dupFolder: $("#dup-folder"),
    dupParent: $("#dup-parent"),
    dupOpenCursor: $("#dup-open-cursor")
  };
  function log2(line) {
    log(el.log, line);
  }
  function setError2(msg) {
    setError(el.error, msg);
  }
  function setBusy2(on) {
    setBusy(el.busyBar, on, { preserveIds: ["btn-settings", "btn-settings-back"] });
  }
  function withBusy(fn) {
    if (isBusy()) return Promise.resolve(null);
    setBusy2(true);
    setError2("");
    return Promise.resolve().then(fn).then((snap) => {
      if (snap && typeof snap === "object") {
        renderSnapshot(snap);
        return snap;
      }
      return null;
    }).catch((err) => {
      setError2(errMsg(err));
      return null;
    }).finally(() => setBusy2(false));
  }
  function formatProjectIpLine(info) {
    if (!info) return "IP: \u2014";
    if (info.ip) {
      const bits = [info.ip];
      if (info.country) bits.push(info.country);
      if (info.city) bits.push(info.city);
      if (info.org) bits.push(info.org);
      if (info.via === "host") bits.push("(host)");
      return `IP: ${bits.join(" \xB7 ")}`;
    }
    return `IP: ${info.error || "niedost\u0119pne"}`;
  }
  var snapshot = null;
  var view = "projects";
  var selectedProjectId = null;
  var projectLogBuffer = "";
  var envEditProjectId = null;
  var dupSourceId = null;
  var dupFolderTouched = false;
  var projectIpCache = /* @__PURE__ */ new Map();
  var followedLogIds = /* @__PURE__ */ new Set();
  var previewBackfillUntil = /* @__PURE__ */ new Map();
  var lastProjectsRenderKey = "";
  function showView(name) {
    view = name;
    el.settings.classList.toggle("hidden", name !== "settings");
    if (!snapshot?.setupNeeded) {
      el.main.classList.toggle("hidden", name !== "projects");
    }
  }
  function setOllamaStatus(text, kind) {
    if (!el.ollamaStatus) return;
    el.ollamaStatus.textContent = text || "";
    el.ollamaStatus.classList.remove("ok", "err");
    if (kind) el.ollamaStatus.classList.add(kind);
  }
  function ollamaModelList(models) {
    return Array.isArray(models) ? models.filter((m) => !!m) : [];
  }
  function modelSelectOptions(selected, models) {
    const current = String(selected || "").trim();
    const list = [...ollamaModelList(models)];
    if (current && !list.includes(current)) list.unshift(current);
    if (!list.length) {
      const label = current || "Brak modeli \u2014 sprawd\u017A Ollam\u0119";
      return `<option value="${escapeHtml(current)}">${escapeHtml(label)}</option>`;
    }
    return list.map(
      (m) => `<option value="${escapeHtml(m)}"${m === current ? " selected" : ""}>${escapeHtml(m)}</option>`
    ).join("");
  }
  function fillModelSelect(selectEl, selected, models) {
    if (!selectEl) return;
    const prev = selected != null ? selected : selectEl.value;
    selectEl.innerHTML = modelSelectOptions(prev, models);
  }
  function fillOllamaModels(models) {
    const list = ollamaModelList(models);
    if (snapshot?.ollama) snapshot.ollama.models = list;
    fillModelSelect(el.newCrawlModel, el.newCrawlModel?.value, list);
    fillModelSelect(el.newAntibotModel, el.newAntibotModel?.value, list);
    $$(
      'select[data-role="crawl-model"], select[data-role="antibot-model"]'
    ).forEach((node) => fillModelSelect(node, node.value, list));
  }
  async function refreshOllamaModelsForSelect(selectEl) {
    if (!selectEl) return;
    try {
      const baseUrl = (el.ollamaUrl?.value || "").trim() || snapshot?.ollama?.baseUrl || "http://127.0.0.1:11434";
      const result = await api().checkOllama(baseUrl);
      if (result?.ok) {
        fillOllamaModels(result.models);
        if (snapshot?.ollama) {
          snapshot.ollama.ok = true;
          snapshot.ollama.error = "";
        }
      } else if (result?.models?.length) {
        fillOllamaModels(result.models);
      }
    } catch {
    }
  }
  function renderOllama(ollama) {
    if (!el.ollamaEnabled || !el.ollamaUrl) return;
    const cfg = ollama || {};
    el.ollamaEnabled.checked = cfg.enabled !== false;
    if (document.activeElement !== el.ollamaUrl) {
      el.ollamaUrl.value = cfg.baseUrl || "http://127.0.0.1:11434";
    }
    fillOllamaModels(cfg.models);
    if (cfg.enabled === false) {
      setOllamaStatus("Wy\u0142\u0105czona \u2014 projekty nie dostan\u0105 OLLAMA_*", "");
    } else if (cfg.ok) {
      const n = Array.isArray(cfg.models) ? cfg.models.length : 0;
      setOllamaStatus(`OK \u2014 ${n} model${n === 1 ? "" : "i"} (wyb\xF3r per projekt)`, "ok");
    } else if (cfg.error && cfg.error !== "disabled") {
      setOllamaStatus(`B\u0142\u0105d: ${cfg.error}`, "err");
    } else {
      setOllamaStatus("", "");
    }
  }
  function setSerperStatus(text, kind) {
    if (!el.serperStatus) return;
    el.serperStatus.textContent = text || "";
    el.serperStatus.classList.remove("ok", "err");
    if (kind) el.serperStatus.classList.add(kind);
  }
  function renderSerper(serper) {
    if (!el.serperEnabled || !el.serperKey) return;
    const cfg = serper || {};
    el.serperEnabled.checked = cfg.enabled !== false;
    if (document.activeElement !== el.serperKey) {
      el.serperKey.value = cfg.apiKey || "";
    }
    if (cfg.enabled === false) {
      setSerperStatus("Wy\u0142\u0105czony \u2014 projekty nie dostan\u0105 SERPER_API_KEY", "");
    } else if (cfg.configured) {
      setSerperStatus(`Klucz ustawiony (${cfg.masked || "\u2022\u2022\u2022\u2022"})`, "ok");
    } else {
      setSerperStatus("Brak klucza \u2014 wklej API key z serper.dev", "err");
    }
  }
  function setHostWgStatus(text, kind) {
    if (!el.hostWgStatus) return;
    el.hostWgStatus.textContent = text || "";
    el.hostWgStatus.classList.remove("ok", "err");
    if (kind) el.hostWgStatus.classList.add(kind);
  }
  function renderHostWg(hostWg) {
    if (!el.hostWgName || !el.hostWgConfig) return;
    const cfg = hostWg || {};
    if (document.activeElement !== el.hostWgName) {
      el.hostWgName.value = cfg.name || "wg0";
    }
    if (document.activeElement !== el.hostWgConfig) {
      el.hostWgConfig.value = cfg.configText || "";
    }
    if (cfg.configured) {
      if (cfg.up) {
        setHostWgStatus(`Exitly trzyma tunel ${cfg.name || "wg0"} \u2014 CRM LAN OK`, "ok");
      } else if (cfg.managed) {
        setHostWgStatus(
          `Config OK \xB7 Exitly podniesie ${cfg.name || "wg0"} przy starcie`,
          ""
        );
      } else {
        setHostWgStatus(
          `Config ${cfg.name || "wg0"} zapisany \u2014 w\u0142\u0105cz \u201ECRM (Exitly)\u201D na projekcie`,
          ""
        );
      }
    } else {
      setHostWgStatus("Brak configu \u2014 wklej conf WireGuard i zapisz", "err");
    }
  }
  function fillCountrySelect(select, countries, active) {
    if (!select) return;
    select.innerHTML = "";
    for (const c of countries || []) {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${c.code.toUpperCase()} \u2014 ${c.name}`;
      if (c.code === active) opt.selected = true;
      select.appendChild(opt);
    }
  }
  function countryFromExit(exit, snap) {
    if (!exit || exit === "proton-vpn") return snap?.active || "ro";
    const m = String(exit).match(/^vpn-([a-z]{2})$/i);
    if (m?.[1]) return m[1].toLowerCase();
    if (/^exitly-vpn-/.test(String(exit))) return snap?.active || "ro";
    return String(exit).toLowerCase();
  }
  function appendProjectLog(line) {
    const pre = document.querySelector(
      `.project-card[data-id="${selectedProjectId}"] [data-role="project-log"]`
    );
    if (!pre) return;
    projectLogBuffer += `${line}
`;
    if (projectLogBuffer.length > 8e4) {
      projectLogBuffer = projectLogBuffer.slice(-6e4);
    }
    pre.textContent = projectLogBuffer;
    pre.scrollTop = pre.scrollHeight;
  }
  async function attachProjectLogs(id) {
    selectedProjectId = id;
    projectLogBuffer = "";
    try {
      const res = await api().getProjectLogs(id);
      projectLogBuffer = typeof res === "string" ? res : res?.text || "";
      const pre = document.querySelector(
        `.project-card[data-id="${id}"] [data-role="project-log"]`
      );
      if (pre) {
        pre.textContent = projectLogBuffer || "(brak log\xF3w)\n";
        pre.scrollTop = pre.scrollHeight;
      }
      seedPreviewLines(id, projectLogBuffer, isProjectRunning(id));
      const card = document.querySelector(`.project-card[data-id="${id}"]`);
      if (card) applyPreviewToCard(card, id, isProjectRunning(id));
      await ensureProjectLogFollow(id);
    } catch (err) {
      appendProjectLog(`(logi: ${errMsg(err)})`);
    }
  }
  async function detachProjectLogs() {
    if (!selectedProjectId) return;
    const id = selectedProjectId;
    selectedProjectId = null;
    projectLogBuffer = "";
    if (!isProjectRunning(id)) {
      await stopProjectLogFollow(id);
    }
  }
  function isProjectRunning(id) {
    return !!(snapshot?.crawlers || []).find((c) => c.id === id)?.running;
  }
  async function ensureProjectLogFollow(id) {
    if (followedLogIds.has(id)) return;
    followedLogIds.add(id);
    previewBackfillUntil.set(id, Date.now() + 1100);
    try {
      await api().followProjectLogs(id);
    } catch {
      followedLogIds.delete(id);
    }
  }
  async function stopProjectLogFollow(id) {
    if (!followedLogIds.has(id)) return;
    followedLogIds.delete(id);
    previewBackfillUntil.delete(id);
    try {
      await api().stopProjectLogs(id);
    } catch {
    }
  }
  async function syncProjectLogFollows(projects) {
    const wanted = new Set(
      projects.filter((p) => p.running || p.id === selectedProjectId).map((p) => p.id)
    );
    for (const id of [...followedLogIds]) {
      if (!wanted.has(id)) await stopProjectLogFollow(id);
    }
    for (const item of projects) {
      if (!wanted.has(item.id) || followedLogIds.has(item.id)) continue;
      try {
        const res = await api().getProjectLogs(item.id);
        const text = typeof res === "string" ? res : res?.text || "";
        seedPreviewLines(item.id, text, !!item.running);
        const card = document.querySelector(`.project-card[data-id="${item.id}"]`);
        if (card) applyPreviewToCard(card, item.id, !!item.running);
      } catch {
      }
      await ensureProjectLogFollow(item.id);
    }
  }
  function projectsRenderKey(projects) {
    return projects.map(
      (p) => [
        p.id,
        p.running ? "1" : "0",
        p.envReady === false ? "0" : "1",
        p.country || p.exit || "",
        p.crawlModel || "",
        p.antibotModel || "",
        p.workers || "",
        p.cliCommand || "",
        p.useHostWg ? "1" : "0",
        (p.envMissing || []).join(","),
        JSON.stringify(p.optionValues || {}),
        (p.envFields || []).map((f) => `${f.key}:${f.value || ""}:${f.missing ? 1 : 0}`).join(","),
        p.id === selectedProjectId ? "open" : ""
      ].join(":")
    ).join("|");
  }
  function renderProjects(snap) {
    const projects = (snap.crawlers || []).filter((c) => c.kind === "project");
    const knownIds = new Set(projects.map((p) => p.id));
    for (const id of [...followedLogIds]) {
      if (!knownIds.has(id)) {
        void stopProjectLogFollow(id);
        dropPreviewState(id);
      }
    }
    if (!projects.length) {
      lastProjectsRenderKey = "";
      el.projectList.innerHTML = `
      <div class="project-empty">
        <strong>Brak projekt\xF3w</strong>
        Utw\xF3rz nowy (Docker), otw\xF3rz istniej\u0105cy CLI albo zaimportuj .zip.
      </div>`;
      return;
    }
    if (selectedProjectId && !projects.some((p) => p.id === selectedProjectId)) {
      void detachProjectLogs();
    }
    const renderKey = projectsRenderKey(projects);
    if (renderKey === lastProjectsRenderKey && el.projectList.querySelector(".project-card")) {
      void syncProjectLogFollows(projects);
      return;
    }
    lastProjectsRenderKey = renderKey;
    el.projectList.innerHTML = "";
    for (const item of projects) {
      const running = !!item.running;
      const open = selectedProjectId === item.id;
      const isCli = item.runMode === "cli";
      const card = document.createElement("article");
      card.className = "project-card";
      card.dataset.id = item.id;
      card.dataset.open = open ? "true" : "false";
      card.dataset.running = running ? "true" : "false";
      card.dataset.mode = isCli ? "cli" : "docker";
      const country = item.country || countryFromExit(item.exit, snap);
      const options = (snap.countries || []).map(
        (c) => `<option value="${escapeHtml(c.code)}" ${c.code === country ? "selected" : ""}>${escapeHtml(c.code.toUpperCase())} \u2014 ${escapeHtml(c.name)}</option>`
      ).join("");
      const crawlModel = item.crawlModel || snap.ollama?.defaults?.crawlModel || "qwen2.5:14b";
      const antibotModel = item.antibotModel || snap.ollama?.defaults?.antibotModel || "captchamind:7b";
      const workers = Math.min(8, Math.max(1, Number(item.workers) || 1));
      const cliLabel = item.cliCommand ? pathBasename(item.cliCommand) : "CLI";
      const cliShells = Array.isArray(snap.cliShells) ? snap.cliShells : [];
      const currentCliBase = pathBasename(item.cliCommand || "opencode").replace(
        /\.(exe|cmd|bat)$/i,
        ""
      );
      const cliShellOptions = (() => {
        const opts = cliShells.map((s) => {
          const selected = s.command === currentCliBase || pathBasename(s.resolved || "") === pathBasename(item.cliCommand || "");
          const mark = s.available ? "" : " (brak)";
          return `<option value="${escapeHtml(s.command)}" ${selected ? "selected" : ""} ${s.available ? "" : "disabled"}>${escapeHtml(s.label)}${mark}</option>`;
        });
        const known = new Set(cliShells.map((s) => s.command));
        if (currentCliBase && !known.has(currentCliBase)) {
          opts.push(
            `<option value="${escapeHtml(currentCliBase)}" selected>${escapeHtml(
              currentCliBase
            )} (custom)</option>`
          );
        }
        return opts.join("");
      })();
      const statusLabel = running ? isCli ? "W terminalu" : "W\u0142\u0105czony" : item.envReady === false ? "Brak env" : "Wy\u0142\u0105czony";
      const ollamaModels = snap.ollama?.models || [];
      const workersOptions = [1, 2, 3, 4, 5, 6, 7, 8].map(
        (n) => `<option value="${n}" ${n === workers ? "selected" : ""}>${n}${n === 1 ? " (bezpiecznie)" : n >= 3 ? " (ryzyko blokady)" : ""}</option>`
      ).join("");
      const cliMetaHtml = isCli ? `<label class="field">
          <span>Shell</span>
          <select data-role="cli-shell">${cliShellOptions}</select>
        </label>
        <p class="project-cli-meta">Uruchom: <code>${escapeHtml(
        item.cliCommand || cliLabel
      )}</code>${(item.cliArgs || []).length ? ` ${(item.cliArgs || []).map(escapeHtml).join(" ")}` : ""}${item.envReady === false ? ` \xB7 <span class="env-warn">brak: ${(item.envMissing || []).slice(0, 3).map(escapeHtml).join(", ")}</span>` : ""}</p>` : "";
      const modelsHtml = `
        ${cliMetaHtml}
        <label class="field">
          <span>${isCli ? "Model Ollama" : "Model crawl4ai"}</span>
          <select data-role="crawl-model">${modelSelectOptions(
        crawlModel,
        ollamaModels
      )}</select>
        </label>
        <label class="field">
          <span>${isCli ? "Model CaptchaMind" : "Model antybot"}</span>
          <select data-role="antibot-model">${modelSelectOptions(
        antibotModel,
        ollamaModels
      )}</select>
        </label>
        ${isCli ? "" : `<label class="field">
          <span>Workery</span>
          <select data-role="workers">${workersOptions}</select>
        </label>`}`;
      const startOptions = Array.isArray(item.options) ? item.options : [];
      const startValues = item.optionValues || {};
      const optionsHtml = startOptions.length ? `<div class="project-start-options" data-role="start-options">
          ${startOptions.map((opt) => renderStartOptionInput(opt, startValues[opt.id])).join("")}
        </div>` : "";
      const envFields = Array.isArray(item.envFields) ? item.envFields : [];
      const requiredEnv = envFields.filter((f) => f.required);
      const envInlineHtml = requiredEnv.length ? `<div class="project-env-inline" data-role="env-inline">
          ${requiredEnv.map(
        (f) => `<label class="field">
            <span>${escapeHtml(f.label)}${f.missing ? " *" : ""}</span>
            <input
              data-env-key="${escapeHtml(f.key)}"
              type="${f.secret ? "password" : "text"}"
              autocomplete="off"
              spellcheck="false"
              placeholder="${escapeHtml(f.placeholder || f.key)}"
              value="${escapeHtml(f.value || "")}"
            />
          </label>`
      ).join("")}
          <button type="button" class="ghost tiny" data-role="save-env-inline">Zapisz env</button>
        </div>` : "";
      const extraActions = [
        `<button type="button" class="ghost" data-role="check-ip">IP</button>`,
        `<button type="button" class="ghost" data-role="save-models">Zapisz modele</button>`,
        (item.envFieldCount || 0) > 0 || isCli ? `<button type="button" class="ghost" data-role="env">Env</button>` : "",
        `<button type="button" class="ghost" data-role="edit-options">Opcje</button>`,
        isCli ? `<button type="button" class="ghost" data-role="test-mcp">MCP</button>` : "",
        `<button type="button" class="ghost" data-role="export">Eksport</button>`,
        `<button type="button" class="ghost" data-role="duplicate">Duplikuj</button>`
      ].filter(Boolean).join("\n         ");
      card.innerHTML = `
      ${renderPreviewHtml(item.id, running)}
      <div class="project-top">
        <div>
          <p class="project-name">${escapeHtml(item.name)} <span class="mode-tag">${isCli ? escapeHtml(cliLabel || "CLI") : "Docker"}</span></p>
          <p class="project-path">${escapeHtml(item.path || "")}</p>
          <p class="project-ip muted" data-role="ip-line">IP: \u2014</p>
        </div>
        <span class="badge ${running ? "on" : item.envReady === false ? "warn" : ""}">${statusLabel}</span>
      </div>
      <div class="project-controls ${isCli ? "cli" : ""}">
        <label class="field">
          <span>${isCli ? "Kraj VPN" : "Kraj"}</span>
          <select data-role="country">${options}</select>
        </label>
        ${modelsHtml}
        ${envInlineHtml}
        ${optionsHtml}
        <label class="check project-hostwg">
          <input type="checkbox" data-role="host-wg" ${item.useHostWg ? "checked" : ""} />
          ${isCli ? "CRM LAN (Docker)" : "CRM LAN (Docker + VPN)"}
        </label>
        <div class="project-actions">
          ${extraActions}
          <button type="button" class="${running ? "danger" : "primary"}" data-role="toggle">
            ${running ? isCli ? "Zatrzymaj" : "Wy\u0142\u0105cz" : isCli ? "Uruchom" : "W\u0142\u0105cz"}
          </button>
          <button type="button" class="ghost" data-role="logs">${open ? "Ukryj logi" : "Logi"}</button>
          <button type="button" class="ghost" data-role="cursor">Cursor</button>
          <button type="button" class="ghost" data-role="remove">Usu\u0144</button>
        </div>
      </div>
      <div class="project-logs ${open ? "" : "hidden"}" data-role="logs-panel">
        <div class="project-logs-head">
          <span>${isCli ? "Logi CLI" : "Logi crawla"}</span>
          <button type="button" class="ghost tiny" data-role="refresh-logs">Od\u015Bwie\u017C</button>
        </div>
        <pre class="project-log" data-role="project-log"></pre>
      </div>
    `;
      const logsPanel = requireEl(card, '[data-role="logs-panel"]');
      if (!open) logsPanel.classList.add("hidden");
      if (open) {
        const pre = requireEl(card, '[data-role="project-log"]');
        pre.textContent = projectLogBuffer || "(\u0142adowanie\u2026)\n";
      }
      const ipLine = requireEl(card, '[data-role="ip-line"]');
      const cachedIp = projectIpCache.get(item.id);
      if (cachedIp) {
        ipLine.textContent = formatProjectIpLine(cachedIp);
        ipLine.classList.toggle("ok", !!cachedIp.ip && !cachedIp.error);
        ipLine.classList.toggle("warn", !cachedIp.ip || !!cachedIp.error);
      }
      requireEl(card, '[data-role="country"]').addEventListener(
        "change",
        (e) => {
          changeProjectCountry(item, e.target.value);
        }
      );
      const cliShellSelect = card.querySelector(
        '[data-role="cli-shell"]'
      );
      if (cliShellSelect) {
        cliShellSelect.addEventListener("change", (e) => {
          const command = (e.target.value || "").trim();
          if (!command) return;
          withBusy(async () => {
            log2(`${item.name}: shell \u2192 ${command}`);
            return api().setProjectCliShell(item.id, { command });
          });
        });
      }
      const hostWgToggle = card.querySelector('[data-role="host-wg"]');
      if (hostWgToggle) {
        hostWgToggle.addEventListener("change", (e) => {
          const target = e.target;
          const on = !!target.checked;
          withBusy(async () => {
            try {
              log2(
                `${item.name}: CRM (Exitly) ${on ? "W\u0141\u0104CZONE \u2014 apka trzyma tunel" : "wy\u0142\u0105czone"}`
              );
              return await api().setProjectUseHostWg(item.id, on);
            } catch (err) {
              target.checked = !on;
              throw err;
            }
          });
        });
      }
      const crawlSelect = card.querySelector(
        '[data-role="crawl-model"]'
      );
      const antibotSelect = card.querySelector(
        '[data-role="antibot-model"]'
      );
      const workersSelect = card.querySelector('[data-role="workers"]');
      const saveModelsBtn = card.querySelector(
        '[data-role="save-models"]'
      );
      if (saveModelsBtn) {
        saveModelsBtn.addEventListener("click", () => {
          const crawl = (crawlSelect?.value || "").trim() || "qwen2.5:14b";
          const antibot = (antibotSelect?.value || "").trim() || "captchamind:7b";
          const payload = {
            crawlModel: crawl,
            antibotModel: antibot
          };
          if (!isCli) {
            payload.workers = Math.min(
              8,
              Math.max(1, Number.parseInt(workersSelect?.value || "1", 10) || 1)
            );
          }
          withBusy(async () => {
            log2(
              isCli ? `${item.name}: ollama=${crawl} captcha=${antibot}` : `${item.name}: crawl=${crawl} antybot=${antibot} workers=${payload.workers}`
            );
            return api().setProjectModels(item.id, payload);
          });
        });
      }
      const envBtn = card.querySelector('[data-role="env"]');
      if (envBtn) {
        envBtn.addEventListener("click", () => {
          void openEnvModal(item);
        });
      }
      const saveEnvInline = card.querySelector(
        '[data-role="save-env-inline"]'
      );
      if (saveEnvInline) {
        saveEnvInline.addEventListener("click", () => {
          const values = {};
          card.querySelectorAll("[data-env-key]").forEach((input) => {
            const key = input.getAttribute("data-env-key");
            if (key) values[key] = input.value || "";
          });
          withBusy(async () => {
            log2(`${item.name}: zapisuj\u0119 env projektu`);
            return api().setProjectEnv(item.id, values);
          });
        });
      }
      const editOptsBtn = card.querySelector(
        '[data-role="edit-options"]'
      );
      if (editOptsBtn) {
        editOptsBtn.addEventListener("click", () => openEditOptionsPrompt(item));
      }
      const testMcpBtn = card.querySelector('[data-role="test-mcp"]');
      if (testMcpBtn) {
        testMcpBtn.addEventListener("click", () => {
          withBusy(async () => {
            log2(`${item.name}: test zdalnego MCP\u2026`);
            const res = await api().testProjectMcp(item.id);
            log2(
              res?.ok ? `${item.name}: MCP OK ${res.host}:${res.port}` : `${item.name}: MCP ${res?.error || "offline"}`
            );
            return null;
          });
        });
      }
      requireEl(card, '[data-role="check-ip"]').addEventListener(
        "click",
        async () => {
          ipLine.textContent = "IP: sprawdzam\u2026";
          ipLine.classList.remove("ok", "warn");
          try {
            const info = await api().checkProjectIp(item.id);
            projectIpCache.set(item.id, info);
            ipLine.textContent = formatProjectIpLine(info);
            ipLine.classList.toggle("ok", !!info.ip && !info.error);
            ipLine.classList.toggle("warn", !info.ip || !!info.error);
            if (info.ip) {
              log2(
                `${item.name}: ${info.ip}${info.country ? ` ${info.country}` : ""}${info.org ? ` \xB7 ${info.org}` : ""}`
              );
            } else if (info.error) {
              setError2(info.error);
            }
          } catch (err) {
            ipLine.textContent = "IP: b\u0142\u0105d";
            ipLine.classList.add("warn");
            setError2(errMsg(err));
          }
        }
      );
      requireEl(card, '[data-role="toggle"]').addEventListener(
        "click",
        () => {
          withBusy(async () => {
            if (running) {
              log2(`Wy\u0142\u0105czam ${item.name}`);
              const snapOut2 = await api().stopCrawler(item.id);
              if (selectedProjectId === item.id) await attachProjectLogs(item.id);
              return snapOut2;
            }
            const optionValues = collectStartOptionValues(card);
            log2(isCli ? `Uruchamiam CLI ${item.name}` : `W\u0142\u0105czam ${item.name}`);
            const snapOut = await api().startCrawler(item.id, optionValues);
            selectedProjectId = item.id;
            await attachProjectLogs(item.id);
            return snapOut;
          });
        }
      );
      requireEl(card, '[data-role="logs"]').addEventListener(
        "click",
        async () => {
          if (selectedProjectId === item.id) {
            await detachProjectLogs();
            if (snapshot) renderProjects(snapshot);
            return;
          }
          selectedProjectId = item.id;
          if (snapshot) renderProjects(snapshot);
          await attachProjectLogs(item.id);
        }
      );
      requireEl(card, '[data-role="refresh-logs"]').addEventListener(
        "click",
        async () => {
          await attachProjectLogs(item.id);
        }
      );
      requireEl(card, '[data-role="cursor"]').addEventListener(
        "click",
        async () => {
          try {
            await api().openInCursor(item.id);
          } catch (err) {
            setError2(errMsg(err));
          }
        }
      );
      requireEl(card, '[data-role="export"]').addEventListener(
        "click",
        () => {
          withBusy(async () => {
            log2(`Eksportuj\u0119 ${item.name}`);
            const out = await api().exportProject(item.id);
            if (out?.path) log2(`Zapisano: ${out.path}`);
            return null;
          });
        }
      );
      requireEl(card, '[data-role="duplicate"]').addEventListener(
        "click",
        () => {
          openDupModal(item);
        }
      );
      requireEl(card, '[data-role="remove"]').addEventListener(
        "click",
        () => {
          if (!confirm(`Usun\u0105\u0107 \u201E${item.name}\u201D z listy?
Folder na dysku zostaje.`)) return;
          withBusy(async () => {
            if (selectedProjectId === item.id) await detachProjectLogs();
            projectIpCache.delete(item.id);
            dropPreviewState(item.id);
            log2(`Usuwam ${item.name}`);
            return api().removeCrawler(item.id);
          });
        }
      );
      applyPreviewToCard(card, item.id, running);
      el.projectList.appendChild(card);
    }
    void syncProjectLogFollows(projects);
  }
  function pathBasename(p) {
    const s = String(p || "");
    const parts = s.split(/[/\\]/);
    return parts[parts.length - 1] || s;
  }
  function renderStartOptionInput(opt, value) {
    const v = value != null ? value : opt.default || "";
    const req = opt.required ? " *" : "";
    if (opt.type === "checkbox") {
      const on = /^(1|true|yes|on)$/i.test(String(v));
      return `<label class="check start-opt">
      <input type="checkbox" data-opt-id="${escapeHtml(opt.id)}" ${on ? "checked" : ""} />
      ${escapeHtml(opt.label)}${req}
    </label>`;
    }
    if (opt.type === "select") {
      const choices = opt.choices || [];
      return `<label class="field start-opt">
      <span>${escapeHtml(opt.label)}${req}</span>
      <select data-opt-id="${escapeHtml(opt.id)}">
        ${choices.map(
        (c) => `<option value="${escapeHtml(c)}" ${String(c) === String(v) ? "selected" : ""}>${escapeHtml(c)}</option>`
      ).join("")}
      </select>
    </label>`;
    }
    return `<label class="field start-opt">
    <span>${escapeHtml(opt.label)}${req}</span>
    <input
      data-opt-id="${escapeHtml(opt.id)}"
      type="${opt.type === "number" ? "number" : "text"}"
      value="${escapeHtml(v)}"
      placeholder="${escapeHtml(opt.placeholder || opt.env || "")}"
    />
  </label>`;
  }
  function collectStartOptionValues(card) {
    const values = {};
    card.querySelectorAll("[data-opt-id]").forEach((node) => {
      const id = node.getAttribute("data-opt-id");
      if (!id) return;
      if (node instanceof HTMLInputElement && node.type === "checkbox") {
        values[id] = node.checked ? "1" : "0";
      } else {
        values[id] = node.value || "";
      }
    });
    return values;
  }
  function renderNewOptionRow(opt = {}) {
    const row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = `
    <input data-f="id" type="text" placeholder="id (np. limit)" value="${escapeHtml(opt.id || "")}" />
    <input data-f="label" type="text" placeholder="Etykieta" value="${escapeHtml(opt.label || "")}" />
    <select data-f="type">
      ${["text", "number", "checkbox", "select"].map(
      (t) => `<option value="${t}" ${opt.type === t ? "selected" : ""}>${t}</option>`
    ).join("")}
    </select>
    <select data-f="apply">
      ${["env", "arg", "both"].map(
      (t) => `<option value="${t}" ${(opt.apply || "env") === t ? "selected" : ""}>${t}</option>`
    ).join("")}
    </select>
    <input data-f="env" type="text" placeholder="ENV (opcjonalnie)" value="${escapeHtml(opt.env || "")}" />
    <input data-f="arg" type="text" placeholder="arg np. --limit" value="${escapeHtml(opt.arg || "")}" />
    <input data-f="default" type="text" placeholder="domy\u015Blna" value="${escapeHtml(opt.default || "")}" />
    <button type="button" class="ghost tiny" data-f="remove">\xD7</button>
  `;
    requireEl(row, '[data-f="remove"]').addEventListener(
      "click",
      () => row.remove()
    );
    return row;
  }
  function collectNewOptionsFromModal() {
    if (!el.newOptionsList) return [];
    return Array.from(el.newOptionsList.querySelectorAll(".option-row")).map((row) => {
      const get = (f) => {
        const node = row.querySelector(`[data-f="${f}"]`);
        return (node?.value || "").trim();
      };
      return {
        id: get("id"),
        label: get("label"),
        type: get("type") || "text",
        apply: get("apply") || "env",
        env: get("env"),
        arg: get("arg"),
        default: get("default"),
        required: false
      };
    }).filter((o) => o.id || o.label);
  }
  function openEditOptionsPrompt(item) {
    const current = (item.options || []).map(
      (o) => `${o.id}|${o.label}|${o.type}|${o.apply || "env"}|${o.env || ""}|${o.arg || ""}|${o.default || ""}`
    ).join("\n");
    const text = prompt(
      "Opcje startu (jedna na lini\u0119):\nid|etykieta|text|env|ENV_NAME|--flag|domy\u015Blna\n\nTypy: text, number, checkbox, select\nApply: env, arg, both",
      current || "limit|Limit|number|env|EXITLY_OPT_LIMIT|--limit|5"
    );
    if (text == null) return;
    const options = text.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [id, label, type, apply, env, arg, def] = line.split("|").map((s) => (s || "").trim());
      return {
        id: id || "",
        label: label || "",
        type: type || "text",
        apply: apply || "env",
        env,
        arg,
        default: def
      };
    });
    withBusy(async () => {
      log2(`${item.name}: aktualizacja opcji (${options.length})`);
      return api().setProjectStartOptions(item.id, {
        options,
        optionValues: item.optionValues || {}
      });
    });
  }
  async function openEnvModal(item) {
    if (!el.modalEnv || !item) return;
    envEditProjectId = item.id;
    el.envProjectName.innerHTML = `Projekt <strong>${escapeHtml(
      item.name
    )}</strong> \u2014 zapis do <code>.env</code>`;
    el.envFields.innerHTML = `<p class="meta">\u0141adowanie\u2026</p>`;
    el.envHint.textContent = "";
    el.modalEnv.classList.remove("hidden");
    try {
      const data = await api().getProjectEnv(item.id);
      const fields = data.fields || [];
      if (!fields.length) {
        el.envFields.innerHTML = `<p class="meta">Brak p\xF3l tylko dla tego projektu. Serper i Ollama ustawiasz w <strong>Ustawieniach</strong> aplikacji.</p>`;
        return;
      }
      el.envFields.innerHTML = fields.map(
        (f) => `
      <label class="field">
        <span>${escapeHtml(f.label)}${f.required ? " *" : ""}</span>
        <input
          data-env-key="${escapeHtml(f.key)}"
          type="${f.secret ? "password" : "text"}"
          autocomplete="off"
          spellcheck="false"
          placeholder="${escapeHtml(f.placeholder || "")}"
          value="${escapeHtml(f.value || "")}"
        />
      </label>`
      ).join("");
      if (data.missingRequired?.length) {
        el.envHint.textContent = `Wymagane puste: ${data.missingRequired.join(", ")}`;
      } else {
        el.envHint.textContent = data.path ? `Plik: ${data.path}` : "";
      }
    } catch (err) {
      el.envFields.innerHTML = "";
      setError2(errMsg(err));
      closeEnvModal();
    }
  }
  function closeEnvModal() {
    envEditProjectId = null;
    if (el.modalEnv) el.modalEnv.classList.add("hidden");
  }
  function changeProjectCountry(item, code) {
    withBusy(async () => {
      log2(`${item.name} \u2192 ${String(code).toUpperCase()}`);
      return api().setCrawlerExit(item.id, code);
    });
  }
  function renderSnapshot(snap) {
    snapshot = snap;
    if (snap.setupNeeded) {
      el.setup.classList.remove("hidden");
      el.main.classList.add("hidden");
      el.settings.classList.add("hidden");
      return;
    }
    el.setup.classList.add("hidden");
    showView(view === "settings" ? "settings" : "projects");
    fillCountrySelect(el.newCountry, snap.countries, snap.active || "ro");
    renderProjects(snap);
    renderOllama(snap.ollama);
    renderSerper(snap.serper);
    renderHostWg(snap.hostWg);
  }
  async function refresh() {
    setError2("");
    try {
      const snap = await api().getSnapshot();
      if (!snap.ok && snap.error) setError2(snap.error);
      renderSnapshot(snap);
    } catch (err) {
      setError2(errMsg(err));
    }
  }
  function openNewModal() {
    el.newName.value = "";
    fillCountrySelect(el.newCountry, snapshot?.countries, snapshot?.active || "ro");
    const defaults = snapshot?.ollama?.defaults || {};
    const models = snapshot?.ollama?.models || [];
    fillModelSelect(el.newCrawlModel, defaults.crawlModel || "qwen2.5:14b", models);
    fillModelSelect(el.newAntibotModel, defaults.antibotModel || "captchamind:7b", models);
    void refreshOllamaModelsForSelect(el.newCrawlModel);
    if (el.newOptionsList) {
      el.newOptionsList.innerHTML = "";
    }
    el.modalNew.classList.remove("hidden");
    el.newName.focus();
  }
  function closeNewModal() {
    el.modalNew.classList.add("hidden");
  }
  function openDupModal(item) {
    dupSourceId = item.id;
    dupFolderTouched = false;
    const suggestedName = `${item.name} kopia`;
    el.dupName.value = suggestedName;
    el.dupFolder.value = slugifyFolderName(suggestedName);
    el.dupParent.value = parentDirOf(item.path || "");
    if (el.dupOpenCursor) el.dupOpenCursor.checked = false;
    if (el.dupSourceLabel) {
      el.dupSourceLabel.textContent = `\u0179r\xF3d\u0142o: ${item.name} \u2192 nowa nazwa i folder (kontenery Docker osobne).`;
    }
    el.modalDup.classList.remove("hidden");
    el.dupName.focus();
    el.dupName.select();
  }
  function closeDupModal() {
    el.modalDup.classList.add("hidden");
    dupSourceId = null;
    dupFolderTouched = false;
  }
  $("#btn-settings").addEventListener("click", () => showView("settings"));
  $("#btn-settings-back").addEventListener("click", () => showView("projects"));
  $("#btn-ollama-save").addEventListener("click", () => {
    withBusy(async () => {
      const enabled = !!el.ollamaEnabled.checked;
      const baseUrl = (el.ollamaUrl.value || "").trim() || "http://127.0.0.1:11434";
      log2(`Zapisuj\u0119 Ollam\u0119 (${enabled ? baseUrl : "off"})`);
      return api().setOllama({ enabled, baseUrl });
    });
  });
  $("#btn-ollama-test").addEventListener("click", async () => {
    setError2("");
    setOllamaStatus("Sprawdzam\u2026", "");
    try {
      const baseUrl = (el.ollamaUrl.value || "").trim() || "http://127.0.0.1:11434";
      const result = await api().checkOllama(baseUrl);
      fillOllamaModels(result.models);
      if (result.ok) {
        const n = Array.isArray(result.models) ? result.models.length : 0;
        setOllamaStatus(`OK \u2014 ${n} model${n === 1 ? "" : "i"} (wyb\xF3r per projekt)`, "ok");
        log2(`Ollama OK (${n} modeli)`);
      } else {
        setOllamaStatus(`B\u0142\u0105d: ${result.error || "niedost\u0119pna"}`, "err");
        log2(`Ollama b\u0142\u0105d: ${result.error || "?"}`);
      }
    } catch (err) {
      setOllamaStatus(`B\u0142\u0105d: ${errMsg(err)}`, "err");
      setError2(errMsg(err));
    }
  });
  $("#btn-serper-save").addEventListener("click", () => {
    withBusy(async () => {
      const enabled = !!el.serperEnabled.checked;
      const apiKey = (el.serperKey.value || "").trim();
      log2(`Zapisuj\u0119 Serper (${enabled ? apiKey ? "klucz" : "bez klucza" : "off"})`);
      return api().setSerper({ enabled, apiKey });
    });
  });
  $("#btn-hostwg-save").addEventListener("click", () => {
    withBusy(async () => {
      const name = (el.hostWgName.value || "").trim() || "wg0";
      const configText = el.hostWgConfig.value || "";
      log2(`Zapisuj\u0119 host WG (${name})`);
      return api().setHostWg({ name, configText });
    });
  });
  $("#btn-hostwg-test")?.addEventListener("click", async () => {
    setHostWgStatus("Exitly podnosi tunel CRM\u2026", "");
    try {
      await api().testHostWg();
      setHostWgStatus("Tunel CRM aktywny (Exitly)", "ok");
      log2("CRM LAN: Exitly OK");
      const snap = await api().getSnapshot();
      if (snap) renderSnapshot(snap);
    } catch (err) {
      setHostWgStatus(errMsg(err), "err");
      setError2(errMsg(err));
    }
  });
  $("#btn-serper-test").addEventListener("click", async () => {
    setError2("");
    setSerperStatus("Sprawdzam\u2026", "");
    try {
      const apiKey = (el.serperKey.value || "").trim();
      const result = await api().checkSerper(apiKey);
      if (result.ok) {
        setSerperStatus(`OK \u2014 klucz dzia\u0142a (${result.masked || "\u2022\u2022\u2022\u2022"})`, "ok");
        log2("Serper OK");
      } else {
        setSerperStatus(`B\u0142\u0105d: ${result.error || "niedost\u0119pny"}`, "err");
        log2(`Serper b\u0142\u0105d: ${result.error || "?"}`);
      }
    } catch (err) {
      setSerperStatus(`B\u0142\u0105d: ${errMsg(err)}`, "err");
      setError2(errMsg(err));
    }
  });
  $("#btn-new-project").addEventListener("click", openNewModal);
  $("#btn-new-cancel").addEventListener("click", closeNewModal);
  el.modalNew.addEventListener("click", (e) => {
    if (e.target === el.modalNew) closeNewModal();
  });
  $("#btn-dup-cancel")?.addEventListener("click", closeDupModal);
  el.modalDup?.addEventListener("click", (e) => {
    if (e.target === el.modalDup) closeDupModal();
  });
  el.dupName?.addEventListener("input", () => {
    if (dupFolderTouched) return;
    el.dupFolder.value = slugifyFolderName(el.dupName.value);
  });
  el.dupFolder?.addEventListener("input", () => {
    dupFolderTouched = true;
  });
  $("#btn-dup-pick-parent")?.addEventListener("click", async () => {
    const dir = await api().pickProjectParent();
    if (dir) el.dupParent.value = dir;
  });
  $("#btn-dup-create")?.addEventListener("click", () => {
    if (!dupSourceId) return;
    const name = (el.dupName.value || "").trim();
    const folderName = (el.dupFolder.value || "").trim();
    const parentDir = (el.dupParent.value || "").trim();
    if (!name) {
      setError2("Podaj nazw\u0119 projektu");
      return;
    }
    if (!folderName) {
      setError2("Podaj nazw\u0119 folderu");
      return;
    }
    if (!parentDir) {
      setError2("Wybierz folder nadrz\u0119dny");
      return;
    }
    const sourceId = dupSourceId;
    withBusy(async () => {
      closeDupModal();
      log2(`Duplikuj\u0119 \u2192 ${name} (${folderName})`);
      const snap = await api().duplicateProject({
        id: sourceId,
        name,
        folderName,
        parentDir,
        openCursor: !!el.dupOpenCursor?.checked
      });
      if (snap?.duplicatedProjectId) {
        selectedProjectId = snap.duplicatedProjectId;
        await attachProjectLogs(snap.duplicatedProjectId);
      }
      return snap;
    });
  });
  $("#btn-env-cancel").addEventListener("click", closeEnvModal);
  el.modalEnv.addEventListener("click", (e) => {
    if (e.target === el.modalEnv) closeEnvModal();
  });
  $("#btn-env-save").addEventListener("click", () => {
    if (!envEditProjectId) return;
    const projectId = envEditProjectId;
    const values = {};
    el.envFields.querySelectorAll("[data-env-key]").forEach((input) => {
      const key = input.getAttribute("data-env-key");
      if (key) values[key] = input.value || "";
    });
    withBusy(async () => {
      log2("Zapisuj\u0119 .env projektu");
      const snap = await api().setProjectEnv(projectId, values);
      closeEnvModal();
      return snap;
    });
  });
  $("#btn-pick-parent").addEventListener("click", async () => {
    const dir = await api().pickProjectParent();
    if (dir) el.newParent.value = dir;
  });
  $("#btn-new-create").addEventListener("click", () => {
    const name = (el.newName.value || "").trim();
    const parentDir = (el.newParent.value || "").trim();
    if (!name) {
      setError2("Podaj nazw\u0119 projektu");
      return;
    }
    if (!parentDir) {
      setError2("Wybierz folder");
      return;
    }
    const options = collectNewOptionsFromModal();
    withBusy(async () => {
      closeNewModal();
      log2(`Tworz\u0119 ${name}`);
      const code = el.newCountry.value || "ro";
      const snap = await api().createProject({
        name,
        parentDir,
        country: code,
        crawlModel: (el.newCrawlModel?.value || "").trim() || "qwen2.5:14b",
        antibotModel: (el.newAntibotModel?.value || "").trim() || "captchamind:7b",
        workers: Math.min(
          8,
          Math.max(1, Number.parseInt(el.newWorkers?.value || "1", 10) || 1)
        ),
        options,
        openCursor: !!el.newOpenCursor.checked
      });
      const created = (snap?.crawlers || []).find(
        (c) => c.kind === "project" && c.name === name
      );
      if (created) {
        selectedProjectId = created.id;
        await attachProjectLogs(created.id);
      }
      return snap;
    });
  });
  $("#btn-add-option")?.addEventListener("click", () => {
    if (!el.newOptionsList) return;
    el.newOptionsList.appendChild(renderNewOptionRow());
  });
  $("#btn-open-project").addEventListener(
    "click",
    () => withBusy(async () => {
      const projectPath = await api().pickExistingProject();
      if (!projectPath) return null;
      log2("Dodaj\u0119 projekt");
      return api().registerProject({
        projectPath,
        country: snapshot?.active || "ro"
      });
    })
  );
  $("#btn-import-project").addEventListener(
    "click",
    () => withBusy(async () => {
      log2("Importuj\u0119 projekt z ZIP\u2026");
      const snap = await api().importProject();
      if (!snap) return null;
      if (snap.importedProjectId) {
        selectedProjectId = snap.importedProjectId;
        await attachProjectLogs(snap.importedProjectId);
      }
      return snap;
    })
  );
  $("#btn-save-key").addEventListener(
    "click",
    () => withBusy(async () => {
      await api().setupEnv(el.privateKey.value);
      log2("Zapisano klucz");
      return api().getSnapshot();
    })
  );
  $("#btn-key-help").addEventListener("click", () => api().pickEnvHelp());
  $("#btn-refresh").addEventListener("click", () => refresh());
  api().onLog((line) => {
    if (line) log2(line);
  });
  api().onProjectLog((payload) => {
    if (!payload?.id || !payload.line) return;
    const running = isProjectRunning(payload.id);
    const backfill = Date.now() < (previewBackfillUntil.get(payload.id) || 0);
    ingestPreviewLine(payload.id, payload.line, {
      running,
      ping: !backfill && running
    });
    if (payload.id === selectedProjectId && !backfill) {
      appendProjectLog(payload.line);
    }
  });
  function showUpdateBanner(visible) {
    el.updateBanner.classList.toggle("hidden", !visible);
  }
  function setUpdateButtons(opts = {}) {
    const { download = false, install = false } = opts;
    el.btnUpdateDownload.classList.toggle("hidden", !download);
    el.btnUpdateInstall.classList.toggle("hidden", !install);
  }
  function handleUpdateStatus(payload) {
    if (!payload) return;
    switch (payload.state) {
      case "checking":
        showUpdateBanner(true);
        el.updateProgress.classList.add("hidden");
        setUpdateButtons({});
        el.updateTitle.textContent = "Sprawdzanie\u2026";
        el.updateDetail.textContent = "";
        break;
      case "available":
        showUpdateBanner(true);
        el.updateProgress.classList.add("hidden");
        setUpdateButtons({ download: true });
        el.updateTitle.textContent = `Nowa wersja ${payload.version}`;
        el.updateDetail.textContent = "Mo\u017Cesz pobra\u0107 teraz.";
        break;
      case "not-available":
        showUpdateBanner(false);
        break;
      case "downloading": {
        const pct = Math.max(0, Math.min(100, payload.percent || 0));
        showUpdateBanner(true);
        setUpdateButtons({});
        el.updateTitle.textContent = "Pobieranie\u2026";
        el.updateDetail.textContent = `${pct.toFixed(0)}%`;
        el.updateProgress.classList.remove("hidden");
        el.updateProgressBar.style.width = `${pct}%`;
        break;
      }
      case "downloaded":
        showUpdateBanner(true);
        el.updateProgress.classList.add("hidden");
        setUpdateButtons({ install: true });
        el.updateTitle.textContent = `Wersja ${payload.version} gotowa`;
        el.updateDetail.textContent = "Zrestartuj, aby zainstalowa\u0107.";
        break;
      case "error":
        showUpdateBanner(true);
        el.updateProgress.classList.add("hidden");
        setUpdateButtons({});
        el.updateTitle.textContent = "B\u0142\u0105d aktualizacji";
        el.updateDetail.textContent = payload.message || "";
        break;
      default:
        break;
    }
  }
  $("#btn-update-check").addEventListener("click", async () => {
    showUpdateBanner(true);
    el.updateTitle.textContent = "Sprawdzanie\u2026";
    el.updateDetail.textContent = "";
    const res = await api().checkForUpdates();
    if (res && res.reason === "dev") {
      el.updateTitle.textContent = "Tryb deweloperski";
      el.updateDetail.textContent = "Aktualizacje tylko w zainstalowanej aplikacji.";
    }
  });
  el.btnUpdateDownload.addEventListener("click", async () => {
    try {
      await api().downloadUpdate();
    } catch (err) {
      setError2(errMsg(err));
    }
  });
  el.btnUpdateInstall.addEventListener("click", () => {
    void api().installUpdate();
  });
  api().onUpdateStatus(handleUpdateStatus);
  (async () => {
    try {
      const info = await api().getAppInfo();
      el.appVersion.textContent = `v${info.version}${info.packaged ? "" : " \xB7 dev"}`;
      showUpdateBanner(false);
    } catch {
    }
    void refresh();
  })();
  setInterval(() => {
    if (!isBusy()) void refresh();
  }, 15e3);
})();
