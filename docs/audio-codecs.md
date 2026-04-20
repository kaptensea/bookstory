# Audio Codec Requirements

Bookstory uses the system media pipeline. Some formats require additional codec packages.

## Linux

On Linux, Tauri WebKitGTK uses GStreamer. For AAC, M4B, and MP4, install `gst-libav`.

Arch Linux / Manjaro:
```bash
sudo pacman -S gst-libav
```

Ubuntu / Debian / Linux Mint:
```bash
sudo apt install gstreamer1.0-libav
```

Fedora:
```bash
sudo dnf install gstreamer1-libav
```

openSUSE:
```bash
sudo zypper install gstreamer-plugins-libav
```

Without this package, M4B/AAC can fail to load. MP3 usually works without it.

## Windows

Windows 10 and 11 normally include required codecs.

If playback still fails on stripped-down installs, install K-Lite Codec Pack (Basic):
- https://www.codecguide.com/download_kl.htm
