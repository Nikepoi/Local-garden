(function(){
  if (window.__ads_installed) return;
  window.__ads_installed = true;

  var adUnits = [
    { id: 'ad1', key: '40d8368825e0ef133773da2f9ba8f05d', w:728, h:90,  mW:320, mH:50, position:'above', type:'invoke' },
    { id: 'ad2', key: 'b0e6ed2fe994b4154eb5c77bb3ecff1b', w:728, h:90,  mW:320, mH:50, position:'above', type:'invoke' },
    { id: 'ad3', key: 'b66cf8fe4e67d9eab24b72883533f95a', w:728, h:90,  mW:320, mH:50, position:'above', type:'invoke' },
    { id: 'ad4', key: 'fbdcf5e0b5a35a8750b2021a43b3fee2', w:728, h:90,  mW:320, mH:50, position:'below', type:'invoke' }
  ];

  function isMobile(){ return window.innerWidth <= 480; }
  function playerEl(){ return document.getElementById('playerWrap'); }

  function getContainer(name, pos){
    var sel = '.ads-container.' + name;
    var existing = document.querySelector(sel);
    if (existing) return existing;
    var c = document.createElement('div');
    c.className = 'ads-container ' + name;
    c.style.width = '100%';
    c.style.display = 'block';
    c.style.boxSizing = 'border-box';
    var p = playerEl();
    if (p && p.parentNode){
      if (pos === 'above') p.parentNode.insertBefore(c, p);
      else {
        if (p.nextSibling) p.parentNode.insertBefore(c, p.nextSibling);
        else p.parentNode.appendChild(c);
      }
    } else {
      document.body.appendChild(c);
    }
    return c;
  }

  function buildInvokeSrcdoc(key, width, height){
    var opts = { key: key, format: 'iframe', width: width, height: height, params: {} };
    var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"/>' +
               '<style>html,body{margin:0;padding:0;background:transparent}</style></head><body>' +
               '<script>window.atOptions=' + JSON.stringify(opts) + '<\/script>' +
               '<script src=\"//serenitymareaffection.com/' + key + '/invoke.js\"><\/script>' +
               '</body></html>';
    return html;
  }

  function alreadyExists(keyOrId){
    if(!keyOrId) return false;
    return !!document.querySelector('[data-ad-key="' + keyOrId + '"]') ||
           !!document.querySelector('[data-ad-inner="' + keyOrId + '"]') ||
           !!document.querySelector('iframe[data-ad-inner="' + keyOrId + '"]');
  }

  function createIframe(unit, sizes){
    var iframe = document.createElement('iframe');
    iframe.setAttribute('data-ad-inner', unit.key || unit.id || '');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    iframe.style.display = 'block';
    iframe.style.width = sizes.w + 'px';
    iframe.style.height = sizes.h + 'px';
    iframe.style.border = '0';
    iframe.style.background = 'transparent';
    iframe.style.transformOrigin = '0 0';
    iframe.style.position = 'relative';
    iframe.srcdoc = buildInvokeSrcdoc(unit.key, sizes.w, sizes.h);
    return iframe;
  }

  function adjustScale(container, iframe, sizes){
    try{
      var containerWidth = Math.min(container.clientWidth || document.documentElement.clientWidth || window.innerWidth, window.innerWidth);
      var scale = 1;
      if (sizes.w > containerWidth) scale = containerWidth / sizes.w;
      iframe.style.transform = 'scale(' + scale + ')';
      container.style.height = (sizes.h * scale) + 'px';
      container.style.maxWidth = isMobile() ? ( (sizes.w <= 320) ? sizes.w + 'px' : '320px') : (sizes.w + 'px');
    }catch(e){}
  }

  function placeUnit(unit){
    var lookup = unit.key || unit.id;
    if (alreadyExists(lookup)) return;

    var sizes = isMobile() ? { w: unit.mW || unit.w, h: unit.mH || unit.h } : { w: unit.w, h: unit.h };
    sizes.w = sizes.w || 728; sizes.h = sizes.h || 90;

    var aboveContainer = getContainer('ads-above','above');
    var belowContainer = getContainer('ads-below','below');

    var aboveCount = aboveContainer.querySelectorAll('.adsterra-ad-wrap').length;
    var target = (unit.position === 'above' && aboveCount < 3) ? aboveContainer : belowContainer;

    var wrap = document.createElement('div');
    wrap.className = 'adsterra-ad-wrap';
    wrap.setAttribute('data-ad-key', lookup);
    wrap.style.boxSizing = 'border-box';
    wrap.style.overflow = 'hidden';
    wrap.style.margin = '10px auto';
    wrap.style.textAlign = 'left';
    wrap.style.maxWidth = isMobile() ? '320px' : '728px';

    var iframe = createIframe(unit, sizes);
    wrap.appendChild(iframe);
    target.appendChild(wrap);

    setTimeout(function(){ adjustScale(wrap, iframe, sizes); }, 180);
  }

  function ensureContainersNearPlayer(){
    var p = playerEl();
    if (!p) return;
    var above = document.querySelector('.ads-container.ads-above');
    var below = document.querySelector('.ads-container.ads-below');
    if (above && above.parentNode !== p.parentNode){
      p.parentNode.insertBefore(above, p);
    }
    if (below && below.parentNode !== p.parentNode){
      if (p.nextSibling) p.parentNode.insertBefore(below, p.nextSibling);
      else p.parentNode.appendChild(below);
    }
  }

  function initAll(){
    adUnits.forEach(function(u){ placeUnit(u); });
    ensureContainersNearPlayer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  var mo = new MutationObserver(function(){ ensureContainersNearPlayer(); });
  mo.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('resize', function(){
    var wrappers = document.querySelectorAll('.adsterra-ad-wrap');
    wrappers.forEach(function(wrap){
      var iframe = wrap.querySelector('iframe[data-ad-inner]');
      if (!iframe) return;
      var key = iframe.getAttribute('data-ad-inner');
      var unit = adUnits.find(function(a){ return a.key === key || a.id === key; });
      if (!unit) return;
      var sizes = isMobile() ? { w: unit.mW || unit.w, h: unit.mH || unit.h } : { w: unit.w, h: unit.h };
      adjustScale(wrap, iframe, sizes);
    });
  });
})();
