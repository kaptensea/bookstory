#!/bin/bash

# Bookstory Development Server with Smart Platform Detection
# Auto-detects Wayland + NVIDIA and configures the environment

SESSION_TYPE="${XDG_SESSION_TYPE:-}"

if [[ "$SESSION_TYPE" == "wayland" ]]; then
    if command -v nvidia-smi &> /dev/null || lspci 2>/dev/null | grep -qi nvidia; then
        echo "Detected Wayland + NVIDIA GPU. Starting with X11 backend..."
        WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 npm run tauri dev
        exit $?
    fi
fi

npm run tauri dev

