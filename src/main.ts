import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Json = any;

let isLoadingChapter = false;
let currentItemId: string | null = null;
let currentFiles: any[] = [];
let currentChapterRows: HTMLElement[] = [];
let currentChapterIndex = 0;
let currentLibraryId: string | null = null;
let lastInProgress: any = null;
let forcedSeekTime: number | null = null;
let lastSessionSync = 0
let lastProgressSave = 0
let currentSessionId: string | null = null
const progressByItemId = new Map<string, { currentTime: number; progress?: number }>();
let currentLibraryItemIds = new Set<string>();
let currentLibraryItems: any[] = [];
let miniTicker: any = null

const preloadAudio = new Audio()
preloadAudio.preload = "auto"


function startMiniTicker(){

  if (miniTicker) return

    const audio = el<HTMLAudioElement>("player")

    miniTicker = setInterval(() => {

      if (!currentItemId) return
        if (audio.paused) return

          const miniBar = el("miniProgressBar")
          const curLbl = el("miniCurrent")
          const totLbl = el("miniTotal")

          // Check if this is a podcast (episodes have audioFile property) or audiobook
          const isPodcast = currentFiles[0]?.audioFile !== undefined;
          
          let total: number;
          let absolute: number;
          
          if (isPodcast) {
            // For podcasts: show only current episode duration
            const currentFile = currentFiles[currentChapterIndex];
            total = currentFile?.audioFile?.duration || 0;
            if (total === 0 && audio.duration) total = audio.duration;
            absolute = audio.currentTime;
          } else {
            // For audiobooks: show total duration across all chapters
            total = sumDurationsFromItem({ media: { audioFiles: currentFiles } });
            absolute = audio.currentTime + getChapterStart(currentChapterIndex);
          }

          const pct =
          total > 0 ? absolute / total * 100 : 0

          miniBar.style.width = pct + "%"

          curLbl.textContent = fmtTime(absolute)
          totLbl.textContent = fmtTime(total)

    }, 500)

}

function getPlaybackTotals(audio: HTMLAudioElement) {
  const isPodcast = currentFiles[0]?.audioFile !== undefined;

  let total = 0;
  let absolute = 0;

  if (isPodcast) {
    const currentFile = currentFiles[currentChapterIndex];
    total = currentFile?.audioFile?.duration || 0;
    if (total === 0 && audio.duration && isFinite(audio.duration)) total = audio.duration;
    absolute = audio.currentTime;
  } else {
    total = sumDurationsFromItem({ media: { audioFiles: currentFiles } });
    absolute = audio.currentTime + (getChapterStart(currentChapterIndex) || 0);
  }

  return { total, absolute };
}

function setPlaybackButtons(isPlaying: boolean) {
  const icon = isPlaying ? "⏸" : "▶";
  const miniBtn = document.getElementById("miniPlayPause");
  const npBtn = document.getElementById("npPlayPause");
  if (miniBtn) miniBtn.textContent = icon;
  if (npBtn) npBtn.textContent = icon;
}

function syncNowPlayingProgress(audio: HTMLAudioElement) {
  const seek = document.getElementById("npSeek") as HTMLInputElement | null;
  const cur = document.getElementById("npCurrent");
  const tot = document.getElementById("npTotal");
  if (!seek) return;

  const { total, absolute } = getPlaybackTotals(audio);
  const pct = total > 0 ? (absolute / total) * 100 : 0;

  seek.value = String(Math.max(0, Math.min(100, pct)));
  if (cur) cur.textContent = fmtTime(absolute);
  if (tot) tot.textContent = fmtTime(total);
}
/* ---------------- Duration helpers ---------------- */
function formatTotalDuration(sec: number) {

  sec = Math.floor(sec || 0)

  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)

  if (h > 0) return `${h}h ${m}m`
    return `${m}m`
}

function highlightChapter(index: number) {

  currentChapterRows.forEach((row, i) => {

    if (i === index) {

      row.style.background =
      "rgba(255,255,255,0.08)"

      row.style.borderRadius = "8px"

    } else {

      row.style.background = "transparent"

    }

  })
}

function fmtTime(sec:number){

  sec = Math.floor(sec || 0)

  const h = Math.floor(sec/3600)
  const m = Math.floor((sec%3600)/60)
  const s = sec%60

  if(h>0)
    return `${h}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`

    return `${m}:${s.toString().padStart(2,"0")}`
}

function sumDurationsFromItem(item: any): number {
  const af = item?.media?.audioFiles;
  if (Array.isArray(af) && af.length) {
    const sum = af.reduce((s: number, f: any) => s + (typeof f?.duration === "number" ? f.duration : 0), 0);
    if (sum > 0) return sum;
  }
  const ep = item?.media?.episodes;
  if (Array.isArray(ep) && ep.length) {
    const sum = ep.reduce((s: number, e: any) => s + (typeof e?.audioFile?.duration === "number" ? e.audioFile.duration : 0), 0);
    if (sum > 0) return sum;
  }
  const ec = item?.media?.episodeContent;
  if (Array.isArray(ec) && ec.length) {
    const sum = ec.reduce((s: number, e: any) => s + (typeof e?.duration === "number" ? e.duration : 0), 0);
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


function normalizeSecondsMaybe(value: number, durationSeconds?: number): number {
  if (durationSeconds && value > durationSeconds * 5) return value / 1000;
  if (value > 100_000) return value / 1000;
  return value;
}


/* ---------------- DOM helpers ---------------- */
function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

function show(node: HTMLElement, on: boolean) { node.style.display = on ? "" : "none"; }
function showMiniPlayer(title:string, author:string, cover:string){

  el("miniPlayer").style.display = ""

  el("miniTitle").textContent = title
  el("miniAuthor").textContent = author

  const npTitle = document.getElementById("npTitle")
  const npAuthor = document.getElementById("npAuthor")
  if (npTitle) npTitle.textContent = title
  if (npAuthor) npAuthor.textContent = author

  const img = el<HTMLImageElement>("miniCover")
  img.src = cover

  const npImg = document.getElementById("npCover") as HTMLImageElement | null
  if (npImg) npImg.src = cover
}

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

function isValidServerUrl(raw: string) {
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.host);
  } catch {
    return false;
  }
}

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
  const clickable = t.closest("[id]") as HTMLElement | null;
  const id = clickable?.id;
  try {
    if (id === "loginBtn") await handleLogin();
    if (id === "logoutBtn") await handleLogout();
    if (id === "backBtn") backFromDetail();
    if (id === "winMinBtn") {
      try { await getCurrentWindow().minimize(); } catch (e) { console.log("win min fail", e) }
    }
    if (id === "winMaxBtn") {
      try {
        const w = getCurrentWindow();
        if (await w.isMaximized()) await w.unmaximize();
        else await w.maximize();
      } catch (e) { console.log("win max fail", e) }
    }
    if (id === "winCloseBtn") {
      try { await getCurrentWindow().close(); } catch (e) { console.log("win close fail", e) }
    }
    if (id === "resumeBtn" && currentItemId) {

      const progress = progressByItemId.get(currentItemId)
      const serverTime = progress?.currentTime || 0

      // säkerställ att filer finns
      if (!currentFiles.length) {
        await showItemDetail(currentItemId)
      }

      const pos = getChapterIndexFromTime(serverTime)

      forcedSeekTime = pos.offset

        await playChapter(currentItemId, pos.index)
    }

    if (id === "openNowPlaying") {
      show(el("nowPlayingView"), true)
      const audio = el<HTMLAudioElement>("player")
      syncNowPlayingProgress(audio)
      setPlaybackButtons(!audio.paused)
    }



    if (id === "miniPlayer") {
      show(el("nowPlayingView"), true);
      const audio = el<HTMLAudioElement>("player")
      syncNowPlayingProgress(audio)
      setPlaybackButtons(!audio.paused)
    }

    if (id === "miniPlayPause") {

      const audio = el<HTMLAudioElement>("player")

      if (audio.paused) {
        audio.play()
        setPlaybackButtons(true)
      } else {
        audio.pause()
        setPlaybackButtons(false)
      }
    }

    if (id === "npPlayPause") {
      const audio = el<HTMLAudioElement>("player")
      if (audio.paused) {
        audio.play()
        setPlaybackButtons(true)
      } else {
        audio.pause()
        setPlaybackButtons(false)
      }
    }

    if (id === "npForward") {
      const audio = el<HTMLAudioElement>("player")
      audio.currentTime = Math.min((audio.duration || Infinity), audio.currentTime + 15)
      syncNowPlayingProgress(audio)
    }

    if (id === "npBack") {
      const audio = el<HTMLAudioElement>("player")
      audio.currentTime = Math.max(0, audio.currentTime - 15)
      syncNowPlayingProgress(audio)
    }

    if (id === "npNextChapter" && currentItemId) {
      const next = currentChapterIndex + 1
      if (next < currentFiles.length) {
        await playChapter(currentItemId, next)
      }
    }

    if (id === "miniNextChapter" && currentItemId) {

      const next = currentChapterIndex + 1

      if (next < currentFiles.length) {
        playChapter(currentItemId, next)
      }
    }

    if (id === "miniPrevChapter" && currentItemId) {

      const audio = el<HTMLAudioElement>("player")

      // ⭐ om man är mitt i kapitel → hoppa till start
      if (audio.currentTime > 5) {
        audio.currentTime = 0
        return
      }

      const prev = currentChapterIndex - 1

      if (prev >= 0) {
        playChapter(currentItemId, prev)
      }
    }

    if (id === "closeNowPlaying") {
      show(el("nowPlayingView"), false)
    }




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
  if (!isValidServerUrl(serverUrl)) return setMsg("loginMsg", "Server must be a valid http:// or https:// URL", "error");
  if (!username) return setMsg("loginMsg", "Missing username", "error");
  if (!password) return setMsg("loginMsg", "Missing password", "error");

  await signIn(serverUrl, username, password);
  el<HTMLInputElement>("password").value = "";

  show(el("loginView"), false);
  show(el("homeView"), true);
  show(el("miniPlayer"), true);
  await loadHome();
}

async function handleLogout() {
  const { serverUrl, username } = getSaved();
  await logOut(serverUrl, username);
  show(el("homeView"), false);
  show(el("miniPlayer"), false);
  show(el("loginView"), true);
  setMsg("loginMsg", "Logged out", "ok");
}

/* ---------------- Navigation ---------------- */
async function backFromDetail() {

  // Show library immediately — don't block on network calls
  setContinueVisible(true);
  show(el("itemDetailView"), false);
  show(el("libraryItemsView"), true);

  // Save progress + stop session in the background
  forceSaveProgress().catch(() => {});
  stopPlaybackSession().catch(() => {});
}

function setContinueVisible(showIt: boolean) {
  const section = document.getElementById("continueSection");
  if (section) section.style.display = showIt ? "" : "none";
}

/* ---------------- Progress helpers ---------------- */
function extractInProgressArray(inProgress: any): any[] {
  if (!inProgress) return [];

  if (Array.isArray(inProgress))
    return inProgress

  if (Array.isArray(inProgress.sessions))
    return inProgress.sessions

  if (Array.isArray(inProgress.results))
    return inProgress.results

    if (Array.isArray(inProgress.libraryItems))
      return inProgress.libraryItems

      if (Array.isArray(inProgress.items))
        return inProgress.items

        return []
}

function getItemId(p: any): string | null {
  const id =
    p?.libraryItemId ??
    p?.library_item_id ??
    p?.libraryItem?.id ??
    p?.itemId ??
    p?.id ??
    p?.media?.libraryItemId ??
    null;
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

  // Render continue listening med filter per bibliotek
  await renderLibraries(libraries);
  // await renderContinueListening(lastInProgress);
}

/* ---------------- Libraries ---------------- */
async function renderLibraries(libraries: any) {
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
    const grid = el("libraryItemsView");
    grid.classList.add("loading");
    currentLibraryId = select.value;
    setMsg("homeMsg", "Loading library…", "none");

    try {
      const items = await invoke<any>("abs_get_library_items", {
        serverUrl, username, libraryId: currentLibraryId
      });

      const selected = libsArr.find((x) => String(x.id) === currentLibraryId);
      showLibraryItems(selected?.name ?? "Library", items);

      // Uppdatera continue-lista med filtrering per bibliotek
      await renderContinueListening(lastInProgress);
    } finally {
      grid.classList.remove("loading");
    }
  };

  if (libsArr.length) {
    await select.onchange?.(new Event("change") as any)
  }
}

function getCurrentTimeForProgress(
  item: any,
  inProgressObj: any,
  duration?: number
): number {

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

  // 4b) extra fallback shapes used by items-in-progress payloads
  if (inProgressObj?.userMediaProgress?.currentTime && inProgressObj.userMediaProgress.currentTime > 0)
    return normalizeSecondsMaybe(inProgressObj.userMediaProgress.currentTime, duration);
  if (inProgressObj?.userMediaProgress?.currentTimeMs && inProgressObj.userMediaProgress.currentTimeMs > 0)
    return normalizeSecondsMaybe(inProgressObj.userMediaProgress.currentTimeMs / 1000, duration);

  if (inProgressObj?.mediaProgress?.currentTime && inProgressObj.mediaProgress.currentTime > 0)
    return normalizeSecondsMaybe(inProgressObj.mediaProgress.currentTime, duration);
  if (inProgressObj?.mediaProgress?.currentTimeMs && inProgressObj.mediaProgress.currentTimeMs > 0)
    return normalizeSecondsMaybe(inProgressObj.mediaProgress.currentTimeMs / 1000, duration);

  if (inProgressObj?.progress?.currentTime && inProgressObj.progress.currentTime > 0)
    return normalizeSecondsMaybe(inProgressObj.progress.currentTime, duration);
  if (inProgressObj?.progress?.currentTimeMs && inProgressObj.progress.currentTimeMs > 0)
    return normalizeSecondsMaybe(inProgressObj.progress.currentTimeMs / 1000, duration);

  // 5) Om allt misslyckas, returnera 0
  return 0;
}

function getBestProgressFraction(itemObj: any, inProgressObj: any): number {
  const candidates = [
    inProgressObj?.progress,
    inProgressObj?.progress?.progress,
    inProgressObj?.mediaProgress?.progress,
    inProgressObj?.userMediaProgress?.progress,
    inProgressObj?.progressPercentage,
    inProgressObj?.progressPercent,
    inProgressObj?.percentage,
    itemObj?.progress,
    itemObj?.progress?.progress,
    itemObj?.mediaProgress?.progress,
    itemObj?.userMediaProgress?.progress
  ];

  for (const value of candidates) {
    if (typeof value !== "number") continue;
    if (!isFinite(value)) continue;
    if (value <= 0) continue;
    if (value > 1) return Math.min(1, value / 100);
    return Math.min(1, value);
  }

  return 0;
}

function getBestProgressPercentFromInProgress(inProgressObj: any): number {
  const fraction = getBestProgressFraction(null, inProgressObj);
  if (fraction > 0) return Math.min(100, Math.max(0, fraction * 100));

  const durationCandidates = [
    inProgressObj?.duration,
    inProgressObj?.durationSeconds,
    inProgressObj?.media?.duration,
    inProgressObj?.media?.durationSeconds,
  ];

  const timeCandidates = [
    inProgressObj?.currentTime,
    inProgressObj?.currentTimeMs,
    inProgressObj?.timeListening,
    inProgressObj?.mediaProgress?.currentTime,
    inProgressObj?.mediaProgress?.currentTimeMs,
    inProgressObj?.userMediaProgress?.currentTime,
    inProgressObj?.userMediaProgress?.currentTimeMs,
  ];

  let duration = 0;
  for (const d of durationCandidates) {
    if (typeof d === "number" && isFinite(d) && d > 0) {
      duration = normalizeSecondsMaybe(d);
      break;
    }
  }

  let current = 0;
  for (const t of timeCandidates) {
    if (typeof t === "number" && isFinite(t) && t > 0) {
      current = normalizeSecondsMaybe(t, duration || undefined);
      break;
    }
  }

  if (duration > 0 && current > 0) {
    return Math.min(100, Math.max(0, (current / duration) * 100));
  }

  return 0;
}

/* ---------------- Continue Listening ---------------- */
// ---------------- Global map för intervall ----------------
const intervalByItemId = new Map<string, number>();

async function renderContinueListening(inProgress: any) {


  const listEl = el("continueList");
  const emptyEl = el("continueEmpty");
  listEl.innerHTML = "";
  emptyEl.style.display = "none";

  intervalByItemId.forEach(id => clearInterval(id));
  intervalByItemId.clear();

  if (!currentLibraryItemIds.size) {

    return
  }

  let allProgress: any[] = [];

  if (Array.isArray(inProgress)) allProgress = inProgress;
  else if (inProgress?.sessions) allProgress = inProgress.sessions;
  else allProgress = extractInProgressArray(inProgress) || [];

  const filteredProgress: any[] = [];
  const byItemId = new Map<string, any>();

  for (const p of allProgress) {
    const id = getItemId(p);
    if (!id) continue;

    // Always scope by the currently loaded library items in this app.
    if (!currentLibraryItemIds.has(id)) continue;

    const currentTime = getCurrentTimeForProgress(null, p);

    const prev = byItemId.get(id);
    if (!prev) {
      byItemId.set(id, p);
      continue;
    }

    const prevTime = getCurrentTimeForProgress(null, prev);
    if (currentTime >= prevTime) byItemId.set(id, p);
  }

  for (const v of byItemId.values()) filteredProgress.push(v);

  if (!filteredProgress.length) {
    emptyEl.style.display = "";
    return;
  }

  emptyEl.style.display = "none";

  const { serverUrl, username } = getSaved();

  for (const p of filteredProgress) {

    const itemId = getItemId(p);
    if (!itemId) continue;

    const card = document.createElement("div");
    card.className = "book-card continue-card";
    listEl.appendChild(card);

    card.innerHTML = `
    <div class="cover-wrap">
    <img class="book-cover" loading="lazy">
    <div class="progress-wrap">
    <div class="progress-bar"></div>
    </div>
    </div>

    <div class="book-meta">
    <p class="book-title"></p>
    <p class="book-sub"></p>
    <button class="continue-mark-played" type="button">Mark as played</button>
    </div>
    `;

    const img = card.querySelector(".book-cover") as HTMLImageElement;
    const bar = card.querySelector(".progress-bar") as HTMLDivElement;
    // Initial visual progress from in-progress payload when available.
    const initialPct = getBestProgressPercentFromInProgress(p);
    if (initialPct > 0) {
      bar.style.width = Math.max(Math.round(initialPct), 5) + "%";
    } else {
      bar.style.width = "3%";
    }

    const titleEl = card.querySelector(".book-title") as HTMLElement;
    const authorEl = card.querySelector(".book-sub") as HTMLElement;
    const markPlayedBtn = card.querySelector(".continue-mark-played") as HTMLButtonElement;

    let title = p?.title ?? itemId;
    let author = p?.author ?? "";

    try {
      const item = await invoke<any>("abs_get_item", { serverUrl, username, itemId });
      title = item?.media?.metadata?.title ?? title;
      author = item?.media?.metadata?.authorName ?? author;
    } catch {}

    titleEl.textContent = title;
    authorEl.textContent = author;

    try {
      img.src = await invoke<string>("abs_get_cover_url", { serverUrl, username, itemId });
    } catch {}

    // progress init
    (async () => {
      try {
        const [item, progressObj] = await Promise.all([
          invoke<any>("abs_get_item", { serverUrl, username, itemId }),
          invoke<any>("abs_get_progress", { serverUrl, username, itemId }).catch(() => null),
        ]);
        let duration = sumDurationsFromItem(item);

        if (!duration || duration < 60) {
          duration = item?.media?.duration ||
          item?.media?.metadata?.duration ||
          item?.media?.durationSeconds ||
          3600
        }

        duration = normalizeSecondsMaybe(duration);

        // progressObj from /api/me/progress/{id} has currentTime directly
        let currentTime = 0;
        if (progressObj?.currentTime && progressObj.currentTime > 0) {
          currentTime = normalizeSecondsMaybe(progressObj.currentTime, duration);
        } else {
          currentTime = getCurrentTimeForProgress(item, p, duration);
        }

        progressByItemId.set(itemId, { currentTime });

        let pct = duration > 0 ? (currentTime / duration) * 100 : 0;

        // Use direct progress fraction from /api/me/progress first
        if (progressObj?.progress && progressObj.progress > 0) {
          const frac = progressObj.progress > 1 ? progressObj.progress / 100 : progressObj.progress;
          pct = Math.max(pct, frac * 100);
          if (currentTime <= 0) currentTime = duration * frac;
        }

        const fraction = getBestProgressFraction(item, p);
        if (fraction > 0) {
          pct = Math.max(pct, fraction * 100);
          if (currentTime <= 0) currentTime = duration * fraction;
        }

        // Strong payload-first fallback when per-item fields are sparse.
        pct = Math.max(pct, getBestProgressPercentFromInProgress(p));

        // Keep very small but valid progress visible.
        if (currentTime > 0 && pct <= 0) pct = 2;
        if (pct > 0 && pct < 5) pct = 5;
        if (!isFinite(pct) || pct < 0) pct = 0;
        if (pct > 100) pct = 100;

        // Do not regress an already visible bar to 0 due sparse payload race.
        const existingPct = parseFloat((bar.style.width || "0").replace("%", "")) || 0;
        if (pct <= 0 && existingPct > 0) {
          pct = existingPct;
        }

        bar.style.width = pct + "%";

        const audio = el<HTMLAudioElement>("player");

        const intervalId = setInterval(() => {
          if (audio.src && !audio.paused && currentItemId === itemId) {

            const cur = audio.currentTime;
            progressByItemId.set(itemId, { currentTime: cur });

            let pct = duration > 0 ? (cur / duration) * 100 : 0;
            if (pct > 0 && pct < 5) pct = 5;
            if (!isFinite(pct) || pct < 0) pct = 0;
            if (pct > 100) pct = 100;

            bar.style.width = pct + "%";
          }
        }, 500);

        intervalByItemId.set(itemId, intervalId);

      } catch (e) {
        // Keep the initial in-progress-based fill if item details fail to load.
        console.log("continue progress init fail", e)
      }
    })();

    card.onclick = async () => {

      const progress = progressByItemId.get(itemId);
      const serverTime = progress?.currentTime || 0;

      await showItemDetail(itemId);

      const pos = getChapterIndexFromTime(serverTime);
      forcedSeekTime = pos.offset;

      await playChapter(itemId, pos.index);
    };

    markPlayedBtn.onclick = async (ev) => {
      ev.stopPropagation();
      try {
        await invoke("abs_mark_played", { serverUrl, username, itemId });

        // Refresh from server and rerender current library continue list
        lastInProgress = await invoke<any>("abs_get_items_in_progress", { serverUrl, username });
        await renderContinueListening(lastInProgress);
      } catch (e) {
        console.log("mark played fail", e)
      }
    };
  }
}

/* ---------------- Library grid ---------------- */
function showLibraryItems(name: string, items: any) {
  currentLibraryItems = items?.items ?? items?.results ?? items ?? [];
  currentLibraryItemIds = new Set(currentLibraryItems.map((x: any) => String(x?.id)).filter(Boolean));
  setMsg("homeMsg", "", "none");
  const total = el("libraryTotal");
  if (total) total.textContent = `${name} — ${currentLibraryItems.length} book${currentLibraryItems.length === 1 ? "" : "s"}`;
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

    meta.innerHTML =
    `
    <p class="book-title"></p>
    <p class="book-sub"></p>
    `;

    (meta.children[0] as HTMLElement).textContent = title;
    (meta.children[1] as HTMLElement).textContent = author;

    card.append(img, meta);
    card.onclick = () => showItemDetail(String(itemId));
    container.appendChild(card);
  }
}

const progressWrap = document.getElementById("miniProgressWrap")

if (progressWrap) {

  progressWrap.addEventListener("click", (e) => {

    const audio = document.getElementById("player") as HTMLAudioElement
    if (!audio || !currentItemId) return

      const rect = progressWrap.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = x / rect.width

      // Check if podcast or audiobook
      const isPodcast = currentFiles[0]?.audioFile !== undefined;
      
      if (isPodcast) {
        // For podcasts: seek within current episode only
        const currentFile = currentFiles[currentChapterIndex];
        const episodeDuration = currentFile?.audioFile?.duration || 0;
        const seekTime = episodeDuration * pct;
        audio.currentTime = seekTime;
      } else {
        // For audiobooks: navigate across chapters
        const total = sumDurationsFromItem({ media: { audioFiles: currentFiles } });
        const target = total * pct;
        const pos = getChapterIndexFromTime(target);
        forcedSeekTime = pos.offset;
        playChapter(currentItemId, pos.index);
      }
  })
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
  <div class="detail-layout">

  <div class="detail-actions">
  <button id="backBtn">← Back</button>
  <button id="resumeBtn">${playLabel}</button>
  </div>

  <div id="detailHeader">
  <img id="detailCover" />

  <div class="detail-meta">
  <div class="detail-title">${escapeHtml(title)}</div>
  <div class="detail-author">${escapeHtml(author)}</div>
  <div class="detail-duration">
  ${formatTotalDuration(sumDurationsFromItem(item))}
  </div>
  </div>
  </div>

  <div id="detailDescription">
  ${escapeHtml(desc)}
  </div>

  <div class="progress-wrap">
  <div id="itemDetailProgressBar" class="progress-bar"></div>
  </div>

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
  item?.media?.episodes ||
  item?.media?.episodeContent ||
  item?.media?.tracks ||
  item?.media?.audioTracks ||
  [];

  if (!Array.isArray(files)) files = [];

  files = files
  .slice()
  .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0));

  currentFiles = files;
  
  // 🔥 PREBUFFER RESUME CHAPTER

  try {

    const progress =
    progressByItemId.get(itemId)?.currentTime || 0

    const pos = getChapterIndexFromTime(progress)
    getSaved()

    const file = currentFiles[pos.index];
    const fileId = file?.audioFile?.ino || file?.ino;

    const nextUrl = await invoke<string>("abs_local_player_url", {
      libraryId: itemId,
      index: fileId
    })

    preloadAudio.src = nextUrl

  } catch (e) {
    console.log("resume prebuffer fail", e)
  }

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
  const chapterRows: HTMLElement[] = []
  list.style.marginTop = "18px";

  for (let i = 0; i < files.length; i++) {
    const f = files[i];

    const row = document.createElement("div");
    chapterRows.push(row)
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.padding = "6px 0";
    row.style.borderBottom = "1px solid rgba(255,255,255,.05)";

    const left = document.createElement("div");
    left.textContent = f?.title || f?.metadata?.title || f?.filename || `Track ${i + 1}`;

    // Handle both audiobook files (duration) and podcast episodes (audioFile.duration)
    const episodeDuration = f?.duration || f?.audioFile?.duration || f?.audioLength || 0;

    const right = document.createElement("div");
    right.style.opacity = "0.7";
    right.textContent = fmt(episodeDuration);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
    row.style.cursor = "pointer";

    row.onclick = async () => {
      await playChapter(itemId, i);
    };
  }

  detail.querySelector(".card")?.appendChild(list);
  currentChapterRows = chapterRows
  // ===== END TRACKLIST =====
  // ===== preload resume progress =====

  try {

    const duration = sumDurationsFromItem(item)

    const currentTime =
    progressByItemId.get(itemId)?.currentTime
    || getCurrentTimeForProgress(item, null)
    || 0

    const pct =
    duration > 0
    ? Math.round((currentTime / duration) * 100)
    : 0

    const bar =
    document.getElementById("itemDetailProgressBar")

    if (bar) {
      bar.style.width = pct + "%"
    }

  } catch (e) {
    console.log("detail progress preload fail", e)
  }
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

function getChapterIndexFromTime(time: number): { index: number, offset: number } {

  let sum = 0

  for (let i = 0; i < currentFiles.length; i++) {

    // Handle both audiobook chapters (duration) and podcast episodes (audioFile.duration)
    const dur = currentFiles[i]?.duration || currentFiles[i]?.audioFile?.duration || 0

    if (time < sum + dur) {
      return {
        index: i,
        offset: time - sum
      }
    }

    sum += dur
  }

  return {
    index: 0,
    offset: 0
  }
}

async function playChapter(itemId: string, index: number) {

  if (isLoadingChapter) return;
  isLoadingChapter = true;

  try {

    const { serverUrl, username } = getSaved();
    
    // Only trigger play for audiobooks (podcasts don't need this)
    const isPodcast = currentFiles[0]?.audioFile !== undefined;
    
    // For podcasts, pause and wait for previous episode's sync to settle before loading new one
    if (isPodcast) {
      const audio = el<HTMLAudioElement>("player");
      audio.pause();
      // Wait for previous episode's background requests (sync/progress) to settle
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    await invoke("abs_set_active_user", { serverUrl, username });
    
    if (!isPodcast) {
      try {
        await invoke("abs_trigger_play", {
          serverUrl,
          username,
          itemId
        })
      } catch (e) {
        console.log("play trigger fail", e)
      }
    }

    currentChapterIndex = index;
    currentItemId = itemId;
    highlightChapter(index)

    const audio = el<HTMLAudioElement>("player");
    audio.style.display = "";

    const f = currentFiles[index];
    if (!f) return;

    // Episodes use audioFile.ino, audiofiles use ino
    const fileIno = currentFiles[index].audioFile?.ino || currentFiles[index].ino;

    const url = await invoke<string>("abs_local_player_url", {
      libraryId: itemId,
      index: fileIno
    });

    // Completely reset audio element to clear any bad state
    audio.pause();
    audio.currentTime = 0;
    audio.src = "";
    
    // Small delay to let previous state clear
    await new Promise(resolve => setTimeout(resolve, 100));
    
    audio.src = url;
    el("miniLoading").style.display = "block"
    audio.preload = "auto"
    
    // Add error handler with recovery
    audio.onerror = () => {
      console.log("AUDIO ERROR:", audio.error?.message, "Code:", audio.error?.code);
      el("miniLoading").style.display = "none"
      isLoadingChapter = false; // Allow user to retry
    };
    
    audio.load()

    audio.onloadedmetadata = async () => {

      if (forcedSeekTime !== null) {
        audio.currentTime = forcedSeekTime
        forcedSeekTime = null

      }

      try {
        await audio.play()
      } catch (e) {
        console.log("AUDIO PLAY FAIL", e)
      }

    }

    setPlaybackButtons(true)
    try{

      // For podcasts, use cached data; for audiobooks, fetch fresh data
      const isPodcast = currentFiles[0]?.audioFile !== undefined;
      const currentFile = currentFiles[index];
      
      let title: string;
      let author: string;
      
      if (isPodcast) {
        // Use cached data for podcasts - faster
        title = currentFile?.title || ""
        author = "" // podcasts don't have author on episode level
      } else {
        // For audiobooks, fetch full item data
        const item = await invoke<any>("abs_get_item",{serverUrl,username,itemId})
        title = currentFile?.title || item?.media?.metadata?.title || ""
        author = item?.media?.metadata?.authorName || ""
      }
      
      const cover = await invoke<string>("abs_get_cover_url",{serverUrl,username,itemId})

      showMiniPlayer(title,author,cover)
      startMiniTicker()

    }catch{}
    // 🔥 preload nästa kapitel
    try {

      const next = index + 1

      if (next < currentFiles.length) {

        const nextFile = currentFiles[next];
        const nextIno = nextFile?.audioFile?.ino || nextFile?.ino;

        const nextUrl = await invoke<string>("abs_local_player_url", {
          libraryId: itemId,
          index: nextIno
        })

        preloadAudio.src = nextUrl

      }

    } catch (e) {
      console.log("preload fail", e)
    }
    // 🔥 refresha Continue efter playback start


    audio.onended = async () => {

      const next = currentChapterIndex + 1

      if (next < currentFiles.length) {

        forcedSeekTime = 0
          await playChapter(currentItemId!, next)

      } else {

        await stopPlaybackSession()

      }
    }

    audio.onpause = async () => {

      setPlaybackButtons(false)

        const { serverUrl, username } = getSaved()
        const audio = el<HTMLAudioElement>("player")

        await forceSaveProgress()

        // Sync on pause - skip for podcasts due to server issues
        const isPodcast = currentFiles[0]?.audioFile !== undefined;
        if (currentSessionId && !isPodcast) {

          const absolute = audio.currentTime + getChapterStart(currentChapterIndex)

          await invoke("abs_sync_session", {
            serverUrl,
            username,
            sessionId: currentSessionId,
            currentTime: absolute
          })

        }

        // ⭐⭐⭐ NYTT — vänta innan Continue refresh ⭐⭐⭐
        setTimeout(async () => {

          try {

            const { serverUrl, username } = getSaved()

            lastInProgress =
            await invoke("abs_get_items_in_progress", {
              serverUrl,
              username
            })

            await renderContinueListening(lastInProgress)

          } catch (e) {
            console.log("continue refresh fail", e)
          }

        }, 2000)
    }

    // starta playback session
    try {

      const { serverUrl, username } = getSaved()
      const isPodcast = currentFiles[0]?.audioFile !== undefined;

      const playRes: any = await invoke("abs_start_playback", {
        serverUrl,
        username,
        itemId
      })

      currentSessionId =
      playRes?.id ||
      playRes?.session?.id ||
      null

      // ⭐⭐⭐ LÄGG TILL DETTA ⭐⭐⭐
      if (currentSessionId && !isPodcast) {
        // For audiobooks only - podcasts skip initial sync to avoid server overload
        setTimeout(async () => {
          try {
            await invoke("abs_sync_session", {
              serverUrl,
              username,
              sessionId: currentSessionId,
              currentTime: 0
            })
          } catch (e) {
            console.log("First sync failed, will retry:", e)
          }
        }, 0);
      }

      // ⭐ INITIAL PROGRESS SAVE (gör så item hamnar i Continue)
      if (!isPodcast) {
        // For audiobooks only - save progress
        setTimeout(async () => {

          if (!currentItemId) return

            const audio = el<HTMLAudioElement>("player")

            const absolute = audio.currentTime + getChapterStart(currentChapterIndex)

            const { serverUrl, username } = getSaved()

            await invoke("abs_update_progress", {
              serverUrl,
              username,
              itemId: currentItemId,
              currentTime: absolute
            })

        }, 3000);
      }

    } catch (e) {
      console.log("session start fail", e)
    }

    audio.ontimeupdate = () => {

      if (!currentItemId) return

      // ⭐ MINI PLAYER TOTAL PROGRESS (lägg ALLTID först)
      const miniBar = el("miniProgressBar")
      const curLbl = el("miniCurrent")
      const totLbl = el("miniTotal")

      if (currentItemId) {
        const { total, absolute } = getPlaybackTotals(audio)
        const pct = total > 0 ? (absolute / total) * 100 : 0

        miniBar.style.width = pct + "%"
        curLbl.textContent = fmtTime(absolute)
        totLbl.textContent = fmtTime(total)

        syncNowPlayingProgress(audio)
      }


        const now = Date.now()
        const { serverUrl, username } = getSaved()

        // LIVE session sync - DISABLED for podcasts to avoid 502 errors
        const isPodcast = currentFiles[0]?.audioFile !== undefined;
        
        if (!isPodcast) {
          // Audiobooks only
          const syncInterval = 10000;
          
          if (currentSessionId && now - lastSessionSync > syncInterval) {
            lastSessionSync = now

            const absolute = audio.currentTime + getChapterStart(currentChapterIndex);

            invoke("abs_sync_session", {
              serverUrl,
              username,
              sessionId: currentSessionId,
              currentTime: absolute
            }).catch(console.error)
          }
        }

        // Save progress for both audiobooks and podcasts (podcasts less frequent).
        const progressInterval = isPodcast ? 120000 : 60000;
        if (now - lastProgressSave > progressInterval) {
          lastProgressSave = now

          const absolute = isPodcast
            ? audio.currentTime
            : audio.currentTime + getChapterStart(currentChapterIndex);

          invoke("abs_update_progress", {
            serverUrl,
            username,
            itemId: currentItemId,
            currentTime: absolute
          }).catch(console.error)
        }
    }

  } catch (e) {
    console.log("playChapter fail", e)
  } finally {
    isLoadingChapter = false
  }

}

/*
 * async function playCurrentChapter(itemId: string) {
 *
 *  const { serverUrl, username } = getSaved();
 *  await invoke("abs_set_active_user", { serverUrl, username });
 *
 *  const audio = el<HTMLAudioElement>("player");
 *
 *  const f = currentFiles[currentChapterIndex];
 *  if (!f) return;
 *
 *  const url = await invoke<string>("abs_local_file_player_url", {
 *    libraryItemId: itemId,
 *    index: currentChapterIndex
 *  });
 *
 *  console.log("CHAPTER URL:", url);
 *
 *  audio.pause();
 *  audio.src = url;
 *  audio.currentTime = 0;
 *  audio.style.display = "";
 *
 *  audio.onended = async () => {
 *    currentChapterIndex++;
 *    if (currentChapterIndex < currentFiles.length) {
 *      await playCurrentChapter(itemId);
 *    }
 *  };
 *
 *  await audio.play();
 *
 * }
 */

async function forceSaveProgress() {

  if (!currentItemId) return

    try {

      const audio = el<HTMLAudioElement>("player")

      const { serverUrl, username } = getSaved()

      // For podcasts, use just current time; for audiobooks add chapter offset
      const isPodcast = currentFiles[0]?.audioFile !== undefined;
      const absolute = isPodcast
        ? audio.currentTime
        : audio.currentTime + getChapterStart(currentChapterIndex)

      await invoke("abs_update_progress", {
        serverUrl,
        username,
        itemId: currentItemId,
        currentTime: absolute
      })

      // ⭐ hämta ny Continue-data direkt från servern (skip for podcasts to avoid 502s)
      if (!isPodcast) {
        const inProgress =
        await invoke<any>("abs_get_items_in_progress", {
          serverUrl,
          username
        })

        lastInProgress = inProgress

        // ⭐ rendera om Continue-listan
        await renderContinueListening(lastInProgress)
      }

    } catch (e) {
      console.log("force save fail", e)
    }
}

async function stopPlaybackSession() {

  if (!currentSessionId) return

    try {

      const { serverUrl, username } = getSaved()

      await invoke("abs_stop_playback", {
        serverUrl,
        username,
        sessionId: currentSessionId
      })

      currentSessionId = null

    } catch (e) {
      console.log("stop session fail", e)
    }
}

/* ---------------- Boot ---------------- */
async function showAppVersion() {

  const v = await getVersion()

  const elv = document.getElementById("appVersion")

  if (elv) {
    elv.textContent = "v" + v
  }

}

async function boot() {

  const audio = el<HTMLAudioElement>("player")
  audio.volume = 0.8
  audio.addEventListener("playing", () => {
    el("miniLoading").style.display = "none"
  })

  el<HTMLInputElement>("miniVolume").value = "0.8"

  el<HTMLInputElement>("miniVolume").oninput = (e) => {

    e.stopPropagation()

    const audio = el<HTMLAudioElement>("player")
    audio.volume = Number((e.target as HTMLInputElement).value)
  }

  const npSeek = document.getElementById("npSeek") as HTMLInputElement | null
  if (npSeek) {
    npSeek.oninput = (e) => {
      const audio = el<HTMLAudioElement>("player")
      const pct = Number((e.target as HTMLInputElement).value) / 100
      const { total } = getPlaybackTotals(audio)
      if (total > 0) {
        const targetAbsolute = total * pct
        const isPodcast = currentFiles[0]?.audioFile !== undefined

        if (isPodcast) {
          audio.currentTime = Math.max(0, targetAbsolute)
        } else {
          const pos = getChapterIndexFromTime(targetAbsolute)
          if (pos.index !== currentChapterIndex && currentItemId) {
            forcedSeekTime = pos.offset
            void playChapter(currentItemId, pos.index)
          } else {
            audio.currentTime = Math.max(0, pos.offset)
          }
        }
      }
      syncNowPlayingProgress(audio)
    }
  }

  wireSortSelect();
  const saved = getSaved();
  if (saved.serverUrl && saved.username) {
    const ok = await isLoggedIn(saved.serverUrl, saved.username);
    if (ok) {
      await invoke("abs_set_active_user", saved);
      show(el("loginView"), false);
      show(el("homeView"), true);
      show(el("miniPlayer"), true);
      await loadHome();
      return;
    }
  }
  show(el("loginView"), true);
  show(el("homeView"), false);
  show(el("miniPlayer"), false);

  showAppVersion()
}

window.addEventListener("beforeunload", () => {
  forceSaveProgress()
  //  stopPlaybackSession()
})


boot();

window.addEventListener("load", showAppVersion);
