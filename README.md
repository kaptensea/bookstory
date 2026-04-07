<div align="center">
  <img src="src/assets/bookstory-logo.svg" width="140" alt="Bookstory logo" />
  <h1>Bookstory</h1>
  <p>A native desktop client for <a href="https://www.audiobookshelf.org">Audiobookshelf</a>, built with Tauri 2, TypeScript, and Rust.</p>

  <a href="https://github.com/kaptensea/bookstory/releases" target="_blank">
    <img src="https://img.shields.io/badge/version-1.2.0-blue" alt="Version" />
  </a>
  <a href="https://opensource.org/licenses/MIT" target="_blank">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
  </a>
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey" alt="Platform" />
  <a href="https://tauri.app/" target="_blank">
    <img src="https://img.shields.io/badge/built%20with-Tauri%202-24C8D8" alt="Built with Tauri" />
  </a>
  <br />
  <a href="https://github.com/features/copilot" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-GitHub%20Copilot-4B32C3?logo=github" alt="Built with GitHub Copilot" />
  </a>
</div>

---

<p align="center">
  <img src="src/assets/home.png" width="600"/>
</p>

## Features

- **Global search bar** — search all books and podcasts with instant dropdown results and cover images
- **Continue Listening** shelf with real-time progress bars synced from your server
- **Library browser** — browse all your audiobooks and podcasts
- **Item detail view** with chapter list and chapter-level playback
- **Mini player** docked at the bottom with playback controls
- **Full-screen Now Playing** view with seek slider and chapter navigation
- **Auto-open Now Playing** when playback starts (with quick minimize back to mini player)
- **Progress sync** — listens sessions are synced back to your Audiobookshelf server
- **Podcast episode progress** synced using episode-aware API endpoints
- **Mark played / unplayed** in Continue Listening, Library cards, and Podcast episode rows
- **Settings page** for language, default sort, default volume, seek seconds, and continue-card animations
- **Flexible sorting** — Recently added, Oldest added, A -> Z, Z -> A (sidebar + settings default)
- **Offline download controls** — download/remove per item from cover menu and detail view
- **Offline cleanup controls** — remove all offline files from settings
- **Offline storage management** — configurable max offline storage with automatic oldest-item cleanup
- **Auto-download on playback** option for offline-first listening
- **Auto-remove finished offline items** option (optional cleanup when a book is completed)
- **Offline progress queue sync** — progress is queued offline and synced when online again
- **Runtime localization** in English, Swedish, and German
- **Linux Wayland compatibility startup** — automatic X11 fallback on Wayland and extra NVIDIA safeguards
- **In-app update notice** with platform-aware update guidance
- **Auto-login** — credentials stored securely in the system keyring
- **Custom window controls** and native desktop feel
- **Cover artwork** and metadata display throughout
- **Refined playback/menu UX** — single-click action menus, improved dropdown clarity, and unified premium control styling

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

## Offline Listening

Bookstory supports per-item offline listening and automatic sync when connectivity returns.

What you can do:
- Download individual items for offline playback from the library cover menu or item detail view.
- Remove offline files per item from the same places.
- Remove all offline files from Settings.
- Queue listening progress while offline and sync it to Audiobookshelf when online.

Offline settings available:
- Default volume (%).
- Max offline storage (MB, `0` means unlimited).
- Auto-download item when playback starts.
- Auto-remove offline files when a book is finished.

Behavior notes:
- "Remove offline" actions are only shown for items that actually have offline files.
- Playback prefers local offline audio when available, and falls back to online stream otherwise.
- If max offline storage is exceeded, oldest downloaded offline items are removed automatically.

## Requirements

- A running [Audiobookshelf](https://www.audiobookshelf.org) server (self-hosted)
- A valid Audiobookshelf account

## Audio Codec Requirements

Bookstory streams audio through the system's native media pipeline. Some audiobook formats — such as **M4B, AAC, and MP4** — require additional codec support that is not always bundled with the operating system.

If a book fails to play (especially books that work fine on other clients), you likely need to install the FFmpeg GStreamer plugin package for your OS.

### Linux

WebKitGTK (the underlying browser engine Tauri uses on Linux) plays audio via **GStreamer**. AAC/M4B/MP4 decoding requires the `gst-libav` package (FFmpeg bridge).

**Arch Linux / Manjaro:**
```bash
sudo pacman -S gst-libav
```

**Ubuntu / Debian / Linux Mint:**
```bash
sudo apt install gstreamer1.0-libav
```

**Fedora:**
```bash
sudo dnf install gstreamer1-libav
```

**openSUSE:**
```bash
sudo zypper install gstreamer-plugins-libav
```

Without this package, books encoded as M4B/AAC will silently fail to load in the player. MP3 (`.mp3`) books do not require this and will work without it.

### Windows

Windows ships with native H.264/AAC codec support via the built-in Media Foundation stack. No additional packages are required on Windows 10 or Windows 11.

If you are on an older or stripped-down Windows installation and playback still fails for M4B/AAC content, installing the [K-Lite Codec Pack](https://www.codecguide.com/download_kl.htm) (Basic edition is enough) will resolve it.

## Platform Compatibility

Bookstory is designed to run on Linux and Windows.

Linux compatibility (tested and supported):
- X11 sessions (Intel, AMD, NVIDIA)
- Wayland sessions (Intel, AMD)
- Wayland + NVIDIA (automatic compatibility fallback during app startup)

What this means in practice:
- Development runs are supported via `npm run tauri:dev`.
- Standard Tauri packaging targets are supported for distribution: `.deb`, `.rpm`, and `.AppImage`.
- Installed builds use the same runtime compatibility logic as development runs, so end users normally do not need to set manual launch environment variables.

If you are on Wayland + NVIDIA and encounter startup issues in a custom environment, test with:
- `WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 npm run tauri dev`

This project includes startup/build logic intended to keep compatibility consistent across environments.

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
