// ============================================================================
// NEW BOOKSTORY FEATURES: Playback speed, Sleep timer, Playlist, Auto-mark
// ============================================================================

export type PlaylistEntry = {
  key: string;
  itemId: string;
  episodeId: string;
  episodeTitle: string;
  podcastTitle: string;
  addedAt: number;
};

// Global state for new features
export let PLAYLIST_ITEMS: PlaylistEntry[] = [];
export let SLEEP_TIMER_ACTIVE = false;
export let SLEEP_TIMER_END_TIME = 0;
export let SLEEP_TIMER_HANDLE: ReturnType<typeof setTimeout> | null = null;

// Load playlist from localStorage
export function loadPlaylist() {
  try {
    const saved = localStorage.getItem("bookstory_playlist");
    if (saved) {
      const items = JSON.parse(saved);
      if (Array.isArray(items)) {
        PLAYLIST_ITEMS = items
          .map((x: any) => {
            // Ignore legacy item-only entries; favorites are now episode-based.
            if (typeof x === "string") return null;
            if (x && typeof x === "object" && typeof x.itemId === "string") {
              const episodeId = String(x.episodeId ?? "legacy");
              if (!episodeId || episodeId === "legacy") return null;
              return {
                key: `${x.itemId}:${episodeId}`,
                itemId: x.itemId,
                episodeId,
                episodeTitle: String(x.episodeTitle ?? ""),
                podcastTitle: String(x.podcastTitle ?? ""),
                addedAt: Number(x.addedAt ?? Date.now()),
              } as PlaylistEntry;
            }
            return null;
          })
          .filter((x: PlaylistEntry | null): x is PlaylistEntry => Boolean(x));
      } else {
        PLAYLIST_ITEMS = [];
      }
    }
  } catch (e) {
    PLAYLIST_ITEMS = [];
  }
}

// Save playlist to localStorage
export function savePlaylist() {
  localStorage.setItem("bookstory_playlist", JSON.stringify(PLAYLIST_ITEMS));
}

// Add episode to playlist
export function addToPlaylist(entry: Omit<PlaylistEntry, "key" | "addedAt">): boolean {
  const itemId = String(entry.itemId || "");
  const episodeId = String(entry.episodeId || "");
  if (!itemId || !episodeId) return false;
  const key = `${itemId}:${episodeId}`;
  if (PLAYLIST_ITEMS.some((x) => x.key === key)) return false;
  PLAYLIST_ITEMS.push({
    key,
    itemId,
    episodeId,
    episodeTitle: String(entry.episodeTitle || ""),
    podcastTitle: String(entry.podcastTitle || ""),
    addedAt: Date.now(),
  });
  savePlaylist();
  return true;
}

// Remove episode from playlist
export function removeFromPlaylist(itemId: string, episodeId: string): boolean {
  const key = `${itemId}:${episodeId}`;
  const next = PLAYLIST_ITEMS.filter((x) => x.key !== key);
  if (next.length === PLAYLIST_ITEMS.length) return false;
  PLAYLIST_ITEMS = next;
  savePlaylist();
  return true;
}

// Check if episode is in playlist
export function isInPlaylist(itemId: string, episodeId: string): boolean {
  const key = `${itemId}:${episodeId}`;
  return PLAYLIST_ITEMS.some((x) => x.key === key);
}

export function getPlaylistEntries(): PlaylistEntry[] {
  return [...PLAYLIST_ITEMS].sort((a, b) => a.addedAt - b.addedAt);
}

// Clear playlist
export function clearPlaylist() {
  PLAYLIST_ITEMS = [];
  savePlaylist();
}

// ============================================================================
// PLAYBACK SPEED CONTROL
// ============================================================================

export function setPlaybackRate(audio: HTMLAudioElement, rate: number) {
  const validRates = [0.75, 1.0, 1.25, 1.5, 2.0];
  const clampedRate = validRates.includes(rate) ? rate : 1.0;
  audio.playbackRate = clampedRate;
  return clampedRate;
}

// ============================================================================
// SLEEP TIMER LOGIC
// ============================================================================

export function setSleepTimer(
  audio: HTMLAudioElement | null,
  mode: "none" | "episode" | "minutes",
  minutes: number = 30,
  onAlarmCallback?: () => void
) {
  // Clear existing timer
  if (SLEEP_TIMER_HANDLE) {
    clearTimeout(SLEEP_TIMER_HANDLE);
    SLEEP_TIMER_HANDLE = null;
  }
  SLEEP_TIMER_ACTIVE = false;
  SLEEP_TIMER_END_TIME = 0;

  if (mode === "none") return;

  const handleSleepAlarm = () => {
    if (audio && !audio.paused) {
      audio.pause();
    }
    SLEEP_TIMER_ACTIVE = false;
    if (onAlarmCallback) onAlarmCallback();
  };

  if (mode === "episode") {
    // When episode ends, timer triggers
    if (audio) {
      const onEnded = () => {
        audio.removeEventListener("ended", onEnded);
        handleSleepAlarm();
      };
      audio.addEventListener("ended", onEnded);
      SLEEP_TIMER_ACTIVE = true;
    }
  } else if (mode === "minutes") {
    const ms = Math.max(1, minutes) * 60 * 1000;
    SLEEP_TIMER_END_TIME = Date.now() + ms;
    SLEEP_TIMER_ACTIVE = true;
    SLEEP_TIMER_HANDLE = setTimeout(() => {
      handleSleepAlarm();
    }, ms);
  }
}

export function stopSleepTimer() {
  if (SLEEP_TIMER_HANDLE) {
    clearTimeout(SLEEP_TIMER_HANDLE);
    SLEEP_TIMER_HANDLE = null;
  }
  SLEEP_TIMER_ACTIVE = false;
  SLEEP_TIMER_END_TIME = 0;
}

export function getSleepTimerRemaining(): number {
  if (!SLEEP_TIMER_ACTIVE || SLEEP_TIMER_END_TIME <= 0) return 0;
  const remaining = SLEEP_TIMER_END_TIME - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000)); // Return seconds
}

// ============================================================================
// AUTO-MARK-PLAYED WHEN FINISHED
// ============================================================================

export async function tryAutoMarkPlayedOnFinish(
  _audio: HTMLAudioElement | null,
  itemId: string | null,
  episodeId: string | null,
  autoMarkEnabled: boolean,
  markCallback?: (itemId: string, episodeId: string | null) => Promise<void>
) {
  if (!autoMarkEnabled || !itemId) return;

  // Debounce: don't mark twice within 5 seconds
  const now = Date.now();
  const lastMark = parseInt(localStorage.getItem(`lastMark_${itemId}`) || "0");
  if (now - lastMark < 5000) return;

  localStorage.setItem(`lastMark_${itemId}`, String(now));

  if (markCallback) {
    try {
      await markCallback(itemId, episodeId);
    } catch (e) {
      console.log("auto-mark failed", e);
    }
  }
}

// ============================================================================
// AUTO-STORAGE CLEANUP: Remove oldest offline items when space is low
// ============================================================================

export async function triggerAutoCleanupIfNeeded(
  maxMb: number,
  currentUsedMb: number,
  cleanupCallback?: () => Promise<void>
) {
  // If under 80% usage, no cleanup needed
  if (currentUsedMb < maxMb * 0.8) return;

  console.log(`Auto-cleanup triggered: ${currentUsedMb}MB / ${maxMb}MB`);

  if (cleanupCallback) {
    try {
      await cleanupCallback();
    } catch (e) {
      console.log("auto-cleanup failed", e);
    }
  }
}

// ============================================================================
// UTILITY: Format time for display
// ============================================================================

export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return "0m";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

export {};
