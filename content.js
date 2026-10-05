const IS_NETFLIX = location.hostname.includes('netflix');
const IS_YT = location.hostname.endsWith('youtube.com');
const SETTINGS_KEY = 'pw:settings';
const DEFAULTS = { recap: true, adskip: true, skipIntro: true, ytChapters: true, clipSec: 15, blockMin: 15, minGapMin: 10 };
const AD_RATE = 16; // playback speed used to fast-forward through ads

let S = { ...DEFAULTS };
let video = null, key = null, ready = false;
let watched = new Set(), flags = [], lastSeen = 0;
let recapping = false, primed = false, skipFlag = false;
let inAd = false, saved = null;

// ---------- extension-context lifetime ----------
// After the extension is reloaded/updated/disabled, this content script keeps
// running in the page but chrome.* APIs are gone. Every chrome.* call must be
// guarded so we fail quietly instead of spamming "Extension context invalidated".
let dead = false;
let mainTimer = null, saveTimer = null;

function alive() {
  try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); }
  catch { return false; }
}

function teardown() {
  if (dead) return;
  dead = true;
  if (mainTimer) clearInterval(mainTimer);
  if (saveTimer) clearInterval(saveTimer);
  try { video?.removeEventListener('playing', onPlaying); } catch { }
  video = null;
  ready = false;
}

// ---------- settings ----------
(async () => {
  if (!alive()) { teardown(); return; }
  try {
    const d = await chrome.storage.local.get(SETTINGS_KEY);
    S = { ...DEFAULTS, ...d[SETTINGS_KEY] };
  } catch { teardown(); }
})();

try {
  chrome.storage.onChanged.addListener((c) => {
    if (!alive()) { teardown(); return; }
    if (c[SETTINGS_KEY]) S = { ...DEFAULTS, ...c[SETTINGS_KEY].newValue };
    if (key && c[key] && !c[key].newValue) { watched.clear(); flags = []; } // history cleared from popup
  });
} catch { /* context already gone at load */ }

try {
  chrome.runtime.onMessage.addListener((m) => {
    if (!alive()) { teardown(); return; }
    if (m.type === 'replayRecap') replayNow();
  });
} catch { /* context already gone at load */ }

// ---------- seeking ----------
if (IS_NETFLIX && alive()) { // Netflix needs its own player API; see page-bridge.js
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('page-bridge.js');
  document.documentElement.appendChild(s);
}
const seek = (t) => IS_NETFLIX
  ? window.postMessage({ src: 'pw', type: 'seek', ms: t * 1000 }, '*')
  : (video.currentTime = t);

const getKey = () => IS_YT
  ? `pw:youtube:${new URLSearchParams(location.search).get('v')}`
  : `pw:${location.hostname}:${location.pathname.split('/').filter(Boolean).pop()}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---------- main loop (1s) ----------
mainTimer = setInterval(() => {
  if (dead) return;
  // YouTube: only the /watch page has a real player (home/search show hover previews)
  const v = (IS_YT && location.pathname !== '/watch') ? null : document.querySelector('video');
  if (!v) { if (video) { save(); video = null; ready = false; } return; }
  if (v !== video || getKey() !== key) attach(v);
  if (!ready) return;

  if (S.adskip) handleAds(); else if (inAd) endAd();
  if (S.skipIntro && !recapping && !inAd) clickByText(/^skip (intro|recap|credits|opening|title sequence)$/i);

  // log watched seconds (never during ads or recap clips)
  if (!video.paused && !video.seeking && !recapping && !inAd) {
    watched.add(Math.floor(video.currentTime));
    lastSeen = Date.now();
  }
}, 1000);

saveTimer = setInterval(save, 10000);

function save() {
  if (dead || !key || !ready || !watched.size) return;
  if (!alive()) { teardown(); return; }
  try {
    const p = chrome.storage.local.set({ [key]: { watched: [...watched], flags, lastSeen } });
    if (p && typeof p.catch === 'function') p.catch(() => teardown());
  } catch { teardown(); }
}

async function attach(v) {
  if (dead) return;
  save();
  ready = false; video = v; key = getKey(); primed = false;
  if (!alive()) { teardown(); return; }
  let d;
  try {
    d = (await chrome.storage.local.get(key))[key];
  } catch { teardown(); return; }
  if (dead) return;
  watched = new Set(d?.watched || []); flags = d?.flags || []; lastSeen = d?.lastSeen || 0;
  ready = true;
  video.addEventListener('playing', onPlaying);
  if (!video.paused) onPlaying();
}

// ---------- recap ----------
// Watch time is sampled about once a second, so allow a little slack when checking a second.
const seen = (t) => watched.has(t) || watched.has(t - 1) || watched.has(t + 1) || watched.has(t + 2);
function covered(s, len) {
  for (let t = s; t < s + len; t += 3) if (!seen(t)) return false;
  return seen(s + len - 1);
}

// A clip is {start, len} in seconds.
function buildClips(resumeAt, chapters = []) {
  const block = S.blockMin * 60, len = S.clipSec;

  // Default: for each block of watching (including the last partial block), the latest N seconds
  // inside it that you actually watched
  const timed = [];
  for (let bs = 0; bs < resumeAt; bs += block) {
    const be = Math.min(bs + block, resumeAt);
    if (be - bs < 120) continue;              // skip a tiny tail right before the resume point
    for (let s = be - len; s >= bs; s--) {
      if (covered(s, len)) { timed.push({ start: s, len }); break; }
    }
  }

  // YouTube chapters: a clip of the full clip length from the start of each finished chapter
  // (shorter only if the chapter itself is shorter than the clip length)
  let byChapter = [];
  if (chapters.length >= 3) {
    const done = [];
    for (let i = 0; i < chapters.length - 1; i++) {
      const c = chapters[i], next = chapters[i + 1];
      if (next <= resumeAt && seen(c)) done.push({ c, room: next - c });
    }
    byChapter = done.map(d => ({ start: d.c, len: Math.min(len, d.room) }));
  }

  // User flags (Alt+R): clip starts 3s before the flagged moment, always included
  const flagged = flags.map(f => ({ start: Math.max(0, f - 3), len }))
    .filter(c => c.start + len <= resumeAt && seen(c.start));

  // Use chapter clips only when there are at least 2; otherwise fall back to the timed clips
  const base = byChapter.length >= 2 ? byChapter : timed;
  const merged = [...flagged, ...base.filter(c => !flagged.some(f => Math.abs(f.start - c.start) < len))];
  return merged.sort((a, b) => a.start - b.start);
}

// ---------- YouTube chapters ----------
const toSec = (t) => t.split(':').reduce((a, p) => a * 60 + +p, 0);

function getChapters() {
  let times = [];
  // 1) the chapter list panel, if YouTube has rendered it
  document.querySelectorAll('ytd-macro-markers-list-item-renderer #time').forEach(el => {
    const t = el.textContent.trim();
    if (/^\d{1,2}(:\d{2}){1,2}$/.test(t)) times.push(toSec(t));
  });
  // 2) otherwise timestamps in the description (YouTube's own rule: starts at 0:00, 3+ entries)
  if (times.length < 3) {
    const desc = document.querySelector('ytd-watch-metadata #description-inner')?.innerText || '';
    times = [...desc.matchAll(/(?:^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?=\s|$)/g)].map(m => toSec(m[1]));
  }
  times = [...new Set(times)].sort((a, b) => a - b);
  const last = times[times.length - 1];
  return times[0] === 0 && times.length >= 3 && last < video.duration ? times : [];
}

async function loadChapters() {
  if (!IS_YT || !S.ytChapters) return [];
  for (let i = 0; i < 8; i++) {      // the description can render a moment after playback starts
    const c = getChapters();
    if (c.length >= 3) return c;
    await sleep(500);
  }
  return [];
}

async function onPlaying() {
  if (dead || primed || recapping || !S.recap) return;
  if (!Number.isFinite(video.duration)) return;            // live stream / not loaded yet
  if (inAd || (IS_YT && adVisible())) return;              // wait for the real video, not a pre-roll ad
  primed = true;
  const resumeAt = video.currentTime;
  if (Date.now() - lastSeen < S.minGapMin * 60e3) return;

  const pausing = IS_YT && S.ytChapters && resumeAt > 120;  // hold playback while we look up chapters
  if (pausing) video.pause();
  const clips = buildClips(resumeAt, await loadChapters());
  if (dead) return;
  if (!clips.length) { if (pausing) video.play(); return; }
  await runRecap(clips, resumeAt);
}

async function replayNow() {
  if (dead || !video || recapping) return;
  const at = video.currentTime;
  const clips = buildClips(at, await loadChapters());
  if (dead) return;
  if (!clips.length) return toast(watched.size
    ? `Nothing to recap yet (${Math.floor(watched.size / 60)} min of watching tracked so far)`
    : 'No watch history tracked for this video yet. Watch for a bit first.');
  runRecap(clips, at);
}

async function runRecap(clips, resumeAt) {
  recapping = true; skipFlag = false;
  const ui = overlay();
  const v = video;
  const rate = v.playbackRate;   // recap clips always play at normal speed; restored afterwards
  v.playbackRate = 1;
  try {
    for (let i = 0; i < clips.length && !skipFlag; i++) {
      if (dead) return;
      const { start, len } = clips[i];
      ui.label.textContent = `Previously watched... ${i + 1}/${clips.length}`;
      seek(start);
      // wait for the seek to actually land (Netflix seeks go through the page bridge)
      const t0 = Date.now();
      while (!skipFlag && Math.abs(video.currentTime - start) > 2 && Date.now() - t0 < 5000) await sleep(100);
      if (dead) return;
      video.play();
      const t1 = Date.now();
      while (!skipFlag && video.currentTime < start + len && Date.now() - t1 < (len + 10) * 1000) await sleep(250);
    }
    if (dead) return;
    seek(resumeAt);
    await sleep(800);
    if (dead) return;
    video.play();
  } catch (e) {
    console.warn('[PW] recap aborted', e);
  } finally {
    ui.el.remove();
    recapping = false;
    try { v.playbackRate = rate; } catch { }
  }
}

// ---------- recap flags: Alt+R (Option+R on Mac) ----------
window.addEventListener('keydown', (e) => {
  if (dead) return;
  if (!(e.altKey && e.code === 'KeyR') || !video) return;
  e.preventDefault();
  const t = Math.floor(video.currentTime);
  flags = [...new Set([...flags, t])].sort((a, b) => a - b);
  save();
  toast(`Recap moment saved at ${fmt(t)}`);
}, true);

// ---------- ads ----------
// Best-guess selectors; streaming sites change markup often, so tune these against the live DOM.
const AD_SELECTORS = {
  'netflix.com': ['[data-uia*="ads-info"]', '.watch-video--ads-info-container', '[data-uia="ad-break-timer"]'],
  'disneyplus.com': ['[data-testid*="ad-badge"]', '[class*="ad-badge"]', '[data-testid*="ads-"]'],
  'hulu.com': ['.AdUnitView', '[class*="AdUnit"]', '[class*="ad-countdown"]']
};
const AD_TEXT = /^(ad|ads)(\s*[:\u00b7\u2022-]?\s*\d+\s*(of|\/)\s*\d+|\s*[:\u00b7\u2022-]?\s*\d+:\d+|\s+break)?$|\b(ad|ads)\b (will )?(end|resume)|resumes? after (the )?ad|video will (resume|play) after/i;

function adVisible() {
  if (IS_YT) return !!document.querySelector('.html5-video-player.ad-showing');
  const host = Object.keys(AD_SELECTORS).find(h => location.hostname.endsWith(h));
  if (host && AD_SELECTORS[host].some(s => { try { return document.querySelector(s); } catch { return false; } })) return true;
  for (const el of document.querySelectorAll('span,div')) {
    if (el.childElementCount === 0) {
      const t = el.textContent.trim();
      if (t.length < 40 && AD_TEXT.test(t)) return true;
    }
  }
  return false;
}

function handleAds() {
  if (dead || !video) return;
  if (IS_YT) document.querySelector('.ytp-ad-overlay-close-button')?.click(); // banner ads
  const ad = adVisible();
  if (ad && !inAd) { inAd = true; saved = { muted: video.muted, rate: video.playbackRate }; }
  if (ad) {
    video.muted = true;
    video.playbackRate = AD_RATE;
    clickByText(/^skip( ad| ads)?$/i);
    if (IS_YT) document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern')?.click();
  } else if (inAd) endAd();
}
function endAd() {
  inAd = false;
  if (saved && video) { video.muted = saved.muted; video.playbackRate = saved.rate; }
  saved = null;
}

// ---------- helpers ----------
function clickByText(re) {
  for (const b of document.querySelectorAll('button,[role="button"]')) {
    const t = (b.getAttribute('aria-label') || b.textContent || '').trim();
    if (re.test(t) && b.getClientRects().length) { b.click(); return true; }
  }
  return false;
}

const BOX = 'position:fixed;top:24px;left:24px;z-index:2147483647;background:rgba(0,0,0,.75);color:#fff;padding:10px 14px;border-radius:8px;font:600 14px sans-serif;display:flex;gap:12px;align-items:center';
const host = () => document.fullscreenElement || document.body;

function overlay() {
  const el = document.createElement('div'); el.style.cssText = BOX;
  const label = document.createElement('span');
  const btn = document.createElement('button'); btn.textContent = 'Skip';
  btn.style.cssText = 'cursor:pointer;border:1px solid #fff;background:none;color:#fff;border-radius:4px;padding:2px 8px';
  btn.onclick = () => { skipFlag = true; };
  el.append(label, btn); host().appendChild(el);
  return { el, label };
}
function toast(msg) {
  const el = document.createElement('div'); el.style.cssText = BOX; el.textContent = msg;
  host().appendChild(el); setTimeout(() => el.remove(), 2500);
}