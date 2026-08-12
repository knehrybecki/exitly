const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const el = {
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
};

let busy = false;
let snapshot = null;
let view = "projects";
let selectedProjectId = null;
let projectLogBuffer = "";
let envEditProjectId = null;
const projectIpCache = new Map();

function formatProjectIpLine(info) {
  if (!info) return "IP: —";
  if (info.ip) {
    const bits = [info.ip];
    if (info.country) bits.push(info.country);
    if (info.city) bits.push(info.city);
    if (info.org) bits.push(info.org);
    if (info.via === "host") bits.push("(host)");
    return `IP: ${bits.join(" · ")}`;
  }
  return `IP: ${info.error || "niedostępne"}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function log(line) {
  if (!el.log) return;
  const stamp = new Date().toLocaleTimeString("pl-PL");
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
  el.busyBar.classList.toggle("hidden", !on);
  $$("button, input, select").forEach((node) => {
    if (node.id === "btn-settings" || node.id === "btn-settings-back") return;
    if (node.closest(".update-banner")) return;
    if (node.closest(".project-logs")) return;
    node.disabled = on;
  });
}

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
  return Array.isArray(models) ? models.filter(Boolean) : [];
}

function modelSelectOptions(selected, models) {
  const current = String(selected || "").trim();
  const list = [...ollamaModelList(models)];
  if (current && !list.includes(current)) list.unshift(current);
  if (!list.length) {
    const label = current || "Brak modeli — sprawdź Ollamę";
    return `<option value="${escapeHtml(current)}">${escapeHtml(label)}</option>`;
  }
  return list
    .map(
      (m) =>
        `<option value="${escapeHtml(m)}"${
          m === current ? " selected" : ""
        }>${escapeHtml(m)}</option>`
    )
    .join("");
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
  $$('select[data-role="crawl-model"], select[data-role="antibot-model"]').forEach(
    (node) => fillModelSelect(node, node.value, list)
  );
}

async function refreshOllamaModelsForSelect(selectEl) {
  if (!selectEl) return;
  try {
    const baseUrl =
      (el.ollamaUrl?.value || "").trim() ||
      snapshot?.ollama?.baseUrl ||
      "http://127.0.0.1:11434";
    const result = await window.vpnHub.checkOllama(baseUrl);
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
    /* zostaw dotychczasową listę */
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
    setOllamaStatus("Wyłączona — projekty nie dostaną OLLAMA_*", "");
  } else if (cfg.ok) {
    const n = Array.isArray(cfg.models) ? cfg.models.length : 0;
    setOllamaStatus(`OK — ${n} model${n === 1 ? "" : "i"} (wybór per projekt)`, "ok");
  } else if (cfg.error && cfg.error !== "disabled") {
    setOllamaStatus(`Błąd: ${cfg.error}`, "err");
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
    setSerperStatus("Wyłączony — projekty nie dostaną SERPER_API_KEY", "");
  } else if (cfg.configured) {
    setSerperStatus(`Klucz ustawiony (${cfg.masked || "••••"})`, "ok");
  } else {
    setSerperStatus("Brak klucza — wklej API key z serper.dev", "err");
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
      setHostWgStatus(
        `Exitly trzyma tunel ${cfg.name || "wg0"} — CRM LAN OK`,
        "ok"
      );
    } else if (cfg.managed) {
      setHostWgStatus(
        `Config OK · Exitly podniesie ${cfg.name || "wg0"} przy starcie`,
        ""
      );
    } else {
      setHostWgStatus(
        `Config ${cfg.name || "wg0"} zapisany — włącz „CRM (Exitly)” na projekcie`,
        ""
      );
    }
  } else {
    setHostWgStatus("Brak configu — wklej conf WireGuard i zapisz", "err");
  }
}

function fillCountrySelect(select, countries, active) {
  if (!select) return;
  select.innerHTML = "";
  for (const c of countries || []) {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = `${c.code.toUpperCase()} — ${c.name}`;
    if (c.code === active) opt.selected = true;
    select.appendChild(opt);
  }
}

function countryFromExit(exit, snap) {
  if (!exit || exit === "proton-vpn") return snap?.active || "ro";
  const m = String(exit).match(/^vpn-([a-z]{2})$/i);
  if (m) return m[1].toLowerCase();
  if (/^exitly-vpn-/.test(String(exit))) return snap?.active || "ro";
  return String(exit).toLowerCase();
}

function appendProjectLog(line) {
  const pre = document.querySelector(
    `.project-card[data-id="${selectedProjectId}"] [data-role="project-log"]`
  );
  if (!pre) return;
  projectLogBuffer += `${line}\n`;
  if (projectLogBuffer.length > 80_000) {
    projectLogBuffer = projectLogBuffer.slice(-60_000);
  }
  pre.textContent = projectLogBuffer;
  pre.scrollTop = pre.scrollHeight;
}

async function attachProjectLogs(id) {
  if (selectedProjectId && selectedProjectId !== id) {
    await window.vpnHub.stopProjectLogs(selectedProjectId);
  }
  selectedProjectId = id;
  projectLogBuffer = "";
  try {
    const res = await window.vpnHub.getProjectLogs(id);
    projectLogBuffer = res?.text || "";
    const pre = document.querySelector(
      `.project-card[data-id="${id}"] [data-role="project-log"]`
    );
    if (pre) {
      pre.textContent = projectLogBuffer || "(brak logów)\n";
      pre.scrollTop = pre.scrollHeight;
    }
    await window.vpnHub.followProjectLogs(id);
  } catch (err) {
    appendProjectLog(`(logi: ${err.message || err})`);
  }
}

async function detachProjectLogs() {
  if (!selectedProjectId) return;
  try {
    await window.vpnHub.stopProjectLogs(selectedProjectId);
  } catch {
    /* ignore */
  }
  selectedProjectId = null;
  projectLogBuffer = "";
}

function renderProjects(snap) {
  const projects = (snap.crawlers || []).filter((c) => c.kind === "project");
  el.projectList.innerHTML = "";

  if (!projects.length) {
    el.projectList.innerHTML = `
      <div class="project-empty">
        <strong>Brak projektów</strong>
        Utwórz nowy (Docker), otwórz istniejący CLI albo zaimportuj .zip.
      </div>`;
    return;
  }

  if (selectedProjectId && !projects.some((p) => p.id === selectedProjectId)) {
    detachProjectLogs();
  }

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
    const options = (snap.countries || [])
      .map(
        (c) =>
          `<option value="${escapeHtml(c.code)}" ${
            c.code === country ? "selected" : ""
          }>${escapeHtml(c.code.toUpperCase())} — ${escapeHtml(c.name)}</option>`
      )
      .join("");

    const crawlModel = item.crawlModel || snap.ollama?.defaults?.crawlModel || "qwen2.5:14b";
    const antibotModel =
      item.antibotModel || snap.ollama?.defaults?.antibotModel || "captchamind:7b";
    const workers = Math.min(8, Math.max(1, Number(item.workers) || 1));
    const cliLabel = item.cliCommand
      ? pathBasename(item.cliCommand)
      : "CLI";
    const cliShells = Array.isArray(snap.cliShells) ? snap.cliShells : [];
    const currentCliBase = pathBasename(item.cliCommand || "opencode").replace(
      /\.(exe|cmd|bat)$/i,
      ""
    );
    const cliShellOptions = (() => {
      const opts = cliShells.map((s) => {
        const selected =
          s.command === currentCliBase ||
          pathBasename(s.resolved || "") === pathBasename(item.cliCommand || "");
        const mark = s.available ? "" : " (brak)";
        return `<option value="${escapeHtml(s.command)}" ${
          selected ? "selected" : ""
        } ${s.available ? "" : "disabled"}>${escapeHtml(s.label)}${mark}</option>`;
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
    const statusLabel = running
      ? isCli
        ? "W terminalu"
        : "Włączony"
      : item.envReady === false
        ? "Brak env"
        : "Wyłączony";

    const ollamaModels = snap.ollama?.models || [];
    const workersOptions = [1, 2, 3, 4, 5, 6, 7, 8]
      .map(
        (n) =>
          `<option value="${n}" ${n === workers ? "selected" : ""}>${n}${
            n === 1 ? " (bezpiecznie)" : n >= 3 ? " (ryzyko blokady)" : ""
          }</option>`
      )
      .join("");
    const cliMetaHtml = isCli
      ? `<label class="field">
          <span>Shell</span>
          <select data-role="cli-shell">${cliShellOptions}</select>
        </label>
        <p class="project-cli-meta">Uruchom: <code>${escapeHtml(
          item.cliCommand || cliLabel
        )}</code>${
          (item.cliArgs || []).length
            ? ` ${(item.cliArgs || []).map(escapeHtml).join(" ")}`
            : ""
        }${
          item.envReady === false
            ? ` · <span class="env-warn">brak: ${(item.envMissing || [])
                .slice(0, 3)
                .map(escapeHtml)
                .join(", ")}</span>`
            : ""
        }</p>`
      : "";
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
        ${
          isCli
            ? ""
            : `<label class="field">
          <span>Workery</span>
          <select data-role="workers">${workersOptions}</select>
        </label>`
        }`;

    const startOptions = Array.isArray(item.options) ? item.options : [];
    const startValues = item.optionValues || {};
    const optionsHtml = startOptions.length
      ? `<div class="project-start-options" data-role="start-options">
          ${startOptions
            .map((opt) => renderStartOptionInput(opt, startValues[opt.id]))
            .join("")}
        </div>`
      : "";

    const envFields = Array.isArray(item.envFields) ? item.envFields : [];
    const requiredEnv = envFields.filter((f) => f.required);
    const envInlineHtml = requiredEnv.length
      ? `<div class="project-env-inline" data-role="env-inline">
          ${requiredEnv
            .map(
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
            )
            .join("")}
          <button type="button" class="ghost tiny" data-role="save-env-inline">Zapisz env</button>
        </div>`
      : "";

    const extraActions = [
      `<button type="button" class="ghost" data-role="check-ip">IP</button>`,
      `<button type="button" class="ghost" data-role="save-models">Zapisz modele</button>`,
      (item.envFieldCount || 0) > 0 || isCli
        ? `<button type="button" class="ghost" data-role="env">Env</button>`
        : "",
      `<button type="button" class="ghost" data-role="edit-options">Opcje</button>`,
      isCli
        ? `<button type="button" class="ghost" data-role="test-mcp">MCP</button>`
        : "",
      `<button type="button" class="ghost" data-role="export">Eksport</button>`,
    ]
      .filter(Boolean)
      .join("\n         ");

    card.innerHTML = `
      <div class="project-top">
        <div>
          <p class="project-name">${escapeHtml(item.name)} <span class="mode-tag">${
            isCli ? escapeHtml(cliLabel || "CLI") : "Docker"
          }</span></p>
          <p class="project-path">${escapeHtml(item.path || "")}</p>
          <p class="project-ip muted" data-role="ip-line">IP: —</p>
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
          <input type="checkbox" data-role="host-wg" ${
            item.useHostWg ? "checked" : ""
          } />
          ${
            isCli
              ? "CRM LAN (Docker)"
              : "CRM LAN (Docker + VPN)"
          }
        </label>
        <div class="project-actions">
          ${extraActions}
          <button type="button" class="${running ? "danger" : "primary"}" data-role="toggle">
            ${
              running
                ? isCli
                  ? "Zatrzymaj"
                  : "Wyłącz"
                : isCli
                  ? "Uruchom"
                  : "Włącz"
            }
          </button>
          <button type="button" class="ghost" data-role="logs">${open ? "Ukryj logi" : "Logi"}</button>
          <button type="button" class="ghost" data-role="cursor">Cursor</button>
          <button type="button" class="ghost" data-role="remove">Usuń</button>
        </div>
      </div>
      <div class="project-logs ${open ? "" : "hidden"}" data-role="logs-panel">
        <div class="project-logs-head">
          <span>${isCli ? "Logi CLI" : "Logi crawla"}</span>
          <button type="button" class="ghost tiny" data-role="refresh-logs">Odśwież</button>
        </div>
        <pre class="project-log" data-role="project-log"></pre>
      </div>
    `;

    const logsPanel = card.querySelector('[data-role="logs-panel"]');
    if (!open) logsPanel.classList.add("hidden");
    if (open) {
      const pre = card.querySelector('[data-role="project-log"]');
      pre.textContent = projectLogBuffer || "(ładowanie…)\n";
    }

    const ipLine = card.querySelector('[data-role="ip-line"]');
    const cachedIp = projectIpCache.get(item.id);
    if (cachedIp) {
      ipLine.textContent = formatProjectIpLine(cachedIp);
      ipLine.classList.toggle("ok", !!cachedIp.ip && !cachedIp.error);
      ipLine.classList.toggle("warn", !cachedIp.ip || !!cachedIp.error);
    }

    card.querySelector('[data-role="country"]').addEventListener("change", (e) => {
      changeProjectCountry(item, e.target.value);
    });

    const cliShellSelect = card.querySelector('[data-role="cli-shell"]');
    if (cliShellSelect) {
      cliShellSelect.addEventListener("change", (e) => {
        const command = (e.target.value || "").trim();
        if (!command) return;
        withBusy(async () => {
          log(`${item.name}: shell → ${command}`);
          return window.vpnHub.setProjectCliShell(item.id, { command });
        });
      });
    }

    const hostWgToggle = card.querySelector('[data-role="host-wg"]');
    if (hostWgToggle) {
      hostWgToggle.addEventListener("change", (e) => {
        const on = !!e.target.checked;
        withBusy(async () => {
          try {
            log(
              `${item.name}: CRM (Exitly) ${on ? "WŁĄCZONE — apka trzyma tunel" : "wyłączone"}`
            );
            return await window.vpnHub.setProjectUseHostWg(item.id, on);
          } catch (err) {
            e.target.checked = !on;
            throw err;
          }
        });
      });
    }

    const crawlSelect = card.querySelector('[data-role="crawl-model"]');
    const antibotSelect = card.querySelector('[data-role="antibot-model"]');
    const workersSelect = card.querySelector('[data-role="workers"]');

    const saveModelsBtn = card.querySelector('[data-role="save-models"]');
    if (saveModelsBtn) {
      saveModelsBtn.addEventListener("click", () => {
        const crawl =
          (crawlSelect?.value || "").trim() || "qwen2.5:14b";
        const antibot =
          (antibotSelect?.value || "").trim() || "captchamind:7b";
        const payload = {
          crawlModel: crawl,
          antibotModel: antibot,
        };
        if (!isCli) {
          payload.workers = Math.min(
            8,
            Math.max(1, Number.parseInt(workersSelect?.value || "1", 10) || 1)
          );
        }
        withBusy(async () => {
          log(
            isCli
              ? `${item.name}: ollama=${crawl} captcha=${antibot}`
              : `${item.name}: crawl=${crawl} antybot=${antibot} workers=${payload.workers}`
          );
          return window.vpnHub.setProjectModels(item.id, payload);
        });
      });
    }

    const envBtn = card.querySelector('[data-role="env"]');
    if (envBtn) {
      envBtn.addEventListener("click", () => openEnvModal(item));
    }

    const saveEnvInline = card.querySelector('[data-role="save-env-inline"]');
    if (saveEnvInline) {
      saveEnvInline.addEventListener("click", () => {
        const values = {};
        card.querySelectorAll("[data-env-key]").forEach((input) => {
          values[input.getAttribute("data-env-key")] = input.value || "";
        });
        withBusy(async () => {
          log(`${item.name}: zapisuję env projektu`);
          return window.vpnHub.setProjectEnv(item.id, values);
        });
      });
    }

    const editOptsBtn = card.querySelector('[data-role="edit-options"]');
    if (editOptsBtn) {
      editOptsBtn.addEventListener("click", () => openEditOptionsPrompt(item));
    }

    const testMcpBtn = card.querySelector('[data-role="test-mcp"]');
    if (testMcpBtn) {
      testMcpBtn.addEventListener("click", () => {
        withBusy(async () => {
          log(`${item.name}: test zdalnego MCP…`);
          const res = await window.vpnHub.testProjectMcp(item.id);
          log(
            res?.ok
              ? `${item.name}: MCP OK ${res.host}:${res.port}`
              : `${item.name}: MCP ${res?.error || "offline"}`
          );
          return null;
        });
      });
    }

    card.querySelector('[data-role="check-ip"]').addEventListener("click", async () => {
      ipLine.textContent = "IP: sprawdzam…";
      ipLine.classList.remove("ok", "warn");
      try {
        const info = await window.vpnHub.checkProjectIp(item.id);
        projectIpCache.set(item.id, info);
        ipLine.textContent = formatProjectIpLine(info);
        ipLine.classList.toggle("ok", !!info.ip && !info.error);
        ipLine.classList.toggle("warn", !info.ip || !!info.error);
        if (info.ip) {
          log(
            `${item.name}: ${info.ip}${info.country ? ` ${info.country}` : ""}${
              info.org ? ` · ${info.org}` : ""
            }`
          );
        } else if (info.error) {
          setError(info.error);
        }
      } catch (err) {
        ipLine.textContent = "IP: błąd";
        ipLine.classList.add("warn");
        setError(err.message || String(err));
      }
    });

    card.querySelector('[data-role="toggle"]').addEventListener("click", () => {
      withBusy(async () => {
        if (running) {
          log(`Wyłączam ${item.name}`);
          const snapOut = await window.vpnHub.stopCrawler(item.id);
          if (selectedProjectId === item.id) await attachProjectLogs(item.id);
          return snapOut;
        }
        const optionValues = collectStartOptionValues(card);
        log(isCli ? `Uruchamiam CLI ${item.name}` : `Włączam ${item.name}`);
        const snapOut = await window.vpnHub.startCrawler(item.id, optionValues);
        selectedProjectId = item.id;
        await attachProjectLogs(item.id);
        return snapOut;
      });
    });

    card.querySelector('[data-role="logs"]').addEventListener("click", async () => {
      if (selectedProjectId === item.id) {
        await detachProjectLogs();
        renderProjects(snapshot);
        return;
      }
      selectedProjectId = item.id;
      renderProjects(snapshot);
      await attachProjectLogs(item.id);
    });

    card.querySelector('[data-role="refresh-logs"]').addEventListener("click", async () => {
      await attachProjectLogs(item.id);
    });

    card.querySelector('[data-role="cursor"]').addEventListener("click", async () => {
      try {
        await window.vpnHub.openInCursor(item.id);
      } catch (err) {
        setError(err.message || String(err));
      }
    });

    card.querySelector('[data-role="export"]').addEventListener("click", () => {
      withBusy(async () => {
        log(`Eksportuję ${item.name}`);
        const out = await window.vpnHub.exportProject(item.id);
        if (out?.path) log(`Zapisano: ${out.path}`);
        return null;
      });
    });

    card.querySelector('[data-role="remove"]').addEventListener("click", () => {
      if (!confirm(`Usunąć „${item.name}” z listy?\nFolder na dysku zostaje.`)) return;
      withBusy(async () => {
        if (selectedProjectId === item.id) await detachProjectLogs();
        projectIpCache.delete(item.id);
        log(`Usuwam ${item.name}`);
        return window.vpnHub.removeCrawler(item.id);
      });
    });

    el.projectList.appendChild(card);
  }
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
        ${choices
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}" ${
                String(c) === String(v) ? "selected" : ""
              }>${escapeHtml(c)}</option>`
          )
          .join("")}
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
    if (node.type === "checkbox") {
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
      ${["text", "number", "checkbox", "select"]
        .map(
          (t) =>
            `<option value="${t}" ${opt.type === t ? "selected" : ""}>${t}</option>`
        )
        .join("")}
    </select>
    <select data-f="apply">
      ${["env", "arg", "both"]
        .map(
          (t) =>
            `<option value="${t}" ${(opt.apply || "env") === t ? "selected" : ""}>${t}</option>`
        )
        .join("")}
    </select>
    <input data-f="env" type="text" placeholder="ENV (opcjonalnie)" value="${escapeHtml(opt.env || "")}" />
    <input data-f="arg" type="text" placeholder="arg np. --limit" value="${escapeHtml(opt.arg || "")}" />
    <input data-f="default" type="text" placeholder="domyślna" value="${escapeHtml(opt.default || "")}" />
    <button type="button" class="ghost tiny" data-f="remove">×</button>
  `;
  row.querySelector('[data-f="remove"]').addEventListener("click", () => row.remove());
  return row;
}

function collectNewOptionsFromModal() {
  if (!el.newOptionsList) return [];
  return [...el.newOptionsList.querySelectorAll(".option-row")]
    .map((row) => {
      const get = (f) => (row.querySelector(`[data-f="${f}"]`)?.value || "").trim();
      return {
        id: get("id"),
        label: get("label"),
        type: get("type") || "text",
        apply: get("apply") || "env",
        env: get("env"),
        arg: get("arg"),
        default: get("default"),
        required: false,
      };
    })
    .filter((o) => o.id || o.label);
}

function openEditOptionsPrompt(item) {
  const current = (item.options || [])
    .map((o) => `${o.id}|${o.label}|${o.type}|${o.apply || "env"}|${o.env || ""}|${o.arg || ""}|${o.default || ""}`)
    .join("\n");
  const text = prompt(
    "Opcje startu (jedna na linię):\nid|etykieta|text|env|ENV_NAME|--flag|domyślna\n\nTypy: text, number, checkbox, select\nApply: env, arg, both",
    current || "limit|Limit|number|env|EXITLY_OPT_LIMIT|--limit|5"
  );
  if (text == null) return;
  const options = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, label, type, apply, env, arg, def] = line.split("|").map((s) => (s || "").trim());
      return { id, label, type: type || "text", apply: apply || "env", env, arg, default: def };
    });
  withBusy(async () => {
    log(`${item.name}: aktualizacja opcji (${options.length})`);
    return window.vpnHub.setProjectStartOptions(item.id, {
      options,
      optionValues: item.optionValues || {},
    });
  });
}

async function openEnvModal(item) {
  if (!el.modalEnv || !item) return;
  envEditProjectId = item.id;
  el.envProjectName.innerHTML = `Projekt <strong>${escapeHtml(
    item.name
  )}</strong> — zapis do <code>.env</code>`;
  el.envFields.innerHTML = `<p class="meta">Ładowanie…</p>`;
  el.envHint.textContent = "";
  el.modalEnv.classList.remove("hidden");
  try {
    const data = await window.vpnHub.getProjectEnv(item.id);
    const fields = data.fields || [];
    if (!fields.length) {
      el.envFields.innerHTML = `<p class="meta">Brak pól tylko dla tego projektu. Serper i Ollama ustawiasz w <strong>Ustawieniach</strong> aplikacji.</p>`;
      return;
    }
    el.envFields.innerHTML = fields
      .map(
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
      )
      .join("");
    if (data.missingRequired?.length) {
      el.envHint.textContent = `Wymagane puste: ${data.missingRequired.join(", ")}`;
    } else {
      el.envHint.textContent = data.path ? `Plik: ${data.path}` : "";
    }
  } catch (err) {
    el.envFields.innerHTML = "";
    setError(err.message || String(err));
    closeEnvModal();
  }
}

function closeEnvModal() {
  envEditProjectId = null;
  if (el.modalEnv) el.modalEnv.classList.add("hidden");
}

function changeProjectCountry(item, code) {
  withBusy(async () => {
    log(`${item.name} → ${String(code).toUpperCase()}`);
    return window.vpnHub.setCrawlerExit(item.id, code);
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
    else if (snapshot) renderSnapshot(snapshot);
  } catch (err) {
    setError(err.message || String(err));
    log(`Błąd: ${err.message || err}`);
    if (snapshot) renderSnapshot(snapshot);
  } finally {
    setBusy(false);
  }
}

function openNewModal() {
  el.newName.value = "";
  fillCountrySelect(el.newCountry, snapshot?.countries, snapshot?.active || "ro");
  const defaults = snapshot?.ollama?.defaults || {};
  const models = snapshot?.ollama?.models || [];
  fillModelSelect(
    el.newCrawlModel,
    defaults.crawlModel || "qwen2.5:14b",
    models
  );
  fillModelSelect(
    el.newAntibotModel,
    defaults.antibotModel || "captchamind:7b",
    models
  );
  refreshOllamaModelsForSelect(el.newCrawlModel);
  if (el.newOptionsList) {
    el.newOptionsList.innerHTML = "";
  }
  el.modalNew.classList.remove("hidden");
  el.newName.focus();
}

function closeNewModal() {
  el.modalNew.classList.add("hidden");
}

$("#btn-settings").addEventListener("click", () => showView("settings"));
$("#btn-settings-back").addEventListener("click", () => showView("projects"));

$("#btn-ollama-save").addEventListener("click", () => {
  withBusy(async () => {
    const enabled = !!el.ollamaEnabled.checked;
    const baseUrl = (el.ollamaUrl.value || "").trim() || "http://127.0.0.1:11434";
    log(`Zapisuję Ollamę (${enabled ? baseUrl : "off"})`);
    return window.vpnHub.setOllama({ enabled, baseUrl });
  });
});

$("#btn-ollama-test").addEventListener("click", async () => {
  setError("");
  setOllamaStatus("Sprawdzam…", "");
  try {
    const baseUrl = (el.ollamaUrl.value || "").trim() || "http://127.0.0.1:11434";
    const result = await window.vpnHub.checkOllama(baseUrl);
    fillOllamaModels(result.models);
    if (result.ok) {
      const n = Array.isArray(result.models) ? result.models.length : 0;
      setOllamaStatus(`OK — ${n} model${n === 1 ? "" : "i"} (wybór per projekt)`, "ok");
      log(`Ollama OK (${n} modeli)`);
    } else {
      setOllamaStatus(`Błąd: ${result.error || "niedostępna"}`, "err");
      log(`Ollama błąd: ${result.error || "?"}`);
    }
  } catch (err) {
    setOllamaStatus(`Błąd: ${err.message || err}`, "err");
    setError(err.message || String(err));
  }
});

$("#btn-serper-save").addEventListener("click", () => {
  withBusy(async () => {
    const enabled = !!el.serperEnabled.checked;
    const apiKey = (el.serperKey.value || "").trim();
    log(`Zapisuję Serper (${enabled ? (apiKey ? "klucz" : "bez klucza") : "off"})`);
    return window.vpnHub.setSerper({ enabled, apiKey });
  });
});

$("#btn-hostwg-save").addEventListener("click", () => {
  withBusy(async () => {
    const name = (el.hostWgName.value || "").trim() || "wg0";
    const configText = el.hostWgConfig.value || "";
    log(`Zapisuję host WG (${name})`);
    return window.vpnHub.setHostWg({ name, configText });
  });
});

$("#btn-hostwg-test")?.addEventListener("click", async () => {
  setHostWgStatus("Exitly podnosi tunel CRM…", "");
  try {
    await window.vpnHub.testHostWg();
    setHostWgStatus("Tunel CRM aktywny (Exitly)", "ok");
    log("CRM LAN: Exitly OK");
    const snap = await window.vpnHub.getSnapshot();
    if (snap) renderSnapshot(snap);
  } catch (err) {
    setHostWgStatus(err.message || String(err), "err");
    setError(err.message || String(err));
  }
});

$("#btn-serper-test").addEventListener("click", async () => {
  setError("");
  setSerperStatus("Sprawdzam…", "");
  try {
    const apiKey = (el.serperKey.value || "").trim();
    const result = await window.vpnHub.checkSerper(apiKey);
    if (result.ok) {
      setSerperStatus(`OK — klucz działa (${result.masked || "••••"})`, "ok");
      log("Serper OK");
    } else {
      setSerperStatus(`Błąd: ${result.error || "niedostępny"}`, "err");
      log(`Serper błąd: ${result.error || "?"}`);
    }
  } catch (err) {
    setSerperStatus(`Błąd: ${err.message || err}`, "err");
    setError(err.message || String(err));
  }
});

$("#btn-new-project").addEventListener("click", openNewModal);
$("#btn-new-cancel").addEventListener("click", closeNewModal);
el.modalNew.addEventListener("click", (e) => {
  if (e.target === el.modalNew) closeNewModal();
});

$("#btn-env-cancel").addEventListener("click", closeEnvModal);
el.modalEnv.addEventListener("click", (e) => {
  if (e.target === el.modalEnv) closeEnvModal();
});
$("#btn-env-save").addEventListener("click", () => {
  if (!envEditProjectId) return;
  const values = {};
  el.envFields.querySelectorAll("[data-env-key]").forEach((input) => {
    values[input.getAttribute("data-env-key")] = input.value || "";
  });
  withBusy(async () => {
    log("Zapisuję .env projektu");
    const snap = await window.vpnHub.setProjectEnv(envEditProjectId, values);
    closeEnvModal();
    return snap;
  });
});

$("#btn-pick-parent").addEventListener("click", async () => {
  const dir = await window.vpnHub.pickProjectParent();
  if (dir) el.newParent.value = dir;
});

$("#btn-new-create").addEventListener("click", () => {
  const name = (el.newName.value || "").trim();
  const parentDir = (el.newParent.value || "").trim();
  if (!name) {
    setError("Podaj nazwę projektu");
    return;
  }
  if (!parentDir) {
    setError("Wybierz folder");
    return;
  }
  const options = collectNewOptionsFromModal();
  withBusy(async () => {
    closeNewModal();
    log(`Tworzę ${name}`);
    const code = el.newCountry.value || "ro";
    const snap = await window.vpnHub.createProject({
      name,
      parentDir,
      country: code,
      crawlModel:
        (el.newCrawlModel?.value || "").trim() || "qwen2.5:14b",
      antibotModel:
        (el.newAntibotModel?.value || "").trim() || "captchamind:7b",
      workers: Math.min(
        8,
        Math.max(1, Number.parseInt(el.newWorkers?.value || "1", 10) || 1)
      ),
      options,
      openCursor: !!el.newOpenCursor.checked,
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

$("#btn-open-project").addEventListener("click", () =>
  withBusy(async () => {
    const projectPath = await window.vpnHub.pickExistingProject();
    if (!projectPath) return null;
    log("Dodaję projekt");
    return window.vpnHub.registerProject({
      projectPath,
      country: snapshot?.active || "ro",
    });
  })
);

$("#btn-import-project").addEventListener("click", () =>
  withBusy(async () => {
    log("Importuję projekt z ZIP…");
    const snap = await window.vpnHub.importProject();
    if (!snap) return null;
    if (snap.importedProjectId) {
      selectedProjectId = snap.importedProjectId;
      await attachProjectLogs(snap.importedProjectId);
    }
    return snap;
  })
);

$("#btn-save-key").addEventListener("click", () =>
  withBusy(async () => {
    await window.vpnHub.setupEnv(el.privateKey.value);
    log("Zapisano klucz");
    return window.vpnHub.getSnapshot();
  })
);

$("#btn-key-help").addEventListener("click", () => window.vpnHub.pickEnvHelp());
$("#btn-refresh").addEventListener("click", () => refresh());

window.vpnHub.onLog((line) => {
  if (line) log(line);
});

window.vpnHub.onProjectLog((payload) => {
  if (!payload || payload.id !== selectedProjectId) return;
  appendProjectLog(payload.line);
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
  switch (payload.state) {
    case "checking":
      showUpdateBanner(true);
      el.updateProgress.classList.add("hidden");
      setUpdateButtons({});
      el.updateTitle.textContent = "Sprawdzanie…";
      el.updateDetail.textContent = "";
      break;
    case "available":
      showUpdateBanner(true);
      el.updateProgress.classList.add("hidden");
      setUpdateButtons({ download: true });
      el.updateTitle.textContent = `Nowa wersja ${payload.version}`;
      el.updateDetail.textContent = "Możesz pobrać teraz.";
      break;
    case "not-available":
      showUpdateBanner(false);
      break;
    case "downloading": {
      const pct = Math.max(0, Math.min(100, payload.percent || 0));
      showUpdateBanner(true);
      setUpdateButtons({});
      el.updateTitle.textContent = "Pobieranie…";
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
      el.updateDetail.textContent = "Zrestartuj, aby zainstalować.";
      break;
    case "error":
      showUpdateBanner(true);
      el.updateProgress.classList.add("hidden");
      setUpdateButtons({});
      el.updateTitle.textContent = "Błąd aktualizacji";
      el.updateDetail.textContent = payload.message || "";
      break;
    default:
      break;
  }
}

$("#btn-update-check").addEventListener("click", async () => {
  showUpdateBanner(true);
  el.updateTitle.textContent = "Sprawdzanie…";
  el.updateDetail.textContent = "";
  const res = await window.vpnHub.checkForUpdates();
  if (res && res.reason === "dev") {
    el.updateTitle.textContent = "Tryb deweloperski";
    el.updateDetail.textContent = "Aktualizacje tylko w zainstalowanej aplikacji.";
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
    el.appVersion.textContent = `v${info.version}${info.packaged ? "" : " · dev"}`;
    showUpdateBanner(false);
  } catch {
    /* ignore */
  }
  refresh();
})();

setInterval(() => {
  if (!busy) refresh();
}, 15000);
