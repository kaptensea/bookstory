# Wayland + NVIDIA Setup Guide

## Problem
On Linux systems with Wayland session + NVIDIA GPU, the Bookstory app fails to start with a GTK initialization error. This requires setting environment variables before the app launches.

## Solution
We've implemented an integrated approach where Bookstory detects this at Linux startup and relaunches itself with the correct environment before Tauri/WebKit initializes.

### For Development (`npm run tauri:dev`)
```bash
npm run tauri:dev
```

This script:
- Detects if running on Wayland (`$XDG_SESSION_TYPE`)
- Checks for NVIDIA GPU (using `nvidia-smi` or `lspci`)
- Sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` and `GDK_BACKEND=x11` if both conditions are met
- Launches the app

Works on all Linux systems—Wayland, X11, Intel, AMD, NVIDIA.

### For Building Packages (`npm run tauri:build`)
```bash
npm run tauri:build
```

This single command:
1. Builds the app with `npm run tauri build`
2. Produces the normal Tauri packages (.deb, .rpm, .appimage)
3. Creates single, self-contained installer files

**Result**: End users get `.deb`/`.rpm`/`.appimage` files that "just work" without any manual setup.

When users install and launch the app:
- Bookstory automatically detects Wayland + NVIDIA
- Sets required env vars at runtime
- Relaunches itself with correct settings before GTK/WebKit startup

## How It Works (Technical)

### Development
`npm run tauri:dev` → `dev.sh` (detects & sets env) → `npm run tauri dev`

### Packaged Builds
The Linux binary itself:
1. Checks whether it is starting on Wayland
2. Detects whether NVIDIA is present using `nvidia-smi` or `lspci`
3. Relaunches itself with `GDK_BACKEND=x11`
4. Adds `WEBKIT_DISABLE_COMPOSITING_MODE=1` on Wayland + NVIDIA

Because this happens inside the shipped binary, the same behavior works for `.deb`, `.rpm`, `.AppImage`, GitHub release builds, and manual launches.

## Usage

### Building for Distribution
```bash
npm run tauri:build
```

Packages will be in: `src-tauri/target/release/bundle/`
- `.deb` files for Debian/Ubuntu/Pop!_OS
- `.rpm` files for Fedora/RHEL/openSUSE
- `.AppImage` for universal Linux

Each file is completely self-contained and ready to distribute.

### Testing on Wayland + NVIDIA
```bash
npm run tauri:dev  # Should work without manual env vars
```

### Testing on X11 or non-NVIDIA
```bash
npm run tauri:dev  # Works normally, detection finds no match
```

## Files
- `dev.sh` - Development launcher (called by `npm run tauri:dev`)
- `bookstory-launcher.sh` - Optional shell launcher with the same compatibility env setup
- `build-and-bundle.sh` - Build entrypoint for packaged releases
- `src-tauri/src/main.rs` - Built-in Linux compatibility relaunch before app startup
