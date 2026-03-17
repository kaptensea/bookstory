# Wayland + NVIDIA Setup Guide

## Problem
On Linux systems with Wayland session + NVIDIA GPU, the Bookstory app fails to start with a GTK initialization error. This requires setting environment variables before the app launches.

## Solution
We've implemented an integrated approach where the launcher is automatically built into all packages.

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
2. Automatically integrates the launcher into all packages (.deb, .rpm, .appimage)
3. Creates single, self-contained installer files

**Result**: End users get `.deb`/`.rpm`/`.appimage` files that "just work" without any manual setup.

When users install and launch the app:
- The launcher automatically detects Wayland + NVIDIA
- Sets required env vars at runtime
- Launches the app with correct settings

## How It Works (Technical)

### Development
`npm run tauri:dev` → `dev.sh` (detects & sets env) → `npm run tauri dev`

### Installers (Automated)
The build script:
1. Builds the binary normally
2. For deb/rpm: moves the binary to `/usr/libexec/bookstory-bin` and creates a wrapper script at `/usr/bin/bookstory`
3. Updates `.desktop` files to call the wrapper instead of the binary
4. Repackages everything into a single installer file

When users launch the app, the wrapper script runs first, detects the environment, sets env vars, then executes the actual binary.

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
- `bookstory-launcher.sh` - Launcher logic (embedded in packages by build script)
- `build-and-bundle.sh` - Automated build and package integration
