const STORAGE_KEY = "regSpeedRunnerState";
const DELETED_COURSES_KEY = "regSpeedRunnerDeletedCourses";
const OVERLAY_GEOMETRY_KEY = "regSpeedRunnerOverlayGeometry";
const HUD_ID = "reg-speedrunner-hud";
const DEFAULT_COURSE_COLORS = ["#2f80ed", "#d97706", "#a855f7", "#16a34a", "#dc2626", "#0891b2", "#4f46e5", "#ec4899", "#eab308", "#84cc16", "#64748b", "#bf5700"];

let state = null;
let messageTimer = null;
let pasteInProgress = false;
let overlayGeometryLoaded = false;
let resizeSaveTimer = null;
const storage = (() => {
  const chromeStorage = globalThis.chrome?.storage?.local;
  if (chromeStorage) {
    return {
      get(keys, callback) {
        chromeStorage.get(keys, callback);
      },
      set(values) {
        chromeStorage.set(values);
      },
      onChanged(callback) {
        globalThis.chrome.storage.onChanged.addListener(callback);
      }
    };
  }

  return {
    get(keys, callback) {
      const result = {};
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach((key) => {
        try {
          const value = localStorage.getItem(key);
          if (value !== null) result[key] = JSON.parse(value);
        } catch (_) {
          result[key] = undefined;
        }
      });
      callback(result);
    },
    set(values) {
      Object.entries(values).forEach(([key, value]) => {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (_) {}
      });
    },
    onChanged() {}
  };
})();

function normalizeColor(value, fallback = "#bf5700") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
}

function normalizeState(input) {
  const next = input && typeof input === "object" ? input : { enabled: true, currentCol: 0, courses: [] };
  next.enabled = Boolean(next.enabled);
  next.currentCol = Number.isInteger(next.currentCol) ? next.currentCol : 0;
  next.courses = Array.isArray(next.courses) ? next.courses : [];
  next.deletedCourses = Array.isArray(next.deletedCourses) ? next.deletedCourses : [];
  next.courses = next.courses.map((course, index) => {
    const uniques = Array.isArray(course.uniques)
      ? course.uniques.map(String).map((u) => u.trim()).filter(Boolean)
      : [];
    const row = Number.isInteger(course.row) ? course.row : 0;
    return {
      name: String(course.name || "Untitled class").trim() || "Untitled class",
      uniques,
      row: Math.max(0, Math.min(row, uniques.length)),
      color: normalizeColor(course.color, DEFAULT_COURSE_COLORS[index % DEFAULT_COURSE_COLORS.length])
    };
  });
  next.deletedCourses = next.deletedCourses.map((course, index) => {
    const uniques = Array.isArray(course.uniques)
      ? course.uniques.map(String).map((u) => u.trim()).filter(Boolean)
      : [];
    const row = Number.isInteger(course.row) ? course.row : 0;
    return {
      name: String(course.name || "Untitled class").trim() || "Untitled class",
      uniques,
      row: Math.max(0, Math.min(row, uniques.length)),
      color: normalizeColor(course.color, DEFAULT_COURSE_COLORS[index % DEFAULT_COURSE_COLORS.length])
    };
  });
  if (next.courses.length === 0) next.currentCol = 0;
  else next.currentCol = Math.max(0, Math.min(next.currentCol, next.courses.length - 1));
  return next;
}

function loadState() {
  storage.get([STORAGE_KEY, DELETED_COURSES_KEY, OVERLAY_GEOMETRY_KEY], (result) => {
    state = normalizeState(result[STORAGE_KEY]);
    if (Array.isArray(result[DELETED_COURSES_KEY])) {
      state.deletedCourses = normalizeState({
        ...state,
        deletedCourses: result[DELETED_COURSES_KEY]
      }).deletedCourses;
    }
    renderHud("Ready");
    applyOverlayGeometry(result[OVERLAY_GEOMETRY_KEY]);
    updateOverlayCompactClasses(createHud());
    overlayGeometryLoaded = true;
  });
}

function saveState() {
  storage.set({ [STORAGE_KEY]: state });
}

function currentCourse() {
  if (!state?.courses?.length) return null;
  return state.courses[state.currentCol] || null;
}

function currentUnique() {
  const course = currentCourse();
  return course?.uniques?.[course.row] || "";
}

function backupsLeft(course) {
  if (!course) return [];
  return course.uniques.slice(course.row + 1);
}

function createHud() {
  let hud = document.getElementById(HUD_ID);
  if (hud) return hud;

  hud = document.createElement("div");
  hud.id = HUD_ID;
  hud.innerHTML = `
    <div class="reg-topbar" title="Drag to move overlay">
      <div>
        <span class="reg-title">Registration SpeedRunner</span>
        <span class="reg-subtitle">Drag to move overlay</span>
      </div>
      <div class="reg-top-actions">
        <span class="reg-pill" title="Your extension is active!">ON</span>
        <button class="reg-restore-btn" data-reg-action="rewind-backups" type="button" title="Reload lists to first uniques" aria-label="Reload lists to first uniques">&#x21bb;</button>
      </div>
    </div>
    <div class="reg-body">
      <p class="reg-message">Ready</p>
      <div class="reg-focus-card">
        <span class="reg-label">Current class</span>
        <div class="reg-course-row">
          <strong data-reg="course">—</strong>
          <span class="reg-other-courses" data-reg="other-courses" aria-label="Other classes"></span>
        </div>
        <div class="reg-unique-row">
          <span class="reg-big-unique" data-reg="unique">—</span>
          <span class="reg-backups-left" data-reg="backups" aria-label="Backups left"></span>
        </div>
      </div>
      <div class="reg-keys">
        <span><span class="reg-key">Ctrl+Shift+A</span> previous</span>
        <span><span class="reg-key">Ctrl+Shift+S</span> paste + advance</span>
        <span><span class="reg-key">Ctrl+Shift+F</span> next class</span>
      </div>
    </div>
  `;
  document.documentElement.appendChild(hud);
  enableOverlayDragging(hud);
  observeOverlayResize(hud);
  hud.addEventListener("mousedown", (event) => {
    if (event.target.closest("[data-reg-action]")) event.preventDefault();
  });
  hud.addEventListener("click", (event) => {
    const target = event.target.closest("[data-reg-action]");
    if (!target) return;

    if (target.dataset.regAction === "select-course") {
      selectCourse(Number(target.dataset.col));
      return;
    }

    if (target.dataset.regAction === "backup") {
      selectBackup(Number(target.dataset.row));
      return;
    }

    if (target.dataset.regAction === "rewind-backups") {
      rewindBackups();
    }
  });
  return hud;
}

function renderHud(message) {
  const hud = createHud();

  if (!state?.enabled) {
    hud.classList.remove("reg-show");
    return;
  }

  const course = currentCourse();
  const remaining = backupsLeft(course);

  hud.querySelector(".reg-message").textContent = message || "Ready";
  hud.querySelector('[data-reg="course"]').textContent = course?.name || "No class loaded";
  const otherCourses = hud.querySelector('[data-reg="other-courses"]');
  otherCourses.replaceChildren();
  const selectableCourses = state.courses
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => index !== state.currentCol);
  selectableCourses.forEach(({ item, index }, position) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reg-select reg-course-select";
    button.dataset.regAction = "select-course";
    button.dataset.col = String(index);
    button.textContent = item.name;
    otherCourses.appendChild(button);
    if (position < selectableCourses.length - 1) otherCourses.append(", ");
  });
  hud.querySelector('[data-reg="unique"]').textContent = currentUnique() || "—";
  const backups = hud.querySelector('[data-reg="backups"]');
  backups.replaceChildren();
  if (remaining.length) {
    remaining.forEach((unique, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reg-select reg-backup-select";
      button.dataset.regAction = "backup";
      button.dataset.row = String(course.row + index + 1);
      button.textContent = unique;
      backups.appendChild(button);
      if (index < remaining.length - 1) backups.append(", ");
    });
  } else {
    backups.textContent = "No backups left";
  }
  const rewindButton = hud.querySelector('[data-reg-action="rewind-backups"]');
  rewindButton.disabled = false;

  hud.classList.add("reg-show");
}

function flashMessage(message, duration = 1400) {
  renderHud(message);
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => renderHud("Ready"), duration);
}

function selectCourse(index) {
  if (!state?.courses?.length || !Number.isInteger(index)) return;
  state.currentCol = Math.max(0, Math.min(index, state.courses.length - 1));
  saveState();
  flashMessage(`Selected ${currentCourse()?.name || "class"}`);
}

function selectBackup(row) {
  const course = currentCourse();
  if (!course || !Number.isInteger(row) || row < 0 || row >= course.uniques.length) return;
  course.row = row;
  saveState();
  flashMessage(`Selected ${currentUnique()}`);
}

function rewindBackups() {
  if (!state?.courses?.some((course) => course.row > 0)) {
    flashMessage("Already at first uniques.");
    return;
  }
  state.courses = state.courses.map((course) => ({ ...course, row: 0 }));
  saveState();
  flashMessage("Rewound all classes.");
}

function applyOverlayGeometry(geometry) {
  const hud = createHud();
  if (!geometry || typeof geometry !== "object") return;

  const width = Number(geometry.width);
  const height = Number(geometry.height);
  const left = Number(geometry.left);
  const top = Number(geometry.top);

  if (Number.isFinite(width)) hud.style.width = `${Math.max(280, Math.min(width, window.innerWidth))}px`;
  if (Number.isFinite(height)) hud.style.height = `${Math.max(180, Math.min(height, window.innerHeight))}px`;
  if (Number.isFinite(left)) {
    hud.style.left = `${Math.max(0, Math.min(left, window.innerWidth - hud.offsetWidth))}px`;
    hud.style.right = "auto";
  }
  if (Number.isFinite(top)) hud.style.top = `${Math.max(0, Math.min(top, window.innerHeight - hud.offsetHeight))}px`;
}


function updateOverlayCompactClasses(hud) {
  const rect = hud.getBoundingClientRect();
  hud.classList.toggle("reg-compact-width", rect.width <= 310);
  hud.classList.toggle("reg-compact-height", rect.height <= 230);
}
function saveOverlayGeometry(hud) {
  updateOverlayCompactClasses(hud);
  if (!overlayGeometryLoaded) return;
  const rect = hud.getBoundingClientRect();
  storage.set({
    [OVERLAY_GEOMETRY_KEY]: {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  });
}

function enableOverlayDragging(hud) {
  const handle = hud.querySelector(".reg-topbar");
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();

    const rect = hud.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    hud.style.left = `${rect.left}px`;
    hud.style.top = `${rect.top}px`;
    hud.style.right = "auto";
    handle.setPointerCapture(event.pointerId);
    hud.classList.add("reg-dragging");

    const move = (moveEvent) => {
      const maxLeft = Math.max(0, window.innerWidth - hud.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - hud.offsetHeight);
      hud.style.left = `${Math.max(0, Math.min(moveEvent.clientX - offsetX, maxLeft))}px`;
      hud.style.top = `${Math.max(0, Math.min(moveEvent.clientY - offsetY, maxTop))}px`;
    };

    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      hud.classList.remove("reg-dragging");
      saveOverlayGeometry(hud);
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
}

function observeOverlayResize(hud) {
  if (typeof ResizeObserver !== "function") return;
  const observer = new ResizeObserver(() => {
    updateOverlayCompactClasses(hud);
    clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(() => saveOverlayGeometry(hud), 180);
  });
  observer.observe(hud);
}

function speedRunnerActionForKey(event) {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.repeat) return null;

  const actionsByCode = {
    KeyA: "previousBackup",
    KeyS: "pasteAndAdvance",
    KeyF: "nextClass"
  };
  return actionsByCode[event.code] || null;
}

function isEditable(element) {
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || element.isContentEditable;
}

function canWriteToInput(input) {
  const type = (input.getAttribute("type") || "text").toLowerCase();
  const blocked = new Set(["button", "checkbox", "color", "date", "datetime-local", "file", "hidden", "image", "month", "radio", "range", "reset", "submit", "time", "week"]);
  return !blocked.has(type) && !input.disabled && !input.readOnly;
}

function insertIntoFocusedElement(value) {
  const el = document.activeElement;
  if (!isEditable(el)) return false;

  if (el.tagName?.toLowerCase() === "input" || el.tagName?.toLowerCase() === "textarea") {
    if (!canWriteToInput(el)) return false;
    el.value = value;
    const cursor = value.length;
    el.setSelectionRange(cursor, cursor);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  if (el.isContentEditable) {
    document.execCommand("insertText", false, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return true;
  }

  return false;
}

async function copyFallback(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_) {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  }
}

async function pasteAndAdvance() {
  if (!state?.enabled || pasteInProgress) return;
  pasteInProgress = true;
  const course = currentCourse();
  const unique = currentUnique();
  if (!course || !unique) {
    flashMessage("No unique loaded — add classes in the popup.");
    pasteInProgress = false;
    return;
  }

  try {
    const inserted = insertIntoFocusedElement(unique);
    const copied = inserted ? false : await copyFallback(unique);

    const wasLast = course.row === course.uniques.length - 1;
    course.row += 1;
    saveState();

    if (inserted) flashMessage(`Pasted ${unique}${wasLast ? " · no backups left" : " · advanced"}`);
    else if (copied) flashMessage(`Copied ${unique}. Click the field and press Ctrl+V.`);
    else flashMessage(`Could not paste ${unique}. Click inside the input field first.`);
  } finally {
    pasteInProgress = false;
  }
}

function previousBackup() {
  if (!state?.enabled) return;
  const course = currentCourse();
  if (!course) return flashMessage("No class loaded.");
  if (course.row > 0) course.row -= 1;
  saveState();
  flashMessage(`Previous unique: ${currentUnique()}`);
}

function nextClass() {
  if (!state?.enabled) return;
  if (!state?.courses?.length) return flashMessage("No classes loaded.");
  state.currentCol = (state.currentCol + 1) % state.courses.length;
  saveState();
  flashMessage(`Switched to ${currentCourse()?.name || "next class"}`);
}

function handleAction(action) {
  if (action === "previousBackup") previousBackup();
  if (action === "pasteAndAdvance") pasteAndAdvance();
  if (action === "nextClass") nextClass();
}

// The injected page listener is the single shortcut path, avoiding browser command conflicts.
window.addEventListener("keydown", (event) => {
  if (!state?.enabled) return;
  const action = speedRunnerActionForKey(event);
  if (!action) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  handleAction(action);
}, true);

storage.onChanged((changes, area) => {
  if (area !== "local") return;
  if (!changes[STORAGE_KEY] && !changes[DELETED_COURSES_KEY]) return;
  if (changes[STORAGE_KEY]) state = normalizeState(changes[STORAGE_KEY].newValue);
  if (changes[DELETED_COURSES_KEY]) {
    state.deletedCourses = normalizeState({
      ...state,
      deletedCourses: changes[DELETED_COURSES_KEY].newValue
    }).deletedCourses;
  }
  renderHud("Settings updated");
});

loadState();
