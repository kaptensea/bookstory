# Bookstory

Bookstory is a desktop Audiobookshelf client built with Tauri 2, TypeScript, and Rust.

It is focused on a fast, native-feeling player with server-synced progress and a clean library browsing experience.

## Current Highlights

- Native desktop app with custom window controls
- Login and auto-login flow
- Library browser with sorting
- Continue Listening shelf
- Item detail view with chapter controls
- Mini player docked at the bottom
- Full-screen Now Playing view
- Progress sync against Audiobookshelf
- Cover artwork and metadata display
- App version shown in the UI

## Known Issue

- Continue Listening is currently a bit sketchy/scatchy in some situations and will be improved in a later release.

## Stack

- Tauri 2
- TypeScript
- Vanilla HTML/CSS
- Rust (streaming proxy and backend commands)
- Audiobookshelf API

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start development:

```bash
npm run tauri dev
```

3. Build production bundles:

```bash
npm run tauri build
```

## Release Build on GitHub

Pushing a tag like `v0.6.0` triggers the GitHub Actions release build workflow.

## Requirements

- A running Audiobookshelf server
- A valid Audiobookshelf account

## Project Layout

```text
src/
  main.ts
  styles.css

src-tauri/
  src/lib.rs
  tauri.conf.json
  capabilities/default.json
```

## License

MIT
