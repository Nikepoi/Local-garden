// assets/player.js
// Separated player logic: HLS, overlay, seek/time, volume gesture + slider, fullscreen, cinema
(() => {
  const POSTS_JSON = '/data/posts.json';

  function dbg(...args){
    console.log(...args);
    const el = document.getElementById('debug');
    try { el.textContent = (new Date()).toLocaleTimeString() + ' — ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' | '); } catch(e){}
  }
  function safeEncodeUrl(u){ if (!u) return u; return u.split(' ').join('%20'); }
  function formatTime(s){ if (!isFinite(s)) return '00:00'; const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60); if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }

  async function loadJSON(url){
    const res = await fetch(url, {cache:'no-store'}); if (!res.ok) throw new Error('HTTP ' + res.status); return res.json();
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
    const downloadBtn = document.getElementById('downloadBtn');
    const postTitle = document.getElementById('postTitle');
    const postDate = document.getElementById('postDate');
    const postDesc = document.getElementById('postDesc');

    // create vol zone and vol pop if not present
    let volZone = document.getElementById('volZone');
    if (!volZone) {
      volZone = document.createElement('div');
      volZone.id = 'volZone';
      volZone.className = 'vol-zone';
      wrap.appendChild(volZone);
    }

    let volPop = document.getElementById('volPop');
    if (!volPop) {
      volPop = document.createElement('div');
      volPop.id = 'volPop';
      volPop.className = 'vol-pop';
      volPop.innerHTML = '<input id="volSlider" type="range" min="0" max="100" step="1" value="100" aria-label="Volume">';
      document.body.appendChild(volPop);
    }
    const volSlider = document.getElementById('volSlider');

    const volumeIndicator = document.getElementById('volumeIndicator') || (function(){
      const el = document.createElement('div'); el.id='volumeIndicator'; el.className='volume-indicator'; el.setAttribute('role','status'); el.setAttribute('aria-live','polite'); el.style.display='none';
      document.body.appendChild(el); return el;
    })();

    // get slug from path
    const rawName = (location.pathname.split('/').pop() || '').replace('.html','');
    const slug = decodeURIComponent(rawName || '');

    // load posts
    let post = null;
    try {
      dbg('Fetching', POSTS_JSON);
      const posts = await loadJSON(POSTS_JSON);
      dbg('posts loaded', Array.isArray(posts)? posts.length + ' items' : typeof posts);
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

    function renderPost(p){
      if (!p) { postTitle.textContent = 'Posting tidak ditemukan'; postDate.textContent = ''; postDesc.innerHTML = 'Tidak ada entri yang cocok.'; dbg('No matching post', slug); return; }
      postTitle.textContent = p.title || 'No title';
      postDate.textContent = p.date || '';
      postDesc.innerHTML = (p.excerpt || '').toString().replace(/<img\b[^>]*>/gi,'').replace(/\n/g,'<br>');
      if (p.thumb) try { player.poster = safeEncodeUrl(p.thumb); } catch(e){}
    }

    async function setupMedia(p){
      // clear previous
      while (player.firstChild) player.removeChild(player.firstChild);
      if (player._hls && typeof player._hls.destroy === 'function'){ try{ player._hls.destroy(); }catch(e){} player._hls = null; }

      let stream = p && (p.stream || p.url || p.source) ? safeEncodeUrl(p.stream || p.url || p.source) : null;
      if (!stream && p && p.download) stream = safeEncodeUrl(p.download);
      if (!stream) {
        const s = document.createElement('source'); s.src = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'; s.type='video/mp4'; player.appendChild(s); try{ player.load(); }catch(e){} downloadBtn.style.display='none'; return;
      }

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

      if (p && p.download) { downloadBtn.href = p.download; downloadBtn.style.display='inline-flex'; } else downloadBtn.style.display='none';
    }

    renderPost(post);
    await setupMedia(post);

    // UI helpers
    async function safePlay(){
      try {
        const p = player.play();
        if (p && typeof p.then === 'function') await p;
        setPlayIcon(false); hideOverlay();
      } catch(err){
        dbg('play() rejected', err);
        showOverlay();
      }
    }
    function setPlayIcon(paused){
      if (!iconPlay) return;
      if (paused) iconPlay.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
      else iconPlay.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>';
    }
    function showOverlay(){ overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); }
    function hideOverlay(){ overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); }

    // play/pause
    playBtn.addEventListener('click', ()=> { if (player.paused) safePlay(); else player.pause(); });
    bigPlay.addEventListener('click', ()=> safePlay());
    player.addEventListener('click', ()=> { if (player.paused) safePlay(); else player.pause(); });

    player.addEventListener('play', ()=> { setPlayIcon(false); hideOverlay(); });
    player.addEventListener('playing', ()=> { setPlayIcon(false); hideOverlay(); });
    player.addEventListener('pause', ()=> { setPlayIcon(true); showOverlay(); });
    player.addEventListener('ended', ()=> { setPlayIcon(true); showOverlay(); });

    // seek/time
    player.addEventListener('loadedmetadata', ()=> { timeEl.textContent = `${formatTime(0)} / ${formatTime(player.duration)}`; });
    player.addEventListener('timeupdate', ()=>{
      const pct = (player.currentTime / Math.max(1, player.duration)) * 100;
      if (!Number.isNaN(pct)) progress.value = pct;
      timeEl.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
    });
    progress.addEventListener('input', (e)=> {
      const pct = Number(e.target.value); const t = (pct/100) * (player.duration || 0);
      timeEl.textContent = `${formatTime(t)} / ${formatTime(player.duration)}`;
    });
    progress.addEventListener('change', (e)=> { const pct = Number(e.target.value); player.currentTime = (pct/100) * (player.duration || 0); });

    // mute & visible vol slider
    let prevVolume = typeof player.volume === 'number' ? player.volume : 1;
    function updateMuteUI(){ if (player.muted || player.volume === 0) iconMute.innerHTML = '<path d="M16.5 12c0-1.77-.77-3.36-1.99-4.44L13 9.07A3.01 3.01 0 0 1 15 12a3 3 0 0 1-2 2.83V17l4 2V7.17L16.5 8.56A6.98 6.98 0 0 1 18 12z" fill="currentColor"/>'; else iconMute.innerHTML = '<path d="M5 9v6h4l5 5V4L9 9H5z" fill="currentColor"/>'; }
    function showVolumeIndicator(perc){ if (!volumeIndicator) return; volumeIndicator.style.display='inline-flex'; volumeIndicator.textContent = `Volume ${perc}%`; if (window._volTimeout) clearTimeout(window._volTimeout); window._volTimeout = setTimeout(()=> volumeIndicator.style.display = 'none', 900); }
    muteBtn.addEventListener('click', (ev)=> {
      // toggle pop on short click + toggle mute on double-click style
      if (player.muted || player.volume === 0){ player.muted = false; player.volume = prevVolume || 1; }
      else { prevVolume = player.volume; player.muted = true; }
      updateMuteUI(); showVolumeIndicator(Math.round((player.muted?0:player.volume)*100));
      // show slider popup positioned near button
      placeVolPop(muteBtn);
    });
    player.addEventListener('volumechange', ()=> { if (!player.muted) prevVolume = player.volume; updateMuteUI(); showVolumeIndicator(Math.round((player.muted?0:player.volume)*100)); volSlider.value = Math.round((player.muted?0:player.volume)*100); });

    // vol pop positioning & slider control
    function placeVolPop(anchor){
      if(!volPop) return;
      const rect = anchor.getBoundingClientRect();
      volPop.style.display = 'block';
      volPop.style.left = (rect.right - 140) + 'px';
      volPop.style.top = (rect.top - 56) + 'px';
      // auto-hide after some time
      if (window._volPopTimeout) clearTimeout(window._volPopTimeout);
      window._volPopTimeout = setTimeout(()=> { volPop.style.display='none'; }, 4000);
    }
    volSlider.addEventListener('input', (e)=> {
      const v = Number(e.target.value)/100;
      player.volume = v;
      player.muted = v === 0;
      showVolumeIndicator(Math.round(v*100));
    });
    // clicking outside hides volPop
    document.addEventListener('click', (ev)=> {
      if (!volPop) return;
      if (volPop.contains(ev.target) || muteBtn.contains(ev.target)) return;
      volPop.style.display = 'none';
    });

    // vertical volume gesture zone
    (function enableVerticalVolume(){
      let active=false, startY=0, startVolume=1, pointerId=null;
      const zone = volZone;
      if (!zone) return;
      zone.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        active = true; pointerId = ev.pointerId; startY = ev.clientY;
        startVolume = player.muted ? (prevVolume || 1) : (player.volume || 1);
        player.muted = false;
        zone.setPointerCapture(pointerId);
        showVolumeIndicator(Math.round(startVolume*100));
      });
      zone.addEventListener('pointermove', ev => {
        if (!active) return;
        const dy = startY - ev.clientY;
        const delta = dy/160; // sensitivity
        let newVol = Math.max(0, Math.min(1, startVolume + delta));
        player.volume = newVol;
        player.muted = newVol === 0;
        showVolumeIndicator(Math.round(newVol*100));
        volSlider.value = Math.round(newVol*100);
      });
      function endGesture(ev){
        if (!active) return; active=false;
        try { zone.releasePointerCapture(ev.pointerId || pointerId); } catch(e){}
        pointerId=null;
      }
      zone.addEventListener('pointerup', endGesture);
      zone.addEventListener('pointercancel', endGesture);
      zone.addEventListener('lostpointercapture', ()=>{ active=false; });
    })();

    // fullscreen (use playerWrap.requestFullscreen)
    fsBtn.addEventListener('click', async ()=> {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await playerWrap.requestFullscreen();
      } catch(e){ dbg('fs err', e); }
    });

    // cinema mode (theater)
    cinemaBtn.addEventListener('click', ()=> {
      const active = playerWrap.classList.toggle('theater');
      document.body.classList.toggle('theater', active);
    });

    // speed
    const speeds = [1,1.25,1.5,2]; let speedIndex = 0;
    speedBtn.addEventListener('click', ()=> {
      speedIndex = (speedIndex+1) % speeds.length; player.playbackRate = speeds[speedIndex]; speedBtn.textContent = speeds[speedIndex] + '×';
    });

    // keyboard shortcuts
    document.addEventListener('keydown', (e)=> {
      if (['INPUT','TEXTAREA'].includes((document.activeElement||{}).tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); if (player.paused) safePlay(); else player.pause(); }
      if (e.key === 'f') fsBtn.click();
      if (e.key === 't') cinemaBtn.click();
      if (e.key === 'm') muteBtn.click();
      if (e.key === 'ArrowRight') player.currentTime = Math.min(player.duration||0, player.currentTime + 10);
      if (e.key === 'ArrowLeft') player.currentTime = Math.max(0, player.currentTime - 10);
      if (e.key === 'ArrowUp'){ player.volume = Math.min(1, player.volume + 0.05); showVolumeIndicator(Math.round(player.volume*100)); volSlider.value = Math.round(player.volume*100); }
      if (e.key === 'ArrowDown'){ player.volume = Math.max(0, player.volume - 0.05); showVolumeIndicator(Math.round(player.volume*100)); volSlider.value = Math.round(player.volume*100); }
    });

    // prevent context & drag
    wrap.addEventListener('contextmenu', ev => ev.preventDefault(), false);
    player.addEventListener('contextmenu', ev => ev.preventDefault(), false);
    player.addEventListener('dragstart', ev => ev.preventDefault());

    // init UI states
    setPlayIcon(player.paused);
    updateMuteUI();
    volSlider.value = Math.round((player.muted?0:player.volume||1)*100);

    dbg('player ready', post ? (post.slug||post.id||post.path) : 'no-post');
  }

  // run
  init().catch(err => { console.error(err); dbg('init error: ' + err); });
})();
