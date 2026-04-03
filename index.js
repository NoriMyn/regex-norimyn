import { saveSettingsDebounced } from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";

const extensionName = "regex-norimyn";

if (!window.RegexManagerData) {
  window.RegexManagerData = {
    packs: {},
    enabled: [],
    active: true,
    collapsed: false
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
      window.RegexManagerData.enabled = Array.isArray(extension_settings[extensionName].enabled)
        ? extension_settings[extensionName].enabled
        : [];
      window.RegexManagerData.active = extension_settings[extensionName].active !== false;
      window.RegexManagerData.collapsed = extension_settings[extensionName].collapsed === true;
    }

    await loadRegexPacks();
    renderPackList();
    updateToggleButton();
    updateCollapseState();
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
      } else {
        removeAllManagedRegexes();
      }

      updateToggleButton();
      saveSettings();
      await reloadChatSafe();
    });

    $("#regex-manager-collapse").on("click", function () {
      window.RegexManagerData.collapsed = !window.RegexManagerData.collapsed;
      updateCollapseState();
      saveSettings();
    });
  } catch (e) {
    console.error("[Regex Manager] Init error full:", e);
    console.error("[Regex Manager] message:", e?.message);
    console.error("[Regex Manager] stack:", e?.stack);
  }
});

function updateToggleButton() {
  const btn = $("#regex-manager-toggle");

  if (window.RegexManagerData.active) {
    btn.text("ВКЛ").removeClass("inactive").addClass("active");
  } else {
    btn.text("ВЫКЛ").removeClass("active").addClass("inactive");
  }

  $("#regex-manager-list input[type=checkbox]").prop("disabled", !window.RegexManagerData.active);
}

function updateCollapseState() {
  const body = $("#regex-manager-body");
  const btn = $("#regex-manager-collapse");

  if (window.RegexManagerData.collapsed) {
    body.addClass("collapsed");
    btn.text("Развернуть");
  } else {
    body.removeClass("collapsed");
    btn.text("Свернуть");
  }
}

function saveSettings() {
  extension_settings[extensionName] = {
    enabled: [...window.RegexManagerData.enabled],
    active: window.RegexManagerData.active,
    collapsed: window.RegexManagerData.collapsed
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
  const packFiles = [
    "thinking-cleanup",
    "think-cleanup",
    "infobloc",
    "buttons-panel",
    "html-cleanup"
  ];

  for (const file of packFiles) {
    try {
      const response = await fetch(`/scripts/extensions/third-party/${extensionName}/regexes/${file}.json`);
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

      window.RegexManagerData.packs[file] = pack;
    } catch (e) {
      console.error(`[Regex Manager] Load error ${file}:`, e);
    }
  }
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
          <label for="${inputId}" class="regex-pack-name">${escapeHtml(pack.scriptName)}</label>
        </div>
        <div class="regex-pack-desc">${escapeHtml(pack.findRegex)}</div>
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
  const script = window.RegexManagerData.packs[packId];
  if (!script) return;

  if (!Array.isArray(extension_settings.regex)) {
    extension_settings.regex = [];
  }

  const newId = `rgxm-${packId}-${script.id}`;
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

  const prefix = `rgxm-${packId}-`;

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

  if (window.RegexManagerData.active) {
    for (const packId of window.RegexManagerData.enabled) {
      const script = window.RegexManagerData.packs[packId];
      if (script?.id) {
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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function escapeId(text) {
  return String(text).replace(/[^a-zA-Z0-9\-_:.]/g, "_");
}
