/* ============================
   Chris' Diary - script.js
   ============================ */

const MIN_YEAR = 1972;
const MAX_YEAR = 2014;
const diaryDir = "./diaries/";

import { encryptText, decryptPackage } from './crypto.js';

let diaryData = {};     // { year: [ { header, entry, date, dayNum } ] }
let currentYear = null; // numeric year
let currentView = "month"; // "month" | "week" | "day"
let currentDate = null; // Date object representing the current focused date

function showLoadingOverlay(message = "Loading…") {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    overlay.textContent = message;
    overlay.style.display = "flex";
  }
}

// Optional helper for updating without flicker:
function updateLoadingOverlay(message) {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay && overlay.style.display !== "none") {
    overlay.textContent = message;
  }
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.style.display = "none";
}

/* -----------------------
   Single initialization
   ----------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadAllDiariesFromFolder();
  } catch (err) {
    console.warn("Auto-load failed:", err);
    // Proceed so user can still use file picker or manual load if implemented
  }

  setupControls();
  // If diaries were loaded and we have years, select first available
  const years = Object.keys(diaryData).sort();
  if (years.length > 0) {
    setYear(parseInt(years[0]), /*preserveDay*/ false);
  } else {
    // No diaries loaded; initialize selectors with standard range
    populateYearSelectRange();
  }

  showCurrentView();
});

/* -----------------------
   Load all diaries from ./diaries/
   (requires server directory listing e.g. python -m http.server)
   ----------------------- */
/* --- UNIVERSAL DIARY LOADER (supports .txt and .enc) --- */
async function loadAllDiariesFromFolder() {
  try {
    // 1. Fetch manifest listing all diary files
    const response = await fetch(`${diaryDir}manifest.json`);
    if (!response.ok) throw new Error("Failed to load diary manifest");
    const manifest = await response.json();
    const files = manifest.files || [];
    if (!files.length) throw new Error("No diary files listed in manifest");

    // 2. If there are any encrypted files, request passphrase (once per session)
    const hasEncrypted = files.some(f => f.endsWith(".enc"));
    let passphrase = null;
    if (hasEncrypted) {
      passphrase = sessionStorage.getItem("diary_passphrase");
      if (!passphrase) {
        passphrase = prompt("Enter your diary passphrase to decrypt encrypted diaries:");
        if (!passphrase) throw new Error("No passphrase provided");
        sessionStorage.setItem("diary_passphrase", passphrase);
      }
    }

    // 3. Load each file, showing progress
    diaryData = {}; // reset existing data
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const year = extractYear(file);
      const url = `${diaryDir}${file}`;

      // Update overlay: e.g. "Loading 1976 (4/12)…"
      updateLoadingOverlay(`Loading ${file} (${i + 1}/${files.length})…`);

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Cannot fetch ${file}`);
        const text = await res.text();

        let plain;
        if (file.endsWith(".enc")) {
          try {
            plain = await decryptPackage(text, passphrase);
          } catch (err) {
            console.error(`Failed to decrypt ${file}:`, err);
            continue;
          }
        } else {
          plain = text;
        }

        diaryData[year] = parseDiaryText(plain, parseInt(year));

      } catch (err) {
        console.error(`Error loading ${file}:`, err);
      }
    }

    updateLoadingOverlay("Finalizing diary data…");
    finalizeDiaryLoad(diaryData);

  } catch (err) {
    console.error("Failed to load diaries:", err);
    const container = document.getElementById("entriesContainer");
    if (container) container.innerHTML =
      `<p class="error">⚠️ Unable to load diary files.<br>${err.message}</p>`;
  }
}

function finalizeDiaryLoad(allDiaries) {
  const years = Object.keys(allDiaries).sort((a, b) => a - b);
  if (years.length === 0) {
    throw new Error("No diary data loaded");
  }

  const select = document.getElementById("yearSelect");
  if (!select) return;

  select.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  currentYear = parseInt(years[0]);
  select.value = currentYear;

  showCurrentView();
  console.log(`✅ Loaded ${years.length} diary files (${years[0]}–${years[years.length - 1]})`);
}

/* -----------------------
   Parsing helpers
   ----------------------- */
function parseDiaryText(text, year) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;

  for (let line of lines) {
    if (line.startsWith("#DAY")) {
      if (current) entries.push(current);
      const dayMatch = line.match(/#DAY(\d{3})/);
      const dayNum = dayMatch ? parseInt(dayMatch[1], 10) : 1;
      const date = new Date(year, 0);
      date.setDate(dayNum);
      current = {
        header: line.trim(),
        entry: "",
        date: date,
        dayNum: dayNum
      };
    } else if (line.startsWith("#END")) {
      if (current) {
        entries.push(current);
        current = null;
      }
    } else if (current && !line.startsWith("#BEGIN")) {
      current.entry += line + "\n";
    }
  }

  // In case last entry didn't end with #END
  if (current) entries.push(current);

  return entries;
}

function extractYear(filename) {
  const m = filename.match(/(\d{4})/);
  return m ? m[1] : "unknown";
}

/* -----------------------
   UI setup
   ----------------------- */
function setupControls() {
  const yearSel = document.getElementById("yearSelect");
  yearSel.addEventListener("change", () => {
    const y = parseInt(yearSel.value);
    if (!isNaN(y)) setYear(y, /*preserveDay*/ false);
  });

  const viewSel = document.getElementById("viewMode");
  viewSel.addEventListener("change", (e) => {
    currentView = e.target.value;
    showCurrentView();
  });

  document.getElementById("prevBtn").addEventListener("click", () => navigate(-1));
  document.getElementById("nextBtn").addEventListener("click", () => navigate(1));
  document.getElementById("searchBtn").addEventListener("click", searchEntries);
  document.getElementById("clearBtn").addEventListener("click", clearSearch);

  // Date picker jump
  const datePicker = document.getElementById("datePicker");
  if (datePicker) {
    datePicker.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val) {
        const d = new Date(val);
        setDateAndYear(d);
        showCurrentView();
      }
    });
  }

  // Reading controls (if present)
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      document.body.classList.toggle("dark");
      themeToggle.textContent = document.body.classList.contains("dark") ? "☀️ Light Mode" : "🌙 Dark Mode";
      localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
    });
  }

  const fontSizeRange = document.getElementById("fontSizeRange");
  if (fontSizeRange) {
    fontSizeRange.addEventListener("input", (e) => {
      document.documentElement.style.setProperty("--entry-font-size", e.target.value + "px");
      localStorage.setItem("fontSize", e.target.value);
    });
    // restore saved
    const savedFont = localStorage.getItem("fontSize");
    if (savedFont) {
      fontSizeRange.value = savedFont;
      document.documentElement.style.setProperty("--entry-font-size", savedFont + "px");
    }
  }

  // restore theme
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark") {
    document.body.classList.add("dark");
    if (themeToggle) themeToggle.textContent = "☀️ Light Mode";
  }
}

/* -----------------------
   Year / Date setters
   ----------------------- */

function populateYearSelectFromData() {
  const select = document.getElementById("yearSelect");
  if (!select) return;
  const years = Object.keys(diaryData).sort();
  select.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
}

function populateYearSelectRange() {
  const select = document.getElementById("yearSelect");
  if (!select) return;
  select.innerHTML = "";
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    select.appendChild(opt);
  }
}

function setYear(year, preserveDay = false) {
  // year: numeric
  currentYear = year;
  const select = document.getElementById("yearSelect");
  if (select) select.value = year;

  // If diary data exists for this year, pick the first entry date with content
  const entries = diaryData[year] || [];
  if (entries.length > 0) {
    // find first entry that has a non-empty body
    const firstWithText = entries.find(e => e.entry && e.entry.trim());
    const anchorDate = firstWithText ? new Date(firstWithText.date) : new Date(year, 0, 1);
    if (!preserveDay || !currentDate) {
      currentDate = new Date(anchorDate);
    } else {
      // preserve day when switching years - keep same month/day if possible
      const month = currentDate.getMonth();
      const day = currentDate.getDate();
      currentDate = new Date(year, month, day);
    }
  } else {
    currentDate = new Date(year, 0, 1);
  }

  // keep currentView selection element in sync
  const viewSel = document.getElementById("viewMode");
  if (viewSel) viewSel.value = currentView;

  showCurrentView();
}

function setDateAndYear(dateObj) {
  currentDate = new Date(dateObj);
  currentYear = currentDate.getFullYear();
  const select = document.getElementById("yearSelect");
  if (select && select.querySelector(`option[value="${currentYear}"]`)) {
    select.value = currentYear;
  }
}

/* -----------------------
   Navigation
   ----------------------- */
function navigate(delta) {
  if (!currentDate) return;

  if (currentView === "month") {
    currentDate.setMonth(currentDate.getMonth() + delta);
    // normalize (avoid weird JS overflow)
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  } else if (currentView === "week") {
    currentDate.setDate(currentDate.getDate() + delta * 7);
  } else {
    currentDate.setDate(currentDate.getDate() + delta);
  }

  // update currentYear if we've crossed into another year
  currentYear = currentDate.getFullYear();

  // If we don't have diary data for the new year, keep date but show empty (or you could clamp)
  showCurrentView();
}

/* -----------------------
   View rendering
   ----------------------- */
function showCurrentView() {
  if (!currentDate) {
    const container = document.getElementById("entriesContainer");
    if (container) container.innerHTML = `<p class="hint">No date selected.</p>`;
    return;
  }

  // ensure currentYear matches currentDate
  currentYear = currentDate.getFullYear();

  // update date picker if present
  const datePicker = document.getElementById("datePicker");
  if (datePicker) {
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, "0");
    const d = String(currentDate.getDate()).padStart(2, "0");
    datePicker.value = `${y}-${m}-${d}`;
  }

  const entries = diaryData[currentYear] || [];
  const container = document.getElementById("entriesContainer");
  container.innerHTML = "";

  if (currentView === "month") {
    const month = currentDate.getMonth();
    updateSidebarCalendar(currentYear, month);
    const filtered = entries.filter(e => e.date.getMonth() === month);
    renderEntries(filtered, `${monthName(month)} ${currentYear}`);
  } else if (currentView === "week") {
    const weekNum = getWeekNumber(currentDate);
    // Ensure sidebar shows the month that contains the first day of this week
    const weekFirstDay = getStartOfWeek(currentDate);
    updateSidebarCalendar(currentYear, weekFirstDay.getMonth());
    const filtered = weekEntries(entries, weekNum - 1);
    renderEntries(filtered, `Week ${weekNum} — ${currentYear}`);
  } else { // day
    updateSidebarCalendar(currentYear, currentDate.getMonth());
    const entry = entries.find(e => sameDay(e.date, currentDate));
    renderEntries(entry ? [entry] : [], currentDate.toDateString());
  }
}

/* -----------------------
   Render helpers
   ----------------------- */
function renderEntries(entries, title) {
  const container = document.getElementById("entriesContainer");
  if (!entries || entries.length === 0) {
    container.innerHTML = `<p class='hint'>No entries for ${title}.</p>`;
    return;
  }
  container.innerHTML = `<h2>${title}</h2>`;
  for (const e of entries) {
    if (!e.entry.trim()) continue;
    const div = document.createElement("div");
    div.className = "entry";
    div.innerHTML = `<h3>${e.date.toDateString()}</h3><pre>${escapeHtml(e.entry)}</pre>`;
    container.appendChild(div);
  }
}

/* -----------------------
   Calendar sidebar
   ----------------------- */
function updateSidebarCalendar(year, month) {
  const calendar = document.getElementById("calendar");
  const monthNameEl = document.getElementById("sidebarMonth");
  monthNameEl.textContent = monthName(month);
  calendar.innerHTML = "";

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const entries = diaryData[year] || [];

  // blanks for offset (0 = Sunday)
  const offset = first.getDay();
  for (let i = 0; i < offset; i++) {
    const blank = document.createElement("div");
    calendar.appendChild(blank);
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const cell = document.createElement("div");
    cell.className = "day";
    cell.textContent = d;

    const dateObj = new Date(year, month, d);
    const hasEntry = entries.some(e => sameDay(e.date, dateObj) && e.entry.trim());
    if (hasEntry) cell.classList.add("has-entry");

    const today = new Date();
    if (today.getFullYear() === year && today.getMonth() === month && today.getDate() === d) {
      cell.classList.add("today");
    }

    // clicking sets currentDate precisely to the clicked date
    cell.addEventListener("click", () => {
      currentDate = new Date(year, month, d);
      currentYear = year;
      currentView = "day";
      const viewSel = document.getElementById("viewMode");
      if (viewSel) viewSel.value = "day";
      showCurrentView();
    });

    calendar.appendChild(cell);
  }
}

/* -----------------------
   Utility functions
   ----------------------- */
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function monthName(i) {
  return new Date(2000, i, 1).toLocaleString('default', { month: 'long' });
}

function getStartOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0..6
  date.setDate(date.getDate() - day + 1); // ISO-like week start Mon -> shift if you want Sun
  return date;
}

function weekEntries(entries, weekIndexZeroBased) {
  return entries.filter(e => getWeekNumber(e.date) === weekIndexZeroBased + 1);
}

function getWeekNumber(d) {
  // ISO week number (1..53)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

/* -----------------------
   Search (kept simple / existing)
   ----------------------- */
function parseSearchQuery(q) {
  const ors = q.split(/\s+OR\s+/i).map(s => s.trim());
  return ors.map(orPart => orPart.split(/\s+AND\s+/i).map(s => s.trim().replace(/"/g, "")));
}

function matchesQuery(text, querySets) {
  return querySets.some(andTerms => andTerms.every(term => text.includes(term.toLowerCase())));
}

async function searchEntries() {
  const query = document.getElementById("searchInput").value.trim();
  const allYears = document.getElementById("searchAllYears").checked;
  if (!query) return;

  const regexes = parseSearchQuery(query);
  let results = [];
  const years = allYears ? Object.keys(diaryData) : [String(currentYear)];

  for (const y of years) {
    const entries = diaryData[y] || [];
    for (const e of entries) {
      if (matchesQuery(e.entry.toLowerCase(), regexes)) {
        results.push({ ...e, year: y });
      }
    }
  }
  displayResults(results, query);
}

function displayResults(results, query) {
  const container = document.getElementById("entriesContainer");
  container.innerHTML = `<h2>Search results for: <em>${escapeHtml(query)}</em></h2>`;
  if (results.length === 0) {
    container.innerHTML += `<p>No matches found.</p>`;
    return;
  }
  results.forEach(e => {
    const div = document.createElement("div");
    div.className = "entry";
    const dateStr = `${e.date.toDateString()} (${e.year})`;
    const highlighted = highlightQuery(e.entry, query);
    div.innerHTML = `<h3>${escapeHtml(dateStr)}</h3><pre>${highlighted}</pre>`;
    container.appendChild(div);
  });
}

function highlightQuery(text, query) {
  const terms = query.match(/"[^"]+"|\S+/g) || [];
  let html = escapeHtml(text);
  terms.forEach(term => {
    const clean = term.replace(/"/g, "");
    try {
      const re = new RegExp(escapeRegExp(clean), "gi");
      html = html.replace(re, match => `<mark>${match}</mark>`);
    } catch (err) {
      // ignore invalid regex
    }
  });
  return html;
}

/* -----------------------
   Utilities: escaping
   ----------------------- */
function escapeHtml(s) {
  return s.replace(/[&<>'"]/g, tag => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'" :'&#39;','"':'&quot;'
  })[tag]);
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* -----------------------
   Clear search
   ----------------------- */
function clearSearch() {
  document.getElementById("searchInput").value = "";
  showCurrentView();
}

