// assets/player.js (fixed full version)
// Minimal, no HEAD/CORS, playlist from links.videy, download links only for non-videy sources.
// Robust play attempts: user gesture -> try play -> try muted play -> show debug (no open tab).
//
// Adds: always show full video (no crop) via object-fit: contain; manual Back button.

(() => {
  const POSTS_JSON = '/data/posts.json';

  /* --- Utilities -------------------------------------------------------- */
  function dbg(...args){
    console.log(...args);
    const el = document.getElementById('debug');
    if (!el) return;
    try {
      el.textContent = (new Date()).toLocaleTimeString() + ' — ' +
        args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' | ');
    } catch(e){}
  }

  function safeUrl(u){ return u ? String(u).trim() : ''; }
  function isPlayableURL(u){ return /\.(mp4|m3u8|webm|ogg)(\?.*)?$/i.test(String(u||'')); }
  function isDirectFile(u){ return /\.(zip|rar|7z|mp4|webm|ogg)(\?.*)?$/i.test(String(u||'')); }
  function filenameFromUrl(u){ try { return decodeURIComponent((new URL(u)).pathname.split('/').pop() || u); } catch(e){ return (u||'').split('/').pop() || u; } }
  function formatTime(s){
    if (!isFinite(s) || s === undefined) return '00:00';
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
    if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  async function loadJSON(url){
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* --- Inject small CSS (self-contained) --------------------------------- */
  (function injectCss(){
    const css = `
      /* Download list */
      .download-list { display:flex; flex-direction:column; gap:10px; margin-top:12px; }
      .download-link.item { display:flex; align-items:center; justify-content:space-between; background:#000; color:#fff; padding:10px 14px; border-radius:12px; text-decoration:none; font-weight:700; gap:8px; box-shadow: 0 6px 14px rgba(0,0,0,0.12); }
      .download-link.item .dl-center { flex:1 1 auto; padding:0 12px; color:#fff; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

      /* Player base */
      .vp-container { position: relative; width: 100%; max-width: 1200px; margin: 0 auto; display:block; }
      video.vp-video { width: 100% !important; height: auto !important; max-height: calc(100vh - 160px) !important; background:#000; display:block; object-fit: contain !important; object-position: center; border-radius: 8px; outline:none; }
      /* ensure controls area stays above video and not covered */
      .vp-ui { position: relative; z-index: 3; margin-top: 8px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

      /* Theater mode: center + dark bg and bigger player */
      .vp-theater { padding: 18px; background: rgba(0,0,0,0.85); border-radius: 10px; box-shadow: 0 30px 80px rgba(0,0,0,0.6); }
      body.vp-theater { background: #000; }

      /* Back button */
      .vp-back-btn { position: absolute; left: 12px; top: 12px; z-index: 30; background: rgba(0,0,0,0.6); color: #fff; border: none; padding: 8px 10px; border-radius: 8px; cursor:pointer; font-weight:700; backdrop-filter: blur(6px); }
      .vp-back-btn.hidden { display:none; }

      /* small extras */
      .vp-controls-extra { display:flex; gap:8px; align-items:center; }
      .vp-controls-extra .btn { background:#111; color:#fff; padding:6px 10px; border-radius:8px; font-weight:700; cursor:pointer; border:none; }
      .vp-time { font-family: monospace; font-weight:700; color:#111; }
      @media (max-width:640px) {
        video.vp-video { max-height: 60vh !important; }
        .vp-back-btn { left: 8px; top: 8px; padding:6px 8px; }
      }
    `;
    try {
      const s = document.createElement('style');
      s.setAttribute('data-origin','assets/player.js');
      s.appendChild(document.createTextNode(css));
      document.head && document.head.appendChild(s);
    } catch(e){ /* ignore */ }
  })();

  /* --- Main init ------------------------------------------------------- */
  async function init(){
    const player = document.getElementById('player');
    if (!player) { dbg('no <video id="player"> element found'); return; }

    // ensure classes and container markup for stable UI
    const playerWrap = document.getElementById('playerWrap') || (function(){ const p = player.parentElement; p.classList.add('vp-container'); return p; })();
    player.classList.add('vp-video');

    // create UI elements if missing
    const wrap = document.getElementById('videoWrap') || playerWrap;
    const progress = document.getElementById('progress') || (function(){ const el=document.createElement('input'); el.type='range'; el.id='progress'; el.min=0; el.max=100; el.value=0; el.className='vp-progress'; playerWrap.appendChild(el); return el; })();
    const timeEl = document.getElementById('time') || (function(){ const el=document.createElement('div'); el.id='time'; el.className='vp-time'; playerWrap.appendChild(el); return el; })();
    const playBtn = document.getElementById('playPause') || (function(){ const b=document.createElement('button'); b.id='playPause'; b.className='icon-btn'; b.textContent='Play'; playerWrap.appendChild(b); return b; })();
    const bigPlay = document.getElementById('bigPlay') || (function(){ const b=document.createElement('button'); b.id='bigPlay'; b.className='big-play-btn'; b.textContent='Play'; playerWrap.appendChild(b); return b; })();
    const muteBtn = document.getElementById('mute') || (function(){ const b=document.createElement('button'); b.id='mute'; b.className='icon-btn'; b.textContent='🔊'; playerWrap.appendChild(b); return b; })();
    const fsBtn = document.getElementById('fs');
    const cinemaBtn = document.getElementById('cinema');
    const speedBtn = document.getElementById('speedBtn');
    const downloadArea = document.getElementById('downloadArea') || (function(){ const d=document.createElement('div'); d.id='downloadArea'; playerWrap.appendChild(d); return d; })();

    // Back button
    let backBtn = document.getElementById('vpBackBtn');
    if (!backBtn) {
      backBtn = document.createElement('button');
      backBtn.id = 'vpBackBtn';
      backBtn.className = 'vp-back-btn hidden';
      backBtn.type = 'button';
      backBtn.textContent = '‹ Back';
      playerWrap.appendChild(backBtn);
    }

    // vol pop/slider
    let volPop = document.getElementById('volPop');
    if (!volPop) {
      volPop = document.createElement('div');
      volPop.id = 'volPop';
      volPop.className = 'vol-pop';
      volPop.style.position = 'absolute';
      volPop.style.display = 'none';
      volPop.innerHTML = '<input id="volSlider" type="range" min="0" max="100" step="1" value="100" aria-label="Volume">';
      document.body.appendChild(volPop);
    }
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

    // build streams and downloads
    const links = post.links || {};
    const streams = Array.isArray(links.videy) ? links.videy.map(x => safeUrl(x)).filter(Boolean) : [];
    const downloads = [];
    ['mediafire','terabox','pixeldrain','bonus'].forEach(k => {
      const arr = Array.isArray(links[k]) ? links[k] : [];
      arr.forEach(u => { if (u && typeof u === 'string') downloads.push({ url: safeUrl(u), source: k }); });
    });
    post._streams = streams.filter(s => isPlayableURL(s));
    post._downloadLinks = downloads;

    // render download area
    function renderDownloadArea(){
      if (!downloadArea) return;
      downloadArea.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'download-list';
      const SOURCE_LABELS = { mediafire: 'Mediafire', terabox: 'Terabox', pixeldrain: 'Pixeldrain', bonus: 'Bonus' };
      if (Array.isArray(post._downloadLinks) && post._downloadLinks.length){
        post._downloadLinks.forEach(it => {
          const url = it.url || '';
          const source = (it.source || 'link').toString().toLowerCase();
          const sourceLabel = SOURCE_LABELS[source] || source.replace(/^\w/, c => c.toUpperCase());
          const fn = filenameFromUrl(url);
          const shortFn = fn && fn.length > 48 ? fn.slice(0,45) + '...' : fn;
          const a = document.createElement('a');
          a.className = 'download-link item';
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.innerHTML = `<span class="dl-left"><span class="dl-source">${sourceLabel}</span></span><span class="dl-center" title="${fn || ''}"> — ${shortFn || fn || 'file'}</span><span class="dl-right"> — full</span>`;
          if (isDirectFile(url)) try { a.setAttribute('download',''); } catch(e){}
          list.appendChild(a);
        });
      } else {
        const hint = document.createElement('div'); hint.className = 'download-hint'; hint.textContent = 'Tidak ada link download (hanya streaming).';
        list.appendChild(hint);
      }
      downloadArea.appendChild(list);
    }
    renderDownloadArea();

    // helper: wait canplay/loadedmetadata
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

    // setup media for url (HLS support)
    async function setupMediaForUrl(u, preferHQ = false){
      try { while (player.firstChild) player.removeChild(player.firstChild); } catch(e){}
      if (player._hls && typeof player._hls.destroy === 'function'){ try{ player._hls.destroy(); } catch(e){} player._hls = null; }
      player.classList.add('vp-video');
      player.style.objectFit = 'contain'; // force contain to avoid crop

      if (!u){
        const s = document.createElement('source'); s.src = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'; s.type = 'video/mp4'; player.appendChild(s); try{ player.load(); } catch(e){}
        return { hls: null };
      }
      try { player.removeAttribute && player.removeAttribute('crossorigin'); } catch(e){}
      const src = safeUrl(u);
      if (!src) return { hls: null };

      if (src.toLowerCase().endsWith('.m3u8')) {
        try {
          if (!window.Hls){
            await new Promise((resolve,reject)=>{
              const scr = document.createElement('script');
              scr.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.0/dist/hls.min.js';
              scr.onload = ()=> resolve();
              scr.onerror = ()=> reject(new Error('hls load fail'));
              document.head.appendChild(scr);
            });
          }
          if (window.Hls && Hls.isSupported()){
            const hls = new Hls({ capLevelToPlayerSize:true, maxBufferLength:30 });
            hls.on(Hls.Events.MANIFEST_PARSED, function(event,data){
              dbg('HLS manifest parsed', data);
              try {
                if (preferHQ && Array.isArray(hls.levels) && hls.levels.length) {
                  hls.currentLevel = hls.levels.length - 1;
                  dbg('HLS: set to highest level', hls.currentLevel);
                }
              } catch(e){ dbg('hls setlevel err', e); }
            });
            hls.loadSource(src); hls.attachMedia(player); player._hls = hls; dbg('HLS attached', src);
            return { hls: player._hls };
          } else {
            const s = document.createElement('source'); s.src = src; s.type = 'application/vnd.apple.mpegurl'; player.appendChild(s); try{ player.load(); } catch(e){}
            return { hls: null };
          }
        } catch(err){
          dbg('hls error', err);
          const s = document.createElement('source'); s.src = src; s.type = 'application/vnd.apple.mpegurl'; player.appendChild(s); try{ player.load(); } catch(e){}
          return { hls: null };
        }
      } else {
        const s = document.createElement('source'); s.src = src; s.type = src.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/unknown'; player.appendChild(s);
        try{ player.load(); } catch(e){}
        dbg('mp4 set to source', src);
        return { hls: null };
      }
    }

    /* --- UI helpers ------------------------------------------------------ */
    function setPlayIcon(paused){
      try {
        if (paused) playBtn.textContent = 'Play';
        else playBtn.textContent = 'Pause';
      } catch(e){}
    }
    function updateMuteUI(){
      try {
        muteBtn.textContent = (player.muted || player.volume === 0) ? '🔈' : '🔊';
      } catch(e){}
    }
    function showOverlay(){ const overlay = document.getElementById('overlay'); if (overlay){ overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); } }
    function hideOverlay(){ const overlay = document.getElementById('overlay'); if (overlay){ overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); } }

    /* --- Back button behavior -------------------------------------------- */
    function showBackBtn(){ backBtn.classList.remove('hidden'); }
    function hideBackBtn(){ backBtn.classList.add('hidden'); }
    backBtn.addEventListener('click', () => {
      // prefer navigate back in history if available; fallback: exit theater and scroll up
      if (window.history && window.history.length > 1) {
        window.history.back();
      } else {
        exitTheaterMode();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    /* --- Theater mode helpers -------------------------------------------- */
    function enterTheaterMode(){
      playerWrap.classList.add('vp-theater');
      document.body.classList.add('vp-theater');
      // ensure full-frame (contain)
      player.style.objectFit = 'contain';
      showBackBtn();
    }
    function exitTheaterMode(){
      playerWrap.classList.remove('vp-theater');
      document.body.classList.remove('vp-theater');
      player.style.objectFit = 'contain';
      hideBackBtn();
    }

    /* --- robust play attempt --------------------------------------------- */
    async function attemptPlayWithFallback(){
      const currentSrc = player.currentSrc || '';
      dbg('attemptPlayWithFallback currentSrc=' + currentSrc);
      try {
        await player.play();
        setPlayIcon(false); hideOverlay();
        dbg('play started');
        // when started, ensure theater (per request) so resolution shows fully
        enterTheaterMode();
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
          enterTheaterMode();
          return { ok:true, mutedFallback:true };
        } catch(e2){
          player.muted = wasMuted;
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
              'Server must return raw video (200/206) with proper Content-Type (video/mp4).'
            ].join(' | ');
          }
          return { ok:false, error: e2 };
        }
      }
    }

    /* --- wire controls -------------------------------------------------- */
    if (playBtn) playBtn.addEventListener('click', async ()=> {
      if (player.paused) {
        await attemptPlayWithFallback();
      } else {
        player.pause();
      }
    });
    if (bigPlay) bigPlay.addEventListener('click', async ()=> {
      if ((!player.currentSrc || player.currentSrc === '') && Array.isArray(post._streams) && post._streams.length) {
        await setupMediaForUrl(post._streams[0]);
      }
      window._userInteracted = true;
      await attemptPlayWithFallback();
    });

    player.addEventListener('click', async ()=> {
      if (player.paused) await attemptPlayWithFallback();
      else player.pause();
    });

    player.addEventListener('play', ()=> { setPlayIcon(false); hideOverlay(); enterTheaterMode(); });
    player.addEventListener('pause', ()=> { setPlayIcon(true); showOverlay(); /* keep theater until user exits */ });
    player.addEventListener('loadedmetadata', ()=> {
      // always ensure contain so frame not cropped
      try { player.style.objectFit = 'contain'; } catch(e){}
      if (timeEl) timeEl.textContent = `${formatTime(0)} / ${formatTime(player.duration)}`;
    });
    player.addEventListener('timeupdate', ()=> {
      const pct = (player.currentTime / Math.max(1, player.duration)) * 100;
      try{ if (!Number.isNaN(pct) && progress) progress.value = pct; } catch(e){}
      if (timeEl) timeEl.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
    });
    player.addEventListener('error', (e) => { dbg('media element error event', e, player.error && player.error.code); });

    /* --- progress / seek ----------------------------------------------- */
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

    /* --- volume UI ------------------------------------------------------ */
    let prevVolume = typeof player.volume === 'number' ? player.volume : 1;
    muteBtn.addEventListener('click', (ev)=> {
      if (player.muted || player.volume === 0){ player.muted = false; player.volume = prevVolume || 1; } else { prevVolume = player.volume; player.muted = true; }
      updateMuteUI(); showVolumeIndicator(Math.round((player.muted?0:player.volume)*100));
      try {
        const rect = muteBtn.getBoundingClientRect();
        volPop.style.display='block';
        volPop.style.left = (rect.right - 140) + 'px';
        volPop.style.top = (rect.top - 56) + 'px';
      } catch(e){}
      if (window._volPopTimeout) clearTimeout(window._volPopTimeout);
      window._volPopTimeout = setTimeout(()=> { volPop.style.display='none'; }, 4000);
    });
    if (volSlider) volSlider.addEventListener('input', (e)=> { const v = Number(e.target.value)/100; player.volume = v; player.muted = v === 0; updateMuteUI(); showVolumeIndicator(Math.round(v*100)); });

    function showVolumeIndicator(perc){ if (!volumeIndicator) return; volumeIndicator.style.display='inline-flex'; volumeIndicator.textContent = `Volume ${perc}%`; if (window._volTimeout) clearTimeout(window._volTimeout); window._volTimeout = setTimeout(()=> volumeIndicator.style.display = 'none', 900); }

    document.addEventListener('click', (ev)=> { if (!volPop) return; if (volPop.contains(ev.target) || (muteBtn && muteBtn.contains(ev.target))) return; volPop.style.display='none'; });

    (function enableVerticalVolume(){
      let active=false, startY=0, startVolume=1, pointerId=null; const zone = document.getElementById('volZone') || playerWrap;
      if (!zone) return;
      zone.addEventListener('pointerdown', ev => { ev.preventDefault(); active=true; pointerId=ev.pointerId; startY=ev.clientY; startVolume = player.muted ? (prevVolume||1) : (player.volume||1); player.muted = false; try{ zone.setPointerCapture(pointerId); }catch(e){} showVolumeIndicator(Math.round(startVolume*100)); });
      zone.addEventListener('pointermove', ev => { if (!active) return; const dy = startY - ev.clientY; const delta = dy/160; let newVol = Math.max(0, Math.min(1, startVolume + delta)); player.volume = newVol; player.muted = newVol === 0; updateMuteUI(); showVolumeIndicator(Math.round(newVol*100)); if (volSlider) volSlider.value = Math.round(newVol*100); });
      function endGesture(ev){ if (!active) return; active=false; try{ zone.releasePointerCapture(ev.pointerId||pointerId); }catch(e){} pointerId=null; }
      zone.addEventListener('pointerup', endGesture); zone.addEventListener('pointercancel', endGesture); zone.addEventListener('lostpointercapture', ()=>{ active=false; });
    })();

    /* --- prevent context & drag ---------------------------------------- */
    try { wrap.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('dragstart', ev => ev.preventDefault()); } catch(e){}

    /* --- fs / theater / speed ------------------------------------------ */
    if (fsBtn) fsBtn.addEventListener('click', async ()=> { try { if (document.fullscreenElement) await document.exitFullscreen(); else await playerWrap.requestFullscreen(); } catch(e){ dbg('fs err', e); } });
    if (cinemaBtn) cinemaBtn.addEventListener('click', ()=> {
      const active = playerWrap.classList.toggle('vp-theater');
      document.body.classList.toggle('vp-theater', active);
      // ensure video fit remain contain (no crop)
      player.style.objectFit = 'contain';
      if (active) showBackBtn(); else hideBackBtn();
    });
    const speeds = [1,1.25,1.5,2]; let speedIndex=0;
    if (speedBtn) speedBtn.addEventListener('click', ()=> { speedIndex=(speedIndex+1)%speeds.length; if (player) player.playbackRate = speeds[speedIndex]; speedBtn.textContent = speeds[speedIndex]+'×'; });

    /* --- keyboard shortcuts --------------------------------------------- */
    document.addEventListener('keydown', (e)=> {
      if (['INPUT','TEXTAREA'].includes((document.activeElement||{}).tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); if (player.paused) attemptPlayWithFallback(); else player.pause(); }
      if (e.key === 'f') fsBtn && fsBtn.click();
      if (e.key === 't') cinemaBtn && cinemaBtn.click();
      if (e.key === 'm') muteBtn && muteBtn.click();
      if (e.key === 'ArrowRight') player.currentTime = Math.min(player.duration||0, player.currentTime + 10);
      if (e.key === 'ArrowLeft') player.currentTime = Math.max(0, player.currentTime - 10);
      if (e.key === 'ArrowUp'){ player.volume = Math.min(1, player.volume + 0.05); showVolumeIndicator(Math.round(player.volume*100)); volSlider && (volSlider.value = Math.round(player.volume*100)); updateMuteUI(); }
      if (e.key === 'ArrowDown'){ player.volume = Math.max(0, player.volume - 0.05); showVolumeIndicator(Math.round(player.volume*100)); volSlider && (volSlider.value = Math.round(player.volume*100)); updateMuteUI(); }
    });

    /* --- Playlist (videy) ----------------------------------------------- */
    (function attachPlaylist(){
      if (!Array.isArray(post._streams) || post._streams.length === 0) return;
      const streams = post._streams.slice();
      const old = document.getElementById('playlistControls'); if (old) old.remove();
      const plc = document.createElement('div'); plc.id='playlistControls'; plc.className='playlist-controls'; plc.style.display='flex'; plc.style.gap='8px'; plc.style.alignItems='center'; plc.style.marginTop='8px';
      const prevBtn = document.createElement('button'); prevBtn.className='icon-btn'; prevBtn.textContent='‹ Prev';
      const idxInput = document.createElement('input'); idxInput.type='number'; idxInput.min='1'; idxInput.value='1'; idxInput.style.width='64px';
      const countSpan = document.createElement('span'); countSpan.textContent=` / ${streams.length}`;
      const nextBtn = document.createElement('button'); nextBtn.className='icon-btn'; nextBtn.textContent='Next ›';
      plc.append(prevBtn, idxInput, countSpan, nextBtn);

      // fit & quality controls (kept minimal)
      const extra = document.createElement('div'); extra.className='vp-controls-extra';
      const fitBtn = document.createElement('button'); fitBtn.className='btn'; fitBtn.textContent='Fit: contain';
      const qualityLabel = document.createElement('label');
      const qualityCheckbox = document.createElement('input'); qualityCheckbox.type='checkbox'; qualityCheckbox.style.marginRight = '6px';
      qualityLabel.appendChild(qualityCheckbox); qualityLabel.appendChild(document.createTextNode('Highest quality (HLS)'));
      extra.appendChild(fitBtn); extra.appendChild(qualityLabel);
      plc.appendChild(extra);

      const pa = document.querySelector('.post-actions') || playerWrap;
      pa.appendChild(plc);

      let cur = 0;
      let userInteracted = false;
      window._userInteracted = false;
      if (bigPlay) bigPlay.addEventListener('click', ()=> { userInteracted = true; window._userInteracted = true; });
      if (playBtn) playBtn.addEventListener('click', ()=> { userInteracted = true; window._userInteracted = true; });

      fitBtn.addEventListener('click', ()=> {
        // toggle but always prefer contain to avoid crop; user can choose cover but we will keep contain in theater/full modes
        if (player.style.objectFit === 'cover') {
          player.style.objectFit = 'contain';
          fitBtn.textContent = 'Fit: contain';
        } else {
          player.style.objectFit = 'cover';
          fitBtn.textContent = 'Fit: cover';
        }
      });

      async function playAt(i, autoplayIfInteracted=true){
        i = Math.max(0, Math.min(streams.length-1, i)); cur = i; idxInput.value = cur+1;
        const preferHQ = !!qualityCheckbox.checked;
        const result = await setupMediaForUrl(streams[cur], preferHQ);
        if (result && result.hls && preferHQ) {
          try { if (result.hls.levels && result.hls.levels.length) result.hls.currentLevel = result.hls.levels.length - 1; } catch(e){ dbg('hls setlevel fail', e); }
        }
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
          await setupMediaForUrl(streams[cur], !!qualityCheckbox.checked);
          if (userInteracted || window._userInteracted) {
            try { await player.play(); } catch(e){ dbg('auto-next blocked', e); showOverlay(); }
          } else showOverlay();
        } else { dbg('playlist ended'); showOverlay(); }
      });

      // initial load
      cur = 0; idxInput.value = cur+1;
      setupMediaForUrl(streams[cur], !!qualityCheckbox.checked).then(()=> {
        player.style.objectFit = 'contain'; // ensure default no-crop
        showOverlay();
      }).catch(e => { dbg('initial setup err', e); showOverlay(); });
    })();

    /* --- final init ---------------------------------------------------- */
    try { setPlayIcon(player.paused); } catch(e){}
    try { updateMuteUI(); if (volSlider) volSlider.value = Math.round((player.muted?0:player.volume||1)*100); } catch(e){}
    dbg('player ready for post', post.slug || post.id || post.path || post.title);
  } // init

  // run
  init().catch(err => { console.error(err); try { const el=document.getElementById('debug'); if (el) el.textContent = 'init error: '+String(err); } catch(e){} });
})();
