#!/bin/bash
# Bookstory Launcher - Smart Platform Detection for Wayland + NVIDIA
# This script is used by installers (deb/rpm/appimage) to auto-detect 
# Wayland + NVIDIA and set required environment variables before launching the app.
#
# Installers should create a symlink or wrapper that calls this script.

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Determine the actual binary location based on how this script is called
# For system-wide install: BOOKSTORY_BIN=/usr/libexec/bookstory-bin
# For user install: adjust as needed
BOOKSTORY_BIN="${SCRIPT_DIR}/bookstory-bin"

# If running from /usr/bin, the binary is likely in /usr/libexec
if [[ "$SCRIPT_DIR" == "/usr/bin" ]]; then
    BOOKSTORY_BIN="/usr/libexec/bookstory-bin"
fi

# Auto-detect Wayland + NVIDIA and set environment
SESSION_TYPE="${XDG_SESSION_TYPE:-}"

if [[ "$SESSION_TYPE" == "wayland" ]]; then
    if command -v nvidia-smi &> /dev/null || lspci 2>/dev/null | grep -qi nvidia; then
        # Wayland + NVIDIA: disable GPU compositing and force X11
        export WEBKIT_DISABLE_COMPOSITING_MODE=1
        export GDK_BACKEND=x11
    else
        # Wayland (ej NVIDIA): bara byt till X11, behåll GPU rendering
        export GDK_BACKEND=x11
    fi
fi

# Execute the actual binary with all arguments
exec "$BOOKSTORY_BIN" "$@"
