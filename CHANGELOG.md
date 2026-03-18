# Changelog

All notable changes to this project are documented in this file.

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
