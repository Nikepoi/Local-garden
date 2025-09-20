// assets/list.js
(function(){
  // Konfigurasi
  const POSTS_JSON_CANDIDATES = ['/posts.json', '/data/posts.json'];
  const DEFAULT_PER_PAGE = 5;
  const POLL_INTERVAL_MS = 60000; // 0 = disable

  const grid = document.getElementById('grid');
  const debugEl = document.getElementById('debug');
  const footerClock = document.getElementById('footerClock');
  const toastId = 'np-update-toast';

  // util
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[ch]); }
  function z(n){ return String(n).padStart(2,'0'); }

  // jam footer (Asia/Jakarta local time)
  (function startClock(){
    function tick(){
      const d = new Date();
      if (footerClock) footerClock.textContent = `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
    }
    tick();
    setInterval(tick, 500);
  })();

  // AOS init helper
  function initAOS(){
    if (window.AOS && typeof window.AOS.init === 'function') {
      try { AOS.init({ duration: 420, easing: 'ease-out-cubic', once: true, mirror: false }); }
      catch(e){ console.warn('AOS init failed', e); }
    }
  }

  // detect page number from URL (supports root, /2/, /2/index.html, /2.html, ?page=2, /page/2)
  function getPageFromUrl(){
    const qp = new URLSearchParams(window.location.search).get('page');
    if (qp && /^\d+$/.test(qp)) return Math.max(1, Number(qp));
    const path = window.location.pathname.replace(/\/+$/,'');
    const m = path.match(/(?:\/page\/)?(\d+)(?:\/index\.html|\.html)?$/i);
    if (m) return Math.max(1, Number(m[1]));
    return 1;
  }

  // render posts slice to grid using markup matching your CSS
  function renderPostsSlice(posts, page, perPage){
    if (!grid) return;
    const total = posts.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const start = (page - 1) * perPage;
    const slice = posts.slice(start, start + perPage);

    if (!slice.length){
      grid.innerHTML = '<div class="col-12 text-center text-muted">Tidak ada posting pada halaman ini.</div>';
    } else {
      grid.innerHTML = slice.map((p, i) => {
        const thumb = escapeHtml(p.thumb || '/assets/thumbs/default.jpg');
        const title = escapeHtml(p.title || 'No title');
        const path = escapeHtml(p.path || p.url || ('/posts/' + (p.slug || p.id || 'post') + '.html'));
        return `
          <div class="card-wrap" role="listitem" data-aos="fade-up" data-aos-delay="${(i%6)*40}">
            <a class="card-link animate__animated animate__faster" href="${path}" aria-label="${title}">
              <div class="card">
                <div class="card-media">
                  <img src="${thumb}" alt="${title}" loading="lazy" onerror="this.src='/assets/thumbs/default.jpg'">
                </div>
                <div class="card-info">
                  <div class="card-title">${title}</div>
                </div>
              </div>
            </a>
          </div>
        `;
      }).join('');
    }

    // render pagination under grid
    renderPaginationControls(page, totalPages);
    initAOS();
    if (debugEl) debugEl.textContent = `Loaded ${total} posts. Showing ${slice.length}.`;
  }

  // build pagination anchors (anchors point to /, /2/, /3/ so copying index.html to /2/index.html works)
  function renderPaginationControls(current, totalPages){
    // remove old
    const old = document.getElementById('paginationControls');
    if (old) old.remove();

    const nav = document.createElement('nav');
    nav.id = 'paginationControls';
    nav.setAttribute('aria-label', 'Pagination');

    const container = document.createElement('div');
    container.className = 'pagination';

    function hrefFor(p){
      return p <= 1 ? '/' : `/${p}/`;
    }

    function makeLink(label, p, active){
      const a = document.createElement('a');
      a.href = hrefFor(p);
      a.textContent = label;
      a.dataset.page = String(p);
      if (active) a.classList.add('active');
      return a;
    }

    container.appendChild(makeLink('‹ Prev', Math.max(1, current-1), false));

    const range = 3;
    const start = Math.max(1, current - range);
    const end = Math.min(totalPages, current + range);

    if (start > 1){
      container.appendChild(makeLink('1', 1, current === 1));
      if (start > 2) {
        const dots = document.createElement('span'); dots.textContent = '…'; container.appendChild(dots);
      }
    }
    for (let i = start; i <= end; i++){
      container.appendChild(makeLink(String(i), i, i === current));
    }
    if (end < totalPages){
      if (end < totalPages - 1) {
        const dots = document.createElement('span'); dots.textContent = '…'; container.appendChild(dots);
      }
      container.appendChild(makeLink(String(totalPages), totalPages, current === totalPages));
    }

    container.appendChild(makeLink('Next ›', Math.min(totalPages, current+1), false));

    nav.appendChild(container);
    grid.after(nav);

    // If we're on root index (SPA), hijack clicks for smooth navigation
    const pathRoot = window.location.pathname.replace(/\/+$/,'') === '' || /\/index\.html$/i.test(window.location.pathname);
    if (pathRoot) {
      container.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', function(e){
          e.preventDefault();
          const page = Number(this.dataset.page || 1);
          const newUrl = new URL(window.location);
          newUrl.pathname = page <= 1 ? '/' : `/${page}/`;
          history.pushState({page}, '', newUrl.toString());
          // render using existing posts data
          renderPostsSlice(window.__np_posts_cache || [], page, window.__np_per_page || DEFAULT_PER_PAGE);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    }
  }

  // try fetching posts.json from candidate paths in order
  async function fetchPostsJson(){
    for (const url of POSTS_JSON_CANDIDATES){
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        // support both array (legacy) or object { posts:[], updated_at, total, per_page }
        if (Array.isArray(data)) return { posts: data, updated_at: null, total: data.length };
        if (data && (Array.isArray(data.posts) || Array.isArray(data))) return data;
      } catch(e){
        // continue to next candidate
      }
    }
    throw new Error('posts.json not found at any candidate path');
  }

  // state for polling & caching
  let currentUpdatedAt = null;

  async function loadAndRender(initialPage){
    try {
      const raw = await fetchPostsJson();
      const posts = Array.isArray(raw) ? raw : (raw.posts || []);
      // ensure sorted newest -> oldest by date if date provided
      posts.sort((a,b) => (b.date||'').localeCompare(a.date||''));
      // cache globally for pagination hijack
      window.__np_posts_cache = posts;
      window.__np_per_page = raw.per_page || DEFAULT_PER_PAGE;
      currentUpdatedAt = raw.updated_at || currentUpdatedAt;

      renderPostsSlice(posts, initialPage || getPageFromUrl(), window.__np_per_page);
    } catch (err) {
      console.error('loadAndRender error', err);
      if (grid) grid.innerHTML = '<div class="col-12 text-center text-danger">Gagal memuat daftar. Periksa /posts.json atau /data/posts.json</div>';
      if (debugEl) { debugEl.style.display = 'block'; debugEl.textContent = String(err); }
    }
  }

  // polling to detect updated_at change and show toast
  async function pollForUpdates(){
    if (!POLL_INTERVAL_MS) return;
    try {
      const raw = await fetchPostsJson();
      const newUpdatedAt = raw && raw.updated_at ? raw.updated_at : null;
      if (newUpdatedAt && newUpdatedAt !== currentUpdatedAt){
        currentUpdatedAt = newUpdatedAt;
        // update cache (but don't re-render automatically - show toast to let user decide)
        const posts = raw.posts || (Array.isArray(raw) ? raw : []);
        posts.sort((a,b) => (b.date||'').localeCompare(a.date||''));
        window.__np_posts_cache = posts;
        window.__np_per_page = raw.per_page || DEFAULT_PER_PAGE;
        showUpdateToast();
        if (debugEl) debugEl.textContent = `Updated detected: ${currentUpdatedAt}`;
      }
    } catch(e){
      // silent
    }
  }

  // toast UI (create if not present)
  function showUpdateToast(){
    let t = document.getElementById(toastId);
    if (!t){
      t = document.createElement('div');
      t.id = toastId;
      t.setAttribute('role','status');
      t.setAttribute('aria-live','polite');
      t.tabIndex = 0;
      t.style.position = 'fixed';
      t.style.right = '16px';
      t.style.bottom = '18px';
      t.style.background = '#111';
      t.style.color = '#fff';
      t.style.padding = '10px 14px';
      t.style.borderRadius = '8px';
      t.style.zIndex = 99999;
      t.style.cursor = 'pointer';
      t.style.boxShadow = '0 6px 18px rgba(0,0,0,0.18)';
      t.innerHTML = `<strong>Update:</strong><br/><small>Ada posting baru — klik untuk muat ulang</small>`;
      document.body.appendChild(t);
      t.addEventListener('click', () => {
        t.remove();
        const page = getPageFromUrl();
        loadAndRender(page);
      });
    } else {
      // flash visible
      t.style.display = 'block';
    }
  }

  /* ===================
     Promo popup
     - If markup exists in HTML, we use it
     - Otherwise build it (like original behavior)
  =================== */
  function ensurePromoHtml() {
    const existing = document.getElementById('promoPopupOverlay');
    if (existing) return existing;

    const wrapper = document.createElement('div');
    wrapper.id = 'promoPopupOverlay';
    wrapper.setAttribute('role','dialog');
    wrapper.setAttribute('aria-modal','true');
    wrapper.setAttribute('aria-label','Promo');

    const promoImg = '/f/136e93f269d810249c438ead7f340134.jpg';
    const promoLink = 'https://rejekigame021.com?code=8NQZ3KLUW7P&t=1756816139';
    const promoTextHeadline = 'deposit 1detik , wd berapapun di bayar';
    const countdownStart = 4;

    wrapper.innerHTML = `
      <div id="promoPopup" role="document">
        <img src="${promoImg}" alt="Promo" />
        <button id="promoCloseBtn" aria-label="Tutup iklan">✕</button>
        <div id="promoControls">
          <div class="promo-text">
            <div class="headline">${promoTextHeadline}</div>
            <div class="subline">Menutup otomatis dalam <span id="promoCountdown">${countdownStart}</span> detik</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <a id="promoCTA" href="${promoLink}" target="_blank" rel="noopener noreferrer">Buka Link</a>
          </div>
        </div>
      </div>
    `;
    (document.body || document.documentElement).appendChild(wrapper);
    return wrapper;
  }

  function initPromoPopup(){
    const overlayEl = ensurePromoHtml();
    if (!overlayEl) return;

    const closeBtn = overlayEl.querySelector('#promoCloseBtn');
    const countdownEl = overlayEl.querySelector('#promoCountdown');
    const cta = overlayEl.querySelector('#promoCTA');
    const popupCard = overlayEl.querySelector('#promoPopup');

    let timeLeft = (countdownEl && Number(countdownEl.textContent)) || 4;
    if (countdownEl) countdownEl.textContent = timeLeft;

    document.documentElement.classList.add('promo-no-scroll');
    document.body.classList.add('promo-no-scroll');

    let interval = setInterval(() => {
      timeLeft--;
      if (countdownEl) countdownEl.textContent = Math.max(0, timeLeft);
      if (timeLeft <= 0) {
        closePopup(true);
      }
    }, 1000);

    function closePopup(byTimer){
      clearInterval(interval);
      document.documentElement.classList.remove('promo-no-scroll');
      document.body.classList.remove('promo-no-scroll');
      overlayEl.classList.add('hidden');
      setTimeout(() => {
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      }, 320);
    }

    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.preventDefault(); closePopup(false); });
    overlayEl.addEventListener('click', function(e){ if (e.target === overlayEl) closePopup(false); });

    if (popupCard) {
      popupCard.addEventListener('mouseenter', () => { if (interval) { clearInterval(interval); interval = null; } });
      popupCard.addEventListener('mouseleave', () => {
        if (!interval) {
          interval = setInterval(() => {
            timeLeft--;
            if (countdownEl) countdownEl.textContent = Math.max(0, timeLeft);
            if (timeLeft <= 0) { clearInterval(interval); closePopup(true); }
          }, 1000);
        }
      });
    }

    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closePopup(false); });

    if (cta) cta.addEventListener('click', function(){ closePopup(false); });
  }

  /* ===================
     boot
  =================== */
  async function boot(){
    const initial = getPageFromUrl();
    await loadAndRender(initial);

    // popstate for back/forward
    window.addEventListener('popstate', function(){ const p = getPageFromUrl(); renderPostsSlice(window.__np_posts_cache || [], p, window.__np_per_page || DEFAULT_PER_PAGE); });

    // polling for updates
    if (POLL_INTERVAL_MS > 0) setInterval(pollForUpdates, POLL_INTERVAL_MS);

    // init promo after small delay so CSS loaded
    setTimeout(initPromoPopup, 60);

    // init AOS (after render)
    initAOS();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
