<div align="center">
  <img src="src/assets/bookstory-logo.svg" width="140" alt="Bookstory logo" />
  <h1>Bookstory</h1>
  <p>A native desktop client for <a href="https://www.audiobookshelf.org">Audiobookshelf</a>, built with Tauri 2, TypeScript, and Rust.</p>

  ![Version](https://img.shields.io/badge/version-1.1.1-blue)
  ![License](https://img.shields.io/badge/license-MIT-green)
  ![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey)
  ![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8D8)
</div>

---

## Features

- **Continue Listening** shelf with real-time progress bars synced from your server
- **Library browser** — browse all your audiobooks and podcasts
- **Item detail view** with chapter list and chapter-level playback
- **Mini player** docked at the bottom with playback controls
- **Full-screen Now Playing** view with seek slider and chapter navigation
- **Auto-open Now Playing** when playback starts (with quick minimize back to mini player)
- **Progress sync** — listens sessions are synced back to your Audiobookshelf server
- **Podcast episode progress** synced using episode-aware API endpoints
- **Mark played / unplayed** in Continue Listening, Library cards, and Podcast episode rows
- **Settings page** for language, default sort, seek seconds, and continue-card animations
- **Runtime localization** in English, Swedish, and German
- **In-app update notice** with platform-aware update guidance
- **Auto-login** — credentials stored securely in the system keyring
- **Custom window controls** and native desktop feel
- **Cover artwork** and metadata display throughout

## Bug Reports & Feedback

Found a bug? Missing a feature? Want something removed or changed?

**Open an issue on GitHub:** [github.com/kaptensea/bookstory/issues](https://github.com/kaptensea/bookstory/issues)

When reporting a bug, please include:
- What you expected to happen
- What actually happened
- Your OS and whether you use X11 or Wayland
- Steps to reproduce if possible

Feature requests and general feedback are welcome too — just open an issue and describe what you'd like.

---

## Known Limitations

- AppImage bundling can fail on some newer Linux toolchains due to `strip`/`RELR` compatibility in linuxdeploy.
- `.deb` and `.rpm` packaging are supported and currently the recommended Linux release artifacts.

## Metadata Fallbacks

- In chapter lists, audiobooks can show generic labels like `Track 1`, `Track 2` when no embedded title is available.
- Podcasts can show the episode filename when no episode title metadata is available.

## Requirements

- A running [Audiobookshelf](https://www.audiobookshelf.org) server (self-hosted)
- A valid Audiobookshelf account

## Platform Compatibility

Bookstory is designed to run on Linux and Windows.

Linux compatibility (tested and supported):
- X11 sessions (Intel, AMD, NVIDIA)
- Wayland sessions (Intel, AMD)
- Wayland + NVIDIA (automatic compatibility fallback during development launcher flow)

What this means in practice:
- Development runs are supported via `npm run tauri:dev`.
- Standard Tauri packaging targets are supported for distribution: `.deb`, `.rpm`, and `.AppImage`.

If you are on Wayland + NVIDIA and encounter startup issues in a custom environment, test with:
- `WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 npm run tauri dev`

This project includes launcher/build logic intended to keep compatibility consistent across environments.

## Releases

Pre-built binaries for Linux and Windows are available on the [Releases](https://github.com/kaptensea/bookstory/releases) page.

Arch Linux users can also install the AUR package:

- `yay -S bookstory-bin`

Bookstory is desktop-only (Linux and Windows).

### Versioning and GitHub Builds

Releases are version-tag driven.

Typical flow:
1. Update versions in project metadata.
2. Commit and push to `main`.
3. Create and push a tag like `v1.1.1`.
4. GitHub Actions builds artifacts and publishes them to Releases.

Use one tag push per release to avoid duplicate workflow runs.

### Local Build and Dev Commands

- Development: `npm run tauri:dev`
- Packaged build: `npm run tauri:build`

### Quick Install (End Users)

Install from a release artifact:

1. Arch Linux (AUR):
  `yay -S bookstory-bin`
2. Debian/Ubuntu (`.deb`):
  `sudo apt install ./bookstory_<version>_amd64.deb`
3. Fedora/openSUSE/RHEL (`.rpm`):
  `sudo rpm -i ./bookstory-<version>-1.x86_64.rpm`
4. Universal Linux (`.AppImage`):
  `chmod +x ./bookstory_<version>_amd64.AppImage && ./bookstory_<version>_amd64.AppImage`

After install, launch Bookstory from your app menu or desktop launcher.

## Stack

| Layer | Technology |
|---|---|
| UI | TypeScript, HTML, CSS |
| Desktop shell | Tauri 2 |
| Backend / proxy | Rust |
| API | Audiobookshelf REST API |
| Auth storage | System keyring |

## License

MIT
