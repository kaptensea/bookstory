#!/bin/bash

# Bookstory Build & Install Helper
# This script helps set up the launcher wrapper for installers

set -e

echo "Building Bookstory..."
npm run tauri build

# After the build succeeds, the binary will be in target locations
# For deb: src-tauri/target/release/bundle/deb/
# For rpm: src-tauri/target/release/bundle/rpm/
# For appimage: src-tauri/target/release/bundle/appimage/

# The launcher script is in bookstory-launcher.sh
# Installers (packagers) should:
#
# 1. For DEB packages:
#    - Copy the binary to /usr/libexec/bookstory-bin
#    - Create a wrapper /usr/bin/bookstory that calls bookstory-launcher.sh
#    - Update the .desktop file to run /usr/bin/bookstory
#
# 2. For RPM packages:
#    - Same as DEB
#
# 3. For AppImage:
#    - Bundle the launcher script with the AppImage
#    - Set the AppImage's entrypoint to the launcher script

# Example DEB installation:
# sudo mkdir -p /usr/libexec
# sudo cp src-tauri/target/release/bundle/deb/usr/bin/bookstory /usr/libexec/bookstory-bin
# sudo cp bookstory-launcher.sh /usr/bin/bookstory
# sudo chmod +x /usr/bin/bookstory
# sudo chmod +x /usr/libexec/bookstory-bin

echo "Build complete!"
echo "For installer integration, see comments in this script."
