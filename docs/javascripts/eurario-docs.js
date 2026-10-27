/**
 * Eurario Documentation - Client-Side Language & Theme Synchronization
 * Harmonizes with eurario.it and app.eurario.it
 */
(function() {
  'use strict';

  const LANG_KEY = 'eurario_lang';
  const currentPath = window.location.pathname;
  const isEnPage = currentPath.includes('/en/');

  // Tag document immediately with current page language
  document.documentElement.setAttribute('data-eurario-page-lang', isEnPage ? 'en' : 'it');
  document.documentElement.lang = isEnPage ? 'en' : 'it';

  // 1. Language Preference Detection
  function getSavedLanguage() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'en' || saved === 'it') return saved;
    } catch (e) {}
    const browser = (navigator.language || navigator.userLanguage || '').toLowerCase();
    return browser.startsWith('it') ? 'it' : 'en';
  }

  // 2. Automatic Routing on First Visit to Root
  function checkFirstVisitRouting() {
    try {
      const explicitChoice = localStorage.getItem(LANG_KEY);
      if (!explicitChoice) {
        const preferred = getSavedLanguage();
        if (preferred === 'en' && !isEnPage && (currentPath === '/' || currentPath === '/index.html')) {
          localStorage.setItem(LANG_KEY, 'en');
          window.location.replace('/en/');
        }
      }
    } catch (e) {}
  }

  checkFirstVisitRouting();

  // 3. Compute Equivalent Localized URL (IT <-> EN)
  function getEquivalentUrl(targetLang) {
    if (targetLang === 'en') {
      if (isEnPage) return currentPath;
      if (currentPath === '/' || currentPath === '/index.html') return '/en/';
      return '/en' + (currentPath.startsWith('/') ? currentPath : '/' + currentPath);
    } else {
      if (!isEnPage) return currentPath;
      const replaced = currentPath.replace('/en/', '/');
      return replaced === '' ? '/' : replaced;
    }
  }

  // 4. Enhance the Native Zensical Header Language Dropdown (Zero Redundancy)
  function enhanceNativeLanguageSwitcher() {
    const langLinks = document.querySelectorAll('.md-select__list .md-select__link');
    if (!langLinks || langLinks.length === 0) return;

    langLinks.forEach(function(link) {
      const hreflang = link.getAttribute('hreflang') || (link.textContent.toLowerCase().includes('english') ? 'en' : 'it');
      const targetUrl = getEquivalentUrl(hreflang);
      link.setAttribute('href', targetUrl);

      // Save preference on click
      link.addEventListener('click', function() {
        try {
          localStorage.setItem(LANG_KEY, hreflang);
        } catch (e) {}
      });
    });
  }

  // 5. Sidebar Language Isolation (Show ONLY the menu for the current language)
  function isolateSidebarLanguage() {
    const isEn = window.location.pathname.includes('/en/');
    document.documentElement.setAttribute('data-eurario-page-lang', isEn ? 'en' : 'it');
    document.documentElement.lang = isEn ? 'en' : 'it';

    const navLists = document.querySelectorAll('.md-nav--primary > .md-nav__list');
    navLists.forEach(function(navList) {
      const topItems = navList.children;
      for (let i = 0; i < topItems.length; i++) {
        const item = topItems[i];
        const text = (item.textContent || '').toLowerCase();
        const isItalianSection = text.includes('italiano') || text.includes('panoramica') || text.includes('primo accesso');
        const isEnglishSection = text.includes('english') || text.includes('general overview') || text.includes('getting started');

        if (isEn) {
          if (isItalianSection) {
            item.style.setProperty('display', 'none', 'important');
          } else if (isEnglishSection) {
            item.style.removeProperty('display');
            const toggle = item.querySelector('input[type="checkbox"].md-nav__toggle');
            if (toggle) toggle.checked = true;
            const container = item.querySelector(':scope > .md-nav__container, :scope > .md-nav__link');
            if (container) container.style.setProperty('display', 'none', 'important');
          }
        } else {
          if (isEnglishSection) {
            item.style.setProperty('display', 'none', 'important');
          } else if (isItalianSection) {
            item.style.removeProperty('display');
            const toggle = item.querySelector('input[type="checkbox"].md-nav__toggle');
            if (toggle) toggle.checked = true;
            const container = item.querySelector(':scope > .md-nav__container, :scope > .md-nav__link');
            if (container) container.style.setProperty('display', 'none', 'important');
          }
        }
      }
    });
  }

  // 6. Return to Eurario.it Header & Drawer Button
  function injectEurarioReturnButton() {
    const isEn = window.location.pathname.includes('/en/');
    const label = isEn ? '← Eurario.it' : '← Eurario.it';
    const title = isEn ? 'Return to Eurario.it main website' : 'Torna al sito principale Eurario.it';
    const drawerLabel = isEn ? '🏠 Return to Eurario.it' : '🏠 Torna al sito principale (Eurario.it)';

    // Inject into Desktop Header
    const headerInner = document.querySelector('.md-header__inner');
    if (headerInner) {
      let btn = document.getElementById('eurarioReturnBtn');
      if (!btn) {
        btn = document.createElement('a');
        btn.id = 'eurarioReturnBtn';
        btn.href = 'https://eurario.it';
        btn.className = 'eurario-return-btn';
        const titleEl = headerInner.querySelector('.md-header__title');
        if (titleEl && titleEl.nextSibling) {
          headerInner.insertBefore(btn, titleEl.nextSibling);
        } else {
          headerInner.appendChild(btn);
        }
      }
      btn.textContent = label;
      btn.title = title;
      btn.setAttribute('aria-label', title);
    }

    // Inject into Mobile Drawer Navigation
    const drawerNav = document.querySelector('.md-nav--primary');
    if (drawerNav) {
      let drawerBtn = document.getElementById('eurarioDrawerReturnBtn');
      if (!drawerBtn) {
        drawerBtn = document.createElement('a');
        drawerBtn.id = 'eurarioDrawerReturnBtn';
        drawerBtn.href = 'https://eurario.it';
        drawerBtn.className = 'eurario-drawer-return-btn';
        const drawerTitle = drawerNav.querySelector('.md-nav__title');
        if (drawerTitle && drawerTitle.nextSibling) {
          drawerNav.insertBefore(drawerBtn, drawerTitle.nextSibling);
        } else {
          drawerNav.prepend(drawerBtn);
        }
      }
      drawerBtn.textContent = drawerLabel;
      drawerBtn.title = title;
    }
  }

  function initDocsEnhancements() {
    enhanceNativeLanguageSwitcher();
    isolateSidebarLanguage();
    injectEurarioReturnButton();
  }

  // Run on load and after instant navigation updates
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDocsEnhancements);
  } else {
    initDocsEnhancements();
  }

  if (typeof document$ !== 'undefined' && document$.subscribe) {
    document$.subscribe(initDocsEnhancements);
  }
})();
