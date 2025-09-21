(() => {
  const POSTS_JSON = '/data/posts.json';

  /* --- Utilities -------------------------------------------------------- */
  function dbg(...args){
    console.log(...args);
    const el = document.getElementById('debug');
    if (!el) return;
    try { el.textContent = (new Date()).toLocaleTimeString() + ' — ' + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' | '); } catch(e){}
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

  /* --- Inject small CSS for download list + video styling (self-contained) --- */
  (function injectCss(){
    const css = `
    /* Download list styles injected by assets/player.js */
    .download-list { display:flex; flex-direction:column; gap:10px; margin-top:12px; }
    .download-link.item {
      display:flex;
      align-items:center;
      justify-content:space-between;
      background:#000;
      color:#fff;
      padding:14px;
      border-radius:12px;
      text-decoration:none;
      font-weight:700;
      gap:8px;
      box-shadow: 0 6px 14px rgba(0,0,0,0.12);
    }
    .download-link.item .dl-left { flex:0 0 auto; }
    .download-link.item .dl-source { color:#fff; font-weight:800; text-transform:none; }
    .download-link.item .dl-center { flex:1 1 auto; padding:0 12px; color:#fff; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .download-link.item .dl-right { flex:0 0 auto; color:#fff; opacity:0.95; font-weight:700; }
    .download-hint { color:var(--muted,#6b7280); font-size:13px; padding:8px 4px; }
    .playlist-controls { margin-top:8px; gap:8px; display:flex; align-items:center; }

    /* Video element & controls tweaks to avoid cropping and keep full resolution */
    video.vp-video {
      width: 100% !important;
      height: auto !important;
      max-height: calc(100vh - 160px) !important;
      background: #000;
      display: block;
      object-fit: contain; /* default: show whole frame */
      object-position: center;
      border-radius: 8px;
      outline: none;
      transition: all .18s ease;
    }
    /* When user prefers cover, add .vp-cover on the element and adjust */
    video.vp-video.vp-cover {
      width: 100% !important;
      height: 220px !important; /* thumbnail-like height for list pages */
      object-fit: cover !important;
    }

    /* Theater / cinema mode styles: enlarge player, center, dark background */
    .theater { max-width: 1200px; margin: 18px auto !important; padding: 18px; z-index: 9999; position: relative; }
    body.theater { background: #000; }
    .theater video.vp-video { max-height: 88vh !important; height: auto !important; object-fit: contain !important; border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }

    /* small UI for fit/quality options (non-intrusive) */
    .vp-controls-extra { display:flex; gap:8px; align-items:center; margin-top:8px; }
    .vp-controls-extra .btn { background:#111; color:#fff; padding:6px 10px; border-radius:8px; font-weight:700; cursor:pointer; border:none; }
    .vp-controls-extra label { font-size:13px; color:var(--muted,#6b7280); display:flex; align-items:center; gap:6px; }
    `;
    try {
      const s = document.createElement('style'); s.setAttribute('data-origin','assets/player.js'); s.appendChild(document.createTextNode(css));
      document.head && document.head.appendChild(s);
    } catch(e){ /* ignore */ }
  })();

  /* --- Main init ------------------------------------------------------- */
  async function init(){
    // elements (graceful fallback if some ids are missing)
    const player = document.getElementById('player');
    if (!player) { dbg('no <video id="player"> element found'); return; }
    // ensure class for styling
    player.classList.add('vp-video');

    const playerWrap = document.getElementById('playerWrap') || player.parentElement;
    const wrap = document.getElementById('videoWrap') || player.parentElement;
    const progress = document.getElementById('progress') || (function(){ const el=document.createElement('input'); el.type='range'; el.id='progress'; el.min=0; el.max=100; el.value=0; el.className='vp-progress'; if (playerWrap) playerWrap.appendChild(el); return el; })();
    const timeEl = document.getElementById('time') || (function(){ const el=document.createElement('div'); el.id='time'; el.className='vp-time'; if (playerWrap) playerWrap.appendChild(el); return el; })();
    const playBtn = document.getElementById('playPause') || (function(){ const b=document.createElement('button'); b.id='playPause'; b.className='icon-btn'; if (playerWrap) (playerWrap.querySelector('.buttons-row')||playerWrap).appendChild(b); return b; })();
    const bigPlay = document.getElementById('bigPlay') || (function(){ const b=document.createElement('button'); b.id='bigPlay'; b.className='big-play-btn'; b.textContent='Play'; (playerWrap || document.body).appendChild(b); return b; })();
    let iconPlay = document.getElementById('iconPlay');
    if (!iconPlay) {
      iconPlay = document.createElementNS('http://www.w3.org/2000/svg','svg');
      iconPlay.setAttribute('id','iconPlay'); iconPlay.setAttribute('viewBox','0 0 24 24'); iconPlay.setAttribute('width','18'); iconPlay.setAttribute('height','18');
      iconPlay.innerHTML = '<path d="M8 5v14l11-7z"/>';
      try { playBtn.appendChild(iconPlay); } catch(e){}
    }
    let iconMute = document.getElementById('iconMute');
    const muteBtn = document.getElementById('mute') || (function(){ const b=document.createElement('button'); b.id='mute'; b.className='icon-btn'; b.textContent='🔊'; if (playerWrap) (playerWrap.querySelector('.buttons-row')||playerWrap).appendChild(b); return b; })();
    if (!iconMute) {
      iconMute = document.createElement('span');
      iconMute.id = 'iconMute';
      iconMute.style.display = 'inline-block';
      iconMute.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M5 9v6h4l5 5V4L9 9H5z"/></svg>';
      try { muteBtn.textContent = ''; muteBtn.appendChild(iconMute); } catch(e){}
    }

    const fsBtn = document.getElementById('fs');
    const cinemaBtn = document.getElementById('cinema');
    const speedBtn = document.getElementById('speedBtn');
    const postTitle = document.getElementById('postTitle') || document.createElement('h2');
    const postDate = document.getElementById('postDate') || document.createElement('div');
    const postDesc = document.getElementById('postDesc') || document.createElement('p');
    const downloadArea = document.getElementById('downloadArea') || (function(){ const d=document.createElement('div'); d.id='downloadArea'; document.querySelector('.post-actions')?.appendChild(d); return d; })();

    // ensure volZone and volPop + volSlider
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
    if (postTitle) { postTitle.textContent = post.title || ''; if (!postTitle.parentElement) document.getElementById('metaBox')?.appendChild(postTitle); }
    if (postDate) { postDate.textContent = post.date || ''; if (!postDate.parentElement) document.getElementById('metaBox')?.appendChild(postDate); }
    if (postDesc) { postDesc.innerHTML = (post.description || post.excerpt || '') .toString().replace(/<img\b[^>]*>/gi,'').replace(/\n/g,'<br>'); if (!postDesc.parentElement) document.getElementById('metaBox')?.appendChild(postDesc); }
    if (post.thumb && player) try { player.poster = safeUrl(post.thumb); } catch(e){}

    /* --- renderDownloadArea: only change/format source labels here --- */
    function renderDownloadArea(){
      if (!downloadArea) return;
      downloadArea.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'download-list';

      const SOURCE_LABELS = {
        mediafire: 'Mediafire',
        terabox: 'Terabox',
        pixeldrain: 'Pixeldrain',
        bonus: 'Bonus'
      };

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
          a.innerHTML = `
            <span class="dl-left"><span class="dl-source">${sourceLabel}</span></span>
            <span class="dl-center" title="${fn || ''}"> — ${shortFn || fn || 'file'}</span>
            <span class="dl-right"> — full</span>
          `;
          if (isDirectFile(url)) try { a.setAttribute('download',''); } catch(e){}
          list.appendChild(a);
        });
      } else {
        const hint = document.createElement('div');
        hint.className = 'download-hint';
        hint.textContent = 'Tidak ada link download (hanya streaming).';
        list.appendChild(hint);
      }
      downloadArea.appendChild(list);
    }
    renderDownloadArea();

    /* --- helper: wait canplay/loadedmetadata -------------------------------- */
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

    /* --- setupMediaForUrl: set <source> and load ----------------------------- */
    async function setupMediaForUrl(u, preferHighestQuality = false){
      try { while (player.firstChild) player.removeChild(player.firstChild); } catch(e){}
      if (player._hls && typeof player._hls.destroy === 'function'){ try{ player._hls.destroy(); } catch(e){} player._hls = null; }
      // ensure player has default styling class
      player.classList.add('vp-video');
      player.classList.remove('vp-cover'); // default: contain

      if (!u){
        const s = document.createElement('source'); s.src = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'; s.type = 'video/mp4'; player.appendChild(s); try{ player.load(); } catch(e){}
        return { hls: null };
      }
      try { player.removeAttribute && player.removeAttribute('crossorigin'); } catch(e){}
      const src = safeUrl(u);
      if (!src) return { hls: null };

      // if HLS
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
            const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 30 });
            // manifest parse handler to optionally pick highest level
            hls.on(Hls.Events.MANIFEST_PARSED, function(event, data){
              dbg('HLS manifest parsed', data);
              try {
                if (preferHighestQuality && Array.isArray(hls.levels) && hls.levels.length) {
                  const highest = hls.levels.length - 1;
                  hls.currentLevel = highest; // jump to highest
                  dbg('HLS: set currentLevel to highest', highest);
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
        // normal MP4/WebM
        const s = document.createElement('source'); s.src = src; s.type = src.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/unknown'; player.appendChild(s);
        try{ player.load(); } catch(e){}
        dbg('mp4 set to source', src);
        return { hls: null };
      }
    }

    /* --- UI helpers -------------------------------------------------------- */
    function setPlayIcon(paused){
      if (!iconPlay) return;
      try {
        iconPlay.innerHTML = paused ? '<path d="M8 5v14l11-7z" fill="currentColor"/>' : '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>';
      } catch(e){
        try { iconPlay.textContent = paused ? '▶' : '⏸'; } catch(e){}
      }
    }
    function updateMuteUI(){
      if (!iconMute || !player) return;
      try {
        if (player.muted || player.volume === 0) iconMute.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-.77-3.36-1.99-4.44L13 9.07A3.01 3.01 0 0 1 15 12a3 3 0 0 1-2 2.83V17l4 2V7.17L16.5 8.56A6.98 6.98 0 0 1 18 12z" fill="currentColor"/></svg>';
        else iconMute.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M5 9v6h4l5 5V4L9 9H5z" fill="currentColor"/></svg>';
      } catch(e){
        try { iconMute.textContent = (player.muted||player.volume===0) ? '🔈' : '🔊'; } catch(e){}
      }
    }
    function showOverlay(){ const overlay = document.getElementById('overlay'); if (overlay) { overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); } }
    function hideOverlay(){ const overlay = document.getElementById('overlay'); if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); } }

    /* --- Cinema / Theater mode helpers ------------------------------------ */
    function enterCinemaMode(){
      try {
        if (playerWrap) playerWrap.classList.add('theater');
        document.body.classList.add('theater');
        // ensure full-frame view (no crop)
        player.dataset.vpfit = 'contain';
        player.classList.remove('vp-cover');
        player.style.objectFit = 'contain';
        dbg('entered cinema mode');
      } catch(e){ dbg('enterCinemaMode err', e); }
    }
    function exitCinemaMode(){
      try {
        if (playerWrap) playerWrap.classList.remove('theater');
        document.body.classList.remove('theater');
        // restore default (contain)
        player.dataset.vpfit = 'contain';
        player.classList.remove('vp-cover');
        player.style.objectFit = 'contain';
        dbg('exited cinema mode');
      } catch(e){ dbg('exitCinemaMode err', e); }
    }

    /* --- robust play attempt ----------------------------------------------- */
    async function attemptPlayWithFallback(){
      const currentSrc = player.currentSrc || '';
      dbg('attemptPlayWithFallback currentSrc=' + currentSrc);
      try {
        await player.play();
        setPlayIcon(false); hideOverlay();
        dbg('play started');
        // ensure cinema mode on successful play
        enterCinemaMode();
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
          // ensure cinema mode on successful muted play too
          enterCinemaMode();
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
              'Check server: must return raw video (200/206) with Content-Type: video/mp4 and not an HTML redirect or attachment.'
            ].join(' | ');
          }
          return { ok:false, error: e2 };
        }
      }
    }

    /* --- wire controls ---------------------------------------------------- */
    if (playBtn) playBtn.addEventListener('click', async ()=> {
      // enter cinema mode immediately on user click
      enterCinemaMode();
      if (player.paused) await attemptPlayWithFallback(); else player.pause();
    });
    if (bigPlay) bigPlay.addEventListener('click', async ()=> {
      // if no source loaded, load first stream
      if ((!player.currentSrc || player.currentSrc === '') && Array.isArray(post._streams) && post._streams.length) {
        await setupMediaForUrl(post._streams[0]);
      }
      // mark user interaction
      window._userInteracted = true;
      // enter cinema mode immediately on bigPlay
      enterCinemaMode();
      await attemptPlayWithFallback();
    });

    if (player){
      player.addEventListener('click', async ()=> {
        // clicking the player toggles play/pause. If playing, stay; if starting, enter cinema
        if (player.paused) {
          enterCinemaMode();
          await attemptPlayWithFallback();
        } else {
          player.pause();
        }
      });
      player.addEventListener('play', ()=> { setPlayIcon(false); hideOverlay(); enterCinemaMode(); });
      player.addEventListener('pause', ()=> { setPlayIcon(true); showOverlay(); /* keep cinema mode until user toggles off */ });
      player.addEventListener('loadedmetadata', ()=> {
        // when metadata available, choose fit to avoid crop (contain)
        try {
          player.style.objectFit = 'contain';
          if (player.dataset.vpfit === 'cover') {
            player.classList.add('vp-cover');
            player.style.objectFit = 'cover';
          } else {
            player.classList.remove('vp-cover');
          }
        } catch(e){}
        if (timeEl) timeEl.textContent = `${formatTime(0)} / ${formatTime(player.duration)}`;
      });
      player.addEventListener('timeupdate', ()=> {
        const pct = (player.currentTime / Math.max(1, player.duration)) * 100;
        try{ if (!Number.isNaN(pct) && progress) progress.value = pct; } catch(e){}
        if (timeEl) timeEl.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
      });
      player.addEventListener('error', (e) => { dbg('media element error event', e, player.error && player.error.code); });
    }

    /* --- progress / seek -------------------------------------------------- */
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

    /* --- volume UI -------------------------------------------------------- */
    let prevVolume = typeof player.volume === 'number' ? player.volume : 1;
    if (muteBtn) muteBtn.addEventListener('click', (ev)=> {
      if (player.muted || player.volume === 0){ player.muted = false; player.volume = prevVolume || 1; } else { prevVolume = player.volume; player.muted = true; }
      updateMuteUI(); showVolumeIndicator(Math.round((player.muted?0:player.volume)*100));
      const rect = muteBtn.getBoundingClientRect(); volPop.style.display='block'; volPop.style.left = (rect.right - 140) + 'px'; volPop.style.top = (rect.top - 56) + 'px';
      if (window._volPopTimeout) clearTimeout(window._volPopTimeout); window._volPopTimeout = setTimeout(()=> { volPop.style.display='none'; }, 4000);
    });
    if (volSlider) volSlider.addEventListener('input', (e)=> { const v = Number(e.target.value)/100; player.volume = v; player.muted = v === 0; updateMuteUI(); showVolumeIndicator(Math.round(v*100)); });

    function showVolumeIndicator(perc){ if (!volumeIndicator) return; volumeIndicator.style.display='inline-flex'; volumeIndicator.textContent = `Volume ${perc}%`; if (window._volTimeout) clearTimeout(window._volTimeout); window._volTimeout = setTimeout(()=> volumeIndicator.style.display = 'none', 900); }

    document.addEventListener('click', (ev)=> { if (!volPop) return; if (volPop.contains(ev.target) || (muteBtn && muteBtn.contains(ev.target))) return; volPop.style.display='none'; });

    (function enableVerticalVolume(){
      let active=false, startY=0, startVolume=1, pointerId=null; const zone = volZone; if (!zone) return;
      zone.addEventListener('pointerdown', ev => { ev.preventDefault(); active=true; pointerId=ev.pointerId; startY=ev.clientY; startVolume = player.muted ? (prevVolume||1) : (player.volume||1); player.muted = false; try{ zone.setPointerCapture(pointerId); }catch(e){} showVolumeIndicator(Math.round(startVolume*100)); });
      zone.addEventListener('pointermove', ev => { if (!active) return; const dy = startY - ev.clientY; const delta = dy/160; let newVol = Math.max(0, Math.min(1, startVolume + delta)); player.volume = newVol; player.muted = newVol === 0; updateMuteUI(); showVolumeIndicator(Math.round(newVol*100)); if (volSlider) volSlider.value = Math.round(newVol*100); });
      function endGesture(ev){ if (!active) return; active=false; try{ zone.releasePointerCapture(ev.pointerId||pointerId); }catch(e){} pointerId=null; }
      zone.addEventListener('pointerup', endGesture); zone.addEventListener('pointercancel', endGesture); zone.addEventListener('lostpointercapture', ()=>{ active=false; });
    })();

    /* --- prevent context & drag ------------------------------------------- */
    try { wrap.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('dragstart', ev => ev.preventDefault()); } catch(e){}

    /* --- fs / cinema / speed ---------------------------------------------- */
    if (fsBtn) fsBtn.addEventListener('click', async ()=> { try { if (document.fullscreenElement) await document.exitFullscreen(); else await playerWrap.requestFullscreen(); } catch(e){ dbg('fs err', e); } });
    if (cinemaBtn) cinemaBtn.addEventListener('click', ()=> {
      // toggle cinema manually
      const is = playerWrap.classList.toggle('theater');
      document.body.classList.toggle('theater', is);
      if (is) {
        player.dataset.vpfit = 'contain';
        player.style.objectFit = 'contain';
      } else {
        player.dataset.vpfit = 'contain';
        player.style.objectFit = 'contain';
      }
    });
    const speeds = [1,1.25,1.5,2]; let speedIndex=0; if (speedBtn) speedBtn.addEventListener('click', ()=> { speedIndex=(speedIndex+1)%speeds.length; if (player) player.playbackRate = speeds[speedIndex]; speedBtn.textContent = speeds[speedIndex]+'×'; });

    /* --- keyboard shortcuts ------------------------------------------------ */
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

    /* --- Playlist (videy streams only) ------------------------------------ */
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

      // append extra controls (fit toggle + quality checkbox)
      const extra = document.createElement('div'); extra.className = 'vp-controls-extra';
      const fitBtn = document.createElement('button'); fitBtn.className='btn'; fitBtn.textContent = 'Fit: contain'; fitBtn.title = 'Toggle video fit (contain / cover)';
      const qualityLabel = document.createElement('label');
      const qualityCheckbox = document.createElement('input'); qualityCheckbox.type = 'checkbox'; qualityCheckbox.style.margin = '0';
      qualityLabel.appendChild(qualityCheckbox);
      qualityLabel.appendChild(document.createTextNode('Highest quality (HLS)'));
      extra.appendChild(fitBtn); extra.appendChild(qualityLabel);

      plc.appendChild(extra);
      const pa = document.querySelector('.post-actions') || document.body;
      pa.appendChild(plc);

      let cur = 0;
      let userInteracted = false;
      window._userInteracted = false;
      if (bigPlay) bigPlay.addEventListener('click', ()=> { userInteracted = true; window._userInteracted = true; });
      if (playBtn) playBtn.addEventListener('click', ()=> { userInteracted = true; window._userInteracted = true; });

      // fit toggle logic
      fitBtn.addEventListener('click', () => {
        const current = player.dataset.vpfit === 'cover' ? 'cover' : 'contain';
        const next = current === 'cover' ? 'contain' : 'cover';
        player.dataset.vpfit = next;
        if (next === 'cover') {
          player.classList.add('vp-cover');
          player.style.objectFit = 'cover';
          fitBtn.textContent = 'Fit: cover';
        } else {
          player.classList.remove('vp-cover');
          player.style.objectFit = 'contain';
          fitBtn.textContent = 'Fit: contain';
        }
      });

      async function playAt(i, autoplayIfInteracted=true){
        i = Math.max(0, Math.min(streams.length-1, i));
        cur = i; idxInput.value = cur+1;
        // pass quality preference
        const preferHQ = !!qualityCheckbox.checked;
        const result = await setupMediaForUrl(streams[cur], preferHQ);
        // if HLS instance returned and preferHQ=true, we set highest level if manifest already parsed
        if (result && result.hls && preferHQ) {
          try {
            const hls = result.hls;
            if (hls.levels && hls.levels.length) {
              hls.currentLevel = hls.levels.length - 1;
              dbg('Set HLS to highest after setup', hls.levels.length - 1);
            }
          } catch(e){ dbg('set HQ fail', e); }
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

      // initial load (do not autoplay)
      cur = 0; idxInput.value = cur+1;
      setupMediaForUrl(streams[cur], !!qualityCheckbox.checked).then(()=> {
        try { player.style.objectFit = 'contain'; player.dataset.vpfit = 'contain'; fitBtn.textContent = 'Fit: contain'; } catch(e){}
        showOverlay();
      }).catch(e => { dbg('initial setup err', e); showOverlay(); });
    })();

    /* --- final UI init ---------------------------------------------------- */
    try { setPlayIcon(player.paused); } catch(e){}
    try { updateMuteUI(); if (volSlider) volSlider.value = Math.round((player.muted?0:player.volume||1)*100); } catch(e){}
    dbg('player ready for post', post.slug || post.id || post.path || post.title);
  } // init

  // run
  init().catch(err => { console.error(err); try { const el=document.getElementById('debug'); if (el) el.textContent = 'init error: '+String(err); } catch(e){} });
})();
