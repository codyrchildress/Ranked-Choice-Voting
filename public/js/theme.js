// Day/night mode. Loaded synchronously in <head> (plain script, CSP-safe) so
// the right theme lands before first paint. The visitor's choice persists;
// until they pick, the system preference decides — and keeps deciding if it
// changes.
(function () {
  var KEY = 'runoff.theme';
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#191512' : '#f6f1e7');
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀' : '☾';
      var label = theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  }

  apply(stored() ?? (media.matches ? 'dark' : 'light'));

  media.addEventListener('change', function () {
    if (!stored()) apply(media.matches ? 'dark' : 'light');
  });

  document.addEventListener('DOMContentLoaded', function () {
    apply(document.documentElement.dataset.theme);
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // private mode: the switch still works for this page view
      }
      apply(next);
    });
  });
})();
