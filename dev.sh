#!/bin/bash

# Bookstory Development Server with Smart Platform Detection
# Auto-detects Wayland + NVIDIA and configures the environment

set -e

# Detect session type
SESSION_TYPE="${XDG_SESSION_TYPE:-}"

# Check if on Wayland
if [[ "$SESSION_TYPE" == "wayland" ]]; then
    # Check for NVIDIA GPU
    if command -v nvidia-smi &> /dev/null || lspci 2>/dev/null | grep -qi nvidia; then
        echo "Detected Wayland + NVIDIA GPU. Starting with X11 backend..."
        export WEBKIT_DISABLE_COMPOSITING_MODE=1
        export GDK_BACKEND=X11
    fi
fi

# Start Tauri dev server
npm run tauri dev

