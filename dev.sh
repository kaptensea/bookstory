#!/bin/bash

# Bookstory Development Server with Smart Platform Detection
# This script handles auto-detection of Wayland + NVIDIA for Linux users
#
# For convenience, you can run: npm run tauri:dev
# which uses the Rust-based detection baked into src-tauri/src/main.rs
#
# This shell script is provided as a reference for manual platform configuration

set -e

# Detect Wayland + NVIDIA and configure environment
detect_and_configure() {
    local session_type="${XDG_SESSION_TYPE:-}"
    
    if [[ "$session_type" == "wayland" ]]; then
        echo "Detected Wayland session..."
        
        # Check for NVIDIA GPU
        if command -v nvidia-smi &> /dev/null; then
            echo "Detected NVIDIA GPU. Setting compatibility environment..."
            export WEBKIT_DISABLE_COMPOSITING_MODE=1
            export GDK_BACKEND=X11
            echo "Environment configured: X11 backend for Wayland + NVIDIA"
        elif lspci 2>/dev/null | grep -qi nvidia; then
            echo "Detected NVIDIA GPU (via lspci). Setting compatibility environment..."
            export WEBKIT_DISABLE_COMPOSITING_MODE=1
            export GDK_BACKEND=X11
            echo "Environment configured: X11 backend for Wayland + NVIDIA"
        fi
    else
        echo "Running on session type: ${session_type:-unknown}"
    fi
}

# Run detection
detect_and_configure

# Start Tauri dev server
echo "Starting Bookstory development server..."
npm run tauri:dev
