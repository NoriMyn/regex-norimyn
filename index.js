import { saveSettingsDebounced } from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";

const extensionName = "regex-norimyn";

const PACK_FILES = [
  "regex_thinking",
  "regex_think",
  "regex_infobloc",
  "regex_buttons_panel",
  "regex_html",
  "regex_message"
];

if (!window.NoriMynRegexManagerData) {
  window.NoriMynRegexManagerData = {
    packs: {},
    enabled: []
  };
}

jQuery(async () => {
  try {
    const settingsHtml = await $.get(`/scripts/extensions/third-party/${extensionName}/settings.html`);

    const target = $("#extensions_settings2").length
      ? $("#extensions_settings2")
      : $("#extensions_settings");

    if (!target.length) {
      throw new Error("Extensions settings container not found");
    }

    target.append(settingsHtml);

    if (extension_settings[extensionName]) {
      window.NoriMynRegexManagerData.enabled = Array.isArray(extension_settings[extensionName].enabled)
        ? extension_settings[extensionName].enabled
        : [];
    }

    await loadRegexPacks();
    renderPackList();
    cleanupManagedRegexes();

    for (const packId of window.NoriMynRegexManagerData.enabled) {
      injectRegexPack(packId);
    }
  } catch (e) {
    console.error("[NoriMyn Regex Manager] Init error:", e);
  }
});

function saveSettings() {
  extension_settings[extensionName] = {
    enabled: [...window.NoriMynRegexManagerData.enabled]
  };
  saveSettingsDebounced();
}

async function reloadChatSafe() {
  const ctx = SillyTavern.getContext();
  if (ctx && typeof ctx.reloadCurrentChat === "function") {
    await ctx.reloadCurrentChat();
  }
}

async function loadRegexPacks() {
  window.NoriMynRegexManagerData.packs = {};

  for (const file of PACK_FILES) {
    try {
      const response = await fetch(
        `/scripts/extensions/third-party/${extensionName}/regexes/${file}.json?${Date.now()}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const pack = await response.json();

      if (!pack || typeof pack !== "object") {
        throw new Error(`Invalid JSON in ${file}.json`);
      }

      if (!pack.id || !pack.scriptName || typeof pack.findRegex !== "string") {
        throw new Error(`Missing required fields in ${file}.json`);
      }

      window.NoriMynRegexManagerData.packs[file] = pack;
    } catch (e) {
      console.error(`[NoriMyn Regex Manager] Load error ${file}:`, e);
    }
  }
}

function renderPackList() {
  const container = $("#norimyn-regex-list");
  if (!container.length) return;

  container.empty();

  for (const [id, pack] of Object.entries(window.NoriMynRegexManagerData.packs)) {
    const enabled = window.NoriMynRegexManagerData.enabled.includes(id);
    const inputId = `norimyn-pack-${escapeId(id)}`;

    const html = `
      <div class="norimyn-regex-pack">
        <div class="norimyn-regex-pack-top">
          <input type="checkbox" id="${inputId}" data-pack="${escapeHtml(id)}" ${enabled ? "checked" : ""}>
          <label for="${inputId}" class="norimyn-regex-pack-name">${escapeHtml(pack.scriptName)}</label>
        </div>
      </div>
    `;

    container.append(html);
  }

  container.find('input[type="checkbox"]').off("change").on("change", async function () {
    const packId = $(this).data("pack");
    const checked = $(this).is(":checked");

    if (checked) {
      if (!window.NoriMynRegexManagerData.enabled.includes(packId)) {
        window.NoriMynRegexManagerData.enabled.push(packId);
        injectRegexPack(packId);
      }
    } else {
      window.NoriMynRegexManagerData.enabled = window.NoriMynRegexManagerData.enabled.filter(p => p !== packId);
      removeRegexPack(packId);
    }

    saveSettings();
    await reloadChatSafe();
  });
}

function injectRegexPack(packId) {
  const script = window.NoriMynRegexManagerData.packs[packId];
  if (!script) return;

  if (!Array.isArray(extension_settings.regex)) {
    extension_settings.regex = [];
  }

  const newId = `norimyn-rgxm-${packId}-${script.id}`;
  const exists = extension_settings.regex.some(r => r.id === newId);
  if (exists) return;

  extension_settings.regex.push({
    id: newId,
    scriptName: script.scriptName,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: Array.isArray(script.trimStrings) ? script.trimStrings : [],
    placement: Array.isArray(script.placement) ? script.placement : [2],
    disabled: false,
    markdownOnly: script.markdownOnly ?? false,
    promptOnly: script.promptOnly ?? false,
    runOnEdit: script.runOnEdit ?? true,
    substituteRegex: script.substituteRegex ?? 0,
    minDepth: script.minDepth ?? null,
    maxDepth: script.maxDepth ?? null
  });

  saveSettingsDebounced();
}

function removeRegexPack(packId) {
  if (!Array.isArray(extension_settings.regex)) return;

  const prefix = `norimyn-rgxm-${packId}-`;

  for (let i = extension_settings.regex.length - 1; i >= 0; i--) {
    const item = extension_settings.regex[i];
    if (item?.id && item.id.startsWith(prefix)) {
      extension_settings.regex.splice(i, 1);
    }
  }

  saveSettingsDebounced();
}

function cleanupManagedRegexes() {
  if (!Array.isArray(extension_settings.regex)) return;

  const validIds = new Set();

  for (const packId of window.NoriMynRegexManagerData.enabled) {
    const script = window.NoriMynRegexManagerData.packs[packId];
    if (script?.id) {
      validIds.add(`norimyn-rgxm-${packId}-${script.id}`);
    }
  }

  for (let i = extension_settings.regex.length - 1; i >= 0; i--) {
    const item = extension_settings.regex[i];
    if (!item?.id || !item.id.startsWith("norimyn-rgxm-")) continue;

    if (!validIds.has(item.id)) {
      extension_settings.regex.splice(i, 1);
    }
  }

  saveSettingsDebounced();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function escapeId(text) {
  return String(text).replace(/[^a-zA-Z0-9\-_:.]/g, "_");
}
