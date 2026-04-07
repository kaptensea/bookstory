#!/bin/bash

# Bookstory Build Script
# Builds the app normally. Linux runtime compatibility is handled inside the app
# before Tauri/WebKit starts, so packaged installers no longer need wrapper surgery.

set -e

echo "========================================"
echo "Building Bookstory..."
echo "========================================"

npm run tauri build

BUILD_DIR="src-tauri/target/release/bundle"

echo ""
echo "========================================"
echo "Build complete!"
echo "========================================"
echo ""
echo "Packages are ready in: $BUILD_DIR"
echo ""
echo "Wayland and Wayland+NVIDIA compatibility is now handled by the app itself."
echo "End users just need to:"
echo "  • Install the .deb/.rpm/.appimage"
echo "  • Run the app normally"
echo "  • Auto-detection handles everything"
