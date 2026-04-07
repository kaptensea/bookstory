# Changelog

All notable changes to this project are documented in this file.

## [1.3.0] - 2026-04-07

### Added
- Linux runtime compatibility fallback in app startup: on Wayland sessions, Bookstory relaunches with `GDK_BACKEND=x11` automatically.
- Additional NVIDIA-specific Wayland safeguard: when NVIDIA GPU is detected, app startup also sets `WEBKIT_DISABLE_COMPOSITING_MODE=1`.
- Relaunch guard environment handling to prevent startup loops when compatibility relaunch is active.
- New sort mode: `Oldest added` in sidebar sort select and settings default sort.
- Sidebar section heading for menu actions (Settings / Log out / account info), localized for English, Swedish, and German.
- Offline listening support with local audio playback routing for downloaded items.
- Per-item offline actions in both library cover menu and detail view: download/remove offline files.
- Offline progress queue: progress updates are queued while offline and synced when online.
- Offline download progress events and UI progress badges for active downloads.
- New settings for offline/audio behavior:
	- default volume,
	- max offline storage in MB (`0` = unlimited),
	- auto-download when playback starts,
	- auto-remove offline files when a book is finished.

### Changed
- Linux compatibility handling moved from external launcher/package post-processing to robust in-app startup logic so packaged installers behave like development runs.
- Build and bundle flow simplified to standard Tauri packaging path (no brittle package surgery).
- README and platform docs aligned with runtime compatibility architecture.
- UI polish pass across controls:
	- unified premium green style for primary buttons and key playback controls,
	- Now Playing controls aligned with mini-player style language,
	- consistent green focus/hover frame tone for search, sort, library list, and cover hover states.
- Sort dropdown affordance improved with clearer arrow and stronger visual clarity.
- Settings view expanded with offline management tools and storage usage summary.
- Playback now prefers offline local files when available before falling back to network streaming.
- Automatic storage enforcement removes oldest offline items when configured max storage is exceeded.

### Fixed
- Cover/item three-dot action menu now opens correctly on first click (no double-click behavior).
- Popup menus now close reliably on outside click and coordinate open/close state consistently.
- Mini-player idle title (`Nothing playing`) now uses runtime i18n and updates correctly with selected language.
- Sorting/settings wiring now consistently supports `recent`, `oldest`, `az`, and `za` across load/save/render and translated option labels.
- Removed an unintended Wi-Fi-only download option path; only requested settings (1, 2, 4) are active.

## 1.2.0 - 2026-03-21

### Added
- Global search bar: Search all books and podcasts with instant dropdown results and cover images.

### Changed
- Adjusted mini player opacity for better fallback when blur is disabled (e.g. on NVIDIA).
- Minor UI/UX improvements and bugfixes.

## 1.1.3 - 2026-03-18

### Added
- Local audio proxy now fully supports range requests and Bearer authentication forwarding, enabling reliable seeking and playback of all file formats.
- `forceDirectPlay` fallback path: if direct stream fails, the app requests a raw file URL from the server and routes it through a local `/direct-audio` proxy.
- Additional proxy routes for HLS manifests and segments (`/hls-manifest`, `/hls-segment`) for future codec compatibility.

### Fixed
- Audiobooks in M4B/AAC/MP4 format now play correctly. On Linux, the `gst-libav` package must be installed (see **Audio Codec Requirements** in the README).
- Removed scroll from the Now Playing full-screen view.
- HEAD handler for audio proxy now returns the correct content-type from upstream instead of always reporting `audio/mpeg`.

## 1.1.1 - 2026-03-18

### Fixed
- Pressing Enter in the login password field now triggers the same sign-in flow as the Login button.
- Clicking anywhere in the sidebar now consistently exits open Settings/Detail overlays before navigation.
- Settings button now works as a true toggle (pressing it again closes Settings).
- Library card three-dot action menu now stays visible/clickable above cover layers.
- Added a subtle hover affordance on the three-dot action button for clearer interaction feedback.
- Update banner rendering now works at app startup even before Settings has been opened.

### Changed
- README Quick Install now includes Arch Linux AUR installation (`yay -S bookstory-bin`).

## 1.1.0 - 2026-03-18

### Added
- German localization for the current app UI and settings.
- In-app update checking with platform-aware guidance and release link handling.
- AUR package support for `bookstory-bin`.

### Changed
- Library sorting now uses the selected app language locale instead of always using Swedish collation.
- Library cover cards use a lighter static backdrop instead of the previous blurred background image effect for better responsiveness.

### Fixed
- External release links now open correctly through the Tauri opener plugin.
- Library hover feedback feels more immediate by avoiding the heavier blurred cover treatment in the grid.

## 1.0.0 - 2026-03-18

### Added
- Missing-cover fallback artwork support using `covermissing.svg` across library cards, Continue Listening, detail view, mini player, and Now Playing.
- Settings toggle to show/hide author names on audiobook cards.

### Changed
- Premium UI refresh with updated typography, accent, and glass styling.
- Unified book-card cover presentation across library views and Continue Listening.
- Cover rendering now preserves full cover art (`contain`) and fills side space with blurred background cover when needed.
- Default playback volume now starts at 100%.
- App version display moved to Settings view.

### Fixed
- Mark as unplayed now correctly syncs to Audiobookshelf using progress-record deletion flow.
- Reset/mark as unplayed actions are hidden when progress is at 0%.
- Improved hover responsiveness to avoid delayed highlight feedback and reduced jitter in library interaction.

## 0.6.6 - 2026-03-17

### Fixed
- Podcast episodes in Continue Listening now display with individual episode titles and correct episode-level progress instead of podcast-level data.
- Episode progress correctly reflects only the current episode's playback position, not the entire podcast duration.

## 0.6.5 - 2026-03-17

### Added
- Settings page with language selector, default sort, seek step, and continue-card animation toggle.
- Runtime localization (English/Swedish) for the app UI after login.
- Auto-open Now Playing when playback starts, with manual minimize back to mini player.
- Loading indicators in Mini Player and Now Playing with buffering status text.
- Per-episode actions for podcasts in detail view (mark played / mark unplayed).
- Library card actions and completion badges (mark played / mark unplayed).

### Changed
- Continue Listening flow now supports separate progress per podcast episode.
- Continue cards now include direct resume/play and completion actions.
- Detail playback button labels now reflect playback state (Play / Resume / Play again).
- Sidebar sort control text alignment and settings button styling improved.
- Reduced UI overhead with shared ticker/debounced refresh and lighter re-render paths.

### Fixed
- Podcast progress/session API handling now uses episode-aware endpoints.
- Missing backend command registration for stop playback (`abs_stop_playback`).
- False continue entries when leaving detail view without real playback.
- Continue card title consistency for podcasts vs audiobook items.
- Loading spinner behavior now stays visible until playback time actually starts moving.
- Play button state sync in Now Playing and Mini Player.

### Packaging and Build Notes
- Linux package outputs confirmed for `.deb` and `.rpm`.
- AppImage bundling may fail on some environments due to linuxdeploy/strip compatibility with RELR sections.

## 0.6.4
- Previous release baseline.
