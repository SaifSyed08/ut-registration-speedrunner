const STORAGE_KEY = "regSpeedRunnerState";
const DELETED_COURSES_KEY = "regSpeedRunnerDeletedCourses";
const TUTORIAL_SEEN_KEY = "regSpeedRunnerTutorialSeen";
const FIRST_RUN_CARD_SEEN_KEY = "regSpeedRunnerFirstRunCardSeen";
const REVIEW_PROMPT_KEY = "regSpeedRunnerReviewPrompt";
const REVIEW_URL = "https://chromewebstore.google.com/detail/ut-registration-speedrunn/ppolilopnfojilddopmkenbaojhpfjbl/reviews?utm_source=item-share-cb";
const FEEDBACK_URL = "https://chromewebstore.google.com/detail/ppolilopnfojilddopmkenbaojhpfjbl/support?utm_source=item-share-cb";
const COURSE_COLORS = ["#dc2626", "#bf5700", "#d97706", "#eab308", "#84cc16", "#16a34a", "#14b8a6", "#0891b2", "#2f80ed", "#1d4ed8", "#6366f1", "#a855f7", "#ec4899", "#64748b"];
const AUTO_MODES = new Set(["off", "paste-submit", "full"]);

const defaultState = {
  enabled: true,
  autoMode: "off",
  overlayCourseColors: false,
  currentCol: 0,
  deletedCourses: [],
  courses: [
    { name: "SDS 313", uniques: ["62740", "62745", "62750"], row: 0, color: "#2f80ed" },
    { name: "M408D", uniques: ["55510", "55515"], row: 0, color: "#d97706" },
    { name: "BIO 315H", uniques: ["49120", "49125"], row: 0, color: "#a855f7" }
  ]
};

let state = structuredClone(defaultState);
let tutorialSeen = true;
let firstRunCardSeen = true;
let draggedCourseIndex = null;
let previousAutoMode = "off";
let reviewPromptState = { openCount: 0, dismissed: false, clicked: false, snoozedUntil: 0 };

const $ = (id) => document.getElementById(id);
const coursesEl = $("courses");
const coursesShell = $("coursesShell");
const enabledToggle = $("enabledToggle");
const autoModeToggle = $("autoModeToggle");
const autoModeSelect = $("autoModeSelect");
const overlayCourseColorsToggle = $("overlayCourseColorsToggle");
const settingsBtn = $("settingsBtn");
const settingsPanel = $("settingsPanel");
const helpBtn = $("helpBtn");
const helpMenu = $("helpMenu");

function normalizeReviewPromptState(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    openCount: Number.isInteger(source.openCount) ? source.openCount : 0,
    dismissed: Boolean(source.dismissed),
    clicked: Boolean(source.clicked),
    snoozedUntil: Number.isFinite(source.snoozedUntil) ? source.snoozedUntil : 0
  };
}

function shouldShowReviewPrompt() {
  return reviewPromptState.openCount >= 5
    && !reviewPromptState.dismissed
    && !reviewPromptState.clicked
    && Date.now() >= reviewPromptState.snoozedUntil
    && tutorialSeen
    && firstRunCardSeen;
}

async function saveReviewPromptState(patch) {
  reviewPromptState = normalizeReviewPromptState({ ...reviewPromptState, ...patch });
  await chrome.storage.local.set({ [REVIEW_PROMPT_KEY]: reviewPromptState });
  render();
}

function setHelpMenuOpen(open) {
  helpMenu.hidden = !open;
  helpBtn.setAttribute("aria-expanded", String(open));
}
function normalizeColor(value, fallback = "#bf5700") {
  const color = String(value || "").toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
}

function normalizeAutoMode(value, legacyAutoSubmit = false) {
  const mode = String(value || "");
  if (AUTO_MODES.has(mode)) return mode;
  return legacyAutoSubmit ? "paste-submit" : "off";
}

function parseUniqueList(value) {
  return String(value || "")
    .split(/[\n,\t\s]+/)
    .map((u) => u.trim())
    .filter(Boolean);
}

function formatUniqueList(value) {
  return parseUniqueList(value).join(", ");
}

function courseNameWidth(name) {
  return Math.max(8, Math.min(String(name || "").length + 3, 26));
}

function courseScheduleTermCode(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const suffix = month <= 5 ? "2" : month <= 7 ? "6" : "9";
  return `${year}${suffix}`;
}

function updateFindClassesLink() {
  const termCode = courseScheduleTermCode();
  $("findClassesLink").href = `https://utdirect.utexas.edu/apps/registrar/course_schedule/${termCode}/`;
}

function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  settingsBtn.setAttribute("aria-expanded", String(open));
}

function normalizeState(input) {
  const next = input && typeof input === "object" ? input : structuredClone(defaultState);
  next.enabled = Boolean(next.enabled);
  next.autoMode = normalizeAutoMode(next.autoMode, next.autoSubmit);
  next.overlayCourseColors = Boolean(next.overlayCourseColors);
  next.currentCol = Number.isInteger(next.currentCol) ? next.currentCol : 0;
  next.courses = Array.isArray(next.courses) ? next.courses : [];
  next.deletedCourses = Array.isArray(next.deletedCourses) ? next.deletedCourses : [];
  next.courses = next.courses.map((course, index) => {
    const uniques = Array.isArray(course.uniques)
      ? course.uniques.map(String).map((u) => u.trim()).filter(Boolean)
      : parseUniqueList(course.uniques);
    const row = Number.isInteger(course.row) ? course.row : 0;
    return {
      name: String(course.name || "Untitled class").trim() || "Untitled class",
      uniques,
      row: Math.max(0, Math.min(row, uniques.length)),
      color: normalizeColor(course.color, COURSE_COLORS[index % COURSE_COLORS.length])
    };
  });
  next.deletedCourses = next.deletedCourses.map((course, index) => {
    const uniques = Array.isArray(course.uniques)
      ? course.uniques.map(String).map((u) => u.trim()).filter(Boolean)
      : parseUniqueList(course.uniques);
    const row = Number.isInteger(course.row) ? course.row : 0;
    return {
      name: String(course.name || "Untitled class").trim() || "Untitled class",
      uniques,
      row: Math.max(0, Math.min(row, uniques.length)),
      color: normalizeColor(course.color, COURSE_COLORS[index % COURSE_COLORS.length])
    };
  });
  if (next.courses.length === 0) next.currentCol = 0;
  else next.currentCol = Math.max(0, Math.min(next.currentCol, next.courses.length - 1));
  return next;
}

async function loadState() {
  const result = await chrome.storage.local.get([STORAGE_KEY, DELETED_COURSES_KEY, TUTORIAL_SEEN_KEY, FIRST_RUN_CARD_SEEN_KEY, REVIEW_PROMPT_KEY]);
  const storedState = result[STORAGE_KEY];
  state = normalizeState(storedState || structuredClone(defaultState));
  const separatelyStoredDeletedCourses = Array.isArray(result[DELETED_COURSES_KEY])
    ? result[DELETED_COURSES_KEY]
    : [];
  if (separatelyStoredDeletedCourses.length) {
    state.deletedCourses = normalizeState({ ...state, deletedCourses: separatelyStoredDeletedCourses }).deletedCourses;
  } else if (state.deletedCourses.length) {
    await chrome.storage.local.set({ [DELETED_COURSES_KEY]: state.deletedCourses });
  }
  tutorialSeen = result[TUTORIAL_SEEN_KEY] !== false;
  firstRunCardSeen = result[FIRST_RUN_CARD_SEEN_KEY] !== false;
  reviewPromptState = normalizeReviewPromptState(result[REVIEW_PROMPT_KEY]);
  reviewPromptState.openCount += 1;
  await chrome.storage.local.set({
    [STORAGE_KEY]: state,
    [REVIEW_PROMPT_KEY]: reviewPromptState
  });
  render();
}

async function saveState(showSaved = false) {
  state = collectFromDom();
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  if (showSaved) {
    render();
  }
}

function collectFromDom() {
  const cards = [...document.querySelectorAll(".course-card")];
  const courses = cards.map((card) => {
    const idx = Number(card.dataset.index);
    const previous = state.courses[idx] || { row: 0 };
    const name = card.querySelector(".course-name").value.trim() || "Untitled class";
    const selectedColor = card.dataset.color || card.querySelector(".color-swatch.active")?.dataset.color;
    const color = normalizeColor(selectedColor, previous.color);
    const uniques = parseUniqueList(card.querySelector(".unique-list").value);
    return {
      name,
      uniques,
      row: Math.max(0, Math.min(previous.row || 0, uniques.length)),
      color
    };
  });
  return normalizeState({
    enabled: enabledToggle.checked,
    autoMode: autoModeSelect.value,
    overlayCourseColors: overlayCourseColorsToggle.checked,
    currentCol: state.currentCol,
    deletedCourses: state.deletedCourses,
    courses
  });
}


function moveCourse(fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= state.courses.length || toIndex >= state.courses.length) return;

  const [course] = state.courses.splice(fromIndex, 1);
  state.courses.splice(toIndex, 0, course);

  if (state.currentCol === fromIndex) state.currentCol = toIndex;
  else if (fromIndex < state.currentCol && toIndex >= state.currentCol) state.currentCol -= 1;
  else if (fromIndex > state.currentCol && toIndex <= state.currentCol) state.currentCol += 1;
}

async function persistReorder(fromIndex, toIndex) {
  state = collectFromDom();
  moveCourse(fromIndex, toIndex);
  state = normalizeState(state);
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  render();
}
function renderStatus() {
  enabledToggle.checked = state.enabled;
  autoModeSelect.value = state.autoMode;
  autoModeToggle.checked = state.autoMode === "paste-submit";
  overlayCourseColorsToggle.checked = state.overlayCourseColors;
  previousAutoMode = state.autoMode;
  coursesShell.classList.toggle("inactive", !state.enabled);
  coursesShell.querySelector(".inactive-overlay").hidden = state.enabled;
}

function renderCourses() {
  coursesEl.innerHTML = "";
  if (state.courses.length === 0) {
    coursesEl.innerHTML = `<div class="empty">Add a class column, then paste comma-separated unique numbers.</div>`;
    return;
  }
  state.courses.forEach((course, index) => {
    const card = document.createElement("article");
    card.className = `course-card ${index === state.currentCol ? "active" : ""}`;
    card.dataset.index = String(index);
    card.dataset.color = course.color;
    card.style.setProperty("--course-color", course.color);
    card.innerHTML = `
      <div class="course-main">
        <div class="course-grip" draggable="true" title="Drag this card to reorder classes" aria-label="Drag to reorder"><span></span><span></span><span></span><span></span></div>
        <div class="course-fields">
          <div class="course-top">
            <input class="course-name" value="${escapeHtml(course.name)}" aria-label="Course name" style="width: ${courseNameWidth(course.name)}ch" />
            <button class="color-menu-btn" type="button" data-action="toggle-palette" style="--swatch-color: ${course.color}" aria-label="Choose class color" title="Choose class color"></button>
            <div class="course-palette" aria-label="Class color" hidden>
              ${COURSE_COLORS.map((color) => `<button class="color-swatch ${color === course.color ? "active" : ""}" type="button" data-color="${color}" data-action="set-color" style="--swatch-color: ${color}" aria-label="Use color ${color}"></button>`).join("")}
            </div>
            <button class="badge" data-action="set-current" title="Make this the current class">${index === state.currentCol ? "Active" : "Use"}</button>
            <button class="icon-btn" data-action="delete" title="Delete class">&times;</button>
          </div>
          <textarea class="unique-list" aria-label="Unique numbers" title="Comma-separated Unique Numbers, highest priority first" spellcheck="false">${escapeHtml(course.uniques.join(", "))}</textarea>
          <div class="card-note">
            <span>${course.uniques.length} unique${course.uniques.length === 1 ? "" : "s"}</span>
            <span>${course.uniques.slice(course.row + 1).length} backups left</span>
          </div>
        </div>
      </div>
    `;
    coursesEl.appendChild(card);
  });
}

function render() {
  renderStatus();
  renderCourses();
  $("tutorialCard").hidden = tutorialSeen;
  $("reloadAlert").hidden = firstRunCardSeen;
  $("sampleScheduleCallout").hidden = firstRunCardSeen;
  $("reviewPrompt").hidden = !shouldShowReviewPrompt();
}


async function setFirstRunCardSeen(seen) {
  firstRunCardSeen = seen;
  await chrome.storage.local.set({ [FIRST_RUN_CARD_SEEN_KEY]: seen });
  render();
}

async function setTutorialSeen(seen) {
  tutorialSeen = seen;
  await chrome.storage.local.set({ [TUTORIAL_SEEN_KEY]: seen });
  render();
}
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function updateSupportedPageNotice() {
  const notice = $("supportedPageNotice");
  if (!globalThis.chrome?.tabs?.query || !globalThis.chrome?.tabs?.sendMessage) {
    notice.hidden = false;
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      notice.hidden = false;
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "regSpeedRunnerPing" });
    notice.hidden = response?.ok === true;
  } catch (_) {
    notice.hidden = false;
  }
}
coursesEl.addEventListener("dragstart", (event) => {
  const grip = event.target.closest(".course-grip");
  if (!grip) return;
  const card = grip.closest(".course-card");
  draggedCourseIndex = Number(card?.dataset.index);
  if (!Number.isInteger(draggedCourseIndex)) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(draggedCourseIndex));
  card.classList.add("dragging");
});

coursesEl.addEventListener("dragover", (event) => {
  const card = event.target.closest(".course-card");
  if (!card || draggedCourseIndex === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  card.classList.add("drag-over");
});

coursesEl.addEventListener("dragleave", (event) => {
  const card = event.target.closest(".course-card");
  if (card && !card.contains(event.relatedTarget)) card.classList.remove("drag-over");
});

coursesEl.addEventListener("drop", async (event) => {
  const card = event.target.closest(".course-card");
  if (!card || draggedCourseIndex === null) return;
  event.preventDefault();
  const targetIndex = Number(card.dataset.index);
  document.querySelectorAll(".course-card.drag-over").forEach((item) => item.classList.remove("drag-over"));
  await persistReorder(draggedCourseIndex, targetIndex);
  draggedCourseIndex = null;
});

coursesEl.addEventListener("dragend", () => {
  draggedCourseIndex = null;
  document.querySelectorAll(".course-card.dragging, .course-card.drag-over").forEach((item) => {
    item.classList.remove("dragging", "drag-over");
  });
});
coursesEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const card = event.target.closest(".course-card");
  const index = Number(card?.dataset.index);
  if (!Number.isInteger(index)) return;

  state = collectFromDom();
  const action = button.dataset.action;
  if (action === "toggle-palette") {
    const palette = card.querySelector(".course-palette");
    const willOpen = palette.hidden;
    document.querySelectorAll(".course-palette").forEach((item) => { item.hidden = true; });
    palette.hidden = !willOpen;
    return;
  }
  if (action === "set-color") {
    const color = normalizeColor(button.dataset.color);
    card.dataset.color = color;
    card.style.setProperty("--course-color", color);
    card.querySelector(".color-menu-btn")?.style.setProperty("--swatch-color", color);
    card.querySelectorAll(".color-swatch").forEach((swatch) => swatch.classList.toggle("active", swatch === button));
    card.querySelector(".course-palette").hidden = true;
    await saveState(false);
    return;
  }
  if (action === "set-current") {
    state.currentCol = index;
  }
  if (action === "delete") {
    const [deletedCourse] = state.courses.splice(index, 1);
    if (deletedCourse) state.deletedCourses.push(deletedCourse);
    state.currentCol = Math.min(state.currentCol, Math.max(state.courses.length - 1, 0));
  }
  state = normalizeState(state);
  await chrome.storage.local.set({
    [STORAGE_KEY]: state,
    [DELETED_COURSES_KEY]: state.deletedCourses
  });
  render();
});

$("addCourseBtn").addEventListener("click", async () => {
  state = collectFromDom();
  state.courses.push({ name: "New class", uniques: [""], row: 0, color: "#bf5700" });
  state.currentCol = state.courses.length - 1;
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  render();
});

enabledToggle.addEventListener("change", async () => {
  await saveState(false);
  renderStatus();
});
settingsBtn.addEventListener("click", () => setSettingsOpen(settingsPanel.hidden));
autoModeToggle.addEventListener("change", async () => {
  autoModeSelect.value = autoModeToggle.checked ? "paste-submit" : "off";
  await saveState(false);
  previousAutoMode = autoModeSelect.value;
});
autoModeSelect.addEventListener("change", async () => {
  if (autoModeSelect.value === "full") {
    const confirmed = confirm("Do everything may click submit automatically and continue through classes. Test it first on the practice page.");
    if (!confirmed) autoModeSelect.value = previousAutoMode;
  }
  await saveState(false);
  previousAutoMode = autoModeSelect.value;
});
overlayCourseColorsToggle.addEventListener("change", () => saveState(false));
$("dismissTutorialBtn").addEventListener("click", () => setTutorialSeen(true));
$("dismissSampleCalloutBtn").addEventListener("click", () => setFirstRunCardSeen(true));
helpBtn.addEventListener("click", () => setHelpMenuOpen(helpMenu.hidden));
$("tutorialMenuBtn").addEventListener("click", () => {
  setHelpMenuOpen(false);
  setTutorialSeen(false);
});
$("reviewLink").href = REVIEW_URL;
$("helpMenu").querySelector("a").href = FEEDBACK_URL;
$("reviewLink").addEventListener("click", () => {
  reviewPromptState = normalizeReviewPromptState({ ...reviewPromptState, clicked: true, dismissed: true });
  chrome.storage.local.set({ [REVIEW_PROMPT_KEY]: reviewPromptState });
});
$("reviewLaterBtn").addEventListener("click", () => saveReviewPromptState({ snoozedUntil: Date.now() + 7 * 24 * 60 * 60 * 1000 }));
$("dismissReviewBtn").addEventListener("click", () => saveReviewPromptState({ dismissed: true }));


document.addEventListener("click", (event) => {
  if (!event.target.closest(".help-menu-wrap")) setHelpMenuOpen(false);
  if (!event.target.closest(".settings-wrap")) setSettingsOpen(false);
  if (event.target.closest(".course-palette, .color-menu-btn")) return;
  document.querySelectorAll(".course-palette").forEach((palette) => { palette.hidden = true; });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setHelpMenuOpen(false);
    setSettingsOpen(false);
  }
});

document.addEventListener("paste", (event) => {
  const target = event.target.closest?.(".unique-list");
  if (!target) return;
  const pasted = event.clipboardData?.getData("text");
  if (!pasted) return;

  event.preventDefault();
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  target.value = formatUniqueList(`${target.value.slice(0, start)} ${pasted} ${target.value.slice(end)}`);
  target.dispatchEvent(new Event("input", { bubbles: true }));
});

// Autosave after edits so the HUD updates without making you remember.
let autosaveTimer;
document.addEventListener("input", (event) => {
  if (event.target.classList?.contains("course-name")) {
    event.target.style.width = `${courseNameWidth(event.target.value)}ch`;
  }
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveState(false), 400);
});

updateSupportedPageNotice();
updateFindClassesLink();
loadState();
