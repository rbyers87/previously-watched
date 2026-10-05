# Previously Watched

A browser extension that gives you a "previously on..." recap when you come back to something you were watching, and removes some of the friction of streaming: ads, intros, and credits.

Supported sites: **Netflix, Disney+, Hulu, and YouTube**.

---

## Features

### Recap on resume
When you return to a video after being away, the extension plays short clips from the parts you actually watched, then jumps back to where you left off.

- By default it plays **15 seconds of clips for every 15 minutes you watched**.
- Only parts you really watched are used, so the recap never spoils anything you haven't seen.
- An on-screen banner shows progress ("Previously watched... 2/4") with a **Skip** button to cut the recap short.
- The recap triggers automatically only if you've been away for **10 minutes or more**. For shorter gaps, use "Replay recap now".

### Recap flags
Press **Alt+R** (**Option+R** on Mac) while watching to mark an important moment.

- Flagged moments are **always included** in the recap.
- A flagged clip starts 3 seconds before the moment you marked.
- A small message confirms the flag ("Recap moment saved at 12:34").

### YouTube chapters
If a YouTube video has chapters, the recap plays a short clip from the start of each chapter you finished instead of using fixed time blocks.

- Each finished chapter gets a clip of your full clip length (shorter only if the chapter itself is shorter), so the recap grows with the number of chapters you've finished.
- At least 2 finished chapters are needed; otherwise the default timed clips are used.
- Chapters are read from the chapter list panel when available, otherwise from timestamps in the video description.
- A video needs at least 3 timestamps, starting at 0:00, to count as having chapters.
- Chapters you never watched are not recapped.
- Can be turned off with the "YouTube chapters" toggle.

### Ad skipper
Detects ad breaks and makes them less painful.

- Mutes the ad and plays it at 16x speed.
- Clicks "Skip" or "Skip Ad" buttons when they appear.
- On YouTube, also closes banner ads.
- Restores your original volume and playback speed when the ad ends.
- Ad time is never counted as watch time, and the recap waits for the real video before starting.

**Limitation:** ads that are stitched into the video stream itself can't be removed, only sped up when they're detected.

### Auto-skip intros
Automatically clicks buttons labeled Skip Intro, Skip Recap, Skip Credits, Skip Opening, or Skip Title Sequence. This is paused while a recap is playing.

### Popup controls
Click the extension icon to:

- Toggle each feature on or off (recap, ad skipper, auto-skip intros, YouTube chapters).
- Change **clip length** (5-60 seconds) and **one clip per N minutes** (1-60 minutes).
- Replay the recap on demand with **Replay recap now**.
- Wipe everything with **Clear watch history**.

---

## Installation

1. Download or clone this project.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Pin the extension from the puzzle-piece menu if you want quick access to the popup.

After reloading or updating the extension, **refresh any open video tabs**. Tabs opened before the reload lose their connection to the extension.

---

## How to use it

1. Open a video on a supported site and watch it normally. The extension quietly records which seconds you watched.
2. Optional: press **Alt+R** at moments you want guaranteed in the recap.
3. Leave and come back later.
4. When the video starts playing again, the recap runs automatically if you were gone 10+ minutes.
5. To trigger it yourself at any time, open the popup and click **Replay recap now**.

---

## How it works

### Watch tracking
Once per second, while the video is playing, the extension records the current second as "watched". It does not record time that is paused, seeking, part of an ad, or part of a recap clip. History is saved every 10 seconds and when you leave the video.

### Building the recap
For each block of time you watched (15 minutes by default, including the last partial block before your resume point), the extension finds the most recent full clip-length stretch inside that block that you fully watched, and uses it. A final partial block shorter than 2 minutes is ignored. A block you skipped through, or only partly watched, gets no clip. YouTube chapters and flags are layered on top as described above.

### Playing the recap
Recap clips always play at normal (1x) speed, and your own playback speed is restored afterwards. For each clip, the extension seeks to the start, waits for the seek to land, plays it for the clip length, and moves on to the next. When the last clip ends, it seeks back to your resume position and continues playing. Netflix uses a small page script (`page-bridge.js`) because its player doesn't allow normal seeking from extensions.

### Where videos are identified
Each video is stored under its own key:

- YouTube: by video ID
- Netflix, Disney+, Hulu: by site and the last part of the watch URL

---

## Settings reference

| Setting | Default | Meaning |
|---|---|---|
| Recap on resume | On | Play a recap when you come back to a video |
| Ad skipper | On | Mute and fast-forward ads, click Skip |
| Auto-skip intros | On | Click Skip Intro / Recap / Credits buttons |
| YouTube chapters | On | Recap by chapter when a video has them |
| Clip length | 15 sec | Length of each recap clip (5-60) |
| One clip per | 15 min | One clip for every this-many minutes watched (1-60) |
| Minimum gap | 10 min | How long you must be away before the recap starts automatically (not in the popup; set `minGapMin` in the code) |

---

## Privacy

All data stays in your browser's local extension storage. Nothing is sent to any server. Stored data is limited to your settings and, for each video, which seconds you watched, your recap flags, and when you last watched. **Clear watch history** in the popup deletes it all.

---

## Limitations and tips

- **The recap needs real watch history.** Seconds you skipped past, or watched before installing the extension, can't be recapped. If you jump straight to the middle of a video, there is nothing to replay.
- **Testing the recap:** play a video continuously for a few minutes (2x speed works), leave, return, then use **Replay recap now**.
- **YouTube:** works on regular videos only. Shorts and live streams are not supported.
- **Ad detection depends on page markup.** Streaming sites change their pages often, so the selectors in the `AD_SELECTORS` list in `content.js` may need updating if ads stop being detected.
- **Pre-roll ads:** the recap waits for the real video to start before running.
- **"Refresh the video tab first" message:** the extension was reloaded while the tab was open. Refresh the tab.
- **Recap started but nothing played:** the video may not have enough tracked watch time yet.

---

## Project structure

| File | Purpose |
|---|---|
| `content.js` | Main logic: tracking, recap, ad skipper, intro skipper, flags |
| `page-bridge.js` | Netflix-only helper that performs seeks inside the page |
| `popup.html` / `popup.js` | Settings popup and buttons |
| `manifest.json` | Extension configuration |

---

## Customizing

The defaults live in the `DEFAULTS` object at the top of **both** `content.js` and `popup.js`. If you change a default, change it in both files, then toggle any setting once in the popup (or clear the extension's storage) so the new value is picked up. Also see `AD_SELECTORS` and `AD_TEXT` in `content.js` for ad detection, and `AD_RATE` for the ad fast-forward speed.