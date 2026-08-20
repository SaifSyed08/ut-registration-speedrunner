const STORAGE_KEY = "regSpeedRunnerState";
const DELETED_COURSES_KEY = "regSpeedRunnerDeletedCourses";
const OVERLAY_GEOMETRY_KEY = "regSpeedRunnerOverlayGeometry";
const HUD_ID = "reg-speedrunner-hud";
const DEFAULT_COURSE_COLORS = ["#dc2626", "#bf5700", "#d97706", "#eab308", "#84cc16", "#16a34a", "#14b8a6", "#0891b2", "#2f80ed", "#1d4ed8", "#6366f1", "#a855f7", "#ec4899", "#64748b"];
const AUTO_MODES = new Set(["off", "paste-submit", "full"]);
const AUTO_SUBMIT_DELAY_MS = 80;
const FULL_AUTO_RESULT_POLL_MS = 180;
const FULL_AUTO_RESULT_TIMEOUT_MS = 1800;
const FULL_AUTO_NEXT_DELAY_MS = 260;

let state = null;
let messageTimer = null;
let pasteInProgress = false;
let overlayGeometryLoaded = false;
let resizeSaveTimer = null;
let lastFocusedEditable = null;
let fullAutoRun = null;
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

function normalizeAutoMode(value, legacyAutoSubmit = false) {
  const mode = String(value || "");
  if (AUTO_MODES.has(mode)) return mode;
  return legacyAutoSubmit ? "paste-submit" : "off";
}

function hexToRgb(value) {
  const color = normalizeColor(value);
  const hex = color.slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function darkerTextRgb({ r, g, b }) {
  return {
    r: Math.max(0, Math.round(r * 0.68)),
    g: Math.max(0, Math.round(g * 0.68)),
    b: Math.max(0, Math.round(b * 0.68))
  };
}

function applyHudCourseColor(hud, course) {
  const enabled = Boolean(state?.overlayCourseColors && course?.color);
  hud.classList.toggle("reg-course-color-mode", enabled);
  if (!enabled) {
    hud.style.removeProperty("--reg-course-color");
    hud.style.removeProperty("--reg-course-rgb");
    hud.style.removeProperty("--reg-course-text-color");
    return;
  }

  const color = normalizeColor(course.color);
  const rgb = hexToRgb(color);
  const textRgb = darkerTextRgb(rgb);
  hud.style.setProperty("--reg-course-color", color);
  hud.style.setProperty("--reg-course-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  hud.style.setProperty("--reg-course-text-color", `rgb(${textRgb.r}, ${textRgb.g}, ${textRgb.b})`);
}

function normalizeState(input) {
  const next = input && typeof input === "object" ? input : { enabled: true, currentCol: 0, courses: [] };
  next.enabled = Boolean(next.enabled);
  next.autoMode = normalizeAutoMode(next.autoMode, next.autoSubmit);
  next.overlayCourseColors = Boolean(next.overlayCourseColors);
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

function isTopFrame() {
  try {
    return window.top === window;
  } catch (_) {
    return true;
  }
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
    if (isTopFrame()) {
      renderHud("Ready");
      applyOverlayGeometry(result[OVERLAY_GEOMETRY_KEY]);
      updateOverlayCompactClasses(createHud());
      overlayGeometryLoaded = true;
    }
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
        <span class="reg-pill reg-pill-auto" data-reg="auto-pill" title="Auto mode is enabled" hidden>AUTO</span>
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
          <button class="reg-big-unique reg-current-unique" data-reg-action="copy-current" data-reg="unique" type="button" title="Copy current unique">—</button>
          <span class="reg-backups-left" data-reg="backups" aria-label="Backups left"></span>
        </div>
      </div>
      <div class="reg-keys">
        <span><span class="reg-key">Ctrl+Shift+A</span> previous</span>
        <span><span class="reg-key">Ctrl+Shift+S</span> paste + advance</span>
        <span><span class="reg-key">Ctrl+Shift+F</span> next class</span>
      </div>
      <p class="reg-auto-hint" data-reg="auto-hint" hidden>"Do everything" is active; use <span class="reg-key">Ctrl+Shift+S</span> to begin.</p>
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
      selectBackup(Number(target.dataset.row), true);
      return;
    }

    if (target.dataset.regAction === "rewind-backups") {
      rewindBackups();
      return;
    }

    if (target.dataset.regAction === "copy-current") {
      void copyUniqueToClipboard(currentUnique(), "current unique");
    }
  });
  return hud;
}

function renderHud(message) {
  if (!isTopFrame()) return;
  const hud = createHud();

  if (!state?.enabled) {
    hud.classList.remove("reg-show");
    return;
  }

  const course = currentCourse();
  const remaining = backupsLeft(course);
  applyHudCourseColor(hud, course);

  hud.querySelector(".reg-message").textContent = message || "Ready";
  const autoPill = hud.querySelector('[data-reg="auto-pill"]');
  autoPill.hidden = state.autoMode === "off";
  autoPill.textContent = state.autoMode === "full" ? "FULL" : "SUBMIT";
  hud.querySelector('[data-reg="auto-hint"]').hidden = state.autoMode !== "full";
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

async function copyUniqueToClipboard(value, label = "unique") {
  if (!value) return;
  const copied = await copyFallback(value);
  flashMessage(copied ? `Copied ${value}` : `Could not copy ${label}.`);
}

function selectBackup(row, copyAfterSelect = false) {
  const course = currentCourse();
  if (!course || !Number.isInteger(row) || row < 0 || row >= course.uniques.length) return;
  course.row = row;
  saveState();
  if (copyAfterSelect) void copyUniqueToClipboard(currentUnique(), "backup");
  else flashMessage(`Selected ${currentUnique()}`);
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

function isVisibleElement(element) {
  if (!element || element.hidden) return false;
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function inputSearchText(element) {
  const escapedId = element.id && typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(element.id)
    : String(element.id || "").replaceAll('"', '\\"');
  const label = element.id
    ? document.querySelector(`label[for="${escapedId}"]`)?.textContent
    : "";
  return [
    element.name,
    element.id,
    element.className,
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    element.getAttribute("title"),
    label,
    element.closest("form")?.textContent
  ].filter(Boolean).join(" ").toLowerCase();
}

function uniqueInputScore(element) {
  const text = inputSearchText(element);
  let score = 0;
  if (/\b(unique|unique number)\b/.test(text)) score += 30;
  if (/\b(register|add class|add)\b/.test(text)) score += 8;
  if (/\b(drop|dependent|search|estimate|tuition)\b/.test(text)) score -= 8;
  const maxLength = Number(element.getAttribute("maxlength"));
  if (maxLength === 5 || maxLength === 6) score += 10;
  if ((element.getAttribute("inputmode") || "").toLowerCase() === "numeric") score += 8;
  const type = (element.getAttribute("type") || "text").toLowerCase();
  if (type === "text" || !element.getAttribute("type")) score += 3;
  if (element.matches?.("#uniqueNumber, .unique-input")) score += 20;
  if (element.matches?.("#s_unique_add, input[name='s_unique_add']")) score += 30;
  if (element.matches?.("#s_swap_unique_add, input[name='s_swap_unique_add']")) score -= 20;
  return score;
}

function likelyUniqueInput({ aggressive = false } = {}) {
  const selectors = [
    'input[name*="unique" i]',
    'input[id*="unique" i]',
    'input[aria-label*="unique" i]',
    'input[placeholder*="unique" i]',
    'input[name*="course" i]',
    'input[id*="course" i]',
    'input[type="text"]',
    'input:not([type])',
    "textarea",
    '[contenteditable="true"]'
  ];

  const candidates = [...document.querySelectorAll(selectors.join(","))]
    .filter((element) => isEditable(element) && isVisibleElement(element))
    .filter((element) => element.isContentEditable || canWriteToInput(element));
  const uniqueCandidates = [...new Set(candidates)]
    .map((element) => ({ element, score: uniqueInputScore(element) }))
    .sort((a, b) => b.score - a.score);

  if (uniqueCandidates.length === 1) return uniqueCandidates[0].element;
  if (!uniqueCandidates.length) return null;
  if (aggressive) return uniqueCandidates[0].element;
  if (uniqueCandidates[0].score >= 22 && uniqueCandidates[0].score >= (uniqueCandidates[1]?.score || 0) + 6) {
    return uniqueCandidates[0].element;
  }
  return null;
}

function deepActiveElement(root = document) {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function setNativeValue(element, value) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(element, "value");
  const prototype = Object.getPrototypeOf(element);
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  const setter = prototypeDescriptor?.set && ownDescriptor?.set !== prototypeDescriptor.set
    ? prototypeDescriptor.set
    : ownDescriptor?.set;

  if (setter) setter.call(element, value);
  else element.value = value;
}

function notifyValueChanged(element, value) {
  const inputEvent = typeof InputEvent === "function"
    ? new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value })
    : new Event("input", { bubbles: true, composed: true });
  element.dispatchEvent(inputEvent);
  element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
}

function isClickableSubmitControl(element) {
  if (!element || !isVisibleElement(element)) return false;
  if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
  const tag = element.tagName?.toLowerCase();
  if (tag === "input") {
    const type = (element.getAttribute("type") || "text").toLowerCase();
    return ["submit", "button", "image"].includes(type);
  }
  return tag === "button" || element.getAttribute("role") === "button";
}

function submitText(element) {
  return `${element.textContent || ""} ${element.value || ""} ${element.name || ""} ${element.id || ""}`.toLowerCase();
}

function findSubmitButton(referenceElement) {
  const preferredSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'input[name="s_submit"]',
    'input[type="image"]',
    'button[name*="submit" i]',
    'input[name*="submit" i]',
    'button[id*="submit" i]',
    'input[id*="submit" i]',
    'button[name*="register" i]',
    'input[name*="register" i]',
    'button[id*="register" i]',
    'input[id*="register" i]',
    'button[name*="add" i]',
    'input[name*="add" i]',
    'button[id*="add" i]',
    'input[id*="add" i]'
  ];
  const textPattern = /\b(submit|register|add|add class|continue|enter)\b/i;
  const roots = [referenceElement?.closest?.("form"), document].filter(Boolean);

  for (const root of roots) {
    const preferred = [...root.querySelectorAll(preferredSelectors.join(","))]
      .find(isClickableSubmitControl);
    if (preferred) return preferred;

    const textMatch = [...root.querySelectorAll('button, input[type="button"], a[role="button"]')]
      .find((element) => isClickableSubmitControl(element) && textPattern.test(submitText(element)));
    if (textMatch) return textMatch;
  }

  return null;
}

function fireSyntheticClick(element) {
  const options = { bubbles: true, cancelable: true, composed: true, view: window };
  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
    const event = type.startsWith("pointer") && typeof PointerEvent === "function"
      ? new PointerEvent(type, options)
      : new MouseEvent(type, options);
    element.dispatchEvent(event);
  });
}

function autoSubmitForm(referenceElement, expectedValue = "") {
  const button = findSubmitButton(referenceElement);
  const form = referenceElement?.closest?.("form") || button?.closest?.("form");
  if (!button && !form) return false;

  setTimeout(() => {
    if (expectedValue && isEditable(referenceElement) && referenceElement.value !== expectedValue) {
      setNativeValue(referenceElement, expectedValue);
      notifyValueChanged(referenceElement, expectedValue);
    }

    referenceElement?.focus?.({ preventScroll: true });
    if (form?.requestSubmit) {
      try {
        form.requestSubmit(button || undefined);
        return;
      } catch (_) {}
    }

    if (button) {
      button.focus({ preventScroll: true });
      try {
        button.click();
        return;
      } catch (_) {}
      fireSyntheticClick(button);
      return;
    }

    if (!form) return;
    const submitEvent = typeof SubmitEvent === "function"
      ? new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button || null })
      : new Event("submit", { bubbles: true, cancelable: true });
    const allowed = form.dispatchEvent(submitEvent);
    if (allowed && typeof form.submit === "function") form.submit();
  }, AUTO_SUBMIT_DELAY_MS);
  return true;
}

function scheduleContainers() {
  const selectors = [
    "#scheduleBody",
    ".classScheduleUnique",
    ".classScheduleHeader",
    'table[aria-label*="registered" i]',
    'table[aria-label*="schedule" i]',
    '[aria-labelledby*="schedule" i]',
    '[id*="schedule" i]',
    '[class*="schedule" i]',
    '[id*="registered" i]',
    '[class*="registered" i]'
  ];
  return [...new Set([...document.querySelectorAll(selectors.join(","))].filter(isVisibleElement))];
}

function scheduleHasUnique(unique) {
  if (!unique) return false;
  const pattern = new RegExp(`\\b${unique}\\b`);
  const scheduleCells = [
    ...document.querySelectorAll("#scheduleBody td:first-child, .classScheduleUnique, table[aria-label*='registered' i] tbody td:first-child")
  ].filter(isVisibleElement);
  if (scheduleCells.some((cell) => cell.textContent?.trim() === unique)) return true;

  const containers = scheduleContainers();
  if (containers.some((element) => pattern.test(element.textContent || ""))) return true;
  return [...document.querySelectorAll("table tbody tr, table tr")]
    .filter(isVisibleElement)
    .some((row) => pattern.test(row.textContent || ""));
}

function pageErrorTextMentions(unique) {
  const selectors = ['[role="alert"]', ".error", ".errors", ".message", "#message"];
  const text = [...document.querySelectorAll(selectors.join(","))]
    .filter(isVisibleElement)
    .map((element) => element.textContent || "")
    .join(" ")
    .toLowerCase();
  if (!text) return false;

  const failurePattern = /\b(error|failed|failure|invalid|closed|full|waitlist|waitlisted|unsuccessful|not added|not registered|not eligible|problem|unable|denied|restricted|reserved|five-digit)\b/;
  const uniquePattern = unique ? new RegExp(`\\b${unique}\\b`) : null;
  return failurePattern.test(text) && (!uniquePattern || uniquePattern.test(text) || /five-digit/.test(text));
}

function detectRegistrationResult(unique) {
  if (scheduleHasUnique(unique)) return "success";
  if (pageErrorTextMentions(unique)) return "failure";
  return "pending";
}

function startFullAutoRunIfNeeded() {
  if (fullAutoRun?.active) return;
  fullAutoRun = {
    active: true,
    completed: new Set(),
    attempts: 0,
    maxAttempts: Math.max(1, state?.courses?.reduce((total, course) => total + Math.max(1, course.uniques.length), 0) || 1)
  };
}

function stopFullAutoRun(message) {
  if (fullAutoRun) fullAutoRun.active = false;
  if (message) flashMessage(message, 2200);
}

function waitForFullAutoResult(unique, courseIndex, rowIndex, startedAt = Date.now()) {
  if (!fullAutoRun?.active) return;
  const result = detectRegistrationResult(unique);
  if (result === "pending" && Date.now() - startedAt < FULL_AUTO_RESULT_TIMEOUT_MS) {
    setTimeout(() => waitForFullAutoResult(unique, courseIndex, rowIndex, startedAt), FULL_AUTO_RESULT_POLL_MS);
    return;
  }
  advanceFullAutoAfterResult(unique, courseIndex, rowIndex, result);
}

function advanceFullAutoAfterResult(unique, courseIndex, rowIndex, resultOverride = null) {
  if (!fullAutoRun?.active) return;
  const result = resultOverride || detectRegistrationResult(unique);
  const course = state?.courses?.[courseIndex];
  if (!course) return stopFullAutoRun("Full auto stopped: class disappeared.");

  if (result === "success") {
    fullAutoRun.completed.add(courseIndex);
    course.row = Math.max(course.row, rowIndex + 1);
    if (fullAutoRun.completed.size >= state.courses.length) {
      saveState();
      return stopFullAutoRun("Full auto complete.");
    }

    let nextIndex = courseIndex;
    for (let i = 0; i < state.courses.length; i += 1) {
      nextIndex = (nextIndex + 1) % state.courses.length;
      if (!fullAutoRun.completed.has(nextIndex) && state.courses[nextIndex]?.uniques?.[state.courses[nextIndex].row]) break;
    }
    state.currentCol = nextIndex;
    saveState();
    flashMessage(`Registered ${unique}; switched to ${state.courses[nextIndex]?.name || "next class"}.`);
    setTimeout(() => pasteAndAdvance({ continueFullAuto: true }), FULL_AUTO_NEXT_DELAY_MS);
    return;
  }

  if (result === "failure") {
    if (rowIndex < course.uniques.length - 1) {
      course.row = rowIndex + 1;
      state.currentCol = courseIndex;
      saveState();
      flashMessage(`Unique ${unique} failed; trying backup.`);
      setTimeout(() => pasteAndAdvance({ continueFullAuto: true }), FULL_AUTO_NEXT_DELAY_MS);
      return;
    }
    fullAutoRun.completed.add(courseIndex);
    saveState();
    return stopFullAutoRun(`${course.name} failed: no backups left.`);
  }

  saveState();
  stopFullAutoRun(`Could not confirm ${unique}; full auto paused.`);
}

function selectRegisterAction(referenceElement) {
  const root = referenceElement?.closest?.("form") || document;
  const candidates = [...root.querySelectorAll('input[type="radio"], input[type="checkbox"]')]
    .filter((element) => isVisibleElement(element) && !element.disabled);
  const registerControl = candidates.find((element) => /\b(register|add)\b/i.test(inputSearchText(element) || element.value || ""));
  if (registerControl && !registerControl.checked) {
    registerControl.click();
    registerControl.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function insertIntoFocusedElement(value, { aggressive = false, preferredElement = null } = {}) {
  const activeElement = deepActiveElement();
  const candidates = aggressive
    ? [activeElement, preferredElement || likelyUniqueInput({ aggressive: true }), lastFocusedEditable]
    : [activeElement, lastFocusedEditable, likelyUniqueInput()];
  const el = candidates.find((element) => {
    if (!isEditable(element)) return false;
    if (element.tagName?.toLowerCase() === "input" || element.tagName?.toLowerCase() === "textarea") {
      return canWriteToInput(element);
    }
    return element.isContentEditable;
  });
  if (!isEditable(el)) return false;

  if (el.tagName?.toLowerCase() === "input" || el.tagName?.toLowerCase() === "textarea") {
    if (!canWriteToInput(el)) return false;
    el.focus({ preventScroll: true });
    setNativeValue(el, value);
    const cursor = value.length;
    el.setSelectionRange(cursor, cursor);
    notifyValueChanged(el, value);
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    return el;
  }

  if (el.isContentEditable) {
    el.focus({ preventScroll: true });
    document.execCommand("insertText", false, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return el;
  }

  return false;
}

async function copyFallback(value) {
  const copyWithTextarea = () => {
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
  };

  if (copyWithTextarea()) return true;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_) {
    return false;
  }
}

async function pasteAndAdvance(options = {}) {
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
    const fullAuto = state.autoMode === "full";
    const shouldSubmit = state.autoMode === "paste-submit" || fullAuto;
    if (fullAuto && !options.continueFullAuto) startFullAutoRunIfNeeded();
    if (fullAuto && fullAutoRun) {
      fullAutoRun.attempts += 1;
      if (fullAutoRun.attempts > fullAutoRun.maxAttempts) {
        pasteInProgress = false;
        return stopFullAutoRun("Full auto stopped: too many attempts.");
      }
    }
    const courseIndex = state.currentCol;
    const rowIndex = course.row;
    const preferredElement = shouldSubmit ? likelyUniqueInput({ aggressive: true }) : null;
    if (fullAuto && preferredElement) selectRegisterAction(preferredElement);
    const insertedElement = insertIntoFocusedElement(unique, { aggressive: shouldSubmit, preferredElement });
    const inserted = Boolean(insertedElement);
    const copied = inserted ? false : await copyFallback(unique);

    if (inserted) {
      const wasLast = course.row === course.uniques.length - 1;
      const autoSubmitted = shouldSubmit ? autoSubmitForm(insertedElement, unique) : false;
      if (fullAuto) {
        saveState();
        flashMessage(`Pasted ${unique}${autoSubmitted ? " · checking result" : " · no submit button found"}`);
        if (autoSubmitted) setTimeout(() => waitForFullAutoResult(unique, courseIndex, rowIndex), FULL_AUTO_RESULT_POLL_MS);
        else stopFullAutoRun("Full auto stopped: no submit button found.");
      } else {
        course.row += 1;
        saveState();
        flashMessage(`Pasted ${unique}${autoSubmitted ? " · auto-submitting" : shouldSubmit ? " · no submit button found" : wasLast ? " · no backups left" : " · advanced"}`);
      }
    } else if (copied) flashMessage(`No input selected. Copied ${unique}; click the UT unique-number box first.`);
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

window.addEventListener("focusin", (event) => {
  if (isEditable(event.target)) lastFocusedEditable = event.target;
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


if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "regSpeedRunnerPing") return false;
    sendResponse({ ok: true });
    return true;
  });
}
loadState();
