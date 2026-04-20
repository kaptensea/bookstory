# Platform Compatibility

Bookstory is designed for Linux and Windows.

## Linux support

- X11 sessions (Intel, AMD, NVIDIA)
- Wayland sessions (Intel, AMD)
- Wayland + NVIDIA with automatic compatibility fallback

## Development

Use:
```bash
npm run tauri:dev
```

The dev launcher detects Wayland/NVIDIA and applies compatibility environment variables.

## Packaged builds

Use:
```bash
npm run tauri:build
```

Build output path:
- `src-tauri/target/release/bundle/`

Produced package types:
- `.deb`
- `.rpm`
- `.AppImage`

## Wayland + NVIDIA fallback

On affected systems, Bookstory relaunches with compatibility settings before GTK/WebKit startup.
