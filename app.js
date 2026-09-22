"use strict";

const app = document.querySelector("#app");
const topActions = document.querySelector("#top-actions");
const live = document.querySelector("#live");

let data = null;
let entries = [];
let currentState = null;
let reusableAtoms = [];
let singleUseAtoms = [];

const validFilters = new Set(["all", "direct", "dictionary"]);
const atlasColumns = 16;
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

function defaultState() {
  return {
    view: "home",
    filter: "all",
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

function renderTopActions() {
  topActions.replaceChildren();
  if (!currentState || currentState.view === "home") return;
  const back = button("← 上一页", "nav-button", goBack);
  back.disabled = currentState.depth === 0;
  topActions.append(back, button("返回首页", "nav-button", goHome));
}

function makeGlyphCard(index) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "glyph-card";
  if (entries[index].not_word) card.classList.add("not-word");
  if (entries[index].startup_only) card.classList.add("startup-only");
  card.setAttribute(
    "aria-label",
    entries[index].startup_only
      ? "查看这个仅从启动时左页可达的字的到达路径"
      : (entries[index].not_word ? "查看这个非正式字的到达路径" : "查看这个字的到达路径"),
  );
  card.append(glyphImage(index));
  card.addEventListener("click", () => navigate({ view: "detail", index }));
  return card;
}

function makeNotWordKey() {
  const key = document.createElement("span");
  key.className = "not-word-key";
  key.textContent = "黄底：非正式字";
  return key;
}

function makeStartupOnlyKey() {
  const key = document.createElement("span");
  key.className = "startup-only-key";
  key.textContent = "绿底：仅启动左页可达";
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
  toolbar.append(componentButton, makeNotWordKey(), makeStartupOnlyKey(), filters);
  heading.append(toolbar);
  shell.append(heading, makeGlyphGrid(filterIndexes(currentState.filter)));
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
    return atomButton;
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

function makeMiniGlyph(index) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "mini-glyph";
  control.setAttribute("aria-label", "查看路径中的这个字");
  control.append(glyphImage(index));
  control.addEventListener("click", () => navigate({ view: "detail", index }));
  return control;
}

function makeDictionaryGlyph(index) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "dictionary-glyph";
  control.setAttribute("aria-label", "查看释义中这个字的字典页");
  control.append(glyphImage(index));
  control.addEventListener("click", () => navigate({ view: "detail", index }));
  return control;
}

function appendDictionaryParts(container, parts) {
  for (const part of parts) {
    if (Object.prototype.hasOwnProperty.call(part, "glyph")) {
      container.append(makeDictionaryGlyph(part.glyph));
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
  target.append(glyphImage(currentState.index));
  const heroText = document.createElement("div");
  heroText.innerHTML = `
    <h2>目标字</h2>
    <p class="detail-subtitle">下面的路线从可重复使用的入口开始。路线里的字也可以点开，查看它自己的路线。</p>`;
  hero.append(target, heroText);

  const panel = document.createElement("section");
  panel.className = "path-panel";
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `
    <span>底色表示这一步操作：</span>
    <span class="legend-item left"><i class="legend-dot"></i>左键点击</span>
    <span class="legend-item right"><i class="legend-dot"></i>右键点击</span>`;

  const flow = document.createElement("div");
  flow.className = "path-flow";
  const start = document.createElement("span");
  start.className = "path-chip start";
  start.textContent = path.start === "startup_left" ? "启动时左页" : "右侧首页";
  const nodes = [start];
  for (const action of path.actions) nodes.push(chipFromParts("left", action.label));
  for (const glyph of path.dictionary_chain) nodes.push(chipFromParts("right", [{ glyph }]));
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

  const done = document.createElement("div");
  done.className = "completion-note";
  done.textContent = "到达目标字的字典页";
  panel.append(legend, flow, done);
  shell.append(titleRow, hero, makeDictionaryPanel(item), panel);
  app.replaceChildren(shell);
}

function render() {
  renderTopActions();
  if (currentState.view === "components") renderComponents();
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

fetch("data/app-data.json")
  .then((response) => {
    if (!response.ok) throw new Error("字典数据无法读取");
    return response.json();
  })
  .then((loaded) => {
    if (!loaded || !Array.isArray(loaded.entries) || loaded.entries.length !== loaded.count) throw new Error("字典数据不完整");
    data = loaded;
    entries = loaded.entries;
    atlasRows = Math.ceil(entries.length / atlasColumns);
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
