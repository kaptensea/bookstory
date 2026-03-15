# 📚 Bookstory

**Bookstory** is a desktop Audiobookshelf client built with **Tauri + TypeScript**.

It allows you to stream and manage your audiobooks from your own Audiobookshelf server with a fast native desktop experience.

---

## ✨ Features

* 🎧 Stream audiobooks from Audiobookshelf
* ▶️ Chapter based playback
* ⏭️ Auto-play next chapter
* 🛑 Stop when book ends
* 🔁 Resume playback (server synced)
* 📊 Continue listening section
* 🖼️ Cover artwork support
* ⚡ Lightweight native desktop app (Tauri)

---

## 🧠 Server sync

Playback progress is synced directly with Audiobookshelf.

This means:

* Resume works across devices
* Continue listening works in web and mobile
* No local progress database needed

---

## 🛠️ Tech stack

* **Tauri 2**
* **TypeScript**
* **Vanilla HTML / CSS**
* **Rust (local streaming proxy)**
* **Audiobookshelf API**

---

## 🚀 Development

### Install dependencies

```bash
npm install
```

### Run dev app

```bash
npm run tauri dev
```

### Build release

```bash
npm run tauri build
```

---

## 🔐 Requirements

You must have:

* A running **Audiobookshelf server**
* A valid user account

---

## 📦 Project structure

```
src/
  main.ts          frontend logic
  styles.css       UI

src-tauri/
  lib.rs           local audio streaming proxy
  tauri.conf.json  app configuration
```

---

## 🎯 Goal

Create a fast, minimal and fully server-synced Audiobookshelf desktop experience.

---

## ❤️ Status

Active development.

Core playback is working.
Next steps include:

* Better resume handling
* Improved player UI
* Offline caching
* Playback speed
* Sleep timer

---

## 📄 License

MIT
