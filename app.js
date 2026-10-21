"use strict";

const app = document.querySelector("#app");
const topActions = document.querySelector("#top-actions");
const saveProfileControls = document.querySelector("#save-profile-controls");
const live = document.querySelector("#live");

let data = null;
let entries = [];
let currentState = null;
let reusableAtoms = [];
let singleUseAtoms = [];
let atomVariants = new Map();
let personalMeanings = new Map();
let personalImportSummary = null;
let saveProfiles = [];
let activeSaveId = null;
let comparisonSaveId = null;
let compareSaves = false;
let importingSaves = false;
let showPersonalMeanings = false;
let highlightUndeciphered = false;
let saveImportStatus = null;
let writerDraft = [];
let writerCursor = 0;
let comparisonColorOverrides = {};
const meaningComparisonCache = new Map();

const validFilters = new Set(["all", "direct", "dictionary"]);
const atlasColumns = 16;
const personalStorageKey = "alien-demo-dictionary:personal-meanings:v2";
const legacyPersonalStorageKey = "alien-demo-dictionary:personal-meanings:v1";
const writerStorageKey = "alien-demo-dictionary:writer-draft:v2";
const comparisonColorStorageKey = "alien-demo-dictionary:comparison-colors:v1";
const defaultComparisonPalette = Object.freeze({ exact: "#e4f4e7", similar: "#fff4c8", different: "#fbe4e4" });
const saveEntryNamespace = "message-from-aliens:glyph-entry:runtime-v1";
const saveEncryptionKey = "terrible_artwork";
const saveEncryptionIv = "wedidn'tplaytest";
let atlasRows = 1;

function glyphImage(index, className = "glyph-image") {
  const glyph = document.createElement("span");
  glyph.className = className;
  glyph.setAttribute("aria-hidden", "true");
  const column = index % atlasColumns;
  const row = Math.floor(index / atlasColumns);
  glyph.style.backgroundSize = `${atlasColumns * 100}% ${atlasRows * 100}%`;
  glyph.style.backgroundPosition = `${column * 100 / (atlasColumns - 1)}% ${row * 100 / (atlasRows - 1)}%`;
  return glyph;
}

function button(label, className, action) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

function newSaveId() {
  return globalThis.crypto?.randomUUID?.() || `save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function activeSave() {
  return saveProfiles.find((profile) => profile.id === activeSaveId) || null;
}

function selectActiveSave(id) {
  const profile = saveProfiles.find((item) => item.id === id) || saveProfiles[0] || null;
  activeSaveId = profile?.id || null;
  personalMeanings = profile?.meanings || new Map();
  personalImportSummary = profile?.importSummary || null;
  if (!saveProfiles.some((item) => item.id === comparisonSaveId && item.id !== activeSaveId)) {
    comparisonSaveId = saveProfiles.find((item) => item.id !== activeSaveId)?.id || null;
  }
  if (!comparisonSaveId) compareSaves = false;
}

function captionSaveProfiles() {
  const primary = activeSave() || { id: "browser-local", name: "本地释义", meanings: personalMeanings, importSummary: null };
  const secondary = saveProfiles.find((profile) => profile.id === comparisonSaveId);
  return compareSaves && secondary && secondary.id !== primary.id ? [primary, secondary] : [primary];
}

function loadPersonalState() {
  const validTokens = new Set(data.save_key_tokens);
  const cleanMeanings = (raw) => new Map(
    Object.entries(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}).filter(([token, value]) => (
      (validTokens.has(token) || /^[0-9a-f]{16}$/.test(token)) && typeof value === "string" && value.length > 0
    )),
  );
  try {
    const stored = JSON.parse(localStorage.getItem(personalStorageKey) || "null");
    if (stored?.schema === 2 && Array.isArray(stored.profiles)) {
      const seen = new Set();
      saveProfiles = stored.profiles.flatMap((profile) => {
        if (!profile || typeof profile.id !== "string" || !profile.id || seen.has(profile.id)) return [];
        seen.add(profile.id);
        return [{
          id: profile.id,
          name: typeof profile.name === "string" && profile.name.trim() ? profile.name : "未命名存档",
          meanings: cleanMeanings(profile.meanings),
          importSummary: profile.importSummary && typeof profile.importSummary === "object" ? profile.importSummary : null,
        }];
      });
      comparisonSaveId = stored.comparisonSaveId;
      compareSaves = stored.compareSaves === true;
      selectActiveSave(stored.activeSaveId);
      showPersonalMeanings = stored.showPersonalMeanings === true;
      highlightUndeciphered = stored.highlightUndeciphered === true;
      return;
    }
  } catch {}
  // Keep the original storage entry intact so migration is recoverable.
  try {
    const stored = JSON.parse(localStorage.getItem(legacyPersonalStorageKey) || "null");
    if (!stored || stored.schema !== 1) return;
    const meanings = cleanMeanings(stored.meanings);
    const summary = stored.importSummary && typeof stored.importSummary === "object" ? stored.importSummary : null;
    if (meanings.size || summary) {
      saveProfiles = [{ id: newSaveId(), name: summary?.fileName || "本地释义", meanings, importSummary: summary }];
      selectActiveSave(saveProfiles[0].id);
    }
    showPersonalMeanings = stored.showPersonalMeanings === true;
    highlightUndeciphered = stored.highlightUndeciphered === true;
    persistPersonalState();
  } catch {}
}

function persistPersonalState() {
  try {
    localStorage.setItem(personalStorageKey, JSON.stringify({
      schema: 2,
      profiles: saveProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        meanings: Object.fromEntries(profile.meanings),
        importSummary: profile.importSummary,
      })),
      activeSaveId,
      comparisonSaveId,
      compareSaves,
      showPersonalMeanings,
      highlightUndeciphered,
    }));
    return true;
  } catch {
    return false;
  }
}

function loadWriterDraft() {
  writerDraft = [];
  try {
    const stored = JSON.parse(localStorage.getItem(writerStorageKey) || "null");
    if (stored && stored.schema === 1 && Array.isArray(stored.items)) {
      const indexByToken = new Map(data.save_key_tokens.map((token, index) => [token, index]));
      writerDraft = stored.items.flatMap((item) => {
        if (item === " " || item === "\n") return [item];
        return indexByToken.has(item) ? [indexByToken.get(item)] : [];
      });
    }
  } catch {}
  writerCursor = writerDraft.length;
}

function persistWriterDraft() {
  try {
    localStorage.setItem(writerStorageKey, JSON.stringify({
      schema: 1,
      items: writerDraft.map((item) => (Number.isInteger(item) ? data.save_key_tokens[item] : item)),
    }));
    return true;
  } catch {
    return false;
  }
}

function personalMeaningForIndex(index) {
  return personalMeanings.get(data.save_key_tokens[index]) || "";
}

function profileMeaningForIndex(profile, index) {
  return profile.meanings.get(data.save_key_tokens[index]) || "";
}

function matchingMeaning(index, query) {
  return captionSaveProfiles()
    .map((profile) => profileMeaningForIndex(profile, index))
    .find((meaning) => isDecipheredMeaning(meaning) && meaning.toLocaleLowerCase().includes(query));
}

function isDecipheredMeaning(value) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 && normalized !== "?" && normalized !== "？";
}

function isDecipheredIndex(index) {
  return isDecipheredMeaning(personalMeaningForIndex(index));
}

function comparisonPairKey() {
  const profiles = captionSaveProfiles();
  return profiles.length === 2 ? JSON.stringify(profiles.map((profile) => profile.id).sort()) : null;
}

function validColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function loadComparisonColors() {
  try {
    const stored = JSON.parse(localStorage.getItem(comparisonColorStorageKey) || "null");
    if (stored?.schema === 1) {
      const validTokens = new Set(data.save_key_tokens);
      const validProfiles = new Set(saveProfiles.map((profile) => profile.id));
      if (stored.overrides && typeof stored.overrides === "object" && !Array.isArray(stored.overrides)) {
        for (const [key, overrides] of Object.entries(stored.overrides)) {
          let ids;
          try { ids = JSON.parse(key); } catch { continue; }
          if (!Array.isArray(ids) || ids.length !== 2 || ids[0] === ids[1] || !ids.every((id) => validProfiles.has(id))) continue;
          if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) continue;
          const clean = Object.fromEntries(Object.entries(overrides).filter(([token, color]) => (validTokens.has(token) || /^[0-9a-f]{16}$/.test(token)) && validColor(color)));
          if (Object.keys(clean).length) comparisonColorOverrides[JSON.stringify(ids.sort())] = clean;
        }
      }
    }
  } catch {}
}

function persistComparisonColors() {
  try {
    localStorage.setItem(comparisonColorStorageKey, JSON.stringify({
      schema: 1,
      overrides: comparisonColorOverrides,
    }));
    return true;
  } catch {
    return false;
  }
}

function normalizedComparisonMeaning(value) {
  return String(value || "").normalize("NFC").trim();
}

function meaningSimilarity(first, second) {
  if (first === second) return 1;
  let left = Array.from(first);
  let right = Array.from(second);
  const length = Math.max(left.length, right.length);
  if (!length) return 1;
  let prefix = 0;
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix += 1;
  left = left.slice(prefix);
  right = right.slice(prefix);
  while (left.length && right.length && left.at(-1) === right.at(-1)) {
    left.pop();
    right.pop();
  }
  if (!left.length || !right.length) return 1 - Math.max(left.length, right.length) / length;
  if (left.length > right.length) [left, right] = [right, left];
  let previous = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let row = 1; row <= right.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= left.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + Number(left[column - 1] !== right[row - 1]),
      );
    }
    previous = current;
  }
  return 1 - previous[left.length] / length;
}

function comparisonForIndex(index) {
  const profiles = captionSaveProfiles();
  if (profiles.length !== 2) return null;
  const pairKey = comparisonPairKey();
  const token = data.save_key_tokens[index];
  const ordered = [...profiles].sort((left, right) => left.id.localeCompare(right.id));
  const values = ordered.map((profile) => normalizedComparisonMeaning(profileMeaningForIndex(profile, index)));
  const cacheKey = `${pairKey}:${token}`;
  let cached = meaningComparisonCache.get(cacheKey);
  if (!cached || cached.first !== values[0] || cached.second !== values[1]) {
    const available = values.map(isDecipheredMeaning);
    let category = null;
    if (available.some(Boolean)) {
      if (!available.every(Boolean)) category = "different";
      else if (values[0] === values[1]) category = "exact";
      else category = meaningSimilarity(...values) >= 0.5 ? "similar" : "different";
    }
    cached = { first: values[0], second: values[1], category };
    if (meaningComparisonCache.size > data.count * 4) meaningComparisonCache.clear();
    meaningComparisonCache.set(cacheKey, cached);
  }
  const manualColor = comparisonColorOverrides[pairKey]?.[token] || null;
  return { category: cached.category, manualColor, pairKey, token };
}

function applyComparisonColor(element, index) {
  const result = comparisonForIndex(index);
  // Comparison colors belong only to personal meanings, never to glyphs or buttons.
  const colored = element.classList.contains("comparison-meaning") && result && (result.category || result.manualColor);
  element.classList.toggle("comparison-colored", Boolean(colored));
  if (colored) {
    element.style.setProperty("--comparison-background", result.manualColor || `var(--comparison-${result.category})`);
    element.dataset.comparisonCategory = result.manualColor ? "manual" : result.category;
  } else {
    element.style.removeProperty("--comparison-background");
    delete element.dataset.comparisonCategory;
  }
}

function markComparisonMeaning(element, index) {
  element.classList.add("comparison-meaning");
  element.dataset.comparisonIndex = String(index);
  applyComparisonColor(element, index);
  return element;
}

function refreshComparisonMeanings(index) {
  for (const meaning of document.querySelectorAll("[data-comparison-index]")) {
    if (meaning.dataset.comparisonIndex === String(index)) applyComparisonColor(meaning, index);
  }
  refreshEntryColorControl(index);
}

function setEntryComparisonColor(index, color) {
  const result = comparisonForIndex(index);
  if (!result || (color !== null && !validColor(color))) return;
  if (color) {
    comparisonColorOverrides[result.pairKey] ||= {};
    comparisonColorOverrides[result.pairKey][result.token] = color;
  } else if (comparisonColorOverrides[result.pairKey]) {
    delete comparisonColorOverrides[result.pairKey][result.token];
    if (!Object.keys(comparisonColorOverrides[result.pairKey]).length) delete comparisonColorOverrides[result.pairKey];
  }
  const persisted = persistComparisonColors();
  refreshComparisonMeanings(index);
  const control = document.querySelector(".entry-color-control");
  if (control) {
    const note = control.querySelector(".entry-color-note");
    note.textContent = persisted ? "只保存在此浏览器，适用于当前两份存档。" : "浏览器未能保存这次改色；当前页面仍可使用。";
    note.classList.toggle("warning", !persisted);
  }
}

function refreshEntryColorControl(index) {
  const control = document.querySelector(".entry-color-control");
  if (!control || control.dataset.entryIndex !== String(index)) return;
  const result = comparisonForIndex(index);
  if (!result) return;
  const categories = { exact: "完全相同", similar: "相似度 ≥ 50%", different: "不同", neutral: "均未填写" };
  control.querySelector(".entry-color-status").textContent = result.manualColor
    ? `手动标色（自动判断：${categories[result.category || "neutral"]}）`
    : `自动判断：${categories[result.category || "neutral"]}`;
  control.querySelector(".entry-color-picker").value = result.manualColor || defaultComparisonPalette[result.category] || "#ffffff";
  control.querySelector(".entry-color-reset").disabled = !result.manualColor;
  for (const swatch of control.querySelectorAll(".entry-color-swatch")) {
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color === result.manualColor?.toLowerCase()));
  }
}

function makeEntryColorControl(index) {
  const control = document.createElement("div");
  control.className = "entry-color-control";
  control.dataset.entryIndex = String(index);
  const heading = document.createElement("strong");
  heading.textContent = "此字释义对比底色";
  const status = document.createElement("span");
  status.className = "entry-color-status";
  const actions = document.createElement("div");
  actions.className = "entry-color-actions";
  for (const [category, name] of [["exact", "浅绿"], ["similar", "浅黄"], ["different", "浅红"]]) {
    const color = defaultComparisonPalette[category];
    const swatch = button(name, "entry-color-swatch", () => setEntryComparisonColor(index, color));
    swatch.dataset.color = color;
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-label", `将此字释义标为${name}`);
    actions.append(swatch);
  }
  const label = document.createElement("label");
  label.className = "entry-color-custom";
  label.append("自选");
  const picker = document.createElement("input");
  picker.type = "color";
  picker.className = "entry-color-picker";
  picker.setAttribute("aria-label", "自选此字释义的对比底色");
  picker.addEventListener("input", () => setEntryComparisonColor(index, picker.value));
  label.append(picker);
  actions.append(label, button("恢复自动", "clear-button entry-color-reset", () => setEntryComparisonColor(index, null)));
  const note = document.createElement("span");
  note.className = "entry-color-note";
  note.setAttribute("role", "status");
  note.textContent = "只保存在此浏览器，适用于当前两份存档。";
  control.append(heading, status, actions, note);
  return control;
}

function makeComparisonLegend() {
  const legend = document.createElement("div");
  legend.className = "comparison-legend";
  const heading = document.createElement("span");
  heading.textContent = "释义底色：";
  legend.append(heading);
  for (const [category, text] of [["exact", "完全相同"], ["similar", "相似度 ≥ 50%"], ["different", "不同"]]) {
    const item = document.createElement("span");
    item.className = "comparison-legend-item";
    const dot = document.createElement("i");
    dot.style.backgroundColor = defaultComparisonPalette[category];
    item.append(dot, text);
    legend.append(item);
  }
  const note = document.createElement("span");
  note.className = "comparison-legend-note";
  note.textContent = "均未填写不着色；点进单字可手动修改释义底色。";
  note.title = "文字相似度 = 1 − 编辑距离 / 较长释义的字数；忽略首尾空白。两边都未填写或只填问号时不着色。";
  legend.append(note);
  return legend;
}

function decipheredCount() {
  return entries.reduce((count, _, index) => count + Number(isDecipheredIndex(index)), 0);
}

function markGlyphContainer(element, index) {
  element.dataset.glyphIndex = String(index);
  if (highlightUndeciphered && !isDecipheredIndex(index)) element.classList.add("undeciphered-highlight");
  return element;
}

function makePersonalCaption(indexOrIndexes, className) {
  const indexes = Array.isArray(indexOrIndexes) ? indexOrIndexes : [indexOrIndexes];
  const profiles = captionSaveProfiles();
  const label = document.createElement("span");
  label.className = className;
  if (profiles.length === 2) label.classList.add("comparison-caption");
  profiles.forEach((profile) => {
    const row = document.createElement("span");
    row.className = "personal-meaning-row";
    row.title = profile.name;
    row.dataset.saveId = profile.id;
    const content = document.createElement("span");
    content.className = "personal-meaning-row-content";
    indexes.forEach((index, position) => {
      if (position) {
        const separator = document.createElement("span");
        separator.className = "personal-meaning-separator";
        separator.textContent = " / ";
        content.append(separator);
      }
      const part = document.createElement("span");
      part.className = "personal-meaning-part";
      part.dataset.glyphIndex = String(index);
      const meaning = profileMeaningForIndex(profile, index);
      if (isDecipheredMeaning(meaning)) part.textContent = meaning;
      else {
        part.classList.add("missing");
        part.textContent = "?";
      }
      if (indexes.length > 1) markComparisonMeaning(part, index);
      content.append(part);
    });
    row.append(content);
    label.append(row);
  });
  if (indexes.length === 1) markComparisonMeaning(label, indexes[0]);
  return label;
}

function refreshMeaningCaptions(profile, index) {
  const meaning = profileMeaningForIndex(profile, index);
  const deciphered = isDecipheredMeaning(meaning);
  for (const part of document.querySelectorAll(".personal-meaning-part")) {
    if (part.dataset.glyphIndex === String(index) && part.closest(".personal-meaning-row")?.dataset.saveId === profile.id) {
      part.textContent = deciphered ? meaning : "?";
      part.classList.toggle("missing", !deciphered);
    }
  }
  if (profile.id === activeSaveId) {
    for (const glyph of document.querySelectorAll("[data-glyph-index]:not(.personal-meaning-part)")) {
      if (glyph.dataset.glyphIndex === String(index)) glyph.classList.toggle("undeciphered-highlight", highlightUndeciphered && !deciphered);
    }
  }
  refreshComparisonMeanings(index);
}

function withPersonalCaption(container, indexOrIndexes, variant) {
  const indexes = Array.isArray(indexOrIndexes) ? indexOrIndexes : [indexOrIndexes];
  const index = indexes[0];
  if (indexes.length === 1) {
    container.dataset.glyphIndex = String(index);
  }
  if (!showPersonalMeanings) return container;
  const stack = document.createElement("span");
  stack.className = `glyph-meaning-stack ${variant}-meaning-stack`;
  if (variant === "target") {
    stack.append(container);
    const profiles = captionSaveProfiles();
    profiles.forEach((profile, rowIndex) => {
      const editor = document.createElement("input");
      editor.type = "text";
      editor.className = "inline-personal-meaning target-personal-meaning-input";
      editor.maxLength = 300;
      editor.value = profileMeaningForIndex(profile, index);
      editor.dataset.saveId = profile.id;
      markComparisonMeaning(editor, index);
      editor.placeholder = "?";
      editor.title = "保存在此浏览器，不会写回游戏存档";
      editor.setAttribute("aria-label", profiles.length === 2 ? `编辑存档 ${rowIndex + 1} 的个人释义` : "编辑这个字的个人释义");
      editor.addEventListener("input", () => {
        if (!saveProfiles.some((item) => item.id === profile.id)) {
          saveProfiles.push(profile);
          selectActiveSave(profile.id);
        }
        const token = data.save_key_tokens[index];
        if (editor.value.length > 0) profile.meanings.set(token, editor.value);
        else profile.meanings.delete(token);
        const persisted = persistPersonalState();
        editor.title = persisted
          ? "已保存到此浏览器，不会写回游戏存档"
          : "浏览器未允许保存这次修改";
        refreshMeaningCaptions(profile, index);
        renderSaveProfileControls();
      });
      if (profiles.length === 2) {
        const row = document.createElement("label");
        row.className = "target-save-editor";
        row.title = profile.name;
        row.append(editor);
        stack.append(row);
      } else stack.append(editor);
    });
    return stack;
  }
  const label = makePersonalCaption(indexes, "inline-personal-meaning");
  stack.append(container, label);
  return stack;
}

function personalProgressText() {
  const recognized = decipheredCount();
  const percentage = data.count > 0 ? (recognized * 100 / data.count).toFixed(1) : "0.0";
  return `${compareSaves ? "存档 1 " : ""}破译进度：${recognized} / ${data.count}（${percentage}%）`;
}

function bytesFromBase64(text) {
  const normalized = text.trim().replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new Error("invalid base64");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (!bytes.length || bytes.length % 16 !== 0) throw new Error("invalid encrypted length");
  return bytes;
}

async function decryptSave(text) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(saveEncryptionKey),
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: encoder.encode(saveEncryptionIv) },
    key,
    bytesFromBase64(text),
  );
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted));
}

async function saveTokenForKey(key) {
  const normalized = String(key).replaceAll(":", "");
  const bytes = new TextEncoder().encode(`${saveEntryNamespace}\0${normalized}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 8)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function readSaveProfile(file) {
    if (!file || file.size > 5 * 1024 * 1024) throw new Error("save file is missing or too large");
    const payload = await decryptSave(await file.text());
    if (
      !payload
      || typeof payload !== "object"
      || !payload.dict
      || typeof payload.dict !== "object"
      || Array.isArray(payload.dict)
    ) throw new Error("save dictionary is missing");

    const validTokens = new Set(data.save_key_tokens);
    const imported = new Map();
    let ignored = 0;
    const rows = await Promise.all(Object.entries(payload.dict).map(async ([key, value]) => ({
      token: await saveTokenForKey(key),
      value,
    })));
    for (const row of rows) {
      if (!validTokens.has(row.token)) {
        ignored += 1;
        continue;
      }
      if (typeof row.value === "string" && row.value.length > 0) imported.set(row.token, row.value);
    }

    const recognized = [...imported.values()].filter(isDecipheredMeaning).length;
    const importSummary = {
      fileName: file.name,
      version: ["string", "number"].includes(typeof payload.version) ? String(payload.version) : "未知",
      recognized,
      missing: data.count - recognized,
      ignored,
      importedAt: Date.now(),
    };
    return { id: newSaveId(), name: file.name || "未命名存档", meanings: imported, importSummary };
}

async function importSaveFiles(files) {
  const selected = Array.from(files || []);
  if (!selected.length || importingSaves) return;
  importingSaves = true;
  saveImportStatus = { kind: "loading", text: `正在读取 ${selected.length} 个存档…` };
  render();
  const imported = [];
  let failures = 0;
  for (const file of selected) {
    try {
      const profile = await readSaveProfile(file);
      const originalName = profile.name;
      let suffix = 2;
      while ([...saveProfiles, ...imported].some((item) => item.name === profile.name)) {
        profile.name = `${originalName}（${suffix++}）`;
      }
      imported.push(profile);
    } catch {
      failures += 1;
    }
  }
  importingSaves = false;
  if (imported.length) {
    saveProfiles.push(...imported);
    selectActiveSave(activeSaveId || imported[0].id);
    const newComparison = imported.find((profile) => profile.id !== activeSaveId);
    if (newComparison) {
      comparisonSaveId = newComparison.id;
      compareSaves = true;
    }
    showPersonalMeanings = true;
    const persisted = persistPersonalState();
    saveImportStatus = {
      kind: persisted && !failures ? "success" : "warning",
      text: persisted
        ? `已导入 ${imported.length} 个存档，现有 ${saveProfiles.length} 个。${failures ? `另有 ${failures} 个文件无法读取。` : ""}`
        : `已导入 ${imported.length} 个存档，但浏览器未能保存，请勿关闭页面。`,
    };
  } else {
    saveImportStatus = { kind: "error", text: "无法读取所选存档：文件格式或版本不受支持。原有存档已保留。" };
  }
  render();
}

async function importSaveFile(file) {
  return importSaveFiles([file]);
}

function chooseSaveFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".sav,.backup";
  input.multiple = true;
  input.addEventListener("change", () => {
    importSaveFiles(input.files);
  });
  input.click();
}

function defaultState() {
  return {
    view: "home",
    filter: "all",
    undecipheredOnly: false,
    atoms: [],
    showSingleNumerals: false,
    excludeOtherAtoms: false,
    scrollY: 0,
    depth: 0,
  };
}

function normalizedState(raw) {
  const state = raw && typeof raw === "object" ? raw : defaultState();
  const depth = Number.isInteger(state.depth) && state.depth >= 0 ? state.depth : 0;
  const scrollY = Number.isFinite(state.scrollY) && state.scrollY >= 0 ? state.scrollY : 0;
  if (state.view === "detail" && Number.isInteger(state.index) && state.index >= 0 && state.index < entries.length) {
    return { view: "detail", index: state.index, scrollY, depth };
  }
  if (state.view === "meanings") {
    return { view: "meanings", query: typeof state.query === "string" ? state.query : "", scrollY, depth };
  }
  if (state.view === "writer") {
    return { view: "writer", scrollY, depth };
  }
  if (state.view === "components") {
    const showSingleNumerals = state.showSingleNumerals === true;
    const excludeOtherAtoms = state.excludeOtherAtoms === true;
    const hideableAtoms = new Set(data.hideable_number_atom_indices || []);
    const atoms = Array.isArray(state.atoms)
      ? state.atoms.filter((value) => (
        Number.isInteger(value)
        && data.atom_indices.includes(value)
        && (showSingleNumerals || !hideableAtoms.has(value))
      ))
      : [];
    return {
      view: "components",
      atoms: [...new Set(atoms)],
      showSingleNumerals,
      excludeOtherAtoms,
      scrollY,
      depth,
    };
  }
  return {
    view: "home",
    filter: validFilters.has(state.filter) ? state.filter : "all",
    undecipheredOnly: state.undecipheredOnly === true && saveProfiles.length > 0,
    scrollY,
    depth,
  };
}

function captureScroll() {
  if (!currentState) return;
  currentState = { ...currentState, scrollY: window.scrollY };
  history.replaceState(currentState, "", location.pathname + location.search);
}

function navigate(next) {
  captureScroll();
  currentState = normalizedState({ ...next, depth: (currentState?.depth ?? 0) + 1, scrollY: 0 });
  history.pushState(currentState, "", location.pathname + location.search);
  render();
}

function replaceCurrent(patch, shouldRender = true) {
  currentState = normalizedState({ ...currentState, ...patch });
  history.replaceState(currentState, "", location.pathname + location.search);
  if (shouldRender) render();
}

function goBack() {
  captureScroll();
  if ((currentState?.depth ?? 0) > 0) history.back();
}

function goHome() {
  if (currentState?.view === "home") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    replaceCurrent({ scrollY: 0 }, false);
    return;
  }
  navigate({ view: "home", filter: "all" });
}

function goComponents() {
  if (currentState.view === "components") return;
  navigate({ view: "components", atoms: [], showSingleNumerals: false, excludeOtherAtoms: false });
}

function goMeaningSearch() {
  if (currentState.view === "meanings") return;
  navigate({ view: "meanings", query: "" });
}

function goWriter() {
  if (currentState.view === "writer") return;
  navigate({ view: "writer" });
}

function renderTopActions() {
  topActions.replaceChildren();
  if (!currentState) return;
  const componentSearch = button("按部件找字", "nav-button", goComponents);
  componentSearch.setAttribute("aria-pressed", String(currentState.view === "components"));
  const meaningSearch = button("按释义找字", "nav-button", goMeaningSearch);
  meaningSearch.setAttribute("aria-pressed", String(currentState.view === "meanings"));
  const writer = button("外星写作", "nav-button", goWriter);
  writer.setAttribute("aria-pressed", String(currentState.view === "writer"));
  const importButton = button("导入存档", "nav-button", chooseSaveFile);
  importButton.disabled = importingSaves;
  importButton.title = "可一次选择多个存档文件。存档路径参考：C:\\Users\\<你的用户名>\\AppData\\LocalLow\\Artless Games\\MessageFromAliens\\alienmessage1.sav（其他槽位对应 alienmessage2.sav 等）";
  const visibility = button(showPersonalMeanings ? "隐藏释义" : "显示释义", "nav-button", () => {
    showPersonalMeanings = !showPersonalMeanings;
    persistPersonalState();
    render();
  });
  visibility.setAttribute("aria-pressed", String(showPersonalMeanings));
  const highlight = button("高亮未破译", "nav-button highlight-toggle", () => {
    highlightUndeciphered = !highlightUndeciphered;
    persistPersonalState();
    render();
  });
  highlight.setAttribute("aria-pressed", String(highlightUndeciphered));
  const compare = button("存档对比", "nav-button save-compare-toggle", () => {
    compareSaves = !compareSaves;
    if (compareSaves) showPersonalMeanings = true;
    persistPersonalState();
    render();
  });
  compare.disabled = saveProfiles.length < 2;
  compare.title = saveProfiles.length < 2 ? "导入至少两个存档后，可对比释义" : "分两排显示所选两个存档的释义";
  compare.setAttribute("aria-pressed", String(compareSaves));
  topActions.append(componentSearch, meaningSearch, writer, importButton, compare, visibility, highlight);
  if (currentState.view !== "home") {
    const back = button("← 上一页", "nav-button", goBack);
    back.disabled = currentState.depth === 0;
    topActions.append(back, button("返回首页", "nav-button", goHome));
  }
  renderSaveProfileControls();
}

function renderSaveProfileControls() {
  if (!saveProfileControls) return;
  saveProfileControls.replaceChildren();
  saveProfileControls.hidden = !saveProfiles.length && !saveImportStatus;
  if (saveProfiles.length) {
    const controls = document.createElement("div");
    controls.className = "save-profile-selectors";
    function makeSelector(labelText, id, selectedId, profiles, onChange) {
      const label = document.createElement("label");
      label.className = "save-profile-selector";
      const text = document.createElement("span");
      text.textContent = labelText;
      const select = document.createElement("select");
      select.id = id;
      select.setAttribute("aria-label", labelText);
      for (const profile of profiles) {
        const option = document.createElement("option");
        const recognized = data.save_key_tokens.filter((token) => isDecipheredMeaning(profile.meanings.get(token))).length;
        option.value = profile.id;
        option.textContent = `${profile.name}（${recognized}/${data.count}）`;
        select.append(option);
      }
      select.value = selectedId;
      select.addEventListener("change", () => {
        onChange(select.value);
        if (!persistPersonalState()) saveImportStatus = { kind: "warning", text: "浏览器未能保存这次存档选择。" };
        render();
      });
      label.append(text, select);
      controls.append(label);
    }
    makeSelector(compareSaves ? "存档 1" : "当前存档", "active-save-select", activeSaveId, saveProfiles, (id) => {
      const previousId = activeSaveId;
      if (id === comparisonSaveId) comparisonSaveId = previousId;
      selectActiveSave(id);
    });
    if (compareSaves) {
      makeSelector("存档 2", "comparison-save-select", comparisonSaveId, saveProfiles.filter((profile) => profile.id !== activeSaveId), (id) => {
        comparisonSaveId = id;
      });
      controls.append(button("交换存档", "utility-button save-swap-button", () => {
        const previousId = activeSaveId;
        selectActiveSave(comparisonSaveId);
        comparisonSaveId = previousId;
        persistPersonalState();
        render();
      }));
    }
    controls.append(button("重命名", "clear-button", () => {
      const profile = activeSave();
      const name = window.prompt("给当前存档起一个名字，方便区分：", profile.name);
      if (name === null || !name.trim()) return;
      profile.name = name.trim().slice(0, 100);
      persistPersonalState();
      render();
    }));
    controls.append(button("移除", "clear-button", () => {
      const profile = activeSave();
      if (!window.confirm(`从浏览器移除“${profile.name}”？这份存档的网页修改也会移除，游戏文件不受影响。`)) return;
      saveProfiles = saveProfiles.filter((item) => item.id !== profile.id);
      for (const key of Object.keys(comparisonColorOverrides)) {
        if (JSON.parse(key).includes(profile.id)) delete comparisonColorOverrides[key];
      }
      persistComparisonColors();
      selectActiveSave(null);
      saveImportStatus = null;
      currentState = normalizedState(currentState);
      persistPersonalState();
      render();
    }));
    const note = document.createElement("span");
    note.className = "save-profile-note";
    note.textContent = compareSaves
      ? "查字同时搜索两份释义；进度和未破译高亮以存档 1 为准。"
      : `已保存 ${saveProfiles.length} 个存档，可继续导入。`;
    controls.append(note);
    saveProfileControls.append(controls);
    if (compareSaves) saveProfileControls.append(makeComparisonLegend());
  }
  if (saveImportStatus) {
    const status = document.createElement("p");
    status.className = `save-profile-status ${saveImportStatus.kind}`;
    status.setAttribute("role", "status");
    status.textContent = saveImportStatus.text;
    saveProfileControls.append(status);
  }
}

function makeGlyphCard(index) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "glyph-card";
  if (entries[index].not_word) card.classList.add("not-word");
  if (entries[index].startup_only) card.classList.add("startup-only");
  markGlyphContainer(card, index);
  card.setAttribute(
    "aria-label",
    entries[index].startup_only
      ? "查看这个仅从启动时左页可达的字的到达路径"
      : (entries[index].not_word ? "查看这个非正式字的到达路径" : "查看这个字的到达路径"),
  );
  card.append(glyphImage(index));
  if (showPersonalMeanings) {
    card.classList.add("shows-personal-meaning");
    const label = makePersonalCaption(index, "personal-meaning-label");
    card.append(label);
  }
  card.addEventListener("click", () => navigate({ view: "detail", index }));
  return card;
}

function makeNotWordKey() {
  const key = document.createElement("span");
  key.className = "not-word-key";
  key.textContent = "黄底：非正式字";
  key.title = "游戏里写出其不是字";
  return key;
}

function makeStartupOnlyKey() {
  const key = document.createElement("span");
  key.className = "startup-only-key";
  key.textContent = "绿底：仅启动左页可达";
  key.title = "游戏开始时左边会有一个问好页，只能通过这个页进入该字";
  return key;
}

function makeGlyphGrid(indexes) {
  const grid = document.createElement("div");
  grid.className = "glyph-grid";
  for (const index of indexes) grid.append(makeGlyphCard(index));
  return grid;
}

function sortByPathLength(indexes) {
  return [...indexes].sort((left, right) => (
    entries[left].path_length - entries[right].path_length || left - right
  ));
}

function filterIndexes(filter) {
  if (filter === "direct") return sortByPathLength(entries.flatMap((item, index) => item.direct ? [index] : []));
  if (filter === "dictionary") return sortByPathLength(entries.flatMap((item, index) => item.direct ? [] : [index]));
  return sortByPathLength(entries.map((_, index) => index));
}

function renderHome() {
  const shell = document.createElement("section");
  shell.className = "page-shell";

  const heading = document.createElement("div");
  heading.className = "home-heading";
  heading.innerHTML = `
    <div>
      <p class="eyebrow">可达字形一览</p>
      <h1>Demo 字典</h1>
      <p class="summary">共 ${data.count} 个字，按到达所需点击次数从少到多排列。点开任意字，就能查看完整路径。</p>
    </div>`;

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const componentButton = button("按部件找字", "utility-button", () => navigate({
    view: "components",
    atoms: [],
    showSingleNumerals: false,
    excludeOtherAtoms: false,
  }));
  const saveControls = document.createElement("div");
  saveControls.className = "save-controls";
  const importButton = button("导入存档", "utility-button save-import-button", chooseSaveFile);
  importButton.title = "存档路径参考：C:\\Users\\<你的用户名>\\AppData\\LocalLow\\Artless Games\\MessageFromAliens\\alienmessage1.sav（槽位 2/3 对应 alienmessage2.sav、alienmessage3.sav）";
  const visibilityOption = document.createElement("label");
  visibilityOption.className = "toggle-option personal-visibility-toggle";
  const visibilityCheckbox = document.createElement("input");
  visibilityCheckbox.type = "checkbox";
  visibilityCheckbox.checked = showPersonalMeanings;
  visibilityCheckbox.addEventListener("change", () => {
    showPersonalMeanings = visibilityCheckbox.checked;
    const persisted = persistPersonalState();
    if (!persisted) saveImportStatus = { kind: "warning", text: "浏览器未允许保存显示设置。" };
    render();
  });
  const visibilityText = document.createElement("span");
  visibilityText.textContent = "显示个人释义";
  visibilityOption.append(visibilityCheckbox, visibilityText);
  saveControls.append(importButton, visibilityOption);
  const filters = document.createElement("div");
  filters.className = "filter-group";
  filters.setAttribute("aria-label", "字形范围");
  const choices = [
    ["all", `全部 ${data.count}`],
    ["direct", `直接可达 ${data.direct_count}`],
    ["dictionary", `由字典可达 ${data.dictionary_count}`],
  ];
  for (const [value, label] of choices) {
    const control = button(label, "filter-button", () => replaceCurrent({ filter: value, scrollY: 0 }));
    control.setAttribute("aria-pressed", String(currentState.filter === value));
    filters.append(control);
  }
  toolbar.append(makeNotWordKey(), makeStartupOnlyKey(), filters);
  heading.append(toolbar);
  shell.append(heading);
  if (activeSave()) {
    const progressCard = document.createElement("div");
    progressCard.className = "save-progress";
    const progressText = document.createElement("strong");
    progressText.textContent = personalProgressText();
    const progress = document.createElement("progress");
    progress.max = data.count;
    progress.value = decipheredCount();
    progress.setAttribute("aria-label", personalProgressText());
    const undecipheredToggle = button(
      currentState.undecipheredOnly ? "显示全部字" : "查看所有未破译字",
      "utility-button undeciphered-filter-button",
      () => replaceCurrent({ undecipheredOnly: !currentState.undecipheredOnly, scrollY: 0 }),
    );
    undecipheredToggle.setAttribute("aria-pressed", String(currentState.undecipheredOnly));
    progressCard.append(progressText, progress, undecipheredToggle);
    shell.append(progressCard);
  }
  const visibleIndexes = filterIndexes(currentState.filter).filter((index) => (
    !currentState.undecipheredOnly || !isDecipheredIndex(index)
  ));
  shell.append(makeGlyphGrid(visibleIndexes));
  app.replaceChildren(shell);
}

function renderComponents() {
  const selected = new Set(currentState.atoms);
  const hideableAtoms = new Set(data.hideable_number_atom_indices || []);
  const shell = document.createElement("section");
  shell.className = "page-shell search-layout";
  shell.innerHTML = `
    <div>
      <p class="eyebrow">组合查询</p>
      <h1>按部件找字</h1>
      <p class="summary">选择一个或多个形状，结果会同时包含它们。</p>
    </div>`;

  const paletteCard = document.createElement("section");
  paletteCard.className = "section-card";
  const paletteHeading = document.createElement("div");
  paletteHeading.className = "section-heading";
  const paletteTitle = document.createElement("h2");
  paletteTitle.textContent = "1. 选择组成部件";
  const selectionCount = document.createElement("span");
  selectionCount.className = "selection-count";
  selectionCount.textContent = `已选 ${selected.size} 个`;
  const clear = button("清空", "clear-button", () => replaceCurrent({ atoms: [], scrollY: 0 }));
  clear.disabled = selected.size === 0;
  const exclusionOption = document.createElement("label");
  exclusionOption.className = "toggle-option exact-atoms-toggle";
  exclusionOption.title = "只保留完全由已选部首组成的字；重复使用已选部首不受影响";
  const exclusionCheckbox = document.createElement("input");
  exclusionCheckbox.type = "checkbox";
  exclusionCheckbox.checked = currentState.excludeOtherAtoms;
  exclusionCheckbox.addEventListener("change", () => {
    replaceCurrent({ excludeOtherAtoms: exclusionCheckbox.checked, scrollY: window.scrollY });
  });
  const exclusionText = document.createElement("span");
  exclusionText.textContent = "排除其他部首";
  exclusionOption.append(exclusionCheckbox, exclusionText);
  const paletteActions = document.createElement("div");
  paletteActions.className = "palette-actions";
  paletteActions.append(exclusionOption, clear);
  paletteHeading.append(paletteTitle, selectionCount, makeNotWordKey(), paletteActions);

  function makeAtomButton(atom) {
    const variants = atomVariants.get(atom) || [];
    const pairedVariant = variants.length === 1 ? variants[0] : null;
    const atomButton = document.createElement("button");
    atomButton.type = "button";
    atomButton.className = "atom-button";
    if (!pairedVariant) {
      if (entries[atom].not_word) atomButton.classList.add("not-word");
      if (entries[atom].startup_only) atomButton.classList.add("startup-only");
      markGlyphContainer(atomButton, atom);
    } else {
      atomButton.classList.add("has-transform-variant");
    }
    const transformDescription = pairedVariant
      ? {
          flip_horizontal: "左右翻转",
          flip_vertical: "上下翻转",
          rotate_180: "旋转 180 度",
        }[pairedVariant.transform]
      : "";
    atomButton.setAttribute(
      "aria-label",
      entries[atom].startup_only
        ? (selected.has(atom) ? "取消这个仅从启动时左页可达的部件" : "选择这个仅从启动时左页可达的部件")
        : entries[atom].not_word
        ? (selected.has(atom) ? "取消这个非正式字部件" : "选择这个非正式字部件")
        : pairedVariant
        ? `${selected.has(atom) ? "取消" : "选择"}这个部件及其${transformDescription}形式`
        : (selected.has(atom) ? "取消这个部件" : "选择这个部件"),
    );
    atomButton.setAttribute("aria-pressed", String(selected.has(atom)));
    if (pairedVariant) {
      atomButton.title = `这两个形状在部件查询中视为同一部首（${transformDescription}）`;
      for (const [index, position] of [
        [atom, "primary"],
        [pairedVariant.glyph, "secondary"],
      ]) {
        const glyph = document.createElement("span");
        glyph.className = `atom-variant-glyph ${position}`;
        if (entries[index].not_word) glyph.classList.add("not-word");
        if (entries[index].startup_only) glyph.classList.add("startup-only");
        markGlyphContainer(glyph, index);
        glyph.append(glyphImage(index));
        atomButton.append(glyph);
      }
    } else {
      atomButton.append(glyphImage(atom));
    }
    atomButton.addEventListener("click", () => {
      const next = new Set(currentState.atoms);
      if (next.has(atom)) next.delete(atom); else next.add(atom);
      replaceCurrent({ atoms: [...next], scrollY: window.scrollY });
    });
    return withPersonalCaption(
      atomButton,
      pairedVariant ? [atom, pairedVariant.glyph] : atom,
      "atom",
    );
  }

  const reusableGrid = document.createElement("div");
  reusableGrid.className = "atom-grid";
  for (const atom of reusableAtoms) reusableGrid.append(makeAtomButton(atom));

  const singleHeading = document.createElement("div");
  singleHeading.className = "component-subheading";
  const singleTitle = document.createElement("h3");
  singleTitle.textContent = "仅用于单字";
  const numberOption = document.createElement("label");
  numberOption.className = "toggle-option single-number-toggle";
  const numberCheckbox = document.createElement("input");
  numberCheckbox.type = "checkbox";
  numberCheckbox.checked = currentState.showSingleNumerals;
  numberCheckbox.addEventListener("change", () => {
    const showSingleNumerals = numberCheckbox.checked;
    const atoms = showSingleNumerals
      ? currentState.atoms
      : currentState.atoms.filter((atom) => !hideableAtoms.has(atom));
    replaceCurrent({ showSingleNumerals, atoms, scrollY: window.scrollY });
  });
  const numberText = document.createElement("span");
  numberText.textContent = "数词";
  numberOption.append(numberCheckbox, numberText);
  singleHeading.append(singleTitle, numberOption);

  const singleGrid = document.createElement("div");
  singleGrid.className = "atom-grid single-use-grid";
  for (const atom of singleUseAtoms) {
    if (!currentState.showSingleNumerals && hideableAtoms.has(atom)) continue;
    singleGrid.append(makeAtomButton(atom));
  }
  paletteCard.append(paletteHeading, reusableGrid, singleHeading, singleGrid);

  const resultsCard = document.createElement("section");
  resultsCard.className = "section-card";
  const resultsTitle = document.createElement("h2");
  resultsTitle.textContent = "2. 符合的字";
  const resultsHeading = document.createElement("div");
  resultsHeading.className = "section-heading results-heading";
  const resultKeys = document.createElement("div");
  resultKeys.className = "result-keys";
  resultKeys.append(makeNotWordKey(), makeStartupOnlyKey());
  resultsHeading.append(resultsTitle, resultKeys);
  resultsCard.append(resultsHeading);
  if (selected.size === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.textContent = "先从上面选择一个组成部件";
    resultsCard.append(empty);
  } else {
    const matches = sortByPathLength(entries.flatMap((item, index) => {
      const containsEverySelectedAtom = [...selected].every((atom) => item.atoms.includes(atom));
      const containsNoOtherAtom = !currentState.excludeOtherAtoms
        || item.atoms.every((atom) => selected.has(atom));
      return containsEverySelectedAtom && containsNoOtherAtom ? [index] : [];
    }));
    const note = document.createElement("p");
    note.className = "result-note";
    note.textContent = matches.length
      ? `找到 ${matches.length} 个字，点开可查看完整路径。`
      : currentState.excludeOtherAtoms
        ? "没有找到只使用这些部首的字。"
        : "没有找到同时包含这些部件的字。";
    resultsCard.append(note);
    if (matches.length) resultsCard.append(makeGlyphGrid(matches));
  }

  shell.append(paletteCard, resultsCard);
  app.replaceChildren(shell);
}

function renderMeaningSearch() {
  const shell = document.createElement("section");
  shell.className = "page-shell search-layout";
  const heading = document.createElement("div");
  heading.innerHTML = `
    <p class="eyebrow">个人释义查询</p>
    <h1>按释义找字</h1>
    <p class="summary">查找个人释义中包含指定文字的所有字。</p>`;
  const form = document.createElement("form");
  form.className = "meaning-search-form section-card";
  const input = document.createElement("input");
  input.type = "search";
  input.value = currentState.query;
  input.placeholder = "输入释义中的文字";
  input.setAttribute("aria-label", "释义关键词");
  const submit = button("查找", "utility-button", () => {});
  submit.type = "submit";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    replaceCurrent({ query: input.value, scrollY: 0 });
  });
  form.append(input, submit);

  const results = document.createElement("section");
  results.className = "section-card";
  const query = currentState.query.trim().toLocaleLowerCase();
  const matches = query
    ? sortByPathLength(entries.flatMap((_, index) => {
      return matchingMeaning(index, query) ? [index] : [];
    }))
    : [];
  const title = document.createElement("h2");
  title.textContent = query ? `找到 ${matches.length} 个字` : "查询结果";
  results.append(title);
  if (query && matches.length) results.append(makeGlyphGrid(matches));
  else {
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.textContent = query ? "没有找到包含这段释义的字。" : "输入文字后开始查找。";
    results.append(empty);
  }
  shell.append(heading, form, results);
  app.replaceChildren(shell);
  requestAnimationFrame(() => input.focus());
}

function renderWriter() {
  const shell = document.createElement("section");
  shell.className = "page-shell writer-layout";

  const heading = document.createElement("div");
  heading.innerHTML = `
    <p class="eyebrow">连续书写</p>
    <h1>外星写作</h1>
    <p class="summary">输入个人释义寻找候选字；点击正文或使用方向键移动光标，空格、退格和回车会直接编辑正文。</p>`;

  const editor = document.createElement("section");
  editor.className = "section-card writer-editor";
  const toolbar = document.createElement("div");
  toolbar.className = "writer-toolbar";
  const count = document.createElement("span");
  count.className = "writer-count";
  const toolbarActions = document.createElement("div");
  toolbarActions.className = "writer-toolbar-actions";
  const canvas = document.createElement("div");
  canvas.className = "writer-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "textbox");
  canvas.setAttribute("aria-multiline", "true");
  canvas.setAttribute("aria-label", "外星文正文");

  const ime = document.createElement("section");
  ime.className = "section-card writer-ime";
  const imeHeading = document.createElement("div");
  imeHeading.className = "writer-ime-heading";
  const imeTitle = document.createElement("h2");
  imeTitle.textContent = "按释义输入";
  const imeHint = document.createElement("span");
  imeHint.textContent = "回车选第一个候选";
  imeHeading.append(imeTitle, imeHint);
  const input = document.createElement("input");
  input.type = "search";
  input.className = "writer-ime-input";
  input.placeholder = "输入个人释义";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "输入释义寻找外星字");
  const candidateStatus = document.createElement("p");
  candidateStatus.className = "writer-candidate-status";
  const candidates = document.createElement("div");
  candidates.className = "writer-candidates";

  function insertToken(token) {
    if (writerDraft.length >= 5000) return;
    writerCursor = Math.max(0, Math.min(writerCursor, writerDraft.length));
    writerDraft.splice(writerCursor, 0, token);
    writerCursor += 1;
    persistWriterDraft();
    refreshDraft();
  }

  function removePreviousToken() {
    if (writerCursor <= 0) return;
    writerDraft.splice(writerCursor - 1, 1);
    writerCursor -= 1;
    persistWriterDraft();
    refreshDraft();
  }

  function removeNextToken() {
    if (writerCursor >= writerDraft.length) return;
    writerDraft.splice(writerCursor, 1);
    persistWriterDraft();
    refreshDraft();
  }

  function moveCursor(position) {
    writerCursor = Math.max(0, Math.min(position, writerDraft.length));
    refreshDraft();
  }

  function makeTokenClickable(element, position, alwaysAfter = false) {
    element.classList.add("writer-token");
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const bounds = element.getBoundingClientRect();
      const after = alwaysAfter || event.clientX >= bounds.left + bounds.width / 2;
      moveCursor(position + Number(after));
      input.focus();
    });
    return element;
  }

  function refreshDraft() {
    writerCursor = Math.max(0, Math.min(writerCursor, writerDraft.length));
    canvas.replaceChildren();
    const glyphCount = writerDraft.filter(Number.isInteger).length;
    const spaceCount = writerDraft.filter((item) => item === " ").length;
    count.textContent = `${glyphCount} 个字${spaceCount ? `，${spaceCount} 个空位` : ""}`;
    const caret = document.createElement("span");
    caret.className = "writer-caret";
    caret.setAttribute("aria-hidden", "true");
    if (!writerDraft.length) {
      const placeholder = document.createElement("span");
      placeholder.className = "writer-placeholder";
      placeholder.textContent = "从下面选择字，开始写作";
      canvas.append(placeholder, caret);
    } else {
      for (let position = 0; position <= writerDraft.length; position += 1) {
        if (position === writerCursor) canvas.append(caret);
        if (position === writerDraft.length) break;
        const item = writerDraft[position];
        if (item === " ") {
          const space = document.createElement("span");
          space.className = "writer-space";
          space.setAttribute("aria-label", "空格");
          canvas.append(makeTokenClickable(space, position));
        } else if (item === "\n") {
          const lineBreak = document.createElement("span");
          lineBreak.className = "writer-line-break";
          lineBreak.setAttribute("aria-label", "换行");
          canvas.append(makeTokenClickable(lineBreak, position, true));
        } else {
          const glyph = document.createElement("span");
          glyph.className = "writer-glyph-token";
          glyph.append(glyphImage(item));
          canvas.append(makeTokenClickable(withPersonalCaption(glyph, item, "writer"), position));
        }
      }
    }
    leftCursorButton.disabled = writerCursor === 0;
    rightCursorButton.disabled = writerCursor === writerDraft.length;
  }

  function matchingCandidates() {
    const query = input.value.trim().toLocaleLowerCase();
    if (!query) return [];
    return entries
      .flatMap((_, index) => {
        const meaning = matchingMeaning(index, query);
        return meaning
          ? [{ index, meaning }]
          : [];
      })
      .sort((left, right) => {
        const leftMeaning = left.meaning.toLocaleLowerCase();
        const rightMeaning = right.meaning.toLocaleLowerCase();
        return Number(rightMeaning.startsWith(query)) - Number(leftMeaning.startsWith(query))
          || leftMeaning.length - rightMeaning.length
          || entries[left.index].path_length - entries[right.index].path_length
          || left.index - right.index;
      })
      .slice(0, 30);
  }

  function refreshCandidates() {
    const query = input.value.trim();
    const matches = matchingCandidates();
    candidates.replaceChildren();
    if (!query) {
      candidateStatus.textContent = captionSaveProfiles().some((profile) => [...profile.meanings.values()].some(isDecipheredMeaning))
        ? "输入释义开始找字。输入框为空时按空格可插入空位。"
        : "请先导入存档，或在单字页填写个人释义。";
      return matches;
    }
    candidateStatus.textContent = matches.length
      ? `找到 ${matches.length} 个候选${matches.length === 30 ? "（最多显示 30 个）" : ""}`
      : "没有找到包含这段释义的字。";
    for (const { index, meaning } of matches) {
      const candidate = document.createElement("button");
      candidate.type = "button";
      candidate.className = "writer-candidate";
      if (entries[index].not_word) candidate.classList.add("not-word");
      if (entries[index].startup_only) candidate.classList.add("startup-only");
      markGlyphContainer(candidate, index);
      candidate.setAttribute("aria-label", `输入“${meaning}”`);
      candidate.append(glyphImage(index));
      if (showPersonalMeanings) candidate.append(makePersonalCaption(index, "writer-candidate-caption"));
      candidate.addEventListener("click", () => {
        insertToken(index);
        input.value = "";
        refreshCandidates();
        input.focus();
      });
      candidates.append(candidate);
    }
    return matches;
  }

  function clearDraft() {
    if (!writerDraft.length || !window.confirm("清空当前外星文草稿？")) return;
    writerDraft = [];
    writerCursor = 0;
    persistWriterDraft();
    refreshDraft();
    input.focus();
  }

  const leftCursorButton = button("←", "utility-button writer-cursor-button", () => {
    moveCursor(writerCursor - 1);
    input.focus();
  });
  leftCursorButton.title = "光标左移";
  leftCursorButton.setAttribute("aria-label", "光标左移");
  const rightCursorButton = button("→", "utility-button writer-cursor-button", () => {
    moveCursor(writerCursor + 1);
    input.focus();
  });
  rightCursorButton.title = "光标右移";
  rightCursorButton.setAttribute("aria-label", "光标右移");
  const lineBreakButton = button("换行", "utility-button", () => {
    insertToken("\n");
    input.focus();
  });
  const spaceButton = button("空格", "utility-button", () => {
    insertToken(" ");
    input.focus();
  });
  const backspaceButton = button("退格", "utility-button", () => {
    removePreviousToken();
    input.focus();
  });
  const clearButton = button("清空", "clear-button", clearDraft);
  toolbarActions.append(leftCursorButton, rightCursorButton, lineBreakButton, spaceButton, backspaceButton, clearButton);
  toolbar.append(count, toolbarActions);
  editor.append(toolbar, canvas);

  input.addEventListener("input", refreshCandidates);
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (!input.value && event.key === "ArrowLeft") {
      event.preventDefault();
      moveCursor(writerCursor - 1);
    } else if (!input.value && event.key === "ArrowRight") {
      event.preventDefault();
      moveCursor(writerCursor + 1);
    } else if (!input.value && event.key === "Home") {
      event.preventDefault();
      moveCursor(0);
    } else if (!input.value && event.key === "End") {
      event.preventDefault();
      moveCursor(writerDraft.length);
    } else if (!input.value && event.key === "Delete") {
      event.preventDefault();
      removeNextToken();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const [first] = matchingCandidates();
      if (first) {
        insertToken(first.index);
        input.value = "";
        refreshCandidates();
      } else if (!input.value) {
        insertToken("\n");
      }
    } else if (event.key === " " && !input.value) {
      event.preventDefault();
      insertToken(" ");
    } else if (event.key === "Backspace" && !input.value) {
      event.preventDefault();
      removePreviousToken();
    }
  });
  canvas.addEventListener("click", () => {
    moveCursor(writerDraft.length);
    input.focus();
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveCursor(writerCursor - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveCursor(writerCursor + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveCursor(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveCursor(writerDraft.length);
    } else if (event.key === "Delete") {
      event.preventDefault();
      removeNextToken();
    } else if (event.key === "Backspace") {
      event.preventDefault();
      removePreviousToken();
    } else if (event.key === " ") {
      event.preventDefault();
      insertToken(" ");
    } else if (event.key === "Enter") {
      event.preventDefault();
      insertToken("\n");
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      input.focus();
      input.value += event.key;
      refreshCandidates();
    }
  });

  ime.append(imeHeading, input, candidateStatus, candidates);
  shell.append(heading, editor, ime);
  app.replaceChildren(shell);
  refreshDraft();
  refreshCandidates();
  requestAnimationFrame(() => input.focus());
}

function makeMiniGlyph(index) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "mini-glyph";
  markGlyphContainer(control, index);
  control.setAttribute("aria-label", "查看路径中的这个字");
  control.append(glyphImage(index));
  control.addEventListener("click", () => navigate({ view: "detail", index }));
  return withPersonalCaption(control, index, "mini");
}

function makeDictionaryGlyph(index, isOccurrenceTarget = false) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "dictionary-glyph";
  markGlyphContainer(control, index);
  if (isOccurrenceTarget) control.classList.add("occurrence-target-glyph");
  control.setAttribute(
    "aria-label",
    isOccurrenceTarget ? "当前查询字，查看它的字典页" : "查看释义中这个字的字典页",
  );
  control.append(glyphImage(index));
  control.addEventListener("click", () => navigate({ view: "detail", index }));
  return withPersonalCaption(control, index, "dictionary");
}

function appendDictionaryParts(container, parts, highlightedIndex = null) {
  for (const part of parts) {
    if (Object.prototype.hasOwnProperty.call(part, "glyph")) {
      container.append(makeDictionaryGlyph(part.glyph, part.glyph === highlightedIndex));
    } else {
      const text = document.createElement("span");
      text.className = "dictionary-literal";
      text.textContent = part.text;
      container.append(text);
    }
  }
}

function makeDictionaryPanel(item) {
  const panel = document.createElement("section");
  panel.className = "section-card dictionary-panel";
  const title = document.createElement("h2");
  title.textContent = "字典释义";

  const meta = document.createElement("div");
  meta.className = "dictionary-meta";

  const wordtype = document.createElement("div");
  wordtype.className = "dictionary-field";
  const wordtypeLabel = document.createElement("strong");
  wordtypeLabel.textContent = "词性：";
  const wordtypeValue = document.createElement("span");
  wordtypeValue.className = "dictionary-inline-glyphs";
  appendDictionaryParts(wordtypeValue, item.dictionary.wordtype);
  wordtype.append(wordtypeLabel, wordtypeValue);

  const radicals = document.createElement("div");
  radicals.className = "dictionary-field";
  const radicalsLabel = document.createElement("strong");
  radicalsLabel.textContent = "部首：";
  const radicalsValue = document.createElement("span");
  radicalsValue.className = "dictionary-inline-glyphs";
  if (item.dictionary.radicals.length) {
    item.dictionary.radicals.forEach((index, position) => {
      if (position > 0) {
        const separator = document.createElement("span");
        separator.className = "dictionary-separator";
        separator.textContent = "，";
        radicalsValue.append(separator);
      }
      radicalsValue.append(makeDictionaryGlyph(index));
    });
  } else {
    const empty = document.createElement("span");
    empty.className = "dictionary-empty";
    empty.textContent = "无";
    radicalsValue.append(empty);
  }
  radicals.append(radicalsLabel, radicalsValue);
  meta.append(wordtype, radicals);

  const meaning = document.createElement("div");
  meaning.className = "dictionary-meaning";
  const meaningLabel = document.createElement("strong");
  meaningLabel.textContent = "释义：";
  const meaningValue = document.createElement("div");
  meaningValue.className = "dictionary-meaning-glyphs";
  if (item.dictionary.meaning.length) {
    appendDictionaryParts(meaningValue, item.dictionary.meaning);
  } else {
    const empty = document.createElement("span");
    empty.className = "dictionary-empty";
    empty.textContent = "无额外释义";
    meaningValue.append(empty);
  }
  meaning.append(meaningLabel, meaningValue);
  panel.append(title, meta, meaning);
  return panel;
}

function chipFromParts(kind, parts) {
  const chip = document.createElement("span");
  chip.className = `path-chip ${kind}`;
  for (const part of parts) {
    if (Object.prototype.hasOwnProperty.call(part, "glyph")) {
      chip.append(makeMiniGlyph(part.glyph));
    } else {
      const text = document.createElement("span");
      text.className = "path-text";
      text.textContent = part.text;
      chip.append(text);
    }
  }
  return chip;
}

function makePathFlow(path, dictionaryChain = []) {
  const flow = document.createElement("div");
  flow.className = "path-flow";
  const start = document.createElement("span");
  start.className = "path-chip start";
  start.textContent = path.start === "startup_left" ? "启动时左页" : "右侧首页";
  const nodes = [start];
  for (const action of path.actions) {
    const chip = chipFromParts(action.kind === "lookup_glyph" ? "right" : "left", action.label);
    chip.dataset.actionKind = action.kind;
    if (action.kind === "write_note") {
      chip.title = "在游戏里给前一个字填写有效注释，并确认保存；不是修改本网站的释义。";
    } else if (action.kind === "toggle_word_mark") {
      chip.title = "点击游戏中单字页底部的这个按钮，切换后会出现目标字；若已显示目标字，可直接右键查字。";
    }
    nodes.push(chip);
  }
  for (const glyph of dictionaryChain) nodes.push(chipFromParts("right", [{ glyph }]));
  nodes.forEach((node, index) => {
    if (index > 0) {
      const arrow = document.createElement("span");
      arrow.className = "path-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      flow.append(arrow);
    }
    flow.append(node);
  });
  if (path.actions.some((action) => action.kind === "write_note")) {
    const note = document.createElement("span");
    note.className = "path-instruction-note";
    note.textContent = "“填写注释”指在游戏中给前一个字写入非空、非问号的注释并确认，使内置字典显示相应分类；输入文字不另计点击。";
    flow.append(note);
  }
  return flow;
}

function makeOccurrenceSource(sourceRecord, position, total) {
  const source = document.createElement("div");
  source.className = "occurrence-source";
  if (total > 1) {
    const positionLabel = document.createElement("span");
    positionLabel.className = "occurrence-source-position";
    positionLabel.textContent = `来源 ${position + 1}`;
    source.append(positionLabel);
  }
  const sourceLabel = document.createElement("strong");
  sourceLabel.textContent = "出处：";
  source.append(sourceLabel);
  if (sourceRecord.kind === "dictionary_entry") {
    const sourceType = document.createElement("span");
    sourceType.className = "occurrence-source-type";
    sourceType.textContent = sourceRecord.state === "marked_footer" ? "任意单字页（示例）" : "单字页";
    source.append(sourceType, makeDictionaryGlyph(sourceRecord.entry));
    if (sourceRecord.state === "marked_footer") {
      const state = document.createElement("span");
      state.className = "occurrence-source-state";
      state.textContent = "底部按钮切换后出现";
      source.append(state);
    }
  } else {
    const sourceType = document.createElement("span");
    sourceType.className = "occurrence-source-type";
    sourceType.textContent = sourceRecord.kind === "right_page" ? "右侧页" : "左侧普通字典页";
    source.append(sourceType, makePathFlow(sourceRecord));
  }
  return source;
}

function makeOccurrenceCard(record, sourceIndexes, targetIndex) {
  const card = document.createElement("article");
  card.className = "occurrence-card";
  const sourceRecords = sourceIndexes.map((index) => record.sources[index]);

  const sentenceRow = document.createElement("div");
  sentenceRow.className = "occurrence-sentence-row";
  const sentence = document.createElement("div");
  sentence.className = "occurrence-sentence dictionary-meaning-glyphs";
  appendDictionaryParts(sentence, record.sentence, targetIndex);

  const sources = document.createElement("div");
  sources.className = "occurrence-sources";
  sources.hidden = true;
  let sourcesBuilt = false;
  const collapsedLabel = sourceRecords.length > 1
    ? `显示路径（${sourceRecords.length} 个来源）`
    : "显示路径";
  const toggle = button("＋", "occurrence-toggle", () => {
    if (!sourcesBuilt) {
      const fragment = document.createDocumentFragment();
      sourceRecords.forEach((sourceRecord, position) => {
        fragment.append(makeOccurrenceSource(sourceRecord, position, sourceRecords.length));
      });
      sources.append(fragment);
      sourcesBuilt = true;
    }
    const expanded = sources.hidden;
    sources.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "收起路径" : collapsedLabel);
    toggle.title = expanded ? "收起路径" : collapsedLabel;
    toggle.textContent = expanded ? "−" : "＋";
  });
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", collapsedLabel);
  toggle.title = collapsedLabel;
  sentenceRow.append(sentence, toggle);

  card.append(sentenceRow, sources);
  return card;
}

function makeOccurrencesPanel(item) {
  const references = item.occurrences || [];
  const panel = document.createElement("section");
  panel.className = "section-card occurrences-panel";

  const heading = document.createElement("div");
  heading.className = "section-heading occurrences-heading";
  const title = document.createElement("h2");
  title.textContent = "出处索引";
  const count = document.createElement("span");
  count.className = "selection-count";
  count.textContent = `共 ${references.length} 个不同句子`;
  heading.append(title, count);

  const note = document.createElement("p");
  note.className = "occurrences-note";
  note.textContent = "青底标出当前字；点右侧“＋”查看它出现过的全部页面。完全相同的原句会合并，仅作为部首出现的字不计入出处索引。";
  const list = document.createElement("div");
  list.className = "occurrences-list";
  const more = button("", "utility-button occurrences-more", () => appendBatch());
  const batchSize = 10;
  let shown = 0;

  function appendBatch() {
    const end = Math.min(shown + batchSize, references.length);
    const fragment = document.createDocumentFragment();
    for (; shown < end; shown += 1) {
      const reference = references[shown];
      fragment.append(
        makeOccurrenceCard(
          data.occurrence_sentences[reference.sentence],
          reference.sources,
          currentState.index,
        ),
      );
    }
    list.append(fragment);
    if (shown >= references.length) more.remove();
    else more.textContent = `继续显示（还剩 ${references.length - shown} 条）`;
  }

  panel.append(heading, note, list);
  if (references.length) {
    panel.append(more);
    appendBatch();
  } else {
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.textContent = "暂未找到出处。";
    panel.append(empty);
  }
  return panel;
}

function renderDetail() {
  const item = entries[currentState.index];
  const path = item.path;
  const shell = document.createElement("section");
  shell.className = "page-shell detail-shell";

  const titleRow = document.createElement("div");
  titleRow.className = "detail-title-row";
  titleRow.innerHTML = `
    <div>
      <p class="eyebrow">到达路线</p>
      <h1>这个字怎么找到</h1>
    </div>
    <div class="path-length">路径长度：<strong>${item.path_length}</strong> 次点击</div>`;

  const hero = document.createElement("section");
  hero.className = "detail-hero";
  const target = document.createElement("div");
  target.className = "target-glyph";
  markGlyphContainer(target, currentState.index);
  target.append(glyphImage(currentState.index));
  const targetDisplay = withPersonalCaption(target, currentState.index, "target");
  const heroText = document.createElement("div");
  heroText.className = "detail-dictionary-summary";

  const meta = document.createElement("div");
  meta.className = "dictionary-meta detail-dictionary-meta";
  const wordtype = document.createElement("div");
  wordtype.className = "dictionary-field";
  const wordtypeLabel = document.createElement("strong");
  wordtypeLabel.textContent = "词性：";
  const wordtypeValue = document.createElement("span");
  wordtypeValue.className = "dictionary-inline-glyphs";
  appendDictionaryParts(wordtypeValue, item.dictionary.wordtype);
  wordtype.append(wordtypeLabel, wordtypeValue);

  const radicals = document.createElement("div");
  radicals.className = "dictionary-field";
  const radicalsLabel = document.createElement("strong");
  radicalsLabel.textContent = "部首：";
  const radicalsValue = document.createElement("span");
  radicalsValue.className = "dictionary-inline-glyphs";
  if (item.dictionary.radicals.length) {
    item.dictionary.radicals.forEach((index, position) => {
      if (position > 0) {
        const separator = document.createElement("span");
        separator.className = "dictionary-separator";
        separator.textContent = "，";
        radicalsValue.append(separator);
      }
      radicalsValue.append(makeDictionaryGlyph(index));
    });
  } else {
    const empty = document.createElement("span");
    empty.className = "dictionary-empty";
    empty.textContent = "无";
    radicalsValue.append(empty);
  }
  radicals.append(radicalsLabel, radicalsValue);
  meta.append(wordtype, radicals);

  const meaningValue = document.createElement("div");
  meaningValue.className = "dictionary-meaning-glyphs detail-dictionary-meaning";
  if (item.dictionary.meaning.length) appendDictionaryParts(meaningValue, item.dictionary.meaning);
  else {
    const empty = document.createElement("span");
    empty.className = "dictionary-empty";
    empty.textContent = "无定义正文";
    meaningValue.append(empty);
  }
  heroText.append(meta, meaningValue);
  if (compareSaves) heroText.append(makeEntryColorControl(currentState.index));
  hero.append(targetDisplay, heroText);

  const panel = document.createElement("section");
  panel.className = "path-panel";
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `
    <span>底色表示这一步操作：</span>
    <span class="legend-item left"><i class="legend-dot"></i>左键点击</span>
    <span class="legend-item right"><i class="legend-dot"></i>右键点击</span>`;

  const flow = makePathFlow(path, path.dictionary_chain);

  const done = document.createElement("div");
  done.className = "completion-note";
  done.textContent = "到达目标字的字典页";
  panel.append(legend, flow, done);
  shell.append(titleRow, hero);
  shell.append(panel, makeOccurrencesPanel(item));
  app.replaceChildren(shell);
}

function render() {
  renderTopActions();
  if (currentState.view === "components") renderComponents();
  else if (currentState.view === "meanings") renderMeaningSearch();
  else if (currentState.view === "writer") renderWriter();
  else if (currentState.view === "detail") renderDetail();
  else renderHome();
  if (currentState.view === "detail") refreshEntryColorControl(currentState.index);
  const desiredScroll = currentState.scrollY ?? 0;
  requestAnimationFrame(() => window.scrollTo(0, desiredScroll));
  live.textContent = currentState.view === "detail"
    ? "已打开这个字的路径"
    : currentState.view === "components"
      ? "已打开部件查询"
      : currentState.view === "meanings"
        ? "已打开释义查询"
        : currentState.view === "writer"
          ? "已打开外星写作"
          : "已返回字形一览";
}

document.querySelector("[data-action='home']").addEventListener("click", goHome);
window.addEventListener("popstate", (event) => {
  currentState = normalizedState(event.state);
  render();
});

fetch("data/app-data.json?v=94685d1f69c9")
  .then((response) => {
    if (!response.ok) throw new Error("字典数据无法读取");
    return response.json();
  })
  .then((loaded) => {
    if (
      !loaded
      || !Array.isArray(loaded.entries)
      || loaded.entries.length !== loaded.count
      || !Array.isArray(loaded.save_key_tokens)
      || loaded.save_key_tokens.length !== loaded.count
      || !Array.isArray(loaded.atom_variants)
      || !Array.isArray(loaded.occurrence_sentences)
      || loaded.occurrence_sentences.some((record) => !Array.isArray(record.sources) || record.sources.length === 0)
      || loaded.entries.some((entry) => !Array.isArray(entry.occurrences))
    ) throw new Error("字典数据不完整");
    data = loaded;
    entries = loaded.entries;
    atomVariants = new Map(loaded.atom_variants.map((group) => [group.atom, group.variants]));
    atlasRows = Math.ceil(entries.length / atlasColumns);
    loadPersonalState();
    loadComparisonColors();
    loadWriterDraft();
    const atomUsageCounts = new Map(loaded.atom_indices.map((atom) => [atom, 0]));
    for (const entry of entries) {
      for (const atom of entry.atoms) {
        if (atomUsageCounts.has(atom)) atomUsageCounts.set(atom, atomUsageCounts.get(atom) + 1);
      }
    }
    reusableAtoms = loaded.atom_indices.filter((atom) => atomUsageCounts.get(atom) >= 2);
    singleUseAtoms = loaded.atom_indices.filter((atom) => atomUsageCounts.get(atom) === 1);
    currentState = normalizedState(history.state);
    history.replaceState(currentState, "", location.pathname + location.search);
    render();
  })
  .catch(() => {
    topActions.replaceChildren();
    app.innerHTML = `
      <section class="error-card" role="alert">
        <div>
          <h1>字典暂时没有打开</h1>
          <p>请刷新页面再试一次。</p>
        </div>
      </section>`;
  });
