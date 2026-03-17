# Changelog

All notable changes to this project are documented in this file.

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
