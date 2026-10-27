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

  function initDocsEnhancements() {
    enhanceNativeLanguageSwitcher();
    isolateSidebarLanguage();
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
