"use strict";

const app = document.querySelector("#app");
const topActions = document.querySelector("#top-actions");
const live = document.querySelector("#live");

let data = null;
let entries = [];
let currentState = null;
let reusableAtoms = [];
let singleUseAtoms = [];
let personalMeanings = new Map();
let personalImportSummary = null;
let showPersonalMeanings = false;
let highlightUndeciphered = false;
let saveImportStatus = null;

const validFilters = new Set(["all", "direct", "dictionary"]);
const atlasColumns = 16;
const personalStorageKey = "alien-demo-dictionary:personal-meanings:v1";
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

function loadPersonalState() {
  try {
    const stored = JSON.parse(localStorage.getItem(personalStorageKey) || "null");
    if (!stored || stored.schema !== 1 || typeof stored.meanings !== "object" || Array.isArray(stored.meanings)) return;
    const validTokens = new Set(data.save_key_tokens);
    personalMeanings = new Map(
      Object.entries(stored.meanings).filter(([token, value]) => (
        validTokens.has(token) && typeof value === "string" && value.length > 0
      )),
    );
    personalImportSummary = stored.importSummary && typeof stored.importSummary === "object"
      ? stored.importSummary
      : null;
    showPersonalMeanings = stored.showPersonalMeanings === true;
    highlightUndeciphered = stored.highlightUndeciphered === true;
  } catch {
    personalMeanings = new Map();
    personalImportSummary = null;
    showPersonalMeanings = false;
    highlightUndeciphered = false;
  }
}

function persistPersonalState() {
  try {
    localStorage.setItem(personalStorageKey, JSON.stringify({
      schema: 1,
      meanings: Object.fromEntries(personalMeanings),
      importSummary: personalImportSummary,
      showPersonalMeanings,
      highlightUndeciphered,
    }));
    return true;
  } catch {
    return false;
  }
}

function personalMeaningForIndex(index) {
  return personalMeanings.get(data.save_key_tokens[index]) || "";
}

function isDecipheredMeaning(value) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 && normalized !== "?" && normalized !== "？";
}

function isDecipheredIndex(index) {
  return isDecipheredMeaning(personalMeaningForIndex(index));
}

function decipheredCount() {
  return entries.reduce((count, _, index) => count + Number(isDecipheredIndex(index)), 0);
}

function markGlyphContainer(element, index) {
  if (highlightUndeciphered && !isDecipheredIndex(index)) element.classList.add("undeciphered-highlight");
  return element;
}

function withPersonalCaption(container, index, variant) {
  if (!showPersonalMeanings) return container;
  const stack = document.createElement("span");
  stack.className = `glyph-meaning-stack ${variant}-meaning-stack`;
  if (variant === "target") {
    const editor = document.createElement("input");
    editor.type = "text";
    editor.className = "inline-personal-meaning target-personal-meaning-input";
    editor.maxLength = 300;
    editor.value = personalMeaningForIndex(index);
    editor.placeholder = "?";
    editor.title = "保存在此浏览器，不会写回游戏存档";
    editor.setAttribute("aria-label", "编辑这个字的个人释义");
    editor.addEventListener("input", () => {
      const token = data.save_key_tokens[index];
      if (editor.value.length > 0) personalMeanings.set(token, editor.value);
      else personalMeanings.delete(token);
      const persisted = persistPersonalState();
      editor.title = persisted
        ? "已保存到此浏览器，不会写回游戏存档"
        : "浏览器未允许保存这次修改";
      container.classList.toggle(
        "undeciphered-highlight",
        highlightUndeciphered && !isDecipheredMeaning(editor.value),
      );
    });
    stack.append(container, editor);
    return stack;
  }
  const label = document.createElement("span");
  label.className = "inline-personal-meaning";
  if (isDecipheredIndex(index)) label.textContent = personalMeaningForIndex(index);
  else {
    label.classList.add("missing");
    label.textContent = "?";
  }
  stack.append(container, label);
  return stack;
}

function personalProgressText() {
  const recognized = decipheredCount();
  const percentage = data.count > 0 ? (recognized * 100 / data.count).toFixed(1) : "0.0";
  return `破译进度：${recognized} / ${data.count}（${percentage}%）`;
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

async function importSaveFile(file) {
  saveImportStatus = { kind: "loading", text: "正在读取存档…" };
  render();
  try {
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

    personalMeanings = imported;
    showPersonalMeanings = true;
    const recognized = [...imported.values()].filter(isDecipheredMeaning).length;
    personalImportSummary = {
      fileName: file.name,
      version: ["string", "number"].includes(typeof payload.version) ? String(payload.version) : "未知",
      recognized,
      missing: data.count - recognized,
      ignored,
      importedAt: Date.now(),
    };
    const persisted = persistPersonalState();
    saveImportStatus = {
      kind: persisted ? "success" : "warning",
      text: persisted
        ? `已导入 ${imported.size} 条个人释义；${data.count - imported.size} 个字未标注。`
        : `已导入 ${imported.size} 条个人释义，但浏览器未允许持久保存。`,
    };
    saveImportStatus.text = persisted
      ? `已导入 ${recognized} 条有效个人释义；${data.count - recognized} 个字未破译。`
      : `已导入 ${recognized} 条有效个人释义，但浏览器未能将它们持久保存。`;
  } catch (error) {
    console.error(error);
    saveImportStatus = { kind: "error", text: "无法读取这个存档：文件格式或版本不受支持。" };
  }
  render();
}

function chooseSaveFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".sav,.backup";
  input.addEventListener("change", () => {
    const [file] = input.files || [];
    if (file) importSaveFile(file);
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
    undecipheredOnly: state.undecipheredOnly === true && personalImportSummary !== null,
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

function renderTopActions() {
  topActions.replaceChildren();
  if (!currentState) return;
  const componentSearch = button("按部件找字", "nav-button", goComponents);
  componentSearch.setAttribute("aria-pressed", String(currentState.view === "components"));
  const meaningSearch = button("按释义找字", "nav-button", goMeaningSearch);
  meaningSearch.setAttribute("aria-pressed", String(currentState.view === "meanings"));
  const importButton = button("导入存档", "nav-button", chooseSaveFile);
  importButton.title = "存档路径参考：C:\\Users\\<你的用户名>\\AppData\\LocalLow\\Artless Games\\MessageFromAliens\\alienmessage1.sav（槽位 2/3 对应 alienmessage2.sav、alienmessage3.sav）";
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
  topActions.append(componentSearch, meaningSearch, importButton, visibility, highlight);
  if (currentState.view !== "home") {
    const back = button("← 上一页", "nav-button", goBack);
    back.disabled = currentState.depth === 0;
    topActions.append(back, button("返回首页", "nav-button", goHome));
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
    const label = document.createElement("span");
    label.className = "personal-meaning-label";
    const meaning = personalMeaningForIndex(index);
    if (isDecipheredMeaning(meaning)) {
      label.textContent = meaning;
    } else {
      label.classList.add("missing");
      label.textContent = "?";
      label.title = "存档中未标注这个字";
    }
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
  const status = saveImportStatus || (personalImportSummary ? {
    kind: "success",
    text: `已载入 ${personalImportSummary.fileName}：${personalImportSummary.recognized} 条个人释义，${personalImportSummary.missing} 个字未标注，存档版本 ${personalImportSummary.version}。`,
  } : null);
  if (status) {
    const statusLine = document.createElement("p");
    statusLine.className = `save-import-status ${status.kind}`;
    statusLine.textContent = status.text;
    shell.append(statusLine);
  }
  if (personalImportSummary) {
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
    const atomButton = document.createElement("button");
    atomButton.type = "button";
    atomButton.className = "atom-button";
    if (entries[atom].not_word) atomButton.classList.add("not-word");
    if (entries[atom].startup_only) atomButton.classList.add("startup-only");
    markGlyphContainer(atomButton, atom);
    atomButton.setAttribute(
      "aria-label",
      entries[atom].startup_only
        ? (selected.has(atom) ? "取消这个仅从启动时左页可达的部件" : "选择这个仅从启动时左页可达的部件")
        : entries[atom].not_word
        ? (selected.has(atom) ? "取消这个非正式字部件" : "选择这个非正式字部件")
        : (selected.has(atom) ? "取消这个部件" : "选择这个部件"),
    );
    atomButton.setAttribute("aria-pressed", String(selected.has(atom)));
    atomButton.append(glyphImage(atom));
    atomButton.addEventListener("click", () => {
      const next = new Set(currentState.atoms);
      if (next.has(atom)) next.delete(atom); else next.add(atom);
      replaceCurrent({ atoms: [...next], scrollY: window.scrollY });
    });
    return withPersonalCaption(atomButton, atom, "atom");
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
      const meaning = personalMeaningForIndex(index);
      return isDecipheredMeaning(meaning) && meaning.toLocaleLowerCase().includes(query) ? [index] : [];
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
  for (const action of path.actions) nodes.push(chipFromParts("left", action.label));
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
    sourceType.textContent = "单字页";
    source.append(sourceType, makeDictionaryGlyph(sourceRecord.entry));
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
  else if (currentState.view === "detail") renderDetail();
  else renderHome();
  const desiredScroll = currentState.scrollY ?? 0;
  requestAnimationFrame(() => window.scrollTo(0, desiredScroll));
  live.textContent = currentState.view === "detail" ? "已打开这个字的路径" : currentState.view === "components" ? "已打开部件查询" : "已返回字形一览";
}

document.querySelector("[data-action='home']").addEventListener("click", goHome);
window.addEventListener("popstate", (event) => {
  currentState = normalizedState(event.state);
  render();
});

fetch("data/app-data.json?v=c552ee337e79")
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
      || !Array.isArray(loaded.occurrence_sentences)
      || loaded.occurrence_sentences.some((record) => !Array.isArray(record.sources) || record.sources.length === 0)
      || loaded.entries.some((entry) => !Array.isArray(entry.occurrences))
    ) throw new Error("字典数据不完整");
    data = loaded;
    entries = loaded.entries;
    atlasRows = Math.ceil(entries.length / atlasColumns);
    loadPersonalState();
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
