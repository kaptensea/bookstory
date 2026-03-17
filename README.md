<div align="center">
  <img src="src/assets/bookstory-logo.svg" width="140" alt="Bookstory logo" />
  <h1>Bookstory</h1>
  <p>A native desktop client for <a href="https://www.audiobookshelf.org">Audiobookshelf</a>, built with Tauri 2, TypeScript, and Rust.</p>

  ![Version](https://img.shields.io/badge/version-0.6.3-blue)
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
- **Progress sync** — listens sessions are synced back to your Audiobookshelf server
- **Auto-login** — credentials stored securely in the system keyring
- **Custom window controls** and native desktop feel
- **Cover artwork** and metadata display throughout

## Known Limitations

- Podcast progress saving is currently disabled due to previous sync errors.
- Audiobook progress saving and syncing still works as expected.
- In chapter lists, audiobooks can show generic labels like `Track 1`, `Track 2` when no embedded title is available.
- Podcasts can show the episode filename when no episode title metadata is available.

## Requirements

- A running [Audiobookshelf](https://www.audiobookshelf.org) server (self-hosted)
- A valid Audiobookshelf account

## Releases

Pre-built binaries for Linux and Windows are available on the [Releases](https://github.com/kaptensea/bookstory/releases) page.

Bookstory is desktop-only (Linux and Windows).

Pushing a tag like `v0.7.0` triggers the GitHub Actions workflow that builds and publishes release assets automatically.

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
