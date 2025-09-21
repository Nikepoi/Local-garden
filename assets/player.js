// assets/player.js
// Updated: downloads placed under #downloadArea, no "open stream in tab" debug button,
// videy streams excluded from download list, robust play + muted fallback, debug message only.

(() => {
  const POSTS_JSON_CANDIDATES = ['/data/posts.json','/posts.json','/posts.json?nocache=1'];

  function dbg(...args){
    console.log(...args);
    const el = document.getElementById('debug');
    try { if (el) el.textContent = (new Date()).toLocaleTimeString() + ' — ' + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' | '); } catch(e){}
  }
  function safeEncodeUrl(u){ return u ? String(u).split(' ').join('%20') : u; }
  function formatTime(s){ if (!isFinite(s)) return '00:00'; const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60); if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }
  function humanFileSize(bytes) { if (!isFinite(bytes)) return 'unknown'; const thresh = 1024; if (Math.abs(bytes) < thresh) return bytes + ' B'; const units = ['KB','MB','GB','TB']; let u = -1; do { bytes /= thresh; ++u; } while(Math.abs(bytes) >= thresh && u < units.length-1); return bytes.toFixed(1) + ' ' + units[u]; }
  async function tryLoadJsonCandidates(cands){
    for (const c of cands) {
      try {
        const r = await fetch(c, {cache: 'no-store'});
        if (!r.ok) { dbg('posts.json load fail', c, r.status); continue; }
        const json = await r.json();
        dbg('posts.json loaded from', c);
        return { data: json, path: c };
      } catch(e){
        dbg('posts.json fetch error', c, String(e));
      }
    }
    throw new Error('No posts.json candidate could be loaded');
  }

  function buildLinks(linksObj){
    const out = { streams: [], downloads: [] };
    if (!linksObj || typeof linksObj !== 'object') return out;
    const order = ['videy','mediafire','terabox','pixeldrain','bonus'];
    order.forEach(k=>{
      const arr = Array.isArray(linksObj[k]) ? linksObj[k] : [];
      arr.forEach(u=>{
        if (!u || typeof u !== 'string') return;
        const url = u.trim();
        if (!url) return;
        if (k === 'videy') out.streams.push(url);
        else out.downloads.push({ url, source: k });
      });
    });
    return out;
  }
  function isPlayableURL(u){ return /\.(mp4|m3u8|webm|ogg)(\?.*)?$/i.test(String(u||'')); }
  function isDirectFile(u){ return /\.(zip|rar|7z|mp4|webm|ogg)(\?.*)?$/i.test(String(u||'')); }

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

  async function fetchHeadInfo(url){
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) throw new Error('HEAD status ' + res.status);
      const len = res.headers.get('content-length');
      const type = res.headers.get('content-type');
      return { length: len ? Number(len) : null, type: type || null, ok: true };
    } catch(e){ return { ok:false, error: String(e) }; }
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
    const downloadArea = document.getElementById('downloadArea');

    // ensure volZone
    let volZone = document.getElementById('volZone');
    if (!volZone && wrap) { volZone = document.createElement('div'); volZone.id = 'volZone'; volZone.className = 'vol-zone'; wrap.appendChild(volZone); }

    // vol pop
    let volPop = document.getElementById('volPop');
    if (!volPop) { volPop = document.createElement('div'); volPop.id='volPop'; volPop.className='vol-pop'; volPop.innerHTML='<input id="volSlider" type="range" min="0" max="100" step="1" value="100" aria-label="Volume">'; document.body.appendChild(volPop); }
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
    let posts = null;
    try {
      const r = await tryLoadJsonCandidates(POSTS_JSON_CANDIDATES);
      posts = Array.isArray(r.data) ? r.data : (r.data && Array.isArray(r.data.posts) ? r.data.posts : null);
      if (!posts || !posts.length) throw new Error('posts.json contains no posts array');
    } catch(e){
      dbg('posts.json load failed', String(e));
      const el = document.getElementById('debug'); if (el) el.textContent = 'posts.json load failed: ' + String(e);
      return;
    }

    // find post
    let post = null;
    if (slugUsed) {
      post = posts.find(p=>{
        if (!p) return false;
        const pslug = (p.slug||'').toString(), pid = (p.id||'').toString(), ppath = (p.path||'').toString();
        const filename = (ppath.split('/').pop()||'').replace('.html','');
        return pslug === slugUsed || pid === slugUsed || filename === slugUsed || (p.url && p.url.endsWith('/' + slugUsed + '.html'));
      });
    }
    if (!post && posts.length === 1) post = posts[0];
    if (!post && rawName) post = posts.find(p => (p.title||'').toLowerCase().includes(rawName.toLowerCase()));

    if (!post) {
      const sample = posts.slice(0,6).map(x => x.slug||x.id||x.path||x.title).join(', ');
      const el = document.getElementById('debug'); if (el) el.textContent = 'No matching post for slug "'+slugUsed+'". Available: '+sample;
      dbg('no post match', slugUsed);
      return;
    }

    // streams & downloads
    const { streams, downloads } = buildLinks(post.links || {});
    post._streams = streams.filter(s => isPlayableURL(s));
    post._downloadLinks = downloads; // only non-videy here per buildLinks

    // render meta & poster
    if (postTitle) postTitle.textContent = post.title || '';
    if (postDate) postDate.textContent = post.date || '';
    if (postDesc) postDesc.innerHTML = (post.description || post.excerpt || '') .toString().replace(/<img\b[^>]*>/gi,'').replace(/\n/g,'<br>');
    if (post.thumb && player) try { player.poster = safeEncodeUrl(post.thumb); } catch(e){}

    // render download buttons (placed in #downloadArea) - label: "<source> — full"
    async function renderDownloads(){
      if (!downloadArea) return;
      downloadArea.innerHTML = '';
      if (Array.isArray(post._downloadLinks) && post._downloadLinks.length){
        for (const it of post._downloadLinks){
          const btn = document.createElement('a');
          btn.className='download-link';
          btn.href = it.url;
          btn.target = '_blank';
          btn.rel = 'noopener noreferrer';
          btn.style.display='inline-flex';
          btn.style.alignItems='center';
          btn.style.justifyContent='center';
          btn.style.padding='10px 14px';
          btn.style.borderRadius='12px';
          btn.style.background='#000';
          btn.style.color='#fff';
          btn.style.fontWeight='700';
          btn.style.textDecoration='none';
          btn.textContent = (it.source || 'link') + ' — full';
          // only set download attr for direct file types (rare for MF/Terabox)
          if (isDirectFile(it.url)) try { btn.setAttribute('download',''); } catch(e){}
          // append and try HEAD to add size if allowed
          downloadArea.appendChild(btn);
          (async ()=>{
            const info = await fetchHeadInfo(it.url);
            if (info && info.ok && info.length) {
              btn.textContent = (it.source || 'link') + ' — full (' + humanFileSize(info.length) + ')';
            }
          })();
        }
      } else {
        // no downloads — keep area empty or show small hint
        const hint = document.createElement('div');
        hint.style.color = 'var(--muted, #6b7280)';
        hint.style.fontSize = '13px';
        hint.textContent = 'Tidak ada link download (hanya streaming).';
        downloadArea.appendChild(hint);
      }
    }
    await renderDownloads();

    // setupMediaForUrl
    async function setupMediaForUrl(u){
      while (player.firstChild) player.removeChild(player.firstChild);
      if (player._hls && typeof player._hls.destroy === 'function'){ try{ player._hls.destroy(); } catch(e){} player._hls = null; }
      if (!u) {
        const s = document.createElement('source'); s.src='https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'; s.type='video/mp4'; player.appendChild(s); try{ player.load(); } catch(e){}
        return;
      }
      const src = safeEncodeUrl(u);
      if (src.toLowerCase().endsWith('.m3u8')) {
        try {
          if (!window.Hls) {
            await new Promise((resolve,reject)=>{
              const s = document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/hls.js@1.5.0/dist/hls.min.js'; s.onload=()=>resolve(); s.onerror=()=>reject(new Error('hls load fail')); document.head.appendChild(s);
            });
          }
          if (window.Hls && Hls.isSupported()) {
            const hls = new Hls({capLevelToPlayerSize:true});
            hls.loadSource(src); hls.attachMedia(player); player._hls = hls; dbg('HLS attached', src);
          } else {
            const s = document.createElement('source'); s.src=src; s.type='application/vnd.apple.mpegurl'; player.appendChild(s); try{ player.load(); }catch(e){} try{ player.src = src; player.load(); }catch(e){}
          }
        } catch(err){ dbg('hls error', err); const s = document.createElement('source'); s.src=src; s.type='application/vnd.apple.mpegurl'; player.appendChild(s); try{ player.load(); }catch(e){} try{ player.src = src; player.load(); }catch(e){} }
      } else {
        const s = document.createElement('source'); s.src = src; s.type = src.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/unknown'; player.appendChild(s);
        try{ player.load(); } catch(e){}
        try { player.src = src; player.load(); } catch(e){}
        dbg('mp4 loaded', src);
      }
      await waitForCanPlay(player, 4000);
    }

    function setPlayIcon(paused){ if (!iconPlay) return; if (paused) iconPlay.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"/>'; else iconPlay.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>'; }
    function showOverlay(){ if (overlay) { overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); } }
    function hideOverlay(){ if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); } }

    // play fallback (NO open-in-tab)
    async function attemptPlayWithFallback(streamUrl){
      try {
        await player.play();
        setPlayIcon(false); hideOverlay();
        return { ok:true };
      } catch(e1){
        dbg('play() rejected, trying muted play', e1);
        const wasMuted = player.muted;
        try {
          player.muted = true;
          await player.play();
          setPlayIcon(false); hideOverlay();
          player.muted = wasMuted;
          return { ok:true, mutedFallback:true };
        } catch(e2){
          dbg('muted play also rejected', e2);
          player.muted = wasMuted;
          // show in-page debug message (no open-in-tab)
          const debugEl = document.getElementById('debug');
          if (debugEl) {
            debugEl.textContent = (new Date()).toLocaleTimeString() + ' — Playback blocked. Kemungkinan: CORS/hotlink/redirect. Untuk perbaikan: gunakan direct raw .mp4 yang mengembalikan 200/206 & Access-Control-Allow-Origin: * atau gunakan server-side proxy.';
          }
          return { ok:false, error: e2 };
        }
      }
    }

    // controls hookup
    if (playBtn) playBtn.addEventListener('click', ()=> { if (player.paused) attemptPlayWithFallback(player.currentSrc || (post._streams && post._streams[0])); else player.pause(); });
    if (bigPlay) bigPlay.addEventListener('click', async ()=> {
      if ((!player.currentSrc || player.currentSrc === '') && Array.isArray(post._streams) && post._streams.length) {
        await setupMediaForUrl(post._streams[0]);
      }
      window._userInteracted = true;
      await attemptPlayWithFallback(player.currentSrc || (post._streams && post._streams[0]));
    });
    if (player) {
      player.addEventListener('click', ()=> { if (player.paused) attemptPlayWithFallback(player.currentSrc); else player.pause(); });
      player.addEventListener('play', ()=> { setPlayIcon(false); hideOverlay(); });
      player.addEventListener('pause', ()=> { setPlayIcon(true); showOverlay(); });
      player.addEventListener('loadedmetadata', ()=> { if (timeEl) timeEl.textContent = `${formatTime(0)} / ${formatTime(player.duration)}`; });
      player.addEventListener('timeupdate', ()=> {
        const pct = (player.currentTime / Math.max(1, player.duration)) * 100;
        try{ if (!Number.isNaN(pct) && progress) progress.value = pct; } catch(e){}
        if (timeEl) timeEl.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
      });
      player.addEventListener('error', (e) => { dbg('media element error', e, player.error && player.error.code); });
    }

    // volume & other UI (same)
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

    document.addEventListener('click', (ev)=> { if (!volPop) return; if (volPop.contains(ev.target) || (muteBtn && muteBtn.contains(ev.target))) return; volPop.style.display = 'none'; });

    (function enableVerticalVolume(){
      let active=false, startY=0, startVolume=1, pointerId=null; const zone = volZone; if (!zone) return;
      zone.addEventListener('pointerdown', ev => { ev.preventDefault(); active=true; pointerId=ev.pointerId; startY=ev.clientY; startVolume = player.muted ? (prevVolume||1) : (player.volume||1); player.muted = false; try{ zone.setPointerCapture(pointerId); }catch(e){} showVolumeIndicator(Math.round(startVolume*100)); });
      zone.addEventListener('pointermove', ev => { if (!active) return; const dy = startY - ev.clientY; const delta = dy/160; let newVol = Math.max(0, Math.min(1, startVolume + delta)); player.volume = newVol; player.muted = newVol === 0; showVolumeIndicator(Math.round(newVol*100)); if (volSlider) volSlider.value = Math.round(newVol*100); });
      function endGesture(ev){ if (!active) return; active=false; try{ zone.releasePointerCapture(ev.pointerId||pointerId); }catch(e){} pointerId=null; }
      zone.addEventListener('pointerup', endGesture); zone.addEventListener('pointercancel', endGesture); zone.addEventListener('lostpointercapture', ()=>{ active=false; });
    })();

    if (fsBtn) fsBtn.addEventListener('click', async ()=> { try
