# Releases and Installation

## Download releases

Pre-built binaries are available at:
- https://github.com/kaptensea/bookstory/releases

Arch Linux (AUR):
```bash
yay -S bookstory-bin
```

## Install release artifacts

Debian / Ubuntu:
```bash
sudo apt install ./bookstory_<version>_amd64.deb
```

Fedora / openSUSE / RHEL:
```bash
sudo rpm -i ./bookstory-<version>-1.x86_64.rpm
```

AppImage:
```bash
chmod +x ./bookstory_<version>_amd64.AppImage && ./bookstory_<version>_amd64.AppImage
```

## Local development and build

Development:
```bash
npm run tauri:dev
```

Packaged build:
```bash
npm run tauri:build
```

## Versioning flow

1. Update version metadata.
2. Commit and push to `main`.
3. Create and push tag like `v1.1.1`.
4. GitHub Actions publishes release artifacts.
