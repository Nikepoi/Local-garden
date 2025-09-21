// assets/player.js
// Minimal, no HEAD/CORS, playlist from links.videy, download links only for non-videy sources.
// Robust play attempts: user gesture -> try play -> try muted play -> show debug (no open tab).

(() => {
  const POSTS_JSON = '/data/posts.json';

  function dbg(...args){
    console.log(...args);
    const el = document.getElementById('debug');
    if (!el) return;
    try {
      el.textContent = (new Date()).toLocaleTimeString() + ' — ' + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' | ');
    } catch(e){}
  }

  function safeUrl(u){ return u ? String(u).trim() : u; }
  function isPlayableURL(u){ return /\.(mp4|m3u8|webm|ogg)(\?.*)?$/i.test(String(u||'')); }
  function isDirectFile(u){ return /\.(zip|rar|7z|mp4|webm|ogg)(\?.*)?$/i.test(String(u||'')); }
  function filenameFromUrl(u){ try { return decodeURIComponent((new URL(u)).pathname.split('/').pop() || u); } catch(e){ return (u||'').split('/').pop() || u; } }
  function formatTime(s){ if (!isFinite(s)) return '00:00'; const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60); if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }

  async function loadJSON(url){
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function init(){
    const player = document.getElementById('player');
    const playerWrap = document.getElementById('playerWrap');
    const wrap = document.getElementById('videoWrap');
    const progress = document.getElementById('progress');
    const timeEl = document.getElementById('time');
    const playBtn = document.getElementById('playPause');
    const bigPlay = document.getElementById('bigPlay');
    const overlay = document.getElementById('overlay');
    const iconPlay = document.getElementById('iconPlay');
    const iconMute = document.getElementById('iconMute');
    const muteBtn = document.getElementById('mute');
    const fsBtn = document.getElementById('fs');
    const cinemaBtn = document.getElementById('cinema');
    const speedBtn = document.getElementById('speedBtn');
    const postTitle = document.getElementById('postTitle');
    const postDate = document.getElementById('postDate');
    const postDesc = document.getElementById('postDesc');
    const downloadArea = document.getElementById('downloadArea') || (function(){ const d=document.createElement('div'); d.id='downloadArea'; document.querySelector('.container')?.appendChild(d); return d; })();

    // ensure volZone and volPop
    let volZone = document.getElementById('volZone');
    if (!volZone && wrap){ volZone = document.createElement('div'); volZone.id='volZone'; volZone.className='vol-zone'; wrap.appendChild(volZone); }
    let volPop = document.getElementById('volPop');
    if (!volPop){ volPop = document.createElement('div'); volPop.id='volPop'; volPop.className='vol-pop'; volPop.innerHTML = '<input id="volSlider" type="range" min="0" max="100" step="1" value="100" aria-label="Volume">'; document.body.appendChild(volPop); }
    const volSlider = document.getElementById('volSlider');
    const volumeIndicator = document.getElementById('volumeIndicator') || (function(){ const el=document.createElement('div'); el.id='volumeIndicator'; el.className='volume-indicator'; el.style.display='none'; document.body.appendChild(el); return el; })();

    // slug detection
    const metaSlugEl = document.querySelector('meta[name="slug"]');
    const urlParams = new URLSearchParams(window.location.search);
    const rawName = (location.pathname.split('/').pop() || '').replace('.html','');
    const slugCandidates = [
      metaSlugEl && metaSlugEl.content ? metaSlugEl.content : null,
      urlParams.get('slug'),
      urlParams.get('id'),
      rawName
    ].filter(Boolean);
    const slugUsed = slugCandidates.length ? slugCandidates[0] : '';

    // load posts.json
    let posts;
    try {
      posts = await loadJSON(POSTS_JSON);
      if (posts && posts.posts && Array.isArray(posts.posts)) posts = posts.posts;
      if (!Array.isArray(posts) || !posts.length) throw new Error('posts.json invalid or empty');
      dbg('posts.json loaded', posts.length + ' items');
    } catch(e){
      dbg('posts.json error', String(e));
      const el = document.getElementById('debug'); if (el) el.textContent = 'posts.json load failed: ' + String(e);
      return;
    }

    // find post
    let post = null;
    if (slugUsed) {
      post = posts.find(p => {
        if (!p) return false;
        const pslug = (p.slug||'').toString(), pid = (p.id||'').toString(), ppath = (p.path||'').toString();
        const filename = (ppath.split('/').pop()||'').replace('.html','');
        return pslug === slugUsed || pid === slugUsed || filename === slugUsed || (p.url && p.url.endsWith('/' + slugUsed + '.html'));
      });
    }
    if (!post && posts.length === 1) post = posts[0];
    if (!post && rawName) post = posts.find(p => (p.title||'').toLowerCase().includes(rawName.toLowerCase()));
    if (!post) {
      dbg('no post match', slugUsed);
      const el = document.getElementById('debug'); if (el) el.textContent = 'Tidak menemukan post untuk slug: ' + slugUsed;
      return;
    }

    // build streams (videy) and downloads (others)
    const links = post.links || {};
    const streams = Array.isArray(links.videy) ? links.videy.map(x => safeUrl(x)).filter(Boolean) : [];
    const downloads = [];
    ['mediafire','terabox','pixeldrain','bonus'].forEach(k => {
      const arr = Array.isArray(links[k]) ? links[k] : [];
      arr.forEach(u => { if (u && typeof u === 'string') downloads.push({ url: safeUrl(u), source: k }); });
    });
    post._streams = streams.filter(s => isPlayableURL(s));
    post._downloadLinks = downloads;

    // render metadata & poster
    if (postTitle) postTitle.textContent = post.title || '';
    if (postDate) postDate.textContent = post.date || '';
    if (postDesc) postDesc.innerHTML = (post.description || post.excerpt || '') .toString().replace(/<img\b[^>]*>/gi,'').replace(/\n/g,'<br>');
    if (post.thumb && player) try { player.poster = safeUrl(post.thumb); } catch(e){}

    // render download links (only non-videy)
    function renderDownloadArea(){
      if (!downloadArea) return;
      downloadArea.innerHTML = '';
      if (Array.isArray(post._downloadLinks) && post._downloadLinks.length){
        for (const it of post._downloadLinks){
          const a = document.createElement('a');
          a.className = 'download-link small';
          a.href = it.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          const fn = filenameFromUrl(it.url);
          a.textContent = `${it.source} — ${fn || 'file'} — full`;
          if (isDirectFile(it.url)) try { a.setAttribute('download',''); } catch(e){}
          downloadArea.appendChild(a);
        }
      } else {
        const hint = document.createElement('div');
        hint.style.color = 'var(--muted,#6b7280)';
        hint.style.fontSize = '13px';
        hint.textContent = 'Tidak ada link download (hanya streaming).';
        downloadArea.appendChild(hint);
      }
    }
    renderDownloadArea();

    // wait for canplay helper (no network probing)
    function waitForCanPlay(el, timeout = 4000){
      return new Promise(resolve => {
        let done = false;
        function cleanup(){ el.removeEventListener('loadedmetadata', onOk); el.removeEventListener('canplay', onOk); clearTimeout(timer); }
        function onOk(){ if (done) return; done=true; cleanup(); resolve(true); }
        const timer = setTimeout(()=>{ if (done) return; done=true; cleanup(); resolve(false); }, timeout);
        el.addEventListener('loadedmetadata', onOk);
        el.addEventListener('canplay', onOk);
      });
    }

    // setup media (simple: set <source> and load). Remove crossorigin attribute to avoid CORS preflight concerns.
    async function setupMediaForUrl(u){
      try {
        // remove previous
        while (player.firstChild) player.removeChild(player.firstChild);
        if (player._hls && typeof player._hls.destroy === 'function'){ try{ player._hls.destroy(); } catch(e){} player._hls = null; }
      } catch(e){}
      if (!u){
        const s = document.createElement('source'); s.src = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'; s.type = 'video/mp4'; player.appendChild(s); try{ player.load(); } catch(e){}
        return;
      }

      // remove crossorigin attribute to avoid crossOrigin request differences
      try { player.removeAttribute && player.removeAttribute('crossorigin'); } catch(e){}

      const src = safeUrl(u);
      if (!src) return;

      if (src.toLowerCase().endsWith('.m3u8')) {
        // try HLS if available
        try {
          if (!window.Hls){
            // dynamic load hls.js (only when needed)
            await new Promise((resolve,reject)=>{
              const scr = document.createElement('script');
              scr.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.0/dist/hls.min.js';
              scr.onload = ()=> resolve();
              scr.onerror = ()=> reject(new Error('hls load fail'));
              document.head.appendChild(scr);
            });
          }
          if (window.Hls && Hls.isSupported()){
            const hls = new Hls({capLevelToPlayerSize:true});
            hls.loadSource(src); hls.attachMedia(player); player._hls = hls; dbg('HLS attached', src);
          } else {
            const s = document.createElement('source'); s.src = src; s.type = 'application/vnd.apple.mpegurl'; player.appendChild(s); try{ player.load(); } catch(e){}
          }
        } catch(err){
          dbg('hls error', err);
          const s = document.createElement('source'); s.src = src; s.type = 'application/vnd.apple.mpegurl'; player.appendChild(s); try{ player.load(); } catch(e){}
        }
      } else {
        const s = document.createElement('source');
        s.src = src;
        s.type = src.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/unknown';
        player.appendChild(s);
        try{ player.load(); } catch(e){}
        dbg('mp4 set to source', src);
      }

      // try to wait a bit to let browser parse metadata (no network probing)
      await waitForCanPlay(player, 3500);
    }

    // UI helpers
    function setPlayIcon(paused){ if (!iconPlay) return; if (paused) iconPlay.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"/>'; else iconPlay.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>'; }
    function showOverlay(){ if (overlay) { overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); } }
    function hideOverlay(){ if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); } }

    // robust play attempt: try play -> muted fallback -> report error (no open tab).
    async function attemptPlayWithFallback(){
      const currentSrc = player.currentSrc || '';
      dbg('attemptPlayWithFallback currentSrc=' + currentSrc);
      try {
        await player.play();
        setPlayIcon(false); hideOverlay();
        dbg('play started');
        return { ok:true };
      } catch(e1){
        dbg('play rejected, trying muted play', e1);
        const wasMuted = player.muted;
        try {
          player.muted = true;
          await player.play();
          setPlayIcon(false); hideOverlay();
          player.muted = wasMuted;
          dbg('muted play succeeded');
          return { ok:true, mutedFallback:true };
        } catch(e2){
          player.muted = wasMuted;
          // show detailed debug info (no open tab)
          const errCode = (player.error && player.error.code) || 'no-media-error';
          const ns = player.networkState;
          const rs = player.readyState;
          dbg('muted play rejected', e2, 'mediaErrorCode=' + errCode, 'networkState=' + ns, 'readyState=' + rs);
          const debugEl = document.getElementById('debug');
          if (debugEl) {
            debugEl.textContent = [
              (new Date()).toLocaleTimeString(),
              ' — Playback blocked.',
              'src:' + (currentSrc || '[empty]'),
              'mediaError=' + (player.error ? JSON.stringify(player.error) : 'null'),
              'readyState=' + rs,
              'networkState=' + ns,
              'Check server: must return raw video (200/206) with Content-Type: video/mp4 and not an HTML redirect or attachment.'
            ].join(' | ');
          }
          return { ok:false, error: e2 };
        }
      }
    }

    // wire controls
    if (playBtn) playBtn.addEventListener('click', ()=> { if (player.paused) attemptPlayWithFallback(); else player.pause(); });
    if (bigPlay) bigPlay.addEventListener('click', async ()=> {
      // ensure a stream is loaded
      if ((!player.currentSrc || player.currentSrc === '') && Array.isArray(post._streams) && post._streams.length) {
        await setupMediaForUrl(post._streams[0]);
      }
      window._userInteracted = true;
      await attemptPlayWithFallback();
    });

    if (player){
      player.addEventListener('click', ()=> { if (player.paused) attemptPlayWithFallback(); else player.pause(); });
      player.addEventListener('play', ()=> { setPlayIcon(false); hideOverlay(); });
      player.addEventListener('pause', ()=> { setPlayIcon(true); showOverlay(); });
      player.addEventListener('loadedmetadata', ()=> { if (timeEl) timeEl.textContent = `${formatTime(0)} / ${formatTime(player.duration)}`; });
      player.addEventListener('timeupdate', ()=> {
        const pct = (player.currentTime / Math.max(1, player.duration)) * 100;
        try{ if (!Number.isNaN(pct) && progress) progress.value = pct; } catch(e){}
        if (timeEl) timeEl.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
      });
      player.addEventListener('error', (e) => { dbg('media element error event', e, player.error && player.error.code); });
    }

    // progress / seek
    if (progress) {
      progress.addEventListener('input', (e) => {
        const pct = Number(e.target.value || 0);
        const t = (pct/100) * (player.duration || 0);
        if (timeEl) timeEl.textContent = `${formatTime(t)} / ${formatTime(player.duration)}`;
      });
      progress.addEventListener('change', (e) => {
        const pct = Number(e.target.value || 0);
        player.currentTime = (pct/100) * (player.duration || 0);
      });
    }

    // volume UI (kept simple)
    let prevVolume = typeof player.volume === 'number' ? player.volume : 1;
    function updateMuteUI(){ if (!iconMute || !player) return; if (player.muted || player.volume === 0) iconMute.innerHTML = '<path d="M16.5 12c0-1.77-.77-3.36-1.99-4.44L13 9.07A3.01 3.01 0 0 1 15 12a3 3 0 0 1-2 2.83V17l4 2V7.17L16.5 8.56A6.98 6.98 0 0 1 18 12z" fill="currentColor"/>'; else iconMute.innerHTML = '<path d="M5 9v6h4l5 5V4L9 9H5z" fill="currentColor"/>'; }
    function showVolumeIndicator(perc){ if (!volumeIndicator) return; volumeIndicator.style.display='inline-flex'; volumeIndicator.textContent = `Volume ${perc}%`; if (window._volTimeout) clearTimeout(window._volTimeout); window._volTimeout = setTimeout(()=> volumeIndicator.style.display = 'none', 900); }

    if (muteBtn) muteBtn.addEventListener('click', (ev)=> {
      if (player.muted || player.volume === 0){ player.muted = false; player.volume = prevVolume || 1; } else { prevVolume = player.volume; player.muted = true; }
      updateMuteUI(); showVolumeIndicator(Math.round((player.muted?0:player.volume)*100));
      const rect = muteBtn.getBoundingClientRect(); volPop.style.display='block'; volPop.style.left = (rect.right - 140) + 'px'; volPop.style.top = (rect.top - 56) + 'px';
      if (window._volPopTimeout) clearTimeout(window._volPopTimeout); window._volPopTimeout = setTimeout(()=> { volPop.style.display='none'; }, 4000);
    });
    if (volSlider) volSlider.addEventListener('input', (e)=> { const v = Number(e.target.value)/100; player.volume = v; player.muted = v === 0; showVolumeIndicator(Math.round(v*100)); });

    document.addEventListener('click', (ev)=> { if (!volPop) return; if (volPop.contains(ev.target) || (muteBtn && muteBtn.contains(ev.target))) return; volPop.style.display='none'; });

    // prevent context & drag
    try { wrap.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('dragstart', ev => ev.preventDefault()); } catch(e){}

    // fs / cinema / speed
    if (fsBtn) fsBtn.addEventListener('click', async ()=> { try { if (document.fullscreenElement) await document.exitFullscreen(); else await playerWrap.requestFullscreen(); } catch(e){ dbg('fs err', e); } });
    if (cinemaBtn) cinemaBtn.addEventListener('click', ()=> { const active = playerWrap.classList.toggle('theater'); document.body.classList.toggle('theater', active); });
    const speeds = [1,1.25,1.5,2]; let speedIndex=0; if (speedBtn) speedBtn.addEventListener('click', ()=> { speedIndex=(speedIndex+1)%speeds.length; if (player) player.playbackRate = speeds[speedIndex]; speedBtn.textContent = speeds[speedIndex]+'×'; });

    // keyboard shortcuts
    document.addEventListener('keydown', (e)=> {
      if (['INPUT','TEXTAREA'].includes((document.activeElement||{}).tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); if (player.paused) attemptPlayWithFallback(); else player.pause(); }
      if (e.key === 'f') fsBtn && fsBtn.click();
      if (e.key === 't') cinemaBtn && cinemaBtn.click();
      if (e.key === 'm') muteBtn && muteBtn.click();
      if (e.key === 'ArrowRight') player.currentTime = Math.min(player.duration||0, player.currentTime + 10);
      if (e.key === 'ArrowLeft') player.currentTime = Math.max(0, player.currentTime - 10);
      if (e.key === 'ArrowUp'){ player.volume = Math.min(1, player.volume + 0.05); showVolumeIndicator(Math.round(player.volume*100)); volSlider && (volSlider.value = Math.round(player.volume*100)); }
      if (e.key === 'ArrowDown'){ player.volume = Math.max(0, player.volume - 0.05); showVolumeIndicator(Math.round(player.volume*100)); volSlider && (volSlider.value = Math.round(player.volume*100)); }
    });

    // Playlist (videy streams only)
    (function attachPlaylist(){
      if (!Array.isArray(post._streams) || post._streams.length === 0) return;
      const streams = post._streams.slice();
      const old = document.getElementById('playlistControls'); if (old) old.remove();
      const plc = document.createElement('div'); plc.id='playlistControls'; plc.style.display='flex'; plc.style.gap='8px'; plc.style.alignItems='center'; plc.style.marginTop='8px';
      const prevBtn = document.createElement('button'); prevBtn.className='icon-btn'; prevBtn.textContent='‹ Prev';
      const idxInput = document.createElement('input'); idxInput.type='number'; idxInput.min='1'; idxInput.value='1'; idxInput.style.width='64px';
      const countSpan = document.createElement('span'); countSpan.textContent=` / ${streams.length}`;
      const nextBtn = document.createElement('button'); nextBtn.className='icon-btn'; nextBtn.textContent='Next ›';
      plc.append(prevBtn, idxInput, countSpan, nextBtn);
      const pa = document.querySelector('.post-actions') || document.body;
      pa.appendChild(plc);

      let cur = 0;
      let userInteracted = false;
      window._userInteracted = false;
      if (bigPlay) bigPlay.addEventListener('click', ()=> { userInteracted = true; window._userInteracted = true; });
      if (playBtn) playBtn.addEventListener('click', ()=> { userInteracted = true; window._userInteracted = true; });

      async function playAt(i, autoplayIfInteracted=true){
        i = Math.max(0, Math.min(streams.length-1, i));
        cur = i; idxInput.value = cur+1;
        await setupMediaForUrl(streams[cur]);
        if (autoplayIfInteracted && (userInteracted || window._userInteracted)) {
          const res = await attemptPlayWithFallback();
          if (!res.ok) dbg('playAt failed', res.error);
        } else showOverlay();
      }

      prevBtn.addEventListener('click', async ()=> { if (cur>0) await playAt(cur-1); });
      nextBtn.addEventListener('click', async ()=> { if (cur<streams.length-1) await playAt(cur+1); });
      idxInput.addEventListener('change', async ()=> { const v = Number(idxInput.value)-1; if (Number.isInteger(v) && v>=0 && v<streams.length) await playAt(v); else idxInput.value = cur+1; });

      player.addEventListener('ended', async ()=> {
        if (cur < streams.length-1) {
          cur++; idxInput.value = cur+1;
          await setupMediaForUrl(streams[cur]);
          if (userInteracted || window._userInteracted) {
            try { await player.play(); } catch(e){ dbg('auto-next blocked', e); showOverlay(); }
          } else showOverlay();
        } else { dbg('playlist ended'); showOverlay(); }
      });

      // initial load (do not autoplay)
      cur = 0; idxInput.value = cur+1;
      setupMediaForUrl(streams[cur]).then(()=> showOverlay()).catch(e => { dbg('initial setup err', e); showOverlay(); });
    })();

    // final UI init
    try { setPlayIcon(player.paused); } catch(e){}
    try { updateMuteUI(); if (volSlider) volSlider.value = Math.round((player.muted?0:player.volume||1)*100); } catch(e){}
    dbg('player ready for post', post.slug || post.id || post.path || post.title);
  } // init

  // run
  init().catch(err => { console.error(err); try { const el=document.getElementById('debug'); if (el) el.textContent = 'init error: '+String(err); } catch(e){} });
})();
