/* Adds the js class before first paint, then wires reveals, the rail and the traverse line. */
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init() {
    var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-shown'); io.unobserve(e.target); }
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
      reveals.forEach(function (el) { io.observe(el); });
    } else {
      reveals.forEach(function (el) { el.classList.add('is-shown'); });
    }

    var sections = Array.prototype.slice.call(document.querySelectorAll('section[id]'));
    var links = Array.prototype.slice.call(document.querySelectorAll('.rail-link'));
    function setActive(id) {
      links.forEach(function (l) {
        var on = l.getAttribute('href') === '#' + id;
        l.classList.toggle('is-active', on);
        if (on) { l.setAttribute('aria-current', 'true'); } else { l.removeAttribute('aria-current'); }
      });
    }
    if ('IntersectionObserver' in window) {
      var so = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { setActive(e.target.id); } });
      }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
      sections.forEach(function (s) { so.observe(s); });
    }

    var bar = document.querySelector('.traverse-bar');
    var ticking = false;
    function progress() {
      var max = root.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (bar) { bar.style.transform = 'scaleX(' + p.toFixed(4) + ')'; }
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(progress); }
    }, { passive: true });
    window.addEventListener('resize', progress);
    progress();
    if (reduced) { root.setAttribute('data-motion', 'reduced'); }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
