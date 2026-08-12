/** @ts-nocheck */
import { api } from "../api";
import { escapeHtml } from "../ui";

export function createRenderProjects(ctx) {
  const {
    el, projectIpCache, getSelectedProjectId, setSelectedProjectId,
    getProjectLogBuffer, detachProjectLogs, attachProjectLogs,
    withBusy, log, setError, formatProjectIpLine, openEnvModal,
    openEditOptionsPrompt, openDupModal, changeProjectCountry,
    collectStartOptionValues, modelSelectOptions, renderStartOptionInput,
    countryFromExit, pathBasename, getSnapshot, setSnapshot, renderProjectsRef,
  } = ctx;

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
      `<button type="button" class="ghost" data-role="duplicate">Duplikuj</button>`,
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
          return api().setProjectCliShell(item.id, { command });
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
            return await api().setProjectUseHostWg(item.id, on);
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
          return api().setProjectModels(item.id, payload);
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
          return api().setProjectEnv(item.id, values);
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
          const res = await api().testProjectMcp(item.id);
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
        const info = await api().checkProjectIp(item.id);
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
          const snapOut = await api().stopCrawler(item.id);
          if (selectedProjectId === item.id) await attachProjectLogs(item.id);
          return snapOut;
        }
        const optionValues = collectStartOptionValues(card);
        log(isCli ? `Uruchamiam CLI ${item.name}` : `Włączam ${item.name}`);
        const snapOut = await api().startCrawler(item.id, optionValues);
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
        await api().openInCursor(item.id);
      } catch (err) {
        setError(err.message || String(err));
      }
    });

    card.querySelector('[data-role="export"]').addEventListener("click", () => {
      withBusy(async () => {
        log(`Eksportuję ${item.name}`);
        const out = await api().exportProject(item.id);
        if (out?.path) log(`Zapisano: ${out.path}`);
        return null;
      });
    });

    card.querySelector('[data-role="duplicate"]').addEventListener("click", () => {
      openDupModal(item);
    });

    card.querySelector('[data-role="remove"]').addEventListener("click", () => {
      if (!confirm(`Usunąć „${item.name}” z listy?\nFolder na dysku zostaje.`)) return;
      withBusy(async () => {
        if (selectedProjectId === item.id) await detachProjectLogs();
        projectIpCache.delete(item.id);
        log(`Usuwam ${item.name}`);
        return api().removeCrawler(item.id);
      });
    });

    el.projectList.appendChild(card);
  }
}



  return renderProjects;
}
