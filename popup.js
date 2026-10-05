const KEY = 'pw:settings';
const DEFAULTS = { recap: true, adskip: true, skipIntro: true, ytChapters: true, clipSec: 15, blockMin: 15, minGapMin: 10 };
const MIN = { clipSec: 5, blockMin: 1 };
const $ = (id) => document.getElementById(id);
const getS = async () => ({ ...DEFAULTS, ...((await chrome.storage.local.get(KEY))[KEY]) });
const update = async (p) => chrome.storage.local.set({ [KEY]: { ...(await getS()), ...p } });

(async () => {
  const S = await getS();
  for (const id of ['recap', 'adskip', 'skipIntro', 'ytChapters']) {
    $(id).checked = S[id];
    $(id).onchange = () => update({ [id]: $(id).checked });
  }
  for (const id of ['clipSec', 'blockMin']) {
    $(id).value = S[id];
    $(id).onchange = () => update({ [id]: Math.max(MIN[id], Math.min(60, +$(id).value || DEFAULTS[id])) });
  }
})();

$('replay').onclick = async () => {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!t?.id) { $('msg').textContent = 'No active tab.'; return; }
  try {
    await chrome.tabs.sendMessage(t.id, { type: 'replayRecap' });
    window.close();
  } catch (e) {
    const m = String(e?.message || e);
    if (/Receiving end does not exist|Could not establish connection|message port closed/i.test(m)) {
      $('msg').textContent = 'Refresh the video tab first (extension was just reloaded).';
    } else {
      $('msg').textContent = 'Open a Netflix, Disney+, Hulu or YouTube video first.';
    }
  }
};

$('clear').onclick = async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('pw:') && k !== KEY));
  $('msg').textContent = 'Watch history cleared.';
};