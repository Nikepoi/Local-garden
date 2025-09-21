// assets/player.js
// FULL — reinstated download links (non-videy) + playlist (videy streams only)
// User-gesture required to start playback (click bigPlay)
// Replace existing /assets/player.js with this file

(() => {
  const POSTS_JSON = '/data/posts.json';

  // helpers
  function dbg(...args){
    console.log(...args);
    const el = document.getElementById('debug');
    try { if (el) el.textContent = (new Date()).toLocaleTimeString() + ' — ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' | '); } catch(e){}
  }
  function safeEncodeUrl(u){ if (!u) return u; return String(u).split(' ').join('%20'); }
  function formatTime(s){ if (!isFinite(s)) return '00:00'; const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60); if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }
  async function loadJSON(url){ const res = await fetch(url, {cache:'no-store'}); if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); }

  // build arrays from links object
  function buildLinks(linksObj){
    if (!linksObj || typeof linksObj !== 'object') return { streams: [], downloads: [] };
    const order = ['videy','mediafire','terabox','pixeldrain','bonus'];
    const streams = []; // playable urls (mp4/m3u8)
    const downloads = []; // non-videy hosts / links to show as downloads
    order.forEach(k=>{
      const arr = Array.isArray(linksObj[k]) ? linksObj[k] : [];
      arr.forEach(u=>{
        if (typeof u !== 'string') return;
        const url = u.trim();
        if (!url) return;
        if (k === 'videy') {
          streams.push(url);
        } else {
          downloads.push({ url, source: k });
        }
      });
    });
    return { streams, downloads };
  }

  function isPlayableURL(u){ return /\.(mp4|m3u8|webm|ogg)(\?.*)?$/i.test(String(u||'')); }
  function isDirectFile(u){ return /\.(zip|rar|7z|mp4|webm|ogg)(\?.*)?$/i.test(String(u||'')); }

  // wait for canplay/loadedmetadata
  function waitForCanPlay(el, timeout = 3000){
    return new Promise((resolve) => {
      let done = false;
      function cleanup(){
        el.removeEventListener('loadedmetadata', onOk);
        el.removeEventListener('canplay', onOk);
        clearTimeout(timer);
      }
      function onOk(){ if (done) return; done = true; cleanup(); resolve(true); }
      const timer = setTimeout(()=>{ if (done) return; done = true; cleanup(); resolve(false); }, timeout);
      el.addEventListener('loadedmetadata', onOk);
      el.addEventListener('canplay', onOk);
    });
  }

  async function init(){
    // DOM refs
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

    // make sure volZone exists
    let volZone = document.getElementById('volZone');
    if (!volZone) {
      volZone = document.createElement('div');
      volZone.id = 'volZone';
      volZone.className = 'vol-zone';
      if (wrap) wrap.appendChild(volZone);
    }

    // vol pop
    let volPop = document.getElementById('volPop');
    if (!volPop) {
      volPop = document.createElement('div');
      volPop.id = 'volPop';
      volPop.className = 'vol-pop';
      volPop.innerHTML = '<input id="volSlider" type="range" min="0" max="100" step="1" value="100" aria-label="Volume">';
      document.body.appendChild(volPop);
    }
    const volSlider = document.getElementById('volSlider');

    // small indicator
    const volumeIndicator = document.getElementById('volumeIndicator') || (function(){
      const el = document.createElement('div'); el.id='volumeIndicator'; el.className='volume-indicator'; el.setAttribute('role','status'); el.setAttribute('aria-live','polite'); el.style.display='none';
      document.body.appendChild(el); return el;
    })();

    // detect slug
    const metaSlugEl = document.querySelector('meta[name="slug"]');
    const rawName = (location.pathname.split('/').pop() || '').replace('.html','');
    const slug = metaSlugEl && metaSlugEl.content ? metaSlugEl.content : decodeURIComponent(rawName || '');

    // load posts.json
    let post = null;
    try {
      dbg('Fetching', POSTS_JSON);
      const postsData = await loadJSON(POSTS_JSON);
      dbg('posts loaded', Array.isArray(postsData) ? `${postsData.length} items` : typeof postsData);
      let posts = postsData;
      if (postsData && postsData.posts && Array.isArray(postsData.posts)) posts = postsData.posts;
      if (Array.isArray(posts)) {
        post = posts.find(p=>{
          if(!p) return false;
          const pslug = (p.slug||'').toString(), pid = (p.id||'').toString(), ppath = (p.path||'').toString();
          const filename = (ppath.split('/').pop()||'').replace('.html','');
          return pslug === slug || pid === slug || filename === slug || ppath.endsWith('/' + slug + '.html');
        });
        if (!post && posts.length === 1) post = posts[0];
      }
    } catch(err){
      dbg('posts.json error', String(err));
    }

    // prepare streams and downloads from post.links
    if (post) {
      const { streams, downloads } = buildLinks(post.links || {});
      post._streams = streams.filter(u => isPlayableURL(u)); // ensure playable
      post._downloadLinks = downloads; // keep non-videy links
      if (!post.stream && post._streams && post._streams.length) post.stream = post._streams[0];
    }

    // render meta
    function renderPost(p){
      if (!p) {
        if (postTitle) postTitle.textContent = 'Posting tidak ditemukan';
        if (postDate) postDate.textContent = '';
        if (postDesc) postDesc.innerHTML = 'Tidak ada entri yang cocok.';
        dbg('No matching post', slug);
        return;
      }
      if (postTitle) postTitle.textContent = p.title || 'No title';
      if (postDate) postDate.textContent = p.date || '';
      if (postDesc) postDesc.innerHTML = (p.description || '').toString().replace(/<img\b[^>]*>/gi,'').replace(/\n/g,'<br>');
      if (p.thumb && player) try { player.poster = safeEncodeUrl(p.thumb); } catch(e){}
    }

    // render download links (non-videy). Keep them visible and clickable.
    function renderDownloadLinks(p){
      // find or create container inside .post-actions
      const pa = document.querySelector('.post-actions');
      if (!pa) return;
      // remove old download area if exists
      const old = document.getElementById('downloadLinksList');
      if (old) old.remove();

      const container = document.createElement('div');
      container.id = 'downloadLinksList';
      container.style.display = 'flex';
      container.style.gap = '8px';
      container.style.flexWrap = 'wrap';
      container.style.alignItems = 'center';
      container.style.marginRight = '8px';

      if (!p || !Array.isArray(p._downloadLinks) || p._downloadLinks.length === 0) {
        // nothing to show
        pa.insertBefore(container, pa.firstChild);
        return;
      }

      p._downloadLinks.forEach((item, idx) => {
        const a = document.createElement('a');
        a.className = 'download-link';
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.display = 'inline-flex';
        a.style.alignItems = 'center';
        a.style.gap = '8px';
        a.style.padding = '10px 14px';
        a.style.borderRadius = '12px';
        a.style.background = '#000';
        a.style.color = '#fff';
        a.style.fontWeight = '700';
        a.style.textDecoration = 'none';
        a.textContent = (item.source || 'link').replace(/^\w/, c => c.toUpperCase()) + ((p._downloadLinks.length > 1) ? ` ${idx+1}` : '');
        // set download attribute only for direct file types (zip/mp4/etc)
        if (isDirectFile(item.url)) {
          try { a.setAttribute('download', ''); } catch(e){}
        }
        container.appendChild(a);
      });

      // insert before existing controls (so download links appear left of playlist controls)
      pa.insertBefore(container, pa.firstChild);
    }

    // load a stream into player (string url). No download exposure here.
    async function setupMedia(streamUrl){
      // clear
      while (player.firstChild) player.removeChild(player.firstChild);
      if (player._hls && typeof player._hls.destroy === 'function'){ try{ player._hls.destroy(); }catch(e){} player._hls = null; }
      if (!streamUrl) {
        const s = document.createElement('source'); s.src = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'; s.type='video/mp4'; player.appendChild(s); try{ player.load(); }catch(e){} return;
      }
      const stream = safeEncodeUrl(streamUrl);
      if (stream.toLowerCase().endsWith('.m3u8')) {
        try {
          if (!window.Hls) {
            await new Promise((resolve,reject)=>{
              const s = document.createElement('script');
              s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.0/dist/hls.min.js';
              s.onload = ()=> resolve();
              s.onerror = ()=> reject(new Error('hls.js fail'));
              document.head.appendChild(s);
            });
          }
          if (window.Hls && Hls.isSupported()) {
            const hls = new Hls({capLevelToPlayerSize:true});
            hls.loadSource(stream);
            hls.attachMedia(player);
            player._hls = hls;
            dbg('HLS attached', stream);
          } else {
            const s = document.createElement('source'); s.src = stream; s.type = 'application/vnd.apple.mpegurl'; player.appendChild(s); try{ player.load(); }catch(e){} dbg('native hls used');
          }
        } catch(e){
          dbg('hls error', e);
          const s = document.createElement('source'); s.src = stream; s.type = 'application/vnd.apple.mpegurl'; player.appendChild(s); try{ player.load(); }catch(e){}
        }
      } else {
        const s = document.createElement('source'); s.src = stream; s.type = stream.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/unknown'; player.appendChild(s);
        try{ player.load(); }catch(e){}
        dbg('mp4 loaded', stream);
      }
      // wait for metadata/canplay briefly
      await waitForCanPlay(player, 3000);
    }

    // UI helpers
    function setPlayIcon(paused){ if (!iconPlay) return; if (paused) iconPlay.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"/>'; else iconPlay.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>'; }
    function showOverlay(){ if (overlay) { overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); } }
    function hideOverlay(){ if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); } }

    // safe play with user gesture (bigPlay)
    async function tryPlayUserGesture(){
      try {
        await player.play();
        setPlayIcon(false); hideOverlay();
      } catch(err){
        dbg('play() rejected after user gesture', err);
        showOverlay();
      }
    }

    // attach simple controls
    if (playBtn) playBtn.addEventListener('click', ()=> { if (player.paused) tryPlayUserGesture(); else player.pause(); });
    if (player) player.addEventListener('click', ()=> { if (player.paused) tryPlayUserGesture(); else player.pause(); });
    if (player) {
      player.addEventListener('play', ()=> { setPlayIcon(false); hideOverlay(); });
      player.addEventListener('pause', ()=> { setPlayIcon(true); showOverlay(); });
      player.addEventListener('loadedmetadata', ()=> { if (timeEl) timeEl.textContent = `${formatTime(0)} / ${formatTime(player.duration)}`; });
      player.addEventListener('timeupdate', ()=> {
        const pct = (player.currentTime / Math.max(1, player.duration)) * 100;
        if (!Number.isNaN(pct) && progress) progress.value = pct;
        if (timeEl) timeEl.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
      });
    }

    // volume UI (same)
    let prevVolume = typeof player.volume === 'number' ? player.volume : 1;
    function updateMuteUI(){ if (!iconMute || !player) return; if (player.muted || player.volume === 0) iconMute.innerHTML = '<path d="M16.5 12c0-1.77-.77-3.36-1.99-4.44L13 9.07A3.01 3.01 0 0 1 15 12a3 3 0 0 1-2 2.83V17l4 2V7.17L16.5 8.56A6.98 6.98 0 0 1 18 12z" fill="currentColor"/>'; else iconMute.innerHTML = '<path d="M5 9v6h4l5 5V4L9 9H5z" fill="currentColor"/>'; }
    function showVolumeIndicator(perc){ if (!volumeIndicator) return; volumeIndicator.style.display='inline-flex'; volumeIndicator.textContent = `Volume ${perc}%`; if (window._volTimeout) clearTimeout(window._volTimeout); window._volTimeout = setTimeout(()=> volumeIndicator.style.display = 'none', 900); }

    if (muteBtn) muteBtn.addEventListener('click', (ev)=> {
      if (player.muted || player.volume === 0){ player.muted = false; player.volume = prevVolume || 1; }
      else { prevVolume = player.volume; player.muted = true; }
      updateMuteUI(); showVolumeIndicator(Math.round((player.muted?0:player.volume)*100));
      // show volPop near button
      const rect = muteBtn.getBoundingClientRect();
      volPop.style.display = 'block';
      volPop.style.left = (rect.right - 140) + 'px';
      volPop.style.top = (rect.top - 56) + 'px';
      if (window._volPopTimeout) clearTimeout(window._volPopTimeout);
      window._volPopTimeout = setTimeout(()=> { volPop.style.display='none'; }, 4000);
    });
    if (volSlider) volSlider.addEventListener('input', (e)=> { const v = Number(e.target.value)/100; player.volume = v; player.muted = v === 0; showVolumeIndicator(Math.round(v*100)); });
    document.addEventListener('click', (ev)=> { if (!volPop) return; if (volPop.contains(ev.target) || (muteBtn && muteBtn.contains(ev.target))) return; volPop.style.display = 'none'; });

    (function enableVerticalVolume(){
      let active=false, startY=0, startVolume=1, pointerId=null;
      const zone = volZone;
      if (!zone) return;
      zone.addEventListener('pointerdown', ev => { ev.preventDefault(); active = true; pointerId = ev.pointerId; startY = ev.clientY; startVolume = player.muted ? (prevVolume || 1) : (player.volume || 1); player.muted = false; try { zone.setPointerCapture(pointerId); } catch(e){} showVolumeIndicator(Math.round(startVolume*100)); });
      zone.addEventListener('pointermove', ev => { if (!active) return; const dy = startY - ev.clientY; const delta = dy/160; let newVol = Math.max(0, Math.min(1, startVolume + delta)); player.volume = newVol; player.muted = newVol === 0; showVolumeIndicator(Math.round(newVol*100)); if (volSlider) volSlider.value = Math.round(newVol*100); });
      function endGesture(ev){ if (!active) return; active=false; try { zone.releasePointerCapture(ev.pointerId || pointerId); } catch(e){} pointerId=null; }
      zone.addEventListener('pointerup', endGesture); zone.addEventListener('pointercancel', endGesture); zone.addEventListener('lostpointercapture', ()=>{ active=false; });
    })();

    // fullscreen & cinema
    if (fsBtn) fsBtn.addEventListener('click', async ()=> { try { if (document.fullscreenElement) await document.exitFullscreen(); else await playerWrap.requestFullscreen(); } catch(e){ dbg('fs err', e); } });
    if (cinemaBtn) cinemaBtn.addEventListener('click', ()=> { const active = playerWrap.classList.toggle('theater'); document.body.classList.toggle('theater', active); });
    const speeds = [1,1.25,1.5,2]; let speedIndex = 0; if (speedBtn) speedBtn.addEventListener('click', ()=> { speedIndex = (speedIndex+1) % speeds.length; if (player) player.playbackRate = speeds[speedIndex]; speedBtn.textContent = speeds[speedIndex] + '×'; });

    try { wrap.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('dragstart', ev => ev.preventDefault()); } catch(e){}

    // render UI now: metadata and download links
    renderPost(post);
    renderDownloadLinks(post);

    // Playlist controller: streams only, user-gesture required to start
    (function attachPlaylist(){
      if (!post) return;
      const streams = Array.isArray(post._streams) ? post._streams : [];
      if (!streams.length) return;

      // remove old
      const old = document.getElementById('playlistControls'); if (old) old.remove();

      // create controls
      const plc = document.createElement('div');
      plc.id = 'playlistControls';
      plc.style.display = 'flex'; plc.style.gap = '8px'; plc.style.alignItems = 'center'; plc.style.marginTop = '8px';

      const prevBtn = document.createElement('button'); prevBtn.type='button'; prevBtn.className='icon-btn'; prevBtn.textContent='‹ Prev';
      const idxInput = document.createElement('input'); idxInput.type='number'; idxInput.min='1'; idxInput.value='1'; idxInput.style.width='64px';
      const countSpan = document.createElement('span'); countSpan.textContent = ` / ${streams.length}`;
      const nextBtn = document.createElement('button'); nextBtn.type='button'; nextBtn.className='icon-btn'; nextBtn.textContent='Next ›';

      plc.append(prevBtn, idxInput, countSpan, nextBtn);
      const pa = document.querySelector('.post-actions') || document.querySelector('.meta-box') || document.body;
      pa.appendChild(plc);

      let cur = 0;
      function clamp(i){ return Math.max(0, Math.min(streams.length - 1, i)); }

      // track user gesture: only after user pressed bigPlay or clicked play
      let userInteracted = false;
      if (bigPlay) bigPlay.addEventListener('click', () => { userInteracted = true; });

      async function playAt(i, {autoplayIfInteracted=true} = {}){
        if (!streams.length) return;
        i = clamp(i); cur = i; idxInput.value = cur + 1;
        await setupMedia(streams[cur]);
        if (autoplayIfInteracted && userInteracted) {
          try { await player.play(); setPlayIcon(false); hideOverlay(); } catch(e){ dbg('play blocked after switch', e); showOverlay(); }
        } else {
          showOverlay();
        }
      }

      prevBtn.addEventListener('click', async ()=> { if (cur > 0) { await playAt(cur-1); if (userInteracted) try{ await player.play(); }catch(e){ dbg('prev play blocked', e); } } });
      nextBtn.addEventListener('click', async ()=> { if (cur < streams.length-1) { await playAt(cur+1); if (userInteracted) try{ await player.play(); }catch(e){ dbg('next play blocked', e); } } });
      idxInput.addEventListener('change', async ()=> { const v = Number(idxInput.value)-1; if (Number.isInteger(v) && v>=0 && v<streams.length) { await playAt(v); if (userInteracted) try{ await player.play(); }catch(e){ dbg('goto play blocked', e); } } else idxInput.value = cur+1; });

      // auto-next on ended (only autoplay if userInteracted)
      player.addEventListener('ended', async ()=> {
        if (cur < streams.length - 1) {
          cur++; idxInput.value = cur+1; await setupMedia(streams[cur]);
          if (userInteracted) { try { await player.play(); } catch(e){ dbg('auto-next blocked', e); showOverlay(); } } else showOverlay();
        } else { dbg('playlist ended'); showOverlay(); }
      });

      // initial load
      const initial = streams.findIndex(s => s === (post.stream || ''));
      cur = initial >= 0 ? initial : 0;
      idxInput.value = cur + 1;
      // load but don't autoplay (wait for user gesture)
      await setupMedia(streams[cur]);
      showOverlay();
    })();

    // final UI init
    try { setPlayIcon(player.paused); } catch(e){}
    try { updateMuteUI(); if (volSlider) volSlider.value = Math.round((player.muted?0:player.volume||1)*100); } catch(e){}
    dbg('player ready (streams + download links)', post ? (post.slug||post.id||post.path) : 'no-post');
  }

  init().catch(err => { console.error(err); try { dbg('init error: ' + err); } catch(e){} });
})();
