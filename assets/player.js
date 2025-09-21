// assets/player.js
(() => {
  const POSTS_JSON = '/data/posts.json';

  function dbg(...args) {
    console.log(...args);
    const el = document.getElementById('debug');
    try { el.textContent = (new Date()).toLocaleTimeString() + ' — ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' | '); } catch(e) {}
  }
  function safeEncodeUrl(u) { if (!u) return u; return u.split(' ').join('%20'); }
  function formatTime(s) { if (!isFinite(s)) return '00:00'; const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60); if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }

  async function loadJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function init() {
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

    // Create vol zone and vol pop if not present
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

    const volumeIndicator = document.getElementById('volumeIndicator') || (function() {
      const el = document.createElement('div'); el.id = 'volumeIndicator'; el.className = 'volume-indicator'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.style.display = 'none';
      document.body.appendChild(el); return el;
    })();

    // Get slug from path
    const rawName = (location.pathname.split('/').pop() || '').replace('.html', '');
    const slug = decodeURIComponent(rawName || '');

    // Load posts
    let post = null;
    try {
      dbg('Fetching', POSTS_JSON);
      const posts = await loadJSON(POSTS_JSON);
      dbg('posts loaded', Array.isArray(posts) ? posts.length + ' items' : typeof posts);
      if (Array.isArray(posts)) {
        post = posts.find(p => {
          if (!p) return false;
          const pslug = (p.slug || '').toString(), pid = (p.id || '').toString(), ppath = (p.path || '').toString();
          const filename = (ppath.split('/').pop() || '').replace('.html', '');
          return pslug === slug || pid === slug || filename === slug || ppath.endsWith('/' + slug + '.html');
        });
        if (!post && posts.length === 1) post = posts[0];
      }
    } catch(err) {
      dbg('posts.json error', String(err));
    }

    function renderPost(p) {
      if (!p) { postTitle.textContent = 'Posting tidak ditemukan'; postDate.textContent = ''; postDesc.innerHTML = 'Tidak ada entri yang cocok.'; dbg('No matching post', slug); return; }
      postTitle.textContent = p.title || 'No title';
      postDate.textContent = p.date || '';
      postDesc.innerHTML = (p.excerpt || '').toString().replace(/<img\b[^>]*>/gi, '').replace(/\n/g, '<br>');
      if (p.thumb) try { player.poster = safeEncodeUrl(p.thumb); } catch(e) {}
    }

    async function setupMedia(p) {
      // Clear previous
      while (player.firstChild) player.removeChild(player.firstChild);
      if (player._hls && typeof player._hls.destroy === 'function') { try { player._hls.destroy(); } catch(e) {} player._hls = null; }

      // Get video streams from links.videy
      const streams = p && p.links && p.links.videy && Array.isArray(p.links.videy) ? p.links.videy : [];
      let currentStreamIndex = 0; // Track current video
      let stream = streams.length > 0 ? safeEncodeUrl(streams[currentStreamIndex]) : null; // Default to first video

      if (!stream) {
        const s = document.createElement('source');
        s.src = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
        s.type = 'video/mp4';
        player.appendChild(s);
        try { player.load(); } catch(e) {}
        downloadBtn.style.display = 'none';
        return;
      }

      // Load video stream
      async function loadStream(streamUrl) {
        try {
          const s = document.createElement('source');
          s.src = streamUrl;
          s.type = 'video/mp4'; // All streams are MP4
          player.appendChild(s);
          try { player.load(); } catch(e) {}
          dbg('MP4 loaded', streamUrl);
          return true;
        } catch(e) {
          dbg('Stream error', streamUrl, e);
          return false;
        }
      }

      // Try loading current stream
      await loadStream(stream);

      // Add prev/next buttons
      if (streams.length > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.id = 'prevVideo';
        prevBtn.className = 'icon-btn';
        prevBtn.title = 'Previous Video';
        prevBtn.setAttribute('aria-label', 'Previous Video');
        prevBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        const nextBtn = document.createElement('button');
        nextBtn.id = 'nextVideo';
        nextBtn.className = 'icon-btn';
        nextBtn.title = 'Next Video';
        nextBtn.setAttribute('aria-label', 'Next Video');
        nextBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        // Update button states
        function updateNavButtons() {
          prevBtn.disabled = currentStreamIndex === 0;
          nextBtn.disabled = currentStreamIndex === streams.length - 1;
        }
        updateNavButtons();

        // Event listeners for prev/next
        prevBtn.addEventListener('click', async () => {
          if (currentStreamIndex > 0) {
            currentStreamIndex--;
            await loadStream(safeEncodeUrl(streams[currentStreamIndex]));
            await safePlay();
            updateNavButtons();
          }
        });
        nextBtn.addEventListener('click', async () => {
          if (currentStreamIndex < streams.length - 1) {
            currentStreamIndex++;
            await loadStream(safeEncodeUrl(streams[currentStreamIndex]));
            await safePlay();
            updateNavButtons();
          }
        });

        // Add buttons to controls panel
        const buttonsRow = document.querySelector('.buttons-row');
        buttonsRow.prepend(nextBtn);
        buttonsRow.prepend(prevBtn);
      }

      // Handle download links (exclude videy)
      const downloadLinks = [];
      if (p && p.links) {
        if (p.links.mediafire && p.links.mediafire.length > 0) downloadLinks.push(...p.links.mediafire.map(link => ({ url: link, type: 'Mediafire' })));
        if (p.links.terabox && p.links.terabox.length > 0) downloadLinks.push(...p.links.terabox.map(link => ({ url: link, type: 'Terabox' })));
        if (p.links.pixeldrain && p.links.pixeldrain.length > 0) downloadLinks.push(...p.links.pixeldrain.map(link => ({ url: link, type: 'Pixeldrain' })));
        if (p.links.bonus && p.links.bonus.length > 0) downloadLinks.push(...p.links.bonus.map(link => ({ url: link, type: 'Bonus' })));
      }

      if (downloadLinks.length > 0) {
        if (downloadLinks.length === 1) {
          downloadBtn.href = downloadLinks[0].url;
          downloadBtn.style.display = 'inline-flex';
          downloadBtn.querySelector('span').textContent = downloadLinks[0].type;
        } else {
          downloadBtn.style.display = 'none'; // Hide single download button
          const downloadMenu = document.createElement('div');
          downloadMenu.className = 'download-menu';
          downloadMenu.innerHTML = `
            <button class="icon-btn" aria-label="Download options">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                <path d="M12 3v12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 11l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M21 21H3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Downloads
            </button>
            <ul>
              ${downloadLinks.map(link => `<li><a href="${link.url}" target="_blank" rel="noopener">${link.type}</a></li>`).join('')}
            </ul>`;
          document.querySelector('.post-actions').appendChild(downloadMenu);
        }
      } else {
        downloadBtn.style.display = 'none';
      }

      dbg('Setup media complete', streams.length, 'videos', downloadLinks.length, 'download links');
    }

    renderPost(post);
    await setupMedia(post);

    // UI helpers
    async function safePlay() {
      try {
        const p = player.play();
        if (p && typeof p.then === 'function') await p;
        setPlayIcon(false); hideOverlay();
      } catch(err) {
        dbg('play() rejected', err);
        showOverlay();
      }
    }
    function setPlayIcon(paused) {
      if (!iconPlay) return;
      if (paused) iconPlay.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
      else iconPlay.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>';
    }
    function showOverlay() { overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden', 'false'); }
    function hideOverlay() { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden', 'true'); }

    // Play/pause
    playBtn.addEventListener('click', () => { if (player.paused) safePlay(); else player.pause(); });
    bigPlay.addEventListener('click', () => safePlay());
    player.addEventListener('click', () => { if (player.paused) safePlay(); else player.pause(); });

    player.addEventListener('play', () => { setPlayIcon(false); hideOverlay(); });
    player.addEventListener('playing', () => { setPlayIcon(false); hideOverlay(); });
    player.addEventListener('pause', () => { setPlayIcon(true); showOverlay(); });
    player.addEventListener('ended', () => { setPlayIcon(true); showOverlay(); });

    // Seek/time
    player.addEventListener('loadedmetadata', () => { timeEl.textContent = `${formatTime(0)} / ${formatTime(player.duration)}`; });
    player.addEventListener('timeupdate', () => {
      const pct = (player.currentTime / Math.max(1, player.duration)) * 100;
      if (!Number.isNaN(pct)) progress.value = pct;
      timeEl.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
    });
    progress.addEventListener('input', (e) => {
      const pct = Number(e.target.value); const t = (pct/100) * (player.duration || 0);
      timeEl.textContent = `${formatTime(t)} / ${formatTime(player.duration)}`;
    });
    progress.addEventListener('change', (e) => { const pct = Number(e.target.value); player.currentTime = (pct/100) * (player.duration || 0); });

    // Mute & visible vol slider
    let prevVolume = typeof player.volume === 'number' ? player.volume : 1;
    function updateMuteUI() { if (player.muted || player.volume === 0) iconMute.innerHTML = '<path d="M16.5 12c0-1.77-.77-3.36-1.99-4.44L13 9.07A3.01 3.01 0 0 1 15 12a3 3 0 0 1-2 2.83V17l4 2V7.17L16.5 8.56A6.98 6.98 0 0 1 18 12z" fill="currentColor"/>'; else iconMute.innerHTML = '<path d="M5 9v6h4l5 5V4L9 9H5z" fill="currentColor"/>'; }
    function showVolumeIndicator(perc) { if (!volumeIndicator) return; volumeIndicator.style.display = 'inline-flex'; volumeIndicator.textContent = `Volume ${perc}%`; if (window._volTimeout) clearTimeout(window._volTimeout); window._volTimeout = setTimeout(() => volumeIndicator.style.display = 'none', 900); }
    muteBtn.addEventListener('click', (ev) => {
      if (player.muted || player.volume === 0) { player.muted = false; player.volume = prevVolume || 1; }
      else { prevVolume = player.volume; player.muted = true; }
      updateMuteUI(); showVolumeIndicator(Math.round((player.muted ? 0 : player.volume) * 100));
      placeVolPop(muteBtn);
    });
    player.addEventListener('volumechange', () => { if (!player.muted) prevVolume = player.volume; updateMuteUI(); showVolumeIndicator(Math.round((player.muted ? 0 : player.volume) * 100)); volSlider.value = Math.round((player.muted ? 0 : player.volume) * 100); });

    // Vol pop positioning & slider control
    function placeVolPop(anchor) {
      if (!volPop) return;
      const rect = anchor.getBoundingClientRect();
      volPop.style.display = 'block';
      volPop.style.left = (rect.right - 140) + 'px';
      volPop.style.top = (rect.top - 56) + 'px';
      if (window._volPopTimeout) clearTimeout(window._volPopTimeout);
      window._volPopTimeout = setTimeout(() => { volPop.style.display = 'none'; }, 4000);
    }
    volSlider.addEventListener('input', (e) => {
      const v = Number(e.target.value) / 100;
      player.volume = v;
      player.muted = v === 0;
      showVolumeIndicator(Math.round(v * 100));
    });
    document.addEventListener('click', (ev) => {
      if (!volPop) return;
      if (volPop.contains(ev.target) || muteBtn.contains(ev.target)) return;
      volPop.style.display = 'none';
    });

    // Vertical volume gesture zone
    (function enableVerticalVolume() {
      let active = false, startY = 0, startVolume = 1, pointerId = null;
      const zone = volZone;
      if (!zone) return;
      zone.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        active = true; pointerId = ev.pointerId; startY = ev.clientY;
        startVolume = player.muted ? (prevVolume || 1) : (player.volume || 1);
        player.muted = false;
        zone.setPointerCapture(pointerId);
        showVolumeIndicator(Math.round(startVolume * 100));
      });
      zone.addEventListener('pointermove', ev => {
        if (!active) return;
        const dy = startY - ev.clientY;
        const delta = dy / 160; // Sensitivity
        let newVol = Math.max(0, Math.min(1, startVolume + delta));
        player.volume = newVol;
        player.muted = newVol === 0;
        showVolumeIndicator(Math.round(newVol * 100));
        volSlider.value = Math.round(newVol * 100);
      });
      function endGesture(ev) {
        if (!active) return; active = false;
        try { zone.releasePointerCapture(ev.pointerId || pointerId); } catch(e) {}
        pointerId = null;
      }
      zone.addEventListener('pointerup', endGesture);
      zone.addEventListener('pointercancel', endGesture);
      zone.addEventListener('lostpointercapture', () => { active = false; });
    })();

    // Fullscreen
    fsBtn.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await playerWrap.requestFullscreen();
      } catch(e) { dbg('fs err', e); }
    });

    // Cinema mode
    cinemaBtn.addEventListener('click', () => {
      const active = playerWrap.classList.toggle('theater');
      document.body.classList.toggle('theater', active);
    });

    // Speed
    const speeds = [1, 1.25, 1.5, 2]; let speedIndex = 0;
    speedBtn.addEventListener('click', () => {
      speedIndex = (speedIndex + 1) % speeds.length; player.playbackRate = speeds[speedIndex]; speedBtn.textContent = speeds[speedIndex] + '×';
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes((document.activeElement || {}).tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); if (player.paused) safePlay(); else player.pause(); }
      if (e.key === 'f') fsBtn.click();
      if (e.key === 't') cinemaBtn.click();
      if (e.key === 'm') muteBtn.click();
      if (e.key === 'ArrowRight') player.currentTime = Math.min(player.duration || 0, player.currentTime + 10);
      if (e.key === 'ArrowLeft') player.currentTime = Math.max(0, player.currentTime - 10);
      if (e.key === 'ArrowUp') { player.volume = Math.min(1, player.volume + 0.05); showVolumeIndicator(Math.round(player.volume * 100)); volSlider.value = Math.round(player.volume * 100); }
      if (e.key === 'ArrowDown') { player.volume = Math.max(0, player.volume - 0.05); showVolumeIndicator(Math.round(player.volume * 100)); volSlider.value = Math.round(player.volume * 100); }
    });

    // Prevent context & drag
    wrap.addEventListener('contextmenu', ev => ev.preventDefault(), false);
    player.addEventListener('contextmenu', ev => ev.preventDefault(), false);
    player.addEventListener('dragstart', ev => ev.preventDefault());

    // Init UI states
    setPlayIcon(player.paused);
    updateMuteUI();
    volSlider.value = Math.round((player.muted ? 0 : player.volume || 1) * 100);

    dbg('player ready', post ? (post.slug || post.id || post.path) : 'no-post');
  }

  // Run
  init().catch(err => { console.error(err); dbg('init error: ' + err); });
})();
