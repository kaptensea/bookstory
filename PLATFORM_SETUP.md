# Wayland + NVIDIA Setup Guide

## Problem
On Linux systems with Wayland session + NVIDIA GPU, the Bookstory app fails to start with a GTK initialization error. This requires setting environment variables before the app launches.

## Solution
We've implemented a two-tier approach:

### For Development (`npm run tauri:dev`)
The `dev.sh` script auto-detects Wayland + NVIDIA and sets required env vars before launching:
```bash
npm run tauri:dev
```

This script:
- Detects if running on Wayland (`$XDG_SESSION_TYPE`)
- Checks for NVIDIA GPU (using `nvidia-smi` or `lspci`)
- Sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` and `GDK_BACKEND=x11` if both conditions are met
- Launches `npm run tauri dev`

Works on all Linux systems—Wayland, X11, Intel, AMD, NVIDIA.

### For Installers (deb/rpm/appimage)
The `bookstory-launcher.sh` script provides the same detection for end-users.

When users install via deb/rpm/appimage, the launcher performs auto-detection and sets env vars at runtime. 

**Packagers should:**

#### DEB/RPM Packages:
```bash
# 1. Extract the built binary
cp src-tauri/target/release/bundle/deb/usr/bin/bookstory /usr/libexec/bookstory-bin

# 2. Install the launcher wrapper
sudo cp bookstory-launcher.sh /usr/bin/bookstory
sudo chmod +x /usr/bin/bookstory /usr/libexec/bookstory-bin

# 3. Update the .desktop file to run /usr/bin/bookstory
```

#### AppImage:
Embed `bookstory-launcher.sh` in the AppImage and set it as the entrypoint instead of the binary directly.

## How It Works
1. **Dev Mode**: `npm run tauri:dev` → `dev.sh` (detects & sets env) → `npm run tauri dev`
2. **Installed App**: User clicks "Bookstory" → launcher script (detects & sets env) → actual binary

## Testing
**On Wayland + NVIDIA:**
```bash
npm run tauri:dev  # Should work without manual env vars
```

**On X11 or non-NVIDIA:**
```bash
npm run tauri:dev  # Works normally, detection finds no match
```

## Files
- `dev.sh` - Development launcher (called by `npm run tauri:dev`)
- `bookstory-launcher.sh` - Runtime launcher for installers
- `build-and-bundle.sh` - Helper script for packaging
