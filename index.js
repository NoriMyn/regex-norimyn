import { saveSettingsDebounced } from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";
import { callGenericPopup, POPUP_TYPE } from "../../../popup.js";

const extensionName = "regex-norimin";

if (!window.RegexManagerData) {
  window.RegexManagerData = {
    packs: {},
    enabled: [],
    active: true
  };
}

jQuery(async () => {
  console.log("[Regex Manager] Start...");

  try {
    const settingsHtml = await $.get(`/scripts/extensions/third-party/${extensionName}/settings.html`);
    $("#extensions_settings2").append(settingsHtml);

    if (extension_settings[extensionName]) {
      window.RegexManagerData.enabled = Array.isArray(extension_settings[extensionName].enabled)
        ? extension_settings[extensionName].enabled
        : [];
      window.RegexManagerData.active = extension_settings[extensionName].active !== false;
    }

    await loadRegexPacks();
    sanitizeEnabledPacks();
    renderPackList();
    updateToggleButton();

    cleanupManagedRegexes();

    if (window.RegexManagerData.active) {
      for (const packId of window.RegexManagerData.enabled) {
        injectRegexPack(packId);
      }
    }

    $("#regex-manager-toggle").on("click", async function () {
      window.RegexManagerData.active = !window.RegexManagerData.active;

      if (window.RegexManagerData.active) {
        for (const packId of window.RegexManagerData.enabled) {
          injectRegexPack(packId);
        }
        toastr.success("Regex Manager enabled");
      } else {
        removeAllManagedRegexes();
        toastr.info("Regex Manager disabled");
      }

      updateToggleButton();
      saveSettings();
      await reloadChatSafe();
    });

    $("#regex-manager-enable-all").on("click", async function () {
      window.RegexManagerData.enabled = Object.keys(window.RegexManagerData.packs);

      if (window.RegexManagerData.active) {
        for (const packId of window.RegexManagerData.enabled) {
          injectRegexPack(packId);
        }
      }

      renderPackList();
      updateToggleButton();
      saveSettings();
      await reloadChatSafe();
    });

    $("#regex-manager-disable-all").on("click", async function () {
      removeAllManagedRegexes();
      window.RegexManagerData.enabled = [];

      renderPackList();
      updateToggleButton();
      saveSettings();
      await reloadChatSafe();
    });

    $("#regex-manager-debug").on("click", function () {
      openDebugger();
    });

    console.log("[Regex Manager] Ready");
  } catch (e) {
    console.error("[Regex Manager] Init error:", e);
  }
});

function updateToggleButton() {
  const btn = $("#regex-manager-toggle");

  if (window.RegexManagerData.active) {
    btn.text("Р’РљР›").removeClass("inactive").addClass("active");
  } else {
    btn.text("Р’Р«РљР›").removeClass("active").addClass("inactive");
  }

  $("#regex-manager-list input[type=checkbox]").prop("disabled", !window.RegexManagerData.active);
}

function saveSettings() {
  extension_settings[extensionName] = {
    enabled: [...window.RegexManagerData.enabled],
    active: window.RegexManagerData.active
  };
  saveSettingsDebounced();
}

function sanitizeEnabledPacks() {
  const existing = new Set(Object.keys(window.RegexManagerData.packs));
  window.RegexManagerData.enabled = window.RegexManagerData.enabled.filter(id => existing.has(id));
}

async function reloadChatSafe() {
  const ctx = SillyTavern.getContext();
  if (ctx && typeof ctx.reloadCurrentChat === "function") {
    await ctx.reloadCurrentChat();
  }
}

async function loadRegexPacks() {
  const indexUrl = `/scripts/extensions/third-party/${extensionName}/regexes/index.json`;

  let packFiles = [];
  try {
    const response = await fetch(indexUrl);
    if (!response.ok) {
      throw new Error(`Failed to load ${indexUrl}`);
    }
    packFiles = await response.json();
  } catch (e) {
    console.error("[Regex Manager] index.json load error:", e);
    return;
  }

  if (!Array.isArray(packFiles)) {
    console.error("[Regex Manager] index.json must contain an array");
    return;
  }

  for (const file of packFiles) {
    try {
      const response = await fetch(`/scripts/extensions/third-party/${extensionName}/regexes/${file}.json`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const pack = await response.json();

      if (!validatePack(file, pack)) {
        console.warn(`[Regex Manager] Invalid pack skipped: ${file}`);
        continue;
      }

      window.RegexManagerData.packs[file] = pack;
      console.log(`[Regex Manager] Loaded pack: ${pack.name} (${pack.scripts.length})`);
    } catch (e) {
      console.error(`[Regex Manager] Error loading ${file}:`, e);
    }
  }
}

function validatePack(file, pack) {
  if (!pack || typeof pack !== "object") return false;
  if (typeof pack.name !== "string" || !pack.name.trim()) return false;
  if (typeof pack.description !== "string") return false;
  if (!Array.isArray(pack.scripts)) return false;

  const ids = new Set();

  for (const script of pack.scripts) {
    if (!script || typeof script !== "object") return false;
    if (typeof script.id !== "string" || !script.id.trim()) return false;
    if (ids.has(script.id)) {
      console.warn(`[Regex Manager] Duplicate script.id in ${file}: ${script.id}`);
      return false;
    }
    ids.add(script.id);

    if (typeof script.scriptName !== "string") return false;
    if (typeof script.findRegex !== "string") return false;
    if (typeof script.replaceString !== "string") return false;
  }

  return true;
}

function renderPackList() {
  const container = $("#regex-manager-list");
  container.empty();

  for (const [id, pack] of Object.entries(window.RegexManagerData.packs)) {
    const enabled = window.RegexManagerData.enabled.includes(id);
    const inputId = `regex-pack-${escapeId(id)}`;

    const html = `
      <div class="regex-pack">
        <div class="regex-pack-top">
          <input type="checkbox" id="${inputId}" data-pack="${escapeHtml(id)}" ${enabled ? "checked" : ""} ${!window.RegexManagerData.active ? "disabled" : ""}>
          <label for="${inputId}" class="regex-pack-name">${escapeHtml(pack.name)}</label>
        </div>
        <div class="regex-pack-desc">${escapeHtml(pack.description)}</div>
        <div class="regex-pack-count">${pack.scripts.length} regex rules</div>
      </div>
    `;

    container.append(html);
  }

  container.find("input[type=checkbox]").on("change", async function () {
    const packId = $(this).data("pack");
    const checked = $(this).is(":checked");

    if (checked) {
      if (!window.RegexManagerData.enabled.includes(packId)) {
        window.RegexManagerData.enabled.push(packId);
        if (window.RegexManagerData.active) {
          injectRegexPack(packId);
        }
      }
    } else {
      window.RegexManagerData.enabled = window.RegexManagerData.enabled.filter(p => p !== packId);
      removeRegexPack(packId);
    }

    saveSettings();
    await reloadChatSafe();
  });
}

function injectRegexPack(packId) {
  const pack = window.RegexManagerData.packs[packId];
  if (!pack) return;

  if (!Array.isArray(extension_settings.regex)) {
    extension_settings.regex = [];
  }

  let added = 0;

  for (const script of pack.scripts) {
    const newId = `rgxm-${packId}-${script.id}`;
    const exists = extension_settings.regex.some(r => r.id === newId);
    if (exists) continue;

    extension_settings.regex.push({
      id: newId,
      scriptName: `[RM] ${script.scriptName}`,
      findRegex: script.findRegex,
      replaceString: script.replaceString,
      trimStrings: Array.isArray(script.trimStrings) ? script.trimStrings : [],
      placement: Array.isArray(script.placement) ? script.placement : [1, 2, 6],
      disabled: false,
      markdownOnly: script.markdownOnly ?? true,
      promptOnly: script.promptOnly ?? false,
      runOnEdit: script.runOnEdit ?? true,
      substituteRegex: script.substituteRegex ?? 0,
      minDepth: script.minDepth ?? null,
      maxDepth: script.maxDepth ?? null
    });

    added++;
  }

  if (added > 0) {
    console.log(`[Regex Manager] Added ${added} regex from ${packId}`);
    saveSettingsDebounced();
  }
}

function removeRegexPack(packId) {
  if (!Array.isArray(extension_settings.regex)) return;

  const prefix = `rgxm-${packId}-`;
  let removed = 0;

  for (let i = extension_settings.regex.length - 1; i >= 0; i--) {
    const item = extension_settings.regex[i];
    if (item?.id && item.id.startsWith(prefix)) {
      extension_settings.regex.splice(i, 1);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`[Regex Manager] Removed ${removed} regex from ${packId}`);
    saveSettingsDebounced();
  }
}

function cleanupManagedRegexes() {
  if (!Array.isArray(extension_settings.regex)) return;

  const validIds = new Set();

  if (window.RegexManagerData.active) {
    for (const packId of window.RegexManagerData.enabled) {
      const pack = window.RegexManagerData.packs[packId];
      if (!pack) continue;

      for (const script of pack.scripts) {
        validIds.add(`rgxm-${packId}-${script.id}`);
      }
    }
  }

  for (let i = extension_settings.regex.length - 1; i >= 0; i--) {
    const item = extension_settings.regex[i];
    if (!item?.id || !item.id.startsWith("rgxm-")) continue;

    if (!validIds.has(item.id)) {
      extension_settings.regex.splice(i, 1);
    }
  }

  saveSettingsDebounced();
}

function removeAllManagedRegexes() {
  if (!Array.isArray(extension_settings.regex)) return;

  for (let i = extension_settings.regex.length - 1; i >= 0; i--) {
    const item = extension_settings.regex[i];
    if (item?.id && item.id.startsWith("rgxm-")) {
      extension_settings.regex.splice(i, 1);
    }
  }

  saveSettingsDebounced();
}

async function openDebugger() {
  const packs = window.RegexManagerData.packs;
  const enabledPacks = window.RegexManagerData.enabled;

  let allScripts = [];
  for (const packId of enabledPacks) {
    const pack = packs[packId];
    if (pack) {
      allScripts = allScripts.concat(pack.scripts.map(s => ({ ...s, packName: pack.name })));
    }
  }

  const html = `
    <div class="regex-manager-debugger">
      <div class="debugger-section">
        <h4>Active regex (${allScripts.length})</h4>
        <div class="debugger-rules">
          ${
            allScripts.length === 0
              ? '<div class="no-rules">No active regex</div>'
              : allScripts.map((s, i) => `
                <div class="debugger-rule">
                  <span class="rule-num">${i + 1}</span>
                  <span class="rule-name">${escapeHtml(s.scriptName)}</span>
                  <code class="rule-regex">${escapeHtml(shorten(s.findRegex, 40))}</code>
                </div>
              `).join("")
          }
        </div>
      </div>

      <div class="debugger-section">
        <h4>Test</h4>
        <div>
          <label for="debug-input">Input text</label>
          <textarea id="debug-input" class="text_pole" rows="5" placeholder="Paste text here..."></textarea>
        </div>
        <div class="debugger-buttons">
          <div>
            <label for="debug-render">Render mode</label>
            <select id="debug-render">
              <option value="text">Text</option>
              <option value="html">Safe HTML preview</option>
            </select>
          </div>
          <div>
            <button id="debug-run" class="menu_button">Run</button>
          </div>
        </div>
      </div>

      <div class="debugger-section">
        <h4>Result</h4>
        <div id="debug-output" class="debugger-output"></div>
      </div>

      <div class="debugger-section">
        <h4>Steps</h4>
        <div id="debug-steps" class="debugger-steps"></div>
      </div>
    </div>
  `;

  const popup = $(html);

  popup.find("#debug-run").on("click", function () {
    const input = String(popup.find("#debug-input").val() || "");

    if (!input.trim()) {
      toastr.warning("Enter test text");
      return;
    }

    let result = input;
    const steps = [];

    for (const script of allScripts) {
      const before = result;

      try {
        const regex = buildRegexFromString(script.findRegex);
        result = result.replace(regex, script.replaceString);

        if (before !== result) {
          steps.push({
            name: script.scriptName,
            changed: true
          });
        }
      } catch (e) {
        steps.push({
          name: script.scriptName,
          error: e.message
        });
      }
    }

    popup.find("#debug-output").text(result);

    const stepsEl = popup.find("#debug-steps");
    if (steps.length === 0) {
      stepsEl.html('<div class="no-changes">No regex matched</div>');
    } else {
      stepsEl.html(
        steps.map(s => `
          <div class="step ${s.error ? "step-error" : "step-ok"}">
            <span class="step-name">${escapeHtml(s.name)}</span>
            ${s.error
              ? `<span class="step-error-msg">Error: ${escapeHtml(s.error)}</span>`
              : `<span class="step-ok-msg">Matched</span>`
            }
          </div>
        `).join("")
      );
    }
  });

  await callGenericPopup(popup, POPUP_TYPE.TEXT, "", { wide: true, large: true });
}

function buildRegexFromString(source) {
  if (typeof source !== "string" || !source.length) {
    throw new Error("Empty findRegex");
  }

  const literalMatch = source.match(/^\/([\s\S]*)\/([gimsuy]*)$/);
  if (literalMatch) {
    return new RegExp(literalMatch[1], literalMatch[2]);
  }

  return new RegExp(source);
}

function shorten(text, max) {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function escapeId(text) {
  return String(text).replace(/[^a-zA-Z0-9\-_:.]/g, "_");
}

window.RegexManager = {
  getPacks: () => window.RegexManagerData.packs,
  getEnabled: () => window.RegexManagerData.enabled,
  isActive: () => window.RegexManagerData.active,
  inject: injectRegexPack,
  remove: removeRegexPack,
  debug: openDebugger
};
