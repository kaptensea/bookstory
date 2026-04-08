import * as Features from "./features";

// --- Global Search ---
let allLibraryItems: any[] = [];
type SearchResult = {
  item: any;
  title: string;
  subtitle: string;
  episodeIndex: number | null;
  episodeId: string | null;
};

let searchResults: SearchResult[] = [];
let searchDropdown: HTMLElement | null = null;
let searchFocusedChapterRow: HTMLElement | null = null;
let searchIndexLoadPromise: Promise<void> | null = null;
let searchIndexReady = false;
let searchInputRequestId = 0;

async function fetchAllLibrariesAndItems() {
  const { serverUrl, username } = getSaved();
  const libs = await invoke<any>("abs_get_libraries", { serverUrl, username });
  const libsArr: any[] = Array.isArray(libs) ? libs : (libs?.libraries ?? []);
  let items: any[] = [];
  for (const lib of libsArr) {
    try {
      const libItems = await invoke<any>("abs_get_library_items", { serverUrl, username, libraryId: lib.id });
      const arr = libItems?.items ?? libItems?.results ?? libItems ?? [];
      const isPodcastLibrary = String(lib?.mediaType ?? lib?.type ?? "").toLowerCase() === "podcast";

      if (isPodcastLibrary) {
        const hydrated = await Promise.all(arr.map(async (item: any) => {
          if (!item?.id) return { ...item, __library: lib };
          try {
            const fullItem = await invoke<any>("abs_get_item", { serverUrl, username, itemId: item.id });
            return {
              ...item,
              ...fullItem,
              media: fullItem?.media ?? item?.media,
              __library: lib,
            };
          } catch {
            return { ...item, __library: lib };
          }
        }));
        items.push(...hydrated);
      } else {
        for (const item of arr) {
          items.push({ ...item, __library: lib });
        }
      }
    } catch (e) { /* skip failed libs */ }
  }
  allLibraryItems = items;
}

function ensureSearchIndexLoaded(): Promise<void> {
  if (searchIndexReady) return Promise.resolve();
  if (!searchIndexLoadPromise) {
    searchIndexLoadPromise = fetchAllLibrariesAndItems()
      .then(() => {
        searchIndexReady = true;
      })
      .finally(() => {
        searchIndexLoadPromise = null;
      });
  }
  return searchIndexLoadPromise;
}

function renderSearchLoadingDropdown() {
  const searchInput = document.getElementById("searchInput") as HTMLInputElement | null;
  if (!searchInput) return;
  if (!searchDropdown) {
    searchDropdown = document.createElement("div");
    searchDropdown.id = "searchDropdown";
    searchDropdown.style.position = "fixed";
    searchDropdown.style.zIndex = "1000";
    searchDropdown.style.background = "#222";
    searchDropdown.style.border = "1px solid #444";
    searchDropdown.style.borderRadius = "8px";
    searchDropdown.style.boxShadow = "0 2px 8px #0008";
    searchDropdown.style.maxHeight = "340px";
    searchDropdown.style.overflowY = "auto";
    searchDropdown.style.padding = "4px 0";
    document.body.appendChild(searchDropdown);
  }
  const inputRect = searchInput.getBoundingClientRect();
  searchDropdown.style.left = inputRect.left + "px";
  searchDropdown.style.top = (inputRect.top + inputRect.height) + "px";
  searchDropdown.style.width = inputRect.width + "px";
  searchDropdown.style.right = "auto";

  searchDropdown.innerHTML = "";
  const row = document.createElement("div");
  row.textContent = "Indexing library...";
  row.style.padding = "12px 18px";
  row.style.color = "#aaa";
  searchDropdown.appendChild(row);
}

function filterSearchItems(query: string): SearchResult[] {
  if (!query || !allLibraryItems.length) return [];
  const q = query.trim().toLowerCase();

  const matches: SearchResult[] = [];

  for (const item of allLibraryItems) {
    const title = item?.media?.metadata?.title?.toLowerCase?.() || "";
    const author = item?.media?.metadata?.authorName?.toLowerCase?.() || "";
    const isPodcast =
      Array.isArray(item?.media?.episodes) ||
      Array.isArray(item?.media?.episodeContent) ||
      String(item?.mediaType ?? item?.__library?.mediaType ?? item?.__library?.type ?? "").toLowerCase() === "podcast";

    if (title.includes(q) || author.includes(q)) {
      matches.push({
        item,
        title: item?.media?.metadata?.title || "",
        subtitle: item?.media?.metadata?.authorName || "",
        episodeIndex: null,
        episodeId: null,
      });
    }

    if (!isPodcast) continue;

    const episodeEntries = (Array.isArray(item?.media?.episodes)
      ? item.media.episodes
      : Array.isArray(item?.media?.episodeContent)
        ? item.media.episodeContent
        : [])
      .slice()
      .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0));

    for (let i = 0; i < episodeEntries.length; i++) {
      const episodeLabel = getTrackDisplayName(episodeEntries[i], i);
      if (!episodeLabel?.toLowerCase?.().includes(q)) continue;

      const podcastTitle = item?.media?.metadata?.title || "";
      const podcastAuthor = item?.media?.metadata?.authorName || "";
      matches.push({
        item,
        title: episodeLabel,
        subtitle: podcastAuthor ? `${podcastTitle} - ${podcastAuthor}` : podcastTitle,
        episodeIndex: i,
        episodeId: episodeEntries[i]?.id ? String(episodeEntries[i].id) : null,
      });
    }
  }

  return matches;
}

// Enkel cache för cover-url:er per item-id
const coverUrlCache: Record<string, string> = {};

async function renderSearchDropdown(results: SearchResult[], query: string) {
  const searchInput = document.getElementById("searchInput") as HTMLInputElement | null;
  if (!searchDropdown) {
    searchDropdown = document.createElement("div");
    searchDropdown.id = "searchDropdown";
    searchDropdown.style.position = "fixed";
    searchDropdown.style.zIndex = "1000";
    searchDropdown.style.background = "#222";
    searchDropdown.style.border = "1px solid #444";
    searchDropdown.style.borderRadius = "8px";
    searchDropdown.style.boxShadow = "0 2px 8px #0008";
    searchDropdown.style.maxHeight = "340px";
    searchDropdown.style.overflowY = "auto";
    searchDropdown.style.padding = "4px 0";
    document.body.appendChild(searchDropdown);
  }
  // Positionera exakt under och lika bred som sökrutan, oavsett layout
  if (searchInput && searchDropdown) {
    const inputRect = searchInput.getBoundingClientRect();
    searchDropdown.style.left = inputRect.left + "px";
    searchDropdown.style.top = (inputRect.top + inputRect.height) + "px";
    searchDropdown.style.width = inputRect.width + "px";
    searchDropdown.style.right = "auto";
  }
  searchDropdown.innerHTML = "";
  if (!results.length && query) {
    const noRes = document.createElement("div");
    noRes.textContent = "No results";
    noRes.style.padding = "12px 18px";
    noRes.style.color = "#aaa";
    searchDropdown.appendChild(noRes);
    return;
  }
  const { serverUrl, username } = getSaved();
  for (const result of results.slice(0, 15)) {
    const item = result.item;
    const row = document.createElement("div");
    row.className = "search-result-row";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.padding = "6px 12px";
    row.style.cursor = "pointer";
    row.style.gap = "12px";
    row.onmouseenter = () => row.style.background = "#333";
    row.onmouseleave = () => row.style.background = "";
    row.onclick = () => {
      hideSearchDropdown();
      // Töm sökrutan
      const searchInput = document.getElementById("searchInput") as HTMLInputElement | null;
      if (searchInput) searchInput.value = "";
      showItemDetail(item.id, {
        focusEpisodeIndex: result.episodeIndex,
        focusEpisodeId: result.episodeId,
      });
    };
    const img = document.createElement("img");
    img.alt = "cover";
    img.style.width = "38px";
    img.style.height = "38px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "6px";
    img.style.background = "#222";
    // Kolla cache först
    if (coverUrlCache[item.id]) {
      img.src = coverUrlCache[item.id];
    } else {
      invoke<string>("abs_get_cover_url", { serverUrl, username, itemId: item.id })
        .then(url => {
          const resolved = url && url.trim() ? url : coverMissingUrl;
          coverUrlCache[item.id] = resolved;
          img.src = resolved;
        })
        .catch(() => {
          coverUrlCache[item.id] = coverMissingUrl;
          img.src = coverMissingUrl;
        });
    }
    const meta = document.createElement("div");
    meta.style.display = "flex";
    meta.style.flexDirection = "column";
    meta.style.gap = "2px";
    const t = document.createElement("span");
    t.textContent = result.title;
    t.style.fontWeight = "bold";
    t.style.color = "#fff";
    const a = document.createElement("span");
    a.textContent = result.subtitle;
    a.style.fontSize = "13px";
    a.style.color = "#aaa";
    // Ta bort typ-raden (Book/Podcast)
    meta.appendChild(t);
    if (result.subtitle) meta.appendChild(a);
    row.appendChild(img);
    row.appendChild(meta);
    searchDropdown.appendChild(row);
  }
}

function hideSearchDropdown() {
  if (searchDropdown) {
    searchDropdown.remove();
    searchDropdown = null;
  }
}

// Wire up search input
window.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("searchInput") as HTMLInputElement | null;
  if (!searchInput) return;
  // Sätt placeholder enligt valt språk
  searchInput.placeholder = tr("search.placeholder");
  let lastQuery = "";
  searchInput.addEventListener("input", async () => {
    const requestId = ++searchInputRequestId;
    const val = searchInput.value.trim();
    if (!val) {
      hideSearchDropdown();
      lastQuery = "";
      return;
    }

    if (!searchIndexReady) {
      renderSearchLoadingDropdown();
      try {
        await ensureSearchIndexLoaded();
      } catch {
        hideSearchDropdown();
        return;
      }
      if (requestId !== searchInputRequestId) return;
    }

    const liveVal = searchInput.value.trim();
    if (!liveVal) {
      hideSearchDropdown();
      lastQuery = "";
      return;
    }
    if (liveVal === lastQuery) return;

    lastQuery = liveVal;
    searchResults = filterSearchItems(liveVal);
    renderSearchDropdown(searchResults, liveVal);
  });
  // Hide dropdown on outside click
  document.addEventListener("click", (e) => {
    if (searchDropdown && !searchInput.contains(e.target as Node) && !searchDropdown.contains(e.target as Node)) {
      hideSearchDropdown();
    }
  });
});
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

type Json = any;

type AppLanguage = "en" | "sv" | "de";

type AppSettings = {
  language: AppLanguage;
  defaultSort: "recent" | "oldest" | "az" | "za";
  defaultVolume: number;
  maxOfflineMb: number;
  autoDownloadOnPlay: boolean;
  autoRemoveOfflineOnFinished: boolean;
  seekSeconds: number;
  continueAnimations: boolean;
  showAuthor: boolean;
  playbackRate: number;
  sleepTimerMode: "none" | "episode" | "minutes" | "minutes60";
  sleepTimerMinutes: number;
  autoMarkPlayedOnFinish: boolean;
  usePlaylistOverlay: boolean;
};

type InstallKind = "aur" | "appimage" | "deb" | "rpm" | "system" | "unknown";

type InstallContext = {
  platform: string;
  installKind: InstallKind;
  executablePath: string;
};

type UpdateState = {
  currentVersion: string;
  latestVersion: string | null;
  latestUrl: string;
  hasUpdate: boolean;
  installContext: InstallContext;
  error?: string;
};

const DEFAULT_SETTINGS: AppSettings = {
  language: "en",
  defaultSort: "recent",
  defaultVolume: 100,
  maxOfflineMb: 2048,
  autoDownloadOnPlay: false,
  autoRemoveOfflineOnFinished: false,
  seekSeconds: 15,
  continueAnimations: true,
  showAuthor: false,
  playbackRate: 1.0,
  sleepTimerMode: "none",
  sleepTimerMinutes: 30,
  autoMarkPlayedOnFinish: false,
  usePlaylistOverlay: true,
};

const coverMissingUrl = new URL("./assets/covermissing.svg", import.meta.url).href;

const I18N: Record<AppLanguage, Record<string, string>> = {
  en: {
    "search.placeholder": "Search...",
    "login.subtitle": "Connect to your Audiobookshelf server",
    "login.server": "Server address",
    "login.username": "Username",
    "login.password": "Password",
    "login.signIn": "Sign in",
    "sidebar.library": "Library",
    "sidebar.sort": "Sort",
    "sidebar.menu": "Menu",
    "sidebar.settings": "Settings",
    "sidebar.logout": "Log out",
    "home.continue": "Continue Listening",
    "home.empty": "Nothing in progress yet.",
    "home.playNext": "Play Next",
    "home.playNextEmpty": "No next items yet.",
    "home.loadingLibrary": "Loading library...",
    "mini.nothingPlaying": "Nothing playing",
    "np.buffering": "Buffering...",
    "home.signedInAs": "Signed in as {{name}}",
    "home.loggedOut": "Logged out",
    "sort.recent": "Recently added",
    "sort.oldest": "Oldest added",
    "sort.az": "A -> Z",
    "sort.za": "Z -> A",
    "common.item": "Item",
    "common.back": "Back",
    "common.play": "Play",
    "common.resume": "Resume",
    "common.playAgain": "Play again",
    "podcast.sort.label": "Sort episodes",
    "podcast.sort.oldest": "Oldest",
    "podcast.sort.latest": "Latest",
    "podcast.sort.name": "Name",
    "podcast.filter.label": "Filter",
    "podcast.filter.all": "All",
    "podcast.filter.unplayed": "Unplayed",
    "podcast.filter.downloaded": "Downloaded",
    "podcast.playNext": "Play next",
    "continue.resumeTitle": "Resume playback",
    "continue.markPlayedTitle": "Mark as played",
    "menu.markPlayed": "Mark as played",
    "menu.resetUnplayed": "Reset / mark as unplayed",
    "menu.downloadOffline": "Download offline",
    "menu.removeOffline": "Remove offline",
    "menu.downloadEpisodeOffline": "Download episode offline",
    "menu.removeEpisodeOffline": "Remove episode offline",
    "offline.saved": "Saved for offline listening",
    "offline.removed": "Offline files removed",
    "offline.downloading": "Downloading",
    "settings.offline": "Offline",
    "settings.offlineSummary": "Offline items: {{items}} | files: {{tracks}}",
    "settings.offlineUsage": "Used space: {{size}}",
    "settings.clearOffline": "Remove all offline files",
    "settings.offlineCleared": "All offline files removed",
    "settings.title": "Settings",
    "settings.language": "Language",
    "settings.lang.en": "English",
    "settings.lang.sv": "Swedish",
    "settings.lang.de": "German",
    "settings.defaultSort": "Default sort",
    "settings.defaultVolume": "Default volume (%)",
    "settings.maxOfflineMb": "Max offline storage (MB, 0 = unlimited)",
    "settings.autoDownloadOnPlay": "Auto-download item when playback starts",
    "settings.autoRemoveOfflineOnFinished": "Auto-remove offline when book/episode finishes",
    "settings.skipSeconds": "Skip seconds (back/forward)",
    "settings.animations": "Enable Continue card animations",
    "settings.showAuthor": "Show author name on book cards",
    "settings.updates": "Updates",
    "settings.checkUpdates": "Check for updates",
    "settings.checkingUpdates": "Checking for updates...",
    "settings.currentVersion": "Installed version: {{version}}",
    "settings.noUpdates": "You already have the latest version.",
    "settings.updateAvailable": "Version {{version}} is available.",
    "settings.openRelease": "Open release",
    "update.banner.dismiss": "Dismiss",
    "settings.updateHint.aur": "Update with your AUR helper, for example: yay -Syu bookstory-bin",
    "settings.updateHint.appimage": "Download the latest AppImage from GitHub Releases.",
    "settings.updateHint.deb": "Install the latest .deb package from GitHub Releases.",
    "settings.updateHint.rpm": "Install the latest .rpm package from GitHub Releases or update through your RPM package manager.",
    "settings.updateHint.system": "Update this installation through the same package source you used originally.",
    "settings.updateHint.unknown": "Open the latest GitHub release to update this installation.",
    "settings.updateFailed": "Could not check for updates right now.",
    "settings.save": "Save settings",
    "settings.reset": "Reset defaults",
    "settings.saved": "Settings saved",
    "settings.defaultsRestored": "Defaults restored",
    "error.missingServer": "Missing server address",
    "error.invalidServer": "Server must be a valid http:// or https:// URL",
    "error.missingUsername": "Missing username",
    "error.missingPassword": "Missing password",
    "cover.missing": "Missing cover",
    "label.book.singular": "book",
    "label.book.plural": "books",
    "playback.speed": "Playback speed",
    "playback.speed.normal": "Normal",
    "playback.sleepTimer": "Sleep timer",
    "playback.sleepTimer.off": "Off",
    "playback.sleepTimer.episode": "End of episode",
    "playback.sleepTimer.minutes": "After {{minutes}} min",
    "playback.sleepTimer.minutesShort": "30 min",
    "playback.sleepTimer.minutes60Short": "60 min",
    "playback.sleepTimer.active": "Sleep timer active - stops at {{time}}",
    "playback.autoMarkPlayed": "Auto-mark as played when finished",
    "playback.stopAt": "Will stop after this episode",
    "playlist.title": "Favorites",
    "playlist.button": "Favorites ({{count}})",
    "playlist.empty": "No items in playlist",
    "playlist.emptyView": "No episodes in playlist yet.",
    "playlist.add": "Add to playlist",
    "playlist.remove": "Remove from playlist",
    "playlist.clear": "Clear playlist",
    "playlist.removeEpisode": "Remove",
    "playlist.playEpisode": "Play",
    "playlist.playAll": "Play favorites",
    "playlist.queueBadge": "Favorites queue",
    "playlist.playlistOnly": "Playlist ({{count}} items)",
    "playlist.saved": "Added to playlist",
    "playlist.removed": "Removed from playlist",
    "playlist.cleared": "Playlist cleared",
    "settings.playbackSpeed": "Playback speed",
    "settings.sleepTimer": "Sleep timer",
    "settings.sleepTimerDefault": "Default sleep timer (minutes, 0 = off)",
    "settings.autoMarkOnFinish": "Auto-mark played when finished",
    "settings.usePlaylistOverlay": "Show playlist overlay while playing",
  },
  sv: {
    "search.placeholder": "Sök...",
    "login.subtitle": "Anslut till din Audiobookshelf-server",
    "login.server": "Serveradress",
    "login.username": "Anv\u00e4ndarnamn",
    "login.password": "L\u00f6senord",
    "login.signIn": "Logga in",
    "sidebar.library": "Bibliotek",
    "sidebar.sort": "Sortering",
    "sidebar.menu": "Meny",
    "sidebar.settings": "Inst\u00e4llningar",
    "sidebar.logout": "Logga ut",
    "home.continue": "Forts\u00e4tt lyssna",
    "home.empty": "Inget p\u00e5g\u00e5r just nu.",
    "home.playNext": "Spela n\u00e4sta",
    "home.playNextEmpty": "Inga n\u00e4sta objekt just nu.",
    "home.loadingLibrary": "Laddar bibliotek...",
    "mini.nothingPlaying": "Inget spelas",
    "np.buffering": "Buffrar...",
    "home.signedInAs": "Inloggad som {{name}}",
    "home.loggedOut": "Utloggad",
    "sort.recent": "Senast tillagt",
    "sort.oldest": "Äldst tillagt",
    "sort.az": "A -> \u00d6",
    "sort.za": "\u00d6 -> A",
    "common.item": "Objekt",
    "common.back": "Tillbaka",
    "common.play": "Spela",
    "common.resume": "Forts\u00e4tt",
    "common.playAgain": "Spela igen",
    "podcast.sort.label": "Sortera avsnitt",
    "podcast.sort.oldest": "\u00c4ldst",
    "podcast.sort.latest": "Senaste",
    "podcast.sort.name": "Namn",
    "podcast.filter.label": "Filter",
    "podcast.filter.all": "Alla",
    "podcast.filter.unplayed": "Ospelade",
    "podcast.filter.downloaded": "Nedladdade",
    "podcast.playNext": "Spela n\u00e4sta",
    "continue.resumeTitle": "Forts\u00e4tt uppspelning",
    "continue.markPlayedTitle": "Markera som spelad",
    "menu.markPlayed": "Markera som spelad",
    "menu.resetUnplayed": "\u00c5terst\u00e4ll / markera som ospelad",
    "menu.downloadOffline": "Ladda ner offline",
    "menu.removeOffline": "Ta bort offline",
    "menu.downloadEpisodeOffline": "Ladda ner avsnitt offline",
    "menu.removeEpisodeOffline": "Ta bort avsnitt offline",
    "offline.saved": "Sparad f\u00f6r offline-lyssning",
    "offline.removed": "Offline-filer borttagna",
    "offline.downloading": "Laddar ner",
    "settings.offline": "Offline",
    "settings.offlineSummary": "Offline-objekt: {{items}} | filer: {{tracks}}",
    "settings.offlineUsage": "Använt utrymme: {{size}}",
    "settings.clearOffline": "Ta bort alla offline-filer",
    "settings.offlineCleared": "Alla offline-filer borttagna",
    "settings.title": "Inst\u00e4llningar",
    "settings.language": "Spr\u00e5k",
    "settings.lang.en": "Engelska",
    "settings.lang.sv": "Svenska",
    "settings.lang.de": "Tyska",
    "settings.defaultSort": "Standardsortering",
    "settings.defaultVolume": "Standardvolym (%)",
    "settings.maxOfflineMb": "Max offline-lagring (MB, 0 = obegränsat)",
    "settings.autoDownloadOnPlay": "Ladda ner automatiskt när uppspelning startar",
    "settings.autoRemoveOfflineOnFinished": "Ta bort offline automatiskt när boken/avsnittet är klart",
    "settings.skipSeconds": "Hoppa sekunder (bak/fram)",
    "settings.animations": "Aktivera animationer i Forts\u00e4tt lyssna",
    "settings.showAuthor": "Visa f\u00f6rfattare p\u00e5 bokskort",
    "settings.updates": "Uppdateringar",
    "settings.checkUpdates": "S\u00f6k efter uppdateringar",
    "settings.checkingUpdates": "S\u00f6ker efter uppdateringar...",
    "settings.currentVersion": "Installerad version: {{version}}",
    "settings.noUpdates": "Du har redan senaste versionen.",
    "settings.updateAvailable": "Version {{version}} finns tillg\u00e4nglig.",
    "settings.openRelease": "\u00d6ppna release",
    "update.banner.dismiss": "D\u00f6lj",
    "settings.updateHint.aur": "Uppdatera med din AUR-hj\u00e4lpare, till exempel: yay -Syu bookstory-bin",
    "settings.updateHint.appimage": "Ladda ner senaste AppImage fr\u00e5n GitHub Releases.",
    "settings.updateHint.deb": "Installera senaste .deb-paketet fr\u00e5n GitHub Releases.",
    "settings.updateHint.rpm": "Installera senaste .rpm-paketet fr\u00e5n GitHub Releases eller uppdatera via din RPM-pakethanterare.",
    "settings.updateHint.system": "Uppdatera den h\u00e4r installationen via samma paketk\u00e4lla som du anv\u00e4nde fr\u00e5n b\u00f6rjan.",
    "settings.updateHint.unknown": "\u00d6ppna senaste GitHub-releasen f\u00f6r att uppdatera den h\u00e4r installationen.",
    "settings.updateFailed": "Det gick inte att kontrollera uppdateringar just nu.",
    "settings.save": "Spara inst\u00e4llningar",
    "settings.reset": "\u00c5terst\u00e4ll standard",
    "settings.saved": "Inst\u00e4llningar sparade",
    "settings.defaultsRestored": "Standard \u00e5terst\u00e4lld",
    "error.missingServer": "Saknar serveradress",
    "error.invalidServer": "Servern m\u00e5ste vara en giltig http://- eller https://-URL",
    "error.missingUsername": "Saknar anv\u00e4ndarnamn",
    "error.missingPassword": "Saknar l\u00f6senord",
    "cover.missing": "Saknar omslag",
    "label.book.singular": "bok",
    "label.book.plural": "b\u00f6cker",
    "playback.speed": "Uppspelningshastighet",
    "playback.speed.normal": "Normal",
    "playback.sleepTimer": "Slumtimer",
    "playback.sleepTimer.off": "Av",
    "playback.sleepTimer.episode": "Slutet av avsnittet",
    "playback.sleepTimer.minutes": "30 minuter",
    "playback.sleepTimer.minutesShort": "30 min",
    "playback.sleepTimer.minutes60Short": "60 min",
    "playback.sleepTimer.active": "Slumtimer aktiv",
    "playback.autoMarkPlayed": "Markera automatiskt som spelad n\u00e4r klar",
    "playlist.add": "L\u00e4gg till i spellista",
    "playlist.remove": "Ta bort fr\u00e5n spellista",
    "playlist.title": "Favoriter",
    "playlist.button": "Favoriter ({{count}})",
    "playlist.empty": "Ingen spellista",
    "playlist.emptyView": "Inga avsnitt i spellistan än.",
    "playlist.clear": "Rensa spellista",
    "playlist.removeEpisode": "Ta bort",
    "playlist.playEpisode": "Spela",
    "playlist.playAll": "Spela favoriter",
    "playlist.queueBadge": "Favoritko",
  },
  de: {
    "search.placeholder": "Suchen...",
    "login.subtitle": "Mit deinem Audiobookshelf-Server verbinden",
    "login.server": "Serveradresse",
    "login.username": "Benutzername",
    "login.password": "Passwort",
    "login.signIn": "Anmelden",
    "sidebar.library": "Bibliothek",
    "sidebar.sort": "Sortierung",
    "sidebar.menu": "Men\u00fc",
    "sidebar.settings": "Einstellungen",
    "sidebar.logout": "Abmelden",
    "home.continue": "Weiterh\u00f6ren",
    "home.empty": "Noch nichts in Wiedergabe.",
    "home.playNext": "Als N\u00e4chstes",
    "home.playNextEmpty": "Noch keine n\u00e4chsten Elemente.",
    "home.loadingLibrary": "Bibliothek wird geladen...",
    "mini.nothingPlaying": "Nichts wird abgespielt",
    "np.buffering": "Puffert...",
    "home.signedInAs": "Angemeldet als {{name}}",
    "home.loggedOut": "Abgemeldet",
    "sort.recent": "Zuletzt hinzugef\u00fcgt",
    "sort.oldest": "Älteste zuerst",
    "sort.az": "A -> Z",
    "sort.za": "Z -> A",
    "common.item": "Element",
    "common.back": "Zur\u00fcck",
    "common.play": "Abspielen",
    "common.resume": "Fortsetzen",
    "common.playAgain": "Erneut abspielen",
    "podcast.sort.label": "Episoden sortieren",
    "podcast.sort.oldest": "\u00c4lteste",
    "podcast.sort.latest": "Neueste",
    "podcast.sort.name": "Name",
    "podcast.filter.label": "Filter",
    "podcast.filter.all": "Alle",
    "podcast.filter.unplayed": "Ungeh\u00f6rt",
    "podcast.filter.downloaded": "Heruntergeladen",
    "podcast.playNext": "N\u00e4chste abspielen",
    "continue.resumeTitle": "Wiedergabe fortsetzen",
    "continue.markPlayedTitle": "Als abgespielt markieren",
    "menu.markPlayed": "Als abgespielt markieren",
    "menu.resetUnplayed": "Zur\u00fccksetzen / als nicht abgespielt markieren",
    "menu.downloadOffline": "Offline herunterladen",
    "menu.removeOffline": "Offline entfernen",
    "menu.downloadEpisodeOffline": "Episode offline herunterladen",
    "menu.removeEpisodeOffline": "Episode offline entfernen",
    "offline.saved": "F\u00fcr Offline-Wiedergabe gespeichert",
    "offline.removed": "Offline-Dateien entfernt",
    "offline.downloading": "Wird heruntergeladen",
    "settings.offline": "Offline",
    "settings.offlineSummary": "Offline-Elemente: {{items}} | Dateien: {{tracks}}",
    "settings.offlineUsage": "Verwendeter Speicher: {{size}}",
    "settings.clearOffline": "Alle Offline-Dateien entfernen",
    "settings.offlineCleared": "Alle Offline-Dateien entfernt",
    "settings.title": "Einstellungen",
    "settings.language": "Sprache",
    "settings.lang.en": "Englisch",
    "settings.lang.sv": "Schwedisch",
    "settings.lang.de": "Deutsch",
    "settings.defaultSort": "Standardsortierung",
    "settings.defaultVolume": "Standardlautstärke (%)",
    "settings.maxOfflineMb": "Max. Offline-Speicher (MB, 0 = unbegrenzt)",
    "settings.autoDownloadOnPlay": "Element automatisch herunterladen, wenn Wiedergabe startet",
    "settings.autoRemoveOfflineOnFinished": "Offline automatisch entfernen, wenn Buch/Episode fertig ist",
    "settings.skipSeconds": "Sekunden springen (zur\u00fcck/vor)",
    "settings.animations": "Animationen f\u00fcr Weiterh\u00f6ren-Karten aktivieren",
    "settings.showAuthor": "Autor auf Buchkarten anzeigen",
    "settings.updates": "Updates",
    "settings.checkUpdates": "Nach Updates suchen",
    "settings.checkingUpdates": "Suche nach Updates...",
    "settings.currentVersion": "Installierte Version: {{version}}",
    "settings.noUpdates": "Du hast bereits die neueste Version.",
    "settings.updateAvailable": "Version {{version}} ist verf\u00fcgbar.",
    "settings.openRelease": "Release \u00f6ffnen",
    "update.banner.dismiss": "Schlie\u00dfen",
    "settings.updateHint.aur": "Mit deinem AUR-Helfer aktualisieren, zum Beispiel: yay -Syu bookstory-bin",
    "settings.updateHint.appimage": "Die neueste AppImage-Datei aus den GitHub Releases herunterladen.",
    "settings.updateHint.deb": "Das neueste .deb-Paket aus den GitHub Releases installieren.",
    "settings.updateHint.rpm": "Das neueste .rpm-Paket aus den GitHub Releases installieren oder \u00fcber deinen RPM-Paketmanager aktualisieren.",
    "settings.updateHint.system": "Diese Installation \u00fcber dieselbe Paketquelle aktualisieren, die du urspr\u00fcnglich verwendet hast.",
    "settings.updateHint.unknown": "Den neuesten GitHub Release \u00f6ffnen, um diese Installation zu aktualisieren.",
    "settings.updateFailed": "Updates konnten gerade nicht gepr\u00fcft werden.",
    "settings.save": "Einstellungen speichern",
    "settings.reset": "Standard wiederherstellen",
    "settings.saved": "Einstellungen gespeichert",
    "settings.defaultsRestored": "Standard wiederhergestellt",
    "error.missingServer": "Serveradresse fehlt",
    "error.invalidServer": "Der Server muss eine g\u00fcltige http://- oder https://-URL sein",
    "error.missingUsername": "Benutzername fehlt",
    "error.missingPassword": "Passwort fehlt",
    "cover.missing": "Cover fehlt",
    "label.book.singular": "Buch",
    "label.book.plural": "B\u00fccher",
    "playback.speed": "Wiedergabegeschwindigkeit",
    "playback.speed.normal": "Normal",
    "playback.sleepTimer": "Sleep-Timer",
    "playback.sleepTimer.off": "Aus",
    "playback.sleepTimer.episode": "Am Ende der Episode",
    "playback.sleepTimer.minutes": "30 Minuten",
    "playback.sleepTimer.minutesShort": "30 Min",
    "playback.sleepTimer.minutes60Short": "60 Min",
    "playback.sleepTimer.active": "Sleep-Timer aktiv",
    "playback.autoMarkPlayed": "Automatisch als abgespielt markieren, wenn abgeschlossen",
    "playlist.add": "Zur Playlist hinzuf\u00fcgen",
    "playlist.remove": "Aus Playlist entfernen",
    "playlist.title": "Favoriten",
    "playlist.button": "Favoriten ({{count}})",
    "playlist.empty": "Keine Playlist",
    "playlist.emptyView": "Noch keine Episoden in der Playlist.",
    "playlist.clear": "Playlist leeren",
    "playlist.removeEpisode": "Entfernen",
    "playlist.playEpisode": "Abspielen",
    "playlist.playAll": "Favoriten abspielen",
    "playlist.queueBadge": "Favoriten-Warteschlange",
  }
};

function tr(key: string, vars?: Record<string, string | number>): string {
  const lang = appSettings.language;
  const raw = I18N[lang]?.[key] ?? I18N.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
}

function setTextIfExists(id: string, value: string) {
  const n = document.getElementById(id);
  if (n) n.textContent = value;
}

function getSleepModeLabel(mode: "none" | "episode" | "minutes" | "minutes60"): string {
  if (mode === "episode") return tr("playback.sleepTimer.episode");
  if (mode === "minutes") return tr("playback.sleepTimer.minutesShort");
  if (mode === "minutes60") return tr("playback.sleepTimer.minutes60Short");
  return tr("playback.sleepTimer.off");
}

function refreshPlaybackControlLabels() {
  const speedText = "⏯ x" + Number(appSettings.playbackRate || 1).toFixed(2);
  const speedTitle = `${tr("playback.speed")}: x${Number(appSettings.playbackRate || 1).toFixed(2)}`;

  const sleepText = "⏱ " + getSleepModeLabel(appSettings.sleepTimerMode);
  const sleepTitle = `${tr("playback.sleepTimer")}: ${getSleepModeLabel(appSettings.sleepTimerMode)}`;

  const npSpeedBtn = document.getElementById("npSpeedBtn") as HTMLButtonElement | null;
  if (npSpeedBtn) {
    npSpeedBtn.textContent = speedText;
    npSpeedBtn.title = speedTitle;
  }

  const miniSpeedBtn = document.getElementById("miniSpeedBtn") as HTMLButtonElement | null;
  if (miniSpeedBtn) {
    miniSpeedBtn.textContent = speedText;
    miniSpeedBtn.title = speedTitle;
  }

  const npSleepBtn = document.getElementById("npSleepBtn") as HTMLButtonElement | null;
  if (npSleepBtn) {
    npSleepBtn.textContent = sleepText;
    npSleepBtn.title = sleepTitle;
    npSleepBtn.style.opacity = appSettings.sleepTimerMode === "none" ? "0.6" : "1";
  }

  const miniSleepBtn = document.getElementById("miniSleepBtn") as HTMLButtonElement | null;
  if (miniSleepBtn) {
    miniSleepBtn.textContent = sleepText;
    miniSleepBtn.title = sleepTitle;
    miniSleepBtn.style.opacity = appSettings.sleepTimerMode === "none" ? "0.6" : "1";
  }
}

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
let currentEpisodeId: string | null = null
let currentItemFinished = false
let hasStartedPlayback = false
let currentLibraryMediaType: string | null = null
let detailPodcastSortMode: "oldest" | "latest" | "name" = "oldest";
let detailPodcastFilterMode: "all" | "unplayed" | "downloaded" = "all";
const progressByItemId = new Map<string, { currentTime: number; progress?: number }>();
let currentLibraryItemIds = new Set<string>();
let currentLibraryItems: any[] = [];
let miniTicker: any = null
let continueRefreshTimer: any = null
let continueRefreshInFlight = false
const itemCacheById = new Map<string, any>();
const ITEM_CACHE_MAX = 250;
const podcastDoneCacheByItemId = new Map<string, { done: boolean; ts: number }>();
const PODCAST_DONE_CACHE_MS = 120000;
const PODCAST_BADGE_CHECK_TIMEOUT_MS = 5000; // Per-item timeout for slow podcasts
const PODCAST_BADGE_MAX_RETRIES = 3;
const podcastBadgeRetries = new Map<string, number>();
let podcastBadgeQueue: string[] = [];
let podcastBadgeWorker = false;
let podcastBadgeRunId = 0;
let playbackLoadingActive = false;
let playbackLoadingStartTime = 0;
let playbackLoadingStartPos = 0;
let isNowPlayingSeekDragging = false;
let isMiniSeekDragging = false;
let playbackRequestId = 0;
let currentAppVersion = "";
let lastUpdateState: UpdateState | null = null;
let updateCheckPromise: Promise<UpdateState> | null = null;
let updateBannerDismissed = false;
const offlineAvailableByItemId = new Map<string, boolean>();
const offlineDownloadProgressByItemId = new Map<string, { percent: number; status: "downloading" | "ready" }>();
const podcastEpisodeFinishedCache = new Map<string, { ts: number; finishedIds: Set<string> }>();
const PODCAST_EPISODE_PROGRESS_CACHE_MS = 120000;
let favoritesQueueActive = false;
let favoritesQueueIndex = -1;
let favoritesQueue: Array<{ itemId: string; episodeId: string; episodeTitle: string; podcastTitle: string }> = [];
let favoritesQueueTransition = false;
let sleepTimerStartMs: number | null = null;

type OfflineStats = {
  itemCount: number;
  trackCount: number;
  totalBytes?: number;
};

const preloadAudio = new Audio()
preloadAudio.preload = "auto"

let appSettings: AppSettings = loadSettings();

function normalizeLanguage(value: unknown): AppLanguage {
  return value === "sv" || value === "de" ? value : "en";
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem("appSettings");
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      language: normalizeLanguage(parsed?.language),
      defaultSort:
        parsed?.defaultSort === "oldest" || parsed?.defaultSort === "az" || parsed?.defaultSort === "za"
          ? parsed.defaultSort
          : "recent",
      defaultVolume: Math.max(0, Math.min(100, Number(parsed?.defaultVolume) || DEFAULT_SETTINGS.defaultVolume)),
      maxOfflineMb: Math.max(0, Math.min(1024 * 1024, Number(parsed?.maxOfflineMb) || DEFAULT_SETTINGS.maxOfflineMb)),
      autoDownloadOnPlay: parsed?.autoDownloadOnPlay === true,
      autoRemoveOfflineOnFinished: parsed?.autoRemoveOfflineOnFinished === true,
      seekSeconds: Math.max(5, Math.min(120, Number(parsed?.seekSeconds) || DEFAULT_SETTINGS.seekSeconds)),
      continueAnimations: parsed?.continueAnimations !== false,
      showAuthor: parsed?.showAuthor === true,
      playbackRate: [0.75, 1.0, 1.25, 1.5, 2.0].includes(parsed?.playbackRate) ? parsed.playbackRate : DEFAULT_SETTINGS.playbackRate,
      sleepTimerMode: ["none", "episode", "minutes", "minutes60"].includes(parsed?.sleepTimerMode) ? parsed.sleepTimerMode : DEFAULT_SETTINGS.sleepTimerMode,
      sleepTimerMinutes: Math.max(1, Math.min(120, Number(parsed?.sleepTimerMinutes) || DEFAULT_SETTINGS.sleepTimerMinutes)),
      autoMarkPlayedOnFinish: parsed?.autoMarkPlayedOnFinish === true,
      usePlaylistOverlay: parsed?.usePlaylistOverlay !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(next: AppSettings) {
  appSettings = next;
  localStorage.setItem("appSettings", JSON.stringify(appSettings));
  applySettings();
}

function applySettings() {
  const sort = document.getElementById("sortSelect") as HTMLSelectElement | null;
  if (sort) sort.value = appSettings.defaultSort;

  const audio = document.getElementById("player") as HTMLAudioElement | null;
  const vol = Math.max(0, Math.min(1, appSettings.defaultVolume / 100));
  if (audio) audio.volume = vol;
  if (audio) audio.playbackRate = appSettings.playbackRate;
  const miniVolume = document.getElementById("miniVolume") as HTMLInputElement | null;
  if (miniVolume) miniVolume.value = String(vol);

  document.body.classList.toggle("continue-anim-off", !appSettings.continueAnimations);
  applyTranslations();
}

function applyTranslations() {
  document.documentElement.lang = appSettings.language;
  // Login view is always English.
  setTextIfExists("loginSubtitle", I18N.en["login.subtitle"]);
  setTextIfExists("serverLabel", I18N.en["login.server"]);
  setTextIfExists("usernameLabel", I18N.en["login.username"]);
  setTextIfExists("passwordLabel", I18N.en["login.password"]);
  setTextIfExists("loginBtn", I18N.en["login.signIn"]);
  setTextIfExists("topbarTitle", "Bookstory");
  setTextIfExists("sidebarLibraryLabel", tr("sidebar.library"));
  setTextIfExists("sidebarSortLabel", tr("sidebar.sort"));
  setTextIfExists("sidebarMenuLabel", tr("sidebar.menu"));
  setTextIfExists("playlistBtn", tr("playlist.button", { count: Features.getPlaylistEntries().length }));
  setTextIfExists("settingsBtn", tr("sidebar.settings"));
  setTextIfExists("logoutBtn", tr("sidebar.logout"));
  setTextIfExists("continueHeading", tr("home.continue"));
  setTextIfExists("continueEmpty", tr("home.empty"));
  setTextIfExists("playNextHeading", tr("home.playNext"));
  setTextIfExists("playNextEmpty", tr("home.playNextEmpty"));
  setTextIfExists("npLoadingText", tr("np.buffering"));

  const miniTitleEl = document.getElementById("miniTitle");
  if (miniTitleEl && !(document.getElementById("player") as HTMLAudioElement | null)?.src) {
    miniTitleEl.textContent = tr("mini.nothingPlaying");
  }

  const sortSelect = document.getElementById("sortSelect") as HTMLSelectElement | null;
  if (sortSelect) {
    for (const opt of Array.from(sortSelect.options)) {
      if (opt.value === "recent") opt.textContent = tr("sort.recent");
      if (opt.value === "oldest") opt.textContent = tr("sort.oldest");
      if (opt.value === "az") opt.textContent = tr("sort.az");
      if (opt.value === "za") opt.textContent = tr("sort.za");
    }
  }

  void renderPlaylist();

  if (isVisible("playlistView")) {
    void renderPlaylistPage();
  }

  refreshPlaybackControlLabels();

  if (document.getElementById("settingsView")?.style.display !== "none") {
    renderSettingsPage();
  }
}

async function getOfflineItemStatus(itemId: string): Promise<{ exists: boolean; trackCount: number }> {
  try {
    const status = await invoke<{ exists: boolean; trackCount: number }>("abs_offline_item_status", { itemId });
    offlineAvailableByItemId.set(itemId, Boolean(status?.exists));
    return status;
  } catch {
    offlineAvailableByItemId.set(itemId, false);
    return { exists: false, trackCount: 0 };
  }
}

async function downloadOfflineItem(itemId: string) {
  const { serverUrl, username } = getSaved();
  await invoke("abs_offline_download_item", { serverUrl, username, itemId });
  if (appSettings.maxOfflineMb > 0) {
    await invoke("abs_offline_enforce_max_storage", {
      maxBytes: Math.floor(appSettings.maxOfflineMb * 1024 * 1024),
    });
    offlineAvailableByItemId.clear();
  }
  offlineAvailableByItemId.set(itemId, true);
}

async function getOfflineEpisodeIds(itemId: string): Promise<Set<string>> {
  try {
    const ids = await invoke<string[]>("abs_offline_item_episode_ids", { itemId });
    return new Set((Array.isArray(ids) ? ids : []).map((x) => String(x)));
  } catch {
    return new Set<string>();
  }
}

async function downloadOfflineEpisode(itemId: string, episodeId: string) {
  const { serverUrl, username } = getSaved();
  await invoke("abs_offline_download_episode", { serverUrl, username, itemId, episodeId });
  if (appSettings.maxOfflineMb > 0) {
    await invoke("abs_offline_enforce_max_storage", {
      maxBytes: Math.floor(appSettings.maxOfflineMb * 1024 * 1024),
    });
    offlineAvailableByItemId.clear();
  }
}

async function removeOfflineEpisode(itemId: string, episodeId: string) {
  await invoke("abs_offline_remove_episode", { itemId, episodeId });
}

async function removeOfflineItem(itemId: string) {
  await invoke("abs_offline_remove_item", { itemId });
  offlineAvailableByItemId.set(itemId, false);
}

async function maybeAutoRemoveOfflineItem(itemId: string) {
  if (!appSettings.autoRemoveOfflineOnFinished) return;
  try {
    const st = await getOfflineItemStatus(itemId);
    if (st.exists) {
      await removeOfflineItem(itemId);
    }
  } catch (err) {
    console.log("auto remove offline fail", err);
  }
}

async function getOfflineStats(): Promise<OfflineStats> {
  try {
    return await invoke<OfflineStats>("abs_offline_stats");
  } catch {
    return { itemCount: 0, trackCount: 0 };
  }
}

function updateOfflineProgressUi(itemId: string) {
  const state = offlineDownloadProgressByItemId.get(itemId);
  const cardLabel = document.querySelector(`[data-offline-progress-item="${itemId}"]`) as HTMLElement | null;
  if (cardLabel) {
    if (state && state.status === "downloading") {
      cardLabel.style.display = "inline-flex";
      cardLabel.textContent = `${tr("offline.downloading")} ${state.percent}%`;
    } else {
      cardLabel.style.display = "none";
      cardLabel.textContent = "";
    }
  }

  if (currentItemId === itemId) {
    const detailLabel = document.getElementById("detailOfflineProgress");
    if (detailLabel) {
      if (state && state.status === "downloading") {
        detailLabel.textContent = `${tr("offline.downloading")} ${state.percent}%`;
        detailLabel.style.display = "";
      } else {
        detailLabel.textContent = "";
        detailLabel.style.display = "none";
      }
    }
  }
}

async function syncQueuedOfflineProgress() {
  const { serverUrl, username } = getSaved();
  if (!serverUrl || !username) return;
  try {
    await invoke("abs_offline_sync_queued_progress", { serverUrl, username });
  } catch {
    // ignore, we'll retry on next online/save cycle
  }
}

async function updateProgressWithOfflineFallback(itemId: string, currentTime: number, episodeId: string | null) {
  const { serverUrl, username } = getSaved();
  try {
    await invoke("abs_update_progress", {
      serverUrl,
      username,
      itemId,
      currentTime,
      episodeId,
    });
  } catch {
    await invoke("abs_offline_queue_progress", {
      itemId,
      episodeId,
      currentTime,
    });
  }
}

async function getChapterPlaybackUrl(itemId: string, chapterIndex: number, fileIno: string): Promise<string> {
  try {
    return await invoke<string>("abs_offline_local_player_url", { itemId, index: chapterIndex });
  } catch {
    return await invoke<string>("abs_local_player_url", {
      libraryId: itemId,
      index: fileIno,
    });
  }
}

function getSeekSeconds(): number {
  return Math.max(5, Math.min(120, Number(appSettings.seekSeconds) || 15));
}

function showSettingsPage() {
  setContinueVisible(false);
  show(el("libraryItemsView"), false);
  show(el("itemDetailView"), false);
  show(el("playlistView"), false);
  show(el("settingsView"), true);
  renderSettingsPage();
}

function hideSettingsPage() {
  show(el("settingsView"), false);
  setContinueVisible(true);
  show(el("libraryItemsView"), true);
}

function showPlaylistPage() {
  setContinueVisible(false);
  show(el("libraryItemsView"), false);
  show(el("itemDetailView"), false);
  show(el("settingsView"), false);
  show(el("playlistView"), true);
  void renderPlaylistPage();
}

function hidePlaylistPage() {
  show(el("playlistView"), false);
  setContinueVisible(true);
  show(el("libraryItemsView"), true);
}

function stopFavoritesQueue() {
  favoritesQueueActive = false;
  favoritesQueueIndex = -1;
  favoritesQueue = [];
}

function startFavoritesQueueFrom(entries: Array<{ itemId: string; episodeId: string; episodeTitle: string; podcastTitle: string }>, startIndex: number) {
  favoritesQueue = entries.slice();
  favoritesQueueIndex = Math.max(0, Math.min(startIndex, favoritesQueue.length - 1));
  favoritesQueueActive = favoritesQueue.length > 0;
}

async function playFavoritesQueueEntry(index: number, openNowPlaying = true): Promise<boolean> {
  const entries = Features.getPlaylistEntries();
  if (!entries.length) return false;

  startFavoritesQueueFrom(entries, index);
  const entry = favoritesQueue[favoritesQueueIndex];
  if (!entry) return false;

  favoritesQueueTransition = true;
  try {
    await preparePlaybackItem(entry.itemId);
    const idx = currentFiles.findIndex((x: any) => String(x?.id) === entry.episodeId);
    if (idx < 0) {
      return false;
    }
    forcedSeekTime = 0;
    await playChapter(entry.itemId, idx, openNowPlaying);
    if (lastInProgress) {
      await renderContinueListening(lastInProgress);
    }
    return true;
  } finally {
    favoritesQueueTransition = false;
  }
}

function isVisible(id: string): boolean {
  const node = document.getElementById(id);
  if (!node) return false;
  return node.style.display !== "none";
}

async function renderPlaylistPage() {
  const view = el<HTMLDivElement>("playlistView");
  const entries = Features.getPlaylistEntries();
  const { serverUrl, username } = getSaved();

  const rows: string[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    let episodeTitle = String(entry.episodeTitle || "").trim();
    let podcastTitle = String(entry.podcastTitle || "").trim();

    if (!episodeTitle || !podcastTitle) {
      try {
        const item = await getItemCached(serverUrl, username, entry.itemId);
        const episodes = Array.isArray(item?.media?.episodes)
          ? item.media.episodes
          : Array.isArray(item?.media?.episodeContent)
            ? item.media.episodeContent
            : [];
        const ep = episodes.find((x: any) => String(x?.id) === String(entry.episodeId));
        if (!episodeTitle) {
          const fallbackIndex = Number(ep?.index ?? 0);
          episodeTitle = getTrackDisplayName(ep, fallbackIndex) || tr("common.item");
        }
        if (!podcastTitle) {
          podcastTitle = String(item?.media?.metadata?.title || tr("playlist.title"));
        }
      } catch {
        // Keep safe fallbacks below.
      }
    }

    const title = escapeHtml(episodeTitle || tr("common.item"));
    const sub = escapeHtml(podcastTitle || tr("playlist.title"));

    rows.push(`
      <div class="playlist-row">
        <div>
          <div class="playlist-row-title">${title}</div>
          <div class="playlist-row-sub">${sub}</div>
        </div>
        <div class="playlist-row-buttons">
          <button type="button" title="${escapeHtml(tr("playlist.playEpisode"))}" data-playlist-index="${index}" data-playlist-play="${escapeHtml(entry.itemId)}" data-playlist-episode="${escapeHtml(entry.episodeId)}">▶</button>
          <button type="button" title="${escapeHtml(tr("playlist.removeEpisode"))}" data-playlist-remove="${escapeHtml(entry.itemId)}" data-playlist-episode="${escapeHtml(entry.episodeId)}">✕</button>
        </div>
      </div>
    `);
  }

  const rowsHtml = rows.join("");

  view.innerHTML = `
    <div class="card playlist-card">
      <div class="playlist-header">
        <button id="playlistBackBtn" type="button">← ${tr("common.back")}</button>
        <h2>${tr("playlist.title")}</h2>
        <div class="playlist-actions">
          <button id="playlistPlayAllBtn" type="button">▶ ${tr("playlist.playAll")}</button>
          <button id="playlistClearBtn" type="button">${tr("playlist.clear")}</button>
        </div>
      </div>
      <div class="playlist-list">
        ${rowsHtml || `<div class="playlist-empty">${tr("playlist.emptyView")}</div>`}
      </div>
    </div>
  `;
}

function renderSettingsPage() {
  const view = el<HTMLDivElement>("settingsView");
  view.innerHTML = `
    <div class="card settings-card">
      <div class="settings-header">
        <button id="settingsBackBtn" type="button">← ${tr("common.back")}</button>
        <h2>${tr("settings.title")}</h2>
      </div>

      <label for="settingsLanguage">${tr("settings.language")}</label>
      <select id="settingsLanguage">
        <option value="en">${tr("settings.lang.en")}</option>
        <option value="sv">${tr("settings.lang.sv")}</option>
        <option value="de">${tr("settings.lang.de")}</option>
      </select>

      <label for="settingsDefaultSort">${tr("settings.defaultSort")}</label>
      <select id="settingsDefaultSort">
        <option value="recent">${tr("sort.recent")}</option>
        <option value="oldest">${tr("sort.oldest")}</option>
        <option value="az">${tr("sort.az")}</option>
        <option value="za">${tr("sort.za")}</option>
      </select>

      <label for="settingsDefaultVolume">${tr("settings.defaultVolume")}</label>
      <input id="settingsDefaultVolume" type="number" min="0" max="100" step="1" />

      <label for="settingsMaxOfflineMb">${tr("settings.maxOfflineMb")}</label>
      <input id="settingsMaxOfflineMb" type="number" min="0" step="1" />

      <label class="settings-check-row">
        <input id="settingsAutoDownloadOnPlay" type="checkbox" />
        <span>${tr("settings.autoDownloadOnPlay")}</span>
      </label>

      <label class="settings-check-row">
        <input id="settingsAutoRemoveOfflineOnFinished" type="checkbox" />
        <span>${tr("settings.autoRemoveOfflineOnFinished")}</span>
      </label>

      <label for="settingsSeekSeconds">${tr("settings.skipSeconds")}</label>
      <input id="settingsSeekSeconds" type="number" min="5" max="120" step="1" />

      <label class="settings-check-row">
        <input id="settingsContinueAnimations" type="checkbox" />
        <span>${tr("settings.animations")}</span>
      </label>

      <label class="settings-check-row">
        <input id="settingsShowAuthor" type="checkbox" />
        <span>${tr("settings.showAuthor")}</span>
      </label>

      <div class="settings-update-block">
        <div class="settings-update-title">${tr("settings.updates")}</div>
        <div id="settingsUpdateStatus" class="settings-update-status"></div>
        <div id="settingsUpdateHint" class="settings-update-hint"></div>
        <div class="settings-update-actions">
          <button id="settingsCheckUpdatesBtn" type="button">${tr("settings.checkUpdates")}</button>
          <button id="settingsOpenReleaseBtn" type="button" style="display:none;">${tr("settings.openRelease")}</button>
        </div>
      </div>

      <div class="settings-update-block">
        <div class="settings-update-title">${tr("settings.offline")}</div>
        <div id="settingsOfflineSummary" class="settings-update-hint"></div>
        <div id="settingsOfflineUsage" class="settings-update-hint"></div>
        <div class="settings-update-actions">
          <button id="settingsClearOfflineBtn" type="button">${tr("settings.clearOffline")}</button>
        </div>
      </div>

      <div class="settings-actions">
        <button id="settingsSaveBtn" type="button">${tr("settings.save")}</button>
        <button id="settingsResetBtn" type="button">${tr("settings.reset")}</button>
      </div>
      <div id="settingsMsg" class="msg"></div>
      <div id="settingsVersion" class="settings-version"></div>
    </div>
  `;

  const language = el<HTMLSelectElement>("settingsLanguage");
  const sort = el<HTMLSelectElement>("settingsDefaultSort");
  const defaultVolume = el<HTMLInputElement>("settingsDefaultVolume");
  const maxOfflineMb = el<HTMLInputElement>("settingsMaxOfflineMb");
  const autoDownloadOnPlay = el<HTMLInputElement>("settingsAutoDownloadOnPlay");
  const autoRemoveOfflineOnFinished = el<HTMLInputElement>("settingsAutoRemoveOfflineOnFinished");
  const seek = el<HTMLInputElement>("settingsSeekSeconds");
  const anim = el<HTMLInputElement>("settingsContinueAnimations");
  const showAuthorEl = el<HTMLInputElement>("settingsShowAuthor");

  language.value = appSettings.language;
  sort.value = appSettings.defaultSort;
  defaultVolume.value = String(appSettings.defaultVolume);
  maxOfflineMb.value = String(appSettings.maxOfflineMb);
  autoDownloadOnPlay.checked = appSettings.autoDownloadOnPlay;
  autoRemoveOfflineOnFinished.checked = appSettings.autoRemoveOfflineOnFinished;
  seek.value = String(appSettings.seekSeconds);
  anim.checked = appSettings.continueAnimations;
  showAuthorEl.checked = appSettings.showAuthor;

  showAppVersion();
  renderUpdateSection();
  void checkForUpdates();
  void (async () => {
    const stats = await getOfflineStats();
    const summary = document.getElementById("settingsOfflineSummary");
    if (summary) {
      summary.textContent = tr("settings.offlineSummary", {
        items: stats.itemCount,
        tracks: stats.trackCount,
      });
    }
    const usage = document.getElementById("settingsOfflineUsage");
    if (usage) {
      const mb = Math.round((Number(stats.totalBytes || 0) / (1024 * 1024)) * 10) / 10;
      usage.textContent = tr("settings.offlineUsage", { size: `${mb} MB` });
    }
  })();
}

function normalizeVersion(version: string): string {
  return String(version || "").trim().replace(/^v/i, "");
}

function parseVersion(version: string): number[] {
  return normalizeVersion(version)
    .split(".")
    .map((part) => Number(part.replace(/[^0-9].*$/, "")) || 0);
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const len = Math.max(a.length, b.length);
  for (let index = 0; index < len; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getDefaultInstallContext(): InstallContext {
  return {
    platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
    installKind: "unknown",
    executablePath: "",
  };
}

async function getInstallContext(): Promise<InstallContext> {
  try {
    return await invoke<InstallContext>("abs_get_install_context");
  } catch {
    return getDefaultInstallContext();
  }
}

function getUpdateHint(installContext: InstallContext): string {
  const kind = installContext.installKind || "unknown";
  return tr(`settings.updateHint.${kind}`);
}

function applySettingsUpdateBadge() {
  const button = document.getElementById("settingsBtn");
  if (!button) return;
  const hasUpdate = Boolean(lastUpdateState?.hasUpdate);
  button.classList.toggle("has-update", hasUpdate);
  button.setAttribute(
    "title",
    hasUpdate && lastUpdateState?.latestVersion
      ? tr("settings.updateAvailable", { version: lastUpdateState.latestVersion })
      : tr("sidebar.settings"),
  );
}

function renderUpdateBanner() {
  const banner = document.getElementById("updateBanner");
  const titleEl = document.getElementById("updateBannerTitle");
  const hintEl = document.getElementById("updateBannerHint");
  const openBtn = document.getElementById("updateBannerOpenBtn") as HTMLButtonElement | null;
  const dismissBtn = document.getElementById("updateBannerDismissBtn") as HTMLButtonElement | null;

  if (!banner || !titleEl || !hintEl || !openBtn || !dismissBtn) return;

  openBtn.textContent = tr("settings.openRelease");
  dismissBtn.textContent = tr("update.banner.dismiss");

  const state = lastUpdateState;
  const latestVersion = state?.latestVersion || null;

  if (!state?.hasUpdate || !latestVersion || updateBannerDismissed) {
    banner.style.display = "none";
    return;
  }

  titleEl.textContent = tr("settings.updateAvailable", { version: latestVersion });
  hintEl.textContent = getUpdateHint(state.installContext);
  banner.style.display = "flex";
}

function renderUpdateSection(checking = false) {
  const statusEl = document.getElementById("settingsUpdateStatus");
  const hintEl = document.getElementById("settingsUpdateHint");
  const checkBtn = document.getElementById("settingsCheckUpdatesBtn") as HTMLButtonElement | null;
  const openBtn = document.getElementById("settingsOpenReleaseBtn") as HTMLButtonElement | null;

  if (!statusEl || !hintEl || !checkBtn || !openBtn) {
    // Settings panel is lazily rendered, but the top banner still needs updates.
    renderUpdateBanner();
    return;
  }

  checkBtn.disabled = checking;
  checkBtn.textContent = checking ? tr("settings.checkingUpdates") : tr("settings.checkUpdates");

  if (checking) {
    statusEl.textContent = tr("settings.checkingUpdates");
    hintEl.textContent = currentAppVersion ? tr("settings.currentVersion", { version: currentAppVersion }) : "";
    openBtn.style.display = "none";
    renderUpdateBanner();
    return;
  }

  if (!lastUpdateState) {
    statusEl.textContent = currentAppVersion ? tr("settings.currentVersion", { version: currentAppVersion }) : "";
    hintEl.textContent = "";
    openBtn.style.display = "none";
    renderUpdateBanner();
    return;
  }

  if (lastUpdateState.error) {
    statusEl.textContent = tr("settings.updateFailed");
    hintEl.textContent = currentAppVersion ? tr("settings.currentVersion", { version: currentAppVersion }) : "";
    openBtn.style.display = "inline-flex";
    renderUpdateBanner();
    return;
  }

  if (lastUpdateState.hasUpdate && lastUpdateState.latestVersion) {
    statusEl.textContent = tr("settings.updateAvailable", { version: lastUpdateState.latestVersion });
    hintEl.textContent = getUpdateHint(lastUpdateState.installContext);
    openBtn.style.display = "inline-flex";
    renderUpdateBanner();
    return;
  }

  statusEl.textContent = tr("settings.noUpdates");
  hintEl.textContent = currentAppVersion ? tr("settings.currentVersion", { version: currentAppVersion }) : "";
  openBtn.style.display = "none";
  renderUpdateBanner();
}

async function checkForUpdates(force = false): Promise<UpdateState> {
  if (updateCheckPromise && !force) return updateCheckPromise;
  if (lastUpdateState && !force) return lastUpdateState;

  renderUpdateSection(true);

  updateCheckPromise = (async () => {
    const installContext = await getInstallContext();
    const currentVersion = normalizeVersion(currentAppVersion || await getVersion());
    const latestUrl = "https://github.com/kaptensea/bookstory/releases/latest";

    try {
      const response = await fetch("https://api.github.com/repos/kaptensea/bookstory/releases/latest", {
        headers: {
          Accept: "application/vnd.github+json",
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const latestVersion = normalizeVersion(data?.tag_name || data?.name || "");
      const resolvedUrl = String(data?.html_url || latestUrl);

      lastUpdateState = {
        currentVersion,
        latestVersion,
        latestUrl: resolvedUrl,
        hasUpdate: latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false,
        installContext,
      };
    } catch (error) {
      lastUpdateState = {
        currentVersion,
        latestVersion: null,
        latestUrl,
        hasUpdate: false,
        installContext,
        error: String(error),
      };
    }

    applySettingsUpdateBadge();
    renderUpdateSection(false);
    return lastUpdateState;
  })();

  try {
    return await updateCheckPromise;
  } finally {
    updateCheckPromise = null;
  }
}


function startMiniTicker(){

  if (miniTicker) return

    const audio = el<HTMLAudioElement>("player")

    miniTicker = setInterval(() => {

      if (!currentItemId) return
        if (audio.paused) return

          const miniSeek = document.getElementById("miniSeek") as HTMLInputElement | null
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

          if (miniSeek && !isMiniSeekDragging) {
            miniSeek.value = String(Math.max(0, Math.min(100, pct)))
          }

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

  if (!isNowPlayingSeekDragging) {
    seek.value = String(Math.max(0, Math.min(100, pct)));
  }
  if (cur) cur.textContent = fmtTime(absolute);
  if (tot) tot.textContent = fmtTime(total);
}

function seekPlaybackToPercent(audio: HTMLAudioElement, pctRaw: number) {
  if (!hasStartedPlayback) return;
  if (!currentItemId) return;
  if (!audio.src) return;

  const pct = Math.max(0, Math.min(1, pctRaw));
  const { total } = getPlaybackTotals(audio);
  if (total <= 0) return;

  const targetAbsolute = total * pct;
  const isPodcast = currentFiles[0]?.audioFile !== undefined;

  console.log("[play-debug] seek request", {
    currentItemId,
    currentChapterIndex,
    pct,
    total,
    targetAbsolute,
    isPodcast,
  });

  if (isPodcast) {
    audio.currentTime = Math.max(0, targetAbsolute);
    return;
  }

  const pos = getChapterIndexFromTime(targetAbsolute);
  if (pos.index !== currentChapterIndex) {
    forcedSeekTime = pos.offset;
    console.log("[play-debug] seek switching chapter", {
      fromIndex: currentChapterIndex,
      toIndex: pos.index,
      forcedSeekTime,
    });
    void playChapter(currentItemId, pos.index);
  } else {
    audio.currentTime = Math.max(0, pos.offset);
  }
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
    const rowIndex = Number(row.dataset.chapterIndex ?? i);

    if (rowIndex === index) {

      row.style.background =
      "rgba(255,255,255,0.08)"

      row.style.borderRadius = "8px"

    } else {

      row.style.background = "transparent"

    }

  })
}

function clearSearchFocusedChapter() {
  if (!searchFocusedChapterRow) return;
  searchFocusedChapterRow.classList.remove("chapter-row-search-focus");
  searchFocusedChapterRow = null;
}

function focusDetailChapterRow(index: number) {
  const row = currentChapterRows.find((candidate, i) => {
    const rowIndex = Number(candidate.dataset.chapterIndex ?? i);
    return rowIndex === index;
  });
  if (!row) return;

  clearSearchFocusedChapter();
  row.classList.add("chapter-row-search-focus");
  searchFocusedChapterRow = row;

  requestAnimationFrame(() => {
    row.scrollIntoView({ behavior: "smooth", block: "center" });
  });
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

function setPlaybackLoading(loading: boolean) {
  const mini = document.getElementById("miniLoading");
  const np = document.getElementById("npLoading");
  const npText = document.getElementById("npLoadingText");
  if (mini) mini.style.display = loading ? "block" : "none";
  if (np) np.style.display = loading ? "block" : "none";
  if (npText) npText.style.display = loading ? "block" : "none";
}

function beginPlaybackLoading(audio: HTMLAudioElement) {
  playbackLoadingActive = true;
  playbackLoadingStartTime = Date.now();
  playbackLoadingStartPos = audio.currentTime || 0;
  setPlaybackLoading(true);
}

function resetPlaybackLoadingAnchor(audio: HTMLAudioElement) {
  if (!playbackLoadingActive) return;
  playbackLoadingStartTime = Date.now();
  playbackLoadingStartPos = audio.currentTime || 0;
}

function maybeEndPlaybackLoading(audio: HTMLAudioElement) {
  if (!playbackLoadingActive) return;
  const moved = (audio.currentTime - playbackLoadingStartPos) > 0.05;
  const runningFor = Date.now() - playbackLoadingStartTime;
  if (moved || (runningFor > 12000 && !audio.paused)) {
    playbackLoadingActive = false;
    setPlaybackLoading(false);
  }
}

function openNowPlayingPanel() {
  show(el("nowPlayingView"), true);
  if (playbackLoadingActive) setPlaybackLoading(true);
  const audio = el<HTMLAudioElement>("player");
  syncNowPlayingProgress(audio);
  setPlaybackButtons(!audio.paused);
  
  refreshPlaybackControlLabels();
}

function showMiniPlayer(title:string, author:string, cover:string){

  el("miniPlayer").style.display = ""

  el("miniTitle").textContent = title
  el("miniAuthor").textContent = author

  const npTitle = document.getElementById("npTitle")
  const npAuthor = document.getElementById("npAuthor")
  if (npTitle) npTitle.textContent = title
  if (npAuthor) npAuthor.textContent = author

  const resolvedCover = cover?.trim() ? cover : coverMissingUrl

  const img = el<HTMLImageElement>("miniCover")
  img.onerror = () => { img.onerror = null; img.src = coverMissingUrl; }
  img.src = resolvedCover

  const npImg = document.getElementById("npCover") as HTMLImageElement | null
  if (npImg) {
    npImg.onerror = () => { npImg.onerror = null; npImg.src = coverMissingUrl; }
    npImg.src = resolvedCover
  }

  const npBg = document.getElementById("npBg") as HTMLDivElement | null
  if (npBg) npBg.style.backgroundImage = `url('${resolvedCover.replace(/'/g, "\\'")}'` + ")"

  refreshPlaybackControlLabels();
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

function applyCardCoverWithFallback(
  img: HTMLImageElement,
  bgImg: HTMLImageElement,
  coverUrl: string,
) {
  const setMissing = () => {
    img.onerror = null;
    img.onload = null;
    img.src = coverMissingUrl;
    bgImg.src = coverMissingUrl;
  };

  if (!coverUrl?.trim()) {
    setMissing();
    return;
  }

  img.onerror = () => setMissing();
  img.onload = () => {
    if (!img.naturalWidth || !img.naturalHeight) {
      setMissing();
    }
  };

  img.src = coverUrl;
  bgImg.src = coverUrl;
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

function closePopupMenus() {
  document.querySelectorAll<HTMLElement>(".app-popup-menu").forEach((menu) => {
    menu.style.display = "none";
  });
}

function togglePopupMenu(menu: HTMLElement) {
  const isOpen = getComputedStyle(menu).display !== "none";
  closePopupMenus();
  menu.style.display = isOpen ? "none" : "flex";
}

/* ---------------- Click handling ---------------- */
document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement | null;
  if (!t) return;

  // Click on the backdrop area should behave like pressing Back.
  const settingsView = document.getElementById("settingsView");
  if (
    isVisible("settingsView") &&
    settingsView &&
    settingsView.contains(t) &&
    !t.closest(".settings-card")
  ) {
    hideSettingsPage();
    return;
  }

  const detailView = document.getElementById("itemDetailView");
  if (
    isVisible("itemDetailView") &&
    detailView &&
    detailView.contains(t) &&
    !t.closest("#itemDetailView .card")
  ) {
    await backFromDetail();
    return;
  }

  const playlistView = document.getElementById("playlistView");
  if (
    isVisible("playlistView") &&
    playlistView &&
    playlistView.contains(t) &&
    !t.closest(".playlist-card")
  ) {
    hidePlaylistPage();
    return;
  }

  if (!t.closest(".app-popup-menu, .app-menu-btn, .chapter-menu-btn")) {
    closePopupMenus();
  }

  const clickable = t.closest("[id]") as HTMLElement | null;
  const id = clickable?.id;

  if (t.closest("#sidebar")) {
    if (isVisible("settingsView") && id !== "settingsBtn") {
      hideSettingsPage();
    }
    if (isVisible("itemDetailView")) {
      await backFromDetail();
    }
    if (isVisible("playlistView") && id !== "playlistBtn") {
      hidePlaylistPage();
    }
  }
  try {
    const playlistPlayBtn = t.closest("[data-playlist-play]") as HTMLElement | null;
    if (playlistPlayBtn) {
      const indexRaw = Number(playlistPlayBtn.getAttribute("data-playlist-index") || "0");
      const played = await playFavoritesQueueEntry(Number.isFinite(indexRaw) ? indexRaw : 0, true);
      if (!played) {
        const itemId = String(playlistPlayBtn.getAttribute("data-playlist-play") || "");
        const episodeId = String(playlistPlayBtn.getAttribute("data-playlist-episode") || "");
        if (itemId && episodeId) {
          await showItemDetail(itemId, { focusEpisodeId: episodeId });
        }
      }
      return;
    }

    const playlistRemoveBtn = t.closest("[data-playlist-remove]") as HTMLElement | null;
    if (playlistRemoveBtn) {
      const itemId = String(playlistRemoveBtn.getAttribute("data-playlist-remove") || "");
      const episodeId = String(playlistRemoveBtn.getAttribute("data-playlist-episode") || "");
      if (itemId && episodeId) {
        const currentFav = getFavoritesQueueCurrentEntry();
        Features.removeFromPlaylist(itemId, episodeId);
        if (favoritesQueueActive) {
          const nextEntries = Features.getPlaylistEntries().map((x) => ({
            itemId: x.itemId,
            episodeId: x.episodeId,
            episodeTitle: x.episodeTitle,
            podcastTitle: x.podcastTitle,
          }));
          if (!nextEntries.length) {
            stopFavoritesQueue();
          } else if (currentFav) {
            const keepIndex = nextEntries.findIndex((x) =>
              String(x.itemId) === String(currentFav.itemId) && String(x.episodeId) === String(currentFav.episodeId)
            );
            if (keepIndex >= 0) {
              startFavoritesQueueFrom(nextEntries, keepIndex);
            } else {
              startFavoritesQueueFrom(nextEntries, Math.min(favoritesQueueIndex, nextEntries.length - 1));
            }
          }
        }
        await renderPlaylist();
      }
      return;
    }

    if (id === "loginBtn") await handleLogin();
    if (id === "logoutBtn") await handleLogout();
    if (id === "playlistBtn") {
      const isPodcastLibrary = String(currentLibraryMediaType || "").toLowerCase() === "podcast";
      if (!isPodcastLibrary) return;
      if (isVisible("playlistView")) {
        hidePlaylistPage();
        return;
      }
      showPlaylistPage();
      return;
    }
    if (id === "settingsBtn") {
      if (isVisible("settingsView")) {
        hideSettingsPage();
        return;
      }
      showSettingsPage();
      return;
    }
    if (id === "playlistBackBtn") {
      hidePlaylistPage();
      return;
    }
    if (id === "playlistClearBtn") {
      Features.clearPlaylist();
      stopFavoritesQueue();
      await renderPlaylist();
      return;
    }
    if (id === "playlistPlayAllBtn") {
      await playFavoritesQueueEntry(0, true);
      return;
    }
    if (id === "settingsBackBtn") hideSettingsPage();
    if (id === "settingsCheckUpdatesBtn") {
      lastUpdateState = null;
      await checkForUpdates(true);
    }
    if (id === "settingsOpenReleaseBtn") {
      const url = lastUpdateState?.latestUrl || "https://github.com/kaptensea/bookstory/releases/latest";
      await openUrl(url);
    }
    if (id === "updateBannerOpenBtn") {
      const url = lastUpdateState?.latestUrl || "https://github.com/kaptensea/bookstory/releases/latest";
      await openUrl(url);
    }
    if (id === "updateBannerDismissBtn") {
      updateBannerDismissed = true;
      renderUpdateBanner();
    }
    if (id === "settingsSaveBtn") {
      const language = (document.getElementById("settingsLanguage") as HTMLSelectElement | null)?.value;
      const defaultSort = (document.getElementById("settingsDefaultSort") as HTMLSelectElement | null)?.value as AppSettings["defaultSort"] | undefined;
      const defaultVolumeRaw = Number((document.getElementById("settingsDefaultVolume") as HTMLInputElement | null)?.value ?? appSettings.defaultVolume);
      const maxOfflineMbRaw = Number((document.getElementById("settingsMaxOfflineMb") as HTMLInputElement | null)?.value ?? appSettings.maxOfflineMb);
      const autoDownloadOnPlay = Boolean((document.getElementById("settingsAutoDownloadOnPlay") as HTMLInputElement | null)?.checked);
      const autoRemoveOfflineOnFinished = Boolean((document.getElementById("settingsAutoRemoveOfflineOnFinished") as HTMLInputElement | null)?.checked);
      const seekRaw = Number((document.getElementById("settingsSeekSeconds") as HTMLInputElement | null)?.value ?? appSettings.seekSeconds);
      const continueAnimations = Boolean((document.getElementById("settingsContinueAnimations") as HTMLInputElement | null)?.checked);
      const showAuthor = Boolean((document.getElementById("settingsShowAuthor") as HTMLInputElement | null)?.checked);

      const next: AppSettings = {
        language: normalizeLanguage(language),
        defaultSort: defaultSort === "oldest" || defaultSort === "az" || defaultSort === "za" ? defaultSort : "recent",
        defaultVolume: Math.max(0, Math.min(100, isFinite(defaultVolumeRaw) ? defaultVolumeRaw : appSettings.defaultVolume)),
        maxOfflineMb: Math.max(0, Math.min(1024 * 1024, isFinite(maxOfflineMbRaw) ? maxOfflineMbRaw : appSettings.maxOfflineMb)),
        autoDownloadOnPlay,
        autoRemoveOfflineOnFinished,
        seekSeconds: Math.max(5, Math.min(120, isFinite(seekRaw) ? seekRaw : appSettings.seekSeconds)),
        continueAnimations,
        showAuthor,
        playbackRate: appSettings.playbackRate,
        sleepTimerMode: appSettings.sleepTimerMode,
        sleepTimerMinutes: appSettings.sleepTimerMinutes,
        autoMarkPlayedOnFinish: appSettings.autoMarkPlayedOnFinish,
        usePlaylistOverlay: appSettings.usePlaylistOverlay,
      };

      saveSettings(next);
      if (next.maxOfflineMb > 0) {
        await invoke("abs_offline_enforce_max_storage", {
          maxBytes: Math.floor(next.maxOfflineMb * 1024 * 1024),
        });
        offlineAvailableByItemId.clear();
      }
      setMsg("settingsMsg", tr("settings.saved"), "ok");

      // Uppdatera placeholdern i sökrutan om den finns
      const searchInput = document.getElementById("searchInput") as HTMLInputElement | null;
      if (searchInput) searchInput.placeholder = I18N[next.language]["search.placeholder"] || "Search...";

      if (currentLibraryItems.length) {
        void renderLibraryGrid();
      }
    }
    if (id === "settingsResetBtn") {
      saveSettings({ ...DEFAULT_SETTINGS });
      renderSettingsPage();
      setMsg("settingsMsg", tr("settings.defaultsRestored"), "ok");
      if (currentLibraryItems.length) {
        void renderLibraryGrid();
      }
    }
    if (id === "settingsClearOfflineBtn") {
      await invoke("abs_offline_remove_all");
      offlineAvailableByItemId.clear();
      offlineDownloadProgressByItemId.clear();
      setMsg("settingsMsg", tr("settings.offlineCleared"), "ok");
      renderSettingsPage();
      if (currentLibraryItems.length) void renderLibraryGrid();
    }
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

      if (currentItemFinished) {
        const { serverUrl, username } = getSaved()
        await invoke("abs_mark_unplayed", {
          serverUrl,
          username,
          itemId: currentItemId,
          episodeId: null
        })
        currentItemFinished = false
        progressByItemId.set(currentItemId, { currentTime: 0 })
        const btn = document.getElementById("resumeBtn") as HTMLButtonElement | null
        if (btn) btn.textContent = `▶ ${tr("common.play")}`
      }

      const progress = progressByItemId.get(currentItemId)
      const serverTime = progress?.currentTime || 0

      // säkerställ att filer finns
      if (!currentFiles.length) {
        await showItemDetail(currentItemId)
      }

      const pos = getChapterIndexFromTime(serverTime)

      forcedSeekTime = pos.offset

        await playChapter(currentItemId, pos.index, true)
    }

    if (id === "openNowPlaying") {
      openNowPlayingPanel()
    }



    if (id === "miniPlayer") {
      openNowPlayingPanel();
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
      audio.currentTime = Math.min((audio.duration || Infinity), audio.currentTime + getSeekSeconds())
      syncNowPlayingProgress(audio)
    }

    if (id === "npBack") {
      const audio = el<HTMLAudioElement>("player")
      audio.currentTime = Math.max(0, audio.currentTime - getSeekSeconds())
      syncNowPlayingProgress(audio)
    }

    if (id === "npNextChapter" && currentItemId) {
      const next = currentChapterIndex + 1
      if (next < currentFiles.length) {
        await playChapter(currentItemId, next)
      }
    }

    if (id === "npSpeedBtn" || id === "miniSpeedBtn") {
      const audio = document.getElementById("player") as HTMLAudioElement | null;
      if (!audio) return;
      const rates = [0.75, 1.0, 1.25, 1.5, 2.0];
      const currentIdx = rates.indexOf(appSettings.playbackRate);
      const nextIdx = (currentIdx + 1) % rates.length;
      const newRate = rates[nextIdx];
      appSettings.playbackRate = newRate;
      saveSettings(appSettings);
      audio.playbackRate = newRate;
      refreshPlaybackControlLabels();
    }

    if (id === "npSleepBtn" || id === "miniSleepBtn") {
      const modes = ["none", "episode", "minutes", "minutes60"];
      const labels = [
        tr("playback.sleepTimer.off"),
        tr("playback.sleepTimer.episode"),
        tr("playback.sleepTimer.minutesShort"),
        tr("playback.sleepTimer.minutes60Short")
      ];
      const currentIdx = modes.indexOf(appSettings.sleepTimerMode);
      const nextIdx = (currentIdx + 1) % modes.length;
      appSettings.sleepTimerMode = modes[nextIdx] as any;
      sleepTimerStartMs = (appSettings.sleepTimerMode === "minutes" || appSettings.sleepTimerMode === "minutes60")
        ? Date.now() : null;
      saveSettings(appSettings);
      refreshPlaybackControlLabels();
      console.log(`Sleep timer: ${labels[nextIdx]}`);
    }

    if (id === "miniNextChapter" && currentItemId) {

      const next = currentChapterIndex + 1

      if (next < currentFiles.length) {
        void playChapter(currentItemId, next)
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
        void playChapter(currentItemId, prev)
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
  show(el("playlistView"), false);
  show(el("libraryItemsView"), true);

  // Save/stop only when playback actually started to avoid false continue entries.
  const audio = document.getElementById("player") as HTMLAudioElement | null;
  const hasPlaybackState = Boolean(audio?.src && ((audio.currentTime || 0) > 0 || !audio.paused));
  if (hasStartedPlayback || hasPlaybackState || currentSessionId) {
    forceSaveProgress().catch(() => {});
    stopPlaybackSession().catch(() => {});
  }
}

function setContinueVisible(showIt: boolean) {
  const section = document.getElementById("continueSection");
  if (section) section.style.display = showIt ? "" : "none";
  const nextSection = document.getElementById("playNextSection");
  if (nextSection) {
    const isPodcastLibrary = String(currentLibraryMediaType || "").toLowerCase() === "podcast";
    nextSection.style.display = showIt && isPodcastLibrary ? "" : "none";
  }
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

function getEpisodeIdForProgress(p: any): string | null {
  const id =
    p?.episodeId ??
    p?.episode?.id ??
    p?.recentEpisode?.id ??
    p?.mediaProgress?.episodeId ??
    p?.userMediaProgress?.episodeId ??
    p?.progress?.episodeId ??
    p?.mediaItemId ??
    null;
  return id ? String(id) : null;
}

function getTrackDisplayName(entry: any, index: number): string {
  return entry?.title || entry?.metadata?.title || entry?.filename || `Track ${index + 1}`;
}

function getPodcastEpisodePublishedAtTs(entry: any): number {
  const raw =
    entry?.publishedAt ??
    entry?.pubDate ??
    entry?.releaseDate ??
    entry?.createdAt ??
    entry?.addedAt ??
    entry?.audioFile?.publishedAt ??
    entry?.audioFile?.addedAt ??
    null;

  if (typeof raw === "number" && isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function getPodcastEpisodeOrderNumber(entry: any): number | null {
  const text = String(
    entry?.title ??
    entry?.metadata?.title ??
    entry?.name ??
    entry?.filename ??
    ""
  );
  if (!text) return null;

  // Prefer trailing episode-like number, e.g. "Episode 57" or "Del 2".
  const m = text.match(/(\d+)(?!.*\d)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function getPodcastPlaybackSequence(files: any[]): Array<{ file: any; index: number }> {
  const entries = files.map((file, index) => ({
    file,
    index,
    ts: getPodcastEpisodePublishedAtTs(file),
    orderNo: getPodcastEpisodeOrderNumber(file),
  }));

  const hasPublishDates = entries.some((e) => e.ts > 0);
  if (hasPublishDates) {
    entries.sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a.index - b.index;
    });
    return entries.map(({ file, index }) => ({ file, index }));
  }

  const numbered = entries.filter((e) => e.orderNo !== null);
  if (numbered.length >= Math.min(3, Math.max(1, Math.floor(files.length / 3)))) {
    entries.sort((a, b) => {
      const an = a.orderNo;
      const bn = b.orderNo;
      if (an !== null && bn !== null && an !== bn) return an - bn;
      if (an !== null && bn === null) return -1;
      if (an === null && bn !== null) return 1;
      return a.index - b.index;
    });
    return entries.map(({ file, index }) => ({ file, index }));
  }

  // Fallback: many feeds are newest-first; reverse for forward listening order.
  entries.sort((a, b) => b.index - a.index);
  return entries.map(({ file, index }) => ({ file, index }));
}

async function getPodcastFinishedEpisodeIds(
  serverUrl: string,
  username: string,
  itemId: string,
  episodeIds: string[]
): Promise<Set<string>> {
  const cacheKey = `${serverUrl}::${username}::${itemId}`;
  const cached = podcastEpisodeFinishedCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < PODCAST_EPISODE_PROGRESS_CACHE_MS) {
    return new Set(cached.finishedIds);
  }

  const uniqueIds = Array.from(new Set(episodeIds.filter(Boolean)));
  const finished = new Set<string>();
  const concurrency = 6;
  let cursor = 0;

  async function worker() {
    while (cursor < uniqueIds.length) {
      const idx = cursor++;
      const episodeId = uniqueIds[idx];
      try {
        const p = await invoke<any>("abs_get_progress", { serverUrl, username, itemId, episodeId });
        if (isFinishedProgress(p)) finished.add(episodeId);
      } catch {
        // Ignore per-episode failures; we still render what we can.
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, uniqueIds.length) }, () => worker());
  await Promise.all(workers);

  podcastEpisodeFinishedCache.set(cacheKey, { ts: Date.now(), finishedIds: new Set(finished) });
  return finished;
}

function progressKey(itemId: string, episodeId?: string | null): string {
  return episodeId ? `${itemId}::${episodeId}` : itemId;
}

function isFinishedProgress(progressObj: any): boolean {
  if (!progressObj) return false;
  if (progressObj?.isFinished === true) return true;
  const p = progressObj?.progress;
  if (typeof p === "number") {
    if (p >= 1) return true;
    if (p > 1 && p >= 100) return true;
  }
  return false;
}

function setLibraryItemDoneState(itemId: string, done: boolean) {
  const badge = document.querySelector(`[data-library-done-item="${itemId}"]`) as HTMLElement | null;
  if (badge) badge.style.display = done ? "flex" : "none";
}

async function isPodcastFullyPlayed(serverUrl: string, username: string, itemId: string): Promise<boolean> {
  const item = await getItemCached(serverUrl, username, itemId, false);
  const episodes = Array.isArray(item?.media?.episodes)
    ? item.media.episodes.slice().sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0))
    : [];

  if (!episodes.length) return false;

  for (const ep of episodes) {
    const episodeId = ep?.id ? String(ep.id) : null;
    if (!episodeId) return false;
    try {
      const p = await invoke<any>("abs_get_progress", { serverUrl, username, itemId, episodeId });
      if (!isFinishedProgress(p)) return false;
    } catch {
      return false;
    }
  }

  return true;
}

async function refreshPodcastLibraryDoneState(itemId: string) {
  const { serverUrl, username } = getSaved();
  const cached = podcastDoneCacheByItemId.get(itemId);
  if (cached && (Date.now() - cached.ts) < PODCAST_DONE_CACHE_MS) {
    setLibraryItemDoneState(itemId, cached.done);
    return;
  }
  try {
    // Add timeout to prevent slow podcasts from blocking queue
    const done = await Promise.race([
      isPodcastFullyPlayed(serverUrl, username, itemId),
      new Promise<boolean>((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), PODCAST_BADGE_CHECK_TIMEOUT_MS)
      )
    ]);
    podcastDoneCacheByItemId.set(itemId, { done, ts: Date.now() });
    setLibraryItemDoneState(itemId, done);
    podcastBadgeRetries.delete(itemId);
  } catch (err) {
    const retries = podcastBadgeRetries.get(itemId) ?? 0;
    if ((err as Error)?.message === "timeout" && retries < PODCAST_BADGE_MAX_RETRIES) {
      // Timeout: retry later without failing
      podcastBadgeRetries.set(itemId, retries + 1);
      queuePodcastLibraryDoneState(itemId);
    } else {
      // Hard failure or max retries reached: assume not done
      podcastDoneCacheByItemId.set(itemId, { done: false, ts: Date.now() });
      setLibraryItemDoneState(itemId, false);
      podcastBadgeRetries.delete(itemId);
    }
  }
}

async function processPodcastBadgeQueue(runId: number) {
  while (runId === podcastBadgeRunId && podcastBadgeQueue.length) {
    const itemId = podcastBadgeQueue.shift();
    if (itemId) await refreshPodcastLibraryDoneState(itemId);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  podcastBadgeWorker = false;
}

function queuePodcastLibraryDoneState(itemId: string) {
  if (!itemId) return;
  if (!podcastBadgeQueue.includes(itemId)) podcastBadgeQueue.push(itemId);
  if (podcastBadgeWorker) return;
  podcastBadgeWorker = true;
  const runId = podcastBadgeRunId;
  void processPodcastBadgeQueue(runId);
}

async function getItemCached(serverUrl: string, username: string, itemId: string, force = false): Promise<any> {
  if (!force && itemCacheById.has(itemId)) return itemCacheById.get(itemId);
  const item = await invoke<any>("abs_get_item", { serverUrl, username, itemId });
  // Keep a bounded cache to avoid unbounded memory growth in long sessions.
  if (itemCacheById.size >= ITEM_CACHE_MAX) {
    const firstKey = itemCacheById.keys().next().value;
    if (firstKey) itemCacheById.delete(firstKey);
  }
  itemCacheById.set(itemId, item);
  return item;
}

function scheduleContinueRefresh(delay = 120) {
  if (continueRefreshTimer) clearTimeout(continueRefreshTimer);
  continueRefreshTimer = setTimeout(async () => {
    if (continueRefreshInFlight) return;
    continueRefreshInFlight = true;
    try {
      const { serverUrl, username } = getSaved();
      lastInProgress = await invoke<any>("abs_get_items_in_progress", { serverUrl, username });
      await renderContinueListening(lastInProgress);
      await renderPlaylist();
    } catch (e) {
      console.log("continue refresh fail", e);
    } finally {
      continueRefreshInFlight = false;
    }
  }, delay);
}

function removeContinueCard(itemId: string, episodeId?: string | null) {
  const key = progressKey(itemId, episodeId ?? null);
  const card = document.querySelector(`[data-continue-key="${key}"]`) as HTMLElement | null;
  if (!card) return;

  card.classList.add("is-removing");
  window.setTimeout(() => {
    card.remove();
    const listEl = document.getElementById("continueList");
    const emptyEl = document.getElementById("continueEmpty");
    if (listEl && emptyEl && listEl.children.length === 0) {
      emptyEl.style.display = "";
    }
  }, 180);
}

async function preparePlaybackItem(itemId: string) {
  if (!favoritesQueueTransition && favoritesQueueActive) {
    stopFavoritesQueue();
  }

  const { serverUrl, username } = getSaved();
  currentItemId = itemId;

  const item = await getItemCached(serverUrl, username, itemId, true);
  let files =
    item?.media?.audioFiles ||
    item?.media?.episodes ||
    item?.media?.episodeContent ||
    item?.media?.tracks ||
    item?.media?.audioTracks ||
    [];

  if (!Array.isArray(files)) files = [];
  currentFiles = files
    .slice()
    .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0));

  currentChapterRows = [];
}

function resolvePodcastEpisode(item: any, progressObj: any, episodeId?: string | null, currentTimeHint?: number) {
  const episodes = Array.isArray(item?.media?.episodes)
    ? item.media.episodes.slice().sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0))
    : [];
  if (!episodes.length) return null;

  const idCandidates = [
    episodeId,
    progressObj?.episodeId,
    progressObj?.episode?.id,
    progressObj?.mediaProgress?.episodeId,
    progressObj?.userMediaProgress?.episodeId,
    progressObj?.progress?.episodeId,
    progressObj?.mediaItemId,
  ].filter(Boolean).map((x: any) => String(x));

  for (const id of idCandidates) {
    const index = episodes.findIndex((e: any) => String(e?.id) === id);
    if (index >= 0) {
      let start = 0;
      for (let i = 0; i < index; i++) {
        start += normalizeSecondsMaybe(episodes[i]?.audioFile?.duration || episodes[i]?.duration || episodes[i]?.audioLength || 0);
      }
      return { episode: episodes[index], index, start };
    }
  }

  if (typeof currentTimeHint === "number" && isFinite(currentTimeHint) && currentTimeHint > 0) {
    let start = 0;
    for (let i = 0; i < episodes.length; i++) {
      const dur = normalizeSecondsMaybe(episodes[i]?.audioFile?.duration || episodes[i]?.duration || episodes[i]?.audioLength || 0);
      if (dur > 0 && currentTimeHint >= start && currentTimeHint < start + dur) {
        return { episode: episodes[i], index: i, start };
      }
      start += dur;
    }
  }

  return null;
}

/* ---------------- Home ---------------- */
async function loadHome() {
  const { serverUrl, username } = getSaved();
  setMsg("homeMsg", "", "none");
  itemCacheById.clear();

  const me = await invoke<Json>("abs_get_me", { serverUrl, username });
  const inProgress = await invoke<any>("abs_get_items_in_progress", { serverUrl, username });
  const libraries = await invoke<Json>("abs_get_libraries", { serverUrl, username });
  lastInProgress = inProgress;

  el("whoami").textContent = tr("home.signedInAs", { name: me?.username ?? username });

  progressByItemId.clear();

  // Render continue listening med filter per bibliotek
  await renderLibraries(libraries);
  // await renderContinueListening(lastInProgress);

  // Pre-warm global search index in background to speed up first search interaction.
  if (!searchIndexReady && !searchIndexLoadPromise) {
    void ensureSearchIndexLoaded().catch((e) => {
      console.log("search pre-warm failed", e);
    });
  }
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
    if (isVisible("settingsView")) hideSettingsPage();
    if (isVisible("itemDetailView")) await backFromDetail();

    const { serverUrl, username } = getSaved();
    const grid = el("libraryItemsView");
    grid.classList.add("loading");
    currentLibraryId = select.value;
    setMsg("homeMsg", tr("home.loadingLibrary"), "none");

    try {
      const items = await invoke<any>("abs_get_library_items", {
        serverUrl, username, libraryId: currentLibraryId
      });

      const selected = libsArr.find((x) => String(x.id) === currentLibraryId);
      currentLibraryMediaType = selected?.mediaType ?? selected?.type ?? null;
      showLibraryItems(selected?.name ?? "Library", items);

      // Uppdatera continue-lista med filtrering per bibliotek
      await renderContinueListening(lastInProgress);
      await renderPlaylist();
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

function getFavoritesQueueCurrentEntry() {
  if (!favoritesQueueActive) return null;
  if (favoritesQueueIndex < 0 || favoritesQueueIndex >= favoritesQueue.length) return null;
  return favoritesQueue[favoritesQueueIndex] || null;
}

function getFavoritesQueueNextEntry() {
  if (!favoritesQueueActive) return null;
  const nextIndex = favoritesQueueIndex + 1;
  if (nextIndex < 0 || nextIndex >= favoritesQueue.length) return null;
  return favoritesQueue[nextIndex] || null;
}

/* ---------------- Continue Listening ---------------- */
// Shared ticker for continue cards to reduce timer overhead on Wayland/NVIDIA.
const continueCardMetaByKey = new Map<string, { itemId: string; duration: number; bar: HTMLDivElement }>();
let continueTicker: any = null;

function startContinueTicker() {
  if (continueTicker) return;
  continueTicker = setInterval(() => {
    const audio = document.getElementById("player") as HTMLAudioElement | null;
    if (!audio || audio.paused || !currentItemId) return;

    const isPodcast = currentFiles[0]?.audioFile !== undefined;
    const activeKey = progressKey(currentItemId, isPodcast ? currentEpisodeId : null);
    const fallbackKey = progressKey(currentItemId, null);
    const meta = continueCardMetaByKey.get(activeKey) || continueCardMetaByKey.get(fallbackKey);
    if (!meta || !meta.duration) return;

    const current = isPodcast
      ? audio.currentTime
      : audio.currentTime + (getChapterStart(currentChapterIndex) || 0);

    let pct = (current / meta.duration) * 100;
    if (pct > 0 && pct < 5) pct = 5;
    if (!isFinite(pct) || pct < 0) pct = 0;
    if (pct > 100) pct = 100;

    meta.bar.style.width = pct + "%";
    progressByItemId.set(activeKey, { currentTime: current });
  }, 500);
}

async function renderContinueListening(inProgress: any) {


  const listEl = el("continueList");
  const emptyEl = el("continueEmpty");
  const isPodcastLibrary = String(currentLibraryMediaType || "").toLowerCase() === "podcast";
  const playNextSection = document.getElementById("playNextSection");
  if (playNextSection) playNextSection.style.display = isPodcastLibrary ? "" : "none";
  const playNextListEl = el("playNextList");
  const playNextEmptyEl = el("playNextEmpty");
  listEl.innerHTML = "";
  emptyEl.style.display = "none";
  if (playNextListEl) playNextListEl.innerHTML = "";
  if (playNextEmptyEl) playNextEmptyEl.style.display = "none";

  continueCardMetaByKey.clear();

  if (!currentLibraryItemIds.size) {

    return
  }

  let allProgress: any[] = [];

  if (Array.isArray(inProgress)) allProgress = inProgress;
  else if (inProgress?.sessions) allProgress = inProgress.sessions;
  else allProgress = extractInProgressArray(inProgress) || [];

  const filteredProgress: any[] = [];
  const byProgressKey = new Map<string, any>();

  for (const p of allProgress) {
    const id = getItemId(p);
    if (!id) continue;
    const epId = getEpisodeIdForProgress(p);
    const key = progressKey(id, epId);

    // Always scope by the currently loaded library items in this app.
    if (!currentLibraryItemIds.has(id)) continue;

    const currentTime = getCurrentTimeForProgress(null, p);

    const prev = byProgressKey.get(key);
    if (!prev) {
      byProgressKey.set(key, p);
      continue;
    }

    const prevTime = getCurrentTimeForProgress(null, prev);
    if (currentTime >= prevTime) byProgressKey.set(key, p);
  }

  for (const v of byProgressKey.values()) filteredProgress.push(v);

  if (!filteredProgress.length) {
    emptyEl.style.display = "";
    if (playNextEmptyEl) playNextEmptyEl.style.display = "";
    return;
  }

  emptyEl.style.display = "none";

  const { serverUrl, username } = getSaved();
  const libraryItemById = new Map<string, any>(
    currentLibraryItems
      .filter((x: any) => x?.id)
      .map((x: any) => [String(x.id), x])
  );

  for (const p of filteredProgress) {

    const itemId = getItemId(p);
    if (!itemId) continue;
    const episodeId = getEpisodeIdForProgress(p);
    const pKey = progressKey(itemId, episodeId);
    const currentFav = getFavoritesQueueCurrentEntry();
    const isFavoritesCurrent = Boolean(
      currentFav &&
      String(currentFav.itemId) === String(itemId) &&
      (
        String(currentFav.episodeId) === String(episodeId || "") ||
        (String(currentItemId || "") === String(itemId) && String(currentEpisodeId || "") === String(currentFav.episodeId))
      )
    );
    const isFavoriteEntry = Boolean(
      episodeId && Features.isInPlaylist(String(itemId), String(episodeId))
    );
    const showFavoriteBadge = isFavoritesCurrent || isFavoriteEntry;

    const card = document.createElement("div");
    card.className = "book-card continue-card";
    card.classList.add("is-entering");
    card.dataset.continueKey = pKey;
    listEl.appendChild(card);

    window.requestAnimationFrame(() => {
      card.classList.remove("is-entering");
    });

    card.innerHTML = `
    <div class="cover-wrap">
    <img class="book-cover-bg" loading="lazy" decoding="async" alt="" aria-hidden="true">
    <img class="book-cover" loading="lazy" decoding="async">
    ${showFavoriteBadge ? `<span class="favorite-cover-badge" title="${escapeHtml(tr("playlist.queueBadge"))}">♥</span>` : ""}
    <div class="progress-wrap">
    <div class="progress-bar"></div>
    </div>
    <button class="continue-play-btn" type="button" title="${escapeHtml(tr("continue.resumeTitle"))}">▶</button>
    <button class="continue-mark-check" type="button" title="${escapeHtml(tr("continue.markPlayedTitle"))}">✓</button>
    </div>

    <div class="book-meta">
    <p class="book-title"></p>
    <p class="book-sub"></p>
    </div>
    `;

    const img = card.querySelector(".book-cover") as HTMLImageElement;
    const bgImg = card.querySelector(".book-cover-bg") as HTMLImageElement;
    const bar = card.querySelector(".progress-bar") as HTMLDivElement;
    // Start neutral and let per-item init set the correct value.
    bar.style.width = "3%";

    const titleEl = card.querySelector(".book-title") as HTMLElement;
    const authorEl = card.querySelector(".book-sub") as HTMLElement;
    const playBtn = card.querySelector(".continue-play-btn") as HTMLButtonElement;
    const markCheckBtn = card.querySelector(".continue-mark-check") as HTMLButtonElement;

    const itemPromise = getItemCached(serverUrl, username, itemId);
    const libItem = libraryItemById.get(itemId);
    const libTitle = libItem?.media?.metadata?.title ?? "";
    const libAuthor = libItem?.media?.metadata?.authorName ?? "";

    let title = libTitle || p?.title || itemId;
    let author = libAuthor || p?.author || "";

    let isPodcastItem = false;
    try {
      const item = await itemPromise;
      isPodcastItem = Array.isArray(item?.media?.episodes);
      const resolution = isPodcastItem
        ? resolvePodcastEpisode(item, p, episodeId, getCurrentTimeForProgress(item, p))
        : null;

      if (isPodcastItem) {
        if (resolution?.episode) {
          title = getTrackDisplayName(resolution.episode, resolution.index);
        } else {
          title = p?.episode?.title ?? p?.mediaProgress?.episodeTitle ?? p?.episodeTitle ?? episodeId ?? libTitle ?? title;
        }
        author = item?.media?.metadata?.title ?? author;
      } else {
        title = item?.media?.metadata?.title ?? libTitle ?? title;
        author = item?.media?.metadata?.authorName ?? libAuthor ?? author;
      }
    } catch {}

    titleEl.textContent = title;
    authorEl.textContent = (!isPodcastItem && !appSettings.showAuthor) ? "" : author;

    try {
      const url = await invoke<string>("abs_get_cover_url", { serverUrl, username, itemId });
      applyCardCoverWithFallback(img, bgImg, url);
    } catch {
      applyCardCoverWithFallback(img, bgImg, "");
    }

    // progress init
    (async () => {
      try {
        const [item, progressObj] = await Promise.all([
          itemPromise,
          invoke<any>("abs_get_progress", {
            serverUrl,
            username,
            itemId,
            episodeId
          }).catch(() => null),
        ]);
        const isPodcastItem = Array.isArray(item?.media?.episodes);
        const resolution = isPodcastItem
          ? resolvePodcastEpisode(item, progressObj ?? p, episodeId)
          : null;
        const episode = resolution?.episode ?? null;

        let duration = isPodcastItem
          ? normalizeSecondsMaybe(episode?.audioFile?.duration || episode?.duration || 0)
          : sumDurationsFromItem(item);

        if (!duration || duration < 60) {
          duration = isPodcastItem
            ? normalizeSecondsMaybe(item?.media?.duration || item?.media?.durationSeconds || 3600)
            : item?.media?.duration || item?.media?.metadata?.duration || item?.media?.durationSeconds || 3600
        }

        duration = normalizeSecondsMaybe(duration);

        // progressObj from /api/me/progress/{id} has currentTime directly
        let currentTime = 0;
        if (progressObj?.currentTime && progressObj.currentTime > 0) {
          currentTime = normalizeSecondsMaybe(progressObj.currentTime, duration);
        } else {
          currentTime = getCurrentTimeForProgress(item, p, duration);
        }

        if (isPodcastItem && resolution && duration > 0) {
          const epStart = resolution.start;
          // Some payloads are absolute in podcast timeline; convert to episode-local when possible.
          if (currentTime > duration && currentTime >= epStart && currentTime <= epStart + duration + 5) {
            currentTime = currentTime - epStart;
          }
          if (currentTime > duration * 1.2) {
            currentTime = 0;
          }
        }

        if (isPodcastItem && duration > 0) {
          currentTime = Math.max(0, Math.min(currentTime, duration));
        }

        progressByItemId.set(pKey, { currentTime });

        let pct = duration > 0 ? (currentTime / duration) * 100 : 0;

        // Use direct progress fraction from /api/me/progress first
        if (progressObj?.progress && progressObj.progress > 0) {
          const frac = progressObj.progress > 1 ? progressObj.progress / 100 : progressObj.progress;
          pct = Math.max(pct, frac * 100);
          if (currentTime <= 0) currentTime = duration * frac;
        }

        if (!isPodcastItem) {
          const fraction = getBestProgressFraction(item, p);
          if (fraction > 0) {
            pct = Math.max(pct, fraction * 100);
            if (currentTime <= 0) currentTime = duration * fraction;
          }

          // Strong payload-first fallback when per-item fields are sparse.
          pct = Math.max(pct, getBestProgressPercentFromInProgress(p));
        }

        // Keep very small but valid progress visible.
        if (currentTime > 0 && pct <= 0) pct = 2;
        if (pct > 0 && pct < 5) pct = 5;
        if (!isFinite(pct) || pct < 0) pct = 0;
        if (pct > 100) pct = 100;

        // Do not regress an already visible bar to 0 due sparse payload race.
        const existingPct = parseFloat((bar.style.width || "0").replace("%", "")) || 0;
        if (!isPodcastItem && pct <= 0 && existingPct > 0) {
          pct = existingPct;
        }

        bar.style.width = pct + "%";

        continueCardMetaByKey.set(pKey, { itemId, duration, bar });

      } catch (e) {
        // Keep the initial in-progress-based fill if item details fail to load.
        console.log("continue progress init fail", e)
      }
    })();

    playBtn.onclick = async (ev) => {
      ev.stopPropagation();

      const progress = progressByItemId.get(pKey);
      const serverTime = progress?.currentTime || 0;
      const clickedEpisodeId = episodeId;

      await preparePlaybackItem(itemId);

      if (clickedEpisodeId) {
        const episodeIndex = currentFiles.findIndex((x: any) => String(x?.id) === clickedEpisodeId);
        if (episodeIndex >= 0) {
          forcedSeekTime = serverTime;
          await playChapter(itemId, episodeIndex, true);
          return;
        }
      }

      const pos = getChapterIndexFromTime(serverTime);
      forcedSeekTime = pos.offset;

      await playChapter(itemId, pos.index, true);
    };

    card.onclick = async () => {
      await showItemDetail(itemId);
    };

    markCheckBtn.onclick = async (ev) => {
      ev.stopPropagation();
      try {
        await invoke("abs_mark_played", { serverUrl, username, itemId, episodeId });

        // Clear local progress cache so it reflects the reset state
        progressByItemId.set(pKey, { currentTime: 0 });
        removeContinueCard(itemId, episodeId);
        if (episodeId) {
          queuePodcastLibraryDoneState(itemId);
        } else {
          setLibraryItemDoneState(itemId, true);
        }

        // Refresh from server and rerender current library continue list
        lastInProgress = await invoke<any>("abs_get_items_in_progress", { serverUrl, username });
      } catch (e) {
        console.log("mark played fail", e)
      }
    };
  }

  startContinueTicker();

  if (isPodcastLibrary && playNextListEl && playNextEmptyEl) {
    await renderPlayNextRow(filteredProgress, playNextListEl, playNextEmptyEl, libraryItemById);
  }
}

async function renderPlayNextRow(
  filteredProgress: any[],
  listEl: HTMLElement,
  emptyEl: HTMLElement,
  libraryItemById: Map<string, any>
) {
  listEl.innerHTML = "";
  emptyEl.style.display = "none";

  const { serverUrl, username } = getSaved();

  const favNext = getFavoritesQueueNextEntry();
  if (favNext) {
    const card = document.createElement("div");
    card.className = "book-card continue-card play-next-card";
    card.innerHTML = `
      <div class="cover-wrap">
        <img class="book-cover-bg" loading="lazy" decoding="async" alt="" aria-hidden="true">
        <img class="book-cover" loading="lazy" decoding="async">
        <span class="favorite-cover-badge" title="${escapeHtml(tr("playlist.queueBadge"))}">♥</span>
        <button class="continue-play-btn" type="button" title="${escapeHtml(tr("playlist.playEpisode"))}">▶</button>
      </div>
      <div class="book-meta">
        <p class="book-title">${escapeHtml(favNext.episodeTitle || tr("common.item"))}</p>
        <p class="book-sub">${escapeHtml(favNext.podcastTitle || tr("playlist.title"))}</p>
      </div>
    `;

    const playBtn = card.querySelector(".continue-play-btn") as HTMLButtonElement;
    const img = card.querySelector(".book-cover") as HTMLImageElement;
    const bgImg = card.querySelector(".book-cover-bg") as HTMLImageElement;

    try {
      const coverUrl = await invoke<string>("abs_get_cover_url", { serverUrl, username, itemId: favNext.itemId });
      applyCardCoverWithFallback(img, bgImg, coverUrl);
    } catch {
      applyCardCoverWithFallback(img, bgImg, "");
    }

    playBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await playFavoritesQueueEntry(favoritesQueueIndex + 1, true);
    };

    card.onclick = async () => {
      await showItemDetail(favNext.itemId, { focusEpisodeId: favNext.episodeId });
    };

    listEl.appendChild(card);
    return;
  }

  const byItemId = new Map<string, any>();
  for (const p of filteredProgress) {
    const itemId = getItemId(p);
    if (!itemId) continue;
    if (!byItemId.has(itemId)) byItemId.set(itemId, p);
  }

  const candidates = Array.from(byItemId.values());
  if (!candidates.length) {
    emptyEl.style.display = "";
    return;
  }

  for (const p of candidates.slice(0, 20)) {
    const itemId = getItemId(p);
    if (!itemId) continue;

    const card = document.createElement("div");
    card.className = "book-card continue-card play-next-card";
    card.innerHTML = `
      <div class="cover-wrap">
        <img class="book-cover-bg" loading="lazy" decoding="async" alt="" aria-hidden="true">
        <img class="book-cover" loading="lazy" decoding="async">
        <button class="continue-play-btn" type="button" title="${escapeHtml(tr("podcast.playNext"))}">▶</button>
      </div>
      <div class="book-meta">
        <p class="book-title"></p>
        <p class="book-sub"></p>
      </div>
    `;

    const titleEl = card.querySelector(".book-title") as HTMLElement;
    const subEl = card.querySelector(".book-sub") as HTMLElement;
    const playBtn = card.querySelector(".continue-play-btn") as HTMLButtonElement;
    const coverWrap = card.querySelector(".cover-wrap") as HTMLElement;
    const img = card.querySelector(".book-cover") as HTMLImageElement;
    const bgImg = card.querySelector(".book-cover-bg") as HTMLImageElement;

    let nextIndex = 0;
    let nextEpisodeId: string | null = null;
    let isPodcastItem = false;

    try {
      const item = await getItemCached(serverUrl, username, itemId);
      const files = (
        item?.media?.audioFiles ||
        item?.media?.episodes ||
        item?.media?.episodeContent ||
        []
      )
        .slice()
        .sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0));

      isPodcastItem = Array.isArray(item?.media?.episodes);
      const episodeId = getEpisodeIdForProgress(p);

      if (isPodcastItem) {
        const sequence = getPodcastPlaybackSequence(files);
        const curPos = episodeId
          ? sequence.findIndex((x: any) => String(x?.file?.id) === String(episodeId))
          : -1;
        const nextPos = Math.min((curPos >= 0 ? curPos + 1 : 0), Math.max(0, sequence.length - 1));
        const nextEpisode = sequence[nextPos]?.file;
        nextIndex = sequence[nextPos]?.index ?? 0;
        nextEpisodeId = nextEpisode?.id ? String(nextEpisode.id) : null;
        titleEl.textContent = getTrackDisplayName(nextEpisode, nextIndex);
        subEl.textContent = item?.media?.metadata?.title || "";
      } else {
        // Play Next row is podcast-only.
        continue;
      }
    } catch {
      titleEl.textContent = libraryItemById.get(itemId)?.media?.metadata?.title || itemId;
      subEl.textContent = "";
    }

    if (!isPodcastItem) {
      continue;
    }

    if (nextEpisodeId && Features.isInPlaylist(String(itemId), String(nextEpisodeId)) && coverWrap) {
      const badge = document.createElement("span");
      badge.className = "favorite-cover-badge";
      badge.title = tr("playlist.queueBadge");
      badge.textContent = "♥";
      coverWrap.appendChild(badge);
    }

    try {
      const coverUrl = await invoke<string>("abs_get_cover_url", { serverUrl, username, itemId });
      applyCardCoverWithFallback(img, bgImg, coverUrl);
    } catch {
      applyCardCoverWithFallback(img, bgImg, "");
    }

    playBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await preparePlaybackItem(itemId);
      if (nextEpisodeId) {
        const idx = currentFiles.findIndex((x: any) => String(x?.id) === nextEpisodeId);
        if (idx >= 0) {
          await playChapter(itemId, idx, true);
          return;
        }
      }
      await playChapter(itemId, nextIndex, true);
    };

    card.onclick = async () => {
      await showItemDetail(itemId, {
        focusEpisodeId: nextEpisodeId,
        focusEpisodeIndex: nextIndex,
      });
    };

    listEl.appendChild(card);
  }
}

async function renderPlaylist() {
  Features.loadPlaylist();
  const entries = Features.getPlaylistEntries();
  const isPodcastLibrary = String(currentLibraryMediaType || "").toLowerCase() === "podcast";
  const playlistBtn = document.getElementById("playlistBtn");
  if (playlistBtn) {
    (playlistBtn as HTMLElement).style.display = isPodcastLibrary ? "" : "none";
    playlistBtn.textContent = tr("playlist.button", { count: entries.length });
  }

  if (!isPodcastLibrary && isVisible("playlistView")) {
    hidePlaylistPage();
    return;
  }

  if (isVisible("playlistView")) {
    void renderPlaylistPage();
  }
}

/* ---------------- Library grid ---------------- */
function showLibraryItems(name: string, items: any) {
  currentLibraryItems = items?.items ?? items?.results ?? items ?? [];
  currentLibraryItemIds = new Set(currentLibraryItems.map((x: any) => String(x?.id)).filter(Boolean));
  podcastBadgeRunId += 1;
  podcastBadgeQueue = [];
  podcastBadgeRetries.clear();
  setMsg("homeMsg", "", "none");
  const total = el("libraryTotal");
  if (total) {
    const noun = currentLibraryItems.length === 1 ? tr("label.book.singular") : tr("label.book.plural");
    total.textContent = `${name} - ${currentLibraryItems.length} ${noun}`;
  }
  void renderLibraryGrid();
}

function wireSortSelect() {
  const sortSelect = el<HTMLSelectElement>("sortSelect");
  sortSelect.value = appSettings.defaultSort;
  sortSelect.addEventListener("change", async () => {
    if (isVisible("settingsView")) hideSettingsPage();
    if (isVisible("itemDetailView")) await backFromDetail();
    if (currentLibraryItems.length) void renderLibraryGrid();
  });
}

async function renderLibraryGrid() {
  const container = el("libraryItemsView");
  container.innerHTML = "";
  container.classList.add("grid");

  const sort = (el<HTMLSelectElement>("sortSelect")?.value ?? "recent");
  const list = currentLibraryItems.slice();

  function getAddedDate(obj: any): number {
    const candidates = [
      obj?.addedAt,
      obj?.createdAt,
      obj?.media?.addedAt,
      obj?.media?.createdAt,
      obj?.media?.metadata?.addedAt,
      obj?.media?.metadata?.createdAt
    ];
    for (const val of candidates) {
      if (!val) continue;
      if (typeof val === "number" && isFinite(val)) return val;
      if (typeof val === "string") {
        const parsed = Date.parse(val);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return 0;
  }

  if (sort === "az") {
    list.sort((a,b) => (a?.media?.metadata?.title ?? "").localeCompare(b?.media?.metadata?.title ?? "", appSettings.language, { sensitivity: "base" }));
  } else if (sort === "za") {
    list.sort((a,b) => (b?.media?.metadata?.title ?? "").localeCompare(a?.media?.metadata?.title ?? "", appSettings.language, { sensitivity: "base" }));
  } else if (sort === "oldest") {
    list.sort((a, b) => getAddedDate(a) - getAddedDate(b));
  } else if (sort === "recent") {
    list.sort((a, b) => getAddedDate(b) - getAddedDate(a));
  }

  const { serverUrl, username } = getSaved();
  const isPodcastLibrary = String(currentLibraryMediaType || "").toLowerCase() === "podcast";

  for (const it of list) {
    const itemId = it?.id;
    if (!itemId) continue;

    const title = it?.media?.metadata?.title ?? "Item";
    const author = it?.media?.metadata?.authorName ?? "";

    const card = document.createElement("div");
    card.className = "book-card";

    const coverWrap = document.createElement("div");
    coverWrap.className = "cover-wrap";

    const bgImg = document.createElement("img");
    bgImg.className = "book-cover-bg";
    bgImg.loading = "lazy";
    bgImg.decoding = "async";
    bgImg.alt = "";
    bgImg.setAttribute("aria-hidden", "true");

    const img = document.createElement("img");
    img.className = "book-cover"; img.loading = "lazy"; img.decoding = "async"; img.alt = title;
    invoke<string>("abs_get_cover_url", { serverUrl, username, itemId })
      .then((url) => { applyCardCoverWithFallback(img, bgImg, url); })
      .catch(() => { applyCardCoverWithFallback(img, bgImg, ""); });

    const doneBadge = document.createElement("div");
    doneBadge.textContent = "✓";
    doneBadge.style.position = "absolute";
    doneBadge.style.top = "8px";
    doneBadge.style.right = "8px";
    doneBadge.style.width = "22px";
    doneBadge.style.height = "22px";
    doneBadge.style.borderRadius = "999px";
    doneBadge.style.display = "none";
    doneBadge.style.alignItems = "center";
    doneBadge.style.justifyContent = "center";
    doneBadge.style.background = "#10b981";
    doneBadge.style.color = "#fff";
    doneBadge.style.fontWeight = "800";
    doneBadge.style.fontSize = "14px";
    doneBadge.style.zIndex = "5";
    doneBadge.dataset.libraryDoneItem = String(itemId);

    const offlineProgressBadge = document.createElement("div");
    offlineProgressBadge.className = "offline-progress-badge";
    offlineProgressBadge.style.display = "none";
    offlineProgressBadge.dataset.offlineProgressItem = String(itemId);

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.textContent = "⋯";
    menuBtn.className = "app-menu-btn";

    const menu = document.createElement("div");
    menu.style.position = "absolute";
    menu.style.right = "8px";
    menu.style.bottom = "40px";
    menu.className = "app-popup-menu";

    const markPlayedBtn = document.createElement("button");
    markPlayedBtn.type = "button";
    markPlayedBtn.textContent = tr("menu.markPlayed");
    markPlayedBtn.className = "app-popup-action app-popup-action--primary";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = tr("menu.resetUnplayed");
    resetBtn.className = "app-popup-action";
    resetBtn.style.display = "none";

    const downloadOfflineBtn = document.createElement("button");
    downloadOfflineBtn.type = "button";
    downloadOfflineBtn.textContent = tr("menu.downloadOffline");
    downloadOfflineBtn.className = "app-popup-action";

    const removeOfflineBtn = document.createElement("button");
    removeOfflineBtn.type = "button";
    removeOfflineBtn.textContent = tr("menu.removeOffline");
    removeOfflineBtn.className = "app-popup-action";
    removeOfflineBtn.style.display = "none";

    menu.append(markPlayedBtn, resetBtn, downloadOfflineBtn, removeOfflineBtn);

    menuBtn.onclick = (ev) => {
      ev.stopPropagation();
      togglePopupMenu(menu);
    };

    markPlayedBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await invoke("abs_mark_played", { serverUrl, username, itemId, episodeId: null });
      setLibraryItemDoneState(String(itemId), true);
      await maybeAutoRemoveOfflineItem(String(itemId));
      removeOfflineBtn.style.display = "none";
      resetBtn.style.display = "";
      menu.style.display = "none";
      scheduleContinueRefresh(0);
    };

    resetBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await invoke("abs_mark_unplayed", { serverUrl, username, itemId, episodeId: null });
      menu.style.display = "none";
      setLibraryItemDoneState(String(itemId), false);
      // Döljer bocken och återställ-knappen, visar markera som spelad
      doneBadge.style.display = "none";
      resetBtn.style.display = "none";
      markPlayedBtn.style.display = "";
      scheduleContinueRefresh(0);
    };

    downloadOfflineBtn.onclick = async (ev) => {
      ev.stopPropagation();
      downloadOfflineBtn.disabled = true;
      try {
        await downloadOfflineItem(String(itemId));
        removeOfflineBtn.style.display = "";
      } catch (err) {
        console.log("offline download failed", err);
      } finally {
        downloadOfflineBtn.disabled = false;
        menu.style.display = "none";
      }
    };

    removeOfflineBtn.onclick = async (ev) => {
      ev.stopPropagation();
      removeOfflineBtn.disabled = true;
      try {
        await removeOfflineItem(String(itemId));
        removeOfflineBtn.style.display = "none";
      } catch (err) {
        console.log("offline remove failed", err);
      } finally {
        removeOfflineBtn.disabled = false;
        menu.style.display = "none";
      }
    };

    const meta = document.createElement("div");
    meta.className = "book-meta";

    meta.innerHTML =
    `
    <p class="book-title"></p>
    <p class="book-sub"></p>
    `;

    (meta.children[0] as HTMLElement).textContent = title;
    (meta.children[1] as HTMLElement).textContent = isPodcastLibrary
      ? (it?.media?.metadata?.author ?? "")
      : (appSettings.showAuthor ? author : "");

    if (isPodcastLibrary) {
      queuePodcastLibraryDoneState(String(itemId));
    } else {
      invoke<any>("abs_get_progress", { serverUrl, username, itemId, episodeId: null })
        .then((p) => {
          if (isFinishedProgress(p)) doneBadge.style.display = "flex";
          if (p && (isFinishedProgress(p) || (p.currentTime ?? 0) > 0 || (p.progress ?? 0) > 0)) {
            resetBtn.style.display = "";
          }
        })
        .catch(() => {});
    }

    void getOfflineItemStatus(String(itemId)).then((st) => {
      removeOfflineBtn.style.display = st.exists ? "" : "none";
    });

    coverWrap.append(img, doneBadge, offlineProgressBadge, menuBtn, menu);

    updateOfflineProgressUi(String(itemId));
    coverWrap.prepend(bgImg);
    card.append(coverWrap, meta);
    card.onclick = () => showItemDetail(String(itemId));
    container.appendChild(card);
  }
}

/* ---------------- Detail / audio ---------------- */
async function showItemDetail(itemId: string, opts?: { focusEpisodeId?: string | null; focusEpisodeIndex?: number | null }) {
  setContinueVisible(false);
  const { serverUrl, username } = getSaved();
  currentItemId = itemId;
  clearSearchFocusedChapter();

  show(el("libraryItemsView"), false);
  show(el("settingsView"), false);
  show(el("playlistView"), false);
  show(el("itemDetailView"), true);

  const item = await getItemCached(serverUrl, username, itemId, true);
  const isPodcastItem =
    Array.isArray(item?.media?.episodes) ||
    Array.isArray(item?.media?.episodeContent) ||
    String(item?.mediaType ?? item?.library?.mediaType ?? "").toLowerCase() === "podcast";
  const title = item?.media?.metadata?.title ?? tr("common.item");
  const author = item?.media?.metadata?.authorName ?? "";
  const desc = item?.media?.metadata?.description ?? "";

  hasStartedPlayback = false;
  currentItemFinished = false;

  if (!isPodcastItem) {
    try {
      const itemProgress = await invoke<any>("abs_get_progress", { serverUrl, username, itemId, episodeId: null });
      currentItemFinished = isFinishedProgress(itemProgress);
      if (currentItemFinished) progressByItemId.set(itemId, { currentTime: 0 });
    } catch {}
  }

  let coverUrl = "";
  try { coverUrl = await invoke<string>("abs_get_cover_url", { serverUrl, username, itemId }); } catch {}

  const startAt = progressByItemId.get(itemId)?.currentTime ?? 0;
  // If locally at 0 (mark as unplayed), show "Play" even if server says finished
  const effectivelyFinished = currentItemFinished && startAt > 0;
  const playLabel = effectivelyFinished
    ? `▶ ${tr("common.playAgain")}`
    : (startAt > 0 ? `▶ ${tr("common.resume")}` : `▶ ${tr("common.play")}`);

  const detail = el<HTMLDivElement>("itemDetailView");
  detail.innerHTML = `
  <div class="card">
  <div class="detail-layout">

  <div class="detail-actions">
  <button id="backBtn">← ${tr("common.back")}</button>
  <button id="resumeBtn">${playLabel}</button>
  <button id="detailMarkPlayedBtn">✓ ${tr("menu.markPlayed")}</button>
  ${(currentItemFinished || startAt > 0) ? `<button id="detailMarkUnplayedBtn">↻ ${tr("menu.resetUnplayed")}</button>` : `<button id="detailMarkUnplayedBtn" style="display:none">↻ ${tr("menu.resetUnplayed")}</button>`}
  ${isPodcastItem ? `<button id="detailPlayNextBtn">▶ ${tr("podcast.playNext")}</button>` : ""}
  <button id="detailDownloadOfflineBtn">↓ ${tr("menu.downloadOffline")}</button>
  <button id="detailRemoveOfflineBtn" style="display:none">🗑 ${tr("menu.removeOffline")}</button>
  ${isPodcastItem ? `<label class="detail-sort-control" for="detailPodcastFilter"><span>${tr("podcast.filter.label")}</span><select id="detailPodcastFilter"><option value="all" ${detailPodcastFilterMode === "all" ? "selected" : ""}>${tr("podcast.filter.all")}</option><option value="unplayed" ${detailPodcastFilterMode === "unplayed" ? "selected" : ""}>${tr("podcast.filter.unplayed")}</option><option value="downloaded" ${detailPodcastFilterMode === "downloaded" ? "selected" : ""}>${tr("podcast.filter.downloaded")}</option></select></label>` : ""}
  ${isPodcastItem ? `<label class="detail-sort-control" for="detailPodcastSort"><span>${tr("podcast.sort.label")}</span><select id="detailPodcastSort"><option value="oldest" ${detailPodcastSortMode === "oldest" ? "selected" : ""}>${tr("podcast.sort.oldest")}</option><option value="latest" ${detailPodcastSortMode === "latest" ? "selected" : ""}>${tr("podcast.sort.latest")}</option><option value="name" ${detailPodcastSortMode === "name" ? "selected" : ""}>${tr("podcast.sort.name")}</option></select></label>` : ""}
  <span id="detailOfflineProgress" style="display:none"></span>
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

  const detailCover = document.getElementById("detailCover") as HTMLImageElement | null;
  if (detailCover) {
    detailCover.src = coverUrl?.trim() ? coverUrl : coverMissingUrl;
    detailCover.alt = title;
    detailCover.loading = "lazy";
    detailCover.style.width = "140px";
    detailCover.style.borderRadius = "12px";
    detailCover.style.background = "rgba(127,127,127,.15)";
    detailCover.onerror = () => {
      detailCover.onerror = null;
      detailCover.src = coverMissingUrl;
    };
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

  const displayEntries = currentFiles.map((file, canonicalIndex) => ({ file, canonicalIndex }));
  if (isPodcastItem) {
    const hasAnyPublishedTs = displayEntries.some((entry) => getPodcastEpisodePublishedAtTs(entry.file) > 0);

    if (detailPodcastSortMode === "latest") {
      if (hasAnyPublishedTs) {
        displayEntries.sort((a, b) => {
          const ta = getPodcastEpisodePublishedAtTs(a.file);
          const tb = getPodcastEpisodePublishedAtTs(b.file);
          if (tb !== ta) return tb - ta;
          return a.canonicalIndex - b.canonicalIndex;
        });
      } else {
        // Most podcast feeds are naturally newest-first.
        displayEntries.sort((a, b) => a.canonicalIndex - b.canonicalIndex);
      }
    } else if (detailPodcastSortMode === "oldest") {
      if (hasAnyPublishedTs) {
        displayEntries.sort((a, b) => {
          const ta = getPodcastEpisodePublishedAtTs(a.file);
          const tb = getPodcastEpisodePublishedAtTs(b.file);
          if (ta !== tb) return ta - tb;
          return a.canonicalIndex - b.canonicalIndex;
        });
      } else {
        // Without publish dates, invert feed order so oldest appears first.
        displayEntries.sort((a, b) => b.canonicalIndex - a.canonicalIndex);
      }
    } else if (detailPodcastSortMode === "name") {
      const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
      displayEntries.sort((a, b) =>
        collator.compare(
          getTrackDisplayName(a.file, a.canonicalIndex),
          getTrackDisplayName(b.file, b.canonicalIndex)
        )
      );
    }
  }

  const offlineItemStatus = await getOfflineItemStatus(itemId);
  const downloadedEpisodeIds = isPodcastItem
    ? await getOfflineEpisodeIds(itemId)
    : new Set<string>();
  const finishedEpisodeIds = isPodcastItem
    ? await getPodcastFinishedEpisodeIds(
      serverUrl,
      username,
      itemId,
      displayEntries.map((e) => e.file?.id ? String(e.file.id) : "")
    )
    : new Set<string>();

  if (isPodcastItem && detailPodcastFilterMode !== "all") {
    const filtered = displayEntries.filter((entry) => {
      const episodeId = entry.file?.id ? String(entry.file.id) : "";
      if (!episodeId) return detailPodcastFilterMode !== "downloaded";
      if (detailPodcastFilterMode === "downloaded") return downloadedEpisodeIds.has(episodeId);
      if (detailPodcastFilterMode === "unplayed") return !finishedEpisodeIds.has(episodeId);
      return true;
    });
    displayEntries.length = 0;
    displayEntries.push(...filtered);
  }
  
  // 🔥 PREBUFFER RESUME CHAPTER

  try {

    const progress =
    progressByItemId.get(itemId)?.currentTime || 0

    const pos = getChapterIndexFromTime(progress)
    getSaved()

    const file = currentFiles[pos.index];
    const fileId = file?.audioFile?.ino || file?.ino;

    const nextUrl = await getChapterPlaybackUrl(itemId, pos.index, String(fileId ?? ""));

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
  const chapterEpisodeIds: (string | null)[] = [];
  list.style.marginTop = "18px";

  for (const entry of displayEntries) {
    const f = entry.file;
    const canonicalIndex = entry.canonicalIndex;

    const row = document.createElement("div");
    row.classList.add("detail-chapter-row");
    row.dataset.chapterIndex = String(canonicalIndex);
    chapterRows.push(row)
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.padding = "6px 0";
    row.style.borderBottom = "1px solid rgba(255,255,255,.05)";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "8px";

    const titleEl = document.createElement("span");
    titleEl.textContent = getTrackDisplayName(f, canonicalIndex);

    const rowFavBtn = document.createElement("button");
    rowFavBtn.type = "button";
    rowFavBtn.className = "chapter-fav-btn";
    rowFavBtn.title = tr("playlist.add");
    rowFavBtn.textContent = "♡";

    left.append(rowFavBtn, titleEl);

    // Handle both audiobook files (duration) and podcast episodes (audioFile.duration)
    const episodeDuration = f?.duration || f?.audioFile?.duration || f?.audioLength || 0;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";

    const durEl = document.createElement("div");
    durEl.style.opacity = "0.7";
    durEl.textContent = fmt(episodeDuration);

    const done = document.createElement("div");
    done.textContent = "✓";
    done.style.display = "none";
    done.style.width = "20px";
    done.style.height = "20px";
    done.style.borderRadius = "999px";
    done.style.alignItems = "center";
    done.style.justifyContent = "center";
    done.style.background = "#10b981";
    done.style.color = "#fff";
    done.style.fontWeight = "800";
    done.style.fontSize = "13px";

    const offlineDot = document.createElement("span");
    offlineDot.className = "chapter-offline-dot";
    offlineDot.title = tr("menu.downloadOffline");

    const rowMenuBtn = document.createElement("button");
    rowMenuBtn.type = "button";
    rowMenuBtn.textContent = "⋯";
    rowMenuBtn.className = "chapter-menu-btn";

    const rowMenu = document.createElement("div");
    rowMenu.style.position = "absolute";
    rowMenu.style.right = "10px";
    rowMenu.style.marginTop = "30px";
    rowMenu.className = "app-popup-menu";

    const rowMarkPlayed = document.createElement("button");
    rowMarkPlayed.type = "button";
    rowMarkPlayed.textContent = tr("menu.markPlayed");
    rowMarkPlayed.className = "app-popup-action app-popup-action--primary";

    const rowReset = document.createElement("button");
    rowReset.type = "button";
    rowReset.textContent = tr("menu.resetUnplayed");
    rowReset.className = "app-popup-action";
    rowReset.style.display = "none";

    const rowOfflineBtn = document.createElement("button");
    rowOfflineBtn.type = "button";
    rowOfflineBtn.className = "app-popup-action";

    rowMenu.append(rowMarkPlayed, rowReset, rowOfflineBtn);

    row.style.position = "relative";

    rowMenuBtn.onclick = (ev) => {
      ev.stopPropagation();
      togglePopupMenu(rowMenu);
    };

    const episodeId = f?.id ? String(f.id) : null;
    chapterEpisodeIds[canonicalIndex] = episodeId;
    let episodeOfflineAvailable = Boolean(episodeId && downloadedEpisodeIds.has(episodeId));
    if (!isPodcastItem && offlineItemStatus.exists) {
      episodeOfflineAvailable = true;
    }
    offlineDot.style.display = episodeOfflineAvailable ? "inline-flex" : "none";
    rowOfflineBtn.textContent = episodeOfflineAvailable
      ? tr("menu.removeEpisodeOffline")
      : tr("menu.downloadEpisodeOffline");

    if (episodeId && finishedEpisodeIds.has(episodeId)) {
      done.style.display = "flex";
      rowReset.style.display = "";
    }

    if (isPodcastItem && episodeId) {
      invoke<any>("abs_get_progress", { serverUrl, username, itemId, episodeId }).then((epProgress) => {
        if (isFinishedProgress(epProgress)) {
          done.style.display = "flex";
          finishedEpisodeIds.add(episodeId);
        }
        if (epProgress && (isFinishedProgress(epProgress) || (epProgress.currentTime ?? 0) > 0 || (epProgress.progress ?? 0) > 0)) {
          rowReset.style.display = "";
        }
      }).catch(() => {});

      rowMarkPlayed.onclick = async (ev) => {
        ev.stopPropagation();
        await invoke("abs_mark_played", { serverUrl, username, itemId, episodeId });
        done.style.display = "flex";
        finishedEpisodeIds.add(episodeId);
        rowMenu.style.display = "none";
        queuePodcastLibraryDoneState(String(itemId));
        scheduleContinueRefresh(0);
        removeContinueCard(itemId, episodeId);
      };

      rowReset.onclick = async (ev) => {
        ev.stopPropagation();
        await invoke("abs_mark_unplayed", { serverUrl, username, itemId, episodeId });
        done.style.display = "none";
        finishedEpisodeIds.delete(episodeId);
        rowMenu.style.display = "none";
        queuePodcastLibraryDoneState(String(itemId));
        scheduleContinueRefresh(0);
      };

      rowOfflineBtn.onclick = async (ev) => {
        ev.stopPropagation();
        rowOfflineBtn.disabled = true;
        try {
          if (episodeOfflineAvailable) {
            await removeOfflineEpisode(itemId, episodeId);
            episodeOfflineAvailable = false;
          } else {
            await downloadOfflineEpisode(itemId, episodeId);
            episodeOfflineAvailable = true;
          }
          rowOfflineBtn.textContent = episodeOfflineAvailable
            ? tr("menu.removeEpisodeOffline")
            : tr("menu.downloadEpisodeOffline");
          offlineDot.style.display = episodeOfflineAvailable ? "inline-flex" : "none";
        } catch (err) {
          console.log("episode offline toggle fail", err);
        } finally {
          rowOfflineBtn.disabled = false;
          rowMenu.style.display = "none";
        }
      };

      rowFavBtn.onclick = async (ev: Event) => {
        ev.stopPropagation();
        if (!currentItemId || !episodeId) return;
        const isInPlaylist = Features.isInPlaylist(currentItemId, episodeId);
        if (isInPlaylist) {
          Features.removeFromPlaylist(currentItemId, episodeId);
          rowFavBtn.textContent = "♡";
          rowFavBtn.title = tr("playlist.add");
        } else {
          Features.addToPlaylist({
            itemId: currentItemId,
            episodeId,
            episodeTitle: String(f?.title || episodeId),
            podcastTitle: String(item?.media?.metadata?.title || ""),
          });
          rowFavBtn.textContent = "♥";
          rowFavBtn.title = tr("playlist.remove");
        }
        await renderPlaylist();
      };

      // Set initial text
      const isInPlaylist = Features.isInPlaylist(currentItemId, episodeId);
      rowFavBtn.textContent = isInPlaylist ? "♥" : "♡";
      rowFavBtn.title = isInPlaylist ? tr("playlist.remove") : tr("playlist.add");
    } else {
      rowMenuBtn.style.display = "none";
      rowMenu.style.display = "none";
      rowOfflineBtn.style.display = "none";
      rowFavBtn.style.display = "none";
    }

    right.append(durEl, offlineDot, done, rowMenuBtn);
    row.appendChild(left);
    row.appendChild(right);
    row.appendChild(rowMenu);
    list.appendChild(row);
    row.style.cursor = "pointer";

    row.onclick = async () => {
      clearSearchFocusedChapter();
      await playChapter(itemId, canonicalIndex, true);
    };
  }

  detail.querySelector(".card")?.appendChild(list);
  currentChapterRows = chapterRows

  const targetEpisodeId = opts?.focusEpisodeId ? String(opts.focusEpisodeId) : null;
  let targetIndex = typeof opts?.focusEpisodeIndex === "number" ? opts.focusEpisodeIndex : -1;
  if (targetEpisodeId) {
    const byId = chapterEpisodeIds.findIndex((id) => id === targetEpisodeId);
    if (byId >= 0) targetIndex = byId;
  }
  if (targetIndex >= 0) {
    focusDetailChapterRow(targetIndex);
  }

  const detailPlayNextBtn = document.getElementById("detailPlayNextBtn") as HTMLButtonElement | null;
  if (detailPlayNextBtn) {
    detailPlayNextBtn.onclick = async () => {
      const next = currentItemId === itemId
        ? Math.min(currentChapterIndex + 1, Math.max(0, currentFiles.length - 1))
        : 0;
      await playChapter(itemId, next, true);
    };
  }

  const detailPodcastFilter = document.getElementById("detailPodcastFilter") as HTMLSelectElement | null;
  if (detailPodcastFilter) {
    detailPodcastFilter.onchange = () => {
      const next = detailPodcastFilter.value === "downloaded" || detailPodcastFilter.value === "unplayed"
        ? detailPodcastFilter.value
        : "all";
      if (next === detailPodcastFilterMode) return;
      detailPodcastFilterMode = next;
      void showItemDetail(itemId, opts);
    };
  }

  const detailPodcastSort = document.getElementById("detailPodcastSort") as HTMLSelectElement | null;
  if (detailPodcastSort) {
    detailPodcastSort.onchange = () => {
      const next = detailPodcastSort.value === "latest" || detailPodcastSort.value === "name"
        ? detailPodcastSort.value
        : "oldest";
      if (next === detailPodcastSortMode) return;
      detailPodcastSortMode = next;
      void showItemDetail(itemId, opts);
    };
  }

  // ===== DETAIL VIEW MARK PLAYED/UNPLAYED BUTTONS =====
  const detailMarkPlayedBtn = el<HTMLButtonElement>("detailMarkPlayedBtn");
  if (detailMarkPlayedBtn) {
    detailMarkPlayedBtn.onclick = async (ev) => {
      ev.stopPropagation();
      try {
        await invoke("abs_mark_played", { serverUrl, username, itemId, episodeId: null });
        await maybeAutoRemoveOfflineItem(itemId);
        currentItemFinished = true;
        progressByItemId.set(itemId, { currentTime: sumDurationsFromItem(item) });
        await showItemDetail(itemId);
        setLibraryItemDoneState(String(itemId), true);
        void scheduleContinueRefresh(0);
      } catch (e) {
        console.log("detail mark played fail", e);
      }
    };
  }

  const detailMarkUnplayedBtn = el<HTMLButtonElement>("detailMarkUnplayedBtn");
  if (detailMarkUnplayedBtn) {
    detailMarkUnplayedBtn.onclick = async (ev) => {
      ev.stopPropagation();
      try {
        await invoke("abs_mark_unplayed", { serverUrl, username, itemId, episodeId: null });
        currentItemFinished = false;
        progressByItemId.set(itemId, { currentTime: 0 });
        await showItemDetail(itemId);
        setLibraryItemDoneState(String(itemId), false);
        void scheduleContinueRefresh(0);
      } catch (e) {
        console.log("detail mark unplayed fail", e);
      }
    };
  }

  const detailDownloadOfflineBtn = document.getElementById("detailDownloadOfflineBtn") as HTMLButtonElement | null;
  const detailRemoveOfflineBtn = document.getElementById("detailRemoveOfflineBtn") as HTMLButtonElement | null;

  if (detailRemoveOfflineBtn) detailRemoveOfflineBtn.style.display = offlineItemStatus.exists ? "" : "none";

  if (detailDownloadOfflineBtn) {
    detailDownloadOfflineBtn.onclick = async (ev) => {
      ev.stopPropagation();
      detailDownloadOfflineBtn.disabled = true;
      try {
        await downloadOfflineItem(itemId);
        if (detailRemoveOfflineBtn) detailRemoveOfflineBtn.style.display = "";
      } catch (e) {
        console.log("detail offline download fail", e);
      } finally {
        detailDownloadOfflineBtn.disabled = false;
      }
    };
  }

  updateOfflineProgressUi(itemId);

  if (detailRemoveOfflineBtn) {
    detailRemoveOfflineBtn.onclick = async (ev) => {
      ev.stopPropagation();
      detailRemoveOfflineBtn.disabled = true;
      try {
        await removeOfflineItem(itemId);
        detailRemoveOfflineBtn.style.display = "none";
      } catch (e) {
        console.log("detail offline remove fail", e);
      } finally {
        detailRemoveOfflineBtn.disabled = false;
      }
    };
  }
  // ===== END DETAIL VIEW MARK BUTTONS =====
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

async function playChapter(itemId: string, index: number, openNowPlaying = false) {

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

    currentChapterIndex = index;
    currentItemId = itemId;
    currentEpisodeId = currentFiles[index]?.audioFile !== undefined ? (currentFiles[index]?.id ?? null) : null;
    hasStartedPlayback = true;
    currentItemFinished = false;
    highlightChapter(index)

    const audio = el<HTMLAudioElement>("player");
    audio.volume = Math.max(0, Math.min(1, appSettings.defaultVolume / 100));
    audio.style.display = "";

    if (appSettings.autoDownloadOnPlay) {
      const cachedAvailable = offlineAvailableByItemId.get(itemId) === true;
      const downloading = offlineDownloadProgressByItemId.get(itemId)?.status === "downloading";
      if (!cachedAvailable && !downloading) {
        void (async () => {
          try {
            const st = await getOfflineItemStatus(itemId);
            if (!st.exists) await downloadOfflineItem(itemId);
          } catch (err) {
            console.log("auto offline download fail", err);
          }
        })();
      }
    }

    const f = currentFiles[index];
    if (!f) return;

    // Episodes use audioFile.ino, audiofiles use ino
    const fileIno = currentFiles[index].audioFile?.ino || currentFiles[index].ino;

    console.log("[play-debug] playChapter start", {
      itemId,
      index,
      openNowPlaying,
      fileIno,
      currentEpisodeId,
      mediaType: currentLibraryMediaType,
      isPodcast: currentFiles[0]?.audioFile !== undefined,
      fileTitle: f?.title ?? null,
      fileDuration: f?.duration ?? f?.audioFile?.duration ?? null,
    });

    const url = await getChapterPlaybackUrl(itemId, index, String(fileIno ?? ""));

    console.log("[play-debug] local playback url", {
      itemId,
      index,
      fileIno,
      url,
    });

    const requestId = ++playbackRequestId;

    // Completely reset audio element to clear any bad state
    audio.pause();
    audio.onerror = null;
    audio.onloadedmetadata = null;
    audio.currentTime = 0;
    audio.src = "";
    
    // Small delay to let previous state clear
    await new Promise(resolve => setTimeout(resolve, 100));
    
    audio.src = url;
    console.log("[play-debug] audio src assigned", {
      requestedUrl: url,
      audioSrc: audio.src,
      currentSrc: audio.currentSrc,
    });
    beginPlaybackLoading(audio)
    audio.preload = "auto"
    
    // Add error handler with one-shot fallback to resolved playback URL.
    let audioFallbackTried = false;
    audio.onerror = () => {
      if (requestId !== playbackRequestId) {
        console.log("[play-debug] ignoring stale audio error", { requestId, playbackRequestId });
        return;
      }
      console.log("[play-debug] audio error", {
        message: audio.error?.message ?? null,
        code: audio.error?.code ?? null,
        networkState: audio.networkState,
        readyState: audio.readyState,
        currentSrc: audio.currentSrc || audio.src,
        currentTime: audio.currentTime,
        duration: audio.duration,
      });
      playbackLoadingActive = false;
      setPlaybackLoading(false);

      if (audioFallbackTried) {
        isLoadingChapter = false;
        return;
      }

      audioFallbackTried = true;
      void (async () => {
        try {
          const fallbackUrl = await invoke<string>("abs_resolve_playback_url", {
            serverUrl,
            username,
            itemId,
            episodeId: isPodcast ? currentEpisodeId : null
          });

          console.log("[play-debug] retrying with fallback playback url", {
            itemId,
            index,
            fileIno,
            fallbackUrl,
          });

          audio.pause();
          audio.onerror = null;
          audio.onloadedmetadata = null;
          audio.currentTime = 0;

          // WebKitGTK (Tauri/Linux) plays HLS .m3u8 natively via GStreamer,
          // so treat all fallback URLs (including HLS) the same way.
          audio.src = fallbackUrl;
          beginPlaybackLoading(audio);
          audio.preload = "auto";

          audio.onerror = () => {
            if (requestId !== playbackRequestId) return;
            console.log("[play-debug] fallback audio error", {
              message: audio.error?.message ?? null,
              code: audio.error?.code ?? null,
              networkState: audio.networkState,
              readyState: audio.readyState,
              currentSrc: audio.currentSrc || audio.src,
            });
            playbackLoadingActive = false;
            setPlaybackLoading(false);
            isLoadingChapter = false;
          };

          audio.onloadedmetadata = async () => {
            if (requestId !== playbackRequestId) return;
            console.log("[play-debug] fallback loadedmetadata", {
              currentSrc: audio.currentSrc || audio.src,
              duration: audio.duration,
              readyState: audio.readyState,
            });

            if (forcedSeekTime !== null) {
              audio.currentTime = forcedSeekTime;
              forcedSeekTime = null;
            }

            resetPlaybackLoadingAnchor(audio);

            try {
              await audio.play();
              console.log("[play-debug] fallback audio.play resolved", {
                currentSrc: audio.currentSrc || audio.src,
                currentTime: audio.currentTime,
              });
            } catch (e) {
              console.log("[play-debug] fallback audio.play failed", {
                error: String(e),
                currentSrc: audio.currentSrc || audio.src,
                readyState: audio.readyState,
                networkState: audio.networkState,
              });
            }
          };

          audio.load();
        } catch (e) {
          console.log("[play-debug] fallback playback url resolution failed", {
            error: String(e),
            itemId,
            index,
          });
          isLoadingChapter = false;
        }
      })();
    };
    
    audio.load()
    console.log("[play-debug] audio.load called", {
      currentSrc: audio.currentSrc || audio.src,
      preload: audio.preload,
    });

    audio.onloadedmetadata = async () => {
      if (requestId !== playbackRequestId) {
        console.log("[play-debug] ignoring stale loadedmetadata", { requestId, playbackRequestId });
        return;
      }
      console.log("[play-debug] loadedmetadata", {
        currentSrc: audio.currentSrc || audio.src,
        duration: audio.duration,
        readyState: audio.readyState,
      });

      if (forcedSeekTime !== null) {
        audio.currentTime = forcedSeekTime
        forcedSeekTime = null

      }

      // Ignore seek jumps when deciding if loading can be hidden.
      resetPlaybackLoadingAnchor(audio)

      try {
        await audio.play()
        console.log("[play-debug] audio.play resolved", {
          currentSrc: audio.currentSrc || audio.src,
          currentTime: audio.currentTime,
        });
      } catch (e) {
        console.log("[play-debug] audio.play failed", {
          error: String(e),
          currentSrc: audio.currentSrc || audio.src,
          readyState: audio.readyState,
          networkState: audio.networkState,
        })
      }

    }

    setPlaybackButtons(true)
    if (openNowPlaying) openNowPlayingPanel();
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
        const item = await getItemCached(serverUrl, username, itemId)
        title = currentFile?.title || item?.media?.metadata?.title || ""
        author = item?.media?.metadata?.authorName || ""
      }
      
      let cover = ""
      try {
        cover = await invoke<string>("abs_get_cover_url",{serverUrl,username,itemId})
      } catch {}

      showMiniPlayer(title,author,cover)
      startMiniTicker()

    }catch{}
    // 🔥 preload nästa kapitel
    try {

      const next = index + 1

      if (next < currentFiles.length) {

        const nextFile = currentFiles[next];
        const nextIno = nextFile?.audioFile?.ino || nextFile?.ino;

        const nextUrl = await getChapterPlaybackUrl(itemId, next, String(nextIno ?? ""));

        preloadAudio.src = nextUrl

      }

    } catch (e) {
      console.log("preload fail", e)
    }
    // 🔥 refresha Continue efter playback start


    audio.onended = async () => {

      if (favoritesQueueActive) {
        const nextFavIndex = favoritesQueueIndex + 1;
        if (nextFavIndex < favoritesQueue.length) {
          const nextFav = favoritesQueue[nextFavIndex];
          favoritesQueueIndex = nextFavIndex;

          favoritesQueueTransition = true;
          try {
            await preparePlaybackItem(nextFav.itemId);
            const idx = currentFiles.findIndex((x: any) => String(x?.id) === String(nextFav.episodeId));
            if (idx >= 0) {
              forcedSeekTime = 0;
              await playChapter(nextFav.itemId, idx, true);
              return;
            }
            stopFavoritesQueue();
          } finally {
            favoritesQueueTransition = false;
          }
        } else {
          stopFavoritesQueue();
          await stopPlaybackSession();
          if (currentItemId) {
            await maybeAutoRemoveOfflineItem(currentItemId);
          }
          return;
        }
      }

      // Sleep timer: episode mode - stop at episode end without advancing
      if (appSettings.sleepTimerMode === "episode") {
        appSettings.sleepTimerMode = "none";
        sleepTimerStartMs = null;
        saveSettings(appSettings);
        refreshPlaybackControlLabels();
        await stopPlaybackSession();
        if (currentItemId) await maybeAutoRemoveOfflineItem(currentItemId);
        return;
      }

      const next = currentChapterIndex + 1

      if (next < currentFiles.length) {

        forcedSeekTime = 0
          await playChapter(currentItemId!, next)

      } else {

        await stopPlaybackSession()
        if (currentItemId) {
          await maybeAutoRemoveOfflineItem(currentItemId)
        }

        // NEW: Auto-mark as played when finished
        if (appSettings.autoMarkPlayedOnFinish && currentItemId) {
          try {
            await updateProgressWithOfflineFallback(currentItemId, audio.duration, currentEpisodeId);
            // Mark as finished would go here - would need server command
          } catch (e) {}
        }
      }
    }

    audio.onpause = async () => {

      setPlaybackButtons(false)

        const { serverUrl, username } = getSaved()
        const audio = el<HTMLAudioElement>("player")

        await forceSaveProgress()

        const isPodcast = currentFiles[0]?.audioFile !== undefined;
        if (currentSessionId) {

          const absolute = isPodcast
            ? audio.currentTime
            : audio.currentTime + getChapterStart(currentChapterIndex)

          await invoke("abs_sync_session", {
            serverUrl,
            username,
            sessionId: currentSessionId,
            currentTime: absolute
          })

        }

        scheduleContinueRefresh(1200)
    }

    // starta playback session
    try {

      const { serverUrl, username } = getSaved()
      const isPodcast = currentFiles[0]?.audioFile !== undefined;

      const playRes: any = await invoke("abs_start_playback", {
        serverUrl,
        username,
        itemId,
        episodeId: isPodcast ? currentEpisodeId : null
      })

      currentSessionId =
      playRes?.id ||
      playRes?.session?.id ||
      null

      console.log("[play-debug] start playback response", {
        sessionId: currentSessionId,
        keys: playRes && typeof playRes === "object" ? Object.keys(playRes) : [],
        audioTracks: playRes?.audioTracks?.length ?? playRes?.media?.audioTracks?.length ?? null,
      });

      if (currentSessionId) {
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

      // ⭐ INITIAL PROGRESS SAVE
      setTimeout(async () => {

        if (!currentItemId) return

          const audio = el<HTMLAudioElement>("player")
          const isPodcastNow = currentFiles[0]?.audioFile !== undefined;
          const absolute = isPodcastNow
            ? audio.currentTime
            : audio.currentTime + getChapterStart(currentChapterIndex)

          await updateProgressWithOfflineFallback(
            currentItemId,
            absolute,
            isPodcastNow ? currentEpisodeId : null,
          )

      }, 3000);

    } catch (e) {
      console.log("session start fail", e)
    }

    audio.ontimeupdate = () => {

      if (!currentItemId) return

      // ⭐ MINI PLAYER TOTAL PROGRESS (lägg ALLTID först)
      const miniSeek = document.getElementById("miniSeek") as HTMLInputElement | null
      const curLbl = el("miniCurrent")
      const totLbl = el("miniTotal")

      if (currentItemId) {
        const { total, absolute } = getPlaybackTotals(audio)
        const pct = total > 0 ? (absolute / total) * 100 : 0

        if (miniSeek && !isMiniSeekDragging) {
          miniSeek.value = String(Math.max(0, Math.min(100, pct)))
        }
        curLbl.textContent = fmtTime(absolute)
        totLbl.textContent = fmtTime(total)

        syncNowPlayingProgress(audio)
      }


        const now = Date.now()
        const { serverUrl, username } = getSaved()

        const isPodcast = currentFiles[0]?.audioFile !== undefined;

        const syncInterval = 10000;
        if (currentSessionId && now - lastSessionSync > syncInterval) {
          lastSessionSync = now

          const absolute = isPodcast
            ? audio.currentTime
            : audio.currentTime + getChapterStart(currentChapterIndex);

          invoke("abs_sync_session", {
            serverUrl,
            username,
            sessionId: currentSessionId,
            currentTime: absolute
          }).catch(console.error)
        }

        // Save progress for both audiobooks and podcasts (podcasts less frequent).
        const progressInterval = isPodcast ? 120000 : 60000;
        if (now - lastProgressSave > progressInterval) {
          lastProgressSave = now

          const absolute = isPodcast
            ? audio.currentTime
            : audio.currentTime + getChapterStart(currentChapterIndex);

          updateProgressWithOfflineFallback(
            currentItemId,
            absolute,
            isPodcast ? currentEpisodeId : null,
          ).catch(console.error)
        }

        // Sleep timer: minutes modes - stop after elapsed time
        const sleepMode = appSettings.sleepTimerMode;
        if (sleepMode === "minutes" || sleepMode === "minutes60") {
          if (sleepTimerStartMs === null) {
            sleepTimerStartMs = Date.now();
          } else {
            const limitMs = sleepMode === "minutes" ? 30 * 60 * 1000 : 60 * 60 * 1000;
            if (Date.now() - sleepTimerStartMs >= limitMs) {
              appSettings.sleepTimerMode = "none";
              sleepTimerStartMs = null;
              saveSettings(appSettings);
              audio.pause();
              refreshPlaybackControlLabels();
            }
          }
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

      // For podcasts, use just current time; for audiobooks add chapter offset
      const isPodcast = currentFiles[0]?.audioFile !== undefined;
      const absolute = isPodcast
        ? audio.currentTime
        : audio.currentTime + getChapterStart(currentChapterIndex)

      await updateProgressWithOfflineFallback(
        currentItemId,
        absolute,
        isPodcast ? currentEpisodeId : null,
      )

      // ⭐ hämta ny Continue-data direkt från servern (skip for podcasts to avoid 502s)
      if (!isPodcast) {
        scheduleContinueRefresh(0)
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
  currentAppVersion = normalizeVersion(v)
  const settingsEl = document.getElementById("settingsVersion")
  if (settingsEl) settingsEl.textContent = "Bookstory v" + v
  renderUpdateSection(false)
}

async function boot() {
  applySettings();
  Features.loadPlaylist();
  await syncQueuedOfflineProgress();
  window.addEventListener("online", () => {
    void syncQueuedOfflineProgress();
  });
  await listen<{ itemId: string; percent: number; status: "downloading" | "ready" }>(
    "offline-download-progress",
    (event) => {
      const payload = event.payload;
      if (!payload?.itemId) return;
      offlineDownloadProgressByItemId.set(payload.itemId, {
        percent: Math.max(0, Math.min(100, Number(payload.percent) || 0)),
        status: payload.status,
      });
      if (payload.status === "ready") {
        offlineAvailableByItemId.set(payload.itemId, true);
        offlineDownloadProgressByItemId.delete(payload.itemId);
      }
      updateOfflineProgressUi(payload.itemId);
    },
  );

  const audio = el<HTMLAudioElement>("player")
  audio.volume = Math.max(0, Math.min(1, appSettings.defaultVolume / 100))
  audio.addEventListener("timeupdate", () => {
    maybeEndPlaybackLoading(audio);
  })
  audio.addEventListener("playing", () => {
    maybeEndPlaybackLoading(audio);
  })
  audio.addEventListener("play", () => {
    setPlaybackButtons(true);
  })
  audio.addEventListener("pause", () => {
    setPlaybackButtons(false);
    playbackLoadingActive = false;
    setPlaybackLoading(false);
  })
  audio.addEventListener("ended", () => {
    setPlaybackButtons(false);
    playbackLoadingActive = false;
    setPlaybackLoading(false);
  })
  audio.addEventListener("error", () => {
    playbackLoadingActive = false;
    setPlaybackLoading(false);
  })

  el<HTMLInputElement>("miniVolume").value = String(Math.max(0, Math.min(1, appSettings.defaultVolume / 100)))

  el<HTMLInputElement>("miniVolume").oninput = (e) => {

    e.stopPropagation()

    const audio = el<HTMLAudioElement>("player")
    audio.volume = Number((e.target as HTMLInputElement).value)
  }

  const passwordInput = document.getElementById("password") as HTMLInputElement | null;
  if (passwordInput) {
    passwordInput.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      await handleLogin();
    });
  }

  const npSeek = document.getElementById("npSeek") as HTMLInputElement | null
  if (npSeek) {
    npSeek.addEventListener("pointerdown", () => {
      isNowPlayingSeekDragging = true
    })
    npSeek.addEventListener("pointerup", () => {
      isNowPlayingSeekDragging = false
    })
    npSeek.oninput = (e) => {
      const audio = el<HTMLAudioElement>("player")
      const pct = Number((e.target as HTMLInputElement).value) / 100
      const { total } = getPlaybackTotals(audio)
      if (total > 0) {
        const targetAbsolute = total * pct
        const cur = document.getElementById("npCurrent")
        if (cur) cur.textContent = fmtTime(targetAbsolute)
      }
      syncNowPlayingProgress(audio)
    }
    npSeek.onchange = (e) => {
      const audio = el<HTMLAudioElement>("player")
      const pct = Number((e.target as HTMLInputElement).value) / 100
      seekPlaybackToPercent(audio, pct)
      syncNowPlayingProgress(audio)
    }
  }

  const miniSeek = document.getElementById("miniSeek") as HTMLInputElement | null
  if (miniSeek) {
    miniSeek.addEventListener("click", (e) => e.stopPropagation())
    miniSeek.addEventListener("pointerdown", (e) => {
      e.stopPropagation()
      isMiniSeekDragging = true
    })
    miniSeek.addEventListener("pointerup", (e) => {
      e.stopPropagation()
      isMiniSeekDragging = false
    })
    miniSeek.oninput = (e) => {
      e.stopPropagation()
      const audio = el<HTMLAudioElement>("player")
      const pct = Number((e.target as HTMLInputElement).value) / 100
      const { total } = getPlaybackTotals(audio)
      if (total > 0) {
        const targetAbsolute = total * pct
        const curLbl = document.getElementById("miniCurrent")
        if (curLbl) curLbl.textContent = fmtTime(targetAbsolute)
      }
    }
    miniSeek.onchange = (e) => {
      e.stopPropagation()
      const audio = el<HTMLAudioElement>("player")
      const pct = Number((e.target as HTMLInputElement).value) / 100
      seekPlaybackToPercent(audio, pct)
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
  void checkForUpdates()
}

window.addEventListener("beforeunload", () => {
  forceSaveProgress()
  //  stopPlaybackSession()
})


boot();

window.addEventListener("load", showAppVersion);
