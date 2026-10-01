(function() {
  'use strict';

  if (window.__JqrgContentGateLoaded) return;
  window.__JqrgContentGateLoaded = true;

  function isAuthed() {
    if (window.JqrgCloud && typeof window.JqrgCloud.isLoggedIn === 'function') {
      try { return !!window.JqrgCloud.isLoggedIn(); } catch (e) {}
    }
    return false;
  }

  window.__jqrgIsAuthed = isAuthed;

  if (document.documentElement) {
    document.documentElement.setAttribute('data-authed', isAuthed() ? '1' : '0');
  }

  function injectAuthRequired() {
    var templates = document.querySelectorAll('template[data-auth-required]');
    for (var i = 0; i < templates.length; i++) {
      var t = templates[i];
      if (t.dataset.injected === '1') continue;
      var clone = t.content.cloneNode(true);
      var children = Array.prototype.slice.call(clone.children);
      var marker = t.dataset.authRequired || ('mark-' + i);
      for (var j = 0; j < children.length; j++) {
        if (children[j].setAttribute) {
          children[j].setAttribute('data-auth-injected', marker);
        }
      }
      t.parentNode.insertBefore(clone, t.nextSibling);
      t.dataset.injected = '1';
    }
  }

  function removeAuthRequired() {
    var injected = document.querySelectorAll('[data-auth-injected]');
    for (var i = 0; i < injected.length; i++) {
      try { injected[i].remove(); } catch (e) {}
    }
    var templates = document.querySelectorAll('template[data-auth-required]');
    for (var k = 0; k < templates.length; k++) {
      delete templates[k].dataset.injected;
    }
  }

  function applyGate() {
    var authed = isAuthed();
    document.documentElement.setAttribute('data-authed', authed ? '1' : '0');
    if (authed) {
      injectAuthRequired();
    } else {
      removeAuthRequired();
    }
    return authed;
  }

  function refreshShell() {
    try { if (typeof window.renderHome === 'function') window.renderHome(); } catch (e) {}
    try { if (typeof window._rG === 'function') window._rG(); } catch (e) {}
    try { if (typeof window._rA === 'function') window._rA(); } catch (e) {}
    try { if (typeof window._rU === 'function') window._rU(); } catch (e) {}
  }

  function init() {
    applyGate();

    var tries = 0;
    var maxTries = 60;
    function hookAuthChange() {
      if (window.JqrgCloud && typeof window.JqrgCloud.onAuthChange === 'function') {
        try {
          window.JqrgCloud.onAuthChange(function() {
            applyGate();
            refreshShell();
          });
        } catch (e) {}
        return;
      }
      if (tries++ < maxTries) setTimeout(hookAuthChange, 100);
    }
    hookAuthChange();
  }

  window.__jqrgApplyAuthGate = applyGate;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
