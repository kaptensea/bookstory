<div align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="Bookstory icon" />
  <h1>Bookstory</h1>
  <p>A native desktop client for <a href="https://www.audiobookshelf.org">Audiobookshelf</a>, built with Tauri 2, TypeScript, and Rust.</p>

  ![Version](https://img.shields.io/badge/version-0.6.2-blue)
  ![License](https://img.shields.io/badge/license-MIT-green)
  ![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey)
  ![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8D8)
</div>

---

## Features

- **Continue Listening** shelf with real-time progress bars synced from your server
- **Library browser** — browse all your audiobooks and podcasts
- **Item detail view** with chapter list and chapter-level playback
- **Mini player** docked at the bottom with playback controls
- **Full-screen Now Playing** view with seek slider and chapter navigation
- **Progress sync** — listens sessions are synced back to your Audiobookshelf server
- **Auto-login** — credentials stored securely in the system keyring
- **Custom window controls** and native desktop feel
- **Cover artwork** and metadata display throughout

## Requirements

- A running [Audiobookshelf](https://www.audiobookshelf.org) server (self-hosted)
- A valid Audiobookshelf account

## Getting Started

### Install dependencies

```bash
npm install
```

### Run in development

```bash
npm run tauri dev
```

### Build for production

```bash
npm run tauri build
```

## Releases

Pre-built binaries for Linux, Windows, and macOS are available on the [Releases](https://github.com/kaptensea/bookstory/releases) page.

Pushing a tag like `v0.7.0` triggers the GitHub Actions workflow that builds and publishes release assets automatically.

## Stack

| Layer | Technology |
|---|---|
| UI | TypeScript, HTML, CSS |
| Desktop shell | Tauri 2 |
| Backend / proxy | Rust |
| API | Audiobookshelf REST API |
| Auth storage | System keyring |

## Project Layout

```
src/
  main.ts        # All UI logic and Tauri command calls
  styles.css     # App styling

src-tauri/
  src/
    lib.rs       # Tauri commands, audio proxy, keyring
    main.rs
  tauri.conf.json
  capabilities/
    default.json
```

## License

MIT
