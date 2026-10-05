// Runs in the page's own JS world so it can reach Netflix's player API.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.src !== 'pw') return;
  try {
    const vp = netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const id = vp.getAllPlayerSessionIds()[0];
    vp.getVideoPlayerBySessionId(id).seek(e.data.ms);
  } catch (err) { console.warn('[PW] Netflix seek failed', err); }
});
