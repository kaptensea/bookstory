import { invoke } from "@tauri-apps/api/core";

type Json = any;

let isLoadingChapter = false;
let currentItemId: string | null = null;
let currentFiles: any[] = [];
let currentChapterIndex = 0;
let playerItemId: string | null = null;
let currentLibraryId: string | null = null;
let lastInProgress: any = null;
let forcedSeekTime: number | null = null;
const progressByItemId = new Map<string, { currentTime: number; progress?: number }>();
let currentLibraryItemIds = new Set<string>();
let currentLibraryItems: any[] = [];
const durationByItemId = new Map<string, number>();

/* ---------------- Duration helpers ---------------- */
function sumDurationsFromItem(item: any): number {
  const af = item?.media?.audioFiles;
  if (Array.isArray(af) && af.length) {
    const sum = af.reduce((s: number, f: any) => s + (typeof f?.duration === "number" ? f.duration : 0), 0);
    if (sum > 0) return sum;
  }
  const at = item?.media?.audioTracks;
  if (Array.isArray(at) && at.length) {
    const sum = at.reduce((s: number, t: any) => s + (typeof t?.duration === "number" ? t.duration : 0), 0);
    if (sum > 0) return sum;
  }
  const tr = item?.media?.tracks;
  if (Array.isArray(tr) && tr.length) {
    const sum = tr.reduce((s: number, t: any) => s + (typeof t?.duration === "number" ? t.duration : 0), 0);
    if (sum > 0) return sum;
  }
  const candidates = [
    item?.media?.metadata?.durationSeconds,
    item?.media?.durationSeconds,
    item?.media?.duration,
    item?.media?.metadata?.duration,
  ];
  for (const v of candidates) if (typeof v === "number" && v > 0) return v;
  return 600; // fallback 10 min
}

async function getDurationSeconds(serverUrl: string, username: string, itemId: string): Promise<number> {
  const cached = durationByItemId.get(itemId);
  if (cached && cached > 0) return cached;
  const item = await invoke<any>("abs_get_item", { serverUrl, username, itemId });
  const dur = sumDurationsFromItem(item);
  if (dur > 0) durationByItemId.set(itemId, dur);
  return dur;
}

function normalizeSecondsMaybe(value: number, durationSeconds?: number): number {
  if (durationSeconds && value > durationSeconds * 5) return value / 1000;
  if (value > 100_000) return value / 1000;
  return value;
}

function extractCurrentTimeFromItem(item: any): number | null {
  const cands = [
    item?.userMediaProgress?.currentTime,
    item?.userMediaProgress?.currentTimeMs,
    item?.mediaProgress?.currentTime,
    item?.mediaProgress?.currentTimeMs,
    item?.media_progress?.currentTime,
    item?.media_progress?.currentTimeMs,
    item?.progress?.currentTime,
    item?.progress?.currentTimeMs,
  ];
  for (const v of cands) if (typeof v === "number" && isFinite(v) && v > 0) return v;
  return null;
}

/* ---------------- DOM helpers ---------------- */
function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

function show(node: HTMLElement, on: boolean) { node.style.display = on ? "" : "none"; }

function setMsg(id: string, text: string, type: "ok" | "error" | "none" = "none") {
  const m = el<HTMLDivElement>(id);
  m.textContent = text;
  m.className = "msg" + (type === "none" ? "" : ` ${type}`);
}

function escapeHtml(s: string) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]!));
}

/* ---------------- Storage ---------------- */
function normalizeUrl(raw: string) { return raw.trim().replace(/\/+$/, ""); }

function getSaved() {
  return {
    serverUrl: localStorage.getItem("serverUrl") ?? "",
    username: localStorage.getItem("username") ?? "",
  };
}

/* ---------------- Backend ---------------- */
async function isLoggedIn(serverUrl: string, username: string) {
  return invoke<boolean>("abs_is_logged_in", { serverUrl, username });
}

async function signIn(serverUrl: string, username: string, password: string) {
  await invoke("abs_login_and_store", { serverUrl, username, password });
  await invoke("abs_set_active_user", { serverUrl, username });
  localStorage.setItem("serverUrl", serverUrl);
  localStorage.setItem("username", username);
}

async function logOut(serverUrl: string, username: string) {
  await invoke("abs_logout", { serverUrl, username });
}

/* ---------------- Click handling ---------------- */
document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement | null;
  if (!t) return;
  const btn = t.closest("button") as HTMLButtonElement | null;
  const id = btn?.id ?? t.id;
  try {
    if (id === "loginBtn") await handleLogin();
    if (id === "logoutBtn") await handleLogout();
    if (id === "refreshBtn") await loadHome();
    if (id === "backBtn") backFromDetail();
    if (id === "resumeBtn" && currentItemId)
      await playChapter(currentItemId, currentChapterIndex);
  } catch (err: any) {
    setMsg("homeMsg", String(err?.message ?? err), "error");
  }
});

/* ---------------- Login / Logout ---------------- */
async function handleLogin() {
  setMsg("loginMsg", "", "none");
  const serverUrl = normalizeUrl(el<HTMLInputElement>("server").value);
  const username = el<HTMLInputElement>("username").value.trim();
  const password = el<HTMLInputElement>("password").value;
  if (!serverUrl) return setMsg("loginMsg", "Missing server address", "error");
  if (!username) return setMsg("loginMsg", "Missing username", "error");
  if (!password) return setMsg("loginMsg", "Missing password", "error");

  await signIn(serverUrl, username, password);
  el<HTMLInputElement>("password").value = "";

  show(el("loginView"), false);
  show(el("homeView"), true);
  await loadHome();
}

async function handleLogout() {
  const { serverUrl, username } = getSaved();
  await logOut(serverUrl, username);
  show(el("homeView"), false);
  show(el("loginView"), true);
  setMsg("loginMsg", "Logged out", "ok");
}

/* ---------------- Navigation ---------------- */
function backFromDetail() {
  setContinueVisible(true);
  show(el("itemDetailView"), false);
  show(el("libraryItemsView"), true);
  currentItemId = null;
}

function setContinueVisible(showIt: boolean) {
  const section = document.getElementById("continueSection");
  if (section) section.style.display = showIt ? "" : "none";
}

/* ---------------- Progress helpers ---------------- */
function extractInProgressArray(inProgress: any): any[] {
  if (!inProgress) return [];
  if (Array.isArray(inProgress.libraryItems)) return inProgress.libraryItems;
  if (Array.isArray(inProgress.items)) return inProgress.items;
  if (Array.isArray(inProgress.results)) return inProgress.results;
  return [];
}

function getItemId(p: any): string | null {
  const id = p?.libraryItemId ?? p?.library_item_id ?? p?.itemId ?? p?.id ?? null;
  return id ? String(id) : null;
}

/* ---------------- Home ---------------- */
async function loadHome() {
  const { serverUrl, username } = getSaved();
  setMsg("homeMsg", "", "none");

  const me = await invoke<Json>("abs_get_me", { serverUrl, username });
  const inProgress = await invoke<any>("abs_get_items_in_progress", { serverUrl, username });
  const libraries = await invoke<Json>("abs_get_libraries", { serverUrl, username });
  lastInProgress = inProgress;

  el("whoami").textContent = `Signed in as ${me?.username ?? username}`;

  progressByItemId.clear();
  renderLibraries(libraries);

  // Render continue listening med filter per bibliotek
  await renderContinueListening(lastInProgress);
}

/* ---------------- Libraries ---------------- */
function renderLibraries(libraries: any) {
  const libsArr: any[] = Array.isArray(libraries) ? libraries : (libraries?.libraries ?? []);
  const select = el<HTMLSelectElement>("librarySelect");
  select.innerHTML = "";

  for (const l of libsArr) {
    const opt = document.createElement("option");
    opt.value = String(l.id);
    opt.textContent = l?.name ?? l?.id ?? "Library";
    select.appendChild(opt);
  }

  if (!currentLibraryId && libsArr.length) currentLibraryId = String(libsArr[0].id);
  if (currentLibraryId) select.value = currentLibraryId;

  select.onchange = async () => {
    const { serverUrl, username } = getSaved();
    currentLibraryId = select.value;
    setMsg("homeMsg", "Loading library…", "none");

    const items = await invoke<any>("abs_get_library_items", {
      serverUrl, username, libraryId: currentLibraryId
    });

    const selected = libsArr.find((x) => String(x.id) === currentLibraryId);
    showLibraryItems(selected?.name ?? "Library", items);

    // Uppdatera continue-lista med filtrering per bibliotek
    await renderContinueListening(lastInProgress);
  };

  if (libsArr.length) select.dispatchEvent(new Event("change"));
}

function getCurrentTimeForProgress(item: any, inProgressObj: any): number {
  const duration = sumDurationsFromItem(item);

  // 1) Kolla item.userMediaProgress
  if (item?.userMediaProgress?.currentTime && item.userMediaProgress.currentTime > 0)
    return normalizeSecondsMaybe(item.userMediaProgress.currentTime, duration);
  if (item?.userMediaProgress?.currentTimeMs && item.userMediaProgress.currentTimeMs > 0)
    return normalizeSecondsMaybe(item.userMediaProgress.currentTimeMs / 1000, duration);

  // 2) Kolla item.mediaProgress
  if (item?.mediaProgress?.currentTime && item.mediaProgress.currentTime > 0)
    return normalizeSecondsMaybe(item.mediaProgress.currentTime, duration);
  if (item?.mediaProgress?.currentTimeMs && item.mediaProgress.currentTimeMs > 0)
    return normalizeSecondsMaybe(item.mediaProgress.currentTimeMs / 1000, duration);

  // 3) Kolla item.progress
  if (item?.progress?.currentTime && item.progress.currentTime > 0)
    return normalizeSecondsMaybe(item.progress.currentTime, duration);
  if (item?.progress?.currentTimeMs && item.progress.currentTimeMs > 0)
    return normalizeSecondsMaybe(item.progress.currentTimeMs / 1000, duration);

  // 4) fallback: kolla inProgress-objektet
  if (inProgressObj?.currentTime && inProgressObj.currentTime > 0)
    return normalizeSecondsMaybe(inProgressObj.currentTime, duration);
  if (inProgressObj?.currentTimeMs && inProgressObj.currentTimeMs > 0)
    return normalizeSecondsMaybe(inProgressObj.currentTimeMs / 1000, duration);

  // 5) Om allt misslyckas, returnera 0
  return 0;
}

/* ---------------- Continue Listening ---------------- */
// ---------------- Global map för intervall ----------------
const intervalByItemId = new Map<string, number>();

async function renderContinueListening(inProgress: any) {
  const listEl = el("continueList");
  const emptyEl = el("continueEmpty");
  listEl.innerHTML = "";

  // Rensa alla gamla intervall
  intervalByItemId.forEach(id => clearInterval(id));
  intervalByItemId.clear();

  if (!currentLibraryItemIds.size) return;

  const allProgress = extractInProgressArray(inProgress);
  const filteredProgress = allProgress.filter(p => {
    const id = getItemId(p);
    return id ? currentLibraryItemIds.has(id) : false;
  });

  if (!filteredProgress.length) {
    if (emptyEl) emptyEl.style.display = "";
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  const { serverUrl, username } = getSaved();

  for (const p of filteredProgress.slice(0, 10)) {
    const itemId = getItemId(p);
    if (!itemId) continue;

    const card = document.createElement("div");
    card.className = "book-card continue-card";
    card.dataset.itemId = itemId;

    const img = document.createElement("img");
    img.className = "book-cover"; img.loading = "lazy"; img.alt = "Cover";
    try { img.src = await invoke<string>("abs_get_cover_url", { serverUrl, username, itemId }); } catch {}

    const meta = document.createElement("div");
    meta.className = "book-meta";
    meta.innerHTML = `<p class="book-title"></p><p class="book-sub"></p>`;

    let title = p?.title ?? itemId;
    let author = p?.author ?? "";

    try {
      const item = await invoke<any>("abs_get_item", { serverUrl, username, itemId });
      title = item?.media?.metadata?.title ?? title;
      author = item?.media?.metadata?.authorName ?? author;
    } catch {}

    (meta.firstChild as HTMLElement).textContent = title;
    (meta.lastChild as HTMLElement).textContent = author;

    const barWrap = document.createElement("div");
    barWrap.className = "progress-wrap";
    const bar = document.createElement("div");
    bar.className = "progress-bar";
    barWrap.appendChild(bar);

    card.append(img, meta, barWrap);
    listEl.appendChild(card);

    // Progress init
    (async () => {
      try {
        const item = await invoke<any>("abs_get_item", { serverUrl, username, itemId });
        const duration = sumDurationsFromItem(item);
        let currentTime = getCurrentTimeForProgress(item, p);
        progressByItemId.set(itemId, { currentTime });

        let pct = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;
        if (pct > 0 && pct < 5) pct = 5;
        bar.style.width = `${pct}%`;
        console.log(`Continue: "${title}" currentTime=${currentTime}s duration=${duration}s pct=${pct}%`);

        // Realtidsuppdatering via setInterval
        const audio = el<HTMLAudioElement>("player");
        const intervalId = setInterval(() => {
          if (audio.src && !audio.paused && currentItemId === itemId) {
            const cur = audio.currentTime;
            progressByItemId.set(itemId, { currentTime: cur });
            let pct = duration > 0 ? Math.round((cur / duration) * 100) : 0;
            if (pct > 0 && pct < 5) pct = 5;
            bar.style.width = `${pct}%`;
          }
        }, 500);

        intervalByItemId.set(itemId, intervalId);

      } catch (err) {
        bar.style.width = "0%";
        console.error("Progressbar error:", err);
      }
    })();

    card.onclick = async () => {
      await showItemDetail(itemId);
      await playChapter(itemId, 0);
    };
  }
}

/* ---------------- Library grid ---------------- */
function showLibraryItems(name: string, items: any) {
  currentLibraryItems = items?.items ?? items?.results ?? items ?? [];
  currentLibraryItemIds = new Set(currentLibraryItems.map((x: any) => String(x?.id)).filter(Boolean));
  setMsg("homeMsg", `Library: ${name}`, "ok");
  void renderLibraryGrid();
}

function wireSortSelect() {
  const sortSelect = el<HTMLSelectElement>("sortSelect");
  sortSelect.addEventListener("change", () => { if (currentLibraryItems.length) void renderLibraryGrid(); });
}

async function renderLibraryGrid() {
  const container = el("libraryItemsView");
  container.innerHTML = "";
  container.classList.add("grid");

  const sort = (el<HTMLSelectElement>("sortSelect")?.value ?? "recent");

  const list = currentLibraryItems.slice();
  if (sort === "az") list.sort((a,b) => (a?.media?.metadata?.title ?? "").localeCompare(b?.media?.metadata?.title ?? "", "sv", { sensitivity: "base" }));
  if (sort === "za") list.sort((a,b) => (b?.media?.metadata?.title ?? "").localeCompare(a?.media?.metadata?.title ?? "", "sv", { sensitivity: "base" }));

  const { serverUrl, username } = getSaved();

  for (const it of list) {
    const itemId = it?.id;
    if (!itemId) continue;

    const title = it?.media?.metadata?.title ?? "Item";
    const author = it?.media?.metadata?.authorName ?? "";

    const card = document.createElement("div");
    card.className = "book-card";

    const img = document.createElement("img");
    img.className = "book-cover"; img.loading = "lazy"; img.alt = title;
    try { img.src = await invoke<string>("abs_get_cover_url", { serverUrl, username, itemId }); } catch {}

    const meta = document.createElement("div");
    meta.className = "book-meta";
    meta.innerHTML = `<p class="book-title"></p><p class="book-sub"></p>`;
    (meta.firstChild as HTMLElement).textContent = title;
    (meta.lastChild as HTMLElement).textContent = author;

    card.append(img, meta);
    card.onclick = () => showItemDetail(String(itemId));
    container.appendChild(card);
  }
}

/* ---------------- Detail / audio ---------------- */
async function showItemDetail(itemId: string) {
  setContinueVisible(false);
  const { serverUrl, username } = getSaved();
  currentItemId = itemId;

  show(el("libraryItemsView"), false);
  show(el("itemDetailView"), true);

  const item = await invoke<any>("abs_get_item", { serverUrl, username, itemId });
  const title = item?.media?.metadata?.title ?? "Item";
  const author = item?.media?.metadata?.authorName ?? "";
  const desc = item?.media?.metadata?.description ?? "";

  let coverUrl = "";
  try { coverUrl = await invoke<string>("abs_get_cover_url", { serverUrl, username, itemId }); } catch {}

  const startAt = progressByItemId.get(itemId)?.currentTime ?? 0;
  const playLabel = startAt > 0 ? "▶ Resume" : "▶ Play";

  const detail = el<HTMLDivElement>("itemDetailView");
  detail.innerHTML = `
  <div class="card">
  <button id="backBtn">← Back</button>
  <button id="resumeBtn">${playLabel}</button>
  <div id="detailHeader" style="display:flex; gap:14px; margin-top:10px; align-items:flex-start;">
  <div style="min-width:0;">
  <div style="font-weight:800;">${escapeHtml(title)}</div>
  <div style="opacity:.8;">${escapeHtml(author)}</div>
  </div>
  </div>
  <div style="margin-top:12px;">${escapeHtml(desc)}</div>

  <!-- Ny detaljvy progressbar -->
  <div class="progress-wrap" style="margin-top:10px;">
  <div id="itemDetailProgressBar" class="progress-bar"></div>
  </div>
  </div>
  `;

  if (coverUrl) {
    const header = el("detailHeader");
    if (header) {
      const img = document.createElement("img");
      img.src = coverUrl;
      img.alt = title;
      img.loading = "lazy";
      img.style.width = "140px";
      img.style.borderRadius = "12px";
      img.style.background = "rgba(127,127,127,.15)";
      img.onerror = () => img.remove();
      header.insertBefore(img, header.firstChild);
    }
  }
  // ===== TRACKLIST =====
  let files =
  item?.media?.audioFiles ||
  item?.media?.tracks ||
  item?.media?.audioTracks ||
  [];

  if (!Array.isArray(files)) files = [];

  files = files
  .slice()
  .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0));

  currentFiles = files;
  currentChapterIndex = 0;

  function fmt(sec: number) {
    sec = Math.floor(sec || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
    return `${m}:${s.toString().padStart(2,"0")}`;
  }

  const list = document.createElement("div");
  list.style.marginTop = "18px";

  const chapters =
  item?.media?.chapters ||
  item?.media?.metadata?.chapters ||
  [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];

    let chapterStart = chapters[i]?.start ?? 0;

    if (chapters[i]?.startTime !== undefined) {
      chapterStart = chapters[i].startTime;
    } else if (chapters[i]?.start !== undefined) {
      chapterStart = chapters[i].start;
    } else {
      chapterStart = 0;
    }

    console.log("CHAPTERS", chapters);
    console.log("FILES", files);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.padding = "6px 0";
    row.style.borderBottom = "1px solid rgba(255,255,255,.05)";

    const left = document.createElement("div");
    left.textContent = f?.metadata?.title || `Track ${i + 1}`;

    const right = document.createElement("div");
    right.style.opacity = "0.7";
    right.textContent = fmt(f?.duration);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
    row.style.cursor = "pointer";

    row.onclick = async () => {
      await playChapter(itemId, i);
    };
  }

  detail.querySelector(".card")?.appendChild(list);
  // ===== END TRACKLIST =====
}

function getChapterStart(index: number) {

  const f = currentFiles[index];

  if (!f) return null;

  if (typeof f.startOffset === "number") return f.startOffset;
  if (typeof f.start === "number") return f.start;
  if (typeof f.startTime === "number") return f.startTime;

  // fallback = summera tidigare filer
  let sum = 0;

  for (let i = 0; i < index; i++) {
    sum += currentFiles[i]?.duration || 0;
  }

  return sum;
}

async function playChapter(itemId: string, index: number) {

  if (isLoadingChapter) return;
  isLoadingChapter = true;

  try {

    const { serverUrl, username } = getSaved();
    await invoke("abs_set_active_user", { serverUrl, username });

    currentChapterIndex = index;
    currentItemId = itemId;

    const audio = el<HTMLAudioElement>("player");
    audio.style.display = "";

    const f = currentFiles[index];
    if (!f) return;

    const fileIno = currentFiles[index].ino;

    const url = await invoke("abs_local_player_url", {
      libraryId: itemId,
      index: fileIno
    });

    console.log("AUDIO URL =", url);

    audio.pause();
    audio.src = url;

    audio.onended = async () => {
      const next = index + 1;
      if (next < currentFiles.length) {
        await playChapter(itemId, next);
      }
    };

    await audio.play();

  } finally {
    isLoadingChapter = false;
  }
}

/*
async function playCurrentChapter(itemId: string) {

  const { serverUrl, username } = getSaved();
  await invoke("abs_set_active_user", { serverUrl, username });

  const audio = el<HTMLAudioElement>("player");

  const f = currentFiles[currentChapterIndex];
  if (!f) return;

  const url = await invoke<string>("abs_local_file_player_url", {
    libraryItemId: itemId,
    index: currentChapterIndex
  });

  console.log("CHAPTER URL:", url);

  audio.pause();
  audio.src = url;
  audio.currentTime = 0;
  audio.style.display = "";

  audio.onended = async () => {
    currentChapterIndex++;
    if (currentChapterIndex < currentFiles.length) {
      await playCurrentChapter(itemId);
    }
  };

  await audio.play();

}
*/


/* ---------------- Boot ---------------- */
async function boot() {
  wireSortSelect();
  const saved = getSaved();
  if (saved.serverUrl && saved.username) {
    const ok = await isLoggedIn(saved.serverUrl, saved.username);
    if (ok) {
      await invoke("abs_set_active_user", saved);
      show(el("loginView"), false);
      show(el("homeView"), true);
      await loadHome();
      return;
    }
  }
  show(el("loginView"), true);
  show(el("homeView"), false);
}

boot();
