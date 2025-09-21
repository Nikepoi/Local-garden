// assets/player.js // Full player.js ready to replace your existing /assets/player.js // Works with your HTML (video#player, .post-actions, #postTitle, #postDate, #postDesc, #debug, #playerWrap, etc.) // Features: // - Load /data/posts.json and find post by slug / id / filename // - Build streams[] from post.links (plain URLs: videy, mediafire, terabox, pixeldrain, bonus) // - SetupMedia accepts a post object or a direct URL string // - HLS (.m3u8) support via dynamic hls.js loader // - Playlist controls (Prev / Next / Jump / Open in new tab) // - Download button handling for direct files // - Graceful fallback for links that cannot be embedded (MediaFire/Terabox)

(() => { const POSTS_JSON = '/data/posts.json'; // adjust if needed

// --- small utilities --- function dbg(...args){ console.log(...args); const el = document.getElementById('debug'); if (!el) return; try { el.textContent = (new Date()).toLocaleTimeString() + ' — ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' | '); } catch(e){} } function safeEncodeUrl(u){ if (!u) return u; return String(u).split(' ').join('%20'); } function formatTime(s){ if (!isFinite(s)) return '00:00'; const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60); if (h>0) return ${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}; return ${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}; }

async function loadJSON(url){ const res = await fetch(url, {cache:'no-store'}); if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); }

// --- build streams from post.links (plain urls) --- function buildStreamsFromLinksPlain(linksObj){ if (!linksObj || typeof linksObj !== 'object') return []; const order = ['videy','mediafire','terabox','pixeldrain','bonus']; const out = []; order.forEach(k=>{ const arr = Array.isArray(linksObj[k]) ? linksObj[k] : []; arr.forEach(u=>{ if (typeof u === 'string') { const url = u.trim(); if (url) out.push(url); } }); }); return out; }

// --- embed detection --- function getYouTubeEmbed(url){ try { const u = new URL(url); let id = ''; if (u.hostname.includes('youtu.be')) id = u.pathname.slice(1); else id = u.searchParams.get('v') || ''; if (!id) return null; return https://www.youtube.com/embed/${id}?rel=0&autoplay=1; } catch(e){ return null; } } function getVimeoEmbed(url){ try { const u = new URL(url); const id = u.pathname.split('/').filter(Boolean).pop(); return id ? https://player.vimeo.com/video/${id}?autoplay=1 : null; } catch(e){ return null; } } function canEmbedAsVideoTag(url){ return /.(mp4|webm|ogg)(?.*)?$/i.test(url); }

// --- setupMedia: accepts object {stream, download} or string URL --- async function setupMedia(p){ const player = document.getElementById('player'); const downloadBtn = document.getElementById('downloadBtn'); if (!player) return;

// cleanup previous
while (player.firstChild) player.removeChild(player.firstChild);
if (player._hls && typeof player._hls.destroy === 'function'){ try{ player._hls.destroy(); }catch(e){} player._hls = null; }

let stream = null;
let downloadLink = null;

if (typeof p === 'string') stream = safeEncodeUrl(p);
else if (p && typeof p === 'object') {
  stream = p.stream ? safeEncodeUrl(p.stream) : (p.url ? safeEncodeUrl(p.url) : null);
  if (!stream && p.download) stream = safeEncodeUrl(p.download);
  downloadLink = p.download || null;
}

if (!stream) {
  // fallback sample
  const s = document.createElement('source');
  s.src = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  s.type = 'video/mp4';
  player.appendChild(s);
  try{ player.load(); }catch(e){}
  if (downloadBtn) downloadBtn.style.display='none';
  dbg('no stream, fallback loaded');
  return;
}

// HLS
if (stream.toLowerCase().endsWith('.m3u8')){
  try {
    if (!window.Hls){
      await new Promise((resolve,reject)=>{
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.0/dist/hls.min.js';
        s.onload = ()=> resolve(); s.onerror = ()=> reject(new Error('hls.js load fail'));
        document.head.appendChild(s);
      });
    }
    if (window.Hls && Hls.isSupported()){
      const hls = new Hls({capLevelToPlayerSize:true});
      hls.loadSource(stream);
      hls.attachMedia(player);
      player._hls = hls;
      dbg('HLS attached', stream);
    } else {
      const s = document.createElement('source');
      s.src = stream; s.type = 'application/vnd.apple.mpegurl'; player.appendChild(s);
      try{ player.load(); }catch(e){}
      dbg('native hls used');
    }
  } catch(err){
    dbg('hls error', err);
    const s = document.createElement('source'); s.src = stream; s.type = 'application/vnd.apple.mpegurl'; player.appendChild(s);
    try{ player.load(); }catch(e){}
  }
} else {
  // normal file
  const s = document.createElement('source');
  s.src = stream;
  s.type = stream.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/unknown';
  player.appendChild(s);
  try{ player.load(); }catch(e){}
  dbg('stream loaded', stream);
}

// download button logic: show direct file only if direct file ext
if (downloadBtn) {
  if (downloadLink) { downloadBtn.href = downloadLink; downloadBtn.style.display='inline-flex'; }
  else if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(stream)) { downloadBtn.href = stream; downloadBtn.style.display='inline-flex'; }
  else downloadBtn.style.display='none';
}

}

// --- modal/playlist minimal (we will attach playlist UI to .post-actions) --- // Note: we do not create a modal here — we use the main player on page and swap streams

async function init(){ const player = document.getElementById('player'); const progress = document.getElementById('progress'); const timeEl = document.getElementById('time'); const playBtn = document.getElementById('playPause'); const bigPlay = document.getElementById('bigPlay'); const overlay = document.getElementById('overlay'); const iconPlay = document.getElementById('iconPlay'); const iconMute = document.getElementById('iconMute'); const muteBtn = document.getElementById('mute'); const fsBtn = document.getElementById('fs'); const cinemaBtn = document.getElementById('cinema'); const speedBtn = document.getElementById('speedBtn'); const downloadBtn = document.getElementById('downloadBtn'); const postTitle = document.getElementById('postTitle'); const postDate = document.getElementById('postDate'); const postDesc = document.getElementById('postDesc'); const playerWrap = document.getElementById('playerWrap'); const volZone = document.getElementById('volZone');

// load posts.json
let post = null;
try{
  dbg('Fetching', POSTS_JSON);
  const postsData = await loadJSON(POSTS_JSON);
  dbg('posts loaded', Array.isArray(postsData)? postsData.length + ' items' : typeof postsData);
  let posts = postsData;
  // if posts.json is object with posts: [] support both
  if (postsData && postsData.posts && Array.isArray(postsData.posts)) posts = postsData.posts;

  // get slug from path
  const rawName = (location.pathname.split('/').pop() || '').replace('.html','');
  const slug = decodeURIComponent(rawName || '');

  post = posts.find(p=>{
    if(!p) return false;
    const pslug = (p.slug||'').toString();
    const pid = (p.id||'').toString();
    const ppath = (p.path||'').toString();
    const filename = (ppath.split('/').pop()||'').replace('.html','');
    return pslug === slug || pid === slug || filename === slug || (p.url && p.url.endsWith('/' + slug + '.html'));
  }) || (Array.isArray(posts) && posts.length === 1 ? posts[0] : null);

  if (!post) dbg('No post matched slug; continuing with null post (fallback)');
} catch(err){ dbg('posts.json error', String(err)); }

function renderPost(p){
  if (!p) { postTitle.textContent = 'Posting tidak ditemukan'; postDate.textContent = ''; postDesc.innerHTML = 'Tidak ada entri yang cocok.'; dbg('No matching post'); return; }
  postTitle.textContent = p.title || 'No title';
  postDate.textContent = p.date || '';
  postDesc.innerHTML = (p.excerpt || '').toString().replace(/<img\b[^>]*>/gi,'').replace(/\n/g,'<br>');
  if (p.thumb) try { player.poster = safeEncodeUrl(p.thumb); } catch(e){}
}

renderPost(post);

// before first setupMedia: build streams[] and set default post.stream if not present
if (post) {
  const streams = buildStreamsFromLinksPlain(post.links || {});
  post._streams = streams;
  if (!post.stream && streams && streams.length) {
    // pick first playable (mp4/m3u8/webm) or fallback to first
    const pick = streams.find(u => /\.(mp4|m3u8|webm|ogg)(\?.*)?$/i.test(u)) || streams[0];
    if (pick) post.stream = pick;
  }
}

// initial load
try { await setupMedia(post); } catch(e){ dbg('setupMedia initial err', e); }

// --- player UI handlers (reuse many of your original behaviors) ---
function setPlayIcon(paused){ if (!iconPlay) return; if (paused) iconPlay.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"/>'; else iconPlay.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>'; }
function showOverlay(){ overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); }
function hideOverlay(){ overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); }

async function safePlay(){ try { const p = player.play(); if (p && typeof p.then === 'function') await p; setPlayIcon(false); hideOverlay(); } catch(err){ dbg('play() rejected', err); showOverlay(); } }

playBtn.addEventListener('click', ()=> { if (player.paused) safePlay(); else player.pause(); });
bigPlay.addEventListener('click', ()=> safePlay());
player.addEventListener('click', ()=> { if (player.paused) safePlay(); else player.pause(); });

player.addEventListener('play', ()=> { setPlayIcon(false); hideOverlay(); });
player.addEventListener('playing', ()=> { setPlayIcon(false); hideOverlay(); });
player.addEventListener('pause', ()=> { setPlayIcon(true); showOverlay(); });
player.addEventListener('ended', ()=> { setPlayIcon(true); showOverlay(); });

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

// mute & volume
let prevVolume = typeof player.volume === 'number' ? player.volume : 1;
function updateMuteUI(){ if (player.muted || player.volume === 0) iconMute.innerHTML = '<path d="M16.5 12c0-1.77-.77-3.36-1.99-4.44L13 9.07A3.01 3.01 0 0 1 15 12a3 3 0 0 1-2 2.83V17l4 2V7.17L16.5 8.56A6.98 6.98 0 0 1 18 12z" fill="currentColor"/>'; else iconMute.innerHTML = '<path d="M5 9v6h4l5 5V4L9 9H5z" fill="currentColor"/>'; }
function showVolumeIndicator(perc){ const volumeIndicator = document.getElementById('volumeIndicator'); if (!volumeIndicator) return; volumeIndicator.style.display='inline-flex'; volumeIndicator.textContent = `Volume ${perc}%`; if (window._volTimeout) clearTimeout(window._volTimeout); window._volTimeout = setTimeout(()=> volumeIndicator.style.display = 'none', 900); }

// vol pop handling
let volPop = document.getElementById('volPop');
if (!volPop) {
  volPop = document.createElement('div'); volPop.id='volPop'; volPop.className='vol-pop'; volPop.innerHTML = '<input id="volSlider" type="range" min="0" max="100" step="1" value="100" aria-label="Volume">'; document.body.appendChild(volPop);
}
const volSlider = document.getElementById('volSlider');
muteBtn.addEventListener('click', (ev)=> {
  if (player.muted || player.volume === 0){ player.muted = false; player.volume = prevVolume || 1; }
  else { prevVolume = player.volume; player.muted = true; }
  updateMuteUI(); showVolumeIndicator(Math.round((player.muted?0:player.volume)*100));
  // show volPop near button
  const rect = muteBtn.getBoundingClientRect(); volPop.style.display='block'; volPop.style.left = (rect.right - 140) + 'px'; volPop.style.top = (rect.top - 56) + 'px'; if (window._volPopTimeout) clearTimeout(window._volPopTimeout); window._volPopTimeout = setTimeout(()=> { volPop.style.display='none'; }, 4000);
});
volSlider.addEventListener('input', (e)=> { const v = Number(e.target.value)/100; player.volume = v; player.muted = v === 0; showVolumeIndicator(Math.round(v*100)); });

// vertical volume gesture
(function enableVerticalVolume(){
  let active=false, startY=0, startVolume=1, pointerId=null; const zone = volZone; if (!zone) return;
  zone.addEventListener('pointerdown', ev => { ev.preventDefault(); active = true; pointerId = ev.pointerId; startY = ev.clientY; startVolume = player.muted ? (prevVolume || 1) : (player.volume || 1); player.muted = false; zone.setPointerCapture(pointerId); showVolumeIndicator(Math.round(startVolume*100)); });
  zone.addEventListener('pointermove', ev => { if (!active) return; const dy = startY - ev.clientY; const delta = dy/160; let newVol = Math.max(0, Math.min(1, startVolume + delta)); player.volume = newVol; player.muted = newVol === 0; showVolumeIndicator(Math.round(newVol*100)); try{ document.getElementById('volSlider').value = Math.round(newVol*100); }catch(e){} });
  function endGesture(ev){ if (!active) return; active=false; try { zone.releasePointerCapture(ev.pointerId || pointerId); } catch(e){} pointerId=null; }
  zone.addEventListener('pointerup', endGesture); zone.addEventListener('pointercancel', endGesture); zone.addEventListener('lostpointercapture', ()=>{ active=false; });
})();

// fullscreen
fsBtn.addEventListener('click', async ()=> { try { if (document.fullscreenElement) await document.exitFullscreen(); else await playerWrap.requestFullscreen(); } catch(e){ dbg('fs err', e); } });

// cinema/theater
cinemaBtn.addEventListener('click', ()=> { const active = playerWrap.classList.toggle('theater'); document.body.classList.toggle('theater', active); });

// speed
const speeds = [1,1.25,1.5,2]; let speedIndex = 0; speedBtn.addEventListener('click', ()=> { speedIndex = (speedIndex+1) % speeds.length; player.playbackRate = speeds[speedIndex]; speedBtn.textContent = speeds[speedIndex] + '×'; });

// keyboard shortcuts
document.addEventListener('keydown', (e)=> {
  if (['INPUT','TEXTAREA'].includes((document.activeElement||{}).tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); if (player.paused) safePlay(); else player.pause(); }
  if (e.key === 'f') fsBtn.click(); if (e.key === 't') cinemaBtn.click(); if (e.key === 'm') muteBtn.click();
  if (e.key === 'ArrowRight') player.currentTime = Math.min(player.duration||0, player.currentTime + 10);
  if (e.key === 'ArrowLeft') player.currentTime = Math.max(0, player.currentTime - 10);
  if (e.key === 'ArrowUp'){ player.volume = Math.min(1, player.volume + 0.05); showVolumeIndicator(Math.round(player.volume*100)); document.getElementById('volSlider').value = Math.round(player.volume*100); }
  if (e.key === 'ArrowDown'){ player.volume = Math.max(0, player.volume - 0.05); showVolumeIndicator(Math.round(player.volume*100)); document.getElementById('volSlider').value = Math.round(player.volume*100); }
});

// context/drag prevent
const wrap = document.getElementById('videoWrap'); if (wrap) { wrap.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('contextmenu', ev => ev.preventDefault(), false); player.addEventListener('dragstart', ev => ev.preventDefault()); }

setPlayIcon(player.paused);
updateMuteUI(); try{ document.getElementById('volSlider').value = Math.round((player.muted?0:player.volume||1)*100); }catch(e){}

dbg('player ready', post ? (post.slug||post.id||post.path||'post') : 'no-post');

// attach playlist controls if post._streams exists
(function attachSimplePlaylist(){
  if (!post) return; const streams = post._streams || []; if (!streams.length) return;
  const old = document.getElementById('playlistControls'); if (old) old.remove();
  const plc = document.createElement('div'); plc.id = 'playlistControls'; plc.style.display='flex'; plc.style.gap='8px'; plc.style.alignItems='center'; plc.style.marginTop='8px';
  const prev = document.createElement('button'); prev.type='button'; prev.textContent='‹ Prev'; prev.className='icon-btn';
  const idx = document.createElement('input'); idx.type='number'; idx.min='1'; idx.value='1'; idx.style.width='64px';
  const count = document.createElement('span'); count.textContent = ` / ${streams.length}`;
  const next = document.createElement('button'); next.type='button'; next.textContent='Next ›'; next.className='icon-btn';
  const open = document.createElement('a'); open.href = streams[0]; open.target='_blank'; open.rel='noopener noreferrer'; open.textContent='Buka di tab'; open.className='download-link'; open.style.padding='6px 10px';
  plc.append(prev, idx, count, next, open);
  const pa = document.querySelector('.post-actions') || document.querySelector('.meta-box') || document.body; pa.appendChild(plc);

  let cur = 0;
  async function playAt(i){ if (i<0||i>=streams.length) return; cur = i; idx.value = i+1; open.href = streams[i]; await setupMedia(streams[i]); try { await player.play(); } catch(e){} }
  prev.addEventListener('click', ()=> playAt(cur-1)); next.addEventListener('click', ()=> playAt(cur+1)); idx.addEventListener('change', ()=> { const v = Number(idx.value)-1; if (Number.isInteger(v) && v>=0 && v<streams.length) playAt(v); else idx.value = cur+1; });
  // set initial index based on post.stream
  const initial = streams.findIndex(s=> s === (post.stream || '')); cur = initial >= 0 ? initial : 0; idx.value = cur+1; open.href = streams[cur];
})();

}

// run init init().catch(err=>{ console.error(err); dbg('init error: ' + err); }); })();

// ========================= // Example data file to use with the player // Save as /data/posts.json (or adapt POSTS_JSON in code) /* [ { "id": 4000, "slug": "4000", "title": "TALENT FLOIYRINE ACAA", "thumb": "/foto/b6dpqr.jpg", "excerpt": "Contoh playlist dengan banyak videy mp4 + mediafire + terabox", "date": "2025-08-10T00:00:00Z", "links": { "videy": [ "https://cdn.videy.co/fq3vnyai1.mp4", "https://cdn.videy.co/z8B3jMxB1.mp4", "https://cdn.videy.co/mSDArJW71.mp4", "https://cdn.videy.co/fdMXlrr61.mp4", "https://cdn.videy.co/6I2IFand1.mp4", "https://cdn.videy.co/NXwqxz4Y1.mp4", "https://cdn.videy.co/GgQBnCVH1.mp4", "https://cdn.videy.co/HlsDYou11.mp4", "https://cdn.videy.co/MsfyAux01.mp4", "https://cdn.videy.co/gB1vHJC71.mp4", "https://cdn.videy.co/5ete3cTl1.mp4", "https://cdn.videy.co/nX5DmjcN1.mp4" ], "mediafire": [ "https://www.mediafire.com/file/9q8yw3qmym5mkz7/TALENT_FLOIYRINE_ACAA.zip/file" ], "terabox": [ "https://1024terabox.com/s/1GCjCnKE2oqBLCjpEa4egCA" ], "pixeldrain": [], "bonus": [] } } ] */

// ========================= // Optional: small CSS additions (put into /assets/player.css or your CSS file) /* #playlistControls { margin-top:10px; display:flex; gap:8px; align-items:center; } #playlistControls .icon-btn { padding:6px 10px; min-width:40px; } #playlistControls input[type=number] { padding:6px; border-radius:8px; border:1px solid rgba(0,0,0,0.08); } */

// End of file

