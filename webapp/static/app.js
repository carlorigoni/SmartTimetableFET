/**
 * Eurario - Single Page Application Controller (Vanilla JS)
 * Gestisce la navigazione, le chiamate API REST, le griglie interattive e il monitoraggio di FET CLI.
 */

let currentView = 'dashboard';
let stateData = {
  summary: null,
  teachers: [],
  classes: [],
  groups: [],
  subjects: [],
  rooms: [],
  buildings: [],
  activities: [],
  groupedActivities: [],
  availability: null,
  timetableViews: null
};

let pollSolverTimer = null;
let currentSolverRunning = false;

// --- VERSIONE E IDENTITÀ APPLICATIVA ---
let APP_VERSION = '1.9.23';

// --- OPTIMISTIC CONCURRENCY CONTROL (OCC) & FETCH INTERCEPTOR ---
window.CURRENT_DATA_VERSION = null;
window.LAST_MODIFIED_BY = null;

function updateLocalDataVersion(ver, modifiedBy) {
  if (ver !== undefined && ver !== null) {
    const num = parseInt(ver, 10);
    if (!isNaN(num)) {
      window.CURRENT_DATA_VERSION = Math.max(window.CURRENT_DATA_VERSION || 0, num);
    }
  }
  if (modifiedBy) {
    window.LAST_MODIFIED_BY = modifiedBy;
  }
}

function showConcurrencyConflictModal(errData) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const author = errData?.last_modified_by || (isEn ? 'another user' : 'un collega');
  const modalHtml = `
    <div id="concurrencyConflictModal" class="modal-backdrop" style="display:flex;z-index:99999;" role="dialog" aria-modal="true">
      <div class="modal-dialog" style="max-width:540px;border-top:4px solid #f59e0b;">
        <div class="modal-header">
          <div class="modal-title" style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:24px;">⚠️</span>
            <div>
              <div style="font-size:16px;font-weight:700;color:var(--text-main);">${isEn ? 'Concurrent Modification Detected' : 'Modifica Concorrente Rilevata'}</div>
              <div style="font-size:11.5px;color:var(--text-muted);">${isEn ? 'Data protection & collision safeguard' : 'Protezione dati e salvaguardia modifiche'}</div>
            </div>
          </div>
        </div>
        <div class="modal-body" style="line-height:1.6;font-size:13px;color:var(--text-main);">
          <div class="modal-notice" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:12px 14px;border-radius:6px;margin-bottom:12px;">
            ${isEn
              ? `<b>Warning:</b> Another timetable commissioner (<b>${escapeHtml(author)}</b>) has saved changes to this school's timetable while you were working on this view.`
              : `<b>Attenzione:</b> Un altro utente della commissione orario (<b>${escapeHtml(author)}</b>) ha modificato e salvato i dati di questo istituto mentre stavi lavorando su questa schermata.`}
          </div>
          <p>
            ${isEn
              ? 'To prevent accidental overwrites and keep the schedule completely consistent, please reload the page now to review the latest changes before reapplying your edits.'
              : 'Per prevenire sovrascritture accidentali o perdite di lavoro del collega, ricarica la pagina per acquisire le modifiche più recenti prima di effettuare ulteriori salvataggi.'}
          </p>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;">
          <button class="btn btn-primary" onclick="window.location.reload()">
            🔄 ${isEn ? 'Reload Page Now' : 'Ricarica la Pagina Ora'}
          </button>
        </div>
      </div>
    </div>
  `;
  const existing = document.getElementById('concurrencyConflictModal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function showSolverAlreadyRunningModal(errData) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const starter = errData?.started_by || (isEn ? 'another commissioner' : 'un altro commissario orario');
  showToast(
    isEn 
      ? `FET computation already in progress (started by ${starter}). Connecting to live stream...` 
      : `Calcolo FET già in corso per questo istituto (avviato da ${starter}). Connessione al monitor in tempo reale...`,
    'warn'
  );
  if (typeof startPollingSolver === 'function') {
    startPollingSolver();
  }
}

const _nativeFetch = window.fetch;
window.fetch = async function(resource, init = {}) {
  const url = typeof resource === 'string' ? resource : (resource?.url || '');
  const method = (init?.method || 'GET').toUpperCase();

  // Invia X-School-Id e X-Base-Version per le chiamate API
  if (url.includes('/api/')) {
    init = init || {};
    init.headers = init.headers || {};
    
    // Iniezione scuola attiva: localStorage è la fonte di verità prioritizzazione utente
    let activeSid = null;
    try {
      activeSid = localStorage.getItem('eurario_active_school') || (currentSchool && currentSchool.id);
    } catch (e) {
      activeSid = (currentSchool && currentSchool.id);
    }

    const isNonDataEndpoint = url.includes('/api/schools/') || url.includes('/api/auth/') || url.includes('/api/version/');

    if (init.headers instanceof Headers) {
      if (!isNonDataEndpoint && method !== 'GET' && window.CURRENT_DATA_VERSION !== null && !init.headers.has('X-Base-Version')) {
        init.headers.set('X-Base-Version', String(window.CURRENT_DATA_VERSION));
      }
      if (activeSid && !init.headers.has('X-School-Id')) {
        init.headers.set('X-School-Id', activeSid);
      }
    } else if (Array.isArray(init.headers)) {
      if (!isNonDataEndpoint && method !== 'GET' && window.CURRENT_DATA_VERSION !== null) {
        init.headers.push(['X-Base-Version', String(window.CURRENT_DATA_VERSION)]);
      }
      if (activeSid) {
        init.headers.push(['X-School-Id', activeSid]);
      }
    } else {
      if (!isNonDataEndpoint && method !== 'GET' && window.CURRENT_DATA_VERSION !== null && !init.headers['X-Base-Version']) {
        init.headers['X-Base-Version'] = String(window.CURRENT_DATA_VERSION);
      }
      if (activeSid && !init.headers['X-School-Id']) {
        init.headers['X-School-Id'] = activeSid;
      }
    }
  }

  const response = await _nativeFetch(resource, init);

  const xDataVer = response.headers.get('x-data-version') || response.headers.get('X-Data-Version');
  if (xDataVer) {
    updateLocalDataVersion(xDataVer);
  }

  if (response.status === 409) {
    try {
      const cloned = response.clone();
      const errData = await cloned.json();
      if (errData && errData.error === 'concurrent_modification_conflict') {
        const myEmail = (currentUser && currentUser.email ? currentUser.email : '').trim().toLowerCase();
        const author = (errData.last_modified_by || '').trim().toLowerCase();
        const isMe = !!(myEmail && author && myEmail === author);
        if (!isMe) {
          showConcurrencyConflictModal(errData);
        } else if (errData.server_version) {
          updateLocalDataVersion(errData.server_version, errData.last_modified_by);
        }
      } else if (errData && errData.error === 'solver_already_running') {
        showSolverAlreadyRunningModal(errData);
      }
    } catch (e) {}
  }

  return response;
};

// Heartbeat di controllo modifiche concorrenti in background
async function checkConcurrentUpdatesHeartbeat() {
  if (!currentUser || window.CURRENT_DATA_VERSION === null) return;
  try {
    const res = await _nativeFetch('/api/summary');
    if (res.ok) {
      const summary = await res.json();
      if (summary && summary.data_version) {
        const myEmail = (currentUser && currentUser.email ? currentUser.email : '').trim().toLowerCase();
        const author = (summary.last_modified_by || '').trim().toLowerCase();
        const isMe = !!(myEmail && author && myEmail === author);
        if (isMe) {
          updateLocalDataVersion(summary.data_version, summary.last_modified_by);
        } else if (window.CURRENT_DATA_VERSION && summary.data_version > window.CURRENT_DATA_VERSION) {
          showConcurrentUpdatesPill(summary.data_version, summary.last_modified_by);
        }
      }
    }
  } catch (e) {}
}

function showConcurrentUpdatesPill(newVer, author) {
  let pill = document.getElementById('concurrentUpdateNoticePill');
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const who = author || (isEn ? 'A colleague' : 'Un collega');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'concurrentUpdateNoticePill';
    pill.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1e293b;color:#f8fafc;padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3);z-index:99998;display:flex;align-items:center;gap:12px;font-size:12.5px;border-left:4px solid #3b82f6;animation:fadeIn 0.3s ease;';
    document.body.appendChild(pill);
  }
  pill.innerHTML = `
    <span>🔔 <b>${escapeHtml(who)}</b> ${isEn ? 'has just updated school data.' : 'ha appena aggiornato i dati.'}</span>
    <button class="btn btn-sm btn-primary" onclick="window.location.reload()" style="font-size:11px;padding:3px 10px;">
      🔄 ${isEn ? 'Sync' : 'Sincronizza'}
    </button>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;padding:0 4px;">✕</button>
  `;
}

setInterval(checkConcurrentUpdatesHeartbeat, 25000);

// Dizionario completo di traduzione materie scolastiche Italiano -> Inglese
const SUBJECT_TRANSLATIONS_JS = {
  'discipline letterarie istituti ii grado': 'Literature & History',
  'discipline letterarie': 'Literature & History',
  'disegno storia arte istituto ii grado': 'Drawing & Art History',
  'disegno e storia dell\'arte': 'Drawing & Art History',
  'disegno storia dell\'arte': 'Drawing & Art History',
  'italiano latino storia e geografia': 'Italian, Latin, History & Geo',
  'italiano storia e geografia': 'Italian, History & Geography',
  'italiano e latino': 'Italian & Latin',
  'lingua e letteratura italiana': 'Italian Language & Literature',
  'lingua e cultura straniera (inglese)': 'English Language & Culture',
  'lingua e cultura straniera (francese)': 'French Language & Culture',
  'lingua e cultura straniera (spagnolo)': 'Spanish Language & Culture',
  'lingua e cultura straniera (tedesco)': 'German Language & Culture',
  'scienze economiche - aziendali': 'Business Economics',
  'scienze economiche aziendali': 'Business Economics',
  'scienze matematiche applicate': 'Applied Mathematics',
  'scienze motorie e sportive ii grado': 'Physical Education & Sports',
  'scienze motorie e sportive': 'Physical Education & Sports',
  'scienze motorie': 'Physical Education',
  'scienze naturali, chimica e biologia': 'Natural Sciences, Chemistry & Biology',
  'scienze naturali chimica e biologia': 'Natural Sciences, Chemistry & Biology',
  'scienze della terra e biologia': 'Earth Sciences & Biology',
  'scienze e tecnologie informatiche': 'Computer Science & Technologies',
  'diritto e relazioni internazionali': 'Law & Int. Relations',
  'diritto ed economia politica': 'Law & Political Economy',
  'diritto ed economia': 'Law & Economics',
  'filosofia e scienze umane': 'Philosophy & Human Sciences',
  'filosofia e storia': 'Philosophy & History',
  'storia e filosofia': 'History & Philosophy',
  'storia e geografia': 'History & Geography',
  'matematica e fisica': 'Mathematics & Physics',
  'discipline sanitarie': 'Health Sciences',
  'legislazione sanitaria': 'Health Legislation',
  'metodologie operative': 'Operational Methodologies',
  'tecniche amministrative': 'Administrative Techniques',
  'tecniche amministrative ed economia aziendale': 'Business Economics & Admin',

  // Materie Canoniche Singole
  'italiano': 'Italian',
  'latino': 'Latin',
  'greco': 'Ancient Greek',
  'storia': 'History',
  'geografia': 'Geography',
  'geostoria': 'Geo-History',
  'filosofia': 'Philosophy',
  'scienze umane': 'Human Sciences',
  'pedagogia': 'Pedagogy',
  'psicologia': 'Psychology',
  'antropologia': 'Anthropology',
  'sociologia': 'Sociology',

  // Lingue Straniere
  'inglese': 'English',
  'lingua inglese': 'English Language',
  'lingua e cultura inglese': 'English Language & Culture',
  'francese': 'French',
  'lingua francese': 'French Language',
  'lingua e cultura francese': 'French Language & Culture',
  'spagnolo': 'Spanish',
  'lingua spagnola': 'Spanish Language',
  'lingua e cultura spagnola': 'Spanish Language & Culture',
  'tedesco': 'German',
  'lingua tedesca': 'German Language',
  'lingua e cultura tedesca': 'German Language & Culture',
  'russo': 'Russian',
  'cinese': 'Chinese',
  'conversazione': 'Language Conversation',
  'conversazione in lingua straniera': 'Foreign Language Conversation',

  // Matematica, Fisica e Informatica
  'matematica': 'Mathematics',
  'fisica': 'Physics',
  'informatica': 'Computer Science',
  'tecnologie informatiche': 'Information Technologies',
  'scienze e tecnologie applicate': 'Applied Science & Tech',
  'tecnologie e tecniche di rappresentazione grafica': 'Graphic Representation Tech',
  'disegno tecnico': 'Technical Drawing',
  'disegno': 'Drawing',
  'storia dell\'arte': 'Art History',
  'arte e immagine': 'Art & Image',

  // Scienze Naturali, Chimica, Biologia
  'scienze': 'Sciences',
  'scienze naturali': 'Natural Sciences',
  'scienze della terra': 'Earth Sciences',
  'biologia': 'Biology',
  'chimica': 'Chemistry',
  'scienze integrate': 'Integrated Sciences',
  'scienze integrate (chimica)': 'Integrated Sciences (Chemistry)',
  'scienze integrate (fisica)': 'Integrated Sciences (Physics)',
  'scienze integrate (scienze della terra e biologia)': 'Integrated Sciences (Earth & Bio)',
  'microbiologia': 'Microbiology',
  'igiene': 'Hygiene & Health',

  // Giuridico-Economiche
  'diritto': 'Law',
  'economia politica': 'Political Economy',
  'economia aziendale': 'Business Economics',
  'relazioni internazionali': 'International Relations',
  'scienze economico-aziendali': 'Business Economics',
  'finanza': 'Public Finance',

  // Scienze Motorie e Religione
  'educazione fisica': 'Physical Education',
  'religione': 'Religion',
  'religione cattolica': 'Catholic Religion',
  'irc': 'Catholic Religious Education',
  'materia alternativa': 'Alternative Activity',
  'attività alternativa': 'Alternative Activity',
  'studio assistito': 'Supervised Study',

  // Discipline Tecniche e Professionali
  'meccanica': 'Mechanics',
  'meccanica e macchine': 'Mechanics & Machines',
  'robotica': 'Robotics',
  'elettronica': 'Electronics',
  'elettronica ed elettrotecnica': 'Electronics & Electrical Eng.',
  'elettrotecnica': 'Electrical Engineering',
  'telecomunicazioni': 'Telecommunications',
  'sistemi e reti': 'Systems & Networks',
  'tecnologie chimiche': 'Chemical Technologies',
  'biotecnologie': 'Biotechnology',
  'costruzioni ambiente e territorio': 'Construction & Environment',
  'topografia': 'Topography',

  // Disposizioni e Attività Istituzionali
  'disposizione': 'On-Duty / Available',
  'disposizioni': 'On-Duty / Available',
  'potenziamento': 'Enhancement / Support',
  'ricevimento': 'Office Hours',
  'coordinamento': 'Class Coordination',
  'supplenza': 'Substitute Duty'
};

function translateSubjectJs(subj, isEn = true) {
  if (!subj || !isEn) return subj || '';
  const s = String(subj).trim();
  const low = s.toLowerCase();
  if (SUBJECT_TRANSLATIONS_JS[low]) return SUBJECT_TRANSLATIONS_JS[low];
  const keysSorted = Object.keys(SUBJECT_TRANSLATIONS_JS).sort((a, b) => b.length - a.length);
  for (const itK of keysSorted) {
    if (low === itK || low.startsWith(itK + ' ') || low.includes(' ' + itK) || low.includes(itK)) {
      return SUBJECT_TRANSLATIONS_JS[itK];
    }
  }
  return s;
}

// Helper traduzione i18n universale
function _t(key, fallback = '') {
  if (window.I18N && typeof window.I18N.t === 'function') {
    const val = window.I18N.t(key);
    if (val && val !== key) return val;
  }
  return fallback || key;
}
const FET_VERSION = '7.12.0';
const APP_AUTHOR = 'Carlo Rigoni';

// --- GESTIONE INTERNAZIONALIZZAZIONE (i18n) & TEMI (DARK/LIGHT/AUTO) ---
function toggleLangMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('langMenuPopup');
  const themeMenu = document.getElementById('themeMenuPopup');
  const schoolMenu = document.getElementById('schoolMenuPopup');
  if (themeMenu) themeMenu.style.display = 'none';
  if (schoolMenu) schoolMenu.style.display = 'none';
  if (!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

function setAppLanguage(lang) {
  if (window.I18N) {
    window.I18N.setLanguage(lang, (newLang) => {
      const menu = document.getElementById('langMenuPopup');
      if (menu) menu.style.display = 'none';
      if (document.getElementById('pageTitle') && currentView) {
        document.getElementById('pageTitle').innerText = window.I18N.t('nav.' + currentView + '_title', document.getElementById('pageTitle').innerText);
      }
      navigate(currentView, false);
      showToast(newLang === 'en' ? 'Language switched to English' : 'Lingua impostata su Italiano');
    });
  }
}

function toggleThemeMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('themeMenuPopup');
  const langMenu = document.getElementById('langMenuPopup');
  const schoolMenu = document.getElementById('schoolMenuPopup');
  if (langMenu) langMenu.style.display = 'none';
  if (schoolMenu) schoolMenu.style.display = 'none';
  if (!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

function setAppTheme(theme) {
  if (window.I18N) {
    window.I18N.applyTheme(theme, true);
    const menu = document.getElementById('themeMenuPopup');
    if (menu) menu.style.display = 'none';
    const msg = theme === 'auto' ? window.I18N.t('theme.auto') : (theme === 'dark' ? window.I18N.t('theme.dark') : window.I18N.t('theme.light'));
    showToast(msg);
  }
}

document.addEventListener('click', (e) => {
  const langDropdown = document.getElementById('langSelectorDropdown');
  const themeDropdown = document.getElementById('themeSelectorDropdown');
  const schoolDropdown = document.getElementById('schoolSelectorDropdown');
  const globalFilterDropdown = document.getElementById('globalSubjectFilterDropdown');

  if (langDropdown && !langDropdown.contains(e.target)) {
    const m = document.getElementById('langMenuPopup');
    if (m) m.style.display = 'none';
  }
  if (themeDropdown && !themeDropdown.contains(e.target)) {
    const m = document.getElementById('themeMenuPopup');
    if (m) m.style.display = 'none';
  }
  if (schoolDropdown && !schoolDropdown.contains(e.target)) {
    const m = document.getElementById('schoolMenuPopup');
    if (m) m.style.display = 'none';
  }
  if (globalFilterDropdown && !globalFilterDropdown.contains(e.target)) {
    const m = document.getElementById('globalSubjectFilterPopup');
    if (m) m.style.display = 'none';
  }
});

// ============================================================================
// FILTRO GLOBALE PER MATERIA (TESTATA PERSISTENTE PER TUTTE LE MASCHERE)
// ============================================================================
window.GLOBAL_SUBJECT_FILTER = localStorage.getItem('eurario_global_subject_filter') || '';

function initGlobalSubjectFilter() {
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  const btn = document.getElementById('btnGlobalFilterToggle');
  const textEl = document.getElementById('globalFilterText');
  const clearBtn = document.getElementById('globalFilterClearBtn');
  if (!textEl) return;

  const currentFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim();
  if (currentFlt) {
    textEl.innerText = currentFlt;
    textEl.title = (isEn ? 'Global filter active: ' : 'Filtro globale attivo: ') + currentFlt;
    if (clearBtn) clearBtn.style.display = 'inline-flex';
    if (btn) btn.classList.add('is-active');
  } else {
    textEl.innerText = _t('filter.all_subjects', isEn ? 'All Subjects' : 'Tutte le Materie');
    textEl.title = isEn ? 'Global subject filter (applies across all screens)' : 'Filtro globale per materia (valido per tutte le schermate)';
    if (clearBtn) clearBtn.style.display = 'none';
    if (btn) btn.classList.remove('is-active');
  }
}

function toggleGlobalSubjectFilterMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('globalSubjectFilterPopup');
  const schoolMenu = document.getElementById('schoolMenuPopup');
  const langMenu = document.getElementById('langMenuPopup');
  const themeMenu = document.getElementById('themeMenuPopup');
  if (schoolMenu) schoolMenu.style.display = 'none';
  if (langMenu) langMenu.style.display = 'none';
  if (themeMenu) themeMenu.style.display = 'none';
  if (!menu) return;
  const isOpening = menu.style.display === 'none';
  menu.style.display = isOpening ? 'flex' : 'none';
  if (isOpening) {
    populateGlobalSubjectFilterMenu();
    setTimeout(() => {
      const inp = document.getElementById('globalFilterSearchInput');
      if (inp) { inp.value = ''; inp.focus(); }
    }, 50);
  }
}

async function populateGlobalSubjectFilterMenu() {
  const listEl = document.getElementById('globalSubjectFilterList');
  if (!listEl) return;
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';

  let subjects = stateData.subjects;
  if (!subjects || !subjects.length) {
    try {
      const res = await fetch('/api/subjects');
      subjects = await res.json();
      stateData.subjects = subjects;
    } catch (e) {
      subjects = [];
    }
  }

  const sortedSubjs = [...(subjects || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const currentFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim().toLowerCase();

  listEl.innerHTML = sortedSubjs.map(s => {
    const isSelected = currentFlt && s.name.toLowerCase() === currentFlt;
    return `
      <button type="button" class="topbar-popup-item global-filter-item" onclick="selectGlobalSubjectFilter('${escapeJs(s.name)}')">
        <span>📖</span>
        <span style="font-weight:${isSelected ? '700' : '500'};flex:1;text-align:left;">${escapeHtml(s.name)}${s.cdc ? ` <small style="color:var(--text-muted);font-size:11px;">[${escapeHtml(s.cdc)}]</small>` : ''}</span>
        ${isSelected ? `<span class="popup-check" style="color:var(--primary);font-weight:700;">✓</span>` : ''}
      </button>
    `;
  }).join('');
}

function filterGlobalSubjectList(query) {
  const q = (query || '').toLowerCase().trim();
  const items = document.querySelectorAll('#globalSubjectFilterList .global-filter-item');
  items.forEach(it => {
    const txt = it.innerText.toLowerCase();
    it.style.display = txt.includes(q) ? 'flex' : 'none';
  });
}

function selectGlobalSubjectFilter(subjectName) {
  const m = document.getElementById('globalSubjectFilterPopup');
  if (m) m.style.display = 'none';

  window.GLOBAL_SUBJECT_FILTER = (subjectName || '').trim();
  localStorage.setItem('eurario_global_subject_filter', window.GLOBAL_SUBJECT_FILTER);
  initGlobalSubjectFilter();

  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  if (window.GLOBAL_SUBJECT_FILTER) {
    showToast(isEn ? `Global filter set: ${window.GLOBAL_SUBJECT_FILTER}` : `Filtro globale impostato: ${window.GLOBAL_SUBJECT_FILTER}`, 'ok');
  } else {
    showToast(isEn ? 'Global filter cleared: showing all subjects.' : 'Filtro globale rimosso: mostrate tutte le materie.', 'info');
  }

  refreshCurrentViewWithGlobalFilter();
}

function clearGlobalSubjectFilter(event) {
  if (event) event.stopPropagation();
  selectGlobalSubjectFilter('');
}

function getGlobalFilterBannerHtml() {
  const currentFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim();
  if (!currentFlt) return '';
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  return `
    <div class="global-filter-active-banner" role="status">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">🎯</span>
        <span>
          ${isEn 
            ? `Global filter active: <b>${escapeHtml(currentFlt)}</b>. Showing only linked teachers, classes, assignments, and rules.`
            : `Filtro globale attivo: <b>${escapeHtml(currentFlt)}</b>. Visualizzazione limitata a docenti, classi, cattedre e regole collegate.`}
        </span>
      </div>
      <button type="button" onclick="clearGlobalSubjectFilter(event)" title="${isEn ? 'Remove global filter' : 'Rimuovi filtro globale'}">
        ✕ ${isEn ? 'Remove Filter' : 'Rimuovi Filtro'}
      </button>
    </div>
  `;
}

function getTeachersForGlobalSubject(subjectName) {
  if (!subjectName) return [];
  const sLow = subjectName.toLowerCase();
  const teachersSet = new Set();
  (stateData.activities || []).forEach(a => {
    if ((a.subject || '').toLowerCase() === sLow) {
      (a.teachers || []).forEach(t => teachersSet.add(t));
    }
    if (a.teacher_subjects) {
      for (const [t, s] of Object.entries(a.teacher_subjects)) {
        if (s.toLowerCase() === sLow) teachersSet.add(t);
      }
    }
  });
  (stateData.groupedActivities || []).forEach(g => {
    if ((g.subject || '').toLowerCase() === sLow) {
      (g.teachers || []).forEach(t => teachersSet.add(t));
    }
    if (g.teacher_subjects) {
      for (const [t, s] of Object.entries(g.teacher_subjects)) {
        if (s.toLowerCase() === sLow) teachersSet.add(t);
      }
    }
  });
  const subjObj = (stateData.subjects || []).find(s => s.name.toLowerCase() === sLow);
  const subjCdc = subjObj ? (subjObj.cdc || '') : '';
  (stateData.teachers || []).forEach(t => {
    if (t.cdc && subjCdc && t.cdc.split(/[,;\s]+/).some(c => c && subjCdc.includes(c))) {
      teachersSet.add(t.name);
    }
    if (Array.isArray(t.subjects) && t.subjects.some(s => s.toLowerCase() === sLow)) {
      teachersSet.add(t.name);
    }
  });
  return Array.from(teachersSet);
}

function refreshCurrentViewWithGlobalFilter() {
  if (typeof currentView === 'undefined') return;
  if (currentView === 'activities') renderActivities();
  else if (currentView === 'teachers') renderTeachers();
  else if (currentView === 'timetable') renderTimetable();
  else if (currentView === 'subjects') renderSubjects();
  else if (currentView === 'block_rules') renderBlockRulesView();
  else if (currentView === 'accorpamenti') renderAccorpamenti();
  else if (currentView === 'availability') renderAvailability();
}

// ============================================================================
// CONTATTA AMMINISTRATORE
// ============================================================================
async function openContactAdminModal() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  let adminInfo = { admin_email: 'admin@scuolaatene.edu.it', school_name: 'Istituto Scolastico', contact_email: 'admin@scuolaatene.edu.it' };
  try {
    const res = await fetch('/api/admin_contact_info');
    if (res.ok) adminInfo = await res.json();
  } catch (e) {
    console.warn('Could not fetch admin contact info', e);
  }

  const currentUser = (stateData.user && stateData.user.email) ? stateData.user : (window.CURRENT_USER || {});
  const senderName = currentUser.name || '';
  const senderEmail = currentUser.email || '';

  showModal(`
    <div class="modal-dialog" style="max-width:540px;">
      <div class="modal-header">
        <div class="modal-title" style="display:flex;align-items:center;gap:8px;">
          <span>💬</span>
          <span>${_t('contact.modal_title', isEn ? 'Contact Administrator' : 'Contatta l\'Amministratore')}</span>
        </div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px 0;line-height:1.45;">
          ${_t('contact.modal_desc', isEn ? 'Send a communication or inquiry to the timetable coordinator or system administrator.' : 'Invia una comunicazione o richiesta all\'amministratore del sistema o referente dell\'orario della scuola.')}
        </p>

        <div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">${_t('contact.admin_ref', isEn ? 'Administrative contact:' : 'Referente amministrativo:')}</div>
            <div style="font-weight:700;color:var(--text-main);font-size:13px;margin-top:2px;">
              ${escapeHtml(adminInfo.school_name || 'Eurario')} &mdash; <a href="mailto:${escapeHtml(adminInfo.contact_email || adminInfo.admin_email)}" style="color:var(--primary);text-decoration:none;" id="adminEmailDisplay">${escapeHtml(adminInfo.contact_email || adminInfo.admin_email)}</a>
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-sec" onclick="navigator.clipboard.writeText('${escapeJs(adminInfo.contact_email || adminInfo.admin_email)}');showToast(isEn ? 'Email copied!' : 'Email copiata!', 'ok');" title="${_t('contact.copy_email', isEn ? 'Copy Email Address' : 'Copia Indirizzo Email')}">
            📋 Copia
          </button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group">
            <label class="form-label">${_t('contact.sender_name', isEn ? 'Your Full Name' : 'Tuo Nome e Cognome')}</label>
            <input type="text" id="contactSenderName" class="form-input" value="${escapeHtml(senderName)}" placeholder="${isEn ? 'John Doe' : 'Rossi Mario'}">
          </div>
          <div class="form-group">
            <label class="form-label">${_t('contact.sender_email', isEn ? 'Your Reply Email' : 'Tua Email per la risposta')}</label>
            <input type="email" id="contactSenderEmail" class="form-input" value="${escapeHtml(senderEmail)}" placeholder="${isEn ? 'teacher@school.edu' : 'docente@scuola.edu.it'}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${_t('contact.subject', isEn ? 'Subject of request' : 'Oggetto della richiesta')}</label>
          <div style="display:flex;gap:6px;flex-direction:column;">
            <select id="contactSubjectPreset" class="form-select" onchange="onContactSubjectPresetChange(this.value)">
              <option value="">-- ${isEn ? 'Select quick topic or enter custom below' : 'Seleziona argomento rapido o scrivi sotto'} --</option>
              <option value="${_t('contact.subject_opt_info', isEn ? 'Timetable inquiry / support request' : 'Richiesta chiarimenti / supporto sull\'orario')}">${_t('contact.subject_opt_info', isEn ? 'Timetable inquiry / support request' : 'Richiesta chiarimenti / supporto sull\'orario')}</option>
              <option value="${_t('contact.subject_opt_anomaly', isEn ? 'Anomaly or calculation error report' : 'Segnalazione anomalia o errore nel calcolo')}">${_t('contact.subject_opt_anomaly', isEn ? 'Anomaly or calculation error report' : 'Segnalazione anomalia o errore nel calcolo')}</option>
              <option value="${_t('contact.subject_opt_constraints', isEn ? 'Constraints / teacher preferences adjustment' : 'Richiesta variazione vincoli / desiderata')}">${_t('contact.subject_opt_constraints', isEn ? 'Constraints / teacher preferences adjustment' : 'Richiesta variazione vincoli / desiderata')}</option>
              <option value="${_t('contact.subject_opt_trial', isEn ? 'Request official watermark-free prints unlock' : 'Richiesta sblocco stampe ufficiali senza filigrana')}">${_t('contact.subject_opt_trial', isEn ? 'Request official watermark-free prints unlock' : 'Richiesta sblocco stampe ufficiali senza filigrana')}</option>
              <option value="__CUSTOM__">${_t('contact.subject_opt_other', isEn ? 'Other (type custom subject)...' : 'Altro (scrivi oggetto personalizzato)...')}</option>
            </select>
            <input type="text" id="contactSubjectInput" class="form-input" placeholder="${_t('contact.subject_placeholder', isEn ? 'Subject line...' : 'Oggetto del messaggio...')}" value="">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${_t('contact.message', isEn ? 'Message / Details' : 'Messaggio / Dettagli')} <span style="color:#ef4444;">*</span></label>
          <textarea id="contactMessageInput" class="form-input" rows="5" placeholder="${_t('contact.message_placeholder', isEn ? 'Type your detailed message to the administrator...' : 'Scrivi qui il messaggio dettagliato per l\'amministratore...')}" style="font-family:inherit;line-height:1.45;"></textarea>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <button type="button" class="btn btn-sec" onclick="openContactMailto('${escapeJs(adminInfo.contact_email || adminInfo.admin_email)}')">
          ${_t('contact.btn_mailto', isEn ? '✉️ Open in Email Client (mailto)' : '✉️ Apri nel Client Email (mailto)')}
        </button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sec" onclick="closeModal()">${_t('common.cancel', 'Annulla')}</button>
          <button class="btn btn-primary" onclick="submitContactAdmin('${escapeJs(adminInfo.contact_email || adminInfo.admin_email)}')">
            ${_t('contact.btn_send', isEn ? '🚀 Send Direct Message' : '🚀 Invia Messaggio Diretto')}
          </button>
        </div>
      </div>
    </div>
  `);
}

function onContactSubjectPresetChange(val) {
  const inp = document.getElementById('contactSubjectInput');
  if (!inp) return;
  if (val && val !== '__CUSTOM__') {
    inp.value = val;
  } else if (val === '__CUSTOM__') {
    inp.value = '';
    inp.focus();
  }
}

function openContactMailto(targetEmail) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const name = document.getElementById('contactSenderName') ? document.getElementById('contactSenderName').value.trim() : '';
  const subj = document.getElementById('contactSubjectInput') ? document.getElementById('contactSubjectInput').value.trim() : '';
  const msg = document.getElementById('contactMessageInput') ? document.getElementById('contactMessageInput').value.trim() : '';

  const fullSubj = subj ? `[Eurario] ${subj}` : '[Eurario] Richiesta assistenza / supporto';
  const fullBody = `${msg}\n\n--\nMittente: ${name || 'Docente / Operatore Eurario'}`;
  const url = `mailto:${encodeURIComponent(targetEmail)}?subject=${encodeURIComponent(fullSubj)}&body=${encodeURIComponent(fullBody)}`;
  window.location.href = url;
}

async function submitContactAdmin(targetEmail) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const senderName = document.getElementById('contactSenderName') ? document.getElementById('contactSenderName').value.trim() : '';
  const senderEmail = document.getElementById('contactSenderEmail') ? document.getElementById('contactSenderEmail').value.trim() : '';
  const subject = document.getElementById('contactSubjectInput') ? document.getElementById('contactSubjectInput').value.trim() : '';
  const message = document.getElementById('contactMessageInput') ? document.getElementById('contactMessageInput').value.trim() : '';

  if (!message) {
    alert(_t('contact.err_msg_required', isEn ? 'Please enter your message before sending.' : 'Inserire il testo del messaggio prima di inviare.'));
    return;
  }

  try {
    const res = await fetch('/api/contact_admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_name: senderName,
        sender_email: senderEmail,
        subject: subject || (isEn ? 'Support Request' : 'Richiesta Supporto'),
        message: message
      })
    });
    if (res.ok) {
      closeModal();
      showToast(_t('contact.toast_sent', isEn ? 'Message sent to administrator successfully!' : 'Messaggio inviato all\'amministratore con successo!'), 'ok');
    } else {
      const err = await res.json().catch(() => ({}));
      alert((isEn ? 'Error sending message: ' : 'Errore durante l\'invio del messaggio: ') + (err.error || 'Errore di rete'));
    }
  } catch (e) {
    alert((isEn ? 'Network error: ' : 'Errore di connessione: ') + e.message);
  }
}

// --- GESTIONE MULTI-SCUOLA (TENANTS) & CONSOLE SUPERADMIN ---
let currentSchool = null;
let mySchools = [];

function toggleSchoolMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('schoolMenuPopup');
  const langMenu = document.getElementById('langMenuPopup');
  const themeMenu = document.getElementById('themeMenuPopup');
  if (langMenu) langMenu.style.display = 'none';
  if (themeMenu) themeMenu.style.display = 'none';
  if (!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

async function loadMySchools() {
  try {
    const res = await fetch('/api/schools/my');
    if (!res.ok) return;
    const data = await res.json();
    mySchools = data.schools || [];
    const storedSid = localStorage.getItem('eurario_active_school');
    currentSchool = (storedSid && mySchools.find(s => s.id === storedSid)) || data.current_school || null;
    window.currentSchool = currentSchool;
    const activeId = (currentSchool && currentSchool.id) || storedSid || data.active_school_id || null;
    const isEn = window.I18N && window.I18N.getLanguage() === 'en';

    // Aggiorna indicatore scuola in topbar
    const nameEl = document.getElementById('currentSchoolName');
    if (nameEl) {
      const displayName = (currentSchool && currentSchool.name) ? currentSchool.name : (isEn ? 'No Institution' : 'Nessun Istituto');
      nameEl.innerText = displayName;
      nameEl.title = displayName;
    }
    const b = document.getElementById('instBadge');
    if (b && currentSchool && currentSchool.name) {
      b.innerText = currentSchool.name;
    }

    // Badge Trial e Banner di Avviso
    const trialBadge = document.getElementById('currentSchoolTrialBadge');
    const trialBanner = document.getElementById('trialWarningBanner');
    const isTrial = currentSchool && currentSchool.status === 'trial';
    if (trialBadge) trialBadge.style.display = isTrial ? 'inline-block' : 'none';
    if (trialBanner) trialBanner.style.display = isTrial ? 'block' : 'none';

    // Toggle Console SuperAdmin
    const saBtn = document.getElementById('btnSuperAdminConsole');
    if (saBtn) {
      saBtn.style.display = data.is_superadmin ? 'flex' : 'none';
    }

    // Popola lista istituti nel menu a tendina
    const listEl = document.getElementById('schoolMenuList');
    if (listEl) {
      if (mySchools.length === 0) {
        listEl.innerHTML = `
          <div style="padding:12px 10px;font-size:12px;color:var(--text-muted);text-align:center;">
            ${isEn ? 'No institution configured.' : 'Nessun istituto configurato.'}<br>
            <button class="btn btn-sm btn-primary" onclick="openCreateSchoolModal()" style="margin-top:8px;">➕ ${isEn ? 'Register your School' : 'Registra il tuo Istituto'}</button>
          </div>`;
      } else {
        listEl.innerHTML = mySchools.map(s => {
          const isActive = s.id === activeId;
          const isSchTrial = s.status === 'trial';
          const locStr = [s.city, s.country].filter(Boolean).join(', ');
          const subText = [locStr, s.meccanografico].filter(Boolean).join(' • ');
          return `
            <button type="button" class="school-menu-item ${isActive ? 'active' : ''}" onclick="switchSchool('${escapeHtml(s.id)}')">
              <div class="school-item-info">
                <div class="school-item-name">
                  ${escapeHtml(s.name)}
                  ${isSchTrial ? `<span class="badge-trial-pill" style="margin-left:4px;">${isEn ? 'Trial' : 'In Prova'}</span>` : ''}
                </div>
                ${subText ? `<div class="school-item-sub">${escapeHtml(subText)}</div>` : ''}
              </div>
              ${isActive ? '<span class="popup-check">✓</span>' : ''}
            </button>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Errore caricamento scuole utente:', err);
  }
}

async function switchSchool(schoolId) {
  try {
    const menu = document.getElementById('schoolMenuPopup');
    if (menu) menu.style.display = 'none';
    const isEn = window.I18N && window.I18N.getLanguage() === 'en';
    showToast(isEn ? 'Switching institution...' : 'Caricamento istituto in corso...');

    // Resetta preventivamente la versione dei dati per evitare collisioni OCC tra scuole
    window.CURRENT_DATA_VERSION = null;

    // Salva preventivamente l'istituto attivo sia in cookie che in localStorage
    try {
      localStorage.setItem('eurario_active_school', schoolId);
      document.cookie = `eurario_active_school=${encodeURIComponent(schoolId)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch (e) {}

    // Imposta subito la scuola in memoria per orientare tutte le chiamate fetch successive
    currentSchool = { id: schoolId };
    window.currentSchool = currentSchool;

    // Esegui la richiesta con retry trasparente in caso di cold-start o breve ritardo di rete/NAS
    let res = null;
    let data = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        res = await fetch('/api/schools/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-School-Id': schoolId },
          body: JSON.stringify({ school_id: schoolId })
        });
        try {
          data = await res.json();
        } catch (parseErr) {
          data = null;
        }
        if (res.ok && data && data.success) {
          break;
        }
        if (attempt === 1 && (!res || res.status >= 500)) {
          console.warn(`[switchSchool] Tentativo 1 fallito con HTTP ${res ? res.status : 'ERR'}, secondo tentativo in corso...`);
          await new Promise(r => setTimeout(r, 400));
          continue;
        }
      } catch (netErr) {
        lastErr = netErr;
        if (attempt === 1) {
          await new Promise(r => setTimeout(r, 400));
          continue;
        }
      }
    }

    if (res && res.ok && data && data.success) {
      currentSchool = data.school || { id: schoolId };
      window.currentSchool = currentSchool;
      if (currentSchool.id) {
        try {
          localStorage.setItem('eurario_active_school', currentSchool.id);
        } catch (e) {}
      }
      window.CURRENT_DATA_VERSION = null;
      // Resetta selezioni contestuali ed entità che appartenevano alla scuola precedente
      activeEntity = '';
      activeAvailEntity = '';
      pendingActivityFilter = null;
      stateData = { summary: null, timetableViews: null, teachers: null, classes: null, groups: null, subjects: null, rooms: null, activities: null, availability: null, settings: null };

      // Aggiorna subito l'indicatore in barra di navigazione
      const nameEl = document.getElementById('currentSchoolName');
      if (nameEl && currentSchool.name) {
        nameEl.innerText = currentSchool.name;
        nameEl.title = currentSchool.name;
      }
      const b = document.getElementById('instBadge');
      if (b && currentSchool.name) {
        b.innerText = currentSchool.name;
      }

      await loadMySchools();
      await refreshAppState();
      await navigate(currentView || 'dashboard', false);
      showToast(`${isEn ? 'Switched to:' : 'Passato a:'} ${data.school ? data.school.name : schoolId}`, 'ok');
    } else {
      const errMsg = (data && data.error) ? data.error : (data && data.message ? data.message : (res ? `HTTP ${res.status}` : (lastErr ? lastErr.message : 'Connessione non riuscita')));
      alert((isEn ? 'Cannot switch to selected school: ' : 'Impossibile passare alla scuola selezionata: ') + errMsg);
    }
  } catch (err) {
    console.error('Errore switch scuola:', err);
    const isEn = window.I18N && window.I18N.getLanguage() === 'en';
    alert((isEn ? 'Error switching institution: ' : 'Errore durante il cambio istituto: ') + (err.message || String(err)));
  }
}

function openCreateSchoolModal() {
  const menu = document.getElementById('schoolMenuPopup');
  if (menu) menu.style.display = 'none';
  const modal = document.getElementById('createSchoolModal');
  if (modal) {
    const isEn = window.I18N && window.I18N.getLanguage() === 'en';
    document.getElementById('newSchoolName').value = '';
    document.getElementById('newSchoolCity').value = '';
    const countryEl = document.getElementById('newSchoolCountry');
    if (countryEl) countryEl.value = isEn ? 'United States' : 'Italia';
    const mecc = document.getElementById('newSchoolMeccanografico');
    if (mecc) mecc.value = '';
    document.getElementById('newSchoolNotes').value = '';
    if (window.I18N && typeof window.I18N.applyStaticTranslations === 'function') {
      window.I18N.applyStaticTranslations(modal);
    }
    modal.style.display = 'flex';
  }
}

function closeCreateSchoolModal() {
  const modal = document.getElementById('createSchoolModal');
  if (modal) modal.style.display = 'none';
}

async function submitCreateSchool() {
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  const name = (document.getElementById('newSchoolName').value || '').trim();
  const city = (document.getElementById('newSchoolCity').value || '').trim();
  const country = (document.getElementById('newSchoolCountry').value || (isEn ? 'United States' : 'Italia')).trim();
  const meccanografico = (document.getElementById('newSchoolMeccanografico')?.value || '').trim().toUpperCase();
  const contact_email = (document.getElementById('newSchoolContactEmail')?.value || '').trim().toLowerCase();
  const notes = (document.getElementById('newSchoolNotes').value || '').trim();

  if (!name) {
    alert(isEn ? 'Please enter the School / Institution name.' : 'Inserisci il nome del nuovo Istituto Scolastico.');
    return;
  }

  const btn = document.getElementById('btnSubmitCreateSchool');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/schools/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, city, country, meccanografico, contact_email, notes })
    });
    const data = await res.json();
    if (data.success) {
      closeCreateSchoolModal();
      showToast(isEn ? 'New school created successfully!' : 'Nuovo istituto creato con successo!');
      await loadMySchools();
      await refreshAppState();
      navigate('dashboard', false);
    } else {
      alert(data.error || (isEn ? 'Error while registering new school.' : 'Errore durante la registrazione del nuovo istituto.'));
    }
  } catch (err) {
    console.error('Errore creazione scuola:', err);
    alert(isEn ? 'Connection error while creating new school.' : 'Errore di connessione durante la creazione del nuovo istituto.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function createDemoSchool() {
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  if (!confirm(isEn
    ? 'Do you want to initialize and explore Eurario with the preloaded demonstration school ("School of Athens")?'
    : 'Vuoi caricare la scuola dimostrativa "Scuola di Atene" completa di orario, docenti e vincoli?')) return;

  showToast(isEn ? 'Setting up "School of Athens" demo school...' : 'Inizializzazione scuola "Scuola di Atene" in corso...');
  try {
    const res = await fetch('/api/schools/create_demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: isEn ? 'en' : 'it' })
    });
    const data = await res.json();
    if (data.success) {
      showToast(isEn ? 'Demo school loaded successfully!' : 'Scuola "Scuola di Atene" caricata con successo!', 'ok');
      await loadMySchools();
      await refreshAppState();
      navigate('dashboard', false);
    } else {
      alert(data.error || (isEn ? 'Error loading demo school.' : 'Errore caricamento scuola demo.'));
    }
  } catch (err) {
    console.error('Errore creazione scuola demo:', err);
    alert(isEn ? 'Connection error.' : 'Errore di connessione.');
  }
}

function openTrialInfoModal() {
  const modal = document.getElementById('trialInfoModal');
  if (modal) {
    if (window.I18N && typeof window.I18N.applyStaticTranslations === 'function') {
      window.I18N.applyStaticTranslations(modal);
    }
    modal.style.display = 'flex';
  }
}

function closeTrialInfoModal() {
  const modal = document.getElementById('trialInfoModal');
  if (modal) modal.style.display = 'none';
}

function openSuperAdminModal() {
  const menu = document.getElementById('schoolMenuPopup');
  if (menu) menu.style.display = 'none';
  const modal = document.getElementById('superAdminModal');
  if (modal) {
    if (window.I18N && typeof window.I18N.applyStaticTranslations === 'function') {
      window.I18N.applyStaticTranslations(modal);
    }
    modal.style.display = 'flex';
    loadSuperAdminSchools();
  }
}

function closeSuperAdminModal() {
  const modal = document.getElementById('superAdminModal');
  if (modal) modal.style.display = 'none';
}

async function loadSuperAdminSchools(showNotice = false) {
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  try {
    const res = await fetch('/api/superadmin/schools');
    if (!res.ok) {
      if (res.status === 403) alert(isEn ? 'Access denied: reserved for SuperAdmin.' : 'Accesso negato: riservato al SuperAdmin.');
      return;
    }
    const data = await res.json();
    const schools = data.schools || [];
    const countEl = document.getElementById('superAdminTotalCount');
    if (countEl) countEl.innerText = schools.length;

    const tbody = document.getElementById('superAdminSchoolsTbody');
    if (!tbody) return;

    if (schools.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">${isEn ? 'No schools registered yet' : 'Nessun istituto presente'}</td></tr>`;
      return;
    }

    tbody.innerHTML = schools.map(s => {
      let statusBadge = `<span class="status-badge-trial">${isEn ? 'Trial Mode' : 'In Prova (Trial)'}</span>`;
      if (s.status === 'active') {
        statusBadge = `<span class="status-badge-active">${isEn ? 'Active / Full' : 'Attivo / Completo'}</span>`;
      } else if (s.status === 'suspended') {
        statusBadge = `<span class="status-badge-suspended">${isEn ? 'Suspended' : 'Sospeso'}</span>`;
      }

      const isDefault = s.id === 'default';
      const isTrial = s.status === 'trial';
      const isSuspended = s.status === 'suspended';

      let actionButtons = `
        <button class="btn btn-sm btn-sec" onclick="switchSchool('${escapeHtml(s.id)}'); closeSuperAdminModal();" title="${isEn ? 'Switch to this institution' : 'Passa a questo istituto'}" style="padding:2px 8px;font-size:11px;">
          🚪 ${isEn ? 'Enter' : 'Entra'}
        </button>
      `;

      if (isTrial) {
        actionButtons += `
          <button class="btn btn-sm btn-primary" onclick="approveSchoolAsAdmin('${escapeHtml(s.id)}')" title="${isEn ? 'Approve and unlock official prints without watermark' : 'Approva e sblocca stampe ufficiali senza filigrana'}" style="padding:2px 8px;font-size:11px;margin-left:4px;">
            ✅ ${isEn ? 'Approve' : 'Approva'}
          </button>
        `;
      } else if (!isDefault && !isSuspended) {
        actionButtons += `
          <button class="btn btn-sm btn-sec" onclick="suspendSchoolAsAdmin('${escapeHtml(s.id)}')" title="${isEn ? 'Suspend access for this school' : 'Sospendi accesso per questo istituto'}" style="padding:2px 8px;font-size:11px;margin-left:4px;color:#b91c1c;">
            ⏸️ ${isEn ? 'Suspend' : 'Sospendi'}
          </button>
        `;
      } else if (isSuspended) {
        actionButtons += `
          <button class="btn btn-sm btn-primary" onclick="reactivateSchoolAsAdmin('${escapeHtml(s.id)}')" title="${isEn ? 'Reactivate school' : 'Riattiva istituto'}" style="padding:2px 8px;font-size:11px;margin-left:4px;">
            ▶️ ${isEn ? 'Reactivate' : 'Riattiva'}
          </button>
        `;
      }

      if (!isDefault) {
        actionButtons += `
          <button class="btn btn-sm btn-sec" onclick="deleteSchoolAsAdmin('${escapeHtml(s.id)}', '${escapeHtml(s.name)}')" title="${isEn ? 'Delete school and isolated data' : 'Elimina istituto e dati isolati'}" style="padding:2px 8px;font-size:11px;margin-left:4px;color:#b91c1c;">
            🗑️
          </button>
        `;
      }

      return `
        <tr>
          <td>
            <b>${escapeHtml(s.name)}</b>
            ${s.meccanografico ? `<span class="badge" style="background:#e0e7ff;color:#3730a3;font-family:monospace;margin-left:4px;font-size:10px;">${escapeHtml(s.meccanografico)}</span>` : ''}
            ${isDefault ? `<span class="badge badge-info" style="margin-left:4px;font-size:9.5px;">${isEn ? 'Default' : 'Predefinito'}</span>` : ''}
            <div style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);">${escapeHtml(s.id)}</div>
          </td>
          <td>${escapeHtml(s.city || '-')}, ${escapeHtml(s.country || (isEn ? 'Italy' : 'Italia'))}<br><small style="color:var(--text-muted);">${escapeHtml(s.school_year || '-')}</small></td>
          <td>${escapeHtml(s.owner_email || 'admin')}</td>
          <td>${statusBadge}</td>
          <td style="text-align:right;white-space:nowrap;">${actionButtons}</td>
        </tr>
      `;
    }).join('');

    if (showNotice) showToast(isEn ? 'School list updated' : 'Elenco istituti aggiornato');
  } catch (err) {
    console.error('Errore caricamento scuole superadmin:', err);
  }
}

async function approveSchoolAsAdmin(schoolId) {
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  if (!confirm(isEn
    ? 'Do you want to officially approve this Institution?\nAll official high-resolution prints without watermark will be unlocked.'
    : 'Vuoi approvare ufficialmente questo Istituto?\nVerranno sbloccate tutte le stampe ufficiali ad alta risoluzione senza filigrana.')) return;
  try {
    const res = await fetch('/api/superadmin/schools/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school_id: schoolId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(isEn ? 'School approved successfully! Official prints unlocked.' : 'Istituto approvato con successo! Stampe sbloccate.');
      loadSuperAdminSchools();
      loadMySchools();
    } else {
      alert(data.error || (isEn ? 'Error while approving.' : 'Errore durante l\'approvazione.'));
    }
  } catch (err) {
    alert(isEn ? 'Connection error.' : 'Errore di connessione.');
  }
}

async function suspendSchoolAsAdmin(schoolId) {
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  if (!confirm(isEn ? 'Do you want to suspend access for this Institution?' : 'Vuoi sospendere questo Istituto?')) return;
  try {
    const res = await fetch('/api/superadmin/schools/suspend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school_id: schoolId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(isEn ? 'School suspended.' : 'Istituto sospeso.');
      loadSuperAdminSchools();
      loadMySchools();
    } else {
      alert(data.error || (isEn ? 'Error while suspending.' : 'Errore durante la sospensione.'));
    }
  } catch (err) {
    alert(isEn ? 'Connection error.' : 'Errore di connessione.');
  }
}

async function reactivateSchoolAsAdmin(schoolId) {
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  try {
    const res = await fetch('/api/superadmin/schools/reactivate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school_id: schoolId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(isEn ? 'School reactivated.' : 'Istituto riattivato.');
      loadSuperAdminSchools();
      loadMySchools();
    } else {
      alert(data.error || (isEn ? 'Error while reactivating.' : 'Errore durante la riattivazione.'));
    }
  } catch (err) {
    alert(isEn ? 'Connection error.' : 'Errore di connessione.');
  }
}

async function deleteSchoolAsAdmin(schoolId, schoolName) {
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  if (!confirm(isEn
    ? `Are you sure you want to permanently delete institution "${schoolName}" and all its data?\nThis action cannot be undone.`
    : `Sei sicuro di voler eliminare definitivamente l'istituto "${schoolName}" e tutti i suoi dati?\nQuesta azione non può essere annullata.`)) return;
  try {
    const res = await fetch('/api/superadmin/schools/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school_id: schoolId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(isEn ? 'School deleted successfully.' : 'Istituto eliminato con successo.');
      loadSuperAdminSchools();
      loadMySchools();
    } else {
      alert(data.error || (isEn ? 'Error while deleting.' : 'Errore durante l\'eliminazione.'));
    }
  } catch (err) {
    alert('Errore di connessione.');
  }
}

function renderOnboardingSchoolWelcome() {
  const container = document.getElementById('mainContent');
  if (!container) return;
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  container.innerHTML = `
    <div style="max-width: 680px; margin: 40px auto; padding: 36px 28px; background: var(--bg-card); border-radius: 16px; border: 1px solid var(--border); box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center;">
      <div style="font-size: 56px; margin-bottom: 14px;">🏫</div>
      <h2 style="font-size: 24px; font-weight: 800; color: var(--text-main); margin-bottom: 10px;">
        ${isEn ? 'Welcome to Eurario!' : 'Benvenuto su Eurario!'}
      </h2>
      <p style="font-size: 14px; color: var(--text-muted); line-height: 1.6; margin-bottom: 24px;">
        ${isEn
          ? 'Your account has been authorized by the SuperAdmin.<br>You are enabled to set up and manage your own educational institution in full privacy:'
          : 'Il tuo account è stato autorizzato con successo dal SuperAdmin.<br>Puoi ora definire il tuo Istituto Scolastico in modo totalmente autonomo e privato:'}
      </p>
      <div style="display: inline-flex; flex-direction: column; gap: 12px; text-align: left; background: var(--bg-hover); padding: 16px 20px; border-radius: 12px; margin-bottom: 26px; width: 100%; max-width: 480px; font-size: 13px; color: var(--text-main);">
        <div>✨ <b>${isEn ? 'No restrictions:' : 'Nessun limite:'}</b> ${isEn ? 'unlimited teachers, classes, and complex rules.' : 'docenti, classi, materie e vincoli illimitati.'}</div>
        <div>⚡ <b>${isEn ? 'FET 7.12 Engine:' : 'Motore FET 7.12:'}</b> ${isEn ? 'high-speed heuristic timetable calculation and smart advisor.' : 'calcolo orario euristico veloce e diagnostica advisor.'}</div>
        <div>🔒 <b>${isEn ? 'Complete tenant isolation:' : 'Isolamento totale:'}</b> ${isEn ? 'your data and snapshots reside in an isolated workspace.' : 'i tuoi dati risiedono in uno spazio isolato e riservato.'}</div>
      </div>
      <div style="display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-top: 8px;">
        <button class="btn btn-primary btn-lg" onclick="openCreateSchoolModal()" style="padding: 12px 24px; font-size: 14px; font-weight: 700; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;">
          <span>➕</span> <span>${isEn ? 'Register New School' : 'Registra Nuovo Istituto'}</span>
        </button>
        <button class="btn btn-sec btn-lg" onclick="createDemoSchool()" style="padding: 12px 24px; font-size: 14px; font-weight: 700; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;">
          <span>🏰</span> <span>${isEn ? 'Load Demo School ("School of Athens")' : 'Carica Scuola di Esempio ("Scuola di Atene")'}</span>
        </button>
      </div>
    </div>
  `;
}

// --- AUTENTICAZIONE & CONTROLLO ACCESSI (GOOGLE OAUTH & WHITELIST APPROVAL) ---
let currentUser = null;
let authPollInterval = null;
let googleClientId = '';

function applyVersionTags() {
  const v = `v${APP_VERSION}`;
  const ids = ['sidebarVerTag', 'pageFooterVer', 'aboutModalVer', 'updateCurrentVer'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = v;
  });
  try {
    const links = document.querySelectorAll('link[rel*="icon"]');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.includes('v=')) {
        link.href = href + (href.includes('?') ? '&' : '?') + 'v=' + APP_VERSION;
      }
    });
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  applyVersionTags();
  if (window.I18N) {
    window.I18N.updateLangUI();
    window.I18N.applyTheme(window.I18N.detectTheme(), false);
    window.I18N.applyStaticTranslations();
  }
  initNavGroups();
  initGlobalSubjectFilter();
  initAuth();
  checkSoftwareUpdates();
  setInterval(() => checkSoftwareUpdates(false), 30 * 60 * 1000);
});

async function initAuth() {
  const savedCollapsed = localStorage.getItem('sidebar_collapsed');
  // Apertura di default: menu collassato a 68px (hover flyout), a meno che l'utente non l'abbia esplicitamente fissato aperto ('0')
  applySidebarState(savedCollapsed !== '0');
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    googleClientId = data.google_client_id || '';

    if (data.authenticated && data.user) {
      currentUser = data.user;
      handleAuthenticatedState(data);
    } else {
      currentUser = null;
      showLoginScreen(googleClientId);
    }
  } catch (err) {
    console.error('Errore verifica autenticazione:', err);
    showLoginScreen('');
  }
}

function handleAuthenticatedState(data) {
  const user = data.user;
  const status = user.status;

  if (status === 'approved') {
    if (authPollInterval) {
      clearInterval(authPollInterval);
      authPollInterval = null;
    }
    const authScr = document.getElementById('authScreen');
    if (authScr) authScr.style.display = 'none';

    // Aggiorna pill utente nella topbar
    const pill = document.getElementById('topbarUserPill');
    const avatar = document.getElementById('topbarUserAvatar');
    const nameEl = document.getElementById('topbarUserName');
    const roleEl = document.getElementById('topbarUserRole');

    if (pill) pill.style.display = 'flex';
    if (nameEl) nameEl.innerText = user.name || user.email;
    if (roleEl) {
      roleEl.innerText = user.role === 'admin' ? 'Admin' : (user.role === 'editor' ? 'Editor' : 'Viewer');
      roleEl.className = 'badge badge-role ' + (user.role === 'admin' ? 'badge-primary' : 'badge-info');
    }
    if (avatar) {
      if (user.picture) {
        avatar.src = user.picture;
        avatar.style.display = 'inline-block';
      } else {
        avatar.style.display = 'none';
      }
    }

    // Se admin o school admin, mostra voce gestione accessi nel menu laterale
    const sideItem = document.getElementById('sidebarAccessMgmtItem');
    const isAnyAdmin = Boolean(user.role === 'admin' || user.is_school_admin || user.is_superadmin);
    if (isAnyAdmin) {
      if (sideItem) sideItem.style.display = 'flex';
      updatePendingBadge(data.pending_count || 0);

      // Polling periodico per nuove richieste ogni 10s per l'amministratore
      if (!authPollInterval) {
        authPollInterval = setInterval(refreshAdminPendingCount, 10000);
      }
    } else {
      if (sideItem) sideItem.style.display = 'none';
      const topBtn = document.getElementById('topbarPendingBtn');
      if (topBtn) topBtn.style.display = 'none';
    }

    // Carica l'applicazione
    loadInitialData();

  } else if (status === 'pending') {
    showPendingScreen(user);
    if (!authPollInterval) {
      authPollInterval = setInterval(checkAuthMe, 5000);
    }
  } else if (status === 'rejected') {
    showRejectedScreen(user);
  }
}

let latestPendingCount = 0;

function updatePendingBadge(count) {
  const prevCount = latestPendingCount;
  latestPendingCount = count || 0;

  // 1. Pulsante con campanella nella barra superiore (topbar)
  const topbarBtn = document.getElementById('topbarPendingBtn');
  const topbarCount = document.getElementById('topbarPendingCount');
  if (topbarBtn) {
    if (latestPendingCount > 0 && currentUser && (currentUser.role === 'admin' || currentUser.is_superadmin)) {
      topbarBtn.style.display = 'inline-flex';
      if (topbarCount) topbarCount.innerText = latestPendingCount;
    } else {
      topbarBtn.style.display = 'none';
    }
  }

  // 2. Badge nella barra laterale (sidebar)
  const badge = document.getElementById('sidebarPendingBadge');
  if (badge) {
    if (latestPendingCount > 0) {
      badge.innerText = latestPendingCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
  const flyBadge = document.getElementById('flyoutPendingBadge');
  if (flyBadge) {
    if (latestPendingCount > 0) {
      flyBadge.innerText = latestPendingCount;
      flyBadge.style.display = 'inline-block';
    } else {
      flyBadge.style.display = 'none';
    }
  }

  // 3. Badge interno al modal Gestione Accessi
  const modalPendingBadge = document.getElementById('modalPendingCountBadge');
  if (modalPendingBadge) modalPendingBadge.innerText = latestPendingCount;

  // 4. Notifica sonora / visiva (Toast) all'amministratore se il conteggio aumenta
  if (latestPendingCount > prevCount && currentUser && (currentUser.role === 'admin' || currentUser.is_superadmin)) {
    showToast(`🔔 Nuova richiesta di accesso in attesa (${latestPendingCount} utente/i da autorizzare)!`, 'ok');
  }
}

async function refreshAdminPendingCount() {
  if (!currentUser || (currentUser.role !== 'admin' && !currentUser.is_superadmin)) return;
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.authenticated && data.user) {
      updatePendingBadge(data.pending_count || 0);
    }
  } catch (e) {}
}

async function checkAuthMe() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.authenticated && data.user) {
      currentUser = data.user;
      if (currentUser.status === 'approved') {
        if (authPollInterval) {
          clearInterval(authPollInterval);
          authPollInterval = null;
        }
        showToast('Accesso sbloccato! Benvenuto in Eurario.', 'ok');
        handleAuthenticatedState(data);
      }
    }
  } catch (e) {}
}

function showLoginScreen(clientId) {
  if (authPollInterval) {
    clearInterval(authPollInterval);
    authPollInterval = null;
  }
  const authScr = document.getElementById('authScreen');
  if (authScr) authScr.style.display = 'flex';
  document.getElementById('authStateLogin').style.display = 'block';
  document.getElementById('authStatePending').style.display = 'none';
  document.getElementById('authStateRejected').style.display = 'none';
  const pill = document.getElementById('topbarUserPill');
  if (pill) pill.style.display = 'none';
  const accessBtn = document.getElementById('accessMgmtBtn');
  if (accessBtn) accessBtn.style.display = 'none';
  const sideItem = document.getElementById('sidebarAccessMgmtItem');
  if (sideItem) sideItem.style.display = 'none';

  // Assicura che il form admin passcode sia chiuso di default
  toggleAdminPasscodeForm(false);

  if (window.I18N && typeof window.I18N.applyStaticTranslations === 'function') {
    window.I18N.applyStaticTranslations(authScr);
  }

  if (clientId) {
    initGoogleButton(clientId);
  } else {
    renderGoogleButtonFallback();
  }
}

function renderGoogleButtonFallback() {
  const target = document.getElementById('g_id_signin_placeholder');
  if (!target) return;
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  target.innerHTML = `
    <button type="button" class="btn-google-clean" onclick="handleGoogleSignInClick()">
      <svg viewBox="0 0 24 24" width="18" height="18">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
      </svg>
      <span>${isEn ? 'Continue with Google' : 'Continua con Google'}</span>
    </button>
  `;
}

function handleGoogleSignInClick() {
  if (googleClientId) {
    switchGoogleAccount();
    return;
  }
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  showToast(isEn
    ? 'Google Client ID is not yet configured. System Admin can sign in using the indicator below to configure it.'
    : 'Google Client ID non ancora configurato. L\'amministratore può accedere dall\'indicatore in basso per configurarlo.', 'warn');
  toggleAdminPasscodeForm(true);
}

function toggleAdminPasscodeForm(forceOpen) {
  const form = document.getElementById('adminPasscodeForm');
  if (!form) return;
  const isHidden = form.style.display === 'none';
  const shouldOpen = (typeof forceOpen === 'boolean') ? forceOpen : isHidden;
  form.style.display = shouldOpen ? 'block' : 'none';
  if (shouldOpen) {
    const input = document.getElementById('emergencyPasscode');
    if (input) {
      input.focus();
      input.select();
    }
  }
}

function showPendingScreen(user) {
  const authScr = document.getElementById('authScreen');
  if (authScr) authScr.style.display = 'flex';
  document.getElementById('authStateLogin').style.display = 'none';
  document.getElementById('authStatePending').style.display = 'block';
  document.getElementById('authStateRejected').style.display = 'none';

  document.getElementById('pendingName').innerText = user.name || user.email;
  document.getElementById('pendingEmail').innerText = user.email;
  const avatar = document.getElementById('pendingAvatar');
  if (user.picture) {
    avatar.src = user.picture;
    avatar.style.display = 'block';
  } else {
    avatar.style.display = 'none';
  }
}

function showRejectedScreen(user) {
  const authScr = document.getElementById('authScreen');
  if (authScr) authScr.style.display = 'flex';
  document.getElementById('authStateLogin').style.display = 'none';
  document.getElementById('authStatePending').style.display = 'none';
  document.getElementById('authStateRejected').style.display = 'block';
  document.getElementById('rejectedEmail').innerText = user.email;
}

function initGoogleButton(clientId) {
  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    setTimeout(() => initGoogleButton(clientId), 300);
    return;
  }
  try {
    if (window.google.accounts.id.disableAutoSelect) {
      window.google.accounts.id.disableAutoSelect();
    }
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredentialResponse,
      auto_select: false,
      itp_support: true,
      context: 'signin'
    });
    const target = document.getElementById('g_id_signin_placeholder');
    if (target) {
      target.innerHTML = '';
      window.google.accounts.id.renderButton(target, {
        theme: 'outline',
        size: 'large',
        type: 'standard',
        shape: 'pill',
        text: 'signin_with',
        logo_alignment: 'left',
        width: 280
      });
    }
  } catch (err) {
    console.error('Errore inizializzazione Google Sign-In:', err);
  }
}

function switchGoogleAccount() {
  if (!googleClientId) {
    handleGoogleSignInClick();
    return;
  }

  if (window.google?.accounts?.id?.disableAutoSelect) {
    window.google.accounts.id.disableAutoSelect();
  }

  // Se Google Identity Services oauth2 token client è disponibile, usalo con prompt='select_account'
  if (googleClientId && window.google?.accounts?.oauth2) {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: 'email profile openid',
        prompt: 'select_account',
        callback: async (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            try {
              const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token: tokenResponse.access_token })
              });
              const data = await res.json();
              if (res.ok && data.user) {
                currentUser = data.user;
                if (data.user.status === 'approved') {
                  showToast('Accesso autorizzato!', 'ok');
                  handleAuthenticatedState({ user: data.user });
                } else {
                  showPendingScreen(data.user);
                  if (!authPollInterval) authPollInterval = setInterval(checkAuthMe, 5000);
                }
              } else {
                const errBox = document.getElementById('authErrorMsg');
                if (errBox) {
                  errBox.innerText = data.error || 'Errore durante autenticazione con altro account Google.';
                  errBox.style.display = 'block';
                }
              }
            } catch (e) {
              console.error('Errore invio access token:', e);
            }
          }
        }
      });
      client.requestAccessToken({ prompt: 'select_account' });
      return;
    } catch (e) {
      console.warn('OAuth2 token client non riuscito, fallback popup:', e);
    }
  }

  // Fallback: apri finestra di Google Account Chooser
  const w = 520, h = 620;
  const left = Math.max(0, (window.screen.width - w) / 2);
  const top = Math.max(0, (window.screen.height - h) / 2);
  window.open(
    'https://accounts.google.com/AccountChooser?service=lso&continue=' + encodeURIComponent(window.location.origin),
    'GoogleAccountChooser',
    `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=yes`
  );
}

async function submitAccessRequest() {
  const errBox = document.getElementById('authErrorMsg');
  if (errBox) errBox.style.display = 'none';

  const nameEl = document.getElementById('reqAccessName');
  const emailEl = document.getElementById('reqAccessEmail');

  const name = (nameEl?.value || '').trim();
  const email = (emailEl?.value || '').trim().toLowerCase();

  if (!email || !email.includes('@') || !email.includes('.')) {
    if (errBox) {
      errBox.innerText = 'Inserisci un indirizzo email Google valido (es. nome.cognome@gmail.com).';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch('/api/auth/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name })
    });
    const data = await res.json();

    if (!res.ok) {
      if (errBox) {
        errBox.innerText = data.error || 'Errore durante la richiesta di abilitazione.';
        errBox.style.display = 'block';
      }
      return;
    }

    if (data.status === 'approved') {
      showToast('Il tuo account è già approvato! Accedi per iniziare.', 'ok');
      currentUser = data.user;
      handleAuthenticatedState({ user: data.user });
    } else if (data.status === 'pending') {
      showToast('Richiesta inviata! In attesa di abilitazione da parte dell\'amministratore.', 'ok');
      showPendingScreen(data.user);
      if (!authPollInterval) {
        authPollInterval = setInterval(checkAuthMe, 5000);
      }
    } else {
      showRejectedScreen(data.user);
    }
  } catch (err) {
    if (errBox) {
      errBox.innerText = 'Errore di connessione: ' + err.message;
      errBox.style.display = 'block';
    }
  }
}

async function handleGoogleCredentialResponse(response) {
  const errBox = document.getElementById('authErrorMsg');
  if (errBox) errBox.style.display = 'none';

  if (!response || !response.credential) {
    if (errBox) {
      errBox.innerText = 'Nessuna credenziale ricevuta da Google.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();

    if (!res.ok) {
      if (errBox) {
        errBox.innerText = data.error || 'Errore durante il login Google.';
        errBox.style.display = 'block';
      }
      return;
    }

    currentUser = data.user;
    if (data.user.status === 'approved') {
      showToast('Accesso autorizzato!', 'ok');
      handleAuthenticatedState({ user: data.user });
    } else {
      showPendingScreen(data.user);
      if (!authPollInterval) {
        authPollInterval = setInterval(checkAuthMe, 6000);
      }
    }
  } catch (e) {
    if (errBox) {
      errBox.innerText = 'Errore di connessione al server: ' + e.message;
      errBox.style.display = 'block';
    }
  }
}

let pendingForcedAuth = null;

function showForceChangePasscodeModal(oldPasscode, user) {
  pendingForcedAuth = { oldPasscode, user };
  const modal = document.getElementById('modalForceChangePasscode');
  const errBox = document.getElementById('forcePasscodeError');
  const p1 = document.getElementById('inputNewMasterPasscode');
  const p2 = document.getElementById('inputConfirmMasterPasscode');
  if (errBox) { errBox.style.display = 'none'; errBox.innerText = ''; }
  if (p1) p1.value = '';
  if (p2) p2.value = '';
  if (modal) modal.style.display = 'flex';
  setTimeout(() => p1?.focus(), 150);
}

async function submitForcedPasscodeChange() {
  const p1 = (document.getElementById('inputNewMasterPasscode')?.value || '').trim();
  const p2 = (document.getElementById('inputConfirmMasterPasscode')?.value || '').trim();
  const errBox = document.getElementById('forcePasscodeError');

  if (!p1) {
    if (errBox) { errBox.innerText = 'Inserisci il nuovo passcode master.'; errBox.style.display = 'block'; }
    return;
  }
  if (p1.length < 8) {
    if (errBox) { errBox.innerText = 'Il passcode deve contenere almeno 8 caratteri.'; errBox.style.display = 'block'; }
    return;
  }
  if (p1.toLowerCase() === 'admin2026') {
    if (errBox) { errBox.innerText = 'Devi scegliere un passcode diverso da quello di fabbrica (admin2026).'; errBox.style.display = 'block'; }
    return;
  }
  if (p1 !== p2) {
    if (errBox) { errBox.innerText = 'I due passcode inseriti non coincidono. Riprova.'; errBox.style.display = 'block'; }
    return;
  }

  try {
    const res = await fetch('/api/auth/emergency/change-passcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_passcode: pendingForcedAuth?.oldPasscode || '',
        new_passcode: p1
      })
    });
    const data = await res.json();
    if (!res.ok) {
      if (errBox) { errBox.innerText = data.error || 'Errore durante l\'aggiornamento del passcode.'; errBox.style.display = 'block'; }
      return;
    }

    const modal = document.getElementById('modalForceChangePasscode');
    if (modal) modal.style.display = 'none';

    showToast('Nuovo passcode master configurato con successo!', 'ok');
    if (pendingForcedAuth?.user) {
      currentUser = pendingForcedAuth.user;
      handleAuthenticatedState({ user: pendingForcedAuth.user, pending_count: 0 });
    }
    pendingForcedAuth = null;
  } catch (e) {
    if (errBox) { errBox.innerText = 'Errore di connessione: ' + e.message; errBox.style.display = 'block'; }
  }
}

async function submitEmergencyLogin() {
  const passEl = document.getElementById('emergencyPasscode');
  const errBox = document.getElementById('authErrorMsg');
  if (errBox) errBox.style.display = 'none';

  const passcode = (passEl?.value || '').trim();
  if (!passcode) {
    if (errBox) {
      errBox.innerText = 'Inserisci il passcode di emergenza.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch('/api/auth/emergency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode })
    });
    const data = await res.json();
    if (!res.ok) {
      if (errBox) {
        errBox.innerText = data.error || 'Passcode errato.';
        errBox.style.display = 'block';
      }
      return;
    }

    currentUser = data.user;
    if (data.must_change_passcode) {
      showForceChangePasscodeModal(passcode, data.user);
      return;
    }

    showToast('Accesso Amministratore confermato!', 'ok');
    handleAuthenticatedState({ user: data.user, pending_count: 0 });
  } catch (e) {
    if (errBox) {
      errBox.innerText = 'Errore di connessione: ' + e.message;
      errBox.style.display = 'block';
    }
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  if (window.google?.accounts?.id?.disableAutoSelect) {
    try {
      window.google.accounts.id.disableAutoSelect();
    } catch (e) {}
  }
  currentUser = null;
  if (authPollInterval) {
    clearInterval(authPollInterval);
    authPollInterval = null;
  }
  showLoginScreen(googleClientId);
}

// --- GESTIONE ACCESSI & APPROVAZIONI (PER CARLO / ADMIN) ---
let currentUsersData = { users: [], pending_count: 0, admin_email: '', google_client_id: '' };

async function openAccessManagementModal() {
  const modal = document.getElementById('accessModal');
  if (!modal) return;
  modal.style.display = 'flex';
  if (window.I18N && typeof window.I18N.applyStaticTranslations === 'function') {
    window.I18N.applyStaticTranslations(modal);
  }
  const isSuper = Boolean(currentUser && currentUser.is_superadmin);
  switchAccessTab(isSuper ? 'pending' : 'approved');
  await loadUsersList();
}

function closeAccessManagementModal() {
  const modal = document.getElementById('accessModal');
  if (modal) modal.style.display = 'none';
}

function switchAccessTab(tab) {
  document.getElementById('tabBtnPending')?.classList.toggle('active', tab === 'pending');
  document.getElementById('tabBtnApproved')?.classList.toggle('active', tab === 'approved');
  document.getElementById('tabBtnSchoolSmtp')?.classList.toggle('active', tab === 'schoolsmtp');
  document.getElementById('tabBtnLogs')?.classList.toggle('active', tab === 'logs');
  document.getElementById('tabBtnConfig')?.classList.toggle('active', tab === 'config');

  document.getElementById('tabPendingUsers').style.display = (tab === 'pending') ? 'block' : 'none';
  document.getElementById('tabApprovedUsers').style.display = (tab === 'approved') ? 'block' : 'none';
  if (document.getElementById('tabSchoolSmtp')) document.getElementById('tabSchoolSmtp').style.display = (tab === 'schoolsmtp') ? 'block' : 'none';
  if (document.getElementById('tabLogs')) document.getElementById('tabLogs').style.display = (tab === 'logs') ? 'block' : 'none';
  document.getElementById('tabConfig').style.display = (tab === 'config') ? 'block' : 'none';

  if (tab === 'config') {
    populateConfigFields();
  } else if (tab === 'logs') {
    loadAccessLogs();
  } else if (tab === 'schoolsmtp') {
    loadSchoolSmtpConfig();
  }
}

async function loadSchoolSmtpConfig() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const sid = selectedAccessSchoolFilter || (currentUsersData && currentUsersData.school_id) || (window.currentSchool && window.currentSchool.id) || 'default';
  
  const titleEl = document.getElementById('schoolSmtpTitle');
  if (titleEl) {
    const sName = (currentUsersData && currentUsersData.available_schools && currentUsersData.available_schools.find(s => s.id === sid)?.name)
      || (window.currentSchool && window.currentSchool.name)
      || sid;
    titleEl.innerText = isEn ? `Email & SMTP Configuration — ${sName}` : `Server SMTP & Notifiche Istituto — ${sName}`;
  }

  try {
    const res = await fetch(`/api/schools/smtp?school_id=${encodeURIComponent(sid)}`);
    if (!res.ok) {
      showToast(isEn ? 'Error loading school SMTP config' : 'Errore caricamento configurazione SMTP scuola', 'error');
      return;
    }
    const data = await res.json();
    const smtp = data.smtp || {};
    
    const enChk = document.getElementById('cfgSchoolSmtpEnabled');
    if (enChk) enChk.checked = Boolean(smtp.enabled);
    const hostInp = document.getElementById('cfgSchoolSmtpHost');
    if (hostInp) hostInp.value = smtp.host || '';
    const portInp = document.getElementById('cfgSchoolSmtpPort');
    if (portInp) portInp.value = smtp.port || 587;
    const userInp = document.getElementById('cfgSchoolSmtpUser');
    if (userInp) userInp.value = smtp.user || '';
    const passInp = document.getElementById('cfgSchoolSmtpPass');
    if (passInp) passInp.value = smtp.has_password ? '••••••••' : '';
    const notifyInp = document.getElementById('cfgSchoolSmtpNotifyTo');
    if (notifyInp) notifyInp.value = smtp.notify_to || data.contact_email || '';
  } catch (e) {
    console.error('Error loading school smtp:', e);
  }
}

async function saveSchoolSmtpConfig() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const sid = selectedAccessSchoolFilter || (currentUsersData && currentUsersData.school_id) || (window.currentSchool && window.currentSchool.id) || 'default';

  const enabled = document.getElementById('cfgSchoolSmtpEnabled')?.checked || false;
  const host = (document.getElementById('cfgSchoolSmtpHost')?.value || '').trim();
  const port = parseInt(document.getElementById('cfgSchoolSmtpPort')?.value || '587', 10);
  const user = (document.getElementById('cfgSchoolSmtpUser')?.value || '').trim();
  const rawPass = (document.getElementById('cfgSchoolSmtpPass')?.value || '').trim();
  const notify_to = (document.getElementById('cfgSchoolSmtpNotifyTo')?.value || '').trim();

  const password = rawPass.includes('••••') ? undefined : rawPass;

  try {
    const res = await fetch('/api/schools/smtp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        school_id: sid,
        enabled,
        host,
        port,
        user,
        password,
        notify_to,
        contact_email: notify_to
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || (isEn ? 'Failed to save SMTP config' : 'Errore nel salvataggio SMTP'), 'error');
      return;
    }
    showToast(isEn ? 'School SMTP configuration saved!' : 'Configurazione SMTP scuola salvata con successo!', 'ok');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function testSchoolSmtpEmail() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const sid = selectedAccessSchoolFilter || (currentUsersData && currentUsersData.school_id) || (window.currentSchool && window.currentSchool.id) || 'default';

  const notifyTo = (document.getElementById('cfgSchoolSmtpNotifyTo')?.value || '').trim();
  showToast(isEn ? 'Sending test email...' : 'Invio email di test in corso...', 'info');

  try {
    const res = await fetch('/api/schools/smtp/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        school_id: sid,
        admin_email: notifyTo || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert((isEn ? '❌ SMTP Test Failed:\n\n' : '❌ Test SMTP Fallito:\n\n') + (data.error || 'Errore sconosciuto'));
      return;
    }
    alert((isEn ? '✅ SMTP Test Succeeded!\n\n' : '✅ Test SMTP Riuscito!\n\n') + (data.message || 'Email inviata con successo.'));
  } catch (e) {
    alert((isEn ? '❌ Connection Error:\n' : '❌ Errore di connessione:\n') + e.message);
  }
}

async function quickAssignUserToSchool(email, schSelectId, roleSelectId) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const schSelect = document.getElementById(schSelectId);
  const roleSelect = document.getElementById(roleSelectId);
  if (!schSelect || !roleSelect) return;
  const schoolId = schSelect.value;
  const role = roleSelect.value;

  try {
    const res = await fetch('/api/auth/users/add_to_school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, school_id: schoolId, role })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || (isEn ? 'Error assigning school' : 'Errore durante l\'assegnazione scuola'), 'error');
      return;
    }
    showToast(isEn ? `User ${email} assigned with role ${role.toUpperCase()}!` : `Utente ${email} assegnato con ruolo ${role.toUpperCase()}!`, 'ok');
    await loadUsersList(selectedAccessSchoolFilter || undefined);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function loadAccessLogs() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const tbody = document.getElementById('accessLogsTbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">${isEn ? 'Loading access audit log...' : 'Caricamento registro accessi in corso...'}</td></tr>`;
  try {
    const res = await fetch('/api/auth/access_logs?limit=250');
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#dc2626;">${isEn ? 'Error loading access log' : 'Errore durante il caricamento del registro accessi'}</td></tr>`;
      return;
    }
    const data = await res.json();
    const logs = data.logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">${isEn ? 'No access events recorded yet.' : 'Nessun evento di accesso registrato finora.'}</td></tr>`;
      return;
    }
    tbody.innerHTML = logs.map(l => {
      let badgeClass = 'badge-ok';
      let statusColor = '#16a34a';
      let statusIcon = '✓';
      if (l.status === 'FAILED' || l.status === 'DENIED') {
        badgeClass = 'badge-danger';
        statusColor = '#dc2626';
        statusIcon = '✕';
      } else if (l.event === 'LOGIN_PENDING') {
        badgeClass = 'badge-warn';
        statusColor = '#ea580c';
        statusIcon = '⏳';
      } else if (l.status === 'INFO') {
        badgeClass = 'badge-info';
        statusColor = '#2563eb';
        statusIcon = 'ℹ️';
      }
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:11px;color:#475569;white-space:nowrap;">${escapeHtml(l.timestamp || '-')}</td>
        <td style="white-space:nowrap;"><span class="badge ${badgeClass}" style="font-size:10px;padding:2px 6px;">${escapeHtml(l.event || '-')}</span></td>
        <td style="font-weight:600;color:var(--text-main);">${escapeHtml(l.email || '-')}</td>
        <td style="text-transform:uppercase;font-size:10.5px;color:#64748b;font-weight:600;">${escapeHtml(l.role || '-')}</td>
        <td style="font-family:var(--font-mono);font-size:11px;color:#334155;">${escapeHtml(l.ip || '-')}</td>
        <td style="white-space:nowrap;font-weight:700;color:${statusColor};">${statusIcon} ${escapeHtml(l.status || '-')}</td>
        <td style="color:#64748b;font-size:11.5px;">${escapeHtml(l.details || '-')}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#dc2626;">${isEn ? 'Load error: ' : 'Errore caricamento: '} ${escapeHtml(e.message)}</td></tr>`;
  }
}

async function clearAccessLogs() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (!confirm(isEn ? 'Are you sure you want to clear the access event log?' : 'Sei sicuro di voler azzerare il registro cronologico degli accessi?')) return;
  try {
    const res = await fetch('/api/auth/access_logs/clear', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || (isEn ? 'Error clearing audit log' : 'Errore azzeramento registro'), 'error');
      return;
    }
    showToast(isEn ? 'Access log cleared successfully' : 'Registro accessi azzerato con successo', 'ok');
    loadAccessLogs();
  } catch (e) {
    showToast((isEn ? 'Error clearing log: ' : 'Errore azzeramento: ') + e.message, 'error');
  }
}

let selectedAccessSchoolFilter = '';

async function loadUsersList(schoolId) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  try {
    let url = '/api/auth/users';
    if (schoolId !== undefined && schoolId !== null) {
      selectedAccessSchoolFilter = schoolId;
    }
    if (selectedAccessSchoolFilter) {
      url += `?school_id=${encodeURIComponent(selectedAccessSchoolFilter)}`;
    }
    const res = await fetch(url);
    if (!res.ok) {
      showToast(isEn ? 'Error loading users list' : 'Errore caricamento utenti', 'error');
      return;
    }
    currentUsersData = await res.json();
    renderUsersUI();
  } catch (e) {
    showToast((isEn ? 'Connection error: ' : 'Errore di connessione: ') + e.message, 'error');
  }
}

function handleSchoolFilterChange(schoolId) {
  loadUsersList(schoolId);
}

function renderUsersUI() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const users = currentUsersData.users || [];
  const pending = users.filter(u => u.status === 'pending');
  const approved = users.filter(u => u.status === 'approved');
  const rejected = users.filter(u => u.status === 'rejected');
  const isSuper = Boolean(currentUsersData.is_superadmin);
  const isSchoolView = Boolean(currentUsersData.is_school_view);

  // Titolo & Sottotitolo modale
  const titleEl = document.getElementById('accessModalTitle');
  const subEl = document.getElementById('accessModalSubtitle');
  if (titleEl) {
    if (isSchoolView) {
      const schName = currentUsersData.school_name || (window.currentSchool && window.currentSchool.name) || currentUsersData.school_id || '';
      titleEl.innerText = isEn ? `👥 User & Teacher Management — ${schName}` : `👥 Gestione Utenti & Docenti — ${schName}`;
      if (subEl) {
        subEl.innerText = isEn
          ? 'Manage authorized teachers and collaborators for this institution. Platform SuperAdmin is excluded from this list.'
          : 'Docenti e collaboratori autorizzati per questo istituto. Il SuperAdmin gestisce la piattaforma ed è escluso da questo elenco.';
      }
    } else {
      titleEl.innerText = isEn ? '👥 Global User & Platform Management (SuperAdmin)' : '👥 Console Gestione Utenti & Piattaforma (SuperAdmin)';
      if (subEl) {
        subEl.innerText = isEn
          ? 'Platform-wide administrator console: cross-school user registry, global configurations, and access audit log.'
          : 'Console di controllo globale: registro utenti di tutti gli istituti, configurazioni di sistema e audit log degli accessi.';
      }
    }
  }

  // Gestione tab Config & Logs (visibili SOLO al SuperAdmin)
  const tabConfigBtn = document.getElementById('tabBtnConfig');
  if (tabConfigBtn) tabConfigBtn.style.display = isSuper ? 'inline-flex' : 'none';
  const tabLogsBtn = document.getElementById('tabBtnLogs');
  if (tabLogsBtn) tabLogsBtn.style.display = isSuper ? 'inline-flex' : 'none';

  // Filtro Scuole (visibile solo se SuperAdmin)
  const filterWrap = document.getElementById('accessSchoolFilterWrap');
  if (filterWrap) {
    if (isSuper) {
      filterWrap.style.display = 'flex';
      const select = document.getElementById('accessSchoolFilterSelect');
      if (select && currentUsersData.available_schools) {
        const currentVal = selectedAccessSchoolFilter || '';
        select.innerHTML = `<option value="">🌐 ${isEn ? 'All Schools (Global Platform)' : 'Tutti gli Istituti (Piattaforma Globale)'}</option>` +
          currentUsersData.available_schools.map(s =>
            `<option value="${escapeHtml(s.id)}" ${s.id === currentVal ? 'selected' : ''}>🏫 ${escapeHtml(s.name)}</option>`
          ).join('');
      }
    } else {
      filterWrap.style.display = 'none';
    }
  }

  // Badges
  const pBadge = document.getElementById('modalPendingCountBadge');
  if (pBadge) pBadge.innerText = pending.length;
  const aCount = document.getElementById('modalApprovedCount');
  if (aCount) aCount.innerText = approved.length;
  updatePendingBadge(pending.length);

  // Tab 1: Pending Users
  const pendingContainer = document.getElementById('pendingUsersList');
  if (pending.length === 0) {
    pendingContainer.innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:#64748b;">
        <div style="font-size:36px;margin-bottom:8px;">✅</div>
        <b>${isEn ? 'No pending access requests.' : 'Nessuna richiesta di accesso in attesa.'}</b>
        <p style="font-size:12px;margin-top:4px;">${isEn ? 'All teachers who signed in have already been authorized.' : 'Tutti i docenti che hanno effettuato il login sono già stati autorizzati.'}</p>
      </div>`;
  } else {
    const availSchools = currentUsersData.available_schools || [];
    const otherOptions = availSchools.filter(s => s.id !== 'default').map(s =>
      `<option value="${escapeHtml(s.id)}">🏫 ${escapeHtml(s.name)}</option>`
    ).join('');

    pendingContainer.innerHTML = pending.map(u => {
      const emailSafe = btoa(unescape(encodeURIComponent(u.email))).replace(/=/g, '');
      const reqDate = u.created_at ? new Date(u.created_at).toLocaleString(isEn ? 'en-US' : 'it-IT') : 'N/D';
      return `
      <div class="user-item-card" id="user-card-${emailSafe}" style="display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card);margin-bottom:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div class="user-card-left" style="display:flex;align-items:center;gap:12px;">
            ${u.picture ? `<img src="${u.picture}" class="user-card-avatar" alt="Avatar" style="width:38px;height:38px;border-radius:50%;" />` : `<div class="user-card-avatar" style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;background:var(--bg-hover);border-radius:50%;font-size:18px;">👤</div>`}
            <div class="user-card-info">
              <div class="user-card-name" style="font-weight:700;font-size:13.5px;color:var(--text-main);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                ${escapeHtml(u.name || u.email)}
                ${u.was_previously_rejected ? `<span class="badge badge-warn" style="font-size:10px;background:#fef3c7;color:#b45309;border:1px solid #f59e0b;padding:1px 6px;">🔄 Riattivazione (già revocato)</span>` : ''}
              </div>
              <div class="user-card-email" style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);">${escapeHtml(u.email)}</div>
              <div class="user-card-meta" style="font-size:11px;color:var(--text-sub);margin-top:2px;">${isEn ? 'Requested on:' : 'Richiesto il:'} ${reqDate}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="btn btn-sm btn-success" onclick="approveUser('${escapeHtml(u.email)}')">${isEn ? '✅ Approve Access' : '✅ Sblocca Accesso'}</button>
            <button class="btn btn-sm btn-danger" onclick="rejectUser('${escapeHtml(u.email)}')">${isEn ? '❌ Reject' : '❌ Rifiuta'}</button>
          </div>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:12px;background:var(--bg-hover);padding:10px 12px;border-radius:8px;align-items:center;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:11.5px;font-weight:700;color:var(--text-main);">${isEn ? 'Role:' : 'Ruolo:'}</span>
            <select id="role-select-${emailSafe}" class="form-input" style="padding:4px 8px;font-size:11.5px;width:auto;">
              <option value="editor" selected>${isEn ? 'Editor (Edit timetable)' : 'Editor (Modifica orario)'}</option>
              <option value="viewer">${isEn ? 'Viewer (Read-only)' : 'Viewer (Sola lettura)'}</option>
              <option value="admin">${isEn ? 'Administrator' : 'Amministratore'}</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:280px;">
            <span style="font-size:11.5px;font-weight:700;color:var(--text-main);white-space:nowrap;">${isEn ? 'Assign To:' : 'Destinazione:'}</span>
            <select id="school-select-${emailSafe}" class="form-input" style="padding:4px 8px;font-size:11.5px;width:100%;">
              <option value="default" selected>🏫 Scuola Principale (Rolando da Piazzola)</option>
              <option value="new_school">✨ Nuova Scuola Autonoma (L'utente la definirà al primo accesso)</option>
              ${otherOptions}
            </select>
          </div>
        </div>
      </div>
    `;
    }).join('');
  }

  // Tab 2: Approved Users
  const approvedContainer = document.getElementById('approvedUsersList');
  let approvedHtml = '';

  // Box per aggiungere utente alla scuola (disponibile se in vista scuola o se c'è una scuola selezionata)
  const targetSchoolId = currentUsersData.school_id || (window.currentSchool && window.currentSchool.id);
  if (targetSchoolId && targetSchoolId !== 'none') {
    approvedHtml += `
      <div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:18px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:10px;color:var(--text-main);display:flex;align-items:center;gap:6px;">
          <span>➕</span> <span>${isEn ? 'Add Teacher / User to this School' : 'Aggiungi Docente / Utente a questo Istituto'}</span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <input type="email" id="newSchoolUserEmail" class="form-input" placeholder="email.docente@gmail.com" style="flex:2;min-width:210px;font-size:12px;padding:6px 10px;" />
          <input type="text" id="newSchoolUserName" class="form-input" placeholder="${isEn ? 'Teacher Name (Optional)' : 'Nome docente (facoltativo)'}" style="flex:2;min-width:180px;font-size:12px;padding:6px 10px;" />
          <select id="newSchoolUserRole" class="form-input" style="flex:1;min-width:130px;font-size:12px;padding:6px 10px;">
            <option value="editor" selected>✏️ Editor (${isEn ? 'Edit Timetable' : 'Modifica Orario'})</option>
            <option value="viewer">👁️ Viewer (${isEn ? 'Read Only' : 'Sola Lettura'})</option>
            <option value="admin">👑 Admin (${isEn ? 'School Admin' : 'Amministratore Scuola'})</option>
          </select>
          <button class="btn btn-primary btn-sm" onclick="addUserToSchool('${escapeHtml(targetSchoolId)}')" style="font-size:12px;padding:7px 16px;white-space:nowrap;font-weight:700;">
            ${isEn ? '➕ Add User' : '➕ Aggiungi'}
          </button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">
          ${isEn ? 'The user will be pre-authorized: logging in with their Google account grants immediate access with the selected role.' : 'L\'utente viene pre-autorizzato: al suo accesso con account Google entrerà subito nell\'istituto con il ruolo selezionato.'}
        </div>
      </div>
    `;
  }

  if (approved.length === 0) {
    approvedHtml += `<div style="text-align:center;padding:24px;color:#64748b;">${isEn ? 'No approved users for this school.' : 'Nessun utente autorizzato per questo istituto.'}</div>`;
  } else {
    approvedHtml += approved.map(u => {
      const isSuperUser = Boolean(u.is_superadmin);
      const isOwner = Boolean(u.is_school_owner);
      const lastLoginDate = u.last_login ? new Date(u.last_login).toLocaleString(isEn ? 'en-US' : 'it-IT') : 'N/D';
      const userSchoolId = u.school_id || targetSchoolId || '';
      const emailSafe = btoa(unescape(encodeURIComponent(u.email))).replace(/=/g, '');

      let membershipsHtml = '';
      if (isSuper && !isSchoolView && u.school_memberships) {
        if (u.school_memberships.length === 0) {
          membershipsHtml = `<div style="font-size:11px;color:#94a3b8;font-style:italic;margin-top:4px;">${isEn ? 'No assigned schools (Global platform user only)' : 'Nessun istituto assegnato (Solo utente piattaforma globale)'}</div>`;
        } else {
          membershipsHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center;">
            <span style="font-size:11px;color:var(--text-muted);font-weight:600;">${isEn ? 'Schools:' : 'Istituti:'}</span>` +
            u.school_memberships.map(m => {
              const roleBadgeColor = m.role === 'admin' ? 'background:#dbeafe;color:#1e40af;border:1px solid #93c5fd' : (m.role === 'editor' ? 'background:#e0e7ff;color:#3730a3;border:1px solid #c7d2fe' : 'background:#f1f5f9;color:#475569;border:1px solid #cbd5e1');
              return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;background:#f8fafc;border:1px solid #e2e8f0;padding:2px 8px;border-radius:6px;">
                <b>🏫 ${escapeHtml(m.school_name)}</b>
                <span style="font-size:9.5px;padding:1px 5px;border-radius:4px;${roleBadgeColor};font-weight:700;">${escapeHtml(m.role.toUpperCase())}</span>
                ${m.is_owner ? `<span title="Creatore Scuola" style="font-size:10px;">👑</span>` : ''}
                <button type="button" onclick="removeUserFromSchool('${escapeHtml(u.email)}', '${escapeHtml(m.school_id)}')" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:11px;padding:0 2px;margin-left:2px;font-weight:bold;" title="${isEn ? 'Remove from ' + escapeHtml(m.school_name) : 'Rimuovi da ' + escapeHtml(m.school_name)}">✕</button>
              </span>`;
            }).join('') +
          `</div>`;
        }

        if (currentUsersData.available_schools && currentUsersData.available_schools.length > 0) {
          const availSchools = currentUsersData.available_schools;
          membershipsHtml += `
            <div style="margin-top:8px;padding-top:6px;border-top:1px dashed var(--border);display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <span style="font-size:10.5px;font-weight:600;color:var(--text-muted);">➕ ${isEn ? 'Assign to school:' : 'Assegna a istituto:'}</span>
              <select id="quick-sch-${emailSafe}" class="form-input" style="padding:2px 6px;font-size:11px;width:auto;">
                ${availSchools.map(s => `<option value="${escapeHtml(s.id)}">🏫 ${escapeHtml(s.name)}</option>`).join('')}
              </select>
              <select id="quick-role-${emailSafe}" class="form-input" style="padding:2px 6px;font-size:11px;width:auto;">
                <option value="editor">✏️ Editor</option>
                <option value="viewer">👁️ Viewer</option>
                <option value="admin">👑 Admin</option>
              </select>
              <button class="btn btn-xs btn-sec" onclick="quickAssignUserToSchool('${escapeHtml(u.email)}', 'quick-sch-${emailSafe}', 'quick-role-${emailSafe}')" style="font-size:10.5px;padding:2px 8px;">
                ${isEn ? 'Assign' : 'Assegna'}
              </button>
            </div>
          `;
        }
      }

      return `
      <div class="user-item-card" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div class="user-card-left" style="display:flex;align-items:center;gap:12px;">
            ${u.picture ? `<img src="${u.picture}" class="user-card-avatar" alt="Avatar" style="width:38px;height:38px;border-radius:50%;" />` : `<div class="user-card-avatar" style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;background:var(--bg-hover);border-radius:50%;font-size:18px;">👤</div>`}
            <div class="user-card-info">
              <div class="user-card-name" style="font-weight:700;font-size:13px;color:var(--text-main);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                ${escapeHtml(u.name || u.email)}
                <span class="badge ${u.role === 'admin' ? 'badge-primary' : (u.role === 'editor' ? 'badge-info' : 'badge-sec')}" style="font-size:10px;">
                  ${u.role.toUpperCase()}
                </span>
                ${isOwner ? `<span class="badge badge-warn" style="font-size:10px;background:#fef3c7;color:#b45309;border:1px solid #f59e0b;padding:1px 6px;">👑 Creatore Scuola</span>` : ''}
                ${isSuperUser ? `<span class="badge badge-primary" style="font-size:10px;background:#e0e7ff;color:#3730a3;border:1px solid #6366f1;padding:1px 6px;">🌟 SuperAdmin</span>` : ''}
              </div>
              <div class="user-card-email" style="font-size:11.5px;color:var(--text-muted);font-family:var(--font-mono);">${escapeHtml(u.email)}</div>
              <div class="user-card-meta" style="font-size:10.5px;color:var(--text-sub);">${isEn ? 'Last login:' : 'Ultimo accesso:'} ${lastLoginDate}</div>
            </div>
          </div>
          <div class="user-card-actions" style="display:flex;gap:8px;align-items:center;">
            ${isSuperUser ? `<span style="font-size:11.5px;color:#4f46e5;font-weight:700;">${isEn ? 'Platform SuperAdmin' : 'SuperAdmin Piattaforma'}</span>` : `
              ${(isSchoolView || userSchoolId) ? `
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:11px;color:var(--text-muted);font-weight:600;">${isEn ? 'Role:' : 'Ruolo:'}</span>
                  <select class="form-input" style="padding:2px 8px;font-size:11.5px;font-weight:600;border-radius:6px;width:auto;" onchange="updateUserRole('${escapeHtml(u.email)}', this.value, '${escapeHtml(userSchoolId)}')">
                    <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>✏️ Editor</option>
                    <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>👁️ Viewer</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>👑 Admin</option>
                  </select>
                </div>
                <button class="btn btn-sm btn-outline-danger" onclick="removeUserFromSchool('${escapeHtml(u.email)}', '${escapeHtml(userSchoolId)}')" title="${isEn ? 'Remove user from this school' : 'Rimuovi accesso a questa scuola'}">
                  ❌ ${isEn ? 'Remove' : 'Rimuovi'}
                </button>
              ` : `
                <button class="btn btn-sm btn-outline-warning" onclick="revokeUser('${escapeHtml(u.email)}')">${isEn ? '⛔ Revoke' : '⛔ Revoca'}</button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${escapeHtml(u.email)}')">🗑️</button>
              `}
            `}
          </div>
        </div>
        ${membershipsHtml}
      </div>`;
    }).join('');
  }

  // Sezione Utenti Revocati o Disabilitati
  if (rejected.length > 0) {
    approvedHtml += `
      <div style="margin-top:24px;border-top:1px dashed var(--border);padding-top:16px;">
        <div style="font-size:13px;font-weight:700;color:var(--danger,#dc2626);margin-bottom:10px;display:flex;align-items:center;gap:6px;">
          <span>🚫</span> <span>${isEn ? 'Revoked / Disabled Users' : 'Utenti Revocati o Disabilitati'} (${rejected.length})</span>
        </div>
        ${rejected.map(u => {
          return `
            <div class="user-item-card" style="opacity:0.9;border-left:4px solid #dc2626;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;padding:10px 14px;background:var(--bg-hover);border-radius:8px;">
              <div class="user-card-left" style="display:flex;align-items:center;gap:10px;">
                <div class="user-card-avatar" style="width:34px;height:34px;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:16px;">🚫</div>
                <div class="user-card-info">
                  <div class="user-card-name" style="font-size:13px;font-weight:700;color:var(--text-main);">${escapeHtml(u.name || u.email)}</div>
                  <div class="user-card-email" style="font-size:11.5px;color:var(--text-muted);font-family:var(--font-mono);">${escapeHtml(u.email)}</div>
                </div>
              </div>
              <div class="user-card-actions" style="display:flex;gap:6px;align-items:center;">
                <button class="btn btn-sm btn-sec" onclick="reopenUser('${escapeHtml(u.email)}')">
                  🔄 ${isEn ? 'Re-open Request' : 'Rimetti in Attesa'}
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${escapeHtml(u.email)}')">
                  🗑️ ${isEn ? 'Delete' : 'Elimina'}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  approvedContainer.innerHTML = approvedHtml;
}

async function addUserToSchool(schoolId) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const emailInput = document.getElementById('newSchoolUserEmail');
  const nameInput = document.getElementById('newSchoolUserName');
  const roleInput = document.getElementById('newSchoolUserRole');
  const email = (emailInput?.value || '').trim();
  const name = (nameInput?.value || '').trim();
  const role = roleInput?.value || 'editor';

  if (!email || !email.includes('@')) {
    alert(isEn ? 'Please enter a valid Google email address.' : 'Inserisci un indirizzo email Google valido.');
    return;
  }

  try {
    const res = await fetch('/api/auth/users/add_to_school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, role, school_id: schoolId })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || (isEn ? 'Error adding user to school' : 'Errore durante l\'aggiunta dell\'utente'));
      return;
    }
    showToast(isEn ? `Teacher ${email} (${role.toUpperCase()}) added to school!` : `Docente ${email} (${role.toUpperCase()}) aggiunto alla scuola!`, 'ok');
    if (emailInput) emailInput.value = '';
    if (nameInput) nameInput.value = '';
    await loadUsersList(selectedAccessSchoolFilter || schoolId);
  } catch (e) {
    alert((isEn ? 'Connection error: ' : 'Errore di connessione: ') + e.message);
  }
}

async function removeUserFromSchool(email, schoolId) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (!confirm(isEn
    ? `Are you sure you want to remove ${email} from this school?`
    : `Sei sicuro di voler rimuovere ${email} da questo istituto scolastico? L'utente non potrà più accedere né modificare l'orario di questa scuola.`)) return;

  try {
    const res = await fetch('/api/auth/users/remove_from_school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, school_id: schoolId })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || (isEn ? 'Error removing user from school' : 'Errore durante la rimozione'));
      return;
    }
    showToast(isEn ? `User ${email} removed from this school` : `Utente ${email} rimosso dall'istituto`, 'ok');
    await loadUsersList(selectedAccessSchoolFilter || undefined);
  } catch (e) {
    alert((isEn ? 'Connection error: ' : 'Errore di connessione: ') + e.message);
  }
}

async function approveUser(email) {
  const emailSafe = btoa(unescape(encodeURIComponent(email))).replace(/=/g, '');
  const role = document.getElementById(`role-select-${emailSafe}`)?.value || 'editor';
  const target_school = document.getElementById(`school-select-${emailSafe}`)?.value || 'default';
  try {
    const res = await fetch('/api/auth/users/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role, target_school })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Errore durante l\'approvazione', 'error');
      return;
    }
    const msg = target_school === 'new_school'
      ? `Accesso autorizzato per ${email}: potrà definire la propria scuola autonoma!`
      : `Accesso sbloccato per ${email} (${role.toUpperCase()})!`;
    showToast(msg, 'ok');
    await loadUsersList();
  } catch (e) {
    showToast('Errore di rete: ' + e.message, 'error');
  }
}

async function rejectUser(email) {
  if (!confirm(`Sei sicuro di voler rifiutare la richiesta di accesso per ${email}?`)) return;
  try {
    const res = await fetch('/api/auth/users/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Errore durante il rifiuto', 'error');
      return;
    }
    showToast(`Richiesta di ${email} rifiutata.`, 'ok');
    await loadUsersList();
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
}

async function updateUserRole(email, newRole, schoolId) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  try {
    const res = await fetch('/api/auth/users/update_role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, role: newRole, school_id: schoolId })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || (isEn ? 'Error updating user role' : 'Errore modifica ruolo'), 'error');
      await loadUsersList(selectedAccessSchoolFilter || schoolId);
      return;
    }
    showToast(isEn ? `Role updated to ${newRole.toUpperCase()} for ${email}` : `Ruolo aggiornato a ${newRole.toUpperCase()} per ${email}`, 'ok');
    await loadUsersList(selectedAccessSchoolFilter || schoolId);
  } catch (e) {
    showToast((isEn ? 'Connection error: ' : 'Errore di connessione: ') + e.message, 'error');
  }
}

async function revokeUser(email) {
  if (!confirm(`Vuoi revocare immediatamente l'accesso a ${email}?`)) return;
  try {
    const res = await fetch('/api/auth/users/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Errore revoca', 'error');
      return;
    }
    showToast(`Accesso revocato per ${email}`, 'ok');
    await loadUsersList();
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
}

async function reopenUser(email) {
  try {
    const res = await fetch('/api/auth/users/reopen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Errore durante la riapertura della richiesta', 'error');
      return;
    }
    showToast(`Utente ${email} rimesso nelle Richieste in Attesa!`, 'ok');
    await loadUsersList();
    switchAccessTab('pending');
  } catch (e) {
    showToast('Errore di connessione: ' + e.message, 'error');
  }
}

async function deleteUser(email) {
  if (!confirm(`Eliminare definitivamente ${email} dall'elenco utenti?`)) return;
  try {
    await fetch('/api/auth/users/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    await loadUsersList();
    showToast(`Utente ${email} eliminato.`, 'ok');
  } catch (e) {
    showToast('Errore: ' + e.message, 'error');
  }
}

function populateConfigFields() {
  const gClient = document.getElementById('cfgGoogleClientId');
  if (gClient) gClient.value = currentUsersData.google_client_id || '';

  const cfg = currentUsersData.config || {};
  const smtp = cfg.smtp || {};

  const en = document.getElementById('cfgSmtpEnabled');
  if (en) en.checked = !!smtp.enabled;

  const host = document.getElementById('cfgSmtpHost');
  if (host) host.value = smtp.host || 'smtp.gmail.com';

  const port = document.getElementById('cfgSmtpPort');
  if (port) port.value = smtp.port || 587;

  const user = document.getElementById('cfgSmtpUser');
  if (user) user.value = smtp.user || '';

  const pass = document.getElementById('cfgSmtpPass');
  if (pass) pass.value = smtp.password || '';

  const passEmergency = document.getElementById('cfgEmergencyPasscode');
  if (passEmergency) passEmergency.value = cfg.emergency_passcode || '';
}

async function testSmtpEmail() {
  const smtpHost = document.getElementById('cfgSmtpHost')?.value.trim();
  const smtpPort = parseInt(document.getElementById('cfgSmtpPort')?.value || '587');
  const smtpUser = document.getElementById('cfgSmtpUser')?.value.trim();
  const smtpPass = document.getElementById('cfgSmtpPass')?.value.trim();

  if (!smtpUser || !smtpPass) {
    showToast('Inserisci prima l\'email mittente e la Password applicazione Google.', 'error');
    return;
  }

  showToast('Invio email di test in corso...', 'info');
  try {
    await fetch('/api/auth/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smtp: {
          enabled: true,
          host: smtpHost || 'smtp.gmail.com',
          port: smtpPort,
          user: smtpUser,
          password: smtpPass
        }
      })
    });

    const res = await fetch('/api/auth/smtp/test', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Errore durante l\'invio del test', 'error');
      return;
    }
    showToast('✅ Email di test inviata con successo! Controlla la posta.', 'ok');
  } catch (e) {
    showToast('Errore durante il test: ' + e.message, 'error');
  }
}

async function saveAccessConfig() {
  const gClient = document.getElementById('cfgGoogleClientId')?.value.trim();
  const pass = document.getElementById('cfgEmergencyPasscode')?.value.trim();
  const smtpEn = document.getElementById('cfgSmtpEnabled')?.checked;
  const smtpHost = document.getElementById('cfgSmtpHost')?.value.trim();
  const smtpPort = parseInt(document.getElementById('cfgSmtpPort')?.value || '587');
  const smtpUser = document.getElementById('cfgSmtpUser')?.value.trim();
  const smtpPass = document.getElementById('cfgSmtpPass')?.value.trim();

  const payload = {
    google_client_id: gClient,
    emergency_passcode: pass || undefined,
    smtp: {
      enabled: smtpEn,
      host: smtpHost || 'smtp.gmail.com',
      port: smtpPort,
      user: smtpUser,
      password: smtpPass
    }
  };

  try {
    const res = await fetch('/api/auth/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Errore salvataggio impostazioni', 'error');
      return;
    }
    showToast('Impostazioni salvate con successo!', 'ok');
    googleClientId = gClient;
    closeAccessManagementModal();
    if (gClient) {
      initGoogleButton(gClient);
    }
  } catch (e) {
    showToast('Errore salvataggio: ' + e.message, 'error');
  }
}

// --- GESTIONE SEZIONI ACCORDION SIDEBAR (MATERIAL DESIGN 3) ---
function getNavGroupsState() {
  try {
    const saved = localStorage.getItem('nav_groups_state');
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Errore parsing nav_groups_state:', e);
  }
  // Default: Anagrafiche aperta, altre sezioni secondarie chiuse
  return {
    reports: false,
    anagrafiche: true,
    vincoli: false,
    system: false
  };
}

function setNavGroupsState(state) {
  try {
    localStorage.setItem('nav_groups_state', JSON.stringify(state));
  } catch (e) {}
}

function toggleNavGroup(groupId, forceOpen) {
  const groupEl = document.getElementById('navGroup-' + groupId);
  if (!groupEl) return;
  const isCurrentlyCollapsed = groupEl.classList.contains('collapsed');
  const shouldOpen = (forceOpen !== undefined) ? forceOpen : isCurrentlyCollapsed;

  if (shouldOpen) {
    groupEl.classList.remove('collapsed');
  } else {
    groupEl.classList.add('collapsed');
  }
  const btn = groupEl.querySelector('.nav-group-header');
  if (btn) btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');

  const state = getNavGroupsState();
  state[groupId] = shouldOpen;
  setNavGroupsState(state);
}

function initNavGroups() {
  const state = getNavGroupsState();
  ['reports', 'anagrafiche', 'vincoli', 'system'].forEach(id => {
    const shouldOpen = (state[id] !== undefined) ? !!state[id] : (id === 'anagrafiche');
    const groupEl = document.getElementById('navGroup-' + id);
    if (groupEl) {
      if (shouldOpen) {
        groupEl.classList.remove('collapsed');
      } else {
        groupEl.classList.add('collapsed');
      }
      const btn = groupEl.querySelector('.nav-group-header');
      if (btn) btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }
  });
}

// --- GESTIONE FLYOUT POPOVER SOTTOMENU (MINI-RAIL 64px) ---
// Comportamento ibrido: apertura ritardata all'hover su desktop (200-300ms),
// apertura immediata e blocco persistente al clic, chiusura ritardata (300-500ms),
// supporto completo per touch e tastiera.
const HOVER_OPEN_DELAY = 220;
const HOVER_CLOSE_DELAY = 350;

let railFlyoutState = {
  currentGroup: null,
  isPersistent: false,
  openTimer: null,
  closeTimer: null,
  triggerEl: null
};

function isSidebarCollapsed() {
  const sb = document.getElementById('appSidebar');
  const wrapper = document.getElementById('sidebarWrapper');
  if (window.innerWidth < 768) return false;
  return wrapper ? wrapper.classList.contains('collapsed') : (sb ? sb.classList.contains('collapsed') : false);
}

function handleNavCategoryMouseEnter(groupId, triggerEl, event) {
  // Solo su desktop e quando la sidebar è in modalità mini-rail (64px)
  if (!isSidebarCollapsed()) return;
  if (event && event.pointerType === 'touch') return;
  if ('ontouchstart' in window && window.matchMedia('(pointer: coarse)').matches) return;

  // Se un popover è già persistente su un'altra categoria, non aprire al semplice passaggio
  if (railFlyoutState.isPersistent && railFlyoutState.currentGroup && railFlyoutState.currentGroup !== groupId) {
    return;
  }

  // Cancella eventuale timer di chiusura pendente
  if (railFlyoutState.closeTimer) {
    clearTimeout(railFlyoutState.closeTimer);
    railFlyoutState.closeTimer = null;
  }

  if (railFlyoutState.currentGroup === groupId) return;

  // Apertura ritardata (200–300 ms) per evitare aperture accidentali al passaggio rapido
  if (railFlyoutState.openTimer) clearTimeout(railFlyoutState.openTimer);
  railFlyoutState.openTimer = setTimeout(() => {
    openRailFlyout(groupId, triggerEl, false);
  }, HOVER_OPEN_DELAY);
}

function handleNavCategoryMouseLeave(groupId, triggerEl, event) {
  if (!isSidebarCollapsed()) return;
  if (event && event.pointerType === 'touch') return;

  // Cancella il timer di apertura se il cursore è uscito prima della scadenza
  if (railFlyoutState.openTimer) {
    clearTimeout(railFlyoutState.openTimer);
    railFlyoutState.openTimer = null;
  }

  // Se il popover è aperto in modalità persistente (bloccato da clic), non chiuderlo al mouseleave
  if (railFlyoutState.isPersistent) return;

  // Se aperto temporaneamente via hover, avvia timer di chiusura ritardata (300–500 ms)
  if (railFlyoutState.currentGroup === groupId) {
    if (railFlyoutState.closeTimer) clearTimeout(railFlyoutState.closeTimer);
    railFlyoutState.closeTimer = setTimeout(() => {
      closeRailFlyout(false);
    }, HOVER_CLOSE_DELAY);
  }
}

function handleNavCategoryClick(groupId, triggerEl, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  // Se la sidebar è APERTA (250px), usa il normale accordion inline
  if (!isSidebarCollapsed()) {
    toggleNavGroup(groupId);
    return;
  }

  // Modalità Mini-Rail 64px:
  // Clic = Apertura immediata (0 ms) e PERSISTENTE (bloccata)
  if (railFlyoutState.openTimer) {
    clearTimeout(railFlyoutState.openTimer);
    railFlyoutState.openTimer = null;
  }

  if (railFlyoutState.currentGroup === groupId && railFlyoutState.isPersistent) {
    // Secondo clic sulla stessa categoria: chiudi
    closeRailFlyout(true);
  } else {
    // Apri o scambia categoria in modalità persistente
    openRailFlyout(groupId, triggerEl, true);
  }
}

function handleNavCategoryKeyDown(groupId, triggerEl, event) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!isSidebarCollapsed()) {
      toggleNavGroup(groupId);
    } else {
      openRailFlyout(groupId, triggerEl, true);
      setTimeout(() => {
        const firstItem = document.querySelector('#flyoutItemsContainer .nav-item');
        if (firstItem) firstItem.focus();
      }, 40);
    }
  } else if (event.key === 'Escape') {
    closeRailFlyout(true);
  }
}

function handleFlyoutMouseEnter() {
  // Cursore dentro l'area del sottomenu flottante: mantieni aperto annullando il timer di chiusura
  if (railFlyoutState.closeTimer) {
    clearTimeout(railFlyoutState.closeTimer);
    railFlyoutState.closeTimer = null;
  }
}

function handleFlyoutMouseLeave() {
  // Se è persistente (bloccato da clic), non chiudere all'uscita del cursore
  if (railFlyoutState.isPersistent) return;

  // Uscita dall'intera area del menu: avvia chiusura ritardata
  if (railFlyoutState.closeTimer) clearTimeout(railFlyoutState.closeTimer);
  railFlyoutState.closeTimer = setTimeout(() => {
    closeRailFlyout(false);
  }, HOVER_CLOSE_DELAY);
}

// Apre la documentazione ufficiale sincronizzando automaticamente la lingua corrente dell'app
function openDocs(subpath = '') {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const baseUrl = isEn ? 'https://docs.eurario.it/en/' : 'https://docs.eurario.it/';
  const cleanSub = subpath ? (subpath.startsWith('/') ? subpath.slice(1) : subpath) : '';
  const url = `${baseUrl}${cleanSub}${cleanSub.includes('?') ? '&' : '?'}lang=${isEn ? 'en' : 'it'}`;
  window.open(url, '_blank', 'noopener');
}

// Definizione metadati ricchi voci sottomenu (Icona, Titolo, Descrizione / Sottotitolo)
const FLYOUT_GROUP_ITEMS = {
  reports: [
    {
      icon: '🖨️',
      title: 'Orario per Classe (PDF)',
      key: 'print_classes',
      desc: 'Stampa A4 orizzontale con articolazioni e intervalli',
      action: 'openPrintClassesModal()'
    },
    {
      icon: '📄',
      title: 'Tabellone Docenti (A3)',
      key: 'print_teachers',
      desc: 'Tabellone orizzontale completo con bande verticali (A3/PDF)',
      action: 'openPrintTeachersModal()'
    }
  ],
  anagrafiche: [
    {
      icon: '👨‍🏫',
      title: 'Docenti',
      key: 'teachers',
      desc: 'Organico docenti, cattedre e ore di insegnamento',
      view: 'teachers'
    },
    {
      icon: '🎓',
      title: 'Classi & Gruppi',
      key: 'classes',
      desc: 'Sezioni, articolazioni orarie e gruppi studenti',
      view: 'classes'
    },
    {
      icon: '📚',
      title: 'Materie',
      key: 'subjects',
      desc: 'Discipline scolastiche, codici e carichi orari',
      view: 'subjects'
    },
    {
      icon: '🏫',
      title: 'Plessi & Aule',
      key: 'rooms',
      desc: 'Sedi dell\'istituto, aule ordinarie e laboratori',
      view: 'rooms'
    },
    {
      icon: '📝',
      title: 'Attività / Cattedre',
      key: 'activities',
      desc: 'Insegnamenti, compresenze e cattedre FET',
      view: 'activities'
    },
    {
      icon: '🔗',
      title: 'Accorpamenti',
      key: 'accorpamenti',
      desc: 'Macro-materie (es. Italiano, Latino, Storia e Geo)',
      view: 'accorpamenti'
    }
  ],
  vincoli: [
    {
      icon: '📐',
      title: 'Regole Blocchi & Sezioni',
      key: 'block_rules',
      desc: 'Suddivisione blocchi orari e indirizzi sezioni',
      view: 'block_rules'
    },
    {
      icon: '🚫',
      title: 'Indisponibilità Griglia',
      key: 'availability',
      desc: 'Desiderata docenti, palestre e giorni liberi',
      view: 'availability'
    },
    {
      icon: '⚖️',
      title: 'Vincoli Orario',
      key: 'constraints',
      desc: 'Pesi percentuali, buchi e ore buche FET',
      view: 'constraints'
    }
  ],
  system: [
    {
      icon: '⚙️',
      title: 'Parametri Istituto',
      key: 'parameters',
      desc: 'Campanelle, sabati, pause e calendario scolastico',
      view: 'parameters'
    },
    {
      icon: '📦',
      title: 'Backup & Snapshot',
      key: 'snapshots',
      desc: 'Punti di ripristino, import/export FET e JSON',
      view: 'snapshots'
    },
    {
      icon: '👥',
      title: 'Gestione Accessi',
      key: 'access_mgmt',
      desc: 'Ruoli, permessi e approvazione utenti Google OAuth',
      action: 'openAccessManagementModal()',
      adminOnly: true
    },
    {
      icon: '📖',
      title: 'Documentazione',
      key: 'docs',
      desc: 'Guida utente, casi d\'uso e manuale vincoli FET',
      action: "openDocs()",
      external: true
    },
    {
      icon: 'ℹ️',
      title: 'Info & Crediti',
      key: 'about',
      desc: 'Versione FET 7.12, crediti e conformità GDPR',
      action: 'openAboutModal()'
    }
  ]
};

function openRailFlyout(groupId, triggerEl, isPersistent) {
  const popover = document.getElementById('railFlyoutPopover');
  const groupEl = document.getElementById('navGroup-' + groupId);
  if (!popover || !groupEl) return;

  railFlyoutState.currentGroup = groupId;
  railFlyoutState.isPersistent = !!isPersistent;
  railFlyoutState.triggerEl = triggerEl;

  const titleEl = groupEl.querySelector('.nav-group-title');
  const iconEl = groupEl.querySelector('.nav-group-icon');

  const flyoutTitle = document.getElementById('flyoutTitle');
  const flyoutIcon = document.getElementById('flyoutIcon');
  const flyoutItemsContainer = document.getElementById('flyoutItemsContainer');
  const pinBadge = document.getElementById('flyoutPinBadge');

  const groupLabel = window.I18N ? window.I18N.t('nav.' + groupId + '_group', titleEl ? titleEl.innerText : groupId) : (titleEl ? titleEl.innerText : groupId);
  if (flyoutTitle) flyoutTitle.innerText = groupLabel;
  if (flyoutIcon && iconEl) flyoutIcon.innerText = iconEl.innerText;
  if (pinBadge) pinBadge.style.display = isPersistent ? 'inline-block' : 'none';

  // Rendering ricco degli elementi con Icona + Titolo + Descrizione Estesa
  if (flyoutItemsContainer) {
    const items = FLYOUT_GROUP_ITEMS[groupId] || [];
    let html = '';
    const activeView = (typeof currentView !== 'undefined') ? currentView : '';
    const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;

    items.forEach(it => {
      if (it.adminOnly && (!currentUser || (currentUser.role !== 'admin' && !currentUser.is_school_admin && !currentUser.is_superadmin))) {
        return;
      }
      const isActive = Boolean(it.view && (
        it.view === activeView ||
        (it.view === 'snapshots' && (activeView === 'import_export' || activeView === 'import')) ||
        ((it.view === 'import_export' || it.view === 'import') && activeView === 'snapshots')
      ));
      const clickHandler = it.view ? `navigate('${it.view}'); closeRailFlyout(true);` : `${it.action}; closeRailFlyout(true);`;

      let badgeHtml = '';
      if (it.adminOnly) {
        const pCount = (currentUser && (currentUser.role === 'admin' || currentUser.is_school_admin || currentUser.is_superadmin) && latestPendingCount) ? latestPendingCount : 0;
        if (pCount > 0) {
          badgeHtml = `<span id="flyoutPendingBadge" class="badge-pending-count" style="display:inline-block;margin-left:auto;">${pCount}</span>`;
        }
      }
      if (isActive) {
        badgeHtml += `<span class="flyout-active-badge">✓ ${isEn ? 'Active' : 'Attiva'}</span>`;
      }

      const itemKey = it.key || it.view;
      const displayTitle = (itemKey && window.I18N) ? window.I18N.t('nav.' + itemKey, it.title) : it.title;
      const displayDesc = (itemKey && window.I18N) ? window.I18N.t('nav.' + itemKey + '_desc', it.desc) : it.desc;

      html += `
        <div class="flyout-item ${isActive ? 'active' : ''}" onclick="${clickHandler}" tabindex="0" role="button" aria-label="${escapeHtml(displayTitle)}">
          <span class="flyout-item-icon">${it.icon}</span>
          <div class="flyout-item-content">
            <div class="flyout-item-title-row">
              <span class="flyout-item-title">${escapeHtml(displayTitle)}</span>
              ${badgeHtml}
            </div>
            <div class="flyout-item-desc">${escapeHtml(displayDesc)}</div>
          </div>
          ${it.external ? '<span style="font-size:12px;opacity:0.7;margin-right:2px;font-weight:700;">↗</span>' : '<svg class="flyout-item-chevron" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>'}
        </div>
      `;
    });
    flyoutItemsContainer.innerHTML = html;

    // Gestione tastiera e accessibilità (Enter/Spazio per attivare, Esc per chiudere)
    flyoutItemsContainer.querySelectorAll('.flyout-item').forEach(item => {
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.click();
        } else if (e.key === 'Escape') {
          closeRailFlyout(true);
          triggerEl?.focus();
        }
      });
    });
  }

  // Evidenzia categoria attiva sul rail
  document.querySelectorAll('.nav-group-header').forEach(h => h.classList.remove('flyout-open'));
  triggerEl.classList.add('flyout-open');

  // Posiziona il sottomenu a destra della barra (left: 64px) allineato all'icona
  const rect = triggerEl.getBoundingClientRect();
  popover.style.display = 'flex';
  popover.style.visibility = 'hidden';

  requestAnimationFrame(() => {
    const popoverHeight = popover.offsetHeight || 260;
    const isUpward = (groupId === 'system') || ((rect.bottom + popoverHeight - 40) > window.innerHeight);

    if (isUpward) {
      // Apertura verso l'alto (Upward / Dropup): la base del popover si allinea al fondo del pulsante icona in basso
      const bottom = Math.max(8, window.innerHeight - rect.bottom);
      popover.style.top = 'auto';
      popover.style.bottom = bottom + 'px';
      popover.classList.add('popover-upward');
    } else {
      // Apertura standard verso il basso
      let top = rect.top - 4;
      const maxTop = window.innerHeight - popoverHeight - 14;
      if (top > maxTop) top = Math.max(10, maxTop);
      if (top < 10) top = 10;

      popover.style.bottom = 'auto';
      popover.style.top = top + 'px';
      popover.classList.remove('popover-upward');
    }

    popover.style.left = '64px';
    popover.style.visibility = 'visible';
  });
}

function closeRailFlyout(immediate) {
  if (railFlyoutState.openTimer) {
    clearTimeout(railFlyoutState.openTimer);
    railFlyoutState.openTimer = null;
  }
  if (railFlyoutState.closeTimer) {
    clearTimeout(railFlyoutState.closeTimer);
    railFlyoutState.closeTimer = null;
  }

  const popover = document.getElementById('railFlyoutPopover');
  if (popover) {
    popover.style.display = 'none';
    popover.classList.remove('popover-upward');
  }

  document.querySelectorAll('.nav-group-header').forEach(h => h.classList.remove('flyout-open'));

  railFlyoutState.currentGroup = null;
  railFlyoutState.isPersistent = false;
  railFlyoutState.triggerEl = null;
}

function updateRailActiveCategories() {
  document.querySelectorAll('.sidebar .nav-group').forEach(group => {
    const header = group.querySelector('.nav-group-header');
    const hasActiveChild = !!group.querySelector('.nav-group-items .nav-item.active');
    if (header) {
      if (hasActiveChild) {
        header.classList.add('has-active-child');
      } else {
        header.classList.remove('has-active-child');
      }
    }
  });
}

// Chiusura al clic esterno e tasto Escape
document.addEventListener('click', (e) => {
  if (!railFlyoutState.currentGroup) return;
  const popover = document.getElementById('railFlyoutPopover');
  if (popover && popover.contains(e.target)) return;
  if (railFlyoutState.triggerEl && railFlyoutState.triggerEl.contains(e.target)) return;
  closeRailFlyout(true);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && railFlyoutState.currentGroup) {
    closeRailFlyout(true);
  }
});

function applySidebarState(isCollapsed) {
  closeRailFlyout(true);
  const wrapper = document.getElementById('sidebarWrapper');
  const sb = document.getElementById('appSidebar');
  if (isCollapsed) {
    wrapper?.classList.add('collapsed');
    sb?.classList.add('collapsed');
  } else {
    wrapper?.classList.remove('collapsed');
    sb?.classList.remove('collapsed');
    // Quando la sidebar viene aperta, assicurati che il gruppo con l'elemento attivo sia espanso
    const activeItem = document.querySelector('.sidebar .nav-item.active');
    if (activeItem) {
      const parentGroup = activeItem.closest('.nav-group');
      if (parentGroup) {
        const groupId = parentGroup.getAttribute('data-group');
        if (groupId) {
          toggleNavGroup(groupId, true);
        }
      }
    }
  }
  updateSidebarPinUi(!isCollapsed);
  updateRailActiveCategories();
}

function updateSidebarPinUi(isPinned) {
  const pinBtn = document.getElementById('sidebarPinBtn');
  const hamBtn = document.getElementById('sidebarHamburgerBtn');
  if (pinBtn) {
    if (isPinned) {
      pinBtn.classList.add('pinned');
      pinBtn.setAttribute('title', 'Sblocca menu (passa a compresso con espansione al passaggio del mouse)');
      pinBtn.setAttribute('aria-label', 'Sblocca menu');
    } else {
      pinBtn.classList.remove('pinned');
      pinBtn.setAttribute('title', 'Fissa menu aperto');
      pinBtn.setAttribute('aria-label', 'Fissa menu');
    }
  }
  if (hamBtn) {
    hamBtn.setAttribute('title', isPinned ? 'Comprimi menu laterale' : 'Espandi e fissa menu laterale');
  }
}

function initSidebarResponsive() {
  const sb = document.getElementById('appSidebar');
  if (!sb) return;
  const w = window.innerWidth;
  const saved = localStorage.getItem('sidebar_collapsed');

  // Apertura di default dell'applicazione: menu collassato (mini-rail a sole icone a 68px con hover flyout),
  // a meno che l'utente non abbia esplicitamente cliccato sul pulsante pin o hamburger per fissarlo aperto (saved === '0').
  if (w >= 768) {
    const isCollapsed = (saved !== '0');
    applySidebarState(isCollapsed);
  } else {
    closeMobileSidebar();
  }
}

function handleSidebarResize() {
  const sb = document.getElementById('appSidebar');
  const wrapper = document.getElementById('sidebarWrapper');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (window.innerWidth > 768) {
    if (sb) sb.classList.remove('mobile-open');
    if (wrapper) wrapper.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
    const saved = localStorage.getItem('sidebar_collapsed');
    applySidebarState(saved !== '0');
  }
}

async function refreshAppState() {
  try {
    const res = await fetch('/api/summary');
    stateData.summary = await res.json();
    const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
    const b = document.getElementById('instBadge');
    const sName = document.getElementById('currentSchoolName');
    if (currentSchool && currentSchool.name) {
      if (b) b.innerText = currentSchool.name;
      if (sName) {
        sName.innerText = currentSchool.name;
        sName.title = currentSchool.name;
      }
    } else {
      if (b) b.innerText = '';
      if (sName) {
        const noSch = isEn ? 'No Institution' : 'Nessun Istituto';
        sName.innerText = noSch;
        sName.title = noSch;
      }
    }
    refreshDiagnosticsBadge();
  } catch (e) {
    console.error('Errore aggiornamento summary:', e);
  }
}

async function loadInitialData() {
  initSidebarResponsive();
  window.addEventListener('resize', handleSidebarResize);
  await loadMySchools();
  await refreshAppState();
  checkSoftwareUpdates();
  navigate('dashboard');
}

function toggleSidebarPin(forcePinned) {
  const sb = document.getElementById('appSidebar');
  const wrapper = document.getElementById('sidebarWrapper');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sb) return;

  if (window.innerWidth <= 768) {
    // Modalità Mobile: Drawer Overlay con Backdrop
    const shouldOpen = (forcePinned !== undefined) ? forcePinned : !sb.classList.contains('mobile-open');
    if (shouldOpen) {
      sb.classList.add('mobile-open');
      if (wrapper) {
        wrapper.classList.add('mobile-open');
        wrapper.classList.remove('collapsed');
      }
      sb.classList.remove('collapsed');
      if (backdrop) backdrop.classList.add('active');
    } else {
      closeMobileSidebar();
    }
    return;
  }

  // Modalità Desktop / Tablet: Toggle tra Fissato Aperto (Pinned, 256px) e Compresso con Hover (Collapsed, 68px)
  const isCurrentlyPinned = wrapper ? !wrapper.classList.contains('collapsed') : !sb.classList.contains('collapsed');
  const newPinnedState = (forcePinned !== undefined) ? forcePinned : !isCurrentlyPinned;

  applySidebarState(!newPinnedState);
  localStorage.setItem('sidebar_collapsed', newPinnedState ? '0' : '1');
}

function toggleSidebar(forceState) {
  toggleSidebarPin(forceState);
}

function closeMobileSidebar() {
  const sb = document.getElementById('appSidebar');
  const wrapper = document.getElementById('sidebarWrapper');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sb) sb.classList.remove('mobile-open');
  if (wrapper) wrapper.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
  if (window.innerWidth <= 768) {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved !== '0') {
      if (wrapper) wrapper.classList.add('collapsed');
      if (sb) sb.classList.add('collapsed');
    }
  }
}

// --- MODAL INFORMAZIONI SU EURARIO, CREDITI & CONFORMITÀ GDPR ---
function openAboutModal() {
  const m = document.getElementById('aboutModal');
  if (m) m.style.display = 'flex';
}

function closeAboutModal() {
  const m = document.getElementById('aboutModal');
  if (m) m.style.display = 'none';
}

// --- GESTIONE AGGIORNAMENTI (DOCKER HUB & GITHUB RELEASES) ---
let latestUpdateInfo = null;

async function checkSoftwareUpdates(force = false) {
  try {
    const url = force ? '/api/version/check?force=1' : '/api/version/check';
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    latestUpdateInfo = data;
    renderUpdateStatus(data);
    return data;
  } catch (err) {
    console.warn('Controllo aggiornamenti offline o non disponibile:', err);
    return null;
  }
}

function renderUpdateStatus(data) {
  if (!data) return;
  const badge = document.getElementById('sidebarStatusBadge');
  const dot = document.getElementById('statusIndicatorDot');
  const text = document.getElementById('statusIndicatorText');
  const verTag = document.getElementById('sidebarVerTag');
  const aboutVerStatus = document.getElementById('aboutUpdateStatusText');

  const curVer = (data && data.current_version) ? data.current_version : APP_VERSION;
  if (data && data.current_version) APP_VERSION = data.current_version;
  if (verTag) verTag.innerText = `v${curVer}`;

    const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
    if (data.update_available) {
    // 🔔 Aggiornamento disponibile su Docker Hub! Pallino arancione lampeggiante
    if (dot) {
      dot.className = 'status-indicator-dot dot-orange-blinking';
    }
    if (text) {
      text.innerText = `⬆️ v${data.remote_version} disp.`;
    }
    if (badge) {
      badge.classList.add('status-update-available');
      badge.title = isEn ? `New version v${data.remote_version} available on Docker Hub! Click to view update.` : `Nuova versione v${data.remote_version} disponibile su Docker Hub! Clicca per dettagli e comando di aggiornamento.`;
      badge.setAttribute('aria-label', `Nuova versione v${data.remote_version} disponibile`);
    }
    if (aboutVerStatus) {
      aboutVerStatus.innerHTML = `<span style="color:#b45309;font-weight:700;">⬆️ Nuova v${data.remote_version} disponibile!</span>`;
    }
  } else {
    // ✅ Nessun aggiornamento: pallino verde calmo e fisso
    if (dot) {
      dot.className = 'status-indicator-dot dot-green';
    }
    if (text) {
      text.innerText = 'FET 7.12';
    }
    if (badge) {
      badge.classList.remove('status-update-available');
      badge.title = isEn ? 'Check application & FET updates' : 'Verifica aggiornamenti applicazione e FET';
      badge.removeAttribute('aria-label');
    }
    if (aboutVerStatus) {
      aboutVerStatus.innerHTML = `<span style="color:#16a34a;font-weight:600;">✅ Release Stabile Aggiornata</span>`;
    }
  }
}

function handleFooterBadgeClick() {
  openUpdateModal();
}

function openUpdateModal() {
  const m = document.getElementById('updateModal');
  if (!m) return;
  m.style.display = 'flex';
  populateUpdateModal(latestUpdateInfo);
  if (!latestUpdateInfo) {
    checkUpdatesManually(false);
  }
}

function closeUpdateModal() {
  const m = document.getElementById('updateModal');
  if (m) m.style.display = 'none';
}

function populateUpdateModal(info) {
  const banner = document.getElementById('updateStatusBanner');
  const icon = document.getElementById('updateBannerIcon');
  const title = document.getElementById('updateBannerTitle');
  const desc = document.getElementById('updateBannerDesc');
  const curVer = document.getElementById('updateCurrentVer');
  const remVer = document.getElementById('updateRemoteVer');
  const remDate = document.getElementById('updateRemoteDate');
  const lastCheck = document.getElementById('updateLastCheckedTime');

  const currentVerStr = (info && info.current_version) ? info.current_version : APP_VERSION;
  if (info && info.current_version) APP_VERSION = info.current_version;
  if (curVer) curVer.innerText = `v${currentVerStr}`;
  if (lastCheck) lastCheck.innerText = info && info.checked_at ? info.checked_at : new Date().toLocaleTimeString();

  if (!info) {
    if (banner) {
      banner.style.background = '#f8fafc';
      banner.style.borderColor = '#e2e8f0';
    }
    if (icon) icon.innerText = '🔍';
    if (title) title.innerText = 'Controllo versione in corso...';
    if (desc) desc.innerText = 'Interrogazione di Docker Hub e GitHub...';
    if (remVer) remVer.innerText = '--';
    return;
  }

  if (remVer) remVer.innerText = info.remote_version ? `v${info.remote_version}` : 'latest';
  if (remDate) {
    if (info.docker_hub_last_updated) {
      const dt = new Date(info.docker_hub_last_updated);
      remDate.innerText = isNaN(dt.getTime()) ? info.docker_hub_last_updated : `Push: ${dt.toLocaleDateString()}`;
    } else {
      remDate.innerText = 'Docker Hub';
    }
  }

  const btnApply = document.getElementById('btnApplyUpdateNow');
  const btnApplyText = document.getElementById('btnApplyUpdateText');
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;

  if (info.update_available) {
    if (banner) {
      banner.style.background = '#fef3c7';
      banner.style.borderColor = '#fde68a';
    }
    if (icon) icon.innerText = '🚀';
    if (title) {
      title.innerText = `Nuova Versione v${info.remote_version} Disponibile!`;
      title.style.color = '#92400e';
    }
    if (desc) {
      desc.innerText = 'Una nuova build con miglioramenti e fix è pronta su Docker Hub per il download.';
      desc.style.color = '#b45309';
    }
    if (btnApply) {
      btnApply.disabled = false;
      btnApply.style.opacity = '1';
      btnApply.style.cursor = 'pointer';
      btnApply.title = isEn ? 'Trigger server update now' : 'Avvia subito l\'aggiornamento automatico sul server';
    }
    if (btnApplyText) {
      btnApplyText.innerText = isEn ? 'Update now' : 'Aggiorna ora';
    }
  } else {
    if (banner) {
      banner.style.background = '#f0fdf4';
      banner.style.borderColor = '#bbf7d0';
    }
    if (icon) icon.innerText = '✅';
    if (title) {
      title.innerText = 'Eurario è Aggiornato!';
      title.style.color = '#166534';
    }
    if (desc) {
      desc.innerText = `Sei all'ultima versione disponibile (v${currentVerStr}). Non sono richiesti aggiornamenti.`;
      desc.style.color = '#15803d';
    }
    if (btnApply) {
      btnApply.disabled = true;
      btnApply.style.opacity = '0.55';
      btnApply.style.cursor = 'not-allowed';
      btnApply.title = isEn ? 'No update available' : 'Nessun aggiornamento disponibile';
    }
    if (btnApplyText) {
      btnApplyText.innerText = isEn ? 'Update now' : 'Aggiorna ora';
    }
  }
}

async function triggerServerUpdate() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const btnApply = document.getElementById('btnApplyUpdateNow');
  const btnCopy = document.getElementById('btnCopyUpdateCmd');
  const btnForce = document.getElementById('btnForceCheckUpdate');
  const progBox = document.getElementById('updateProgressBox');

  const confirmMsg = window.I18N && window.I18N.t
    ? window.I18N.t('modals.updates.confirm_update')
    : (isEn 
        ? 'Do you want to start the automatic server update now? All school data, rosters, and timetables are safely preserved in persistent storage.' 
        : 'Vuoi avviare l\'aggiornamento automatico di Eurario sul server? Tutti i dati scolastici, le anagrafiche e gli orari sono al sicuro nei volumi persistenti.');
  
  if (!confirm(confirmMsg)) return;

  if (btnApply) {
    btnApply.disabled = true;
    btnApply.innerHTML = `<span>⏳ ${isEn ? 'Updating...' : 'Aggiornamento...'}</span>`;
  }
  if (btnCopy) btnCopy.disabled = true;
  if (btnForce) btnForce.disabled = true;

  if (progBox) {
    progBox.style.display = 'block';
    progBox.className = 'info-banner info-banner-blue';
    progBox.style.marginTop = '10px';
    progBox.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <span class="spinner" style="width:20px;height:20px;border-width:2.5px;flex-shrink:0;"></span>
        <div>
          <b>${isEn ? 'Server update in progress...' : 'Aggiornamento del server in corso...'}</b><br>
          <span style="font-size:11.5px;color:var(--text-muted);">${isEn ? 'Downloading new release and applying updates. Please do not close this window.' : 'Scaricamento della nuova versione e applicazione delle modifiche. Non chiudere questa finestra.'}</span>
        </div>
      </div>
    `;
  }

  try {
    const res = await fetch('/api/version/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      if (progBox) {
        progBox.className = 'info-banner info-banner-blue';
        progBox.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="spinner" style="width:20px;height:20px;border-width:2.5px;flex-shrink:0;"></span>
            <div>
              <b>${isEn ? 'Restarting service with new version...' : 'Riavvio del servizio con la nuova versione...'}</b><br>
              <span style="font-size:11.5px;color:var(--text-muted);">${isEn ? 'Reconnecting to the server...' : 'Verifica della riattivazione del server in corso...'}</span>
            </div>
          </div>
        `;
      }

      // Attesa e polling periodico per verificare quando il server è nuovamente online
      let reconnected = false;
      for (let attempt = 1; attempt <= 20; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const ping = await fetch('/api/version/check?force=1', { cache: 'no-store' });
          if (ping.ok) {
            reconnected = true;
            break;
          }
        } catch (e) {
          // In attesa del riavvio
        }
      }

      if (progBox) {
        progBox.className = 'info-banner';
        progBox.style.background = 'rgba(34, 197, 94, 0.15)';
        progBox.style.borderColor = 'rgba(34, 197, 94, 0.35)';
        progBox.style.borderLeft = '4px solid #16a34a';
        progBox.style.color = 'var(--text-main)';
        progBox.innerHTML = `
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-size:13.5px;font-weight:700;color:#16a34a;display:flex;align-items:center;gap:6px;">
                <span>✅</span> <span>${isEn ? 'Update completed successfully!' : 'Aggiornamento terminato con successo!'}</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">
                ${isEn ? 'The new version is installed and active on the server. Please reload the page to apply all changes.' : 'La nuova versione è installata e attiva sul server. Ricarica la pagina per iniziare a utilizzarla.'}
              </div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="window.location.reload(true)" style="padding:6px 14px;font-weight:700;white-space:nowrap;">
              🔄 ${isEn ? 'Reload Page Now' : 'Ricarica la Pagina Ora'}
            </button>
          </div>
        `;
      }

      if (btnApply) {
        btnApply.innerHTML = `<span>✅ ${isEn ? 'Completed' : 'Completato'}</span>`;
        btnApply.disabled = true;
      }
      if (btnCopy) btnCopy.disabled = false;
      if (btnForce) btnForce.disabled = false;
    } else {
      throw new Error(data.error || (isEn ? 'Server update failed.' : 'Aggiornamento fallito sul server.'));
    }
  } catch (err) {
    console.error('Update error:', err);
    if (progBox) {
      progBox.className = 'modal-notice';
      progBox.style.background = 'rgba(239, 68, 68, 0.15)';
      progBox.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      progBox.style.borderLeft = '4px solid #dc2626';
      progBox.style.color = 'var(--text-main)';
      progBox.innerHTML = `
        <div style="font-size:13px;font-weight:700;color:#dc2626;">
          ❌ ${isEn ? 'Could not complete automated update' : 'Impossibile completare l\'aggiornamento automatico'}
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">
          ${escapeHtml(err.message || String(err))}
        </div>
        <div style="font-size:11.5px;margin-top:6px;color:var(--text-sub);">
          💡 ${isEn ? 'You can apply the update manually via terminal using the command above.' : 'Puoi applicare l\'aggiornamento manualmente da terminale sul server usando il comando indicato sopra.'}
        </div>
      `;
    }
    if (btnApply) {
      btnApply.disabled = false;
      btnApply.innerHTML = `🚀 <span id="btnApplyUpdateText">${isEn ? 'Update now' : 'Aggiorna ora'}</span>`;
    }
    if (btnCopy) btnCopy.disabled = false;
    if (btnForce) btnForce.disabled = false;
  }
}

async function checkUpdatesManually(force = true) {
  const btn = document.getElementById('btnForceCheckUpdate');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Controllo...</span>';
  }

  populateUpdateModal(null);
  const data = await checkSoftwareUpdates(force);
  populateUpdateModal(data);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function copyDockerUpdateCmd() {
  const cmd = 'docker compose pull && docker compose up -d';
  navigator.clipboard.writeText(cmd).then(() => {
    const btn = document.getElementById('btnCopyUpdateCmd');
    if (btn) {
      const prev = btn.innerHTML;
      btn.innerHTML = '✅ Copiato!';
      btn.style.background = '#15803d';
      btn.style.borderColor = '#166534';
      setTimeout(() => {
        btn.innerHTML = prev;
        btn.style.background = 'rgba(255,255,255,0.12)';
        btn.style.borderColor = 'rgba(255,255,255,0.25)';
      }, 2000);
    }
  }).catch(() => {
    prompt('Copia il comando di aggiornamento:', cmd);
  });
}

// Chiusura modal tramite tasto Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAboutModal();
    closeUpdateModal();
    if (typeof closePrintClassesModal === 'function') closePrintClassesModal();
    if (typeof closePrintTeachersModal === 'function') closePrintTeachersModal();
    if (typeof closeAccessManagementModal === 'function') closeAccessManagementModal();
  }
});

// --- ROUTER & NAVIGAZIONE CON CRONOLOGIA (PULSANTE INDIETRO GLOBALE) ---
let navigationHistory = [];

const VIEW_TITLES = {
  dashboard: 'Dashboard Generale',
  timetable: 'Orario Risolto (Visual Explorer)',
  solver: 'Compilatore FET CLI 7.12.0',
  diagnostics: 'Pre-Validatore & Advisor Intelligente dei Vincoli',
  teachers: 'Gestione Docenti',
  classes: 'Gestione Classi & Gruppi',
  subjects: 'Gestione Materie',
  rooms: 'Gestione Plessi & Aule',
  activities: 'Attività & Cattedre',
  availability: 'Griglia Indisponibilità',
  constraints: 'Vincoli Algoritmo FET',
  accorpamenti: 'Gestione Accorpamenti Macro-Materie',
  block_rules: 'Regole Suddivisione Blocchi & Indirizzi Sezioni',
  parameters: 'Parametri Istituto & Calendario',
  snapshots: 'Backup, File & Punti di Ripristino (Snapshot)',
  import_export: 'Backup, File & Punti di Ripristino (Snapshot)'
};

const VIEW_SHORT_LABELS = {
  dashboard: 'Dashboard',
  timetable: 'Orario Risolto',
  solver: 'Compilatore FET',
  diagnostics: 'Diagnostica & Advisor',
  teachers: 'Docenti',
  classes: 'Classi & Gruppi',
  subjects: 'Materie',
  rooms: 'Plessi & Aule',
  activities: 'Attività / Cattedre',
  availability: 'Indisponibilità',
  constraints: 'Vincoli Orario',
  accorpamenti: 'Accorpamenti',
  block_rules: 'Regole Blocchi',
  parameters: 'Parametri Istituto',
  snapshots: 'Backup & Snapshot',
  import_export: 'Backup & Snapshot'
};

function getViewShortLabel(view) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (!isEn) return VIEW_SHORT_LABELS[view] || view;
  const enShort = {
    dashboard: 'Dashboard',
    timetable: 'Timetable',
    solver: 'FET Solver',
    diagnostics: 'Diagnostics & Advisor',
    teachers: 'Teachers',
    classes: 'Classes & Groups',
    subjects: 'Subjects',
    rooms: 'Rooms & Labs',
    activities: 'Activities / Teaching',
    availability: 'Availability',
    constraints: 'Constraints',
    accorpamenti: 'Macro-Subjects',
    block_rules: 'Block Rules',
    parameters: 'Parameters',
    snapshots: 'Snapshots & Backup',
    import_export: 'Snapshots & Backup'
  };
  return enShort[view] || VIEW_SHORT_LABELS[view] || view;
}

function updateNavBackButton() {
  const btn = document.getElementById('navBackBtn');
  const txt = document.getElementById('navBackText');
  if (!btn) return;
  if (navigationHistory.length > 0) {
    const prev = navigationHistory[navigationHistory.length - 1];
    btn.style.display = 'inline-flex';
    const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
    const backWord = isEn ? 'Back' : 'Indietro';
    const localizedLabel = getViewShortLabel(prev.view) || prev.label || (isEn ? 'Previous' : 'Precedente');
    if (txt) txt.innerText = `${backWord} (${localizedLabel})`;
    btn.title = isEn ? `Back to ${localizedLabel}` : `Torna a ${localizedLabel}`;
  } else {
    btn.style.display = 'none';
  }
}

function navigateBack() {
  if (navigationHistory.length === 0) return;
  const prev = navigationHistory.pop();
  if (prev.view === 'classes' && prev.activeClassSubView) {
    activeClassSubView = prev.activeClassSubView;
  }
  if (prev.view === 'teachers' && prev.currentTeacherFilterMode) {
    currentTeacherFilterMode = prev.currentTeacherFilterMode;
  }
  if (prev.view === 'availability') {
    if (prev.activeAvailMode) activeAvailMode = prev.activeAvailMode;
    if (prev.activeAvailLayout) activeAvailLayout = prev.activeAvailLayout;
    if (prev.activeAvailEntity) activeAvailEntity = prev.activeAvailEntity;
  }
  if (prev.view === 'activities') {
    if (prev.activityViewMode) activityViewMode = prev.activityViewMode;
    if (prev.activityExceptionFilter) activityExceptionFilter = prev.activityExceptionFilter;
  }
  navigate(prev.view, false);
}

function getNavReturnBarHtml(contextDesc = '') {
  if (!navigationHistory || navigationHistory.length === 0) return '';
  const prev = navigationHistory[navigationHistory.length - 1];
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const prevLabel = getViewShortLabel(prev.view) || prev.label || (isEn ? 'Previous' : 'Precedente');
  const backLabel = isEn ? `Back to ${escapeHtml(prevLabel)}` : `Torna a ${escapeHtml(prevLabel)}`;
  const hintLabel = isEn ? 'Contextual navigation &bull; Click to return' : 'Navigazione rapida contestuale &bull; Clicca per tornare al punto di partenza';
  return `
    <div class="nav-return-bar">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm btn-sec" onclick="navigateBack()" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;">
          <span>◀</span> ${backLabel}
        </button>
        ${contextDesc ? `<span style="font-size:13px;color:var(--text-sub);">${contextDesc}</span>` : ''}
      </div>
      <span style="font-size:11.5px;color:var(--text-muted);">
        ${hintLabel}
      </span>
    </div>
  `;
}

async function navigate(view, pushHistory = true, customLabel = null) {
  if (pushHistory && currentView && currentView !== view) {
    const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
    let lbl = customLabel || getViewShortLabel(currentView);
    if (currentView === 'classes' && typeof activeClassSubView !== 'undefined' && activeClassSubView === 'groups') {
      lbl = isEn ? 'Articulated Groups' : 'Gruppi Articolati';
    }
    navigationHistory.push({
      view: currentView,
      label: lbl,
      activeClassSubView: typeof activeClassSubView !== 'undefined' ? activeClassSubView : 'classes',
      currentTeacherFilterMode: typeof currentTeacherFilterMode !== 'undefined' ? currentTeacherFilterMode : 'all',
      activeAvailMode: typeof activeAvailMode !== 'undefined' ? activeAvailMode : 'teacher',
      activeAvailLayout: typeof activeAvailLayout !== 'undefined' ? activeAvailLayout : 'single',
      activeAvailEntity: typeof activeAvailEntity !== 'undefined' ? activeAvailEntity : '',
      activityViewMode: typeof activityViewMode !== 'undefined' ? activityViewMode : 'grouped',
      activityExceptionFilter: typeof activityExceptionFilter !== 'undefined' ? activityExceptionFilter : 'all'
    });
    if (navigationHistory.length > 25) {
      navigationHistory.shift();
    }
  }

  currentView = view;
  updateNavBackButton();

  if (mySchools && mySchools.length === 0 && (!currentUser || !currentUser.is_superadmin)) {
    renderOnboardingSchoolWelcome();
    return;
  }

  if (window.innerWidth <= 768) {
    closeMobileSidebar();
  }

  // Chiudi eventuale sottomenu flyout aperto
  closeRailFlyout(true);

  // Aggiorna classe active nella sidebar e auto-espandi il gruppo genitore se la sidebar è aperta
  document.querySelectorAll('.sidebar .nav-item').forEach(el => {
    el.classList.remove('active');
    const oc = el.getAttribute('onclick') || '';
    const isTarget = oc.includes(`'${view}'`) ||
                     oc.includes(`"${view}"`) ||
                     oc.includes(view) ||
                     (view === 'snapshots' && (oc.includes('import_export') || oc.includes('import'))) ||
                     ((view === 'import_export' || view === 'import') && oc.includes('snapshots'));
    if (isTarget) {
      el.classList.add('active');
      const parentGroup = el.closest('.nav-group');
      if (parentGroup && !isSidebarCollapsed()) {
        const groupId = parentGroup.getAttribute('data-group');
        if (groupId) {
          toggleNavGroup(groupId, true);
        }
      }
    }
  });

  // Aggiorna evidenziazione categoria attiva sul rail
  updateRailActiveCategories();

  const titleKey = 'nav.' + view + '_title';
  const translatedTitle = window.I18N ? window.I18N.t(titleKey, VIEW_TITLES[view] || 'Eurario') : (VIEW_TITLES[view] || 'Eurario');
  document.getElementById('pageTitle').innerText = translatedTitle;

  const container = document.getElementById('mainContent');
  if (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Caricamento dati in corso...</div>';
  }

  try {
    if (view === 'dashboard') await renderDashboard();
    else if (view === 'timetable') await renderTimetable();
    else if (view === 'solver') await renderSolver();
    else if (view === 'diagnostics') await renderDiagnostics();
    else if (view === 'teachers') await renderTeachers();
    else if (view === 'classes') await renderClasses();
    else if (view === 'subjects') await renderSubjects();
    else if (view === 'rooms') await renderRooms();
    else if (view === 'activities') await renderActivities();
    else if (view === 'accorpamenti') await renderAccorpamenti();
    else if (view === 'block_rules') await renderBlockRulesView();
    else if (view === 'availability') await renderAvailability();
    else if (view === 'constraints') await renderConstraints();
    else if (view === 'parameters') await renderParameters();
    else if (view === 'settings') await renderParameters();
    else if (view === 'snapshots' || view === 'import_export') await renderSnapshots();
  } catch (renderErr) {
    console.error(`Errore caricamento vista "${view}":`, renderErr);
    if (container) {
      container.innerHTML = `
        <div class="card" style="text-align:center;padding:36px;margin:20px auto;max-width:600px;">
          <div style="font-size:36px;margin-bottom:12px;">⚠️</div>
          <h3 style="margin-bottom:8px;">Errore nel caricamento della schermata</h3>
          <p style="color:var(--text-muted);font-size:13px;margin:0 0 16px;">${escapeHtml(renderErr.message || String(renderErr))}</p>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button class="btn btn-primary" onclick="navigate('dashboard', false)">🏠 Torna alla Dashboard</button>
            <button class="btn btn-sec" onclick="navigate('${escapeJs(view)}', false)">🔄 Riprova</button>
          </div>
        </div>
      `;
    }
  }
}

// --- ORDINAMENTO CLASSI PER SEZIONE / ANNO DI CORSO (es. 1A, 2A, 3A, 4A, 5A, 2B, 1C...) ---
function naturalClassCompare(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa && !sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;
  if (sa.startsWith('[') && !sb.startsWith('[')) return 1;
  if (!sa.startsWith('[') && sb.startsWith('[')) return -1;

  const firstA = sa.split('+')[0].trim();
  const firstB = sb.split('+')[0].trim();

  const ma = firstA.match(/^(\d+)\s*([A-Za-z])(.*)$/);
  const mb = firstB.match(/^(\d+)\s*([A-Za-z])(.*)$/);

  if (ma && mb) {
    const secA = ma[2].toUpperCase();
    const secB = mb[2].toUpperCase();
    if (secA !== secB) return secA.localeCompare(secB);

    const ya = parseInt(ma[1], 10);
    const yb = parseInt(mb[1], 10);
    if (ya !== yb) return ya - yb;

    const subA = (ma[3] || '').trim().toUpperCase();
    const subB = (mb[3] || '').trim().toUpperCase();
    if (subA !== subB) return subA.localeCompare(subB);

    return sa.localeCompare(sb);
  }
  return sa.localeCompare(sb);
}


// ============================================================================
// 1. DASHBOARD
// ============================================================================
async function renderDashboard() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const _t = (k, fb) => window.I18N ? window.I18N.t(k, fb) : fb;
  const res = await fetch('/api/summary');
  const s = await res.json();
  stateData.summary = s;

  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat-box clickable" onclick="navigate('teachers')" title="${isEn ? 'Click to manage teachers' : 'Clicca per gestire i docenti'}">
        <div class="stat-lbl">${isEn ? 'Faculty Staff' : 'Docenti in Organico'}</div>
        <div class="stat-val">👨‍🏫 ${s.teachers_count}</div>
        <div class="stat-box-link"><span>${s.disp_teachers_count ? `${s.disp_teachers_count} ${isEn ? 'with On-Duty (D)' : 'con Disposizione D'}` : (isEn ? 'Faculty Management' : 'Gestione Docenti')}</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('classes')" title="${isEn ? 'Click to manage classes and groups' : 'Clicca per gestire classi e gruppi'}">
        <div class="stat-lbl">${isEn ? 'Classes & Groups' : 'Classi Istituite'}</div>
        <div class="stat-val">🎓 ${s.classes_count}</div>
        <div class="stat-box-link"><span>${isEn ? 'Class Management' : 'Gestione Classi'}</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('rooms')" title="${isEn ? 'Click to manage rooms and labs' : 'Clicca per gestire aule, laboratori e plessi'}">
        <div class="stat-lbl">${isEn ? 'Rooms & Labs' : 'Aule e Laboratori'}</div>
        <div class="stat-val">🏢 ${s.rooms_count}</div>
        <div class="stat-box-link"><span>${isEn ? 'Campuses & Rooms' : 'Plessi & Aule'}</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('activities')" title="${isEn ? 'Click to manage teaching activities' : 'Clicca per gestire cattedre e attività'}">
        <div class="stat-lbl">${isEn ? 'Activities / Lessons' : 'Attività / Lezioni'}</div>
        <div class="stat-val">📋 ${s.activities_count}</div>
        <div class="stat-box-link"><span>${isEn ? 'Chairs & Blocks' : 'Cattedre & Blocchi'}</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('constraints')" title="${isEn ? 'Click to configure constraints' : 'Clicca per configurare vincoli e ore buche'}">
        <div class="stat-lbl">${isEn ? 'Weekly Hours' : 'Monte Ore Settimanale'}</div>
        <div class="stat-val">⏱️ ${s.total_weekly_hours} h</div>
        <div class="stat-box-link"><span>${s.total_disp_hours ? `+${s.total_disp_hours}h ${isEn ? 'On-duty D' : 'Disposizioni D'} (${s.total_target_hours || (s.total_weekly_hours + s.total_disp_hours)}h tot)` : (isEn ? 'FET Constraints' : 'Regole & Vincoli FET')}</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('timetable')" title="${isEn ? 'Click to view solved timetable' : 'Clicca per visualizzare l\'orario settimanale'}">
        <div class="stat-lbl">${isEn ? 'Timetable Status' : 'Stato Orario'}</div>
        <div class="stat-val" style="font-size: 19px; color: ${s.has_timetable ? 'var(--success)' : 'var(--warn)'};">
          ${s.has_timetable ? (isEn ? '✅ Solved (100%)' : '✅ Risolto (100%)') : (isEn ? '⚠️ Not Solved' : '⚠️ Non Risolto')}
        </div>
        <div class="stat-box-link"><span>${isEn ? 'View Timetable' : 'Vedi Orario'}</span> <span>→</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>${isEn ? 'Quick Actions' : 'Azioni Rapide'}</span>
        <span class="badge ${s.has_timetable ? 'badge-ok' : 'badge-warn'}">
          ${s.has_timetable ? (isEn ? 'Complete schedule available' : 'Orario completo disponibile') : (isEn ? 'Awaiting solve' : 'In attesa di risoluzione')}
        </span>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="navigate('solver')">⚡ ${_t('nav.solver', 'Compilatore FET')}</button>
        <button class="btn btn-sec" onclick="navigate('timetable')">🗓️ ${_t('nav.timetable', 'Orario Risolto')}</button>
        <button class="btn btn-sec" onclick="navigate('diagnostics')">🔍 ${_t('nav.diagnostics', 'Diagnostica & Advisor')}</button>
        <button class="btn btn-sec" onclick="navigate('snapshots')">📦 ${_t('nav.snapshots', 'Backup & Snapshot')}</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">${isEn ? 'Institution Structure Parameters' : 'Parametri di Struttura dell\'Istituto'}</div>
      <div style="display:grid;grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));gap:16px;">
        <div>
          <b>${isEn ? 'Institution Name:' : 'Nome Istituto:'}</b> ${escapeHtml(s.institution)}<br>
          <b>${isEn ? 'Active Campuses:' : 'Plessi attivi:'}</b> ${s.buildings_count} (${escapeHtml((s.buildings || ['Centrale', 'Succursale']).join(', '))})
        </div>
        <div>
          <b>${isEn ? 'Teaching Days:' : 'Giorni di Lezione:'}</b> ${(s.days || []).join(', ')} (${(s.days || []).length} ${isEn ? 'days' : 'giorni'})<br>
          <b>${isEn ? 'Daily Periods:' : 'Ore Giornaliere:'}</b> ${(s.hours || []).join(', ')} (${(s.hours || []).length} ${isEn ? 'periods' : 'fasce'})
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// 2. ORARIO RISOLTO (VISUAL EXPLORER)
// ============================================================================
let activeTimetableView = 'teacher'; // 'teacher' | 'class' | 'room'
let activeEntity = '';

async function renderTimetable() {
  const container = document.getElementById('mainContent');
  const res = await fetch('/api/timetable/views');
  const views = await res.json();
  stateData.timetableViews = views;

  // Rileva se ci sono attività orarie collocate (da views o summary)
  const hasPlacements = views.has_timetable || (views.total_placed > 0) || (stateData.summary && stateData.summary.has_timetable) || (Object.keys(views.by_teacher || {}).some(t => Object.values(views.by_teacher[t] || {}).some(d => Object.values(d || {}).some(slots => slots && slots.length > 0))));

  if (!hasPlacements) {
    const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;">
        <div style="font-size:36px;margin-bottom:10px;">📅</div>
        <h3>${isEn ? 'No solved timetable available yet' : 'Nessun orario risolto ancora disponibile'}</h3>
        <p style="color:var(--text-muted);margin:8px 0 20px;">${isEn ? 'Compile the timetable with FET CLI to view full grids for teachers, classes and rooms.' : "Compila l'orario con FET CLI per visualizzare le griglie complete di docenti, classi e aule."}</p>
        <button class="btn btn-primary" onclick="navigate('solver')">⚡ ${isEn ? 'Go to FET Solver' : 'Vai al Compilatore FET'}</button>
      </div>
    `;
    return;
  }

  // Pre-seleziona prima entità se non impostata o non valida per la vista corrente
  const teachers = Object.keys(views.by_teacher || {}).sort();
  const classes = Object.keys(views.by_class || {}).sort(naturalClassCompare);
  const rooms = Object.keys(views.by_room || {}).sort();

  // Filtraggio docenti se il filtro globale per materia è attivo
  const globalSubjFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim();
  let availableTeachers = teachers;
  if (globalSubjFlt) {
    const linked = new Set(getTeachersForGlobalSubject(globalSubjFlt));
    const fltList = teachers.filter(t => linked.has(t));
    if (fltList.length > 0) availableTeachers = fltList;
  }

  let listOptions = [];
  if (activeTimetableView === 'teacher') listOptions = availableTeachers;
  else if (activeTimetableView === 'class') listOptions = classes;
  else if (activeTimetableView === 'room') listOptions = rooms;

  if (!activeEntity || !listOptions.includes(activeEntity)) {
    activeEntity = listOptions.length ? listOptions[0] : '';
  }

  const curEntityIdx = listOptions.indexOf(activeEntity);
  const totalEntities = listOptions.length;

  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;

  // Statistiche docente se in vista docente
  let statsHtml = '';
  if (activeTimetableView === 'teacher' && views.teacher_stats && views.teacher_stats[activeEntity]) {
    const st = views.teacher_stats[activeEntity];
    const targetH = st.target_hours || 18;
    const teachH = st.teaching_lessons !== undefined ? st.teaching_lessons : st.total_lessons;
    const dispH = st.disp_lessons || 0;
    const totH = st.total_lessons || (teachH + dispH);
    statsHtml = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span class="badge badge-info" title="${isEn ? 'Front-line teaching lessons' : 'Ore di lezione frontale con studenti'}">${isEn ? 'Lesson hours:' : 'Ore lezione:'} <b>${teachH}h</b></span>
        ${dispH > 0 ? `<span class="badge badge-disp" style="padding:2px 8px;font-size:12px;font-weight:700;" title="${isEn ? 'On-duty / substitute hours' : 'Ore a disposizione / potenziamento'}">📌 ${isEn ? 'Duty:' : 'Disposizione:'} <b>${dispH}h</b></span>` : ''}
        <span class="badge ${totH >= targetH ? 'badge-ok' : 'badge-warn'}" title="${isEn ? `Scheduled ${totH}h out of ${targetH}h contractual target` : `Collocate ${totH}h su ${targetH}h contrattuali`}">${isEn ? 'Total:' : 'Totale:'} <b>${totH}h / ${targetH}h</b></span>
        <span class="badge ${st.total_gaps > 0 ? 'badge-warn' : 'badge-ok'}">${isEn ? 'Gap hours:' : 'Ore buche:'} <b>${st.total_gaps}</b></span>
        <span class="badge ${st.total_transfers > 0 ? 'badge-warn' : 'badge-ok'}">${isEn ? 'Building changes:' : 'Cambi plesso:'} <b>${st.total_transfers}</b></span>
      </div>
    `;
  }

  let classLockButtons = '';
  if (activeTimetableView === 'class' && activeEntity) {
    classLockButtons = `
      <button class="btn btn-sec btn-sm" onclick="lockCurrentClass(true)" title="${isEn ? `Lock all periods for class ${escapeHtml(activeEntity)} to preserve them in next FET calculation` : `Blocca tutte le ore della classe ${escapeHtml(activeEntity)} per preservarle nel prossimo calcolo FET`}">${isEn ? '🔒 Lock Class' : '🔒 Blocca Classe'}</button>
      <button class="btn btn-sec btn-sm" onclick="lockCurrentClass(false)" title="${isEn ? `Unlock all periods for class ${escapeHtml(activeEntity)}` : `Sblocca tutte le ore della classe ${escapeHtml(activeEntity)}`}">${isEn ? '🔓 Unlock Class' : '🔓 Sblocca Classe'}</button>
    `;
  }

  let lockedBadgeHtml = '';
  if (views.locked_count > 0) {
    lockedBadgeHtml = `
      <span class="badge badge-info" title="${isEn ? 'Total locked periods that will be preserved in FET run' : 'Numero totale di lezioni bloccate (fissate) che verranno preservate nel calcolo FET'}" style="display:inline-flex;align-items:center;gap:4px;">
        🔒 <b>${views.locked_count}</b> ${isEn ? (views.locked_count === 1 ? 'locked hour' : 'locked hours') : 'ore fissate'}
        <a href="javascript:void(0)" onclick="unlockAllActivities()" title="${isEn ? 'Unlock all locked hours across the school' : 'Sblocca tutte le ore bloccate dell\'istituto'}" style="color:inherit;margin-left:4px;text-decoration:none;font-weight:bold;">&times;</a>
      </span>
    `;
  }

  container.innerHTML = `
    ${getGlobalFilterBannerHtml()}
    <div class="toolbar">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div style="display:flex;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
          <button class="btn btn-sm ${activeTimetableView === 'teacher' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchTimetableMode('teacher')">👨‍🏫 ${isEn ? 'Teachers' : 'Docenti'}</button>
          <button class="btn btn-sm ${activeTimetableView === 'class' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchTimetableMode('class')">🎓 ${isEn ? 'Classes' : 'Classi'}</button>
          <button class="btn btn-sm ${activeTimetableView === 'room' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchTimetableMode('room')">🏫 ${isEn ? 'Rooms & Labs' : 'Aule & Palestre'}</button>
        </div>
        <select id="entitySelect" class="select-input" onchange="switchEntity(this.value)">
          ${listOptions.map(opt => `<option value="${escapeHtml(opt)}" ${opt === activeEntity ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}
        </select>

        <!-- Cursore e Stepper Rapido di Scorrimento Docenti (Mouse e Frecce ◀ ▶) -->
        <div class="timetable-stepper-wrap" title="${isEn ? 'Quickly browse entities: drag slider or use ◀ ▶ keyboard arrows' : 'Scorri velocemente: trascina il cursore o usa le frecce ◀ ▶ della tastiera'}">
          <button type="button" class="btn btn-sm btn-sec" style="padding:2px 7px;font-size:11px;font-weight:700;" onclick="stepEntity(-1)" ${curEntityIdx <= 0 ? 'disabled' : ''} title="${isEn ? 'Previous (or Left arrow ◀)' : 'Precedente (oppure premi Freccia Sinistra ◀)'}">◀</button>
          <input type="range" class="slider-quick-entity" min="0" max="${Math.max(0, totalEntities - 1)}" value="${curEntityIdx >= 0 ? curEntityIdx : 0}" oninput="onEntitySliderChange(this.value)" title="${isEn ? 'Drag to browse quickly' : 'Trascina il cursore per scorrere rapidamente'}">
          <button type="button" class="btn btn-sm btn-sec" style="padding:2px 7px;font-size:11px;font-weight:700;" onclick="stepEntity(1)" ${curEntityIdx >= totalEntities - 1 ? 'disabled' : ''} title="${isEn ? 'Next (or Right arrow ▶)' : 'Successivo (oppure premi Freccia Destra ▶)'}">▶</button>
          <span style="font-size:11px;font-weight:700;color:var(--text-sub);min-width:44px;text-align:center;">${curEntityIdx >= 0 ? curEntityIdx + 1 : 1}/${totalEntities}</span>
          <span style="font-size:10.5px;color:var(--text-sub);" title="${isEn ? 'Keyboard shortcut: press ◀ ▶ arrows' : 'Scorciatoia tastiera: premi le frecce ◀ ▶'}">⌨️ ◀ ▶</span>
        </div>

        ${classLockButtons}
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        ${statsHtml}
        ${lockedBadgeHtml}
        <button class="btn btn-sec btn-sm" onclick="recalcDisposizioni()" title="${isEn ? 'Recalculate and place on-duty periods post-FET' : 'Colloca o ricalcola le ore a disposizione post-calcolo FET (copre buchi orari, preferisce 1ª ora)'}">📍 ${isEn ? 'Recalculate On-Duty' : 'Ricalcola Disposizioni'}</button>
        <button class="btn btn-primary btn-sm" onclick="openPrintClassesModal()" title="${isEn ? 'Procedure 9: Print weekly timetable per class in A4 Landscape with articulated classes' : 'Procedura 9: Stampa orario settimanale per classe in A4 Landscape con classi articolate'}">🖨️ ${isEn ? 'Print Classes (PDF)' : 'Stampa Classi (PDF)'}</button>
        <button class="btn btn-sec btn-sm" onclick="openPrintTeachersModal()" title="${isEn ? 'Procedure 12: Generate faculty master board in A3 Landscape' : 'Procedura 12: Genera tabellone generale docenti in A3 Landscape con bande verticali'}">📄 ${isEn ? 'Faculty Board (A3)' : 'Tabellone Docenti (A3)'}</button>
      </div>
    </div>

    <div class="print-only print-title" style="display:none;margin-bottom:12px;">
      <h2 style="margin:0;font-size:18px;">${escapeHtml(stateData.summary.institution || (isEn ? 'School Institute' : 'Istituto Scolastico'))}</h2>
      <div style="font-size:14px;color:#333;margin-top:4px;">
        ${isEn ? 'Weekly Timetable' : 'Orario Settimanale Lezioni'} &mdash; <b>${activeTimetableView === 'teacher' ? (isEn ? 'Teacher: ' : 'Docente: ') : (activeTimetableView === 'class' ? (isEn ? 'Class: ' : 'Classe: ') : (isEn ? 'Room: ' : 'Aula: '))}${escapeHtml(activeEntity)}</b>
      </div>
    </div>

    <div class="card timetable-card" style="padding:0;overflow:visible;">
      <div class="grid-scroll-wrapper">
        ${renderTimetableGridHtml(views, activeTimetableView, activeEntity)}
      </div>
    </div>
  `;
}

async function toggleActivityLock(aid) {
  try {
    const res = await fetch('/api/timetable/toggle_lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity_id: aid })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.locked ? '🔒 Lezione bloccata! Verrà preservata nel calcolo FET.' : '🔓 Lezione sbloccata.', 'info');
      await renderTimetable();
    } else {
      alert("Errore: " + (data.error || 'Impossibile modificare il blocco'));
    }
  } catch (e) {
    alert("Errore di rete: " + e.message);
  }
}

async function lockCurrentClass(lockState) {
  if (!activeEntity || activeTimetableView !== 'class') return;
  try {
    const res = await fetch('/api/timetable/lock_class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_name: activeEntity, locked: lockState })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(lockState ? `🔒 Lezioni della classe ${activeEntity} bloccate! Verranno preservate nel calcolo FET.` : `🔓 Lezioni della classe ${activeEntity} sbloccate.`, 'success');
      await renderTimetable();
    } else {
      alert("Errore: " + (data.error || 'Impossibile bloccare la classe'));
    }
  } catch (e) {
    alert("Errore di rete: " + e.message);
  }
}

async function unlockAllActivities() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (!confirm(isEn ? "Unlock all previously locked periods across the entire timetable?" : "Sbloccare tutte le ore precedentemente fissate in tutto l'orario?")) return;
  try {
    const res = await fetch('/api/timetable/unlock_all', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(isEn ? `All periods unlocked (${data.unlocked_count} periods).` : `Tutte le ore sono state sbloccate (${data.unlocked_count} ore).`, 'info');
      await renderTimetable();
    }
  } catch (e) {
    alert((isEn ? 'Error: ' : 'Errore: ') + e.message);
  }
}

async function recalcDisposizioni() {
  try {
    const res = await fetch('/api/timetable/place_disposizioni', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Assegnate con successo ${data.placed_count} ore a disposizione (su ${data.total_disp_acts} totali)!`, 'success');
      await renderTimetable();
    } else {
      alert("Errore durante l'assegnazione delle disposizioni: " + (data.message || data.error || 'Errore sconosciuto'));
    }
  } catch (e) {
    alert("Errore di rete: " + e.message);
  }
}

function switchTimetableMode(mode) {
  activeTimetableView = mode;
  activeEntity = '';
  renderTimetable();
}

function switchEntity(entity) {
  activeEntity = entity;
  renderTimetable();
}

function stepEntity(delta) {
  const views = stateData.timetableViews;
  if (!views) return;
  let listOptions = [];
  if (activeTimetableView === 'teacher') listOptions = Object.keys(views.by_teacher || {}).sort();
  else if (activeTimetableView === 'class') listOptions = Object.keys(views.by_class || {}).sort(naturalClassCompare);
  else if (activeTimetableView === 'room') listOptions = Object.keys(views.by_room || {}).sort();

  const curIdx = listOptions.indexOf(activeEntity);
  const newIdx = curIdx + delta;
  if (newIdx >= 0 && newIdx < listOptions.length) {
    switchEntity(listOptions[newIdx]);
  }
}

function onEntitySliderChange(val) {
  const idx = parseInt(val, 10);
  const views = stateData.timetableViews;
  if (!views) return;
  let listOptions = [];
  if (activeTimetableView === 'teacher') listOptions = Object.keys(views.by_teacher || {}).sort();
  else if (activeTimetableView === 'class') listOptions = Object.keys(views.by_class || {}).sort(naturalClassCompare);
  else if (activeTimetableView === 'room') listOptions = Object.keys(views.by_room || {}).sort();

  if (idx >= 0 && idx < listOptions.length) {
    switchEntity(listOptions[idx]);
  }
}

// --- DRAG & DROP PER DISPOSIZIONI IN ORARIO RISOLTO ---
let draggedDisposizioneId = null;

function onDragStartDisposizione(event, aid) {
  draggedDisposizioneId = aid;
  event.dataTransfer.setData('text/plain', aid);
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.classList.add('is-dragging');
}

function onDragEndDisposizione(event) {
  draggedDisposizioneId = null;
  event.currentTarget.classList.remove('is-dragging');
  document.querySelectorAll('.tt-cell.drop-target').forEach(c => c.classList.remove('drop-target'));
}

function onDragOverTimetableSlot(event) {
  if (!draggedDisposizioneId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const cell = event.currentTarget;
  if (!cell.classList.contains('drop-target')) {
    cell.classList.add('drop-target');
  }
}

function onDragLeaveTimetableSlot(event) {
  event.currentTarget.classList.remove('drop-target');
}

async function onDropTimetableSlot(event, targetDay, targetHour) {
  event.preventDefault();
  event.currentTarget.classList.remove('drop-target');
  const aid = event.dataTransfer.getData('text/plain') || draggedDisposizioneId;
  if (!aid) return;

  try {
    const res = await fetch('/api/timetable/move_activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity_id: aid, day: targetDay, hour: targetHour })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`📍 Disposizione spostata con successo a ${targetDay} ${targetHour}ª ora!`, 'success');
      await renderTimetable();
    } else {
      alert("Impossibile spostare: " + (data.error || 'Errore durante lo spostamento'));
    }
  } catch (e) {
    alert("Errore di rete: " + e.message);
  }
}

async function openEditDispModal(aid, curDesc) {
  const newDesc = prompt("Personalizza la descrizione per quest'ora a disposizione (es. Lab, Sportello, Ricevimento, Biblioteca):\n(Verrà stampata al posto dello standard 'D' nel tabellone A3 e nei report. Lascia vuoto per il valore standard 'D')", curDesc || '');
  if (newDesc === null) return; // Annullato dall'utente

  try {
    const res = await fetch('/api/timetable/update_activity_desc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity_id: aid, custom_desc: newDesc.trim() })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(newDesc.trim() ? `Descrizione impostata su "${newDesc.trim()}" (visibile anche nelle stampe ufficiali)!` : 'Descrizione ripristinata a standard.', 'success');
      await renderTimetable();
    } else {
      alert("Errore salvataggio: " + (data.error || 'Errore'));
    }
  } catch (e) {
    alert("Errore di rete: " + e.message);
  }
}

function formatDayName(d, isShort = true) {
  if (!d) return '';
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const clean = String(d).trim().toLowerCase();
  
  if (clean.startsWith('lun') || clean.startsWith('mon')) {
    return isEn ? (isShort ? 'Mon' : 'Monday') : (isShort ? 'Lun' : 'Lunedì');
  }
  if (clean.startsWith('mar') || clean.startsWith('tue')) {
    return isEn ? (isShort ? 'Tue' : 'Tuesday') : (isShort ? 'Mar' : 'Martedì');
  }
  if (clean.startsWith('mer') || clean.startsWith('wed')) {
    return isEn ? (isShort ? 'Wed' : 'Wednesday') : (isShort ? 'Mer' : 'Mercoledì');
  }
  if (clean.startsWith('gio') || clean.startsWith('thu')) {
    return isEn ? (isShort ? 'Thu' : 'Thursday') : (isShort ? 'Gio' : 'Giovedì');
  }
  if (clean.startsWith('ven') || clean.startsWith('fri')) {
    return isEn ? (isShort ? 'Fri' : 'Friday') : (isShort ? 'Ven' : 'Venerdì');
  }
  if (clean.startsWith('sab') || clean.startsWith('sat')) {
    return isEn ? (isShort ? 'Sat' : 'Saturday') : (isShort ? 'Sab' : 'Sabato');
  }
  if (clean.startsWith('dom') || clean.startsWith('sun')) {
    return isEn ? (isShort ? 'Sun' : 'Sunday') : (isShort ? 'Dom' : 'Domenica');
  }
  return d;
}

function renderTimetableGridHtml(views, mode, entity) {
  const days = (views && views.days && views.days.length) ? views.days : (stateData.summary?.days || []);
  const hours = (views && views.hours && views.hours.length) ? views.hours : (stateData.summary?.hours || []);
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  let matrix = {};

  if (mode === 'teacher') matrix = (views.by_teacher || {})[entity] || {};
  else if (mode === 'class') matrix = (views.by_class || {})[entity] || {};
  else if (mode === 'room') matrix = (views.by_room || {})[entity] || {};

  const hourHeaderLbl = isEn ? 'Period' : 'Ora';
  let headerHtml = `<div class="tt-header" role="columnheader" style="background:#153d61;">${hourHeaderLbl}</div>` + days.map(d => `<div class="tt-header" role="columnheader">${escapeHtml(formatDayName(d, false))}</div>`).join('');
  let gridCols = `60px repeat(${days.length}, 1fr)`;

  let rowsHtml = '';
  for (const h of hours) {
    const isBreakHour = h.toUpperCase().startsWith('INT');
    let hourColLabel = h;
    if (isBreakHour) {
      hourColLabel = isEn ? 'Recess' : 'Intervallo';
    } else if (/^\d+$/.test(h)) {
      hourColLabel = isEn ? `P. ${h}` : `${h}ª ora`;
    }
    rowsHtml += `<div class="tt-hour-col ${isBreakHour ? 'is-break' : ''}" role="rowheader">${hourColLabel}</div>`;

    for (const d of days) {
      if (isBreakHour) {
        rowsHtml += `<div class="tt-cell is-break">${isEn ? 'RECESS' : 'INTERVALLO'}</div>`;
        continue;
      }

      const lessons = (matrix[d] && matrix[d][h]) ? matrix[d][h] : [];
      let cellInner = '';
      if (lessons.length > 0) {
        for (const l of lessons) {
          const isSucc = (l.building || '').toLowerCase().includes('succ');
          const isDisp = (l.subject || '').toLowerCase().startsWith('disposiz') || !!l.is_disposizione;
          const cardClass = isDisp ? 'disposizione' : (isSucc ? 'succursale' : 'centrale');
          const isLocked = !isDisp && !!l.locked;
          const customDesc = (l.custom_desc || '').trim();
          const dispFallback = isEn ? '🟡 On-Duty / Substitute' : '🟡 Disposizione';
          const subjName = l.subject; // Preserva fedelmente il nome reale della materia come da richiesta
          const displaySubj = isDisp ? (customDesc ? `🟡 ${escapeHtml(customDesc)}` : dispFallback) : escapeHtml(subjName);
          const dispMetaFallback = isEn ? 'On-duty hour' : 'A disposizione';
          const dispMeta = customDesc ? `${dispMetaFallback} (${escapeHtml(customDesc)})` : dispMetaFallback;

          cellInner += `
            <div class="lesson-card ${cardClass} ${isLocked ? 'is-locked' : ''}" 
                 id="tt_act_${l.activity_id}"
                 ${isDisp ? `
                   draggable="true" 
                   ondragstart="onDragStartDisposizione(event, '${l.activity_id}')"
                   ondragend="onDragEndDisposizione(event)"
                   title="${isEn ? 'Drag this on-duty hour to another slot, or click ✏️ to customize note' : 'Trascina quest\'ora a disposizione in un altro slot vuoto, oppure clicca ✏️ per rinominarla (es. Lab, Biblioteca)'}"
                 ` : ''}>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;">
                <div class="lesson-subj" style="${isDisp ? 'font-weight:700;color:#92400e;' : ''}">
                  ${displaySubj}
                </div>
                <div style="display:flex;align-items:center;gap:2px;">
                  ${isDisp ? `
                    <button type="button" class="btn-lock" style="font-size:9.5px;padding:1px 4px;color:#92400e;background:rgba(217,119,6,0.15);border:none;border-radius:3px;cursor:pointer;" onclick="openEditDispModal('${l.activity_id}', '${escapeJs(customDesc)}')" title="${isEn ? 'Edit custom label' : 'Personalizza descrizione da stampare (es. Lab, Sportello, Ricevimento)'}">✏️</button>
                  ` : `
                    <button type="button" class="btn-lock ${isLocked ? 'locked' : ''}" onclick="toggleActivityLock('${l.activity_id}')" title="${isLocked ? (isEn ? 'Locked slot: preserved during solve' : 'Ora bloccata: preservata nel prossimo calcolo FET. Clicca per sbloccare.') : (isEn ? 'Click to lock this slot' : 'Clicca per bloccare quest\'ora nel prossimo calcolo FET')}">${isLocked ? '🔒' : '🔓'}</button>
                  `}
                </div>
              </div>
              <div class="lesson-meta">
                <span>${isDisp ? dispMeta : (mode === 'teacher' ? (l.students || []).join('+') : ((l.teachers_short && l.teachers_short.length) ? l.teachers_short.join('+') : (l.teachers || []).join('+')))}</span>
                <span><b>${escapeHtml(l.room || '')}</b></span>
              </div>
            </div>
          `;
        }
        rowsHtml += `
          <div class="tt-cell" data-day="${d}" data-hour="${h}" 
               ondragover="onDragOverTimetableSlot(event)" 
               ondragleave="onDragLeaveTimetableSlot(event)" 
               ondrop="onDropTimetableSlot(event, '${d}', '${h}')">
            ${cellInner}
          </div>
        `;
      } else {
        const isBreak = (stateData.summary?.break_times || []).includes(`${d}|${h}`);
        if (isBreak) {
          const lbl = d === 'Sab' ? (isEn ? 'SATURDAY CLOSED' : 'SABATO CHIUSO') : (isEn ? 'BREAK' : 'PAUSA');
          rowsHtml += `<div class="tt-cell is-institute-break">${lbl}</div>`;
        } else {
          rowsHtml += `
            <div class="tt-cell" data-day="${d}" data-hour="${h}" 
                 ondragover="onDragOverTimetableSlot(event)" 
                 ondragleave="onDragLeaveTimetableSlot(event)" 
                 ondrop="onDropTimetableSlot(event, '${d}', '${h}')">
            </div>
          `;
        }
      }
    }
  }

  return `
    <div class="timetable-grid" role="grid" aria-label="${isEn ? 'Timetable grid' : 'Griglia orario'}" style="grid-template-columns: ${gridCols};">
      ${headerHtml}
      ${rowsHtml}
    </div>
  `;
}

// Navigazione rapida da tastiera (Frecce ◀ ▶) in Orario Risolto e Indisponibilità Singola
window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) return;

  if (typeof currentView !== 'undefined' && currentView === 'timetable') {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepEntity(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepEntity(1);
    }
  } else if (typeof currentView !== 'undefined' && currentView === 'availability' && typeof activeAvailLayout !== 'undefined' && activeAvailLayout === 'single') {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepAvailEntity(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepAvailEntity(1);
    }
  }
});

// ============================================================================
// 3. COMPILATORE FET CLI 7.12.0
// ============================================================================
let currentSolverLogMode = 'formatted'; // 'formatted' | 'raw'
let solverAutoScroll = true;
let cachedSolverStatus = null;

function renderSolver() {
  const _t = (k, fb) => window.I18N ? window.I18N.t(k, fb) : fb;
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>${escapeHtml(stateData.summary?.fet_title || (isEn ? 'FET Heuristic Compiler 7.12.0' : 'Solver FET CLI 7.12.0'))}</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <span id="solverStatusBadge" class="badge badge-ok">● ${isEn ? 'Solver Ready' : 'Solver Pronto'}</span>
          ${(stateData.summary?.locked_activities_count > 0) ? `<span class="badge badge-info" title="${isEn ? 'Locked lessons that will not be moved' : 'Ore fissate che non verranno spostate dal calcolo'}">🔒 <b>${stateData.summary.locked_activities_count}</b> ${stateData.summary.locked_activities_count === 1 ? (isEn ? 'locked lesson' : 'ora fissata') : (isEn ? 'locked lessons' : 'ore fissate')}</span>` : ''}
        </div>
      </div>
      <p style="color:var(--text-muted);margin-bottom:14px;">
        ${_t('solver.desc', 'Compilazione dell\'orario basata sull\'euristica a scambio ricorsivo (Recursive Swapping) di FET.')}
      </p>

      ${(stateData.summary?.locked_activities_count > 0) ? `
      <div class="modal-notice-info" style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:15px;">🔒</span>
          <span><b>${isEn ? 'Locked lessons active:' : 'Ore fissate attive:'}</b> ${stateData.summary.locked_activities_count} ${stateData.summary.locked_activities_count === 1 ? (isEn ? 'lesson is locked' : 'lezione è bloccata') : (isEn ? 'lessons are locked' : 'lezioni sono bloccate')}. ${isEn ? 'FET will strictly preserve their predetermined position during compilation.' : 'All\'avvio della compilazione, FET la manterrà rigorosamente nella posizione prefissata.'}</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sec btn-sm" style="font-size:11px;padding:2px 8px;" onclick="switchTimetableMode('class')">${isEn ? 'View in Timetable' : 'Visualizza in Orario'}</button>
          <button class="btn btn-sec btn-sm" style="font-size:11px;padding:2px 8px;" onclick="unlockAllActivities()">${isEn ? 'Unlock all' : 'Sblocca tutte'}</button>
        </div>
      </div>
      ` : ''}

      <!-- Pre-flight Diagnostic Alert Bar (Fase 2) -->
      <div id="preflightSolverBanner" style="margin-bottom:14px;"></div>

      <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
        <label style="font-size:12px;color:var(--text-muted);">
          ${isEn ? 'Max time (seconds):' : 'Tempo massimo (secondi):'}
          <input type="number" id="timelimitInput" value="3600" class="search-input" style="width:90px;margin-left:6px;">
        </label>
        <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;background:var(--bg-hover);padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--border);">
          <input type="checkbox" id="verboseLogInput" checked style="accent-color:var(--primary);">
          <span><b>${isEn ? 'Verbose Log (FET Desktop Style)' : 'Messaggi Verbosi (Stile Desktop App FET)'}</b></span>
        </label>
        <button id="btnStartSolve" class="btn btn-primary" onclick="startSolver()">${_t('solver.start_btn', '⚡ Avvia Compilazione Orario')}</button>
        <button id="btnStopSolve" class="btn btn-danger" onclick="stopSolver()" disabled>${_t('solver.stop_btn', '🛑 Interrompi Compilazione')}</button>
      </div>

      <!-- Live Activity Card (attiva durante l'elaborazione) -->
      <div id="liveActivityCard" style="display:none;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">🔄</span>
            <div>
              <div style="font-size:11px;text-transform:uppercase;color:var(--success);font-weight:700;">${isEn ? 'Placing activity (Recursive Swapping):' : 'Attività in collocamento (Scambio Ricorsivo):'}</div>
              <div id="liveActivityDesc" style="font-size:13px;font-weight:600;color:var(--text-main);">-</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;" id="liveActivityBadges"></div>
        </div>
      </div>

      <div class="bar-bg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="solverProgressBarAria" aria-label="${isEn ? 'Timetable compilation progress' : 'Avanzamento compilazione orario'}"><div id="solverFill" class="fill"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-top:6px;">
        <span id="solverLabel">0 / 0 ${isEn ? 'activities placed (0%)' : 'attività collocate (0%)'}</span>
        <span id="solverTimer">${_t('solver.current_time', 'Tempo trascorso:')} 00:00</span>
      </div>
    </div>

    <!-- Live FET Console (IN ALTO, prima dell'Advisor) -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <span>${isEn ? 'FET CLI Real-Time Log' : 'Log in tempo reale di FET CLI'}</span>
        <div style="display:flex;gap:8px;align-items:center;font-size:12px;flex-wrap:wrap;">
          <div style="display:flex;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
            <button id="btnLogModeDesktop" class="btn btn-sm ${currentSolverLogMode === 'formatted' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchLogMode('formatted')">🖥️ ${isEn ? 'Desktop Style' : 'Stile Desktop'}</button>
            <button id="btnLogModeRaw" class="btn btn-sm ${currentSolverLogMode === 'raw' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchLogMode('raw')">⚙️ Raw CLI Debug</button>
          </div>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--text-muted);font-size:11.5px;">
            <input type="checkbox" id="autoScrollLog" ${solverAutoScroll ? 'checked' : ''} onchange="solverAutoScroll = this.checked"> Auto-scroll
          </label>
          <button class="btn btn-sm btn-sec" onclick="copySolverLog()" title="${isEn ? 'Copy log to clipboard' : 'Copia log negli appunti'}">📋 ${isEn ? 'Copy' : 'Copia'}</button>
          <button class="btn btn-sm btn-sec" onclick="clearSolverConsole()" title="${isEn ? 'Clear console' : 'Svuota console'}">🧹 ${isEn ? 'Clear' : 'Pulisci'}</button>
        </div>
      </div>
      <div id="solverConsole" class="console" style="height:380px;" role="log" aria-live="polite" aria-atomic="false">${isEn ? 'Waiting for fet-cl execution...' : 'In attesa dell\'avvio di fet-cl...'}</div>
    </div>

    <!-- Bottleneck Alert Card (visibile se il calcolo si arresta su attività critica - SOTTO la console) -->
    <div id="bottleneckCard" style="display:none;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);border-radius:var(--radius-md);padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <span style="font-size:20px;">⚠️</span>
        <div style="flex:1;">
          <h4 style="margin:0 0 4px;color:var(--warn);font-size:14px;">${isEn ? 'FET Bottleneck Diagnostic (Desktop Style)' : 'Diagnostica Collo di Bottiglia FET (Stile Desktop App)'}</h4>
          <p id="bottleneckText" style="margin:0 0 8px;font-size:12.5px;color:var(--text-main);"></p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-primary" onclick="navigate('activities')">${isEn ? '📝 Go to Activities' : '📝 Vai ad Attività / Cattedre'}</button>
            <button class="btn btn-sm btn-sec" onclick="navigate('availability')">${isEn ? '📅 Check Availability' : '📅 Controlla Indisponibilità'}</button>
            <button class="btn btn-sm btn-sec" onclick="navigate('constraints')">${isEn ? '⚡ Relax Constraints' : '⚡ Riduci Peso Vincoli'}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Intelligent Advisor Live Card (SOTTO la console dei log) -->
    <div id="solverAdvisorCard" style="display:none;margin-bottom:16px;" class="advisor-box"></div>
  `;

  // Carica banner di pre-validazione
  loadPreflightSolverBanner();

  // Avvia il polling dello stato del solver
  pollSolverStatus();
  if (pollSolverTimer) clearInterval(pollSolverTimer);
  pollSolverTimer = setInterval(pollSolverStatus, 700);
}

function switchLogMode(mode) {
  currentSolverLogMode = mode;
  const btnDesktop = document.getElementById('btnLogModeDesktop');
  const btnRaw = document.getElementById('btnLogModeRaw');
  if (btnDesktop && btnRaw) {
    if (mode === 'formatted') {
      btnDesktop.className = 'btn btn-sm btn-primary';
      btnRaw.className = 'btn btn-sm btn-sec';
    } else {
      btnDesktop.className = 'btn btn-sm btn-sec';
      btnRaw.className = 'btn btn-sm btn-primary';
    }
  }
  if (cachedSolverStatus) {
    updateSolverConsoleHtml(cachedSolverStatus);
  }
}

function clearSolverConsole() {
  const cons = document.getElementById('solverConsole');
  if (cons) cons.innerText = '';
}

function copySolverLog() {
  const cons = document.getElementById('solverConsole');
  if (cons) {
    navigator.clipboard.writeText(cons.innerText || '')
      .then(() => showToast('Log copiato negli appunti!'))
      .catch(() => alert('Impossibile copiare il log negli appunti.'));
  }
}

async function startSolver() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const tl = parseInt(document.getElementById('timelimitInput').value || '3600');
  const verbose = document.getElementById('verboseLogInput') ? document.getElementById('verboseLogInput').checked : true;
  document.getElementById('btnStartSolve').disabled = true;
  document.getElementById('btnStopSolve').disabled = false;
  document.getElementById('solverStatusBadge').className = 'badge badge-warn';
  document.getElementById('solverStatusBadge').innerText = isEn ? '● Compiling...' : '● Compilazione in corso...';

  // Nascondi eventuale bottleneck card o advisor card precedente
  const bCard = document.getElementById('bottleneckCard');
  if (bCard) bCard.style.display = 'none';
  const aCard = document.getElementById('solverAdvisorCard');
  if (aCard) aCard.style.display = 'none';

  try {
    const res = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timelimit: tl, verbose: verbose })
    });
    const data = await res.json();
    if (data.status !== 'started') {
      alert((isEn ? 'Launch error: ' : 'Errore avvio: ') + (data.error || JSON.stringify(data)));
      document.getElementById('btnStartSolve').disabled = false;
      document.getElementById('btnStopSolve').disabled = true;
    } else {
      // Avvia immediatamente il polling ad alta frequenza del monitoraggio real-time
      if (pollSolverTimer) clearInterval(pollSolverTimer);
      pollSolverStatus();
      pollSolverTimer = setInterval(pollSolverStatus, 500);
    }
  } catch (e) {
    alert((isEn ? 'Solver error: ' : 'Errore chiamata solver: ') + e.message);
    document.getElementById('btnStartSolve').disabled = false;
    document.getElementById('btnStopSolve').disabled = true;
  }
}

async function stopSolver() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (confirm(isEn ? 'Do you want to stop FET CLI execution? The timetable and highest reached stage will be preserved.' : "Vuoi interrompere il calcolo di FET CLI? L'orario e lo stadio massimo raggiunto verranno preservati.")) {
    const btnStop = document.getElementById('btnStopSolve');
    if (btnStop) {
      btnStop.disabled = true;
      btnStop.innerText = isEn ? '🛑 Stopping...' : '🛑 Arresto in corso...';
    }
    try {
      await fetch('/api/solve/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false })
      });
      setTimeout(() => pollSolverStatus(), 250);
      setTimeout(() => {
        if (cachedSolverStatus && cachedSolverStatus.running) {
          fetch('/api/solve/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: true })
          }).then(() => pollSolverStatus());
        }
      }, 1000);
    } catch (e) {
      console.error('Stop solver error:', e);
      if (btnStop) {
        btnStop.disabled = false;
        btnStop.innerText = isEn ? '🛑 Force Stop' : '🛑 Forza Arresto';
      }
    }
  }
}

async function pollSolverStatus() {
  if (currentView !== 'solver') return;
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  try {
    const res = await fetch('/api/solve/status');
    const s = await res.json();
    cachedSolverStatus = s;

    const fill = document.getElementById('solverFill');
    const lbl = document.getElementById('solverLabel');
    const timer = document.getElementById('solverTimer');
    const badge = document.getElementById('solverStatusBadge');
    const btnStart = document.getElementById('btnStartSolve');
    const btnStop = document.getElementById('btnStopSolve');
    const liveCard = document.getElementById('liveActivityCard');
    const liveDesc = document.getElementById('liveActivityDesc');
    const liveBadges = document.getElementById('liveActivityBadges');
    const bCard = document.getElementById('bottleneckCard');
    const bText = document.getElementById('bottleneckText');

    if (!fill) return;

    const pct = s.percent || 0;
    fill.style.width = pct + '%';
    document.getElementById('solverProgressBarAria')?.setAttribute('aria-valuenow', Math.round(pct));
    const highestMsg = s.highest_placed && s.highest_placed > s.placed ? ` (Record: ${s.highest_placed})` : '';
    lbl.innerText = `${s.placed} / ${s.total} ${isEn ? 'activities placed' : 'attività collocate'} (${pct}%)${highestMsg}`;

    if (s.running) {
      currentSolverRunning = true;
      fill.className = 'fill';
      if (btnStart) btnStart.disabled = true;
      if (btnStop) btnStop.disabled = false;
      if (badge) {
        badge.className = 'badge badge-warn';
        badge.innerText = isEn ? '● Compiling...' : '● Compilazione in corso...';
      }

      // Aggiorna banner live attività corrente
      if (s.current_activity && liveCard && liveDesc) {
        liveCard.style.display = 'block';
        const ca = s.current_activity;
        liveDesc.innerText = `${isEn ? 'Activity' : 'Attività'} #${ca.id}: ${ca.subject} — ${ca.teachers}`;
        if (liveBadges) {
          liveBadges.innerHTML = `
            <span class="badge badge-info">${escapeHtml(ca.classes)}</span>
            <span class="badge badge-ok">${isEn ? 'Stage' : 'Stadio'} ${ca.stage}/${s.total}</span>
          `;
        }
      } else if (liveCard) {
        liveCard.style.display = 'none';
      }
      if (bCard) bCard.style.display = 'none';

      const advCard = document.getElementById('solverAdvisorCard');
      if (advCard) {
        if (s.advisor_recommendations && s.advisor_recommendations.length > 0) {
          advCard.style.display = 'block';
          advCard.innerHTML = renderAdvisorCardHtml(s.advisor_recommendations, true, s.advisor_report);
        } else {
          advCard.style.display = 'none';
        }
      }

    } else if (s.completed) {
      if (pollSolverTimer) {
        clearInterval(pollSolverTimer);
        pollSolverTimer = null;
      }
      if (btnStop) btnStop.disabled = true;
      if (btnStart) btnStart.disabled = false;
      if (liveCard) liveCard.style.display = 'none';

      if (s.success) {
        fill.className = 'fill ok';
        if (badge) {
          badge.className = 'badge badge-ok';
          badge.innerText = isEn ? '✅ 100% Solved' : '✅ Risolto al 100%';
        }
        if (bCard) bCard.style.display = 'none';
        if (stateData.summary) {
          stateData.summary.has_timetable = true;
          stateData.summary.placed_activities = s.placed;
        }
        await refreshAppState();

        const bannerSlot = document.getElementById('preflightSolverBanner');
        if (bannerSlot) {
          bannerSlot.className = '';
          bannerSlot.style.background = 'transparent';
          bannerSlot.style.border = 'none';
          bannerSlot.style.padding = '0';
          bannerSlot.innerHTML = `
            <div style="background:rgba(34,197,94,0.15);border:1.5px solid rgba(34,197,94,0.4);border-radius:var(--radius-md);padding:14px 18px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:24px;">🎉</span>
                <div>
                  <div style="font-weight:700;font-size:14px;color:var(--success);">${isEn ? 'Timetable calculation completed at 100%!' : 'Compilazione orario completata al 100%!'}</div>
                  <div style="font-size:12px;color:var(--text-muted);">${isEn ? 'All activities placed. You can now explore the full interactive timetable.' : 'Tutte le attività didattiche sono state collocate. Puoi ora esplorare l\'orario completo.'}</div>
                </div>
              </div>
              <button class="btn btn-primary" onclick="navigate('timetable')" style="font-weight:700;">
                🗓️ ${isEn ? 'View Timetable →' : 'Vai all\'Orario Risolto →'}
              </button>
            </div>
          `;
        }
      } else if (s.stopped) {
        fill.className = 'fill warn';
        if (badge) {
          badge.className = 'badge badge-warn';
          badge.innerText = isEn ? '⚠️ Stopped' : '⚠️ Interrotto';
        }
      } else {
        fill.className = 'fill err';
        if (badge) {
          badge.className = 'badge badge-err';
          badge.innerText = isEn ? '❌ No Solution (Timeout)' : '❌ Nessuna soluzione (Timeout)';
        }
      }

      // Se il calcolo non è riuscito ma nel sistema è stato preservato l'orario precedente
      if (!s.success && s.has_timetable) {
        const bannerSlot = document.getElementById('preflightSolverBanner');
        if (bannerSlot) {
          bannerSlot.className = '';
          bannerSlot.style.background = 'transparent';
          bannerSlot.style.border = 'none';
          bannerSlot.style.padding = '0';
          bannerSlot.innerHTML = `
            <div style="background:rgba(59,130,246,0.12);border:1.5px solid rgba(59,130,246,0.35);border-radius:var(--radius-md);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:22px;">🛡️</span>
                <div>
                  <div style="font-weight:700;font-size:13.5px;color:#1e40af;">${isEn ? 'Previous timetable preserved' : 'Orario precedente preservato'}</div>
                  <div style="font-size:12px;color:var(--text-muted);">${isEn ? 'FET did not finish, but your previous valid timetable was kept safe and untouched.' : 'Il calcolo non è terminato, ma il tuo orario precedente valido è rimasto intatto e attivo nel sistema.'}</div>
                </div>
              </div>
              <button class="btn btn-sec" onclick="navigate('timetable')" style="font-weight:600;font-size:12px;">
                🗓️ ${isEn ? 'View Active Timetable' : 'Visualizza Orario Attivo'}
              </button>
            </div>
          `;
        }
      }

      // Mostra collo di bottiglia se presente
      if (s.bottleneck && bCard && bText) {
        bCard.style.display = 'block';
        bText.innerHTML = isEn ? `
          FET placed up to <b>${s.highest_placed || s.placed} activities out of ${s.total}</b>.<br>
          The activity causing the generation block is:<br>
          <b>Activity #${escapeHtml(s.bottleneck.id)}</b>: <span style="font-family:var(--font-mono);">${escapeHtml(s.bottleneck.description)}</span>
        ` : `
          FET ha posizionato fino a <b>${s.highest_placed || s.placed} attività su ${s.total}</b>.<br>
          L'attività che causa il blocco della generazione è:<br>
          <b>Attività #${escapeHtml(s.bottleneck.id)}</b>: <span style="font-family:var(--font-mono);">${escapeHtml(s.bottleneck.description)}</span>
        `;
      }

      // Mostra raccomandazioni advisor se la soluzione è incompleta
      const advCard = document.getElementById('solverAdvisorCard');
      if (advCard) {
        if (!s.success && s.advisor_recommendations && s.advisor_recommendations.length > 0) {
          advCard.style.display = 'block';
          advCard.innerHTML = renderAdvisorCardHtml(s.advisor_recommendations, true, s.advisor_report);
        } else if (s.success) {
          advCard.style.display = 'none';
        }
      }
    }

    // Aggiorna Console
    updateSolverConsoleHtml(s);

    if (s.elapsed && timer) {
      const sec = Math.floor(s.elapsed);
      const m = Math.floor(sec / 60);
      const remSec = sec % 60;
      timer.innerText = `${isEn ? 'Elapsed time:' : 'Tempo trascorso:'} ${m < 10 ? '0' + m : m}:${remSec < 10 ? '0' + remSec : remSec}`;
    }
  } catch (e) {}
}

function updateSolverConsoleHtml(s) {
  const cons = document.getElementById('solverConsole');
  if (!cons) return;

  const logs = currentSolverLogMode === 'raw' ? (s.raw_logs || []) : (s.logs || []);
  if (logs.length > 0) {
    cons.innerText = logs.join('\n');
    if (solverAutoScroll) {
      cons.scrollTop = cons.scrollHeight;
    }
  }
}

// ============================================================================
// TOAST NOTIFICATIONS & CROSS-VIEW JUMP HELPERS
// ============================================================================
let pendingActivityFilter = null;

function showToast(message, type = 'ok') {
  let cont = document.querySelector('.toast-container');
  if (!cont) {
    cont = document.createElement('div');
    cont.className = 'toast-container';
    cont.setAttribute('role', 'status');
    cont.setAttribute('aria-live', 'polite');
    cont.setAttribute('aria-atomic', 'true');
    document.body.appendChild(cont);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.setAttribute('role', 'alert');
  const icon = type === 'ok' ? '✅' : (type === 'warn' ? '⚠️' : '❌');
  t.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
  cont.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 2400);
}

function jumpToActivities(filter) {
  pendingActivityFilter = filter;
  let sourceLabel = VIEW_SHORT_LABELS[currentView] || 'Precedente';
  if (filter.teacher) sourceLabel = `Docenti (${filter.teacher})`;
  else if (filter.className) sourceLabel = `Classi (${filter.className})`;
  else if (filter.subject) sourceLabel = `Materie (${filter.subject})`;
  navigate('activities', true, sourceLabel);
}

// ============================================================================
// FASE 2: PRE-VALIDATORE & ADVISOR INTELLIGENTE DEI VINCOLI
// ============================================================================
let currentDiagReport = null;
let currentAdvReport = null;
let currentDiagTab = 'all'; // 'all' | 'critical' | 'warning' | 'info' | 'rooms'

async function refreshDiagnosticsBadge() {
  try {
    const res = await fetch('/api/validator/report');
    if (!res.ok) return;
    const r = await res.json();
    const badge = document.getElementById('navHealthBadge');
    if (badge) {
      if (r.critical_count > 0) {
        badge.className = 'badge badge-sm badge-err';
        badge.innerText = '⛔ ' + r.critical_count;
        badge.title = `${r.critical_count} errori bloccanti`;
      } else if (r.warning_count > 0) {
        badge.className = 'badge badge-sm badge-warn';
        badge.innerText = r.health_score + '%';
        badge.title = `Salute: ${r.health_score}% (${r.warning_count} avvisi)`;
      } else {
        badge.className = 'badge badge-sm badge-ok';
        badge.innerText = r.health_score + '%';
        badge.title = `Salute: ${r.health_score}% (Pronto per FET)`;
      }
    }
  } catch (e) {}
}

async function loadPreflightSolverBanner() {
  const banner = document.getElementById('preflightSolverBanner');
  if (!banner) return;
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  try {
    const res = await fetch('/api/validator/report');
    if (!res.ok) return;
    const r = await res.json();
    if (r.critical_count > 0) {
      banner.className = 'preflight-solver-banner critical';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:22px;">⛔</span>
          <div>
            <b>${isEn ? `Detected ${r.critical_count} Blocking Mathematical Conflicts!` : `Rilevati ${r.critical_count} Conflitti Matematici Bloccanti!`}</b>
            <div style="font-size:12px;margin-top:2px;">${isEn ? 'Impossible constraints detected (overloaded teaching posts, insufficient time slots or overlapping rooms). FET will fail.' : 'Sono presenti vincoli impossibili (cattedre sovraccariche, slot orari insufficienti o aule in sovrapposizione). FET fallirà la risoluzione.'}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="navigate('diagnostics')" style="white-space:nowrap;font-weight:700;">🔍 ${isEn ? 'Fix in Diagnostics' : 'Risolvi nella Diagnostica'}</button>
      `;
    } else if (r.warning_count > 0) {
      banner.className = 'preflight-solver-banner warn';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;">⚠️</span>
          <div>
            <b>${isEn ? `Pre-Flight: ${r.warning_count} Potential Bottlenecks (Health: ${r.health_score}%)` : `Pre-Validazione: ${r.warning_count} Potenziali Colli di Bottiglia (Salute: ${r.health_score}%)`}</b>
            <div style="font-size:12px;margin-top:2px;">${isEn ? 'The model is solvable, but tight teacher or space margins may increase compilation times.' : 'Il progetto è risolvibile, ma alcuni docenti o spazi hanno margini ristretti che potrebbero allungare i tempi di compilazione.'}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-sec" onclick="navigate('diagnostics')" style="white-space:nowrap;">${isEn ? 'View Details' : 'Visualizza Dettagli'}</button>
      `;
    } else {
      banner.className = 'preflight-solver-banner ok';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;">✅</span>
          <div>
            <b>${isEn ? `Pre-Flight Passed Successfully (Health: ${r.health_score}%)` : `Pre-Validazione Superata con Successo (Salute: ${r.health_score}%)`}</b>
            <div style="font-size:12px;margin-top:2px;">${isEn ? 'No static or mathematical conflicts detected. Model is ready for FET compilation.' : 'Nessun conflitto statico o matematico rilevato. Il progetto è pronto per la compilazione FET 7.12.0.'}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-sec" onclick="navigate('diagnostics')" style="white-space:nowrap;">${isEn ? 'Full Report' : 'Report Completo'}</button>
      `;
    }
  } catch (e) {}
}

function renderAdvisorCardHtml(recommendations, isSolverView = false, advisorReport = null) {
  if (!recommendations || recommendations.length === 0) return '';
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;

  const rep = advisorReport || {};
  const rootCause = rep.root_cause_summary;
  const isErr = rep.root_cause_type && (rep.root_cause_type.includes('CRITICAL') || rep.root_cause_type.includes('CLASH'));

  let displayRootCause = rootCause || '';
  if (isEn && rootCause) {
    if (rep.root_cause_type === 'PREVENTIVE_WARNINGS' || rootCause.includes('potenziali colli di bottiglia')) {
      const match = rootCause.match(/Rilevati\s+(\d+)\s+potenziali/i);
      const count = match ? match[1] : '1';
      displayRootCause = `Detected ${count} potential bottleneck(s) (tight margins or strict constraints). Relaxing these upfront ensures immediate 100% completion.`;
    } else if (rep.root_cause_type === 'PREVENTIVE_CRITICAL_CONFLICTS' || rootCause.includes('conflitti matematici bloccanti')) {
      const match = rootCause.match(/Rilevati\s+(\d+)\s+conflitti/i);
      const count = match ? match[1] : 'multiple';
      displayRootCause = `Detected ${count} blocking mathematical conflict(s). FET cannot find any valid solution until these constraints are resolved.`;
    } else if (rep.root_cause_type === 'LOCKED_ACTIVITY_CLASH' || rootCause.includes('Lo stallo di FET è alimentato')) {
      displayRootCause = 'The FET deadlock is driven by a locked activity. Being locked in a fixed position, it prevents the algorithm from swapping periods to make room for remaining activities.';
    } else if (rep.root_cause_type === 'TEACHER_CLASS_BOTTLENECK' || rootCause.includes('intersezione oraria tra il docente')) {
      displayRootCause = `Primary bottleneck: timetable intersection between teacher '${rep.pivot_teacher || ''}' and class '${rep.pivot_class || ''}'. Constraints or unavailabilities leave very few compatible slots.`;
    } else if (rep.root_cause_type === 'TEACHER_TIGHT_SLOTS' || rootCause.includes('risulta presente nella maggior parte dei conflitti')) {
      displayRootCause = `Teacher '${rep.pivot_teacher || ''}' is involved in most swap conflicts. Their unavailabilities or day off excessively restrict degrees of freedom.`;
    } else if (rep.root_cause_type === 'CLASS_CONGESTION' || rootCause.includes('ha un calendario iper-vincolato')) {
      displayRootCause = `Class '${rep.pivot_class || ''}' has an overly constrained calendar that cannot fit assigned teachers into remaining slots.`;
    } else if (rep.root_cause_type === 'ROOM_CAPACITY' || rootCause.includes('spazi specifici a capienza limitata')) {
      displayRootCause = `Subject '${rep.pivot_subject || ''}' requires specific limited-capacity spaces (Gym / Lab) that are saturated or colliding on the required days.`;
    } else if (rep.root_cause_type === 'GLOBAL_CONSTRAINTS_DEADLOCK' || rootCause.includes('deadlock nei cicli di ricollocamento')) {
      displayRootCause = 'The FET algorithm reached a deadlock in recursive relocation cycles. Global constraints on gap hours and building change interval prevent alternative combinations.';
    } else if (rep.root_cause_type === 'READY' || rootCause.includes('Progetto matematicamente')) {
      displayRootCause = 'Model is mathematically balanced. No conflicts or bottlenecks detected.';
    }
  }

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:24px;">💡</span>
        <div>
          <h4 class="advisor-main-title" style="margin:0;font-size:15px;font-weight:800;">${isEn ? 'Intelligent Advisor — Diagnosis & Relaxation Engine' : 'Advisor Intelligente — Diagnosi & Relaxation Engine'}</h4>
          <div class="advisor-main-subtitle" style="font-size:12px;">${isEn ? 'Heuristic algorithm to eliminate bottlenecks and FET deadlocks:' : 'Algoritmo euristico per l\'eliminazione dei colli di bottiglia e deadlock FET:'}</div>
        </div>
      </div>
      ${isSolverView ? `<button class="btn btn-sm btn-sec" style="font-size:11.5px;" onclick="navigate('diagnostics')">🔍 ${isEn ? 'Open Full Diagnostics' : 'Apri Diagnostica Completa'}</button>` : ''}
    </div>

    ${displayRootCause ? `
      <div class="advisor-root-cause-box ${isErr ? 'err' : 'warn'}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:18px;">🎯</span>
          <b style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">${isEn ? 'Identified Root Cause:' : 'Causa Radice Identificata:'}</b>
        </div>
        <p style="margin:0;font-size:13px;line-height:1.45;">
          ${escapeHtml(displayRootCause)}
        </p>
      </div>
    ` : ''}

    ${(() => {
      window._advisorActions = window._advisorActions || {};
      recommendations.forEach(r => {
        if (r && r.id) {
          window._advisorActions[r.id] = { action_type: r.action_type, payload: r.action_payload };
        }
      });
      return '';
    })()}

    ${recommendations.map(r => {
      const lvl = r.level || 1;
      const lvlClass = `badge-level-${lvl}`;
      const isCombo = Boolean(r.is_combo);

      let title = r.title || '';
      let desc = r.description || '';
      let badge = r.badge || r.impact || '';
      let levelLabel = r.level_label || '';
      let btnText = r.button_text || (isEn ? 'Apply' : 'Applica');

      if (isEn) {
        levelLabel = lvl === 1 ? 'Level 1: Soft Relaxation' : (lvl === 2 ? 'Level 2: Targeted Flexibility' : 'Level 3: Unlock Fixed Constraints');
        if (r.id === 'relax_combo_level1') {
          title = '⚡ Apply Soft Relaxation Package (Gaps + Buildings)';
          desc = 'Increases daily gap tolerance (to 2h) and weekly gaps (to 3h) and removes mandatory building change gap. Instantly unlocks dozens of timetable combinations without altering teaching assignments or teacher preferences.';
          badge = 'Recommended Now';
          btnText = 'Apply All Level 1';
        } else if (r.id === 'relax_teacher_gaps_day') {
          const nv = r.action_payload?.new_val || 2;
          title = `Increase Max Daily Gaps for Teachers (from ${nv - 1} to ${nv})`;
          desc = `The constraint enforces max ${nv - 1} gap hour per day. Increasing tolerance to ${nv} gap hours increases FET exchange combinations by 400%.`;
          badge = 'Soft';
          btnText = `Relax to ${nv} gap hours`;
        } else if (r.id === 'relax_teacher_gaps_week') {
          const nv = r.action_payload?.new_val || 3;
          title = `Increase Max Weekly Gaps for Teachers (from ${nv - 1} to ${nv})`;
          desc = `The limit is set to only ${nv - 1} weekly gaps. A slight relaxation allows spreading lessons without infinite swap cycles.`;
          badge = 'Soft';
          btnText = `Relax to ${nv} hours/week`;
        } else if (r.id === 'relax_building_gaps') {
          title = 'Temporarily Remove Building Change Gap (from 1 to 0 hours)';
          desc = 'Currently requires 1 mandatory free period between Main and Branch buildings. Removing the gap allows FET to place consecutive periods for traveling teachers.';
          badge = 'Buildings';
          btnText = 'Remove Building Change Gap';
        } else if (r.id && r.id.startsWith('relax_unavail_')) {
          const tch = r.action_payload?.teacher || '';
          title = `Open 2 Available Hours for: ${tch}`;
          desc = `Teacher ${tch} has a high critical score with many unavailability hours set. Unlocking 2 slots allows the algorithm to place their schedule without chain conflicts.`;
          badge = 'Pivot Teacher';
          btnText = `Open 2 hours for ${tch.split(' ')[0]}`;
        } else if (r.id && r.id.startsWith('fix_locked_unavail_')) {
          const tch = r.action_payload?.teacher || '';
          title = `Remove Conflicting Unavailability: ${tch}`;
          desc = 'The locked activity conflicts with teacher unavailability at this time. Removing the unavailability instantly resolves the blocking mathematical conflict.';
          badge = 'Direct Conflict';
          btnText = `Unlock slot for ${tch.split(' ')[0]}`;
        } else if (r.id && r.id.startsWith('relax_min_days_')) {
          const tch = r.action_payload?.teacher || '';
          const nv = r.action_payload?.new_val || 4;
          title = `Reduce Minimum Attendance Days for: ${tch}`;
          desc = 'The minimum attendance days constraint is incompatible with allocated hours. Setting a compatible value resolves the deadlock.';
          badge = 'Min Days';
          btnText = `Reduce Min Days (${nv})`;
        } else if (r.id && r.id.startsWith('unlock_critical_act_')) {
          const aid = r.action_payload?.activity_id || '';
          title = `Unlock Locked Activity #${aid} (FET Deadlock Pivot)`;
          desc = 'This activity is locked in a fixed position by the user and was identified as the pivot of the deadlock. Unlocking it allows the algorithm to freely reallocate it and complete the timetable.';
          badge = 'Locked Period';
          btnText = `Unlock Activity #${aid}`;
        } else if (r.id && r.id.startsWith('unlock_chain_act_')) {
          const aid = r.action_payload?.activity_id || '';
          title = `Unlock Activity #${aid}`;
          desc = 'This activity is locked and part of the recursive swap cycle hindering convergence.';
          badge = 'Locked Period';
          btnText = `Unlock #${aid}`;
        } else if (r.id && r.id.startsWith('resolve_clash_')) {
          const aid = r.action_payload?.activity_id || '';
          title = `Resolve Overlap Conflict for #${aid}`;
          desc = 'Two locked activities were placed at the exact same time for the same entity. Unlocking one removes the block.';
          badge = 'Double Assignment';
          btnText = `Unlock #${aid}`;
        }
      }

      return `
        <div class="advisor-rec-card" style="${isCombo ? 'border: 2px solid #10b981; background: var(--bg-hover);' : ''}">
          <div class="advisor-rec-header">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="${lvlClass}">L${lvl}</span>
              <b style="font-size:14px;color:var(--text-main);">${escapeHtml(title)}</b>
              <span class="badge badge-${r.badge_color || 'info'}">${escapeHtml(badge)}</span>
            </div>
            ${levelLabel ? `<span style="font-size:11px;color:#64748b;font-weight:600;">${escapeHtml(levelLabel)}</span>` : ''}
          </div>
          <p class="advisor-rec-desc">${escapeHtml(desc)}</p>
          <div class="advisor-rec-actions">
            ${isSolverView ? `
              <button type="button" class="btn btn-sm ${isCombo ? 'btn-primary' : 'btn-primary'}" 
                      style="font-size:12.5px;white-space:nowrap;font-weight:700;display:inline-flex;align-items:center;gap:6px;${isCombo ? 'background: linear-gradient(135deg, #059669 0%, #10b981 100%);box-shadow: 0 2px 6px rgba(16,185,129,0.3);' : ''}" 
                      onclick="applyAdvisorAction('${escapeHtml(r.id)}', true, this)">
                ⚡ ${escapeHtml(btnText)} ${isEn ? '& Restart Solver' : 'e Riavvia Solutore'}
              </button>
            ` : `
              <button type="button" class="btn btn-sm btn-primary" 
                      style="font-size:12px;white-space:nowrap;font-weight:700;display:inline-flex;align-items:center;gap:6px;" 
                      onclick="applyAdvisorAction('${escapeHtml(r.id)}', false, this)">
                ⚡ ${escapeHtml(btnText)}
              </button>
              <button type="button" class="btn btn-sm btn-sec" 
                      style="font-size:12px;white-space:nowrap;font-weight:600;display:inline-flex;align-items:center;gap:6px;" 
                      onclick="applyAdvisorAction('${escapeHtml(r.id)}', true, this)">
                🚀 ${isEn ? 'Apply & Start FET' : 'Applica & Avvia FET'}
              </button>
            `}
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function applyAdvisorAction(recId, restartSolver = false, btn = null) {
  const item = (window._advisorActions && window._advisorActions[recId]) || null;
  if (!item) {
    console.error("Action not found for advisor rec:", recId);
    showToast("Opzione non trovata o già applicata", "warn");
    return;
  }
  applyAdvisorRelaxation(item.action_type, item.payload, restartSolver, btn);
}

async function applyAdvisorRelaxation(actionType, payload, restartSolver = false, callerBtn = null) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const btn = callerBtn || (window.event && window.event.currentTarget) || null;
  if (btn) {
    btn.disabled = true;
    btn.innerText = isEn ? 'Applying...' : 'Applicazione in corso...';
  }
  try {
    const res = await fetch('/api/advisor/apply_relax', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      cache: 'no-cache',
      body: JSON.stringify({
        action_type: actionType,
        payload: payload,
        restart_solver: restartSolver,
        lang: isEn ? 'en' : 'it'
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      let errMsg = errText;
      try {
        const j = JSON.parse(errText);
        errMsg = j.error || j.message || errText;
      } catch (_) {}
      throw new Error(errMsg || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.status === 'ok') {
      showToast(data.message || (isEn ? 'Constraint updated successfully!' : 'Vincolo aggiornato con successo!'), 'ok');
      await refreshDiagnosticsBadge();
      if (restartSolver) {
        navigate('solver');
        if (!data.restarted) {
          setTimeout(() => {
            startSolver();
          }, 300);
        } else {
          if (pollSolverTimer) clearInterval(pollSolverTimer);
          pollSolverStatus();
          pollSolverTimer = setInterval(pollSolverStatus, 500);
        }
      } else {
        renderDiagnostics(currentDiagTab);
      }
    } else {
      alert((isEn ? 'Error: ' : 'Errore: ') + (data.error || (isEn ? 'Operation failed' : 'Operazione fallita')));
      if (btn) {
        btn.disabled = false;
        btn.innerText = isEn ? 'Retry' : 'Riprova';
      }
    }
  } catch (e) {
    console.error('Advisor apply_relax error:', e);
    const msg = (e && e.message === 'Load failed') 
      ? (isEn ? 'Network timeout or solver is restarting. Check the Solver tab.' : 'Timeout di rete o solutore in fase di riavvio. Controlla la scheda Compilatore FET.')
      : ((isEn ? 'Error: ' : 'Errore: ') + (e ? e.message : 'Unknown error'));
    alert(msg);
    if (btn) {
      btn.disabled = false;
      btn.innerText = isEn ? 'Retry' : 'Riprova';
    }
  }
}

async function renderDiagnostics(tab = 'all') {
  currentDiagTab = tab;
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const container = document.getElementById('mainContent');
  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">${isEn ? 'Running algebraic scan and verifying constraints...' : 'Esecuzione scansione algebrica e verifica vincoli in corso...'}</div>`;

  try {
    const [valRes, advRes] = await Promise.all([
      fetch('/api/validator/report'),
      fetch('/api/advisor/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: isEn ? 'en' : 'it' })
      })
    ]);
    currentDiagReport = await valRes.json();
    currentAdvReport = await advRes.json();

    refreshDiagnosticsBadge();
    renderDiagnosticsContent();
  } catch (e) {
    container.innerHTML = `<div class="card" style="padding:24px;color:var(--danger);">${isEn ? 'Error loading diagnostics:' : 'Errore durante il caricamento della diagnostica:'} ${escapeHtml(e.message)}</div>`;
  }
}

function setDiagnosticsTab(tab) {
  currentDiagTab = tab;
  renderDiagnosticsContent();
}

function formatFeasibilityStatus(st, isEn) {
  if (!isEn || !st) return st;
  const map = {
    'OTTIMO': 'EXCELLENT',
    'BUONO': 'GOOD',
    'ATTENZIONE': 'WARNING',
    'CRITICO': 'CRITICAL',
    'RISOLTO': 'SOLVED',
    'NON RISOLTO': 'NOT SOLVED'
  };
  return map[st.toUpperCase()] || st;
}

function renderDiagnosticsContent() {
  const container = document.getElementById('mainContent');
  if (!currentDiagReport) return;
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const rep = currentDiagReport;
  const adv = currentAdvReport || { recommendations: [] };

  const score = rep.health_score || 0;
  let scoreClass = 'ok';
  let scoreBadge = 'badge-ok';
  let scoreTitle = isEn ? '✅ Project Ready for FET Solving' : '✅ Progetto Pronto per la Risoluzione FET';
  if (rep.critical_count > 0) {
    scoreClass = 'err';
    scoreBadge = 'badge-err';
    scoreTitle = isEn ? '⛔ Blocking Mathematical Conflicts Detected' : '⛔ Rilevati Conflitti Matematici Bloccanti';
  } else if (rep.warning_count > 0 || score < 85) {
    scoreClass = 'warn';
    scoreBadge = 'badge-warn';
    scoreTitle = isEn ? '⚠️ Potential Bottlenecks Detected' : '⚠️ Rilevati Potenziali Colli di Bottiglia';
  }

  // Filtraggio issues
  let filteredIssues = rep.issues || [];
  if (currentDiagTab === 'critical') {
    filteredIssues = filteredIssues.filter(i => i.severity === 'critical');
  } else if (currentDiagTab === 'warning') {
    filteredIssues = filteredIssues.filter(i => i.severity === 'warning');
  } else if (currentDiagTab === 'info') {
    filteredIssues = filteredIssues.filter(i => i.severity === 'info');
  }

  const categoryLabels = {
    teachers: isEn ? '👨‍🏫 Teachers & Assignments' : '👨‍🏫 Docenti & Cattedre',
    classes: isEn ? '🎓 Classes & Weekly Hours' : '🎓 Classi & Monte Ore',
    rooms: isEn ? '🏢 Rooms & Gyms' : '🏢 Spazi & Palestre',
    coteaching: isEn ? '👥 Co-teaching' : '👥 Co-docenze',
    locks: isEn ? '🔒 Locked Hours' : '🔒 Ore Fissate',
    buildings: isEn ? '🏫 Buildings & Branches' : '🏫 Plessi & Sedi'
  };

  container.innerHTML = `
    <!-- Header con Health Gauge & Azioni -->
    <div class="diagnostics-header">
      <div class="health-gauge-box">
        <div class="health-gauge-score ${scoreClass}">${score}%</div>
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <h2 style="margin:0;font-size:18px;font-weight:800;color:var(--text-main);">${scoreTitle}</h2>
            <span class="badge ${scoreBadge}">${formatFeasibilityStatus(rep.status, isEn)}</span>
          </div>
          <p style="margin:0;font-size:13px;color:var(--text-muted);">
            ${isEn 
              ? `Algebraic pre-flight & pigeonhole check: ${rep.summary_metrics.total_institute_slots} weekly slots, ${rep.summary_metrics.total_teachers} teachers, ${rep.summary_metrics.total_classes} classes.`
              : `Pre-flight check algebrico & piccionaia: ${rep.summary_metrics.total_institute_slots} slot settimanali, ${rep.summary_metrics.total_teachers} docenti, ${rep.summary_metrics.total_classes} classi.`}
          </p>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-sec" onclick="renderDiagnostics(currentDiagTab)">🔄 ${isEn ? 'Rescan Project' : 'Riesegui Scansione'}</button>
        <button class="btn btn-primary" onclick="navigate('solver')">⚡ ${isEn ? 'Open FET Solver' : 'Apri Compilatore FET'}</button>
      </div>
    </div>

    <!-- 4 Metric Stat Boxes -->
    <div class="stat-grid" style="margin-bottom:20px;">
      <div class="stat-box">
        <div class="stat-lbl">${isEn ? 'Feasibility Index' : 'Indice di Fattibilità'}</div>
        <div class="stat-val" style="color: ${scoreClass === 'ok' ? '#10b981' : (scoreClass === 'warn' ? '#f59e0b' : '#ef4444')};">
          ${score} / 100
        </div>
        <div class="stat-box-link"><span>${isEn ? 'Status:' : 'Stato:'} <b>${formatFeasibilityStatus(rep.status, isEn)}</b></span></div>
      </div>
      <div class="stat-box">
        <div class="stat-lbl">${isEn ? 'Blocking Conflicts' : 'Conflitti Bloccanti'}</div>
        <div class="stat-val" style="color: ${rep.critical_count > 0 ? '#ef4444' : '#10b981'};">
          ${rep.critical_count}
        </div>
        <div class="stat-box-link"><span>${rep.critical_count === 0 ? (isEn ? 'No mathematical blocks' : 'Nessun blocco matematico') : (isEn ? 'Prevents solution' : 'Impediscono la soluzione')}</span></div>
      </div>
      <div class="stat-box">
        <div class="stat-lbl">${isEn ? 'Bottlenecks & Warnings' : 'Colli di Bottiglia & Avvisi'}</div>
        <div class="stat-val" style="color: ${rep.warning_count > 0 ? '#f59e0b' : '#64748b'};">
          ${rep.warning_count}
        </div>
        <div class="stat-box-link"><span>${isEn ? 'Risk of stalls or swaps' : 'Rischio swap o stalli'}</span></div>
      </div>
      <div class="stat-box">
        <div class="stat-lbl">${isEn ? 'Rooms & Labs' : 'Spazi & Laboratori'}</div>
        <div class="stat-val" style="font-size:18px;">
          ${(rep.summary_metrics.room_saturations || []).map(r => `${r.type === 'palestra' ? (isEn ? 'Gym' : 'Palestre') : 'Lab'}: <b>${r.pct}%</b>`).join(' | ')}
        </div>
        <div class="stat-box-link"><span>${isEn ? 'Weekly capacity' : 'Capienza settimanale'}</span></div>
      </div>
    </div>

    <!-- Sezione Raccomandazioni Advisor Intelligente (Relax Search) -->
    ${adv.recommendations && adv.recommendations.length > 0 ? `
      <div class="advisor-box">
        ${renderAdvisorCardHtml(adv.recommendations, false, adv)}
      </div>
    ` : ''}

    <!-- Tab Bar per Filtro Categorie Issues -->
    <div class="diag-tabs">
      <button class="diag-tab-btn ${currentDiagTab === 'all' ? 'active' : ''}" onclick="setDiagnosticsTab('all')">
        📋 ${isEn ? 'All Diagnostics' : 'Tutte le Diagnosi'} (${rep.total_issues})
      </button>
      <button class="diag-tab-btn ${currentDiagTab === 'critical' ? 'active' : ''}" onclick="setDiagnosticsTab('critical')">
        ⛔ ${isEn ? 'Blocking' : 'Bloccanti'} (${rep.critical_count})
      </button>
      <button class="diag-tab-btn ${currentDiagTab === 'warning' ? 'active' : ''}" onclick="setDiagnosticsTab('warning')">
        ⚠️ ${isEn ? 'Bottlenecks' : 'Colli di Bottiglia'} (${rep.warning_count})
      </button>
      <button class="diag-tab-btn ${currentDiagTab === 'info' ? 'active' : ''}" onclick="setDiagnosticsTab('info')">
        💡 ${isEn ? 'Suggestions & Teaching' : 'Suggerimenti & Cattedre'} (${rep.info_count})
      </button>
      <button class="diag-tab-btn ${currentDiagTab === 'rooms' ? 'active' : ''}" onclick="setDiagnosticsTab('rooms')">
        🏢 ${isEn ? 'Gyms & Labs Saturation' : 'Saturazione Palestre & Lab'} (${(rep.summary_metrics.room_saturations || []).length})
      </button>
    </div>

    <!-- Contenuto Tab: Saturazione Palestre e Lab -->
    ${currentDiagTab === 'rooms' ? `
      <div class="card">
        <div class="card-title">${isEn ? 'Classroom & Space Saturation Analysis (Weekly Capacity)' : 'Analisi di Saturazione Spazi Didattici (Capienza Oraria Settimanale)'}</div>
        <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px;">
          ${isEn 
            ? `Assesses required hours on limited facilities (Gyms, Computer Labs) against total school slots (${rep.summary_metrics.total_institute_slots} weekly hours).` 
            : `Valuta il carico di ore richieste su strutture a disponibilità limitata (Palestre, Laboratori di Informatica) rispetto agli slot totali d'istituto (${rep.summary_metrics.total_institute_slots} ore settimanali).`}
        </p>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>${isEn ? 'Facility / Room Type' : 'Struttura / Tipologia'}</th>
                <th>${isEn ? 'Required Hours' : 'Ore Richieste'}</th>
                <th>${isEn ? 'Max Capacity' : 'Capienza Massima'}</th>
                <th style="min-width:200px;">${isEn ? 'Saturation Percentage' : 'Percentuale di Saturazione'}</th>
                <th>${isEn ? 'Risk Status' : 'Stato di Rischio'}</th>
                <th>${isEn ? 'Action' : 'Azione'}</th>
              </tr>
            </thead>
            <tbody>
              ${(rep.summary_metrics.room_saturations || []).map(r => {
                const barColor = r.status === 'danger' ? '#ef4444' : (r.status === 'warn' ? '#f59e0b' : '#10b981');
                const riskBadge = r.status === 'danger' 
                  ? (isEn ? 'OVERLOADED (>100%)' : 'SOVRACCARICO (>100%)')
                  : (r.status === 'warn' ? (isEn ? 'HIGH SATURATION' : 'ELEVATA SATURAZIONE') : (isEn ? 'NORMAL' : 'NORMALE'));
                return `
                  <tr>
                    <td><b>${escapeHtml(r.room)}</b></td>
                    <td><b>${r.assigned_hours}</b> h</td>
                    <td>${r.capacity_slots} h</td>
                    <td>
                      <div style="display:flex;align-items:center;gap:10px;">
                        <div style="flex:1;background:#e2e8f0;height:10px;border-radius:5px;overflow:hidden;">
                          <div style="width:${Math.min(100, r.pct)}%;background:${barColor};height:100%;"></div>
                        </div>
                        <span style="font-size:12px;font-weight:700;color:${barColor};width:42px;">${r.pct}%</span>
                      </div>
                    </td>
                    <td>
                      <span class="badge badge-${r.status === 'danger' ? 'err' : (r.status === 'warn' ? 'warn' : 'ok')}">
                        ${riskBadge}
                      </span>
                    </td>
                    <td>
                      <button class="btn btn-sm btn-sec" onclick="navigate('rooms')">${isEn ? 'Manage Rooms' : 'Gestisci Aule'}</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : `
      <!-- Contenuto Tab: Elenco Schede Conflitti / Diagnosi -->
      <div>
        ${filteredIssues.length === 0 ? `
          <div class="card" style="text-align:center;padding:40px;color:var(--text-muted);">
            <div style="font-size:32px;margin-bottom:8px;">🎉</div>
            <div style="font-size:15px;font-weight:700;color:var(--text-main);">${isEn ? 'No issues detected in this category!' : 'Nessun problema rilevato in questa categoria!'}</div>
            <div style="font-size:13px;margin-top:4px;">${isEn ? 'The model complies with all analyzed mathematical and algebraic constraints.' : 'Il modello rispetta tutti i vincoli matematici e algebrici analizzati.'}</div>
          </div>
        ` : filteredIssues.map(iss => {
          const catLabel = categoryLabels[iss.category] || iss.category;
          const sevBadge = iss.severity === 'critical'
            ? `<span class="badge badge-err">${isEn ? '⛔ BLOCKING' : '⛔ BLOCCANTE'}</span>`
            : (iss.severity === 'warning' ? `<span class="badge badge-warn">${isEn ? '⚠️ WARNING' : '⚠️ AVVISO'}</span>` : `<span class="badge badge-info">${isEn ? '💡 SUGGESTION' : '💡 SUGGERIMENTO'}</span>`);

          let quickBtnLbl = '';
          if (iss.quick_action) {
            if (iss.quick_action.target === 'availability') quickBtnLbl = isEn ? '📅 Go to Availability' : '📅 Vai a Disponibilità';
            else if (iss.quick_action.target === 'teachers') quickBtnLbl = isEn ? '👨‍🏫 Manage Teachers' : '👨‍🏫 Gestione Docente';
            else if (iss.quick_action.target === 'classes') quickBtnLbl = isEn ? '🎓 Manage Classes' : '🎓 Gestione Classe';
            else if (iss.quick_action.target === 'timetable') quickBtnLbl = isEn ? '🗓️ View in Timetable' : '🗓️ Vedi in Orario';
            else quickBtnLbl = isEn ? '⚡ Go to Constraints' : '⚡ Vai a Vincoli';
          }

          return `
            <div class="diag-issue-card ${iss.severity}">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:8px;">
                  ${sevBadge}
                  <span class="badge badge-sec" style="font-size:11px;">${catLabel}</span>
                  <b style="font-size:14px;color:var(--text-main);">${escapeHtml(iss.title)}</b>
                </div>
                ${iss.quick_action ? `
                  <button class="btn btn-sm btn-sec" onclick="navigate('${iss.quick_action.target}')" style="font-size:11.5px;">
                    ${quickBtnLbl}
                  </button>
                ` : ''}
              </div>
              <div style="font-size:13px;color:var(--text-muted);line-height:1.45;margin-bottom:8px;">
                ${escapeHtml(iss.description)}
              </div>
              ${iss.entities && iss.entities.length > 0 ? `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
                  <span style="font-size:11px;color:var(--text-sub);font-weight:600;">${isEn ? 'Involved entities:' : 'Elementi coinvolti:'}</span>
                  ${iss.entities.map(e => `
                    <span class="badge badge-info" style="font-size:11px;cursor:pointer;" onclick="navigate('${e.type === 'teacher' ? 'availability' : (e.type === 'class' ? 'classes' : (e.type === 'room' ? 'rooms' : 'activities'))}')">
                      ${e.type === 'teacher' ? '👨‍🏫' : (e.type === 'class' ? '🎓' : (e.type === 'room' ? '🏢' : '📋'))} ${escapeHtml(e.name)}
                    </span>
                  `).join('')}
                </div>
              ` : ''}
              ${iss.recommendation ? `
                <div style="background:var(--bg-card);border-radius:var(--radius-sm);padding:6px 10px;font-size:12px;color:var(--text-main);border:1px dashed var(--border);display:flex;align-items:center;gap:6px;">
                  <span>💡</span>
                  <span><b>${isEn ? 'Resolution tip:' : 'Consiglio di risoluzione:'}</b> ${escapeHtml(iss.recommendation)}</span>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

// ============================================================================
// 4. GESTIONE DOCENTI (CON SALTO DIRETTO A CATTEDRE E ATTIVITÀ)
// ============================================================================
function computeShortNameJs(name) {
  const n = (name || '').trim();
  if (!n) return '';
  if (n.includes('_')) return n.toUpperCase();

  const prefixes = [
    'DA', 'DE', 'DI', 'DEL', 'DELLA', 'DELLE', 'DALLE',
    'DEI', 'DEGLI', 'DAL', 'DALLA', 'LA', 'LO', 'LE', 'LI',
    'VAN', 'VON', 'AL', 'EL', 'SAN', 'SANTA'
  ];
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].toUpperCase();

  let i = 0;
  const cogn = [parts[0]];
  while (i < parts.length - 1 && prefixes.includes(parts[i].toUpperCase())) {
    i++;
    cogn.push(parts[i]);
  }

  const nomi = parts.slice(i + 1);
  if (!nomi.length) return cogn.join(' ').toUpperCase();

  const iniziali = nomi.map(nm => nm ? nm[0].toUpperCase() + '.' : '').join('');
  return (cogn.join(' ').toUpperCase() + ' ' + iniziali).trim();
}

function autoComputeShortName(fullName) {
  const inp = document.getElementById('editTeacherShortName');
  if (inp) inp.value = computeShortNameJs(fullName);
}

function onNewTeacherNameChange(val) {
  const sn = document.getElementById('newTeacherShortName');
  if (sn) sn.value = computeShortNameJs(val);
}

let currentTeacherFilterMode = 'all';

function setTeacherFilter(mode) {
  currentTeacherFilterMode = mode;
  document.querySelectorAll('.teacher-filter-btn').forEach(b => b.classList.remove('active'));
  if (mode === 'all') document.getElementById('btnTeachAll')?.classList.add('active');
  if (mode === 'intera') document.getElementById('btnTeachIntera')?.classList.add('active');
  if (mode === 'coe') document.getElementById('btnTeachCoe')?.classList.add('active');
  if (mode === 'spezzone') document.getElementById('btnTeachSpezzone')?.classList.add('active');
  if (mode === 'pt') document.getElementById('btnTeachPt')?.classList.add('active');
  if (mode === 'disp') document.getElementById('btnTeachDisp')?.classList.add('active');
  if (mode === 'full') document.getElementById('btnTeachFull')?.classList.add('active');
  applyTeacherFilters();
}

function applyTeacherFilters() {
  const q = (document.getElementById('teacherSearch')?.value || '').toLowerCase();
  const rows = document.querySelectorAll('#teacherTable tbody tr');
  rows.forEach(tr => {
    const text = tr.innerText.toLowerCase();
    const contract = tr.getAttribute('data-contract') || '';
    const hasDisp = tr.getAttribute('data-has-disp') === '1';
    const isFull = tr.getAttribute('data-is-full') === '1';

    let matchesMode = true;
    if (currentTeacherFilterMode === 'disp') matchesMode = hasDisp;
    else if (currentTeacherFilterMode === 'intera') matchesMode = (contract === 'intera' || contract === 'standard');
    else if (currentTeacherFilterMode === 'coe') matchesMode = (contract === 'coe');
    else if (currentTeacherFilterMode === 'spezzone') matchesMode = (contract === 'spezzone');
    else if (currentTeacherFilterMode === 'pt') matchesMode = (contract === 'part_time');
    else if (currentTeacherFilterMode === 'full') matchesMode = isFull;

    const matchesSearch = text.includes(q);
    tr.style.display = (matchesSearch && matchesMode) ? '' : 'none';
  });
}

async function renderTeachers() {
  const res = await fetch('/api/teachers');
  let teachers = await res.json();
  if (!Array.isArray(teachers)) teachers = [];
  // Ordinamento alfabetico rigoroso
  teachers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  stateData.teachers = teachers;

  // Applicazione filtro globale materia se attivo
  const globalSubjFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim();
  if (globalSubjFlt) {
    const linkedTeachers = new Set(getTeachersForGlobalSubject(globalSubjFlt));
    teachers = teachers.filter(t => linkedTeachers.has(t.name));
  }

  const totalTeachers = teachers.length;
  const dispTeachers = teachers.filter(t => (t.target_hours !== undefined ? t.target_hours : 18) > (t.total_hours || 0)).length;
  const totalDispHours = teachers.reduce((acc, t) => acc + Math.max(0, (t.target_hours !== undefined ? t.target_hours : 18) - (t.total_hours || 0)), 0);
  const interaTeachers = teachers.filter(t => t.contract_type === 'intera' || t.contract_type === 'standard' || (!t.contract_type && (t.target_hours || 18) >= 18)).length;
  const coeTeachers = teachers.filter(t => t.contract_type === 'coe' || (t.is_coe && t.contract_type !== 'part_time' && t.contract_type !== 'spezzone')).length;
  const spezzoneTeachers = teachers.filter(t => t.contract_type === 'spezzone').length;
  const ptTeachers = teachers.filter(t => t.contract_type === 'part_time').length;
  const fullTeachers = teachers.filter(t => (t.total_hours || 0) >= (t.target_hours !== undefined ? t.target_hours : 18)).length;

  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const container = document.getElementById('mainContent');
  container.innerHTML = `
    ${getGlobalFilterBannerHtml()}
    ${getNavReturnBarHtml(isEn ? 'Faculty roster and teaching assignments.' : 'Organico docenti e gestione cattedre.')}
    <!-- Barra Filtri e Azioni -->
    <div class="toolbar" style="margin-bottom:10px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1;">
        <input type="text" id="teacherSearch" class="search-input" placeholder="${isEn ? '🔍 Search teacher, short name, CDC, subject or class...' : '🔍 Cerca docente, nome breve, CDC, materia o classe...'}" oninput="applyTeacherFilters()" style="flex:1;min-width:240px;">
        <button class="btn btn-outline" onclick="openAllineaCattedreModal()" title="${isEn ? 'Align teacher contract types (COE, Spezzoni, Part-Time, Full-Time, Hours and Days) from an Excel or CSV sheet' : 'Allinea la tipologia di cattedra dei docenti (COE, Spezzoni, Part-Time, Intera, Ore e Giorni) da foglio Excel o CSV'}" style="font-weight:700;border:1.5px solid #059669;color:#059669;background:var(--bg-main);white-space:nowrap;padding:7px 14px;">
          📊 ${isEn ? 'Align Contract Types (Excel / CSV)' : 'Allinea Tipologia Cattedre (Excel / CSV)'}
        </button>
        <button class="btn btn-outline" onclick="openAggiornaOrganicoModal()" title="${isEn ? 'Update faculty roster by comparing with a Word (.docx) or Google Doc' : 'Aggiorna l\'organico docenti confrontandolo con un file Word (.docx) o Google Doc'}" style="font-weight:700;border:1.5px solid var(--primary);color:var(--primary);background:var(--bg-main);white-space:nowrap;padding:7px 14px;">
          🔄 ${isEn ? 'Update Faculty (Docx / Google Doc)' : 'Aggiorna Organico (Docx / Google Doc)'}
        </button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="newTeacherName" class="search-input" placeholder="${isEn ? 'Teacher name (e.g. John Doe)' : 'Nome docente (es. Rossi Mario)'}" style="width:175px;" oninput="onNewTeacherNameChange(this.value)">
        <input type="text" id="newTeacherShortName" class="search-input" placeholder="${isEn ? 'Short Name (DOE J.)' : 'Nome Breve (ROSSI M.)'}" style="width:140px;font-family:var(--font-mono);font-weight:700;text-transform:uppercase;" title="${isEn ? 'Short Name for printouts (SURNAME I.)' : 'Nome Breve per le stampe (COGNOME N.)'}">
        <input type="text" id="newTeacherCdc" class="search-input" placeholder="CDC" style="width:70px;">
        <select id="newTeacherContractType" class="table-select" style="width:130px;" title="${isEn ? 'Assignment contract type: Full-Time, External COE, Part-Hours, Part-Time' : 'Tipologia di cattedra/contratto: Intera, COE, Spezzone, Part-Time'}">
          <option value="intera">🏛️ ${isEn ? 'Full-Time (18h)' : 'Intera (18h)'}</option>
          <option value="coe">🏫 ${isEn ? 'External (COE)' : 'COE'}</option>
          <option value="spezzone">🧩 ${isEn ? 'Part-Hours' : 'Spezzone'}</option>
          <option value="part_time">⏳ ${isEn ? 'Part-Time' : 'Part-Time'}</option>
        </select>
        <input type="number" id="newTeacherTarget" class="search-input" placeholder="${isEn ? 'Hours' : 'Ore'}" value="18" style="width:55px;" title="${isEn ? 'Contractual Assignment Hours' : 'Ore Cattedra Contrattuali'}">
        <button class="btn btn-primary" onclick="addTeacher()">+ ${isEn ? 'Add Teacher' : 'Aggiungi Docente'}</button>
      </div>
    </div>

    <!-- Barra Filtri Rapidi Cattedre & Disposizioni D -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap;">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'all' ? 'active' : ''}" id="btnTeachAll" onclick="setTeacherFilter('all')">
          ${isEn ? 'All' : 'Tutti'} (${totalTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'intera' ? 'active' : ''}" id="btnTeachIntera" onclick="setTeacherFilter('intera')" title="${isEn ? 'Teachers with standard full-time post (18 hours)' : 'Docenti con Cattedra Ordinaria Intera (18 ore)'}">
          🏛️ ${isEn ? 'Full-Time' : 'Intere'} (${interaTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'coe' ? 'active' : ''}" id="btnTeachCoe" onclick="setTeacherFilter('coe')" title="${isEn ? 'Teachers with external completion post (COE)' : 'Docenti con Cattedra Orario Esterna (COE)'}">
          🏫 ${isEn ? 'External COE' : 'COE'} (${coeTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'spezzone' ? 'active' : ''}" id="btnTeachSpezzone" onclick="setTeacherFilter('spezzone')" title="${isEn ? 'Teachers with reduced / residual hours post' : 'Docenti su Spezzone Orario (cattedre ridotte/residue)'}">
          🧩 ${isEn ? 'Part-Hours' : 'Spezzoni'} (${spezzoneTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'pt' ? 'active' : ''}" id="btnTeachPt" onclick="setTeacherFilter('pt')" title="${isEn ? 'Teachers with part-time contract' : 'Docenti con contratto Part-Time'}">
          ⏳ ${isEn ? 'Part-Time' : 'Part-Time'} (${ptTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'disp' ? 'active' : ''}" id="btnTeachDisp" onclick="setTeacherFilter('disp')" title="${isEn ? 'Teachers with unassigned hours designated as On-Duty D' : 'Docenti con ore cattedra non coperte da lezioni: assegnate a Disposizione'}">
          📌 ${isEn ? 'With On-Duty D' : 'Con Disposizione D'} (${dispTeachers} ${isEn ? 'teachers' : 'docenti'} — ${totalDispHours}h D tot.)
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'full' ? 'active' : ''}" id="btnTeachFull" onclick="setTeacherFilter('full')" title="${isEn ? 'Teachers with fully covered assignment hours' : 'Docenti con cattedra completamente coperta'}">
          ✓ ${isEn ? 'Complete Assignments' : 'Cattedre Piene'} (${fullTeachers})
        </button>
      </div>
      <div style="font-size:12px;color:var(--text-muted);">
        🏷️ <b>${isEn ? 'Short Name' : 'Nome Breve'}</b> (${isEn ? 'e.g.' : 'es.'} <code>ROSSI M.</code>): ${isEn ? 'used in compact printouts and class timetables' : 'utilizzato nelle stampe compatte e orari classi'}
      </div>
    </div>

    <div class="table-container">
      <table class="data-table" id="teacherTable">
        <thead>
          <tr>
            <th style="width:35px;">#</th>
            <th style="min-width:180px;">${_t('teachers.th_name', 'Docente (Nome Completo)')}</th>
            <th style="width:150px;">${_t('teachers.th_short', 'Nome Breve (Stampa)')}</th>
            <th style="width:85px;text-align:center;">${_t('teachers.th_cdc', 'CDC')}</th>
            <th style="width:165px;text-align:center;">${_t('teachers.th_hours', 'Cattedra & Ore')}</th>
            <th style="width:105px;text-align:center;">${_t('teachers.th_days', 'Giorni Min-Max')}</th>
            <th style="min-width:160px;">${_t('teachers.th_subjects', 'Discipline Insegnate')}</th>
            <th style="min-width:140px;">${_t('teachers.th_classes', 'Classi Assegnate')}</th>
            <th>${_t('teachers.th_notes', 'Note')}</th>
            <th style="text-align:right;min-width:280px;">${_t('teachers.th_actions', 'Azioni Rapide')}</th>
          </tr>
        </thead>
        <tbody>
          ${teachers.map((t, idx) => {
            const targetH = t.target_hours !== undefined ? t.target_hours : 18;
            const lessonH = t.lesson_hours !== undefined ? t.lesson_hours : (t.total_hours || 0);
            const dispH = t.disp_hours || 0;
            const totalH = lessonH + dispH;
            const diffH = totalH - targetH;
            const isComplete = totalH >= targetH;
            const missingH = Math.max(0, targetH - totalH);
            let contractType = t.contract_type;
            if (!contractType) {
              if (t.is_coe) contractType = 'coe';
              else if (targetH < 18) contractType = 'spezzone';
              else contractType = 'intera';
            } else if (contractType === 'standard') {
              contractType = 'intera';
            }
            const shortName = (t.short_name || '').trim() || computeShortNameJs(t.name);

            let contractBadge = '';
            if (contractType === 'coe') {
              contractBadge = '<span class="badge badge-coe" title="Cattedra Orario Esterna (COE) - completamento su altro istituto">🏫 COE</span>';
            } else if (contractType === 'spezzone') {
              contractBadge = `<span class="badge badge-spezzone" title="Spezzone Orario Residuo (${targetH}h)">🧩 Spezzone (${targetH}h)</span>`;
            } else if (contractType === 'part_time') {
              contractBadge = `<span class="badge badge-pt" title="Contratto a Tempo Parziale (Part-Time ${targetH}h)">⏳ Part-Time (${targetH}h)</span>`;
            } else {
              contractBadge = `<span class="badge badge-intera" title="Cattedra Ordinaria Intera (${targetH}h)">🏛️ Intera (${targetH}h)</span>`;
            }

            const isManualDisp = t.custom_disp_hours !== undefined && t.custom_disp_hours !== null && String(t.custom_disp_hours).trim() !== '';

            return `
            <tr data-contract="${contractType}" data-has-disp="${dispH > 0 ? '1' : '0'}" data-is-full="${isComplete ? '1' : '0'}">
              <td style="color:var(--text-sub);">${idx + 1}</td>
              <td>
                <b style="color:var(--text-main);font-size:13.5px;cursor:pointer;" onclick="openEditTeacherModal('${escapeJs(t.name)}')" title="Clicca per modificare parametri docente">
                  👨‍🏫 ${escapeHtml(t.name)}
                </b>
              </td>
              <td>
                <span class="item-chip" style="font-family:var(--font-mono);font-size:11.5px;font-weight:700;color:var(--primary);letter-spacing:0.5px;cursor:pointer;" onclick="openEditTeacherModal('${escapeJs(t.name)}')" title="Nome breve standard per le stampe dell'orario (clicca per modificare eccezioni)">
                  🏷️ ${escapeHtml(shortName)}
                </span>
              </td>
              <td style="text-align:center;">
                <span class="item-chip" style="font-weight:600;font-size:11.5px;">${escapeHtml(t.cdc || '-')}</span>
              </td>
              <td style="text-align:center;">
                <div>
                  <span class="badge ${totalH > 0 ? 'badge-info' : ''}" style="font-weight:700;font-size:12px;" title="${lessonH} ore di lezione ${dispH > 0 ? `+ ${dispH} ore a disposizione` : ''} = ${totalH}h su ${targetH} ore contrattuali">
                    ${lessonH}h ${dispH > 0 ? `<b style="color:#d97706;">+ ${dispH}h D${isManualDisp ? ' <span title="Ore a disposizione impostate manualmente (override)">📌</span>' : ''}</b>` : ''} / ${targetH}h
                  </span>
                </div>
                <div style="margin-top:2px;">
                  ${contractBadge}
                </div>
                <div style="margin-top:2px;">
                  ${isComplete ? `
                    <span class="badge badge-ok" style="font-size:10px;padding:1px 5px;" title="Cattedra completa al 100% (${lessonH}h lezioni + ${dispH}h disposizioni = ${totalH}h)">
                      ✓ Completa (${totalH}h)
                    </span>
                  ` : `
                    <span class="badge badge-warn" style="font-size:10px;padding:1px 5px;" title="Cattedra incompleta: mancano ${missingH} ore">
                      ⚠️ Mancano ${missingH}h
                    </span>
                  `}
                </div>
              </td>
              <td style="text-align:center;">
                <span style="font-size:12px;font-weight:600;color:var(--text-main);">
                  ${t.min_days || 4} - ${t.max_days || 5} gg
                </span>
                ${t.pref_shift && t.pref_shift !== 'none' ? `
                  <div style="margin-top:3px;">
                    <span class="badge-pref-chip badge-pref-${t.pref_shift}" title="Preferenza fascia oraria: ${t.pref_shift} (${t.pref_shift_weight || 85}%)">
                      ${t.pref_shift === 'prime' ? '🌅 Prime' : (t.pref_shift === 'ultime' ? '🌇 Ultime' : '⚖️ Bilanc.')}
                    </span>
                  </div>
                ` : ''}
                ${t.free_day_1 ? `
                  <div style="margin-top:2px;">
                    <span class="badge-pref-chip badge-pref-freeday" title="Giorno libero desiderato: ${t.free_day_1} ${t.free_day_strict ? '(100% Tassativo)' : '(Soft)'}">
                      ⭐ Libero: ${t.free_day_1}
                    </span>
                  </div>
                ` : ''}
              </td>
              <td>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${(t.subjects || []).length > 0 ? (t.subjects || []).map(s => `
                    <span class="item-chip primary" title="Materia insegnata">📚 ${escapeHtml(s)}</span>
                  `).join('') : '<span style="color:var(--text-muted);font-size:12px;">-</span>'}
                </div>
              </td>
              <td>
                <div style="display:flex;flex-direction:column;gap:4px;">
                  ${(t.subject_assignments && t.subject_assignments.length > 1) ? (
                    t.subject_assignments.map(sa => `
                      <div style="font-size:11.5px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
                        <span style="font-size:10.5px;color:var(--text-muted);font-weight:600;">📚 ${escapeHtml(sa.subject)}:</span>
                        ${(sa.classes || []).map(c => `<span class="item-chip" style="font-size:10.5px;padding:1px 5px;">🎓 ${escapeHtml(c)}</span>`).join('')}
                      </div>
                    `).join('')
                  ) : (
                    (t.classes || []).length > 0 ? (t.classes || []).map(c => `
                      <span class="item-chip" title="Classe assegnata">🎓 ${escapeHtml(c)}</span>
                    `).join('') : '<span style="color:var(--text-muted);font-size:12px;">-</span>'
                  )}
                </div>
              </td>
              <td style="color:var(--text-muted);font-size:12px;">${escapeHtml(t.comments || '-')}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn btn-sm btn-sec" onclick="openEditTeacherModal('${escapeJs(t.name)}')" title="Modifica CDC, ore cattedra, tipologia, nome breve e giorni">
                  ✏️ Modifica
                </button>
                <button class="btn btn-sm btn-primary" onclick="openNewCattedraModal({ teacher: '${escapeJs(t.name)}' })" title="Assegna nuova cattedra/attività a questo docente">
                  ➕ Cattedra
                </button>
                <button class="btn btn-sm btn-sec" onclick="jumpToActivities({ teacher: '${escapeJs(t.name)}' })" title="Salta all'elenco cattedre di ${escapeJs(t.name)}">
                  📚 Cattedre
                </button>
                <button class="btn btn-sm btn-sec" onclick="openTeacherAvailability('${escapeJs(t.name)}')">📅</button>
                <button class="btn btn-sm btn-danger" onclick="deleteTeacher('${escapeJs(t.name)}')">🗑️</button>
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function updateDispPreview(lessonH) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const targetVal = parseInt(document.getElementById('editTeacherTarget')?.value, 10) || 18;
  const customDispInp = document.getElementById('editTeacherCustomDisp');
  const customDispVal = (customDispInp && customDispInp.value.trim() !== '') ? parseInt(customDispInp.value.trim(), 10) : null;
  const resEl = document.getElementById('dispCalculationResult');
  if (!resEl) return;
  if (customDispVal !== null && !isNaN(customDispVal)) {
    resEl.innerHTML = `<span class="badge-disp" style="font-size:12px;padding:3px 10px;">📌 D = ${customDispVal}h ${isEn ? 'On-Duty (manual override)' : 'Disposizione (impostata manualmente)'}</span>`;
  } else if (targetVal > lessonH) {
    const d = targetVal - lessonH;
    resEl.innerHTML = `<span class="badge-disp" style="font-size:12px;padding:3px 10px;">📌 D = ${d}h ${isEn ? 'Duty Hours (uncovered by lessons)' : 'Disposizione (non coperte da lezioni)'}</span>`;
  } else if (targetVal === lessonH) {
    resEl.innerHTML = `<span style="color:var(--color-ok);font-weight:700;font-size:12px;">${isEn ? '✓ Assignment 100% Covered (0h Duty)' : '✓ Cattedra Coperta al 100% (0h D)'}</span>`;
  } else {
    resEl.innerHTML = `<span style="color:var(--primary);font-weight:700;font-size:12px;">+${lessonH - targetVal}h ${isEn ? 'Surplus / Overtime Hours' : 'Esubero / Ore Eccedenti'}</span>`;
  }
}

function onContractTypeChange(ctype) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const hintEl = document.getElementById('contractTypeHint');
  const targetVal = parseInt(document.getElementById('editTeacherTarget')?.value, 10) || 18;
  if (!hintEl) return;
  if (ctype === 'coe') {
    hintEl.innerText = isEn ? "🏫 External Timetable Assignment (COE): teacher completes hours in another school." : "🏫 Cattedra Orario Esterna (COE): il docente completa l'orario in un altro istituto scolastico (solitamente max 3-4 giorni nel nostro istituto).";
  } else if (ctype === 'spezzone') {
    hintEl.innerText = isEn ? `🧩 Fractional Assignment: residual teaching hours (${targetVal}h).` : `🧩 Spezzone Orario: cattedra su frazione o spezzone residuo a ore (${targetVal}h).`;
  } else if (ctype === 'part_time') {
    hintEl.innerText = isEn ? `⏳ Part-Time: reduced working hours upon teacher request (${targetVal}h).` : `⏳ Part-Time: docente con contratto a orario parziale su propria richiesta (${targetVal}h).`;
  } else {
    hintEl.innerText = isEn ? `🏛️ Full Standard Contract (${targetVal} contractual hours).` : `🏛️ Cattedra Ordinaria Intera (${targetVal} ore contrattuali).`;
  }
}

function openEditTeacherModal(name) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const teacher = (stateData.teachers || []).find(t => t.name === name) || { name: name };
  const cdc = teacher.cdc || '';
  const targetH = teacher.target_hours !== undefined ? teacher.target_hours : 18;
  const minDays = teacher.min_days !== undefined ? teacher.min_days : 4;
  const maxDays = teacher.max_days !== undefined ? teacher.max_days : 5;
  const lessonH = (teacher.lesson_hours !== undefined && teacher.lesson_hours !== null) ? teacher.lesson_hours : (teacher.total_hours || 0);
  const totalH = teacher.total_hours !== undefined ? teacher.total_hours : (lessonH + (teacher.disp_hours || 0));
  const shortName = (teacher.short_name || '').trim() || computeShortNameJs(name);
  
  let contractType = teacher.contract_type;
  if (!contractType) {
    if (teacher.is_coe) contractType = 'coe';
    else if (targetH < 18) contractType = 'spezzone';
    else contractType = 'intera';
  } else if (contractType === 'standard') {
    contractType = 'intera';
  }
  const comments = teacher.comments || '';

  // Parametri Preferenze & Desiderata
  const prefShift = teacher.pref_shift || 'none';
  const prefWeight = teacher.pref_shift_weight !== undefined ? teacher.pref_shift_weight : 85;
  const freeDay1 = teacher.free_day_1 || '';
  const freeDay2 = teacher.free_day_2 || '';
  const freeDayStrict = Boolean(teacher.free_day_strict);
  const maxSpan = teacher.max_span !== undefined && teacher.max_span !== null ? teacher.max_span : '';
  const maxDailyLessons = teacher.max_daily_lessons !== undefined && teacher.max_daily_lessons !== null ? teacher.max_daily_lessons : '';
  const minDailyLessons = teacher.min_daily_lessons !== undefined && teacher.min_daily_lessons !== null ? teacher.min_daily_lessons : '';
  const maxGaps = teacher.max_gaps_per_day !== undefined && teacher.max_gaps_per_day !== null ? teacher.max_gaps_per_day : '';

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">👨‍🏫 ${isEn ? 'Teacher Parameters:' : 'Parametri Docente:'} ${escapeHtml(name)}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <label class="form-label" style="margin-bottom:0;">${isEn ? 'Full Teacher Name' : 'Nome Completo Docente'}</label>
              <span style="font-size:11px;color:var(--primary);font-weight:600;">✏️ ${isEn ? 'Editable' : 'Modificabile'}</span>
            </div>
            <input type="text" id="editTeacherFullName" class="form-input" value="${escapeHtml(name)}" placeholder="${isEn ? 'e.g. SMITH JOHN' : 'es. ROSSI MARIO'}" oninput="onTeacherFullNameChange(this.value)">
          </div>
          <div class="form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <label class="form-label" style="margin-bottom:0;">${isEn ? 'Short Name for Printing' : 'Nome Breve per Stampe'}</label>
              <button type="button" class="btn btn-sm btn-sec" style="font-size:10.5px;padding:1px 6px;" onclick="autoComputeShortName(document.getElementById('editTeacherFullName')?.value || '${escapeJs(name)}')">
                ⚡ ${isEn ? 'Recalculate Standard' : 'Ricalcola Standard'}
              </button>
            </div>
            <input type="text" id="editTeacherShortName" class="form-input" value="${escapeHtml(shortName)}" placeholder="${isEn ? 'e.g. SMITH J.' : 'es. ROSSI M.'}" style="font-family:var(--font-mono);font-weight:700;text-transform:uppercase;" oninput="this.dataset.manuallyEdited='1'">
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:-6px;margin-bottom:12px;">
          ${isEn
            ? '💡 You can edit the <b>Full Name</b> (all assignments and availability will be linked to the new name) and <b>Short Name</b> (standard: <code>SURNAME I.</code>).'
            : '💡 Puoi modificare il <b>Nome Completo</b> (tutte le cattedre e disponibilità verranno collegate al nuovo nominativo) e il <b>Nome Breve</b> (standard: <code>COGNOME N.</code>).'}
        </div>

        <!-- Selezione Tipologia di Cattedra (Intera, COE, Spezzone, Part-Time) -->
        <div class="form-group" style="margin-top:6px;">
          <label class="form-label">${isEn ? 'Contract / Assignment Type' : 'Tipologia di Cattedra / Contratto'}</label>
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;">
            <label class="radio-pill ${contractType === 'intera' ? 'active' : ''}" style="border:1px solid var(--border);padding:8px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input type="radio" name="editTeacherContractType" value="intera" ${contractType === 'intera' ? 'checked' : ''} onchange="onContractTypeChange('intera')">
              <span>🏛️ <b>${isEn ? `Full (${targetH}h)` : `Intera (${targetH}h)`}</b></span>
            </label>
            <label class="radio-pill ${contractType === 'coe' ? 'active' : ''}" style="border:1px solid var(--border);padding:8px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input type="radio" name="editTeacherContractType" value="coe" ${contractType === 'coe' ? 'checked' : ''} onchange="onContractTypeChange('coe')">
              <span>🏫 <b>COE</b></span>
            </label>
            <label class="radio-pill ${contractType === 'spezzone' ? 'active' : ''}" style="border:1px solid var(--border);padding:8px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input type="radio" name="editTeacherContractType" value="spezzone" ${contractType === 'spezzone' ? 'checked' : ''} onchange="onContractTypeChange('spezzone')">
              <span>🧩 <b>${isEn ? 'Fraction' : 'Spezzone'}</b></span>
            </label>
            <label class="radio-pill ${contractType === 'part_time' ? 'active' : ''}" style="border:1px solid var(--border);padding:8px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input type="radio" name="editTeacherContractType" value="part_time" ${contractType === 'part_time' ? 'checked' : ''} onchange="onContractTypeChange('part_time')">
              <span>⏳ <b>Part-Time</b></span>
            </label>
          </div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:5px;" id="contractTypeHint">
            ${isEn
              ? (contractType === 'coe' ? '🏫 External Timetable Assignment (COE): teacher completes hours in another school.' : (contractType === 'spezzone' ? `🧩 Fractional Assignment: residual teaching hours (${targetH}h).` : (contractType === 'part_time' ? `⏳ Part-Time: reduced working hours upon teacher request (${targetH}h).` : `🏛️ Full Standard Contract (${targetH} contractual hours).`)))
              : (contractType === 'coe' ? '🏫 Cattedra Orario Esterna (COE): il docente completa l\'orario in un altro istituto scolastico.' : (contractType === 'spezzone' ? `🧩 Spezzone Orario: cattedra su frazione o spezzone residuo a ore (${targetH}h).` : (contractType === 'part_time' ? `⏳ Part-Time: docente con contratto a orario parziale su propria richiesta (${targetH}h).` : `🏛️ Cattedra Ordinaria Intera (${targetH} ore contrattuali).`)))}
          </div>
          <div style="font-size:11px;color:#1e40af;margin-top:3px;">
            🛡️ ${isEn ? 'Contractual typology and target hours are manually configured and protected from automatic file updates.' : 'Tipologia contrattuale e ore target sono gestite manualmente e protette dall\'aggiornamento del file organico.'}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">${isEn ? 'Teaching Certificate (CDC)' : 'Classe di Concorso (CDC)'}</label>
            <input type="text" id="editTeacherCdc" class="form-input" value="${escapeHtml(cdc)}" placeholder="es. A027, A047, A012">
          </div>
          <div class="form-group">
            <label class="form-label">${isEn ? 'Contract Target Hours' : 'Ore Cattedra Contrattuali'}</label>
            <input type="number" id="editTeacherTarget" class="form-input" value="${targetH}" min="1" max="36" oninput="updateDispPreview(${lessonH})">
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;justify-content:space-between;">
              <span>${isEn ? 'Duty Hours (Override)' : 'Ore Disposizione (Manuale)'}</span>
              <span style="font-size:10px;color:var(--text-muted);font-weight:normal;">${isEn ? 'Optional' : 'Opzionale'}</span>
            </label>
            <input type="number" id="editTeacherCustomDisp" class="form-input" value="${teacher.custom_disp_hours !== undefined && teacher.custom_disp_hours !== null ? teacher.custom_disp_hours : ''}" min="0" max="36" placeholder="${isEn ? 'Auto: Target - Lessons' : 'Auto: Target - Lezioni'}" oninput="updateDispPreview(${lessonH})">
          </div>
        </div>

        <!-- Box Calcolo e Evidenziazione Disposizione D -->
        <div id="dispPreviewBox" class="disp-preview-box">
          <div>
            <span class="disp-preview-label">${isEn ? 'Assigned Teaching Hours:' : 'Ore Lezione Frontale Assegnate:'}</span>
            <b class="disp-preview-val">${lessonH} h</b>
          </div>
          <div id="dispCalculationResult">
            ${(teacher.custom_disp_hours !== undefined && teacher.custom_disp_hours !== null) ? `
              <span class="badge-disp" style="font-size:12px;padding:3px 10px;">
                📌 D = ${teacher.custom_disp_hours}h ${isEn ? 'On-Duty (manual override)' : 'Disposizione (impostata manualmente)'}
              </span>
            ` : (targetH > lessonH ? `
              <span class="badge-disp" style="font-size:12px;padding:3px 10px;">
                📌 D = ${targetH - lessonH}h ${isEn ? 'Duty Hours (uncovered by lessons)' : 'Disposizione (non coperte da lezioni)'}
              </span>
            ` : (targetH === lessonH ? `
              <span style="color:var(--color-ok);font-weight:700;font-size:12px;">
                ${isEn ? '✓ Assignment 100% Covered (0h Duty)' : '✓ Cattedra Coperta al 100% (0h D)'}
              </span>
            ` : `
              <span style="color:var(--primary);font-weight:700;font-size:12px;">
                +${lessonH - targetH}h ${isEn ? 'Surplus / Overtime Hours' : 'Esubero / Ore Eccedenti'}
              </span>
            `))}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">${isEn ? 'Min Teaching Days' : 'Minimo Giorni Insegnamento'}</label>
            <input type="number" id="editTeacherMinDays" class="form-input" value="${minDays}" min="1" max="6">
          </div>
          <div class="form-group">
            <label class="form-label">${isEn ? 'Max Teaching Days' : 'Massimo Giorni Insegnamento'}</label>
            <input type="number" id="editTeacherMaxDays" class="form-input" value="${maxDays}" min="1" max="6">
          </div>
        </div>

        <!-- SEZIONE: Preferenze & Desiderata Orario Docente -->
        <div class="pref-section-box">
          <div class="pref-section-title">
            <span>🎨 ${isEn ? 'Timetable Preferences & Desiderata' : 'Preferenze & Desiderata Orario'}</span>
            <span style="font-size:11px;font-weight:normal;color:var(--text-muted);">(${isEn ? 'Shifts, Weights & Free Day' : 'Fasce, Pesi e Giorno Libero'})</span>
          </div>

          <!-- 1. Fascia Oraria Preferita -->
          <div style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;margin-bottom:6px;">${isEn ? '1. Preferred Daily Time Slot' : '1. Fascia Oraria Giornaliera Preferita'}</label>
            <input type="hidden" id="editTeacherPrefShift" value="${escapeHtml(prefShift)}">
            <div class="pref-card-grid">
              <div class="pref-card ${prefShift === 'prime' ? 'selected' : ''}" onclick="selectTeacherPrefShift('prime', event)">
                <div class="pref-card-icon">🌅</div>
                <div class="pref-card-title">${isEn ? 'Early Hours' : 'Prime Ore'}</div>
                <div class="pref-card-desc">${isEn ? '1st-4th period / early departure' : '1ª-4ª ora / uscita anticipata'}</div>
              </div>
              <div class="pref-card ${prefShift === 'ultime' ? 'selected' : ''}" onclick="selectTeacherPrefShift('ultime', event)">
                <div class="pref-card-icon">🌇</div>
                <div class="pref-card-title">${isEn ? 'Late Hours' : 'Ultime Ore'}</div>
                <div class="pref-card-desc">${isEn ? '3rd-6th period / late arrival' : '3ª-6ª ora / ingr. posticipato'}</div>
              </div>
              <div class="pref-card ${prefShift === 'bilanciato' ? 'selected' : ''}" onclick="selectTeacherPrefShift('bilanciato', event)">
                <div class="pref-card-icon">⚖️</div>
                <div class="pref-card-title">${isEn ? 'Balanced' : 'Bilanciato'}</div>
                <div class="pref-card-desc">${isEn ? '2nd-5th period / even spread' : '2ª-5ª ora / distribuzione equa'}</div>
              </div>
              <div class="pref-card ${prefShift === 'none' ? 'selected' : ''}" onclick="selectTeacherPrefShift('none', event)">
                <div class="pref-card-icon">🎲</div>
                <div class="pref-card-title">${isEn ? 'Flexible' : 'Flessibile'}</div>
                <div class="pref-card-desc">${isEn ? 'No preference (free)' : 'Nessuna preferenza (libero)'}</div>
              </div>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;background:var(--bg-card);padding:8px 12px;border:1px solid var(--border);border-radius:6px;">
              <span style="font-size:11.5px;color:var(--text-sub);font-weight:600;">${isEn ? 'Shift Preference Strictness:' : 'Rigidità Preferenza Fascia:'}</span>
              <input type="hidden" id="editTeacherPrefWeight" value="${prefWeight}">
              <div class="pref-pills-row">
                <button type="button" class="pref-weight-btn ${prefWeight === 70 ? 'active' : ''}" onclick="selectTeacherPrefWeight(70, event)">💡 Soft (70%)</button>
                <button type="button" class="pref-weight-btn ${prefWeight === 85 ? 'active' : ''}" onclick="selectTeacherPrefWeight(85, event)">🎯 ${isEn ? 'High Priority' : 'Alta Priorità'} (85%)</button>
                <button type="button" class="pref-weight-btn ${prefWeight === 100 ? 'active' : ''}" onclick="selectTeacherPrefWeight(100, event)">🔒 ${isEn ? 'Strict' : 'Tassativo'} (100%)</button>
              </div>
            </div>
          </div>

          <!-- 2. Giorno Libero Settimanale -->
          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <label class="form-label" style="font-size:12px;margin-bottom:0;">${isEn ? '2. Desired Weekly Free Day' : '2. Giorno Libero Settimanale Desiderato'}</label>
              <span style="font-size:11px;color:var(--text-muted);">${isEn ? '1st click: ⭐ 1st choice | 2nd click: 👍 2nd choice | 3rd click: reset' : '1° click: ⭐ 1ª scelta | 2° click: 👍 2ª scelta | 3° click: reset'}</span>
            </div>
            <input type="hidden" id="editTeacherFreeDay1" value="${escapeHtml(freeDay1)}">
            <input type="hidden" id="editTeacherFreeDay2" value="${escapeHtml(freeDay2)}">
            <div class="pref-pills-row" style="margin-bottom:8px;" id="freeDayPillContainer">
              ${['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'].map(d => {
                const dayLabel = formatDayName(d);
                const isFirst = (freeDay1 === d);
                const isSecond = (freeDay2 === d);
                let label = dayLabel;
                let cls = '';
                if (isFirst) { cls = 'is-first'; label = `⭐ ${dayLabel} (1ª)`; }
                else if (isSecond) { cls = 'is-second'; label = `👍 ${dayLabel} (2ª)`; }
                return `<button type="button" class="pref-day-btn ${cls}" onclick="cycleFreeDay('${d}')">${label}</button>`;
              }).join('')}
            </div>

            <div style="background:var(--bg-card);padding:8px 12px;border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin:0;">
                <input type="checkbox" id="editTeacherFreeDayStrict" ${freeDayStrict ? 'checked' : ''} style="cursor:pointer;">
                <span>🔒 <b>${isEn ? '100% Strict Free Day' : 'Giorno Libero 100% Tassativo'}</b> (${isEn ? 'Absolute contractual unavailability' : 'Indisponibilità contrattuale assoluta'})</span>
              </label>
              <span style="font-size:11px;color:var(--text-muted);">${isEn ? 'If unchecked, FET treats free day as a soft desideratum' : 'Se disattivo, FET tratterà il giorno libero come desiderata flessibile'}</span>
            </div>
          </div>

          <!-- 3. Permanenza a Scuola & Carico Giornaliero -->
          <div>
            <label class="form-label" style="font-size:12px;margin-bottom:6px;">${isEn ? '3. Daily Span & Workload Limits (Optional)' : '3. Limiti di Permanenza & Carico Giornaliero (Opzionali)'}</label>
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;">
              <div>
                <label style="font-size:11px;color:var(--text-sub);display:block;margin-bottom:3px;">⏱️ ${isEn ? 'Max span (hrs/day)' : 'Max permanenza (h/die)'}</label>
                <input type="number" id="editTeacherMaxSpan" class="form-input" style="font-size:12px;padding:5px 8px;" value="${maxSpan}" placeholder="${isEn ? 'e.g. 5 (incl. gaps)' : 'es. 5 (con buche)'}" min="1" max="8" title="${isEn ? 'Maximum hours at school per day including gaps' : 'Massimo numero di ore a scuola al giorno compresi gli stacchi/buche'}">
              </div>
              <div>
                <label style="font-size:11px;color:var(--text-sub);display:block;margin-bottom:3px;">📖 ${isEn ? 'Max lessons / day' : 'Max lezioni / giorno'}</label>
                <input type="number" id="editTeacherMaxDailyLessons" class="form-input" style="font-size:12px;padding:5px 8px;" value="${maxDailyLessons}" placeholder="es. 4" min="1" max="8" title="${isEn ? 'Maximum teaching hours in a single day' : 'Massimo ore di lezione frontale in una giornata'}">
              </div>
              <div>
                <label style="font-size:11px;color:var(--text-sub);display:block;margin-bottom:3px;">☕ ${isEn ? 'Max gaps / day' : 'Max buche / giorno'}</label>
                <input type="number" id="editTeacherMaxGapsPerDay" class="form-input" style="font-size:12px;padding:5px 8px;" value="${maxGaps}" placeholder="es. 1" min="0" max="4" title="${isEn ? 'Maximum gaps/window hours per day' : 'Massimo ore buche al giorno per questo docente'}">
              </div>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Notes / Didactic Instructions' : 'Note / Istruzioni Didattiche'}</label>
          <textarea id="editTeacherComments" class="form-input" rows="2" placeholder="${isEn ? 'Timetable notes or specific constraints' : 'Note per l\'orario o vincoli specifici'}">${escapeHtml(comments)}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitEditTeacher('${escapeJs(name)}')">💾 ${isEn ? 'Save Parameters' : 'Salva Parametri'}</button>
      </div>
    </div>
  `);
}

function selectTeacherPrefShift(shift, evt) {
  document.getElementById('editTeacherPrefShift').value = shift;
  document.querySelectorAll('.pref-card').forEach(c => c.classList.remove('selected'));
  if (evt && evt.currentTarget) {
    evt.currentTarget.classList.add('selected');
  }
}

function selectTeacherPrefWeight(weight, evt) {
  document.getElementById('editTeacherPrefWeight').value = weight;
  document.querySelectorAll('.pref-weight-btn').forEach(b => b.classList.remove('active'));
  if (evt && evt.currentTarget) {
    evt.currentTarget.classList.add('active');
  }
}

function cycleFreeDay(day) {
  const f1Inp = document.getElementById('editTeacherFreeDay1');
  const f2Inp = document.getElementById('editTeacherFreeDay2');
  let f1 = f1Inp.value;
  let f2 = f2Inp.value;

  if (f1 === day) {
    f1 = '';
    f2 = day;
  } else if (f2 === day) {
    f2 = '';
  } else if (!f1) {
    f1 = day;
  } else if (!f2) {
    f2 = day;
  } else {
    f1 = day;
  }

  f1Inp.value = f1;
  f2Inp.value = f2;
  renderFreeDayPills();
}

function renderFreeDayPills() {
  const f1 = document.getElementById('editTeacherFreeDay1')?.value || '';
  const f2 = document.getElementById('editTeacherFreeDay2')?.value || '';
  const container = document.getElementById('freeDayPillContainer');
  if (!container) return;

  const days = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  container.innerHTML = days.map(d => {
    const isFirst = (f1 === d);
    const isSecond = (f2 === d);
    let label = d;
    let cls = '';
    if (isFirst) { cls = 'is-first'; label = `⭐ ${d} (1ª)`; }
    else if (isSecond) { cls = 'is-second'; label = `👍 ${d} (2ª)`; }
    return `<button type="button" class="pref-day-btn ${cls}" onclick="cycleFreeDay('${d}')">${label}</button>`;
  }).join('');
}

function onTeacherFullNameChange(val) {
  const shortInp = document.getElementById('editTeacherShortName');
  if (shortInp && (!shortInp.dataset.manuallyEdited || shortInp.dataset.manuallyEdited === '0')) {
    shortInp.value = computeShortNameJs(val);
  }
}

async function submitEditTeacher(origName) {
  const newName = (document.getElementById('editTeacherFullName')?.value || '').trim();
  if (!newName) {
    alert('Inserisci il nome del docente.');
    return;
  }
  const cdc = document.getElementById('editTeacherCdc').value.trim();
  const targetH = parseInt(document.getElementById('editTeacherTarget').value, 10) || 18;
  const minDays = parseInt(document.getElementById('editTeacherMinDays').value, 10) || 4;
  const maxDays = parseInt(document.getElementById('editTeacherMaxDays').value, 10) || 5;
  const shortName = (document.getElementById('editTeacherShortName')?.value || '').trim().toUpperCase();
  
  const contractRadio = document.querySelector('input[name="editTeacherContractType"]:checked');
  const contractType = contractRadio ? contractRadio.value : 'intera';
  const isCoe = (contractType === 'coe');
  const comments = document.getElementById('editTeacherComments').value.trim();

  // Campi Preferenze
  const prefShift = document.getElementById('editTeacherPrefShift')?.value || 'none';
  const prefWeight = parseInt(document.getElementById('editTeacherPrefWeight')?.value, 10) || 85;
  const freeDay1 = document.getElementById('editTeacherFreeDay1')?.value || '';
  const freeDay2 = document.getElementById('editTeacherFreeDay2')?.value || '';
  const freeDayStrict = Boolean(document.getElementById('editTeacherFreeDayStrict')?.checked);
  const maxSpan = document.getElementById('editTeacherMaxSpan')?.value ? parseInt(document.getElementById('editTeacherMaxSpan').value, 10) : null;
  const maxDailyLessons = document.getElementById('editTeacherMaxDailyLessons')?.value ? parseInt(document.getElementById('editTeacherMaxDailyLessons').value, 10) : null;
  const maxGapsPerDay = (document.getElementById('editTeacherMaxGapsPerDay')?.value !== '' && document.getElementById('editTeacherMaxGapsPerDay')?.value !== null) ? parseInt(document.getElementById('editTeacherMaxGapsPerDay').value, 10) : null;

  const customDispInp = document.getElementById('editTeacherCustomDisp');
  let customDispHours = null;
  if (customDispInp && customDispInp.value.trim() !== '') {
    const parsedDisp = parseInt(customDispInp.value.trim(), 10);
    if (!isNaN(parsedDisp) && parsedDisp >= 0) {
      customDispHours = parsedDisp;
    }
  }

  const res = await fetch('/api/teachers/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: origName,
      new_name: newName,
      short_name: shortName,
      cdc: cdc,
      target_hours: targetH,
      custom_disp_hours: customDispHours,
      min_days: minDays,
      max_days: maxDays,
      contract_type: contractType,
      is_coe: isCoe,
      comments: comments,
      pref_shift: prefShift,
      pref_shift_weight: prefWeight,
      free_day_1: freeDay1,
      free_day_2: freeDay2,
      free_day_strict: freeDayStrict,
      max_span: maxSpan,
      max_daily_lessons: maxDailyLessons,
      max_gaps_per_day: maxGapsPerDay
    })
  });

  if (res.ok) {
    closeModal();
    const msg = (origName !== newName) ? `Docente rinominato in "${newName}" con successo!` : `Parametri del docente "${origName}" aggiornati con successo!`;
    showToast(msg);
    renderTeachers();
  } else {
    alert("Errore durante l'aggiornamento del docente.");
  }
}


async function addTeacher() {
  const inp = document.getElementById('newTeacherName');
  const snInp = document.getElementById('newTeacherShortName');
  const cdcInp = document.getElementById('newTeacherCdc');
  const ctypeInp = document.getElementById('newTeacherContractType');
  const targetInp = document.getElementById('newTeacherTarget');

  const name = inp ? inp.value.trim() : '';
  const shortName = snInp ? snInp.value.trim().toUpperCase() : '';
  const cdc = cdcInp ? cdcInp.value.trim() : '';
  const ctype = ctypeInp ? ctypeInp.value : 'intera';
  const targetH = parseInt(targetInp?.value, 10) || 18;

  if (!name) {
    alert('Inserisci il nome del docente.');
    return;
  }

  const res = await fetch('/api/teachers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name,
      short_name: shortName || computeShortNameJs(name),
      cdc: cdc,
      contract_type: ctype,
      target_hours: targetH,
      is_coe: (ctype === 'coe'),
      min_days: targetH <= 9 ? 2 : (targetH <= 12 ? 3 : 4),
      max_days: targetH <= 12 ? 4 : 5
    })
  });

  if (res.ok) {
    if (inp) inp.value = '';
    if (snInp) snInp.value = '';
    if (cdcInp) cdcInp.value = '';
    showToast(`Docente "${name}" aggiunto con successo!`);
    renderTeachers();
  } else {
    alert("Docente già presente o nome non valido.");
  }
}

async function deleteTeacher(name) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (confirm(isEn ? `Are you sure you want to delete teacher "${name}"?` : `Sei sicuro di voler eliminare il docente "${name}"?`)) {
    await fetch(`/api/teachers/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(isEn ? `Teacher "${name}" deleted.` : `Docente "${name}" eliminato.`, 'warn');
    renderTeachers();
  }
}

// ============================================================================
// 4.1 AGGIORNA ORGANICO DOCENTI DA FILE WORD (.DOCX) O GOOGLE DOC
// ============================================================================
let organicoAnalysisData = null;
let activeOrganicoTab = 'upload'; // 'upload' | 'gdoc'
let selectedOrganicoFile = null;

function openAggiornaOrganicoModal() {
  organicoAnalysisData = null;
  activeOrganicoTab = 'upload';
  selectedOrganicoFile = null;
  const currentLang = (window.I18N ? window.I18N.getLanguage() : null) || localStorage.getItem('app_lang') || 'it';
  const isEn = currentLang === 'en';

  showModal(`
    <div class="modal-dialog" style="max-width:920px;width:95vw;max-height:92vh;">
      <div class="modal-header">
        <div class="modal-title">
          🔄 Aggiorna Organico Docenti (Word .docx / Google Doc)
        </div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body" style="padding:18px 22px;">
        <div class="info-banner-blue" style="margin-bottom:16px;">
          📋 <b>Sincronizzazione Organico:</b> Carica un file Word (.docx) o inserisci un link a un Google Doc con la tabella dell'organico (colonne: <i>Classe di Concorso, Docente, Classi, Ore</i>).<br>
          Il sistema analizzerà la tabella, la confronterà con i docenti attualmente nel database e ti presenterà un'anteprima dettagliata con <b>conferma selettiva</b> per aggiunte, modifiche e rimozioni, creando automaticamente uno <b>Snapshot di sicurezza</b> per il rollback.
        </div>

        <!-- Download Modello Word o Esportazione Attuale -->
        <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text-main);">📥 ${currentLang === 'en' ? 'Official Word Model (.docx)' : 'Modello Word Ufficiale (.docx)'}</div>
            <div style="font-size:11.5px;color:var(--text-muted);">${currentLang === 'en' ? 'Download 4-column model or export current faculty organico in Word format' : "Scarica la struttura esatta a 4 colonne o esporta l'organico attuale della scuola in formato Word"}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a href="/api/organico/template_docx?lang=${currentLang}" download="${currentLang === 'en' ? 'Eurario_Faculty_Organico_Template.docx' : 'Modello_Organico_Eurario.docx'}" class="btn btn-sm btn-outline" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;font-weight:700;border-color:var(--primary);color:var(--primary);">
              📥 ${currentLang === 'en' ? 'Download Sample Model (.docx)' : 'Scarica Modello Esempio (.docx)'}
            </a>
            <a href="/api/organico/template_docx?current=1&lang=${currentLang}" download="${currentLang === 'en' ? 'Current_School_Organico.docx' : 'Organico_Scuola_Attuale.docx'}" class="btn btn-sm btn-sec" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
              📄 ${currentLang === 'en' ? 'Export Current Organico (.docx)' : 'Esporta Organico Attuale (.docx)'}
            </a>
          </div>
        </div>

        <!-- Selettore Sorgente File Word / Google Doc -->
        <div class="segmented-control" style="margin-bottom:16px;">
          <button class="segmented-btn ${activeOrganicoTab === 'upload' ? 'active' : ''}" id="tabBtnOrganicoUpload" onclick="switchOrganicoSourceTab('upload')">
            📁 Carica File Word (.docx)
          </button>
          <button class="segmented-btn ${activeOrganicoTab === 'gdoc' ? 'active' : ''}" id="tabBtnOrganicoGDoc" onclick="switchOrganicoSourceTab('gdoc')">
            🔗 Inserisci Link Google Doc
          </button>
        </div>

        <!-- Tab 1: Upload File Locale -->
        <div id="organicoUploadPanel" style="display:${activeOrganicoTab === 'upload' ? 'block' : 'none'};">
          <div style="border:2px dashed var(--border);border-radius:var(--radius-md);padding:24px;text-align:center;background:var(--bg-card);transition:border-color 0.2s;" id="organicoDropZone" ondragover="event.preventDefault();this.style.borderColor='var(--primary)';" ondragleave="this.style.borderColor='var(--border)';" ondrop="handleOrganicoFileDrop(event)">
            <div style="font-size:32px;margin-bottom:8px;">📄</div>
            <div style="font-weight:700;font-size:14px;color:var(--text-main);margin-bottom:4px;">
              Trascina qui il file Word (.docx) dell'Organico oppure clicca per selezionarlo
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;">
              Supporta file con struttura <code>Organico Complessivo 2026-2027.docx</code> (Tabella CDC, Docente, Classi, Ore)
            </div>
            <input type="file" id="organicoFileInput" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none;" onchange="onOrganicoFileSelected(this)">
            <button type="button" class="btn btn-sec" onclick="document.getElementById('organicoFileInput').click()">
              📂 Scegli File dal Computer...
            </button>
            <div id="organicoFileNameDisplay" style="margin-top:10px;font-size:12.5px;font-weight:600;color:var(--primary);display:none;"></div>
          </div>
        </div>

        <!-- Tab 2: Google Doc Link -->
        <div id="organicoGDocPanel" style="display:${activeOrganicoTab === 'gdoc' ? 'block' : 'none'};">
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-weight:600;">Link del Documento Google Doc</label>
            <input type="url" id="organicoGDocUrl" class="form-input" placeholder="https://docs.google.com/document/d/1A2B3C.../edit?usp=sharing" style="font-family:var(--font-mono);font-size:12.5px;">
          </div>
          <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:var(--radius-sm);padding:10px 14px;font-size:12px;color:#92400e;">
            💡 <b>Nota importante sui permessi Google Docs:</b> Il documento deve essere condiviso con accesso <i>"Chiunque abbia il link può visualizzare"</i>. In alternativa, puoi semplicemente scaricare il file Word da Google Docs (<i>File ➔ Scarica ➔ Microsoft Word .docx</i>) e caricarlo nella scheda precedente.
          </div>
        </div>

        <!-- Azione di Analisi -->
        <div style="display:flex;justify-content:flex-end;margin-top:16px;margin-bottom:16px;">
          <button type="button" class="btn btn-primary" id="btnAnalyzeOrganico" onclick="analyzeOrganicoSource()" style="padding:9px 18px;font-weight:700;">
            🔍 Analizza e Confronta con Organico Attuale
          </button>
        </div>

        <!-- Contenitore Risultati Analisi / Diff -->
        <div id="organicoDiffContainer" style="display:none;"></div>
      </div>
      <div class="modal-footer" style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.close">${_t('common.close', 'Chiudi')}</button>
        <div id="organicoFooterActions" style="display:none;gap:10px;">
          <button class="btn btn-primary" onclick="submitApplyOrganico()" style="padding:8px 18px;font-weight:700;">
            ✅ Conferma e Applica Modifiche Organico
          </button>
        </div>
      </div>
    </div>
  `);
}

function switchOrganicoSourceTab(tab) {
  activeOrganicoTab = tab;
  const btnUp = document.getElementById('tabBtnOrganicoUpload');
  const btnGd = document.getElementById('tabBtnOrganicoGDoc');
  const panUp = document.getElementById('organicoUploadPanel');
  const panGd = document.getElementById('organicoGDocPanel');
  if (btnUp && btnGd && panUp && panGd) {
    btnUp.classList.toggle('active', tab === 'upload');
    btnGd.classList.toggle('active', tab === 'gdoc');
    panUp.style.display = (tab === 'upload') ? 'block' : 'none';
    panGd.style.display = (tab === 'gdoc') ? 'block' : 'none';
  }
}

function handleOrganicoFileDrop(e) {
  e.preventDefault();
  const dropZone = document.getElementById('organicoDropZone');
  if (dropZone) dropZone.style.borderColor = 'var(--border)';
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const f = e.dataTransfer.files[0];
    if (f.name.toLowerCase().endsWith('.docx')) {
      selectedOrganicoFile = f;
      showSelectedOrganicoFileName(f.name, f.size);
    } else {
      alert('Seleziona un file con estensione .docx');
    }
  }
}

function onOrganicoFileSelected(input) {
  if (input && input.files && input.files.length > 0) {
    const f = input.files[0];
    selectedOrganicoFile = f;
    showSelectedOrganicoFileName(f.name, f.size);
  }
}

function showSelectedOrganicoFileName(name, size) {
  const disp = document.getElementById('organicoFileNameDisplay');
  if (disp) {
    const kb = Math.round(size / 1024);
    disp.innerHTML = `✓ File pronto: <b>${escapeHtml(name)}</b> (${kb} KB)`;
    disp.style.display = 'block';
  }
}

async function analyzeOrganicoSource() {
  const btn = document.getElementById('btnAnalyzeOrganico');
  const diffBox = document.getElementById('organicoDiffContainer');
  const footerActions = document.getElementById('organicoFooterActions');

  if (diffBox) {
    diffBox.style.display = 'block';
    diffBox.innerHTML = `
      <div style="text-align:center;padding:30px 10px;color:var(--text-muted);">
        <div style="font-size:24px;margin-bottom:8px;">⏳</div>
        <div><b>Analisi tabella e confronto in corso...</b> Attendere qualche secondo.</div>
      </div>
    `;
  }
  if (btn) btn.disabled = true;
  if (footerActions) footerActions.style.display = 'none';

  try {
    let payload = {};
    if (activeOrganicoTab === 'upload') {
      if (!selectedOrganicoFile) {
        alert('Seleziona prima un file Word (.docx) da analizzare.');
        if (btn) btn.disabled = false;
        if (diffBox) diffBox.style.display = 'none';
        return;
      }
      const b64 = await readFileAsBase64(selectedOrganicoFile);
      payload = { docx_base64: b64, filename: selectedOrganicoFile.name };
    } else {
      const gUrl = (document.getElementById('organicoGDocUrl')?.value || '').trim();
      if (!gUrl) {
        alert('Inserisci il link del Google Doc.');
        if (btn) btn.disabled = false;
        if (diffBox) diffBox.style.display = 'none';
        return;
      }
      payload = { google_doc_url: gUrl };
    }

    const res = await fetch('/api/organico/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Errore durante l\'analisi dell\'organico');
    }

    // Estrai la struttura diff con massima compatibilità
    const diffObj = {
      summary: data.summary || (data.diff && data.diff.summary) || {},
      added: data.added || (data.diff && data.diff.added) || [],
      modified: data.modified || (data.diff && data.diff.modified) || [],
      removed: data.removed || (data.diff && data.diff.removed) || [],
      unchanged: data.unchanged || (data.diff && data.diff.unchanged) || []
    };

    organicoAnalysisData = diffObj;
    renderOrganicoDiffView(diffObj, data.total_parsed);
    if (footerActions) footerActions.style.display = 'flex';

  } catch (err) {
    if (diffBox) {
      diffBox.innerHTML = `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:var(--radius-md);padding:14px 18px;color:#991b1b;margin-top:12px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
            <span>❌</span> Errore durante l'analisi dell'Organico:
          </div>
          <div style="font-size:13px;white-space:pre-wrap;">${escapeHtml(err.message)}</div>
        </div>
      `;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

function renderOrganicoDiffView(diff, totalParsed) {
  const diffBox = document.getElementById('organicoDiffContainer');
  if (!diffBox) return;

  const added = diff.added || [];
  const modified = diff.modified || [];
  const removed = diff.removed || [];
  const unchanged = diff.unchanged || [];
  const discrepancies = diff.discrepancies || (diff.diff && diff.diff.discrepancies) || [];

  diffBox.innerHTML = `
    <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:14px;">
      <!-- Statistiche di Sintesi -->
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:16px;">
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:var(--radius-md);padding:10px 14px;">
          <div style="font-size:11px;font-weight:700;color:#065f46;text-transform:uppercase;">➕ Nuovi Docenti</div>
          <div style="font-size:22px;font-weight:800;color:#047857;margin-top:2px;">${added.length}</div>
          <div style="font-size:11px;color:#065f46;">presenti solo nel file</div>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--radius-md);padding:10px 14px;">
          <div style="font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;">✏️ Docenti Modificati</div>
          <div style="font-size:22px;font-weight:800;color:#1d4ed8;margin-top:2px;">${modified.length}</div>
          <div style="font-size:11px;color:#1e40af;">con variazioni CDC/ore</div>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius-md);padding:10px 14px;">
          <div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;">🗑️ Non Presenti</div>
          <div style="font-size:22px;font-weight:800;color:#b45309;margin-top:2px;">${removed.length}</div>
          <div style="font-size:11px;color:#92400e;">candidati rimozione</div>
        </div>
        <div style="background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px;">
          <div style="font-size:11px;font-weight:700;color:var(--text-sub);text-transform:uppercase;">✓ Invariati</div>
          <div style="font-size:22px;font-weight:800;color:var(--text-main);margin-top:2px;">${unchanged.length}</div>
          <div style="font-size:11px;color:var(--text-muted);">dati identici</div>
        </div>
      </div>

      <!-- AVVISO VERIFICA SOMMA ORE CATTEDRA -->
      ${discrepancies.length > 0 ? `
        <div style="background:#fef2f2;border:1.5px solid #f87171;border-radius:var(--radius-md);padding:12px 16px;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:8px;font-weight:700;color:#991b1b;font-size:13px;">
            <span style="font-size:16px;">⚠️</span>
            <span>Verifica Somma Ore Cattedra: rilevate ${discrepancies.length} anomalie tra ore per materia e totale dichiarato nel file</span>
          </div>
          <div style="font-size:11.5px;color:#7f1d1d;margin-top:4px;">
            La somma delle ore specificate tra parentesi per le classi non coincide con il totale ore cattedra indicato nella colonna 'Ore':
          </div>
          <div style="max-height:110px;overflow:auto;margin-top:8px;font-size:11px;background:#fff;border-radius:var(--radius-sm);border:1px solid #fecaca;padding:6px 10px;">
            ${discrepancies.map(d => `
              <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #fee2e2;">
                <span><b>${escapeHtml(d.name)}</b>: dichiarato <b>${d.declared_hours}h</b> ➔ somma materie <b>${d.sum_hours}h</b> (${d.diff > 0 ? '+' + d.diff : d.diff}h)</span>
                <span style="color:#b91c1c;font-family:var(--font-mono);font-size:10.5px;">${escapeHtml(d.classi_raw || '')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- 1. SEZIONE NUOVI DOCENTI -->
      ${added.length > 0 ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;margin-bottom:14px;background:#fff;">
          <div style="padding:10px 14px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;display:flex;justify-content:space-between;align-items:center;">
            <div style="font-weight:700;color:#166534;font-size:13.5px;display:flex;align-items:center;gap:6px;">
              <span>➕ Nuovi Docenti da Aggiungere (${added.length})</span>
            </div>
            <label style="font-size:12px;font-weight:600;color:#166534;cursor:pointer;display:flex;align-items:center;gap:4px;">
              <input type="checkbox" id="chkAllAdded" checked onchange="toggleAllCheckboxes('organicoAddDocChk', this.checked)">
              Seleziona tutti
            </label>
          </div>
          <div style="max-height:220px;overflow:auto;">
            <table class="data-table" style="font-size:12.5px;">
              <thead>
                <tr>
                  <th style="width:40px;text-align:center;">Applica</th>
                  <th>Docente</th>
                  <th style="width:90px;text-align:center;">CDC</th>
                  <th style="width:100px;text-align:center;">Ore Cattedra</th>
                  <th style="width:110px;">Tipologia</th>
                  <th>Assegnazioni dal File</th>
                </tr>
              </thead>
              <tbody>
                ${added.map((doc, idx) => `
                  <tr>
                    <td style="text-align:center;">
                      <input type="checkbox" class="organicoAddDocChk" data-index="${idx}" checked>
                    </td>
                    <td><b>👨‍🏫 ${escapeHtml(doc.name)}</b></td>
                    <td style="text-align:center;"><span class="item-chip">${escapeHtml(doc.cdc || '-')}</span></td>
                    <td style="text-align:center;">
                      <span class="badge badge-info">${doc.target_hours || 18}h</span>
                      ${doc.hours_discrepancy ? `<br><span class="badge badge-err" style="font-size:10px;margin-top:2px;" title="Somma ore per materia (${doc.sum_hours}h) diversa dal totale cattedra (${doc.target_hours}h)">⚠️ ${doc.sum_hours}h</span>` : ''}
                    </td>
                    <td><span class="badge ${doc.contract_type === 'coe' ? 'badge-coe' : (doc.contract_type === 'spezzone' ? 'badge-spezzone' : (doc.contract_type === 'part_time' ? 'badge-pt' : 'badge-intera'))}">${escapeHtml(doc.contract_type === 'coe' ? 'COE' : (doc.contract_type === 'spezzone' ? 'Spezzone' : (doc.contract_type === 'part_time' ? 'Part-Time' : 'Intera (18h)')))}</span></td>
                    <td style="font-size:11.5px;color:var(--text-muted);">${escapeHtml(doc.classi_raw || '-')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- 2. SEZIONE DOCENTI MODIFICATI -->
      ${modified.length > 0 ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;margin-bottom:14px;background:#fff;">
          <div style="padding:10px 14px;background:#eff6ff;border-bottom:1px solid #bfdbfe;display:flex;justify-content:space-between;align-items:center;">
            <div style="font-weight:700;color:#1e40af;font-size:13.5px;display:flex;align-items:center;gap:6px;">
              <span>✏️ Docenti con Variazioni Rilevate (${modified.length})</span>
            </div>
            <label style="font-size:12px;font-weight:600;color:#1e40af;cursor:pointer;display:flex;align-items:center;gap:4px;">
              <input type="checkbox" id="chkAllModified" checked onchange="toggleAllCheckboxes('organicoModDocChk', this.checked)">
              Seleziona tutti
            </label>
          </div>
          <div style="max-height:300px;overflow:auto;">
            <table class="data-table" style="font-size:12.5px;">
              <thead>
                <tr>
                  <th style="width:40px;text-align:center;">Applica</th>
                  <th style="min-width:160px;">Docente</th>
                  <th style="min-width:260px;">Variazioni Rilevate (DB Attuale ➔ File Word)</th>
                  <th>Classi dal File</th>
                </tr>
              </thead>
              <tbody>
                ${modified.map((item, idx) => {
                  const diffsList = Array.isArray(item.diffs) ? item.diffs : (item.diffs ? Object.values(item.diffs) : []);
                  const chips = [];
                  diffsList.forEach(df => {
                    if (df.field === 'cdc') {
                      chips.push(`<div><b>CDC:</b> <span class="badge badge-warn">${escapeHtml(df.old || '-')}</span> ➔ <span class="badge badge-ok">${escapeHtml(df.new)}</span></div>`);
                    } else if (df.field === 'target_hours') {
                      chips.push(`<div><b>Ore Cattedra:</b> <span class="badge badge-warn">${escapeHtml(String(df.old))}</span> ➔ <span class="badge badge-ok">${escapeHtml(String(df.new))}</span></div>`);
                    } else if (df.field === 'contract_type') {
                      const formatCtype = ct => ct === 'coe' ? 'COE' : (ct === 'spezzone' ? 'Spezzone' : (ct === 'part_time' ? 'Part-Time' : 'Intera (18h)'));
                      chips.push(`<div><b>Tipologia:</b> <span class="badge">${escapeHtml(formatCtype(df.old))}</span> ➔ <span class="badge badge-ok">${escapeHtml(formatCtype(df.new))}</span></div>`);
                    } else if (df.field === 'classes') {
                      chips.push(`<div style="font-size:11px;color:var(--text-sub);"><b>Classi:</b> ${escapeHtml(df.old || 'Nessuna')} ➔ ${escapeHtml(df.new || 'Nessuna')}</div>`);
                    } else {
                      chips.push(`<div><b>${escapeHtml(df.label || df.field)}:</b> <span class="badge badge-warn">${escapeHtml(String(df.old))}</span> ➔ <span class="badge badge-ok">${escapeHtml(String(df.new))}</span></div>`);
                    }
                  });
                  return `
                    <tr>
                      <td style="text-align:center;">
                        <input type="checkbox" class="organicoModDocChk" data-index="${idx}" checked>
                      </td>
                      <td>
                        <b>👨‍🏫 ${escapeHtml(item.name)}</b>
                        ${item.docente_new?.hours_discrepancy ? `<br><span class="badge badge-err" style="font-size:10px;margin-top:2px;" title="Somma ore per materia (${item.docente_new.sum_hours}h) diversa dal totale cattedra (${item.docente_new.target_hours}h)">⚠️ Somma ${item.docente_new.sum_hours}h ≠ ${item.docente_new.target_hours}h</span>` : ''}
                      </td>
                      <td><div style="display:flex;flex-direction:column;gap:3px;">${chips.length > 0 ? chips.join('') : '<span style="color:var(--text-muted);font-size:11.5px;">Variazione cattedra</span>'}</div></td>
                      <td style="font-size:11.5px;color:var(--text-muted);">${escapeHtml(item.docente_new?.classi_raw || '-')}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- 3. SEZIONE DOCENTI NON PRESENTI (CANDIDATI RIMOZIONE) -->
      ${removed.length > 0 ? `
        <div style="border:1px solid #fed7aa;border-radius:var(--radius-md);overflow:hidden;margin-bottom:14px;background:#fff;">
          <div style="padding:10px 14px;background:#fff7ed;border-bottom:1px solid #fed7aa;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;color:#9a3412;font-size:13.5px;">
                ⚠️ Docenti nel Database non presenti nel file Word (${removed.length})
              </div>
              <div style="font-size:11px;color:#c2410c;margin-top:2px;">
                Per sicurezza, questi docenti sono <b>deselezionati per default</b>. Seleziona solo quelli che intendi rimuovere.
              </div>
            </div>
            <label style="font-size:12px;font-weight:600;color:#9a3412;cursor:pointer;display:flex;align-items:center;gap:4px;">
              <input type="checkbox" id="chkAllRemoved" onchange="toggleAllCheckboxes('organicoRemDocChk', this.checked)">
              Seleziona tutti
            </label>
          </div>
          <div style="max-height:180px;overflow:auto;">
            <table class="data-table" style="font-size:12.5px;">
              <thead>
                <tr>
                  <th style="width:40px;text-align:center;">Rimuovi</th>
                  <th>Docente</th>
                  <th style="width:90px;text-align:center;">CDC</th>
                  <th style="width:100px;text-align:center;">Ore Cattedra</th>
                  <th>Stato Attuale</th>
                </tr>
              </thead>
              <tbody>
                ${removed.map((doc, idx) => `
                  <tr>
                    <td style="text-align:center;">
                      <input type="checkbox" class="organicoRemDocChk" data-index="${idx}">
                    </td>
                    <td><b>👨‍🏫 ${escapeHtml(doc.name)}</b></td>
                    <td style="text-align:center;"><span class="item-chip">${escapeHtml(doc.cdc || '-')}</span></td>
                    <td style="text-align:center;">${doc.target_hours || 18}h</td>
                    <td><span class="badge badge-warn">${doc.total_hours || 0}h assegnate</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- 4. DOCENTI INVARIATI -->
      ${unchanged.length > 0 ? `
        <details style="margin-bottom:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:#f8fafc;padding:8px 12px;font-size:12.5px;">
          <summary style="font-weight:600;cursor:pointer;color:var(--text-sub);">
            ✓ ${unchanged.length} Docenti Invariati (clicca per visualizzare l'elenco)
          </summary>
          <div style="margin-top:8px;font-size:12px;color:var(--text-main);max-height:140px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:5px;">
            ${unchanged.map(item => `<span class="item-chip" style="font-size:11px;">👨‍🏫 ${escapeHtml(typeof item === 'object' ? (item.name || '') : item)}</span>`).join('')}
          </div>
        </details>
      ` : ''}

      <!-- 5. OPZIONI DI APPLICAZIONE -->
      <div style="background:#f1f5f9;border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 16px;display:flex;flex-direction:column;gap:8px;">
        <label style="font-size:12.5px;font-weight:600;color:var(--text-main);display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="organicoCreateSnapshot" checked>
          <span>🛡️ <b>Crea automaticamente uno Snapshot di sicurezza</b> prima di applicare (consigliato per rollback istantaneo)</span>
        </label>
        <label style="font-size:12.5px;font-weight:600;color:var(--text-main);display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="organicoSyncActivities" checked>
          <span>📚 <b>Sincronizza Cattedre e Attività (Opzione A — Additiva Intelligente):</b> genera le cattedre per i nuovi docenti e assegna le eventuali nuove classi mancanti per i docenti modificati (preservando intatte le cattedre e gli accorpamenti già esistenti)</span>
        </label>
      </div>
    </div>
  `;
}

function toggleAllCheckboxes(className, checked) {
  document.querySelectorAll('.' + className).forEach(chk => {
    chk.checked = checked;
  });
}

async function submitApplyOrganico() {
  if (!organicoAnalysisData) return;

  const added = organicoAnalysisData.added || [];
  const modified = organicoAnalysisData.modified || [];
  const removed = organicoAnalysisData.removed || [];

  const selectedAdded = [];
  document.querySelectorAll('.organicoAddDocChk:checked').forEach(chk => {
    const idx = parseInt(chk.dataset.index, 10);
    if (added[idx]) selectedAdded.push(added[idx]);
  });

  const selectedModified = [];
  document.querySelectorAll('.organicoModDocChk:checked').forEach(chk => {
    const idx = parseInt(chk.dataset.index, 10);
    if (modified[idx]) selectedModified.push(modified[idx]);
  });

  const selectedRemoved = [];
  document.querySelectorAll('.organicoRemDocChk:checked').forEach(chk => {
    const idx = parseInt(chk.dataset.index, 10);
    if (removed[idx]) selectedRemoved.push(typeof removed[idx] === 'object' ? removed[idx].name : removed[idx]);
  });

  const totalOps = selectedAdded.length + selectedModified.length + selectedRemoved.length;
  if (totalOps === 0) {
    alert('Nessuna modifica selezionata per l\'applicazione.');
    return;
  }

  const msg = `Confermi l'applicazione dell'aggiornamento organico?\n\n` +
              `• Nuovi docenti da aggiungere: ${selectedAdded.length}\n` +
              `• Docenti da aggiornare: ${selectedModified.length}\n` +
              `• Docenti da rimuovere: ${selectedRemoved.length}\n\n` +
              `Verrà creato automaticamente uno snapshot di sicurezza prima di procedere.`;

  if (!confirm(msg)) return;

  const createSnap = document.getElementById('organicoCreateSnapshot')?.checked ?? true;
  const syncActs = document.getElementById('organicoSyncActivities')?.checked ?? false;

  try {
    const res = await fetch('/api/organico/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        create_snapshot: createSnap,
        apply_added: selectedAdded,
        apply_modified: selectedModified,
        apply_removed: selectedRemoved,
        sync_activities: syncActs
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Errore durante l\'applicazione dell\'organico');
    }

    closeModal();
    showToast(`Organico aggiornato con successo! (+${selectedAdded.length} agg., ${selectedModified.length} mod., -${selectedRemoved.length} rim.)`);
    renderTeachers();
    if (typeof loadSnapshotsList === 'function') loadSnapshotsList();
  } catch (err) {
    alert('Errore: ' + err.message);
  }
}

// ============================================================================
// 4.2 ALLINEAMENTO TIPOLOGIA CATTEDRE DOCENTI (EXCEL / CSV)
// ============================================================================
let cattedreAnalysisData = null;
let activeCattedreTab = 'upload'; // 'upload' | 'paste'
let selectedCattedreFile = null;

function openAllineaCattedreModal() {
  cattedreAnalysisData = null;
  activeCattedreTab = 'upload';
  selectedCattedreFile = null;
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;

  showModal(`
    <div class="modal-dialog" style="max-width:960px;width:95vw;max-height:92vh;">
      <div class="modal-header">
        <div class="modal-title">
          📊 ${isEn ? 'Align Faculty Contract Types & Hours (Excel / CSV)' : 'Allinea Tipologia Cattedre Docenti (Excel / CSV)'}
        </div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body" style="padding:18px 22px;">
        <div class="info-banner-blue" style="margin-bottom:16px;">
          📋 <b>${isEn ? 'Faculty Alignment Tool:' : 'Allineamento Tipologie Cattedre:'}</b> ${isEn 
            ? 'Import or paste your faculty table with columns: <i>CDC, Teacher, Classes, Hours, Contract Type, Days</i>. Eurario will detect exact legal posts (<b>COE</b>, <b>Spezzoni</b>, <b>Part-Time</b>, <b>Full-Time</b>, hours and days per week) and show a detailed preview before applying changes.' 
            : 'Carica un file Excel (.xlsx), CSV o incolla la tabella con le colonne: <i>Classe di Concorso, Docente, Classi, Ore, Tipo di Cattedra, Orario su giorni</i>.<br>Il sistema identificherà con esattezza le cattedre <b>COE</b>, <b>Spezzoni</b>, <b>Part-Time</b> o <b>Intere</b>, allineando ore e giorni settimanali e presentandoti un\'anteprima selettiva prima di salvare.'}
        </div>

        <!-- Download Modello o Esportazione -->
        <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text-main);">📥 ${isEn ? 'Excel / CSV Templates' : 'Modello Cattedre & Esportazione'}</div>
            <div style="font-size:11.5px;color:var(--text-muted);">${isEn ? 'Download a sample CSV structure or export current faculty posts' : 'Scarica il modello di esempio CSV o esporta l\'elenco attuale dei docenti'}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a href="/api/teachers/align_cattedre/template_csv" download="Modello_Allineamento_Cattedre.csv" class="btn btn-sm btn-outline" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;font-weight:700;border-color:#059669;color:#059669;">
              📥 ${isEn ? 'Download Sample CSV' : 'Scarica Modello Esempio (.csv)'}
            </a>
            <a href="/api/teachers/align_cattedre/template_csv?current=1" download="Docenti_Cattedre_Attuali.csv" class="btn btn-sm btn-sec" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
              📄 ${isEn ? 'Export Current Teachers (.csv)' : 'Esporta Cattedre Attuali (.csv)'}
            </a>
          </div>
        </div>

        <!-- Selettore Sorgente -->
        <div class="segmented-control" style="margin-bottom:16px;">
          <button class="segmented-btn ${activeCattedreTab === 'upload' ? 'active' : ''}" id="tabBtnCattedreUpload" onclick="switchCattedreSourceTab('upload')">
            📁 ${isEn ? 'Upload Excel (.xlsx) / CSV' : 'Carica File Excel (.xlsx) o CSV'}
          </button>
          <button class="segmented-btn ${activeCattedreTab === 'paste' ? 'active' : ''}" id="tabBtnCattedrePaste" onclick="switchCattedreSourceTab('paste')">
            📋 ${isEn ? 'Paste Table from Excel / CSV' : 'Incolla Tabella da Excel / Testo'}
          </button>
        </div>

        <!-- Tab 1: Upload File -->
        <div id="cattedreUploadPanel" style="display:${activeCattedreTab === 'upload' ? 'block' : 'none'};">
          <div style="border:2px dashed var(--border);border-radius:var(--radius-md);padding:24px;text-align:center;background:var(--bg-card);transition:border-color 0.2s;" id="cattedreDropZone" ondragover="event.preventDefault();this.style.borderColor='#059669';" ondragleave="this.style.borderColor='var(--border)';" ondrop="handleCattedreFileDrop(event)">
            <div style="font-size:32px;margin-bottom:8px;">📊</div>
            <div style="font-weight:700;font-size:14px;color:var(--text-main);margin-bottom:4px;">
              ${isEn ? 'Drag & drop your Excel (.xlsx) or CSV file here, or click to browse' : 'Trascina qui il file Excel (.xlsx) o CSV, oppure clicca per selezionarlo'}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;">
              ${isEn ? 'Supports .xlsx, .xls and .csv files with columns: CDC, Teacher, Classes, Hours, Contract Type, Days' : 'Supporta file con colonne: <i>Classe di Concorso, Docente, Classi, Ore, Tipo di Cattedra, Orario su giorni</i>'}
            </div>
            <input type="file" id="cattedreFileInput" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none;" onchange="onCattedreFileSelected(this)">
            <button type="button" class="btn btn-sec" onclick="document.getElementById('cattedreFileInput').click()">
              📂 ${isEn ? 'Choose File from Computer...' : 'Scegli File dal Computer...'}
            </button>
            <div id="selectedCattedreFileName" style="margin-top:10px;font-size:12.5px;font-weight:700;color:#059669;display:none;"></div>
          </div>
        </div>

        <!-- Tab 2: Incolla Testo -->
        <div id="cattedrePastePanel" style="display:${activeCattedreTab === 'paste' ? 'block' : 'none'};">
          <label style="font-size:12px;font-weight:600;margin-bottom:6px;display:block;color:var(--text-main);">
            ${isEn ? 'Paste table rows directly (copied from Excel or CSV format):' : 'Incolla direttamente le righe della tabella (copiate da Excel o in formato CSV):'}
          </label>
          <textarea id="cattedrePasteTextarea" class="form-input" style="width:100%;height:150px;font-family:var(--font-mono);font-size:11.5px;line-height:1.4;" placeholder="Classe di Concorso,Docente,Classi,Ore,Tipo di Cattedra,Orario su giorni&#10;A011 - Discipline Letterarie,Baston Michela,1C(4)...,14,PART TIME,4&#10;A015 - Discipline Sanitarie,Di Zane Alessia,3G(4)...,8,COE,&#10;A021 - Geografia,Funaro Pascale,2B(3)...,13,SPEZZONE,&#10;A026 - Matematica,Rigoni Carlo,2L(4)...,18,,"></textarea>
        </div>

        <!-- Pulsante Analizza -->
        <div style="margin-top:14px;text-align:right;">
          <button type="button" class="btn btn-primary" id="btnAnalyzeCattedre" onclick="analyzeCattedreAlignment()" style="background:#059669;border-color:#047857;font-weight:700;padding:8px 20px;">
            🔍 ${isEn ? 'Analyze Contract Types & Hours' : 'Analizza Tabella Cattedre'}
          </button>
        </div>

        <!-- Contenitore Diff & Risultati -->
        <div id="cattedreDiffContainer" style="display:none;"></div>
      </div>

      <div class="modal-footer" id="cattedreModalFooter" style="display:none;padding:14px 22px;border-top:1px solid var(--border);justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;background:var(--bg-main);">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="chkCattedreSnapshot" checked />
            <span>🛡️ ${isEn ? 'Create automatic safety snapshot before applying' : 'Crea snapshot di sicurezza automatico prima di salvare'}</span>
          </label>
          <label style="font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="chkCattedreUpdateCdc" />
            <span>🏷️ ${isEn ? 'Also update Teaching Subject Class (CDC) from file' : 'Aggiorna anche la Classe di Concorso (CDC) indicata nel foglio'}</span>
          </label>
        </div>
        <div style="display:flex;gap:10px;">
          <button type="button" class="btn btn-sec" onclick="closeModal()">${isEn ? 'Cancel' : 'Annulla'}</button>
          <button type="button" class="btn btn-primary" id="btnApplyCattedre" onclick="applyCattedreAlignment()" style="background:#059669;border-color:#047857;font-weight:700;padding:8px 20px;">
            💾 ${isEn ? 'Apply Selected Changes' : 'Applica Modifiche Selezionate'}
          </button>
        </div>
      </div>
    </div>
  `);
}

function switchCattedreSourceTab(tab) {
  activeCattedreTab = tab;
  document.getElementById('tabBtnCattedreUpload')?.classList.toggle('active', tab === 'upload');
  document.getElementById('tabBtnCattedrePaste')?.classList.toggle('active', tab === 'paste');
  const upPanel = document.getElementById('cattedreUploadPanel');
  if (upPanel) upPanel.style.display = (tab === 'upload') ? 'block' : 'none';
  const pastePanel = document.getElementById('cattedrePastePanel');
  if (pastePanel) pastePanel.style.display = (tab === 'paste') ? 'block' : 'none';
}

function handleCattedreFileDrop(e) {
  e.preventDefault();
  const dt = e.dataTransfer;
  if (dt && dt.files && dt.files.length > 0) {
    selectedCattedreFile = dt.files[0];
    showSelectedCattedreFileName(selectedCattedreFile.name);
  }
}

function onCattedreFileSelected(input) {
  if (input && input.files && input.files.length > 0) {
    selectedCattedreFile = input.files[0];
    showSelectedCattedreFileName(selectedCattedreFile.name);
  }
}

function showSelectedCattedreFileName(name) {
  const el = document.getElementById('selectedCattedreFileName');
  if (el) {
    el.innerText = `📄 ${name}`;
    el.style.display = 'block';
  }
}

function toggleAllCattedreCheckboxes(checked) {
  document.querySelectorAll('.cattedre-upd-chk').forEach(cb => {
    cb.checked = checked;
  });
  updateCattedreApplyButtonCount();
}

function updateCattedreApplyButtonCount() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const count = document.querySelectorAll('.cattedre-upd-chk:checked').length;
  const btn = document.getElementById('btnApplyCattedre');
  if (btn) {
    btn.innerText = isEn ? `💾 Apply Selected Changes (${count})` : `💾 Applica Modifiche Selezionate (${count})`;
    btn.disabled = (count === 0);
  }
}

async function analyzeCattedreAlignment() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const btn = document.getElementById('btnAnalyzeCattedre');
  if (btn) {
    btn.disabled = true;
    btn.innerText = isEn ? 'Analyzing...' : 'Analisi in corso...';
  }

  try {
    let payload = {};
    if (activeCattedreTab === 'upload') {
      if (!selectedCattedreFile) {
        alert(isEn ? 'Please select an Excel (.xlsx) or CSV file first.' : 'Seleziona prima un file Excel (.xlsx) o CSV da analizzare.');
        if (btn) { btn.disabled = false; btn.innerText = isEn ? '🔍 Analyze Contract Types & Hours' : '🔍 Analizza Tabella Cattedre'; }
        return;
      }
      const b64 = await readFileAsBase64(selectedCattedreFile);
      payload = { file_base64: b64, filename: selectedCattedreFile.name };
    } else {
      const text = (document.getElementById('cattedrePasteTextarea')?.value || '').trim();
      if (!text) {
        alert(isEn ? 'Please paste your table content first.' : 'Incolla prima il testo o la tabella da analizzare.');
        if (btn) { btn.disabled = false; btn.innerText = isEn ? '🔍 Analyze Contract Types & Hours' : '🔍 Analizza Tabella Cattedre'; }
        return;
      }
      payload = { text: text };
    }

    const res = await fetch('/api/teachers/align_cattedre/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_e) {
      data = { error: `HTTP ${res.status}: ${res.statusText || 'Risposta del server non valida'}` };
    }
    if (!res.ok || !data.success) {
      const errMsg = data.error || data.message || data.detail || (Array.isArray(data.errors) ? data.errors.map(e => e.message || e).join(', ') : null) || (isEn ? 'Analysis failed' : 'Analisi fallita');
      throw new Error(errMsg);
    }

    cattedreAnalysisData = data;
    renderCattedreDiffView(data);
  } catch (err) {
    alert((isEn ? 'Analysis error: ' : 'Errore durante l\'analisi: ') + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = isEn ? '🔍 Analyze Contract Types & Hours' : '🔍 Analizza Tabella Cattedre';
    }
  }
}

function renderCattedreDiffView(data) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const container = document.getElementById('cattedreDiffContainer');
  if (!container) return;

  const toUpdate = data.to_update || [];
  const unchanged = data.unchanged || [];
  const notFound = data.not_found || [];

  function formatCtypeBadge(ctype) {
    if (ctype === 'coe') return `<span class="badge" style="background:#ccfbf1;color:#0f766e;border:1px solid #14b8a6;font-weight:700;">🏫 COE</span>`;
    if (ctype === 'part_time') return `<span class="badge" style="background:#f3e8ff;color:#6b21a8;border:1px solid #c084fc;font-weight:700;">⏳ Part-Time</span>`;
    if (ctype === 'spezzone') return `<span class="badge" style="background:#ffedd5;color:#c2410c;border:1px solid #fb923c;font-weight:700;">🧩 Spezzone</span>`;
    return `<span class="badge" style="background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;font-weight:700;">🏛️ Intera</span>`;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px;">
      <!-- Statistiche di Sintesi -->
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-bottom:16px;">
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:var(--radius-md);padding:10px 14px;">
          <div style="font-size:11px;font-weight:700;color:#065f46;text-transform:uppercase;">✏️ ${isEn ? 'To Update' : 'Da Aggiornare'}</div>
          <div style="font-size:24px;font-weight:800;color:#047857;margin-top:2px;">${toUpdate.length}</div>
          <div style="font-size:11px;color:#065f46;">${isEn ? 'with detected changes' : 'con variazioni tipologia/ore/giorni'}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px;">
          <div style="font-size:11px;font-weight:700;color:var(--text-sub);text-transform:uppercase;">✓ ${isEn ? 'Already Aligned' : 'Già Allineati'}</div>
          <div style="font-size:24px;font-weight:800;color:var(--text-main);margin-top:2px;">${unchanged.length}</div>
          <div style="font-size:11px;color:var(--text-muted);">${isEn ? 'no changes needed' : 'dati già identici'}</div>
        </div>
        <div style="background:${notFound.length > 0 ? '#fffbeb' : '#f8fafc'};border:1px solid ${notFound.length > 0 ? '#fde68a' : 'var(--border)'};border-radius:var(--radius-md);padding:10px 14px;">
          <div style="font-size:11px;font-weight:700;color:${notFound.length > 0 ? '#92400e' : 'var(--text-sub)'};text-transform:uppercase;">❓ ${isEn ? 'Not in Database' : 'Non in Elenco'}</div>
          <div style="font-size:24px;font-weight:800;color:${notFound.length > 0 ? '#b45309' : 'var(--text-muted)'};margin-top:2px;">${notFound.length}</div>
          <div style="font-size:11px;color:${notFound.length > 0 ? '#92400e' : 'var(--text-muted)'};">${isEn ? 'names not found' : 'nominativi non presenti nel db'}</div>
        </div>
      </div>

      <!-- Tabella dei docenti con modifiche rilevate -->
      ${toUpdate.length > 0 ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;margin-bottom:14px;background:var(--bg-card);">
          <div style="padding:10px 14px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;display:flex;justify-content:space-between;align-items:center;">
            <div style="font-weight:700;color:#166534;font-size:13.5px;display:flex;align-items:center;gap:6px;">
              <span>✏️ ${isEn ? 'Faculty Variations to Apply' : 'Variazioni Cattedra Rilevate'} (${toUpdate.length})</span>
            </div>
            <label style="font-size:12px;font-weight:600;color:#166534;cursor:pointer;display:flex;align-items:center;gap:4px;">
              <input type="checkbox" id="chkAllCattedreUpdates" checked onchange="toggleAllCattedreCheckboxes(this.checked)">
              ${isEn ? 'Select All' : 'Seleziona tutti'}
            </label>
          </div>
          <div style="max-height:280px;overflow:auto;">
            <table class="data-table" style="font-size:12px;">
              <thead>
                <tr>
                  <th style="width:40px;text-align:center;">${isEn ? 'Apply' : 'Applica'}</th>
                  <th>${isEn ? 'Teacher' : 'Docente'}</th>
                  <th style="width:110px;">CDC</th>
                  <th style="width:230px;">${isEn ? 'Contract Type' : 'Tipologia Cattedra'}</th>
                  <th style="width:120px;text-align:center;">${isEn ? 'Hours' : 'Ore'}</th>
                  <th style="width:120px;text-align:center;">${isEn ? 'Days per week' : 'Giorni Orario'}</th>
                </tr>
              </thead>
              <tbody>
                ${toUpdate.map((u, idx) => {
                  return `
                    <tr>
                      <td style="text-align:center;">
                        <input type="checkbox" class="cattedre-upd-chk" data-idx="${idx}" checked onchange="updateCattedreApplyButtonCount()">
                      </td>
                      <td style="font-weight:700;color:var(--text-main);">
                        ${escapeHtml(u.name)}
                        ${u.file_name && u.file_name.toLowerCase() !== u.name.toLowerCase() ? `<span style="font-size:10px;color:var(--text-muted);display:block;font-weight:normal;">(${escapeHtml(u.file_name)})</span>` : ''}
                      </td>
                      <td style="font-size:11px;color:var(--text-muted);">
                        ${escapeHtml(u.new_cdc || u.cur_cdc || '-')}
                        ${u.cdc_diff ? `<span style="color:#059669;font-weight:bold;margin-left:2px;">*</span>` : ''}
                      </td>
                      <td>
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                          ${formatCtypeBadge(u.cur_ctype)}
                          <span style="font-weight:bold;color:${u.type_diff ? '#059669' : 'var(--text-muted)'};">➔</span>
                          <span style="${u.type_diff ? 'box-shadow:0 0 0 2px #10b981;border-radius:6px;' : ''}">${formatCtypeBadge(u.new_ctype)}</span>
                        </div>
                      </td>
                      <td style="text-align:center;">
                        <span style="color:var(--text-muted);">${u.cur_hours}h</span>
                        <span style="font-weight:bold;color:${u.hours_diff ? '#059669' : 'var(--text-muted)'};"> ➔ </span>
                        <b style="color:${u.hours_diff ? '#059669' : 'var(--text-main)'};">${u.new_hours}h</b>
                      </td>
                      <td style="text-align:center;">
                        <span style="color:var(--text-muted);">${u.cur_days ? u.cur_days + ' gg' : '-'}</span>
                        <span style="font-weight:bold;color:${u.days_diff ? '#059669' : 'var(--text-muted)'};"> ➔ </span>
                        <b style="color:${u.days_diff ? '#059669' : 'var(--text-main)'};">${u.new_days ? u.new_days + ' gg' : '-'}</b>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-md);padding:14px;text-align:center;color:#166534;margin-bottom:14px;font-weight:600;">
          ✅ ${isEn ? 'All faculty members in the file are already perfectly aligned with the database!' : 'Tutti i docenti nel file risultano già perfettamente allineati con il database! Nessuna modifica necessaria.'}
        </div>
      `}

      <!-- Docenti Invariati (Sezione collassabile) -->
      ${unchanged.length > 0 ? `
        <details style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:12px;">
          <summary style="font-size:12.5px;font-weight:700;color:var(--text-muted);cursor:pointer;">
            ✓ ${isEn ? `Show ${unchanged.length} already aligned teachers` : `Mostra i ${unchanged.length} docenti già allineati`}
          </summary>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
            ${unchanged.map(u => `
              <span style="background:var(--bg-main);border:1px solid var(--border);padding:3px 8px;border-radius:6px;font-size:11px;color:var(--text-main);">
                <b>${escapeHtml(u.name)}</b> (${u.cur_hours}h, ${escapeHtml((u.cur_ctype || 'intera').toUpperCase())}${u.cur_days ? ', ' + u.cur_days + 'gg' : ''})
              </span>
            `).join('')}
          </div>
        </details>
      ` : ''}

      <!-- Docenti non trovati -->
      ${notFound.length > 0 ? `
        <details style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius-md);padding:10px 14px;margin-bottom:12px;">
          <summary style="font-size:12.5px;font-weight:700;color:#92400e;cursor:pointer;">
            ⚠️ ${isEn ? `${notFound.length} teachers in file not found in database` : `${notFound.length} nominativi presenti nel file ma non trovati nel database`}
          </summary>
          <div style="margin-top:8px;font-size:11.5px;color:#78350f;">
            ${isEn ? 'These names are present in your file but do not exist in the faculty list (check spelling or add them from Faculty roster):' : 'Questi docenti compaiono nel foglio ma non esistono nell\'elenco docenti della scuola (verifica l\'ortografia o aggiungili da Organico):'}
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
              ${notFound.map(n => `<span style="background:#fff;border:1px solid #fcd34d;padding:2px 8px;border-radius:6px;font-weight:600;">${escapeHtml(n.name)}</span>`).join('')}
            </div>
          </div>
        </details>
      ` : ''}
    </div>
  `;

  const footer = document.getElementById('cattedreModalFooter');
  if (footer) footer.style.display = 'flex';
  updateCattedreApplyButtonCount();
}

async function applyCattedreAlignment() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (!cattedreAnalysisData || !cattedreAnalysisData.to_update) return;

  const checkboxes = document.querySelectorAll('.cattedre-upd-chk:checked');
  const selectedUpdates = [];
  checkboxes.forEach(cb => {
    const idx = parseInt(cb.dataset.idx, 10);
    if (!isNaN(idx) && cattedreAnalysisData.to_update[idx]) {
      selectedUpdates.push(cattedreAnalysisData.to_update[idx]);
    }
  });

  if (selectedUpdates.length === 0) {
    alert(isEn ? 'No teacher selected for alignment.' : 'Nessun docente selezionato per l\'allineamento.');
    return;
  }

  const createSnap = document.getElementById('chkCattedreSnapshot')?.checked ?? true;
  const updateCdc = document.getElementById('chkCattedreUpdateCdc')?.checked ?? false;
  const btn = document.getElementById('btnApplyCattedre');
  if (btn) {
    btn.disabled = true;
    btn.innerText = isEn ? 'Saving...' : 'Salvataggio in corso...';
  }

  try {
    const res = await fetch('/api/teachers/align_cattedre/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: selectedUpdates,
        create_snapshot: createSnap,
        update_cdc: updateCdc
      })
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_e) {
      data = { error: `HTTP ${res.status}: ${res.statusText || 'Risposta del server non valida'}` };
    }
    if (!res.ok || !data.success) {
      const errMsg = data.error || data.message || data.detail || (Array.isArray(data.errors) ? data.errors.map(e => e.message || e).join(', ') : null) || (isEn ? 'Error applying changes' : 'Errore durante il salvataggio');
      throw new Error(errMsg);
    }

    closeModal();
    showToast(isEn ? `Aligned contract types and hours for ${data.applied_count} teachers!` : `Allineamento completato con successo per ${data.applied_count} docenti!`, 'ok');
    await renderTeachers();
  } catch (err) {
    alert((isEn ? 'Error: ' : 'Errore: ') + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================================
// 5. GESTIONE CLASSI & GRUPPI ARTICOLATI (DISTINZIONE DA AULE)
// ============================================================================
let activeClassSubView = 'classes'; // 'classes' | 'groups'
let activeClassBuildingFilter = 'all'; // 'all' | 'centrale' | 'succursale'

function filterClassesByBuilding(bld) {
  activeClassBuildingFilter = bld;
  document.querySelectorAll('.class-bld-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bld === bld);
  });
  applyClassFilters();
}

function applyClassFilters() {
  const input = document.getElementById('classSearchInput');
  const q = input ? input.value.toLowerCase().trim() : '';
  const rows = document.querySelectorAll('#classTable tbody tr.class-row');
  rows.forEach(tr => {
    const bld = tr.getAttribute('data-building') || 'centrale';
    const matchBld = (activeClassBuildingFilter === 'all' || bld === activeClassBuildingFilter);
    const text = tr.innerText.toLowerCase();
    const matchSearch = (!q || text.includes(q));
    tr.style.display = (matchBld && matchSearch) ? '' : 'none';
  });
}

async function updateSectionPercorso(section, percorso) {
  try {
    const res = await fetch('/api/sections/percorsi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: section, percorso: percorso })
    });
    if (res.ok) {
      showToast(`Sezione ${section} impostata su ${percorso.toUpperCase()}!`, 'success');
      if (currentView === 'classes') renderClasses();
      else if (currentView === 'block_rules') renderBlockRulesView();
    } else {
      alert('Errore salvataggio indirizzo per la sezione ' + section);
    }
  } catch (e) {
    alert('Errore di connessione: ' + e.message);
  }
}

async function renderClasses() {
  let [resClasses, resGroups, sectionsData] = await Promise.all([
    fetch('/api/classes').then(r => r.json()).catch(() => []),
    fetch('/api/groups').then(r => r.json()).catch(() => []),
    fetch('/api/sections/percorsi').then(r => r.json()).catch(() => ({ section_percorsi: {}, sections: [] }))
  ]);
  if (!Array.isArray(resClasses)) resClasses = [];
  if (!Array.isArray(resGroups)) resGroups = [];

  // Ordinamento rigorosamente naturale per anno di corso e sezione (1A, 1B ... 5L)
  resClasses.sort((a, b) => naturalClassCompare(a.name, b.name));
  resGroups.sort((a, b) => naturalClassCompare(a.class_name, b.class_name) || (a.name || '').localeCompare(b.name || ''));

  stateData.classes = resClasses;
  stateData.groups = resGroups;

  const groupsByClass = {};
  resGroups.forEach(g => {
    if (!groupsByClass[g.class_name]) groupsByClass[g.class_name] = [];
    groupsByClass[g.class_name].push(g);
  });

  const isClassesView = activeClassSubView === 'classes';
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const container = document.getElementById('mainContent');

  const centraleClasses = resClasses.filter(c => !(c.building || '').toLowerCase().includes('succ'));
  const succursaleClasses = resClasses.filter(c => (c.building || '').toLowerCase().includes('succ'));

  container.innerHTML = `
    ${getNavReturnBarHtml(isEn ? 'Management of classes, sections, and students per class.' : 'Gestione classi, sezioni e studenti per classe.')}
    <div class="info-banner-blue">
      ${isEn
        ? '🎓 <b>Didactic Architecture - Classes & Students:</b> <b>Classes</b> represent cohorts of students for the academic year (e.g. <b>2L</b> with <b>26 students</b>). Each class has a resident <b>Homeroom</b> (e.g. <i>Room 53 - Main Campus</i>) for regular lessons. For subjects like <i>Physical Education</i> or <i>Computer Science</i>, the class relocates to the <b>Gym</b> or <b>Lab</b>; if these are located in another campus, the FET engine automatically schedules the <b>campus transfer</b> and travel allowances.'
        : '🎓 <b>Architettura Didattica - Classi & Studenti:</b> Le <b>Classi</b> rappresentano i gruppi di studenti dell\'anno scolastico (es. <b>2L</b> con <b>26 alunni</b>). Ogni classe ha un\'<b>Aula Base</b> (es. <i>Aula 53 - Sede Centrale</i>) in cui risiede per le lezioni ordinarie. Per materie come <i>Scienze Motorie</i> o <i>Informatica</i>, la classe si sposta in <b>Palestra</b> o in <b>Laboratorio</b>; se questi si trovano in un altro plesso, il motore FET pianifica il <b>cambio di plesso</b> e i tempi di trasferimento.'}
    </div>

    <!-- SELETTORE INDIRIZZO PER SEZIONE (LICEO / TECNICO / PROFESSIONALE) -->
    <div class="card" style="margin-bottom:16px;padding:14px 18px;border-left:4px solid var(--primary);box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:8px;">
            ${isEn ? '🏷️ Study Track by Section (High School / Technical / Vocational)' : '🏷️ Indirizzo di Studio per Sezione (Liceo / Tecnico / Professionale)'}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px;max-width:850px;line-height:1.4;">
            ${isEn
              ? 'The study track is determined <b>strictly by section</b> (A, B, C, D, E, F, G, H, L) for all classes 1-5. The system automatically detects whether the class is in <b>Lower</b> (1-2) or <b>Upper</b> (3-5) years and applies the default timetable block formula (exceptions are set at individual assignment level).'
              : 'L\'indirizzo di studio è determinato <b>esclusivamente in base alla sezione</b> (A, B, C, D, E, F, G, H, L) per tutte le classi da 1 a 5. Il sistema rileva automaticamente se la classe appartiene al <b>Biennio</b> (1-2) o al <b>Triennio</b> (3-5) e applica la suddivisione blocchi orari di default (le eventuali eccezioni vengono specificate a livello di singola cattedra).'}
          </div>
        </div>
        <button class="btn btn-sm btn-sec" onclick="navigate('block_rules')" title="${isEn ? 'Configure or view complete default rules table' : 'Configura o visualizza la tabella completa delle regole di default'}">
          ${isEn ? '📐 Block & Section Rules' : '📐 Regole Blocchi & Sezioni'}
        </button>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">
        ${(sectionsData.sections || []).map(s => {
          const p = s.percorso || 'tecnico';
          return `
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:5px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
                <b style="font-size:13px;color:var(--text-main);">${isEn ? 'Section' : 'Sezione'} ${s.section}</b>
                <span style="font-size:11px;color:var(--text-muted);" title="${(s.classes || []).join(', ')}">${s.classes_count} ${isEn ? 'classes' : 'classi'}</span>
              </div>
              <div class="percorso-btn-group">
                <button type="button" class="percorso-btn ${p === 'liceo' ? 'active liceo' : ''}" onclick="updateSectionPercorso('${s.section}', 'liceo')" title="${isEn ? 'Set Section ' + s.section + ' as High School' : 'Imposta Sezione ' + s.section + ' come Liceo'}">
                  ${isEn ? '🎓 High School' : '🎓 Liceo'}
                </button>
                <button type="button" class="percorso-btn ${p === 'tecnico' ? 'active tecnico' : ''}" onclick="updateSectionPercorso('${s.section}', 'tecnico')" title="${isEn ? 'Set Section ' + s.section + ' as Technical' : 'Imposta Sezione ' + s.section + ' come Tecnico'}">
                  ${isEn ? '⚙️ Technical' : '⚙️ Tecnico'}
                </button>
                <button type="button" class="percorso-btn ${p === 'professionale' ? 'active professionale' : ''}" onclick="updateSectionPercorso('${s.section}', 'professionale')" title="${isEn ? 'Set Section ' + s.section + ' as Vocational' : 'Imposta Sezione ' + s.section + ' come Professionale'}">
                  ${isEn ? '🏥 Vocat.' : '🏥 Prof.'}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
      <div class="segmented-control">
        <button class="segmented-btn ${isClassesView ? 'active' : ''}" onclick="switchClassSubView('classes')">
          🎓 ${isEn ? 'Regular Classes' : 'Classi Ordinarie'} (${resClasses.length})
        </button>
        <button class="segmented-btn ${!isClassesView ? 'active' : ''}" onclick="switchClassSubView('groups')">
          👥 ${isEn ? 'Groups & Subdivisions' : 'Gruppi & Articolazioni'} (${resGroups.length}) ${isEn ? '(Excel Groups Tab)' : '(Tab Gruppi Excel)'}
        </button>
      </div>

      ${isClassesView ? `
        <div class="segmented-control" style="background:var(--bg-card);border:1px solid var(--border);">
          <button class="segmented-btn class-bld-btn ${activeClassBuildingFilter === 'all' ? 'active' : ''}" data-bld="all" onclick="filterClassesByBuilding('all')">
            ${isEn ? 'All' : 'Tutte'} (${resClasses.length})
          </button>
          <button class="segmented-btn class-bld-btn ${activeClassBuildingFilter === 'centrale' ? 'active' : ''}" data-bld="centrale" onclick="filterClassesByBuilding('centrale')" title="${isEn ? 'Show only Main Campus classes' : 'Mostra solo le classi della Sede Centrale'}">
            🏛️ ${isEn ? 'Main Campus' : 'Sede Centrale'} (${centraleClasses.length})
          </button>
          <button class="segmented-btn class-bld-btn ${activeClassBuildingFilter === 'succursale' ? 'active' : ''}" data-bld="succursale" onclick="filterClassesByBuilding('succursale')" title="${isEn ? 'Show only Branch Campus classes' : 'Mostra solo le classi della Sede Succursale'}">
            🏛️ ${isEn ? 'Branch Campus' : 'Sede Succursale'} (${succursaleClasses.length})
          </button>
        </div>
      ` : ''}

      <input type="text" id="${isClassesView ? 'classSearchInput' : 'groupSearchInput'}" class="search-input" placeholder="${isEn ? (isClassesView ? '🔍 Search class, room or campus...' : '🔍 Search group or class...') : (isClassesView ? '🔍 Cerca classe, aula o sede...' : '🔍 Cerca gruppo o classe...')}" oninput="${isClassesView ? 'applyClassFilters()' : 'filterTable(\'groupTable\', this.value)'}" style="min-width:180px;">

      ${isClassesView ? `
        <div style="display:flex;gap:8px;margin-left:auto;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="openImportStudentsModal()" title="${isEn ? 'Import or sync student count per class from Excel' : 'Importa o sincronizza il numero di alunni per classe dal foglio Excel / Parametri Orario'}" style="font-weight:600;display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--primary);color:var(--primary);background:var(--bg-main);white-space:nowrap;padding:7px 12px;">
            <span>📥</span> ${isEn ? 'Import Students (Excel)' : 'Importa Alunni (Excel)'}
          </button>
          <input type="text" id="newClassName" class="search-input" placeholder="${isEn ? 'New class (e.g. 4A)' : 'Nuova classe (es. 4A)'}" style="width:140px;">
          <input type="number" id="newClassStudents" class="search-input" placeholder="${isEn ? 'Students' : 'Alunni'}" value="25" style="width:75px;">
          <select id="newClassBuilding" class="search-input" style="width:125px;">
            <option value="Centrale">${isEn ? 'Main Campus' : 'Sede Centrale'}</option>
            <option value="Succursale">${isEn ? 'Branch Campus' : 'Sede Succursale'}</option>
          </select>
          <button class="btn btn-primary" onclick="addClass()">+ ${isEn ? 'Add Class' : 'Aggiungi Classe'}</button>
        </div>
      ` : `
        <div style="display:flex;gap:8px;margin-left:auto;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="openImportStudentsModal()" title="${isEn ? 'Import or sync student count per class and group from Excel' : 'Importa o sincronizza il numero di alunni per classe e gruppo dal foglio Excel / Parametri Orario'}" style="font-weight:600;display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--primary);color:var(--primary);background:var(--bg-main);white-space:nowrap;padding:7px 12px;">
            <span>📥</span> ${isEn ? 'Import Students (Excel)' : 'Importa Alunni (Excel)'}
          </button>
          <button class="btn btn-primary" onclick="openAddGroupModal()">+ ${isEn ? 'Add Subgroup' : 'Aggiungi Gruppo Articolato'}</button>
        </div>
      `}
    </div>

    ${isClassesView ? `
      <div class="table-container">
        <table class="data-table" id="classTable">
          <thead>
            <tr>
              <th style="width:45px;">#</th>
              <th style="width:140px;">${isEn ? 'Class & Track' : 'Classe & Indirizzo'}</th>
              <th style="width:95px;text-align:center;">${isEn ? 'Students' : 'N. Alunni'}</th>
              <th style="min-width:180px;">${isEn ? 'Campus & Homeroom' : 'Sede & Aula Base Residente'}</th>
              <th>${isEn ? 'Subgroups (Languages, Ethics/Alt, Subgroups)' : 'Gruppi Articolati (Lingue, Religione/Alt, Sottogruppi)'}</th>
              <th style="width:85px;text-align:center;">${isEn ? 'Hrs/Wk' : 'Ore/Sett.'}</th>
              <th style="text-align:right;min-width:270px;">${isEn ? 'Quick Actions' : 'Azioni Rapide'}</th>
            </tr>
          </thead>
          <tbody>
            ${resClasses.map((c, idx) => {
              const m = c.name.match(/^(\d+)([A-Za-z]+)/);
              const secLetter = m ? m[2].toUpperCase()[0] : '';
              const percorso = (sectionsData.section_percorsi || {})[secLetter] || 'tecnico';
              const yearNum = m ? parseInt(m[1], 10) : 1;
              const period = isEn ? (yearNum <= 2 ? 'Lower' : 'Upper') : (yearNum <= 2 ? 'Biennio' : 'Triennio');
              const percDisplay = isEn ? (percorso === 'liceo' ? 'HIGH SCHOOL' : (percorso === 'tecnico' ? 'TECHNICAL' : 'VOCATIONAL')) : percorso.toUpperCase();
              const cGroups = groupsByClass[c.name] || [];
              const isSucc = (c.building || '').toLowerCase().includes('succ');
              return `
                <tr class="class-row" data-building="${isSucc ? 'succursale' : 'centrale'}">
                  <td style="color:var(--text-sub);">${idx + 1}</td>
                  <td>
                    <b style="font-size:14.5px;color:var(--primary);">🎓 ${escapeHtml(c.name)}</b>
                    <span class="badge ${percorso === 'liceo' ? 'badge-liceo' : (percorso === 'tecnico' ? 'badge-tecnico' : 'badge-professionale')}" style="font-size:10px;margin-left:4px;" title="${isEn ? 'Track determined by Section ' + secLetter + ' (' + period + ')' : 'Indirizzo determinato dalla Sezione ' + secLetter + ' (' + period + ')'}">
                      ${percDisplay} (${period})
                    </span>
                  </td>
                  <td style="text-align:center;">
                    <span style="font-size:13px;font-weight:700;color:var(--text-main);">${c.students || 0}</span>
                    <button class="btn-sm btn-sec" style="padding:1px 5px;font-size:10px;margin-left:3px;" onclick="quickEditClassStudents('${escapeJs(c.name)}', ${c.students || 25})" title="${isEn ? 'Edit student count' : 'Modifica numero alunni'}">✏️</button>
                  </td>
                  <td>
                    <span class="badge ${isSucc ? 'badge-warn' : 'badge-info'}" style="margin-right:6px;">
                      🏛️ ${escapeHtml(c.building ? (isEn && c.building === 'Centrale' ? 'Main' : (isEn && c.building.includes('Succ') ? 'Branch' : c.building)) : (isEn ? 'Main' : 'Centrale'))}
                    </span>
                    <span class="item-chip" title="${isEn ? 'Resident Homeroom of this class' : 'Aula Ordinaria di questa classe'}">
                      🚪 ${escapeHtml(c.base_room || ((isEn ? 'Room ' : 'Aula ') + c.name))}
                    </span>
                  </td>
                  <td>
                    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;">
                      ${cGroups.length > 0 ? cGroups.map(g => `
                        <span class="group-badge">
                          👥 <b>${escapeHtml(g.name)}</b> ${g.students ? `(${g.students} ${isEn ? 'st.' : 'al.'})` : ''}
                          <span class="del-btn" onclick="deleteGroup('${escapeJs(g.name)}')" title="${isEn ? 'Delete subgroup' : 'Elimina gruppo articolato'}">×</span>
                        </span>
                      `).join('') : `<span style="color:var(--text-muted);font-size:12px;margin-right:6px;">${isEn ? 'No groups' : 'Nessun gruppo'}</span>`}
                      <button class="btn-add-group" onclick="openAddGroupModal('${escapeJs(c.name)}')" title="${isEn ? 'Create subgroup for ' + escapeJs(c.name) : 'Crea un gruppo articolato per ' + escapeJs(c.name)}">
                        + ${isEn ? 'Group' : 'Gruppo'}
                      </button>
                    </div>
                  </td>
                  <td style="text-align:center;">
                    <span class="badge badge-info">${c.total_hours || 0} h</span>
                  </td>
                  <td style="text-align:right;white-space:nowrap;">
                    <button class="btn btn-sm btn-primary" onclick="openNewCattedraModal({ className: '${escapeJs(c.name)}' })" title="${isEn ? 'Assign new teaching assignment to ' + escapeJs(c.name) : 'Assegna nuova cattedra a ' + escapeJs(c.name)}">
                      ➕ ${isEn ? 'Assignment' : 'Cattedra'}
                    </button>
                    <button class="btn btn-sm btn-sec" onclick="jumpToActivities({ className: '${escapeJs(c.name)}' })" title="${isEn ? 'View assignments for class ' + escapeJs(c.name) : 'Vedi cattedre della classe ' + escapeJs(c.name)}">
                      📚 ${isEn ? 'Assignments' : 'Cattedre'}
                    </button>
                    <button class="btn btn-sm btn-sec" onclick="openEditClassModal('${escapeJs(c.name)}')" title="${isEn ? 'Edit students, homeroom and campus' : 'Modifica alunni, aula base e sede'}">✏️ ${isEn ? 'Campus/Room' : 'Sede'}</button>
                    <button class="btn btn-sm btn-sec" onclick="openClassAvailability('${escapeJs(c.name)}')">📅</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteClass('${escapeJs(c.name)}')">🗑️</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : `
      <div class="table-container">
        <table class="data-table" id="groupTable">
          <thead>
            <tr>
              <th style="width:45px;">#</th>
              <th style="width:130px;">${isEn ? 'Parent Class' : 'Classe Padre'}</th>
              <th style="min-width:180px;">${isEn ? 'Group / Division Name' : 'Nome Gruppo / Articolazione'}</th>
              <th style="width:110px;text-align:center;">${isEn ? 'Students' : 'N. Alunni'}</th>
              <th style="width:110px;text-align:center;">${isEn ? 'Assigned Hours' : 'Ore Assegnate'}</th>
              <th>${isEn ? 'Notes & Type' : 'Note & Tipologia'}</th>
              <th style="text-align:right;min-width:260px;">${isEn ? 'Quick Actions' : 'Azioni Rapide'}</th>
            </tr>
          </thead>
          <tbody>
            ${resGroups.map((g, idx) => `
              <tr>
                <td style="color:var(--text-sub);">${idx + 1}</td>
                <td>
                  <span class="item-chip primary" style="font-weight:700;">🎓 ${escapeHtml(g.class_name)}</span>
                </td>
                <td>
                  <b style="color:var(--text-main);font-size:13.5px;">👥 ${escapeHtml(g.name)}</b>
                </td>
                <td style="text-align:center;">
                  <span style="font-size:13px;font-weight:700;">${g.students || 0}</span>
                  <button class="btn-sm btn-sec" style="padding:1px 5px;font-size:10px;margin-left:3px;" onclick="quickEditGroupStudents('${escapeJs(g.name)}', ${g.students || 0})" title="${isEn ? 'Edit student count in group' : 'Modifica numero alunni nel gruppo'}">✏️</button>
                </td>
                <td style="text-align:center;">
                  <span class="badge ${g.total_hours > 0 ? 'badge-info' : ''}" style="font-weight:700;">${g.total_hours || 0} h</span>
                </td>
                <td style="color:var(--text-muted);font-size:12px;">
                  ${escapeHtml(g.comments || (isEn ? 'Subgroup / division' : 'Gruppo articolato / sottogruppo'))}
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-sec" onclick="openEditGroupModal('${escapeJs(g.name)}')" title="${isEn ? 'Edit group' : 'Modifica gruppo'}">✏️ ${isEn ? 'Edit' : 'Modifica'}</button>
                  <button class="btn btn-sm btn-primary" onclick="openNewCattedraModal({ className: '${escapeJs(g.name)}' })" title="${isEn ? 'Assign new assignment to this group' : 'Assegna nuova cattedra a questo gruppo'}">➕ ${isEn ? 'Assignment' : 'Cattedra'}</button>
                  <button class="btn btn-sm btn-sec" onclick="jumpToActivities({ className: '${escapeJs(g.name)}' })" title="${isEn ? 'View group assignments' : 'Vedi cattedre del gruppo'}">📚 ${isEn ? 'Assignments' : 'Cattedre'}</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteGroup('${escapeJs(g.name)}')" title="${isEn ? 'Delete group' : 'Elimina gruppo'}">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  if (isClassesView) {
    applyClassFilters();
  }
}

function switchClassSubView(view) {
  activeClassSubView = view;
  renderClasses();
}

async function addClass() {
  const name = document.getElementById('newClassName').value.trim();
  const stud = document.getElementById('newClassStudents').value.trim();
  const bld = document.getElementById('newClassBuilding').value.trim();
  if (!name) return;
  const res = await fetch('/api/classes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, students: parseInt(stud) || 25, building: bld, base_room: `Aula ${name}` })
  });
  if (res.ok) {
    document.getElementById('newClassName').value = '';
    showToast(`Classe "${name}" creata con ${stud} alunni!`);
    renderClasses();
  } else {
    alert('Classe già presente o errore nei dati.');
  }
}

async function quickEditClassStudents(className, currentStudents) {
  const newVal = prompt(`Inserisci il numero aggiornato di alunni per la classe ${className}:`, currentStudents);
  if (newVal === null) return;
  const num = parseInt(newVal);
  if (isNaN(num) || num <= 0) {
    alert('Numero di alunni non valido.');
    return;
  }
  const res = await fetch('/api/classes/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: className, students: num })
  });
  if (res.ok) {
    showToast(`Classe ${className}: numero alunni impostato a ${num}!`);
    renderClasses();
  }
}

function openEditClassModal(className) {
  const cls = (stateData.classes || []).find(c => c.name === className);
  if (!cls) return;

  const roomsList = stateData.rooms || [];
  const bldOptions = (stateData.buildings || ['Centrale', 'Succursale']).map(b => `
    <option value="${escapeHtml(b)}" ${cls.building === b ? 'selected' : ''}>${escapeHtml(b)}</option>
  `).join('');

  const roomOptions = `<option value="">-- Seleziona Aula Base --</option>` +
    roomsList.map(r => `
      <option value="${escapeHtml(r.name)}" ${(cls.base_room === r.name || cls.base_room === ('Aula ' + cls.name)) ? 'selected' : ''}>
        ${escapeHtml(r.name)} (${escapeHtml(r.building || 'Centrale')}, capienza: ${r.capacity || 30} al.)
      </option>
    `).join('');

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">✏️ Modifica Dettagli Classe ${escapeHtml(className)}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Nome Classe</label>
          <input type="text" class="form-input" value="${escapeHtml(cls.name)}" disabled>
        </div>
        <div class="form-group">
          <label class="form-label">Numero Alunni (Studenti nella classe)</label>
          <input type="number" id="editClassStudents" class="form-input" value="${cls.students || 25}" min="1" max="50">
        </div>
        <div class="form-group">
          <label class="form-label">Plesso / Sede di Riferimento</label>
          <select id="editClassBuilding" class="form-select">
            ${bldOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Aula Base Ordinaria</label>
          <select id="editClassBaseRoom" class="form-select">
            ${roomOptions}
          </select>
          <span class="form-hint">L'aula in cui la classe svolge tutte le normali lezioni frontali non laboratoriali.</span>
        </div>
        <div class="form-group">
          <label class="form-label">Note</label>
          <input type="text" id="editClassComments" class="form-input" value="${escapeHtml(cls.comments || '')}" placeholder="Note o particolarità...">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="saveClassDetails('${escapeJs(className)}')">💾 Salva Modifiche</button>
      </div>
    </div>
  `);
}

async function saveClassDetails(className) {
  const students = parseInt(document.getElementById('editClassStudents').value) || 25;
  const building = document.getElementById('editClassBuilding').value;
  const base_room = document.getElementById('editClassBaseRoom').value;
  const comments = document.getElementById('editClassComments').value;

  const res = await fetch('/api/classes/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: className, students, building, base_room, comments })
  });
  if (res.ok) {
    closeModal();
    showToast(`Dettagli della classe ${className} salvati!`);
    renderClasses();
  }
}

async function deleteClass(name) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (confirm(isEn ? `Delete class "${name}" and all its groups?` : `Eliminare la classe "${name}" e tutti i suoi gruppi?`)) {
    await fetch(`/api/classes/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(isEn ? `Class "${name}" deleted.` : `Classe "${name}" eliminata.`, 'warn');
    renderClasses();
  }
}

function openAddGroupModal(className = '') {
  const classList = (stateData.classes || []).map(c => c.name);
  const defaultClass = className || (classList[0] || '1A');

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">👥 Nuovo Gruppo Articolato</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 12px 0;">
          I <b>gruppi articolati</b> consentono a FET di assegnare attività e docenti a una parte degli studenti della classe (es. Lingue straniere SPA/FRA, Religione/Materia Alternativa, o laboratori divisi).
        </p>
        <div class="form-group">
          <label class="form-label">Classe Padre di Riferimento</label>
          <select id="modalGroupClass" class="form-select">
            ${classList.map(c => `<option value="${escapeHtml(c)}" ${c === defaultClass ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Nome Gruppo / Articolazione</label>
          <input type="text" id="modalGroupName" class="form-input" value="${escapeHtml(defaultClass)} " placeholder="Es. ${escapeHtml(defaultClass)} SPA, ${escapeHtml(defaultClass)} FRA, ${escapeHtml(defaultClass)} REL">
        </div>
        <div class="form-group">
          <label class="form-label">Numero Alunni nel Gruppo (stimato)</label>
          <input type="number" id="modalGroupStudents" class="form-input" value="12" min="1" max="50">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="saveNewGroup()">💾 Aggiungi Gruppo</button>
      </div>
    </div>
  `);
  setTimeout(() => {
    const clsSel = document.getElementById('modalGroupClass');
    const inp = document.getElementById('modalGroupName');
    if (clsSel && inp) {
      clsSel.onchange = () => {
        inp.value = clsSel.value + ' ';
        inp.focus();
      };
    }
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  }, 50);
}

async function saveNewGroup() {
  const cls = document.getElementById('modalGroupClass').value.trim();
  const name = document.getElementById('modalGroupName').value.trim();
  const stud = document.getElementById('modalGroupStudents').value.trim();
  if (!name) {
    alert('Inserisci il nome del gruppo.');
    return;
  }
  const res = await fetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ class_name: cls, name: name, students: parseInt(stud) || 0 })
  });
  if (res.ok) {
    closeModal();
    showToast(`Gruppo "${name}" aggiunto a ${cls}!`);
    renderClasses();
  } else {
    alert('Errore o gruppo già esistente.');
  }
}

function openEditGroupModal(groupName) {
  const g = (stateData.groups || []).find(grp => grp.name === groupName) || { name: groupName };
  const classList = (stateData.classes || []).map(c => c.name);

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">👥 Modifica Gruppo Articolato: ${escapeHtml(groupName)}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Classe Padre di Riferimento</label>
          <select id="editGroupClass" class="form-select">
            ${classList.map(c => `<option value="${escapeHtml(c)}" ${c === g.class_name ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Nome Gruppo / Articolazione</label>
          <input type="text" id="editGroupName" class="form-input" value="${escapeHtml(g.name)}">
        </div>
        <div class="form-group">
          <label class="form-label">Numero Alunni nel Gruppo</label>
          <input type="number" id="editGroupStudents" class="form-input" value="${g.students || 0}" min="1" max="50">
        </div>
        <div class="form-group">
          <label class="form-label">Note</label>
          <input type="text" id="editGroupComments" class="form-input" value="${escapeHtml(g.comments || '')}" placeholder="es. Lingua Spagnolo / Francese">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitEditGroup('${escapeJs(groupName)}')">💾 Salva Modifiche</button>
      </div>
    </div>
  `);
}

async function submitEditGroup(origName) {
  const parentClass = document.getElementById('editGroupClass').value.trim();
  const newName = document.getElementById('editGroupName').value.trim();
  const students = parseInt(document.getElementById('editGroupStudents').value, 10) || 0;
  const comments = document.getElementById('editGroupComments').value.trim();

  if (!newName) {
    alert('Inserisci il nome del gruppo.');
    return;
  }

  const res = await fetch('/api/groups/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orig_name: origName,
      name: newName,
      class_name: parentClass,
      students: students,
      comments: comments
    })
  });

  if (res.ok) {
    closeModal();
    showToast(`Gruppo "${newName}" aggiornato con successo!`);
    renderClasses();
  } else {
    alert('Errore durante l\'aggiornamento del gruppo.');
  }
}

async function quickEditGroupStudents(groupName, curStudents) {
  const newVal = prompt(`Inserisci il numero aggiornato di alunni per il gruppo "${groupName}":`, curStudents);
  if (newVal === null) return;
  const num = parseInt(newVal, 10);
  if (isNaN(num) || num < 0) {
    alert('Numero di alunni non valido.');
    return;
  }
  const res = await fetch('/api/groups/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orig_name: groupName, students: num })
  });
  if (res.ok) {
    showToast(`Gruppo "${groupName}": numero alunni impostato a ${num}!`);
    renderClasses();
  }
}

async function deleteGroup(groupName) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (confirm(isEn ? `Delete group "${groupName}"?` : `Eliminare il gruppo articolato "${groupName}"?`)) {
    await fetch(`/api/groups/${encodeURIComponent(groupName)}`, { method: 'DELETE' });
    showToast(isEn ? `Group "${groupName}" deleted.` : `Gruppo "${groupName}" eliminato.`, 'warn');
    renderClasses();
  }
}

// ============================================================================
// MODALE IMPORTAZIONE NUMERO ALUNNI (EXCEL / SEED / CSV)
// ============================================================================
function openImportStudentsModal() {
  const classes = stateData.classes || [];
  const groups = stateData.groups || [];
  const totalStudents = classes.reduce((acc, c) => acc + (c.students || 0), 0);
  const sampleClasses = classes.slice(0, 10).map(c => `${c.name}: ${c.students || 0}`).join(', ');

  showModal(`
    <div class="modal-dialog" style="max-width:780px;">
      <div class="modal-header">
        <div class="modal-title">📥 Importazione Numero Alunni per Classe (Excel / Foglio Orario)</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="info-banner-blue" style="margin-top:0;">
          🎓 <b>Numero di Alunni nelle Classi e nei Gruppi:</b><br>
          Il totale registrato nel progetto è di <b>${totalStudents} studenti</b> su <b>${classes.length} classi</b> e <b>${groups.length} gruppi articolati</b>.<br>
          <span style="font-size:12px;color:var(--text-sub);">Esempio attuale: ${escapeHtml(sampleClasses)}...</span>
        </div>

        <!-- Opzione 1: Sincronizzazione istantanea dal file Excel / Seed originale -->
        <div class="card" style="margin-bottom:14px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div style="flex:1;min-width:280px;">
              <b style="font-size:13.5px;color:var(--text-main);">⚡ 1. Sincronizza da Foglio Excel Ufficiale (Parametri Orario)</b>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;line-height:1.4;">
                Ripristina o sincronizza istantaneamente i dati ufficiali di tutte le <b>39 classi</b> e <b>10 gruppi</b> (811 studenti) direttamente dal foglio dell'istituto (<code>ParametriOrario.fet</code>).
              </div>
            </div>
            <button class="btn btn-primary" onclick="submitSyncFromExcelSeed()" style="white-space:nowrap;padding:9px 18px;font-weight:700;">
              🔄 Sincronizza Subito (811 al.)
            </button>
          </div>
        </div>

        <!-- Opzione 2: Incolla o Carica File CSV / Testo -->
        <div class="card" style="border:1px solid var(--border);margin-bottom:14px;">
          <b style="font-size:13.5px;color:var(--text-main);">📋 2. Incolla o Carica Elenco Alunni Personalizzato (Testo / CSV / Excel)</b>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;margin-bottom:10px;">
            Puoi incollare direttamente le colonne copiate da un foglio Excel, oppure caricare un file <code>.csv</code> o <code>.txt</code>. Formati supportati: <code>1A 25</code>, <code>1A;25</code>, <code>1A	25</code> o righe separate da virgola/tabulatore.
          </div>

          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
            <input type="file" id="importStudentsFileInput" accept=".csv,.txt,.tsv" style="display:none;" onchange="handleStudentsFileUpload(event)">
            <button type="button" class="btn btn-sm btn-sec" onclick="document.getElementById('importStudentsFileInput').click()">
              📂 Scegli File CSV / Testo...
            </button>
            <span id="importStudentsFileName" style="font-size:12px;color:var(--primary);font-weight:600;"></span>
          </div>

          <textarea id="importStudentsTextArea" class="form-textarea" rows="6" placeholder="1A 25&#10;2A 20&#10;3A 29&#10;4A 17&#10;5A 14&#10;2B 20&#10;1C 24&#10;..." style="font-family:var(--font-mono);font-size:12.5px;line-height:1.4;"></textarea>

          <div style="display:flex;justify-content:flex-end;margin-top:10px;">
            <button class="btn btn-sec" onclick="submitImportStudentsText()" style="padding:7px 18px;font-weight:700;">
              💾 Aggiorna Alunni da Testo
            </button>
          </div>
        </div>

        <!-- Prospetto Riepilogativo Classi Attuali -->
        <details style="border:1px solid var(--border);border-radius:var(--radius-sm);background:#f8fafc;padding:8px 12px;font-size:12.5px;">
          <summary style="font-weight:600;cursor:pointer;color:var(--text-sub);">
            📊 Visualizza prospetto attuale completo (${classes.length} classi, ${totalStudents} studenti)
          </summary>
          <div style="margin-top:8px;max-height:160px;overflow:auto;">
            <table class="data-table" style="font-size:12px;">
              <thead>
                <tr>
                  <th>Classe</th>
                  <th style="text-align:center;">Alunni</th>
                  <th>Sede & Aula</th>
                  <th style="text-align:center;">Ore</th>
                </tr>
              </thead>
              <tbody>
                ${classes.map(c => `
                  <tr>
                    <td><b>🎓 ${escapeHtml(c.name)}</b></td>
                    <td style="text-align:center;"><b>${c.students || 0}</b></td>
                    <td>${escapeHtml(c.building || 'Centrale')} - ${escapeHtml(c.base_room || ('Aula ' + c.name))}</td>
                    <td style="text-align:center;">${c.total_hours || 0}h</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.close">${_t('common.close', 'Chiudi')}</button>
      </div>
    </div>
  `);
}

async function submitSyncFromExcelSeed() {
  try {
    const res = await fetch('/api/classes/import_students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'from_seed' })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Sincronizzazione completata! ${data.updated_classes} classi e ${data.updated_groups || 0} gruppi aggiornati (${data.total_students} alunni tot.)`);
      closeModal();
      renderClasses();
    } else {
      alert("Errore durante la sincronizzazione: " + (data.error || 'Operazione fallita'));
    }
  } catch (err) {
    alert("Errore di connessione: " + err.message);
  }
}

async function submitImportStudentsText() {
  const ta = document.getElementById('importStudentsTextArea');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) {
    alert('Inserisci o incolla le classi con il numero di alunni (es. 1A 25).');
    return;
  }
  try {
    const res = await fetch('/api/classes/import_students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Aggiornate ${data.updated_count} classi/gruppi con successo! Totale: ${data.total_students} alunni.`);
      closeModal();
      renderClasses();
    } else {
      alert("Errore durante l'aggiornamento: " + (data.error || 'Formato non riconosciuto'));
    }
  } catch (err) {
    alert("Errore di connessione: " + err.message);
  }
}

function handleStudentsFileUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const disp = document.getElementById('importStudentsFileName');
  if (disp) disp.innerText = `File: ${file.name}`;
  const reader = new FileReader();
  reader.onload = (e) => {
    const ta = document.getElementById('importStudentsTextArea');
    if (ta) ta.value = e.target.result;
  };
  reader.readAsText(file);
}

// ============================================================================
// 6. GESTIONE MATERIE (CON SALTO DIRETTO AD ASSEGNAZIONE DOCENTE & CATTEDRE)
// ============================================================================
// 6. GESTIONE MATERIE (CON CARICO POMERIDIANO, ORE PREFERITE E CLASSI DI CONCORSO MULTIPLE)
// ============================================================================
function extractCdcTokens(cdcRaw) {
  if (!cdcRaw) return [];
  const rawText = Array.isArray(cdcRaw) ? cdcRaw.join(' ') : String(cdcRaw);
  // Pattern ufficiale per classi di concorso ministeriali (A050, A50, B023, B15, AB24, ADSS, ecc.)
  const cdcRegex = /\b((?:[AB][-_ ]?\d{2,3})|(?:[A-Za-z]{2}[-_ ]?\d{2})|(?:AD(?:SS|MM|EE|AA)))\b/gi;
  const matches = rawText.match(cdcRegex);
  if (matches && matches.length > 0) {
    const res = [];
    for (const m of matches) {
      let code = m.replace(/[-_ ]/g, '').toUpperCase();
      if (/^A\d{2}$/.test(code)) {
        code = 'A0' + code.slice(1);
      } else if (/^B\d{2}$/.test(code)) {
        code = 'B0' + code.slice(1);
      }
      if (!res.includes(code)) res.push(code);
    }
    return res;
  }
  // Fallback per sigle o codici personalizzati (es. IRC, REL, SOST), ignorando descrizioni lunghe con virgole
  const parts = rawText.split(/[,;/\n]+/).map(p => p.trim()).filter(Boolean);
  const res = [];
  for (const part of parts) {
    if (part.split(/\s+/).length > 2 || part.length > 12) continue;
    const clean = part.toUpperCase();
    if (!res.includes(clean)) res.push(clean);
  }
  return res;
}

function filterTeachersForSubject(subjectName, specificCdc = null) {
  const subj = (stateData.subjects || []).find(s => s.name === subjectName);
  const allTeachers = stateData.teachers || [];
  if (!subj && !specificCdc) {
    return { matching: allTeachers, others: [], cdcList: [] };
  }

  let cdcList = [];
  if (specificCdc) {
    cdcList = extractCdcTokens(specificCdc);
  }
  if (cdcList.length === 0 && subj && subj.cdc) {
    cdcList = extractCdcTokens(subj.cdc);
  }

  if (cdcList.length === 0) {
    return { matching: allTeachers, others: [], cdcList: [] };
  }

  const matching = [];
  const others = [];

  for (const t of allTeachers) {
    const tCdcs = extractCdcTokens(t.cdc || '');
    const isMatch = tCdcs.some(c => cdcList.includes(c)) ||
      cdcList.some(c => (t.cdc || '').toUpperCase().includes(c));
    if (isMatch) {
      matching.push(t);
    } else {
      others.push(t);
    }
  }

  return { matching, others, cdcList };
}

function buildTeacherSelectOptions(subjectName, currentSelectedTeacher = '', specificCdc = null, showAll = false, isCoTeacher = false) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const { matching, others, cdcList } = filterTeachersForSubject(subjectName, specificCdc);

  const defaultLabel = isCoTeacher
    ? (isEn ? '-- Select Co-Teacher --' : '-- Seleziona Docente per compresenza --')
    : (isEn ? '-- Select Primary Teacher --' : '-- Seleziona Docente Titolare --');

  let html = `<option value="">${defaultLabel}</option>`;

  if (cdcList.length > 0) {
    const cdcLabel = cdcList.join(', ');
    if (matching.length > 0) {
      html += `<optgroup label="${isEn ? 'Qualified Teachers on CDC (' + cdcLabel + ')' : 'Docenti Abilitati CDC (' + cdcLabel + ')'}">`;
      for (const t of matching) {
        const isSel = (t.name === currentSelectedTeacher);
        html += `<option value="${escapeHtml(t.name)}" ${isSel ? 'selected' : ''}>${escapeHtml(t.name)}${t.cdc ? ` (${escapeHtml(t.cdc)})` : ''}</option>`;
      }
      html += `</optgroup>`;
    } else {
      html += `<optgroup label="⚠️ ${isEn ? 'No teachers found with CDC ' + cdcLabel : 'Nessun docente registrato con CDC ' + cdcLabel}">`;
      html += `</optgroup>`;
    }

    const currentInOthers = others.find(t => t.name === currentSelectedTeacher);
    if (currentInOthers && !showAll) {
      html += `<optgroup label="${isEn ? 'Currently Assigned Teacher' : 'Docente Attualmente Assegnato'}">`;
      html += `<option value="${escapeHtml(currentInOthers.name)}" selected>${escapeHtml(currentInOthers.name)}${currentInOthers.cdc ? ` (${escapeHtml(currentInOthers.cdc)})` : ''} ⚠️ [${isEn ? 'Different CDC' : 'Fuori CDC'}]</option>`;
      html += `</optgroup>`;
    }

    if (showAll && others.length > 0) {
      html += `<optgroup label="${isEn ? 'Other Teachers in Faculty' : 'Altri Docenti dell\'Istituto'}">`;
      for (const t of others) {
        if (t.name === currentSelectedTeacher && currentInOthers) continue;
        const isSel = (t.name === currentSelectedTeacher);
        html += `<option value="${escapeHtml(t.name)}" ${isSel ? 'selected' : ''}>${escapeHtml(t.name)}${t.cdc ? ` (${escapeHtml(t.cdc)})` : ''}</option>`;
      }
      html += `</optgroup>`;
    } else if (others.length > 0) {
      html += `<option value="__SHOW_ALL__">🔍 ${isEn ? 'Show all other teachers in faculty (' + others.length + ')...' : 'Mostra tutti gli altri docenti dell\'istituto (' + others.length + ')...'}</option>`;
    }
  } else {
    for (const t of (stateData.teachers || [])) {
      const isSel = (t.name === currentSelectedTeacher);
      html += `<option value="${escapeHtml(t.name)}" ${isSel ? 'selected' : ''}>${escapeHtml(t.name)}${t.cdc ? ` (${escapeHtml(t.cdc)})` : ''}</option>`;
    }
  }

  return html;
}

function onModalSubjectChanged() {
  const subjSel = document.getElementById('modalSubject');
  const teachSel = document.getElementById('modalTeacher');
  const coTeachSel = document.getElementById('modalCoTeacherSelect');
  if (!subjSel || !teachSel) return;
  const subjName = subjSel.value;
  const currTeacher = teachSel.value;
  teachSel.innerHTML = buildTeacherSelectOptions(subjName, currTeacher);
  if (coTeachSel) {
    coTeachSel.innerHTML = buildTeacherSelectOptions('', '', null, true, true);
  }
}

function onModalTeacherChanged() {
  const subjSel = document.getElementById('modalSubject');
  const teachSel = document.getElementById('modalTeacher');
  if (!teachSel) return;
  if (teachSel.value === '__SHOW_ALL__') {
    const subjName = subjSel ? subjSel.value : '';
    teachSel.innerHTML = buildTeacherSelectOptions(subjName, '', null, true);
  }
}

function onModalCoTeacherChanged() {
  const subjSel = document.getElementById('modalSubject');
  const coTeachSel = document.getElementById('modalCoTeacherSelect');
  if (!coTeachSel) return;
  if (coTeachSel.value === '__SHOW_ALL__') {
    const subjName = subjSel ? subjSel.value : '';
    coTeachSel.innerHTML = buildTeacherSelectOptions(subjName, '', null, true, true);
  }
}

function onEditModalSubjectChanged() {
  const subjSel = document.getElementById('editModalSubject');
  const teachSel = document.getElementById('editModalTeacher');
  const coTeachSel = document.getElementById('editModalCoTeacherSelect');
  if (!subjSel || !teachSel) return;
  const subjName = subjSel.value;
  const currTeacher = teachSel.value;
  teachSel.innerHTML = buildTeacherSelectOptions(subjName, currTeacher);
  if (coTeachSel) {
    coTeachSel.innerHTML = buildTeacherSelectOptions('', '', null, true, true);
  }
}

function onEditModalTeacherChanged() {
  const subjSel = document.getElementById('editModalSubject');
  const teachSel = document.getElementById('editModalTeacher');
  if (!teachSel) return;
  if (teachSel.value === '__SHOW_ALL__') {
    const subjName = subjSel ? subjSel.value : '';
    teachSel.innerHTML = buildTeacherSelectOptions(subjName, '', null, true);
  }
}

function onEditModalCoTeacherChanged() {
  const subjSel = document.getElementById('editModalSubject');
  const coTeachSel = document.getElementById('editModalCoTeacherSelect');
  if (!coTeachSel) return;
  if (coTeachSel.value === '__SHOW_ALL__') {
    const subjName = subjSel ? subjSel.value : '';
    coTeachSel.innerHTML = buildTeacherSelectOptions(subjName, '', null, true, true);
  }
}

function formatSubjectCdcPills(cdcRaw, subjectName, isEn) {
  if (!cdcRaw || !String(cdcRaw).trim()) {
    return `<span style="color:var(--text-muted);font-size:12px;cursor:pointer;" onclick="openEditSubjectModal('${escapeJs(subjectName)}')">+ ${isEn ? 'Assign CDC' : 'Assegna CDC'}</span>`;
  }
  const tokens = extractCdcTokens(cdcRaw);
  if (tokens.length === 0) {
    const clean = String(cdcRaw).trim();
    return `
      <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;">
        <span class="item-chip" style="font-family:var(--font-mono);font-size:11.5px;font-weight:700;cursor:pointer;" onclick="openEditSubjectModal('${escapeJs(subjectName)}')" title="${escapeHtml(clean)}">
          🏷️ ${escapeHtml(clean.length > 22 ? clean.slice(0, 20) + '...' : clean)}
        </span>
      </div>
    `;
  }
  return `
    <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;">
      ${tokens.map(p => `
        <span class="item-chip" style="font-family:var(--font-mono);font-size:11.5px;font-weight:700;cursor:pointer;" onclick="openEditSubjectModal('${escapeJs(subjectName)}')" title="${isEn ? 'Teaching Certificate: ' + escapeHtml(p) : 'Classe di concorso: ' + escapeHtml(p)}">
          🏷️ ${escapeHtml(p)}
        </span>
      `).join('')}
    </div>
  `;
}

function toggleSubjCdcToken(code) {
  const inp = document.getElementById('editSubjCdc') || document.getElementById('newSubjCdc');
  if (!inp) return;
  const currentTokens = inp.value.split(/[,;/]+/).map(t => t.trim()).filter(Boolean);
  const exists = currentTokens.some(t => t.toUpperCase() === code.toUpperCase() || t.toUpperCase().startsWith(code.toUpperCase() + ' '));
  if (exists) {
    inp.value = currentTokens.filter(t => t.toUpperCase() !== code.toUpperCase() && !t.toUpperCase().startsWith(code.toUpperCase() + ' ')).join(', ');
  } else {
    currentTokens.push(code);
    inp.value = currentTokens.join(', ');
  }
}

function formatTeacherClassAssignments(grp, s, isEn) {
  let taList = grp.teacher_assignments;
  if (!taList || taList.length === 0) {
    if ((grp.teachers || []).length > 0 || (grp.classes || []).length > 0) {
      taList = (grp.teachers || []).map(t => ({
        teacher: t,
        hours: '-',
        classes: grp.classes || [],
        co_teachers: []
      }));
    }
  }

  if (!taList || taList.length === 0) {
    return `<span style="color:var(--text-muted);font-size:12px;font-style:italic;">${isEn ? 'No assignments yet' : 'Nessuna cattedra assegnata'}</span>`;
  }

  return `
    <div style="display:flex;flex-direction:column;gap:5px;">
      ${taList.map(ta => `
        <div class="ta-assignment-card">
          <div class="ta-assignment-teacher-col">
            ${ta.teacher === 'Da assegnare' ? `
              <span class="ta-unassigned-badge">⚠️ ${isEn ? 'Unassigned' : 'Da assegnare'}</span>
            ` : `
              <span class="ta-teacher-name" onclick="jumpToActivities({ teacher: '${escapeJs(ta.teacher)}', subject: '${escapeJs(s.name)}' })" title="${isEn ? 'View assignments of ' + escapeHtml(ta.teacher) : 'Vedi cattedre di ' + escapeHtml(ta.teacher)}">
                👨‍🏫 ${escapeHtml(ta.teacher)}
              </span>
            `}
            ${ta.hours !== '-' ? `<span class="ta-hours-badge" title="${ta.hours} ${isEn ? 'weekly hours' : 'ore settimanali'}">${ta.hours}h</span>` : ''}
            ${(ta.co_teachers && ta.co_teachers.length > 0) ? `
              <span class="ta-coteacher-badge" title="${isEn ? 'Co-teaching with ' : 'Compresenza con '}${escapeHtml(ta.co_teachers.join(', '))}">+${escapeHtml(ta.co_teachers.join(', '))}</span>
            ` : ''}
          </div>
          <span class="ta-arrow">➔</span>
          <div class="ta-assignment-classes-col">
            ${(ta.classes || []).map(c => `
              <span class="ta-class-chip" onclick="jumpToActivities({ className: '${escapeJs(c)}', subject: '${escapeJs(s.name)}' })" title="${isEn ? 'View assignments of class ' + escapeHtml(c) : 'Vedi cattedre classe ' + escapeHtml(c)}">
                🎓 ${escapeHtml(c)}
              </span>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function renderSubjects() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const res = await fetch('/api/subjects');
  const rawSubjects = await res.json();
  let subjects = (rawSubjects || []).filter(s => !(s.name || '').toLowerCase().startsWith('disposiz'));
  stateData.subjects = subjects;

  const globalSubjFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim().toLowerCase();
  if (globalSubjFlt) {
    subjects = subjects.filter(s => (s.name || '').toLowerCase() === globalSubjFlt);
  }

  const container = document.getElementById('mainContent');
  container.innerHTML = `
    ${getGlobalFilterBannerHtml()}
    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
      <input type="text" class="search-input" placeholder="${isEn ? '🔍 Search subject, CDC, teacher or class...' : '🔍 Cerca materia, CDC, docente o classe...'}" oninput="filterTable('subjTable', this.value)" style="min-width:220px;">
      <div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap;">
        <input type="text" id="newSubjName" class="search-input" placeholder="${isEn ? 'Subject name (e.g. Philosophy)' : 'Nome materia (es. Filosofia)'}" style="width:190px;">
        <input type="text" id="newSubjShortName" class="search-input" placeholder="${isEn ? 'Short name (e.g. FIL)' : 'Sigla stampa (es. FIL)'}" style="width:120px;text-transform:uppercase;" title="${isEn ? 'Optional short name / acronym for timetable prints' : 'Sigla o nome breve opzionale per le stampe'}">
        <input type="text" id="newSubjCdc" class="search-input" placeholder="CDC (es. A018)" style="width:120px;font-family:var(--font-mono);font-weight:600;" title="${isEn ? 'Qualified teaching certificate class' : 'Classe di concorso abilitata'}">
        <button class="btn btn-primary" onclick="addSubject()">+ ${isEn ? 'Add Subject' : 'Aggiungi Materia'}</button>
      </div>
    </div>

    <div class="table-container">
      <table class="data-table" id="subjTable">
        <thead>
          <tr>
            <th style="width:40px;">#</th>
            <th style="min-width:180px;">${_t('subjects.th_name', 'Materia / Disciplina')}</th>
            <th style="width:145px;text-align:center;">${_t('teachers.th_cdc', 'Classe di Concorso (CDC)')}</th>
            <th style="width:135px;text-align:center;">${isEn ? 'Afternoon Periods' : 'Rientri Pomeridiani'}</th>
            <th style="width:135px;text-align:center;">${isEn ? 'Preferred Time Slot' : 'Fascia Preferita'}</th>
            <th style="width:110px;text-align:center;">${_t('subjects.th_hours', 'Ore Totali')}</th>
            <th style="min-width:340px;">${isEn ? 'Teachers ➔ Assigned Classes' : 'Docenti ➔ Classi Assegnate'}</th>
            <th>${_t('teachers.th_notes', 'Note')}</th>
            <th style="text-align:right;min-width:260px;">${_t('teachers.th_actions', 'Azioni Rapide')}</th>
          </tr>
        </thead>
        <tbody>
          ${subjects.map((s, idx) => {
            const noRientri = !!s.no_rientri;
            const prefHours = s.pref_hours || 'INDIFFERENTE';
            const cdcGroups = (s.cdc_groups && s.cdc_groups.length > 0) ? s.cdc_groups : [{
              cdc: s.cdc || '',
              hours: s.total_hours || 0,
              cattedre_count: s.cattedre_count || 0,
              teachers: s.teachers || [],
              classes: s.classes || [],
              teacher_assignments: s.teacher_assignments || []
            }];

            if (cdcGroups.length <= 1) {
              const grp = cdcGroups[0];
              return `
              <tr>
                <td style="color:var(--text-sub);">${idx + 1}</td>
                <td>
                  <b style="font-size:13.5px;color:var(--text-main);cursor:pointer;" onclick="openEditSubjectModal('${escapeJs(s.name)}')" title="${isEn ? 'Click to edit subject rules' : 'Clicca per modificare regole materia'}">📚 ${escapeHtml(s.name)}</b>
                  ${s.short_name ? `
                    <span class="item-chip" style="font-size:11px;font-weight:700;color:var(--primary);margin-left:6px;background:#e0f2fe;border:1px solid #bae6fd;" title="${isEn ? 'Short name for prints: ' + escapeHtml(s.short_name) : 'Sigla usata nelle stampe: ' + escapeHtml(s.short_name)}">
                      🖨️ ${escapeHtml(s.short_name)}
                    </span>
                  ` : ''}
                </td>
                <td style="text-align:center;">
                  ${formatSubjectCdcPills(grp.cdc || s.cdc, s.name, isEn)}
                </td>
                <td style="text-align:center;">
                  ${noRientri ? `
                    <span class="badge-no-rientri" title="${isEn ? 'Categorically excluded from afternoon sessions (7th and 8th periods)' : 'Esclusa categoricamente dai pomeriggi (ore 7 e 8)'}">
                      🚫 ${isEn ? 'No Afternoons' : 'No Rientri'}
                    </span>
                  ` : `
                    <span class="badge badge-ok" style="font-size:10.5px;" title="${isEn ? 'Allowed in both morning and afternoon periods' : 'Ammessa sia al mattino sia al pomeriggio'}">
                      ✅ ${isEn ? 'Allowed' : 'Ammessa'}
                    </span>
                  `}
                </td>
                <td style="text-align:center;">
                  ${prefHours === 'PRIME' ? `
                    <span class="badge-pref-prime" title="${isEn ? 'FET prefers placing this in early morning periods (1st-3rd)' : 'FET favorisce la collocazione nelle prime 2-3 ore del mattino'}">
                      🌅 ${isEn ? 'Early Hours' : 'Prime Ore'}
                    </span>
                  ` : prefHours === 'ULTIME' ? `
                    <span class="badge-pref-ultime" title="${isEn ? 'FET prefers placing this in later periods' : 'FET favorisce la collocazione nelle ultime ore di lezione'}">
                      🌇 ${isEn ? 'Late Hours' : 'Ultime Ore'}
                    </span>
                  ` : `
                    <span style="font-size:11.5px;color:var(--text-muted);">⚖️ ${isEn ? 'Indifferent' : 'Indifferente'}</span>
                  `}
                </td>
                <td style="text-align:center;">
                  <span class="badge ${s.total_hours > 0 ? 'badge-info' : ''}" style="font-weight:700;font-size:12px;">
                    ${s.total_hours || 0} h
                  </span>
                  <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">
                    (${s.cattedre_count || 0} ${isEn ? 'assignments' : 'cattedre'})
                  </div>
                </td>
                <td style="min-width:320px;">
                  ${formatTeacherClassAssignments(grp, s, isEn)}
                </td>
                <td style="color:var(--text-muted);font-size:12px;">${escapeHtml(s.comments || '-')}</td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-sec" onclick="openEditSubjectModal('${escapeJs(s.name)}')" title="${isEn ? 'Edit rules: name, print short name, CDC, afternoons, preferred slot, notes' : 'Modifica: nome materia, nome breve per stampe, CDC, rientri pomeridiani, fascia oraria, note'}">
                    ✏️ ${isEn ? 'Edit' : 'Modifica'}
                  </button>
                  <button class="btn btn-sm btn-sec" onclick="openMergeSubjectModal('${escapeJs(s.name)}')" title="${isEn ? 'Unify this subject into another (e.g. merge Matematica A027 into Matematica)' : 'Unifica questa materia in un\'altra (es. unisci Matematica A027 in Matematica)'}">
                    🔗 ${isEn ? 'Merge' : 'Unisci'}
                  </button>
                  <button class="btn btn-sm btn-primary" onclick="openNewCattedraModal({ subject: '${escapeJs(s.name)}', cdc: '${escapeJs(grp.cdc || '')}' })" title="${isEn ? 'Assign teacher and class for ' + escapeJs(s.name) : 'Assegna un docente e una classe per ' + escapeJs(s.name)}">
                    ➕ ${isEn ? 'Assignment' : 'Cattedra'}
                  </button>
                  <button class="btn btn-sm btn-sec" onclick="jumpToActivities({ subject: '${escapeJs(s.name)}' })" title="${isEn ? 'View all assignments of ' + escapeJs(s.name) : 'Vedi tutte le cattedre di ' + escapeJs(s.name)}">
                    📚 ${isEn ? 'Assignments' : 'Cattedre'}
                  </button>
                  <button class="btn btn-sm btn-danger" onclick="deleteSubject('${escapeJs(s.name)}')">🗑️</button>
                </td>
              </tr>
              `;
            }

            // Materia con più Classi di Concorso (CDC multiple) -> righe separate e raggruppate per CDC
            return cdcGroups.map((grp, grpIdx) => {
              const isFirst = (grpIdx === 0);
              const rowClass = isFirst ? 'subj-multi-parent' : 'subj-multi-child';

              return `
              <tr class="${rowClass}" data-subject-group="${escapeHtml(s.name)}">
                <td style="color:var(--text-sub);font-size:12px;">
                  ${isFirst ? `<b>${idx + 1}</b>` : ''}
                </td>
                <td>
                  ${isFirst ? `
                    <b style="font-size:13.5px;color:var(--text-main);cursor:pointer;" onclick="openEditSubjectModal('${escapeJs(s.name)}')" title="${isEn ? 'Click to edit subject rules' : 'Clicca per modificare regole materia'}">📚 ${escapeHtml(s.name)}</b>
                    ${s.short_name ? `
                      <span class="item-chip" style="font-size:11px;font-weight:700;color:var(--primary);margin-left:6px;background:#e0f2fe;border:1px solid #bae6fd;" title="${isEn ? 'Short name for prints: ' + escapeHtml(s.short_name) : 'Sigla usata nelle stampe: ' + escapeHtml(s.short_name)}">
                        🖨️ ${escapeHtml(s.short_name)}
                      </span>
                    ` : ''}
                    <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">
                      ${isEn ? 'Total:' : 'Totale complessivo:'} <b>${s.total_hours || 0} h</b> (${s.cattedre_count || 0} ${isEn ? 'assignments' : 'cattedre'})
                    </div>
                  ` : `
                    <div style="padding-left:14px;display:flex;align-items:center;gap:8px;">
                      <span class="subj-subrow-arrow">↳</span>
                      <span class="subj-subrow-title" onclick="openEditSubjectModal('${escapeJs(s.name)}')" title="${isEn ? 'Click to edit subject rules' : 'Clicca per modificare regole materia'}">${escapeHtml(s.name)}</span>
                    </div>
                  `}
                </td>
                <td style="text-align:center;">
                  <span class="item-chip" style="font-family:var(--font-mono);font-size:11.5px;font-weight:700;color:var(--primary);cursor:pointer;" onclick="openEditSubjectModal('${escapeJs(s.name)}')" title="${isEn ? 'Teaching Certificate: ' + escapeHtml(grp.cdc) : 'Classe di concorso abilitata: ' + escapeHtml(grp.cdc)}">
                    🏷️ ${escapeHtml(grp.cdc || '-')}
                  </span>
                </td>
                <td style="text-align:center;">
                  ${isFirst ? (noRientri ? `
                    <span class="badge-no-rientri" title="${isEn ? 'Categorically excluded from afternoon sessions (7th and 8th periods)' : 'Esclusa categoricamente dai pomeriggi (ore 7 e 8)'}">
                      🚫 ${isEn ? 'No Afternoons' : 'No Rientri'}
                    </span>
                  ` : `
                    <span class="badge badge-ok" style="font-size:10.5px;" title="${isEn ? 'Allowed in both morning and afternoon periods' : 'Ammessa sia al mattino sia al pomeriggio'}">
                      ✅ ${isEn ? 'Allowed' : 'Ammessa'}
                    </span>
                  `) : `<span style="font-size:10.5px;color:var(--text-muted);">${noRientri ? '🚫 No Rientri' : '✅ Ammessa'}</span>`}
                </td>
                <td style="text-align:center;">
                  ${isFirst ? (prefHours === 'PRIME' ? `
                    <span class="badge-pref-prime" title="${isEn ? 'FET prefers placing this in early morning periods (1st-3rd)' : 'FET favorisce la collocazione nelle prime 2-3 ore del mattino'}">
                      🌅 ${isEn ? 'Early Hours' : 'Prime Ore'}
                    </span>
                  ` : prefHours === 'ULTIME' ? `
                    <span class="badge-pref-ultime" title="${isEn ? 'FET prefers placing this in later periods' : 'FET favorisce la collocazione nelle ultime ore di lezione'}">
                      🌇 ${isEn ? 'Late Hours' : 'Ultime Ore'}
                    </span>
                  ` : `
                    <span style="font-size:11.5px;color:var(--text-muted);">⚖️ ${isEn ? 'Indifferent' : 'Indifferente'}</span>
                  `) : `<span style="font-size:10.5px;color:var(--text-muted);">${prefHours === 'PRIME' ? '🌅 Prime' : (prefHours === 'ULTIME' ? '🌇 Ultime' : '⚖️ Indiff.')}</span>`}
                </td>
                <td style="text-align:center;">
                  <span class="badge ${grp.hours > 0 ? 'badge-info' : ''}" style="font-weight:700;font-size:12px;">
                    ${grp.hours || 0} h
                  </span>
                  <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
                    (${grp.cattedre_count || 0} ${isEn ? 'assignments' : 'cattedre'})
                  </div>
                </td>
                <td style="min-width:320px;">
                  ${formatTeacherClassAssignments(grp, s, isEn)}
                </td>
                <td style="color:var(--text-muted);font-size:12px;">${isFirst ? escapeHtml(s.comments || '-') : '<span style="font-size:10.5px;color:var(--text-muted);font-style:italic;">(stessa materia)</span>'}</td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-primary" onclick="openNewCattedraModal({ subject: '${escapeJs(s.name)}', cdc: '${escapeJs(grp.cdc || '')}' })" title="${isEn ? 'Assign teacher on CDC ' + escapeJs(grp.cdc) : 'Assegna cattedra per ' + escapeJs(s.name) + ' su CDC ' + escapeJs(grp.cdc)}">
                    ➕ ${isEn ? 'Assignment' : 'Cattedra'}
                  </button>
                  ${isFirst ? `
                    <button class="btn btn-sm btn-sec" onclick="openEditSubjectModal('${escapeJs(s.name)}')" title="${isEn ? 'Edit rules: name, print short name, CDC, afternoons, preferred slot, notes' : 'Modifica materia, sigla, CDC, rientri, fascia, note'}">
                      ✏️
                    </button>
                    <button class="btn btn-sm btn-sec" onclick="openMergeSubjectModal('${escapeJs(s.name)}')" title="${isEn ? 'Unify this subject into another' : 'Unisci materia in un\'altra'}">
                      🔗
                    </button>
                  ` : ''}
                  <button class="btn btn-sm btn-sec" onclick="jumpToActivities({ subject: '${escapeJs(s.name)}' })" title="${isEn ? 'View all assignments of ' + escapeJs(s.name) : 'Vedi tutte le cattedre di ' + escapeJs(s.name)}">
                    📚
                  </button>
                  ${isFirst ? `
                    <button class="btn btn-sm btn-danger" onclick="deleteSubject('${escapeJs(s.name)}')">🗑️</button>
                  ` : ''}
                </td>
              </tr>
              `;
            }).join('');
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openEditSubjectModal(subjectName) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const subj = (stateData.subjects || []).find(s => s.name === subjectName) || { name: subjectName };
  const noRientri = !!subj.no_rientri;
  const prefHours = subj.pref_hours || 'INDIFFERENTE';
  const cdc = subj.cdc || '';
  const shortName = subj.short_name || '';
  const comments = subj.comments || '';

  showModal(`
    <div class="modal-dialog" style="max-width:620px;">
      <div class="modal-header">
        <div class="modal-title">📚 ${isEn ? 'Edit Subject & Print Settings' : 'Disciplina & Regole di Stampa'}: ${escapeHtml(subjectName)}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">${isEn ? 'Subject Name' : 'Nome Materia / Disciplina'} <span style="color:#ef4444;">*</span></label>
            <input type="text" id="editSubjName" class="form-input" value="${escapeHtml(subjectName)}" placeholder="${isEn ? 'Subject name' : 'Nome materia'}">
            <span class="form-hint">${isEn ? 'Renaming automatically updates all connected lessons.' : 'Rinominando la materia verranno aggiornate tutte le cattedre e le lezioni collegate.'}</span>
          </div>
          <div class="form-group">
            <label class="form-label">${isEn ? 'Short Name for Prints (optional)' : 'Nome Breve per le Stampe (opzionale)'}</label>
            <input type="text" id="editSubjShortName" class="form-input" value="${escapeHtml(shortName)}" placeholder="es. MAT, FIS, ITA, ING" style="text-transform:uppercase;font-weight:600;">
            <span class="form-hint">${isEn ? 'Used in timetable grids, Word & PDF printouts instead of full name.' : 'Se impostato, viene usato nei tabelloni e nei file Word/PDF al posto del nome esteso.'}</span>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label" style="display:flex;justify-content:space-between;align-items:center;">
              <span>${isEn ? 'Teaching Certificate Classes (CDC)' : 'Classi di Concorso Abilitate (CDC)'}</span>
              <span class="form-hint" style="font-weight:normal;color:var(--primary);">${isEn ? 'Multiple classes allowed (comma-separated)' : 'Più classi consentite (separate da virgola)'}</span>
            </label>
            <input type="text" id="editSubjCdc" class="form-input" value="${escapeHtml(cdc)}" placeholder="es. A026, A027, A047 oppure A011, A012" style="font-family:var(--font-mono);font-weight:600;">
            <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;line-height:1.4;">
              ${isEn
                ? '💡 The same subject (e.g. <b>Mathematics</b> or <b>History</b>) can be taught by teachers of different classes of contest (e.g. <b>A026, A027, A047</b>) across different sections, levels or curricula.'
                : '💡 La stessa materia (es. <b>Matematica</b>, <b>Storia</b> o <b>Fisica</b>) può essere associata a più Classi di Concorso (es. <b>A026, A027, A047</b>) se in diversi indirizzi, biennio/triennio o sezioni può essere insegnata da docenti con abilitazioni diverse.'}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;">
              <span style="font-size:11px;color:var(--text-muted);align-self:center;margin-right:4px;">${isEn ? 'Quick add:' : 'Aggiunta rapida:'}</span>
              ${['A026', 'A027', 'A047', 'A011', 'A012', 'A019', 'A018', 'A020', 'A050', 'A048', 'A054', 'AA24'].map(code => `
                <button type="button" class="btn btn-sm btn-sec" style="font-size:11px;padding:2px 6px;font-family:var(--font-mono);" onclick="toggleSubjCdcToken('${code}')">+ ${code}</button>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="form-group" style="background:#f8fafc;padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border-light);">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
            <input type="checkbox" id="editSubjNoRientri" ${noRientri ? 'checked' : ''} style="width:18px;height:18px;margin-top:2px;">
            <div>
              <span style="font-weight:700;font-size:13px;color:#991b1b;">
                🚫 ${isEn ? 'Categorically Exclude from Afternoon Sessions' : 'Escludi categoricamente dai Rientri Pomeridiani'}
              </span>
              <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;line-height:1.4;">
                ${isEn
                  ? 'Prevents FET from placing this subject in afternoon periods (7th and 8th). Recommended for heavy subjects like <b>Mathematics</b>, <b>Latin</b>, <b>Greek</b> or written tests.'
                  : 'Impedisce a FET di collocare questa materia nelle ore pomeridiane (7ª e 8ª ora). Consigliato per materie ad alto carico cognitivo come <b>Matematica</b>, <b>Latino</b>, <b>Greco</b> o prove scritte.'}
              </div>
            </div>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Preferred Time Slot (FET Constraint)' : 'Fascia Oraria Preferita (Constraint FET)'}</label>
          <select id="editSubjPrefHours" class="form-select">
            <option value="INDIFFERENTE" ${prefHours === 'INDIFFERENTE' ? 'selected' : ''}>⚖️ ${isEn ? 'Indifferent (No slot preference)' : 'Indifferente (Nessuna preferenza di fascia)'}</option>
            <option value="PRIME" ${prefHours === 'PRIME' ? 'selected' : ''}>🌅 ${isEn ? 'Early Morning Hours (1st, 2nd, 3rd period)' : 'Prime Ore del Mattino (1ª, 2ª, 3ª ora)'}</option>
            <option value="ULTIME" ${prefHours === 'ULTIME' ? 'selected' : ''}>🌇 ${isEn ? 'Late Hours / Afternoon' : 'Ultime Ore della Giornata (Ore finali / Pomeriggio)'}</option>
          </select>
          <span class="form-hint">${isEn ? 'Ideal for lab, sports, or art subjects during late periods.' : 'Ideale per favorire materie laboratoriali o motorie (es. Scienze Motorie / Arte) nelle ultime ore.'}</span>
        </div>

        <div class="form-group">
          <label class="form-label">${_t('teachers.th_notes', 'Note / Raggruppamento')}</label>
          <input type="text" id="editSubjComments" class="form-input" value="${escapeHtml(comments)}" placeholder="${isEn ? 'Didactic notes or planning blocks' : 'Note didattiche o blocchi previsti'}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitEditSubject('${escapeJs(subjectName)}')">💾 ${isEn ? 'Save Changes' : 'Salva Modifiche'}</button>
      </div>
    </div>
  `);
}

async function submitEditSubject(origName) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const newName = (document.getElementById('editSubjName')?.value || '').trim();
  const shortName = (document.getElementById('editSubjShortName')?.value || '').trim();
  const cdc = (document.getElementById('editSubjCdc')?.value || '').trim();
  const noRientri = !!document.getElementById('editSubjNoRientri')?.checked;
  const prefHours = document.getElementById('editSubjPrefHours')?.value || 'INDIFFERENTE';
  const comments = (document.getElementById('editSubjComments')?.value || '').trim();

  if (!newName) {
    alert(isEn ? 'Subject name cannot be empty.' : 'Il nome della materia non può essere vuoto.');
    return;
  }

  const res = await fetch('/api/subjects/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: origName,
      new_name: newName,
      short_name: shortName,
      cdc: cdc,
      no_rientri: noRientri,
      pref_hours: prefHours,
      comments: comments
    })
  });

  if (res.ok) {
    closeModal();
    showToast(isEn ? `Subject "${newName}" updated successfully!` : `Disciplina "${newName}" aggiornata con successo!`);
    await renderSubjects();
    return;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {}

  if (res.status === 409 && data && data.error === 'subject_exists') {
    const doMerge = confirm(isEn
      ? `The subject "${newName}" already exists in the catalog.\n\nDo you want to UNIFY "${origName}" into "${newName}"?\nAll lessons/assignments of "${origName}" will be transferred to "${newName}", and their Teaching Certificate Classes (CDC) will be combined.`
      : `La materia "${newName}" è già presente in anagrafica.\n\nVuoi UNIFICARE "${origName}" in "${newName}"?\nTutte le cattedre e le lezioni assegnate a "${origName}" verranno trasferite a "${newName}", e le relative Classi di Concorso (CDC) verranno unite.`);
    if (doMerge) {
      const resMerge = await fetch('/api/subjects/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: origName,
          new_name: newName,
          short_name: shortName,
          cdc: cdc,
          no_rientri: noRientri,
          pref_hours: prefHours,
          comments: comments,
          merge: true
        })
      });
      if (resMerge.ok) {
        closeModal();
        showToast(isEn ? `Merged into "${newName}" successfully!` : `Unificata con successo in "${newName}"!`);
        await renderSubjects();
        return;
      }
    }
  } else {
    alert(isEn ? 'Error updating subject. Please ensure the new name is valid.' : 'Errore durante l\'aggiornamento della materia. Verifica che il nuovo nome sia valido.');
  }
}

function openMergeSubjectModal(sourceName) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const otherSubjects = (stateData.subjects || []).filter(s => s.name !== sourceName);
  if (otherSubjects.length === 0) {
    alert(isEn ? 'No other subjects available for merge.' : 'Nessun\'altra materia disponibile con cui unificare.');
    return;
  }
  const opts = otherSubjects.map(s => `
    <option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}${s.cdc ? ` [${escapeHtml(s.cdc)}]` : ''}</option>
  `).join('');

  showModal(`
    <div class="modal-dialog" style="max-width:540px;">
      <div class="modal-header">
        <div class="modal-title">🔗 ${isEn ? 'Unify Subject' : 'Unifica Materia'}: ${escapeHtml(sourceName)}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-main);margin-bottom:14px;line-height:1.5;">
          ${isEn
            ? `Select the target subject into which <b>${escapeHtml(sourceName)}</b> will be absorbed. All teaching assignments, activities and block rules will be transferred, and the Teaching Certificate Classes (CDC) will be combined.`
            : `Seleziona la materia di destinazione in cui confluirà <b>${escapeHtml(sourceName)}</b>. Tutte le cattedre, le lezioni e i vincoli orari verranno trasferiti, e le Classi di Concorso (CDC) abilitate verranno unite.`}
        </p>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Destination Subject' : 'Materia di Destinazione (Principale)'}</label>
          <select id="mergeTargetSelect" class="form-select">
            ${opts}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()">${isEn ? 'Cancel' : 'Annulla'}</button>
        <button class="btn btn-primary" onclick="submitMergeSubjects('${escapeJs(sourceName)}')">🔗 ${isEn ? 'Confirm Merge' : 'Conferma Unificazione'}</button>
      </div>
    </div>
  `);
}

async function submitMergeSubjects(sourceName) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const targetSelect = document.getElementById('mergeTargetSelect');
  const targetName = targetSelect ? targetSelect.value : '';
  if (!targetName) return;

  const res = await fetch('/api/subjects/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_subject: sourceName, target_subject: targetName })
  });

  if (res.ok) {
    closeModal();
    showToast(isEn ? `Merged "${sourceName}" into "${targetName}"!` : `Materia "${sourceName}" unificata con successo in "${targetName}"!`);
    await renderSubjects();
  } else {
    alert(isEn ? 'Error merging subjects.' : 'Errore durante l\'unificazione delle materie.');
  }
}

async function addSubject() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const inp = document.getElementById('newSubjName');
  const shortInp = document.getElementById('newSubjShortName');
  const cdcInp = document.getElementById('newSubjCdc');
  const name = inp ? inp.value.trim() : '';
  const shortName = shortInp ? shortInp.value.trim() : '';
  const cdc = cdcInp ? cdcInp.value.trim() : '';
  if (!name) return;
  const res = await fetch('/api/subjects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, short_name: shortName, cdc: cdc })
  });
  if (res.ok) {
    if (inp) inp.value = '';
    if (shortInp) shortInp.value = '';
    if (cdcInp) cdcInp.value = '';
    showToast(isEn ? `Subject "${name}" created!` : `Materia "${name}" creata!`);
    await renderSubjects();
  } else {
    alert(isEn ? 'Subject already exists.' : 'Materia già presente.');
  }
}

async function deleteSubject(name) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (confirm(isEn ? `Delete subject "${name}"?` : `Eliminare la materia "${name}"?`)) {
    await fetch(`/api/subjects/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(isEn ? `Subject "${name}" deleted.` : `Materia "${name}" eliminata.`, 'warn');
    renderSubjects();
  }
}

// ============================================================================
// 7. GESTIONE AULE & PLESSI (DISPOSIZIONE, CAPIENZA, PALESTRA VS LABORATORI)
// ============================================================================
let activeRoomPlessoFilter = 'all'; // 'all' | 'Centrale' | 'Succursale' | 'special'

async function renderRooms() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const res = await fetch('/api/rooms');
  const rData = await res.json();
  stateData.rooms = rData.rooms || [];

  // Normalizza edifici con oggetti ricchi (name, short_code, comments)
  const rawBuildings = rData.buildings || ['Centrale', 'Succursale'];
  stateData.buildingsList = rawBuildings.map(b => {
    if (typeof b === 'object' && b !== null) return b;
    return {
      name: String(b),
      short_code: String(b).substring(0, 1).toUpperCase(),
      comments: '',
      rooms_count: (rData.rooms || []).filter(r => r.building === b).length
    };
  });
  stateData.buildings = stateData.buildingsList.map(b => b.name);

  const rooms = stateData.rooms;
  const centraleRooms = rooms.filter(r => (r.building || '').toLowerCase() === 'centrale');
  const succursaleRooms = rooms.filter(r => (r.building || '').toLowerCase().includes('succ'));

  const countCentraleStandard = centraleRooms.filter(r => r.room_type === 'standard' || !r.is_lab_or_gym).length;
  const countCentraleLab = centraleRooms.filter(r => r.room_type === 'lab').length;
  const countCentraleGym = centraleRooms.filter(r => r.room_type === 'gym').length;
  const capCentraleTotal = centraleRooms.reduce((acc, r) => acc + (r.capacity || 30), 0);

  const countSuccStandard = succursaleRooms.filter(r => r.room_type === 'standard' || !r.is_lab_or_gym).length;
  const countSuccLab = succursaleRooms.filter(r => r.room_type === 'lab').length;
  const countSuccGym = succursaleRooms.filter(r => r.room_type === 'gym').length;
  const capSuccTotal = succursaleRooms.reduce((acc, r) => acc + (r.capacity || 30), 0);

  // Filtro
  let displayedRooms = rooms;
  if (activeRoomPlessoFilter === 'Centrale') {
    displayedRooms = centraleRooms;
  } else if (activeRoomPlessoFilter === 'Succursale') {
    displayedRooms = succursaleRooms;
  } else if (activeRoomPlessoFilter === 'special') {
    displayedRooms = rooms.filter(r => r.is_lab_or_gym);
  }

  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <!-- Banner Chiarezza Concettuale Aule vs Classi -->
    <div class="info-banner">
      ${isEn
        ? '🏫 <b>Facility Spaces vs Student Cohorts Distinction:</b><br>' +
          '• <b>Room Name (Physical Space):</b> Physical building entity (e.g. <b>Room 53</b>, <b>INFO 1</b>, <b>Gym</b>) with <b>Maximum Capacity</b> and <b>Campus</b>.<br>' +
          '• <b>Single Main Campus Gym:</b> The institute has a <b>single Gym at Main Campus</b> with a maximum capacity of <b>57 persons</b>. The system accommodates 2 or 3 simultaneous classes based on the real student count to never exceed total capacity. Computer labs <b>INFO 1</b> and <b>INFO 2</b> are <b>physically separate rooms</b> with 28 workstations each.<br>' +
          '• <b>Lab / Gym Flag:</b> Automatically triggers <b>campus transfers</b> and travel allowances for cohorts residing at another campus.'
        : '🏫 <b>Distinzione Struttura Spazi vs Classi Studenti:</b><br>' +
          '• <b>Nome Aula (Spazio Fisico):</b> Entità dell\'edificio (es. <b>Aula 53</b>, <b>INFO 1</b>, <b>Palestra</b>) con <b>Capienza Massima</b> e <b>Plesso</b>.<br>' +
          '• <b>Palestra Unica Sede Centrale:</b> L\'istituto dispone di un\'<b>unica Palestra in Sede Centrale</b> con capienza massima di <b>57 persone</b>. Il programma gestisce internamente la contemporaneità ospitando 2 o 3 classi per fascia oraria in base alla somma effettiva degli studenti per non superare mai la capienza complessiva. I laboratori <b>INFO 1</b> e <b>INFO 2</b> sono invece <b>spazi fisici separati</b> con 28 postazioni ciascuno.<br>' +
          '• <b>Flag Laboratorio / Palestra:</b> Innescano automaticamente i <b>cambi di plesso</b> e i tempi di trasferimento per le classi residenti in un\'altra sede.'}
    </div>

    <!-- Schede di Gestione Sedi / Plessi -->
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div style="font-weight:700;font-size:14px;color:var(--text-main);">
          🏛️ ${isEn ? `Campus & Buildings Configuration (${stateData.buildingsList.length} Active Campuses)` : `Configurazione Sedi & Plessi dell'Istituto (${stateData.buildingsList.length} Sedi Attive)`}
        </div>
        <button class="btn btn-sm btn-primary" onclick="openAddBuildingModal()">+ ${isEn ? 'Add New Campus / Building' : 'Aggiungi Nuovo Plesso / Sede'}</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:12px;">
        ${stateData.buildingsList.map(b => {
          const isSucc = b.name.toLowerCase().includes('succ');
          const rList = rooms.filter(r => r.building === b.name);
          const capTot = rList.reduce((acc, r) => acc + (r.capacity || 30), 0);

          return `
            <div style="background:var(--bg-main);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:16px;">${isSucc ? '🏢' : '🏛️'}</span>
                  <b style="font-size:13.5px;color:var(--text-main);">${escapeHtml(b.name)}</b>
                  <span class="badge ${isSucc ? 'badge-warn' : 'badge-info'}" style="font-weight:700;">
                    ${isEn ? 'Code' : 'Sigla'}: ${escapeHtml(b.short_code || b.name[0])}
                  </span>
                </div>
                <div style="display:flex;gap:4px;">
                  <button class="btn-sm btn-sec" onclick="openEditBuildingModal('${escapeJs(b.name)}', '${escapeJs(b.short_code || '')}', '${escapeJs(b.comments || '')}')" title="${isEn ? 'Edit campus name, code or notes' : 'Modifica nome, sigla o note del plesso'}">✏️</button>
                  <button class="btn-sm btn-danger" onclick="deleteBuilding('${escapeJs(b.name)}')" title="${isEn ? 'Delete campus' : 'Elimina plesso'}">🗑️</button>
                </div>
              </div>
              <div style="font-size:12px;color:var(--text-muted);line-height:1.4;">
                <div>${isEn ? 'Associated rooms:' : 'Aule associate:'} <b>${rList.length}</b> (${isEn ? 'Total capacity:' : 'Capienza tot:'} <b>${capTot} ${isEn ? 'seats' : 'posti'}</b>)</div>
                ${b.comments ? `<div style="font-style:italic;margin-top:2px;">${escapeHtml(b.comments)}</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Toolbar e Filtri Plesso -->
    <div class="toolbar" style="flex-wrap:wrap;">
      <input type="text" class="search-input" placeholder="${isEn ? '🔍 Search room, lab, campus...' : '🔍 Cerca aula, laboratorio, plesso...'}" oninput="filterTable('roomTable', this.value)">

      <div class="segmented-control">
        <button class="segmented-btn ${activeRoomPlessoFilter === 'all' ? 'active' : ''}" onclick="filterRoomsByPlesso('all')">
          ${isEn ? 'All' : 'Tutti'} (${rooms.length})
        </button>
        <button class="segmented-btn ${activeRoomPlessoFilter === 'Centrale' ? 'active' : ''}" onclick="filterRoomsByPlesso('Centrale')">
          🏛️ ${isEn ? 'Main' : 'Centrale'} (${centraleRooms.length})
        </button>
        <button class="segmented-btn ${activeRoomPlessoFilter === 'Succursale' ? 'active' : ''}" onclick="filterRoomsByPlesso('Succursale')">
          🏢 ${isEn ? 'Branch' : 'Succursale'} (${succursaleRooms.length})
        </button>
        <button class="segmented-btn ${activeRoomPlessoFilter === 'special' ? 'active' : ''}" onclick="filterRoomsByPlesso('special')">
          🧪 ${isEn ? 'Labs & Gyms' : 'Lab & Palestre'} (${rooms.filter(r => r.is_lab_or_gym).length})
        </button>
      </div>

      <div style="display:flex;gap:6px;margin-left:auto;">
        <input type="text" id="newRoomName" class="search-input" placeholder="${isEn ? 'Room name (e.g. Room 53)' : 'Nome aula (es. Aula 53)'}" style="width:130px;">
        <select id="newRoomBuilding" class="search-input" style="width:120px;">
          ${stateData.buildings.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}
        </select>
        <select id="newRoomType" class="search-input" style="width:125px;">
          <option value="standard">🚪 ${isEn ? 'Standard' : 'Ordinaria'}</option>
          <option value="lab">🧪 ${isEn ? 'Laboratory' : 'Laboratorio'}</option>
          <option value="gym">🏀 ${isEn ? 'Gymnasium' : 'Palestra'}</option>
        </select>
        <input type="number" id="newRoomCap" class="search-input" placeholder="${isEn ? 'Capacity' : 'Capienza'}" value="30" style="width:75px;" title="${isEn ? 'Maximum Student Capacity' : 'Capienza Massima Alunni'}">
        <button class="btn btn-primary" onclick="addRoom()">+ ${isEn ? 'Add' : 'Aggiungi'}</button>
      </div>
    </div>

    <!-- Tabella Aule -->
    <div class="table-container">
      <table class="data-table" id="roomTable">
        <thead>
          <tr>
            <th style="width:40px;">#</th>
            <th style="min-width:170px;">${_t('rooms.th_room', 'Nome Aula / Spazio')}</th>
            <th style="width:150px;">${_t('rooms.th_building', 'Plesso (Disposizione)')}</th>
            <th style="min-width:180px;">${_t('rooms.th_lab', 'Tipologia & Architettura Spazio')}</th>
            <th style="width:160px;text-align:center;">${isEn ? 'Campus Transfer Flag' : 'Flag Cambio Plesso'}</th>
            <th style="width:125px;text-align:center;">${_t('rooms.th_capacity', 'Capienza Max')}</th>
            <th style="min-width:180px;">${isEn ? 'Resident Homeroom Class' : 'Classe Base Residente'}</th>
            <th style="text-align:right;width:110px;">${_t('rooms.th_actions', 'Azioni')}</th>
          </tr>
        </thead>
        <tbody>
          ${displayedRooms.map((r, idx) => {
            const isGym = r.room_type === 'gym' || (r.name || '').toLowerCase().includes('palestra');
            const isLab = r.room_type === 'lab' || (!isGym && r.is_lab_or_gym);
            const isInfoLab = (r.name || '').toUpperCase().includes('INFO');
            const icon = isGym ? '🏀' : (isLab ? '🧪' : '🚪');

            const assignedClasses = r.assigned_classes || [];
            const assignedStud = r.assigned_class_students || 0;
            const isOvercrowded = assignedClasses.length > 0 && assignedStud > (r.capacity || 30);

            return `
              <tr>
                <td style="color:var(--text-sub);">${idx + 1}</td>
                <td>
                  <b style="font-size:13.5px;color:var(--text-main);cursor:pointer;" onclick="openEditRoomModal('${escapeJs(r.name)}')">${icon} ${escapeHtml(r.name)}</b>
                  ${r.comments ? `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(r.comments)}</div>` : ''}
                </td>
                <td>
                  <select class="table-select" onchange="changeRoomBuilding('${escapeJs(r.name)}', this.value)" title="${isEn ? 'Change campus disposition' : 'Cambia al volo la disposizione del plesso'}">
                    ${stateData.buildings.map(b => `
                      <option value="${escapeHtml(b)}" ${r.building === b ? 'selected' : ''}>
                        ${b === 'Centrale' ? (isEn ? '🏛️ Main' : '🏛️ Centrale') : (b === 'Succursale' ? (isEn ? '🏢 Branch' : '🏢 Succursale') : escapeHtml(b))}
                      </option>
                    `).join('')}
                  </select>
                </td>
                <td>
                  ${isGym ? `
                    <span class="badge-gym-module" style="background:#fef3c7;border-color:#f59e0b;color:#92400e;" title="${isEn ? 'Single sports facility at Main Campus (Max 57 students, accommodates 2 or 3 simultaneous classes)' : 'Unico impianto sportivo dell\'istituto in Sede Centrale (Capienza max 57 studenti, gestisce internamente 2 o 3 classi contemporanee)'}">
                      🏀 ${isEn ? 'Single Gym (57 seats - 2 or 3 classes)' : 'Palestra Unica (57 posti - 2 o 3 classi)'}
                    </span>
                  ` : isInfoLab ? `
                    <span class="badge-lab-module" title="${isEn ? 'Physically separated lab with 28 PC workstations' : 'Laboratorio Didattico Fisicamente Separato con 28 postazioni PC'}">
                      🧪 ${isEn ? 'Separate Lab (28 seats)' : 'Lab Fisico Separato (28 posti)'}
                    </span>
                  ` : `
                    <select class="table-select" onchange="changeRoomType('${escapeJs(r.name)}', this.value)" title="${isEn ? 'Change room type' : 'Cambia la tipologia di stanza'}">
                      <option value="standard" ${(!r.is_lab_or_gym && r.room_type === 'standard') ? 'selected' : ''}>🚪 ${isEn ? 'Standard Room' : 'Aula Ordinaria'}</option>
                      <option value="lab" ${isLab ? 'selected' : ''}>🧪 ${isEn ? 'Laboratory' : 'Laboratorio'}</option>
                      <option value="gym" ${isGym ? 'selected' : ''}>🏀 ${isEn ? 'Gymnasium' : 'Palestra'}</option>
                    </select>
                  `}
                </td>
                <td style="text-align:center;">
                  ${r.is_lab_or_gym ? `
                    <span class="badge-flag-transfer" title="${isEn ? 'When cohorts use this room, campus transfer constraints apply' : 'Quando le classi usano questa stanza, si innescano i vincoli di cambio plesso'}">
                      ⚡ ${isEn ? 'Triggers Transfer' : 'Innesca Cambio'}
                    </span>
                  ` : `
                    <span style="font-size:11.5px;color:var(--text-muted);">${isEn ? 'Internal' : 'Interna'}</span>
                  `}
                </td>
                <td style="text-align:center;">
                  <div style="display:inline-flex;align-items:center;gap:3px;">
                    <input type="number" class="table-num-input" value="${r.capacity || 30}" min="1" max="150" onchange="changeRoomCapacity('${escapeJs(r.name)}', this.value)" title="${isEn ? 'Edit and press Enter to save capacity' : 'Modifica e premi invio per salvare la capienza'}">
                    <span style="font-size:11.5px;color:var(--text-muted);">${isEn ? 'seats' : 'al.'}</span>
                  </div>
                </td>
                <td>
                  ${assignedClasses.length > 0 ? `
                    <div style="display:flex;align-items:center;gap:6px;">
                      <span class="item-chip primary" title="${isEn ? 'Resident cohort here' : 'Classe residente qui'}">🎓 ${assignedClasses.join(', ')} (${assignedStud} ${isEn ? 'st.' : 'al.'})</span>
                      ${isOvercrowded ? `
                        <span class="badge badge-err" style="font-size:10px;" title="${isEn ? `Warning: ${assignedStud} students for ${r.capacity} seats!` : `Attenzione: ${assignedStud} studenti per ${r.capacity} posti a sedere!`}">${isEn ? '⚠️ Overcrowded' : '⚠️ Sovraffollamento'}</span>
                      ` : `
                        <span class="badge badge-ok" style="font-size:10px;">🟢 OK</span>
                      `}
                    </div>
                  ` : `
                    <span style="font-size:11.5px;color:var(--text-muted);font-style:italic;">${isEn ? 'No homeroom class' : 'Nessuna classe base'}</span>
                  `}
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-sec" onclick="openEditRoomModal('${escapeJs(r.name)}')" title="${isEn ? 'Edit room details' : 'Modifica dettagli stanza'}">✏️</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteRoom('${escapeJs(r.name)}')">🗑️</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function filterRoomsByPlesso(filterType) {
  activeRoomPlessoFilter = filterType;
  renderRooms();
}

async function changeRoomBuilding(roomName, newBuilding) {
  const res = await fetch('/api/rooms/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: roomName, building: newBuilding })
  });
  if (res.ok) {
    showToast(`Plesso di "${roomName}" impostato a: ${newBuilding}`);
    renderRooms();
  } else {
    alert('Errore aggiornamento plesso.');
  }
}

async function changeRoomType(roomName, newType) {
  const isLabOrGym = newType !== 'standard';
  const res = await fetch('/api/rooms/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: roomName, room_type: newType, is_lab_or_gym: isLabOrGym })
  });
  if (res.ok) {
    showToast(`Tipologia di "${roomName}" aggiornata!`);
    renderRooms();
  } else {
    alert('Errore aggiornamento tipologia stanza.');
  }
}

async function changeRoomCapacity(roomName, newCap) {
  const cap = parseInt(newCap) || 30;
  const res = await fetch('/api/rooms/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: roomName, capacity: cap })
  });
  if (res.ok) {
    showToast(`Capienza di "${roomName}" impostata a ${cap} alunni!`);
    renderRooms();
  } else {
    alert('Errore aggiornamento capienza.');
  }
}

function openEditRoomModal(roomName) {
  const room = (stateData.rooms || []).find(r => r.name === roomName);
  if (!room) return;

  const bldOptions = (stateData.buildings || ['Centrale', 'Succursale']).map(b => `
    <option value="${escapeHtml(b)}" ${room.building === b ? 'selected' : ''}>${escapeHtml(b)}</option>
  `).join('');

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">✏️ Modifica Dettagli Spazio: ${escapeHtml(roomName)}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Nome Aula / Spazio</label>
          <input type="text" id="editRoomName" class="form-input" value="${escapeHtml(room.name)}">
          <span class="form-hint">Es. "Aula 53", "INFO 1", "Palestra".</span>
        </div>
        <div class="form-group">
          <label class="form-label">Plesso / Edificio</label>
          <select id="editRoomBuilding" class="form-select">
            ${bldOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Tipologia Spazio</label>
          <select id="editRoomType" class="form-select" onchange="onEditRoomTypeChange(this.value)">
            <option value="standard" ${room.room_type === 'standard' ? 'selected' : ''}>🚪 Aula Didattica Ordinaria</option>
            <option value="lab" ${room.room_type === 'lab' ? 'selected' : ''}>🧪 Laboratorio Didattico Specializzato</option>
            <option value="gym" ${room.room_type === 'gym' ? 'selected' : ''}>🏀 Palestra / Impianto Sportivo</option>
          </select>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;">
            <input type="checkbox" id="editRoomIsLabOrGym" ${room.is_lab_or_gym ? 'checked' : ''} style="width:16px;height:16px;">
            <span>⚡ Questa stanza è un Laboratorio / Palestra (innesca vincoli di cambio plesso)</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">Capienza Massima Alunni</label>
          <input type="number" id="editRoomCapacity" class="form-input" value="${room.capacity || 30}" min="1" max="150">
        </div>
        <div class="form-group">
          <label class="form-label">Note / Dotazioni Spazio</label>
          <input type="text" id="editRoomComments" class="form-input" value="${escapeHtml(room.comments || '')}" placeholder="Es. 28 PC, Proiettore, LIM...">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="saveRoomDetails('${escapeJs(roomName)}')">💾 Salva Modifiche</button>
      </div>
    </div>
  `);
}

function onEditRoomTypeChange(val) {
  const chk = document.getElementById('editRoomIsLabOrGym');
  if (chk) {
    chk.checked = val === 'lab' || val === 'gym';
  }
}

async function saveRoomDetails(oldName) {
  const name = document.getElementById('editRoomName').value.trim();
  const building = document.getElementById('editRoomBuilding').value.trim();
  const room_type = document.getElementById('editRoomType').value;
  const is_lab_or_gym = document.getElementById('editRoomIsLabOrGym').checked;
  const capacity = parseInt(document.getElementById('editRoomCapacity').value) || 30;
  const comments = document.getElementById('editRoomComments').value.trim();

  if (!name) {
    alert('Nome aula obbligatorio.');
    return;
  }

  const res = await fetch('/api/rooms/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_name: oldName, name, building, room_type, is_lab_or_gym, capacity, comments })
  });
  if (res.ok) {
    closeModal();
    showToast(`Aula "${name}" aggiornata con successo!`);
    renderRooms();
  } else {
    alert('Errore salvataggio aula.');
  }
}

function openAddBuildingModal() {
  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">🏛️ Aggiungi Nuovo Plesso / Sede Scolastica</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Nome Plesso / Sede</label>
          <input type="text" id="newBldName" class="form-input" placeholder="es. Sede Staccata B">
        </div>
        <div class="form-group">
          <label class="form-label">Sigla / Nome Breve (1-3 lettere)</label>
          <input type="text" id="newBldCode" class="form-input" placeholder="es. B" style="max-width:100px;">
          <span class="form-hint">Usata nelle sigle di FET e nelle stampe orario sintetiche (es. C = Centrale, S = Succursale).</span>
        </div>
        <div class="form-group">
          <label class="form-label">Note / Indirizzo</label>
          <input type="text" id="newBldComments" class="form-input" placeholder="es. Via Garibaldi 12">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitAddBuilding()">💾 Crea Plesso</button>
      </div>
    </div>
  `);
}

async function submitAddBuilding() {
  const name = document.getElementById('newBldName').value.trim();
  const code = document.getElementById('newBldCode').value.trim();
  const comments = document.getElementById('newBldComments').value.trim();
  if (!name) {
    alert('Inserisci il nome del plesso.');
    return;
  }
  const res = await fetch('/api/buildings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, short_code: code || name[0].toUpperCase(), comments: comments })
  });
  if (res.ok) {
    closeModal();
    showToast(`Plesso "${name}" creato con successo!`);
    renderRooms();
  } else {
    alert('Plesso già esistente o errore nei dati.');
  }
}

function openEditBuildingModal(bldName, shortCode, comments) {
  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">🏛️ Modifica Sede / Plesso: ${escapeHtml(bldName)}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Nome Plesso</label>
          <input type="text" id="editBldName" class="form-input" value="${escapeHtml(bldName)}">
        </div>
        <div class="form-group">
          <label class="form-label">Sigla / Nome Breve (es. C, S)</label>
          <input type="text" id="editBldCode" class="form-input" value="${escapeHtml(shortCode || bldName[0])}" style="max-width:100px;">
        </div>
        <div class="form-group">
          <label class="form-label">Note / Indirizzo</label>
          <input type="text" id="editBldComments" class="form-input" value="${escapeHtml(comments || '')}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitEditBuilding('${escapeJs(bldName)}')">💾 Salva Modifiche</button>
      </div>
    </div>
  `);
}

async function submitEditBuilding(origName) {
  const newName = document.getElementById('editBldName').value.trim();
  const code = document.getElementById('editBldCode').value.trim();
  const comments = document.getElementById('editBldComments').value.trim();
  if (!newName) {
    alert('Nome plesso obbligatorio.');
    return;
  }
  const res = await fetch('/api/buildings/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      old_name: origName,
      name: newName,
      short_code: code || newName[0].toUpperCase(),
      comments: comments
    })
  });
  if (res.ok) {
    closeModal();
    showToast(`Plesso "${newName}" aggiornato!`);
    renderRooms();
  } else {
    alert('Errore aggiornamento plesso.');
  }
}

async function deleteBuilding(name) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (confirm(isEn ? `Are you sure you want to delete building "${name}"? All associated rooms and classes must be reassigned.` : `Sei sicuro di voler eliminare il plesso "${name}"? Tutte le aule e classi associate dovranno essere riassegnate.`)) {
    const res = await fetch(`/api/buildings/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(isEn ? `Building "${name}" deleted.` : `Plesso "${name}" eliminato.`, 'warn');
      renderRooms();
    } else {
      alert(isEn ? 'Cannot delete building.' : 'Impossibile eliminare il plesso.');
    }
  }
}

async function addRoom() {
  const name = document.getElementById('newRoomName').value.trim();
  const bld = document.getElementById('newRoomBuilding').value.trim();
  const rtype = document.getElementById('newRoomType').value;
  const cap = document.getElementById('newRoomCap').value.trim();
  if (!name) return;
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name,
      building: bld,
      room_type: rtype,
      is_lab_or_gym: rtype !== 'standard',
      capacity: parseInt(cap) || 30
    })
  });
  if (res.ok) {
    document.getElementById('newRoomName').value = '';
    showToast(`Spazio "${name}" aggiunto a ${bld}!`);
    renderRooms();
  } else {
    alert('Aula già presente.');
  }
}

async function deleteRoom(name) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (confirm(isEn ? `Delete room/space "${name}"?` : `Eliminare l'aula/spazio "${name}"?`)) {
    await fetch(`/api/rooms/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(isEn ? `Room "${name}" deleted.` : `Aula "${name}" eliminata.`, 'warn');
    renderRooms();
  }
}

// ============================================================================
// 8. ATTIVITÀ & CATTEDRE
// ============================================================================
let activityViewMode = 'grouped'; // 'grouped' | 'raw'
let activityExceptionFilter = 'all'; // 'all' | 'exceptions'

async function jumpToSubActivity(actId) {
  closeModal();
  activityViewMode = 'raw';
  activityExceptionFilter = 'all';
  if (currentView !== 'activities') {
    currentView = 'activities';
    document.querySelectorAll('.sidebar .nav-item').forEach(el => {
      el.classList.remove('active');
      if (el.getAttribute('onclick') && el.getAttribute('onclick').includes('activities')) {
        el.classList.add('active');
      }
    });
    document.getElementById('pageTitle').innerText = 'Attività & Cattedre';
  }

  pendingActivityFilter = null;
  await renderActivities();

  const searchInput = document.getElementById('activitySearchInput');
  if (searchInput) {
    searchInput.value = '';
    filterActivities('');
  }

  setTimeout(() => {
    const row = document.getElementById(`raw-act-${actId}`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('row-highlight-pulse');
      void row.offsetWidth;
      row.classList.add('row-highlight-pulse');
      showToast(`Navigato a Sotto-attività FET #${actId}`, 'info');
    } else {
      showToast(`Attività #${actId} non trovata`, 'warn');
    }
  }, 120);
}

function setActivityExceptionFilter(filter) {
  activityExceptionFilter = filter;
  renderActivities();
}

async function renderActivities() {
  const container = document.getElementById('mainContent');

  const [resActs, resGrouped] = await Promise.all([
    fetch('/api/activities').then(r => r.json()),
    fetch('/api/activities/grouped').then(r => r.json())
  ]);
  const cleanActs = (resActs || []).filter(a => !(a.subject || '').toLowerCase().startsWith('disposiz'));
  const cleanGrouped = (resGrouped || []).filter(g => !(g.subject || '').toLowerCase().startsWith('disposiz'));

  // Ordinamento rigoroso per Sezione / Anno (1A, 2A, 3A, 4A, 5A, 2B, 1C...)
  cleanGrouped.sort((a, b) => {
    const classComp = naturalClassCompare(a.students_display || (a.students || [])[0] || '', b.students_display || (b.students || [])[0] || '');
    if (classComp !== 0) return classComp;
    const subjComp = (a.subject || '').localeCompare(b.subject || '');
    if (subjComp !== 0) return subjComp;
    return (a.teachers_display || '').localeCompare(b.teachers_display || '');
  });

  cleanActs.sort((a, b) => {
    const classA = (a.students || []).join('+');
    const classB = (b.students || []).join('+');
    const classComp = naturalClassCompare(classA, classB);
    if (classComp !== 0) return classComp;
    const subjComp = (a.subject || '').localeCompare(b.subject || '');
    if (subjComp !== 0) return subjComp;
    return ((a.teachers || []).join('+')).localeCompare((b.teachers || []).join('+'));
  });

  stateData.activities = cleanActs;
  stateData.groupedActivities = cleanGrouped;

  // Applicazione filtro globale per materia se impostato in testata
  const globalSubjFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim().toLowerCase();
  if (globalSubjFlt) {
    cleanGrouped = cleanGrouped.filter(g => {
      const matchMain = (g.subject || '').toLowerCase() === globalSubjFlt;
      const matchCo = g.teacher_subjects && Object.values(g.teacher_subjects).some(s => s.toLowerCase() === globalSubjFlt);
      return matchMain || matchCo;
    });
    cleanActs = cleanActs.filter(a => {
      const matchMain = (a.subject || '').toLowerCase() === globalSubjFlt;
      const matchCo = a.teacher_subjects && Object.values(a.teacher_subjects).some(s => s.toLowerCase() === globalSubjFlt);
      return matchMain || matchCo;
    });
  }

  const isGrouped = activityViewMode === 'grouped';
  const totalGrouped = cleanGrouped.length;
  const exceptionsCount = cleanGrouped.filter(g => g.is_exception).length;

  let finalGrouped = cleanGrouped;
  if (activityExceptionFilter === 'exceptions') {
    finalGrouped = cleanGrouped.filter(g => g.is_exception);
  }

  let initialSearch = '';
  let activeFilterLabel = '';
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (pendingActivityFilter) {
    if (pendingActivityFilter.teacher) {
      initialSearch = pendingActivityFilter.teacher;
      activeFilterLabel = `${isEn ? 'Teacher' : 'Docente'}: ${pendingActivityFilter.teacher}`;
    } else if (pendingActivityFilter.subject) {
      initialSearch = pendingActivityFilter.subject;
      activeFilterLabel = `${isEn ? 'Subject' : 'Materia'}: ${pendingActivityFilter.subject}`;
    } else if (pendingActivityFilter.className) {
      initialSearch = pendingActivityFilter.className;
      activeFilterLabel = `${isEn ? 'Class' : 'Classe'}: ${pendingActivityFilter.className}`;
    }
    pendingActivityFilter = null;
  }

  container.innerHTML = `
    ${getGlobalFilterBannerHtml()}
    ${getNavReturnBarHtml(activeFilterLabel ? `${isEn ? 'Filter view:' : 'Filtro visualizzazione:'} <b>${escapeHtml(activeFilterLabel)}</b>` : (isEn ? 'Teaching assignments and activities.' : 'Cattedre e attività di insegnamento.'))}
    <div class="toolbar" style="gap:12px;flex-wrap:wrap;">
      <input type="text" id="activitySearchInput" class="search-input" value="${escapeHtml(initialSearch)}" placeholder="${isEn ? '🔍 Search teacher, class or subject...' : '🔍 Cerca docente, classe o materia...'}" oninput="filterActivities(this.value)">

      ${activeFilterLabel ? `
        <div id="activeFilterPill" style="display:flex;align-items:center;gap:6px;background:var(--primary-subtle);color:var(--primary);padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">
          <span>🔍 ${isEn ? 'Active filter:' : 'Filtro attivo:'} <b>${escapeHtml(activeFilterLabel)}</b></span>
          <span style="cursor:pointer;font-weight:700;margin-left:4px;" onclick="clearActivityFilter()" title="${isEn ? 'Clear filter' : 'Azzera filtro'}">✕</span>
        </div>
      ` : ''}

      <button class="btn btn-primary" onclick="openNewCattedraModal()" title="${isEn ? 'Create a new teaching assignment with teacher, class/group and block division' : 'Crea una nuova cattedra con docente, classe/gruppo e suddivisione blocchi'}">
        ➕ ${isEn ? 'New Assignment / Activity' : 'Nuova Cattedra / Attività'}
      </button>
      <button class="btn btn-sec" onclick="openAccorpamentiModal()" title="${isEn ? 'Manage multi-subject composite groupings' : 'Gestisci accorpamenti di macro-materie (es. Italiano Latino Storia e Geografia)'}">
        🔗 ${isEn ? 'Subject Groupings' : 'Accorpamenti Macro-Materie'}
      </button>
      <button class="btn btn-sec" onclick="navigate('block_rules')" title="${isEn ? 'Manage default block division rules and section tracks' : 'Gestisci regole di default suddivisione blocchi e indirizzi sezioni'}">
        📐 ${isEn ? 'Block & Section Rules' : 'Regole Blocchi & Sezioni'}
      </button>
      <button class="btn btn-sec" onclick="resetAllCattedreToDefault()" title="${isEn ? 'Reset all assignments to standard didactic default formulas' : 'Reimposta tutte le cattedre alla formula standard di default didattica (elimina le suddivisioni puntuali)'}">
        ↩️ ${isEn ? 'Reset Didactic Defaults' : 'Ripristina Default Didattici'}
      </button>

      <div class="segmented-control">
        <button class="segmented-btn ${isGrouped ? 'active' : ''}" onclick="switchActivityView('grouped')">
          👥 ${isEn ? 'Assignments View' : 'Vista Cattedre'} (${totalGrouped})
        </button>
        <button class="segmented-btn ${!isGrouped ? 'active' : ''}" onclick="switchActivityView('raw')">
          📋 ${isEn ? 'FET Detail' : 'Dettaglio FET'} (${resActs.length})
        </button>
      </div>

      ${isGrouped ? `
        <div class="segmented-control" style="background:var(--bg-card);border:1px solid var(--border);">
          <button class="segmented-btn ${activityExceptionFilter === 'all' ? 'active' : ''}" onclick="setActivityExceptionFilter('all')">
            ${isEn ? 'All' : 'Tutte'} (${totalGrouped})
          </button>
          <button class="segmented-btn ${activityExceptionFilter === 'exceptions' ? 'active' : ''}" onclick="setActivityExceptionFilter('exceptions')" title="${isEn ? 'Show only assignments with non-default block divisions' : 'Visualizza solo le cattedre con suddivisione blocchi diversa dallo standard di default'}">
            ⚡ ${isEn ? 'Exceptions Only' : 'Solo Eccezioni'} (${exceptionsCount})
          </button>
        </div>
      ` : ''}

      <div style="font-size:12px;color:var(--text-muted);margin-left:auto;">
        ${isGrouped 
          ? (isEn 
              ? `Assignments: <b>${finalGrouped.length}</b> (Total hours: <b>${finalGrouped.reduce((acc, g) => acc + g.total_hours, 0)} h</b>)`
              : `Cattedre: <b>${finalGrouped.length}</b> (Ore tot: <b>${finalGrouped.reduce((acc, g) => acc + g.total_hours, 0)} h</b>)`)
          : (isEn ? `FET Sub-activities: <b>${resActs.length}</b>` : `Sotto-attività FET: <b>${resActs.length}</b>`)}
      </div>
    </div>

    <div class="table-container">
      <table class="data-table" id="actTable">
        <thead>
          ${isGrouped ? `
            <tr>
              <th style="width:110px;">${_t('activities.th_class_group', 'Classe / Gruppo')}</th>
              <th>${_t('activities.th_subject', 'Materia / Disciplina')}</th>
              <th>${_t('activities.th_teachers', 'Docenti (Compresenze)')}</th>
              <th style="min-width:140px;">${_t('activities.th_room', 'Spazio / Aula')}</th>
              <th style="width:85px;text-align:center;">${_t('activities.th_hours_week', 'Ore/Sett.')}</th>
              <th style="width:125px;text-align:center;">${_t('activities.th_blocks', 'Suddivisione')}</th>
              <th>${_t('activities.th_sub_activities', 'Sotto-attività FET')}</th>
              <th style="width:85px;text-align:center;">${_t('activities.th_status', 'Stato')}</th>
              <th style="width:140px;text-align:right;">${_t('activities.th_actions', 'Azioni')}</th>
            </tr>
          ` : `
            <tr>
              <th style="width:75px;">ID</th>
              <th>${_t('activities.th_class_group', 'Classe / Gruppo')}</th>
              <th>${_t('activities.th_subject', 'Materia')}</th>
              <th>${_t('activities.th_teachers', 'Docenti (Compresenze)')}</th>
              <th style="min-width:130px;">${_t('activities.th_room', 'Spazio / Aula')}</th>
              <th style="width:80px;text-align:center;">${_t('activities.th_hours_week', 'Ore')}</th>
              <th style="width:80px;text-align:center;">${_t('activities.th_status', 'Stato')}</th>
              <th style="text-align:right;">${_t('activities.th_actions', 'Azioni')}</th>
            </tr>
          `}
        </thead>
        <tbody>
          ${isGrouped ? finalGrouped.map((g, idx) => {
            const hasRoom = !!g.rooms_display;
            const rLow = (g.rooms_display || '').toLowerCase();
            const isGym = rLow.includes('palestra') || rLow.includes('sport');
            const isLab = !isGym && (rLow.includes('lab') || rLow.includes('info') || rLow.includes('scienz') || rLow.includes('lingue'));
            const roomBadgeClass = isGym ? 'badge-gym' : (isLab ? 'badge-lab' : 'badge-info');
            const roomIcon = isGym ? '🏀' : (isLab ? '🧪' : '🚪');

            const teachersDisplayHtml = (g.teachers || []).map(t => {
              const tSubj = (g.teacher_subjects && g.teacher_subjects[t]) ? g.teacher_subjects[t] : '';
              const isDiff = tSubj && tSubj !== g.subject;
              return `<span>${escapeHtml(t)}${isDiff ? ` <span class="badge" style="background:rgba(245,158,11,0.18);color:#92400e;font-size:11px;font-weight:600;padding:1px 5px;" title="${isEn ? 'Individual subject in co-teaching' : 'Materia specifica in compresenza'}">📖 ${escapeHtml(tSubj)}</span>` : ''}</span>`;
            }).join(' + ') || escapeHtml(g.teachers_display);

            return `
              <tr class="${g.is_exception ? 'has-exception-row' : ''}">
                <td><span class="badge badge-info" style="font-size:12px;font-weight:700;">${escapeHtml(g.students_display)}</span></td>
                <td><b style="color:var(--text-main);cursor:pointer;" onclick="openEditCattedraModal('${escapeJs(g.id)}')" title="${isEn ? 'Click to edit assignment' : 'Clicca per modificare la cattedra'}">${escapeHtml(g.subject)}</b></td>
                <td>${teachersDisplayHtml}</td>
                <td>
                  ${hasRoom ? `
                    <span class="badge ${roomBadgeClass}" title="${isEn ? 'Assigned space' : 'Spazio assegnato'}">
                      ${roomIcon} ${escapeHtml(g.rooms_display)}
                    </span>
                  ` : `<span style="color:var(--text-muted);font-size:12px;" title="${isEn ? 'Uses class resident homeroom' : 'Utilizza l\'aula base della classe'}">🏠 ${isEn ? 'Homeroom' : 'Aula Base'}</span>`}
                </td>
                <td style="text-align:center;"><b style="font-size:13px;color:var(--primary);">${g.total_hours} h</b></td>
                <td style="text-align:center;">
                  ${g.is_exception ? `
                    <span class="block-badge block-exception" title="${isEn ? `EXCEPTION: Differs from standard default (${escapeHtml(g.default_blocks || '')})` : `ECCEZIONE: Differisce dalla formula standard di default (${escapeHtml(g.default_blocks || '')})`}">
                      ⚡ ${escapeHtml(g.blocks)} <span class="exc-tag">Exc</span>
                    </span>
                  ` : `
                    <span class="block-badge block-default" title="${isEn ? `Standard default division for ${escapeHtml(g.subject)} (${escapeHtml(g.percorso || '')} ${escapeHtml(g.period || '')})` : `Suddivisione standard di default per ${escapeHtml(g.subject)} (${escapeHtml(g.percorso || '')} ${escapeHtml(g.period || '')})`}">
                      ${escapeHtml(g.blocks)}
                    </span>
                  `}
                  ${g.is_feasible === false ? `
                    <div style="margin-top:3px;">
                      <span class="badge badge-err" style="font-size:10.5px;cursor:pointer;" onclick="openEditBlocksModal('${g.sub_activity_ids.join(',')}', '${escapeJs(g.blocks)}', ${g.total_hours}, '${escapeJs(g.teachers_display)} - ${escapeJs(g.subject)} (${escapeJs(g.students_display)})', '${escapeJs(g.default_blocks || '')}', '${escapeJs(g.subject)}', '${escapeJs(g.students_display)}', '${escapeJs(g.percorso || '')}', '${escapeJs(g.period || '')}', false, '${escapeJs((g.feasibility_warnings || []).join('\n'))}', '${escapeJs(g.suggested_blocks || '')}')" title="${escapeHtml((g.feasibility_warnings || []).join('\n'))}">
                        ⚠️ ${isEn ? 'Incompatible' : 'Incompatibile'} (${escapeHtml(g.suggested_blocks || '')})
                      </span>
                    </div>
                  ` : ''}
                </td>
                <td>
                  <span class="sub-acts-tag">
                    ${(g.sub_activity_ids || []).map(id => `<a href="javascript:void(0)" onclick="jumpToSubActivity('${id}')" class="sub-act-pill" title="${isEn ? 'Jump to FET record #' + id : 'Salta al record FET #' + id}">#${id}</a>`).join('')}
                  </span>
                </td>
                <td style="text-align:center;">
                  <span class="badge ${g.active ? 'badge-ok' : 'badge-err'}">${g.active ? (isEn ? 'Active' : 'Attiva') : (isEn ? 'Inactive' : 'Disattiva')}</span>
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-primary" onclick="openEditCattedraModal('${escapeJs(g.id)}')" title="${isEn ? 'Edit assignment: teacher, class, subject, hours, blocks, room' : 'Modifica tutti i dati della cattedra: docente, compresenze, classe, materia, ore, blocchi, aula'}">✏️ ${isEn ? 'Edit' : 'Modifica'}</button>
                  <button class="btn btn-sm ${g.is_feasible === false ? 'btn-danger' : 'btn-sec'}" onclick="openEditBlocksModal('${g.sub_activity_ids.join(',')}', '${escapeJs(g.blocks)}', ${g.total_hours}, '${escapeJs(g.teachers_display)} - ${escapeJs(g.subject)} (${escapeJs(g.students_display)})', '${escapeJs(g.default_blocks || '')}', '${escapeJs(g.subject)}', '${escapeJs(g.students_display)}', '${escapeJs(g.percorso || '')}', '${escapeJs(g.period || '')}', ${g.is_feasible === false ? 'false' : 'true'}, '${escapeJs((g.feasibility_warnings || []).join('\n'))}', '${escapeJs(g.suggested_blocks || '')}')" title="${isEn ? 'Adjust block division (e.g. 2+1 or 1+1+1)' : 'Rimodula la suddivisione blocchi (es. 2+1 o 1+1+1)'}">⏱️ ${isEn ? 'Blocks' : 'Blocchi'}</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteCattedra('${g.sub_activity_ids.join(',')}', '${escapeJs(g.teachers_display)} - ${escapeJs(g.subject)} (${escapeJs(g.students_display)})')" title="${isEn ? 'Delete assignment' : 'Elimina l\'intera cattedra'}">🗑️</button>
                </td>
              </tr>
            `;
          }).join('') : resActs.map(a => {
            const rName = a.room || '';
            const rLow = rName.toLowerCase();
            const isGym = rLow.includes('palestra');
            const isLab = !isGym && (rLow.includes('lab') || rLow.includes('info'));
            return `
              <tr id="raw-act-${a.id}">
                <td style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-sub);">
                  <span class="sub-act-tag-static" title="${isEn ? 'Unique FET record ID #' + a.id : 'ID univoco record FET #' + a.id}">#${a.id}</span>
                </td>
                <td><b>${escapeHtml((a.students || []).join('+'))}</b></td>
                <td><b style="color:var(--text-main);cursor:pointer;" onclick="openEditSingleActivityModal('${a.id}')" title="${isEn ? 'Click to edit activity' : 'Clicca per modificare l\'attività'}">${escapeHtml(a.subject || '')}</b></td>
                <td>${escapeHtml((a.teachers || []).join(' + ') || '-')}</td>
                <td>
                  ${rName ? `
                    <span class="badge ${isGym ? 'badge-gym' : (isLab ? 'badge-lab' : 'badge-info')}">
                      ${isGym ? '🏀' : (isLab ? '🧪' : '🚪')} ${escapeHtml(rName)}
                    </span>
                  ` : '<span style="color:var(--text-muted);font-size:11px;">-</span>'}
                </td>
                <td style="text-align:center;"><b>${a.duration || 1} h</b></td>
                <td style="text-align:center;">
                  <span class="badge ${a.active ? 'badge-ok' : 'badge-err'}">${a.active ? (isEn ? 'Active' : 'Attiva') : (isEn ? 'Inactive' : 'Disattiva')}</span>
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-primary" onclick="openEditSingleActivityModal('${a.id}')" title="${isEn ? 'Edit this single FET activity' : 'Modifica questa singola attività FET'}">✏️ ${isEn ? 'Edit' : 'Modifica'}</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteActivity('${a.id}')" title="${isEn ? 'Delete activity' : 'Elimina attività'}">🗑️</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (initialSearch) {
    filterActivities(initialSearch);
  }
}

async function openAccorpamentiModal() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const res = await fetch('/api/accorpamenti/candidates');
  const data = await res.json();
  const rules = data.rules || [];
  const candidates = data.candidates || [];

  // Ordina per Docente (alfabetico) e secondariamente per Classe (naturale)
  candidates.sort((a, b) => {
    const tA = (a.teacher || '').trim();
    const tB = (b.teacher || '').trim();
    const cmp = tA.localeCompare(tB, 'it', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return naturalClassCompare(a.class_name, b.class_name);
  });

  showModal(`
    <div class="modal-dialog" style="max-width:880px;">
      <div class="modal-header">
        <div class="modal-title">🔗 ${isEn ? 'Macro-Subject Groupings (e.g. Italian, Latin, History & Geography)' : 'Gestione Accorpamenti Macro-Materie (es. Italiano Latino Storia e Geografia)'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="info-banner" style="margin-top:0;">
          ${isEn
            ? '💡 <b>Didactic Optimization and FET Solver:</b><br>When the same teacher teaches related subjects to the same class (e.g. <i>Italian</i>, <i>Latin</i>, and <i>History & Geography</i>), grouping into a <b>composite macro-subject</b> (7 or 10 total hours) enables balanced block divisions (e.g. <code>2+2+2+1</code> or <code>2+2+2+2+2</code>), preventing FET from fragmenting lessons or clustering too many hours on the same day.<br>The operation is <b>100% reversible</b>: ungrouping restores original atomic activities.'
            : '💡 <b>Ottimizzazione Didattica e Solutore FET:</b><br>Quando lo stesso docente insegna più materie affini sulla stessa classe (ad es. <i>Italiano</i>, <i>Latino</i> e <i>Storia e Geografia</i>), l\'accorpamento in una <b>macro-materia composita</b> (7 o 10 ore totali) permette di definire una suddivisione a blocchi equilibrata (es. <code>2+2+2+1</code> o <code>2+2+2+2+2</code>) impedendo a FET di spezzettare l\'orario o concentrare troppe ore nello stesso giorno.<br>L\'operazione è <b>reversibile al 100%</b>: disaccorpando, le attività atomiche originali vengono ripristinate integralmente.'}
        </div>

        <div style="margin-bottom:14px;">
          <b style="font-size:13px;color:var(--text-main);">${isEn ? '📋 Recognized Macro-Subject Rules in the System:' : '📋 Regole di Macro-Materia Riconosciute nel Sistema:'}</b>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
            ${rules.map(r => `
              <span class="item-chip primary" style="font-size:11.5px;padding:4px 8px;">
                ⚡ <b>${escapeHtml(r.name)}</b>: ${r.components.map(c => escapeHtml(c)).join(' + ')}
              </span>
            `).join('')}
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
          <b style="font-size:13px;color:var(--text-main);">
            ${isEn ? `🎯 Merged Assignments & Identified Candidates (${candidates.length} Assignments in Project):` : `🎯 Cattedre Accorpate & Candidati Individuati (${candidates.length} Cattedre nel Progetto):`}
          </b>
          <input type="text" class="search-input" placeholder="${isEn ? '🔍 Search by teacher or class (e.g. 1C, Baston)...' : '🔍 Cerca per docente o classe (es. 1C, Baston)...'}" oninput="filterAccorpamentiList(this.value)" style="width:280px;">
        </div>

        ${candidates.length === 0 ? `
          <div style="background:#f8fafc;border:1px dashed var(--border);border-radius:var(--radius-sm);padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">
            ${isEn ? 'No candidate assignments found for grouping.' : 'Nessuna cattedra candidata ad accorpamento trovata.'}
          </div>
        ` : `
          <div id="accorpamentiCardsContainer" style="display:flex;flex-direction:column;gap:10px;max-height:420px;overflow-y:auto;padding-right:4px;">
            ${candidates.map((c, idx) => {
              const isMerged = !!c.is_merged;
              const subIds = (c.sub_activity_ids || []).join(',');
              const blocksFormula = c.blocks || `${c.total_hours}h`;

              return `
              <div class="macro-card accorpamento-item" data-search="${escapeHtml((c.teacher + ' ' + c.class_name + ' ' + c.rule_name).toLowerCase())}">
                <div>
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <b style="font-size:14px;color:var(--primary);">👨‍🏫 ${escapeHtml(c.teacher)}</b>
                    <span class="item-chip primary" style="font-weight:700;">🎓 ${isEn ? 'Class' : 'Classe'} ${escapeHtml(c.class_name)}</span>
                    <span class="badge ${isMerged ? 'badge-ok' : 'badge-warn'}">
                      ${isMerged ? (isEn ? '🟢 Active Macro-Subject' : '🟢 Macro-Materia Attiva') : (isEn ? '⚡ Candidate for Grouping' : '⚡ Candidata da Accorpare')}
                    </span>
                  </div>
                  <div style="font-size:12.5px;color:var(--text-main);font-weight:600;">
                    📚 ${escapeHtml(c.rule_name)} — <span style="color:var(--primary);">${c.total_hours} ${isEn ? 'weekly hours' : 'ore settimanali'}</span>
                  </div>
                  <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;display:flex;align-items:center;gap:8px;">
                    <span>${isEn ? 'FET Block Division:' : 'Suddivisione Blocchi FET:'}</span>
                    <span class="block-badge">${escapeHtml(blocksFormula)}</span>
                    ${c.components && c.components.length > 0 && c.components[0].hours > 0 ? `
                      <span>(${isEn ? 'Components:' : 'Componenti:'} ${c.components.map(comp => `${escapeHtml(comp.subject)} ${comp.hours}h`).join(' + ')})</span>
                    ` : ''}
                  </div>
                </div>

                <div style="display:flex;gap:6px;align-items:center;">
                  ${isMerged ? `
                    <button class="btn btn-sm btn-sec" onclick="openEditBlocksModal('${subIds}', '${escapeJs(blocksFormula)}', ${c.total_hours}, '${escapeJs(c.teacher)} - ${escapeJs(c.rule_name)} (${escapeJs(c.class_name)})')" title="${isEn ? 'Edit block division formula for this macro-subject' : 'Modifica la formula di scomposizione blocchi orari per questa macro-materia'}">
                      ⏱️ ${isEn ? 'Blocks' : 'Blocchi'}
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="revertAccorpamento('${escapeJs(c.teacher)}', '${escapeJs(c.class_name)}', '${escapeJs(c.rule_id)}')" title="${isEn ? 'Ungroup and restore original atomic activities' : 'Disaccorpa e ripristina le singole attività atomiche'}">
                      ↩️ ${isEn ? 'Ungroup' : 'Disaccorpa'}
                    </button>
                  ` : `
                    <button class="btn btn-sm btn-primary" onclick="applyAccorpamento('${escapeJs(c.teacher)}', '${escapeJs(c.class_name)}', '${escapeJs(c.rule_id)}')">
                      ⚡ ${isEn ? 'Group into Macro-Subject' : 'Accorpa in Macro-Materia'}
                    </button>
                  `}
                </div>
              </div>
            `;
            }).join('')}
          </div>
        `}
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.close">${_t('common.close', 'Chiudi')}</button>
      </div>
    </div>
  `);
}

function filterAccorpamentiList(q) {
  const query = q.toLowerCase();
  document.querySelectorAll('#accorpamentiCardsContainer .accorpamento-item').forEach(el => {
    const s = el.getAttribute('data-search') || '';
    el.style.display = s.includes(query) ? '' : 'none';
  });
}

let currentAccorpamentiFilterMode = 'all';

function setAccorpamentiFilter(mode) {
  currentAccorpamentiFilterMode = mode;
  document.querySelectorAll('.accorpamenti-filter-btn').forEach(btn => btn.classList.remove('active'));
  if (mode === 'all') document.getElementById('btnAccFilterAll')?.classList.add('active');
  if (mode === 'active') document.getElementById('btnAccFilterActive')?.classList.add('active');
  if (mode === 'pending') document.getElementById('btnAccFilterPending')?.classList.add('active');
  applyAccorpamentiPageFilters();
}

function filterAccorpamentiPageView(q) {
  applyAccorpamentiPageFilters();
}

function applyAccorpamentiPageFilters() {
  const query = (document.getElementById('accorpamentiPageSearch')?.value || '').toLowerCase();
  document.querySelectorAll('#accorpamentiTable tbody tr.accorpamento-row').forEach(row => {
    const s = row.getAttribute('data-search') || '';
    const isAct = row.classList.contains('status-active');
    const matchesSearch = s.includes(query);
    let matchesMode = true;
    if (currentAccorpamentiFilterMode === 'active') matchesMode = isAct;
    if (currentAccorpamentiFilterMode === 'pending') matchesMode = !isAct;
    row.style.display = (matchesSearch && matchesMode) ? '' : 'none';
  });
}

async function renderAccorpamenti() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const container = document.getElementById('mainContent');
  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">${isEn ? 'Loading subject groupings...' : 'Caricamento accorpamenti in corso...'}</div>`;

  try {
    const res = await fetch('/api/accorpamenti/candidates');
    const data = await res.json();
    const rules = data.rules || [];
    let candidates = data.candidates || [];

    // Ordina per Docente (alfabetico) e secondariamente per Classe (ordinamento naturale anno poi sezione)
    candidates.sort((a, b) => {
      const tA = (a.teacher || '').trim();
      const tB = (b.teacher || '').trim();
      const cmp = tA.localeCompare(tB, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return naturalClassCompare(a.class_name, b.class_name);
    });

    const activeCount = candidates.filter(c => c.is_merged).length;
    const pendingCount = candidates.filter(c => !c.is_merged).length;

    // Filtro globale per materia se attivo
    const globalSubjFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim().toLowerCase();
    if (globalSubjFlt) {
      candidates = candidates.filter(c => {
        const mSubjs = (c.subjects || []).map(s => s.toLowerCase());
        const mTarget = (c.target_macro_subject || '').toLowerCase();
        return mSubjs.some(s => s.includes(globalSubjFlt)) || mTarget.includes(globalSubjFlt);
      });
    }

    container.innerHTML = `
      ${getGlobalFilterBannerHtml()}
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 style="font-size:18px;font-weight:700;color:var(--text-main);margin:0 0 6px 0;display:flex;align-items:center;gap:8px;">
              🔗 ${isEn ? 'Macro-Subject Groupings Management' : 'Gestione Accorpamenti Macro-Materie'}
              <span class="badge badge-ok">${activeCount} ${isEn ? 'Active' : 'Attive'}</span>
              ${pendingCount > 0 ? `<span class="badge badge-warn">${pendingCount} ${isEn ? 'To Group' : 'Da Accorpare'}</span>` : ''}
            </h2>
            <div style="font-size:13px;color:var(--text-muted);max-width:850px;line-height:1.5;">
              ${isEn
                ? 'When the same teacher teaches multiple complementary subjects to the same class (e.g. <i>Italian</i>, <i>Latin</i>, and <i>History & Geography</i>), grouping them into an <b>aggregated macro-subject</b> (7 or 10 total hours) enables balanced block divisions (e.g. <code>2+2+2+1</code> or <code>2+1+2+1+2+1+1</code>), preventing fragmentation or daily overload for students.'
                : 'Quando lo stesso docente insegna più materie complementari sulla stessa classe (es. <i>Italiano</i>, <i>Latino</i> e <i>Storia e Geografia</i>), l\'accorpamento in una <b>macro-materia aggregata</b> (7 o 10 ore complessive) permette al motore FET di suddividere il carico didattico con formule bilanciate (es. <code>2+2+2+1</code> o <code>2+1+2+1+2+1+1</code>), evitando frammentazioni in singole ore sparse o sovraccarichi giornalieri per gli studenti.'}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openAddAccorpamentoRuleModal()" title="${isEn ? 'Define a new rule to automatically detect macro-subjects' : 'Definisci una nuova regola per riconoscere automaticamente macro-materie'}">
              ➕ ${isEn ? 'New Rule' : 'Nuova Regola'}
            </button>
            <button class="btn btn-sec" onclick="openManualAccorpamentoModal()" title="${isEn ? 'Manually merge two or more subjects of the same teacher in a class' : 'Unisci manualmente due o più materie dello stesso docente in una classe'}">
              ⚡ ${isEn ? 'Group Manually' : 'Accorpa Manualmente'}
            </button>
            <button class="btn btn-sec" onclick="navigate('activities')" title="${isEn ? 'Back to all Activities and Assignments' : 'Torna a tutte le Attività e Cattedre'}">
              📝 ${isEn ? 'Go to All Assignments' : 'Vai a Tutte le Cattedre'}
            </button>
          </div>
        </div>

        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:gap;gap:8px;">
            <b style="font-size:12.5px;color:var(--text-main);text-transform:uppercase;letter-spacing:0.5px;">${isEn ? `📋 Recognized Macro-Subject Rules in System (${rules.length}):` : `📋 Regole Macro-Materia Riconosciute nel Sistema (${rules.length}):`}</b>
            <button class="btn btn-sm btn-sec" onclick="openAddAccorpamentoRuleModal()">+ ${isEn ? 'Add Rule' : 'Aggiungi Regola'}</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">
            ${rules.map(r => `
              <span class="item-chip primary" style="font-size:12px;padding:5px 10px;display:inline-flex;align-items:center;gap:6px;">
                <span>⚡ <b>${escapeHtml(r.name)}</b>: <span style="color:var(--text-muted);">${r.components.map(c => escapeHtml(c)).join(' + ')}</span></span>
                <span style="cursor:pointer;color:var(--danger);font-weight:bold;margin-left:4px;font-size:14px;line-height:1;" onclick="deleteAccorpamentoRule('${escapeJs(r.id)}', '${escapeJs(r.name)}')" title="${isEn ? 'Delete this rule' : 'Elimina questa regola'}">×</span>
              </span>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Barra Filtri e Ricerca -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="accorpamentiPageSearch" class="search-input" placeholder="${isEn ? '🔍 Search teacher, class or subject...' : '🔍 Cerca docente, classe o materia...'}" oninput="filterAccorpamentiPageView(this.value)" style="width:320px;">
          <button class="btn btn-sm btn-sec accorpamenti-filter-btn active" id="btnAccFilterAll" onclick="setAccorpamentiFilter('all')">${isEn ? 'All' : 'Tutte'} (${candidates.length})</button>
          <button class="btn btn-sm btn-sec accorpamenti-filter-btn" id="btnAccFilterActive" onclick="setAccorpamentiFilter('active')">🟢 ${isEn ? 'Active Only' : 'Solo Attive'} (${activeCount})</button>
          ${pendingCount > 0 ? `
            <button class="btn btn-sm btn-sec accorpamenti-filter-btn" id="btnAccFilterPending" onclick="setAccorpamentiFilter('pending')">⚡ ${isEn ? 'To Group' : 'Da Accorpare'} (${pendingCount})</button>
          ` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-muted);">
          ${isEn ? 'All modifications and ungroupings are <b>immediate and 100% reversible</b>.' : 'Tutte le modifiche e disaccorpamenti sono <b>immediati e reversibili al 100%</b>.'}
        </div>
      </div>

      <!-- Tabella Macro-Materie -->
      <div class="table-container">
        <table class="data-table" id="accorpamentiTable">
          <thead>
            <tr>
              <th style="width:40px;">#</th>
              <th style="min-width:180px;">👨‍🏫 ${isEn ? 'Lead Teacher' : 'Docente Titolare'}</th>
              <th style="width:110px;">🎓 ${isEn ? 'Class' : 'Classe'}</th>
              <th style="min-width:240px;">📚 ${isEn ? 'Macro-Subject / Composite Subject' : 'Macro-Materia / Materia Composta'}</th>
              <th style="width:100px;text-align:center;">⏱️ ${isEn ? 'Total Hrs' : 'Ore Tot.'}</th>
              <th style="width:170px;">🧩 ${isEn ? 'FET Time Blocks' : 'Blocchi Orari FET'}</th>
              <th style="width:150px;text-align:center;">${isEn ? 'Status' : 'Stato'}</th>
              <th style="text-align:right;width:170px;">${isEn ? 'Actions' : 'Azioni'}</th>
            </tr>
          </thead>
          <tbody>
            ${candidates.map((c, idx) => {
              const isMerged = !!c.is_merged;
              const subIds = (c.sub_activity_ids || []).join(',');
              const blocksFormula = c.blocks || `${c.total_hours}h`;
              const statusClass = isMerged ? 'status-active' : 'status-pending';

              return `
                <tr class="accorpamento-row ${statusClass}" data-search="${escapeHtml((c.teacher + ' ' + c.class_name + ' ' + c.rule_name).toLowerCase())}">
                  <td style="color:var(--text-sub);">${idx + 1}</td>
                  <td>
                    <b style="color:var(--text-main);font-size:13.5px;cursor:pointer;" onclick="navigate('activities');setTimeout(() => filterActivities('${escapeJs(c.teacher)}'), 100)" title="${isEn ? 'Filter assignments for ' + escapeHtml(c.teacher) : 'Filtra tutte le cattedre di ' + escapeHtml(c.teacher)}">
                      👨‍🏫 ${escapeHtml(c.teacher)}
                    </b>
                  </td>
                  <td>
                    <span class="item-chip primary" style="font-weight:700;cursor:pointer;" onclick="navigate('activities');setTimeout(() => filterActivities('${escapeJs(c.class_name)}'), 100)" title="${isEn ? 'View all assignments for class ' + escapeHtml(c.class_name) : 'Vedi tutte le cattedre della classe ' + escapeHtml(c.class_name)}">
                      🎓 ${escapeHtml(c.class_name)}
                    </span>
                  </td>
                  <td>
                    <div style="font-weight:700;color:var(--primary);font-size:13.5px;">
                      ${escapeHtml(c.rule_name)}
                    </div>
                    ${c.components && c.components.length > 0 && c.components[0].hours > 0 ? `
                      <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                        ${isEn ? 'Components:' : 'Componenti:'} ${c.components.map(comp => `${escapeHtml(comp.subject)} (${comp.hours}h)`).join(' + ')}
                      </div>
                    ` : ''}
                  </td>
                  <td style="text-align:center;">
                    <b style="font-size:14px;color:var(--primary);">${c.total_hours} h</b>
                  </td>
                  <td>
                    <span class="block-badge" style="font-size:12px;cursor:pointer;" onclick="openEditBlocksModal('${subIds}', '${escapeJs(blocksFormula)}', ${c.total_hours}, '${escapeJs(c.teacher)} - ${escapeJs(c.rule_name)} (${escapeJs(c.class_name)})')" title="${isEn ? 'Click to edit block decomposition' : 'Clicca per modificare la scomposizione blocchi'}">
                      ${escapeHtml(blocksFormula)}
                    </span>
                  </td>
                  <td style="text-align:center;">
                    <span class="badge ${isMerged ? 'badge-ok' : 'badge-warn'}">
                      ${isMerged ? (isEn ? '🟢 Active' : '🟢 Attiva') : (isEn ? '⚡ Candidate' : '⚡ Candidata')}
                    </span>
                  </td>
                  <td style="text-align:right;white-space:nowrap;">
                    ${isMerged ? `
                      <button class="btn btn-sm btn-sec" onclick="openEditBlocksModal('${subIds}', '${escapeJs(blocksFormula)}', ${c.total_hours}, '${escapeJs(c.teacher)} - ${escapeJs(c.rule_name)} (${escapeJs(c.class_name)})')" title="${isEn ? 'Edit timetable blocks for FET' : 'Modifica la scomposizione in blocchi orari per FET'}">
                        ⏱️ ${isEn ? 'Blocks' : 'Blocchi'}
                      </button>
                      <button class="btn btn-sm btn-danger" onclick="revertAccorpamento('${escapeJs(c.teacher)}', '${escapeJs(c.class_name)}', '${escapeJs(c.rule_id)}')" title="${isEn ? 'Ungroup and restore original atomic activities' : 'Disaccorpa e ripristina le singole attività atomiche'}">
                        ↩️ ${isEn ? 'Ungroup' : 'Disaccorpa'}
                      </button>
                    ` : `
                      <button class="btn btn-sm btn-primary" onclick="applyAccorpamento('${escapeJs(c.teacher)}', '${escapeJs(c.class_name)}', '${escapeJs(c.rule_id)}')">
                        ⚡ ${isEn ? 'Group' : 'Accorpa'}
                      </button>
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Errore caricamento accorpamenti:', err);
    container.innerHTML = `<div class="card" style="color:var(--danger);padding:24px;">Errore durante il caricamento degli accorpamenti: ${escapeHtml(err.message)}</div>`;
  }
}

async function applyAccorpamento(teacher, className, ruleId) {
  const res = await fetch('/api/accorpamenti/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacher: teacher, class_name: className, rule_id: ruleId })
  });
  if (res.ok) {
    showToast(`Accorpamento applicato a ${teacher} (${className})!`);
    if (currentView === 'accorpamenti') {
      renderAccorpamenti();
    } else {
      openAccorpamentiModal();
    }
    if (stateData.activities && stateData.activities.length) {
      renderActivities();
    }
  } else {
    alert('Errore durante l\'applicazione dell\'accorpamento.');
  }
}

async function revertAccorpamento(teacher, className, ruleId) {
  const res = await fetch('/api/accorpamenti/revert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacher: teacher, class_name: className, rule_id: ruleId })
  });
  if (res.ok) {
    showToast(`Attività singole ripristinate per ${teacher} (${className})!`);
    if (currentView === 'accorpamenti') {
      renderAccorpamenti();
    } else {
      openAccorpamentiModal();
    }
    if (stateData.activities && stateData.activities.length) {
      renderActivities();
    }
  } else {
    alert('Errore durante il disaccorpamento.');
  }
}

// --- MODALI GESTIONE REGOLE ACCORPAMENTI & ACCORPAMENTO MANUALE ---
async function openAddAccorpamentoRuleModal() {
  const subjects = stateData.subjects && stateData.subjects.length ? stateData.subjects : await fetch('/api/subjects').then(r => r.json());
  stateData.subjects = subjects;

  showModal(`
    <div class="modal-dialog" style="max-width:640px;">
      <div class="modal-header">
        <div class="modal-title">➕ Nuova Regola di Accorpamento Macro-Materia</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="info-banner" style="margin-top:0;">
          💡 <b>Come funziona una Regola di Accorpamento:</b><br>
          Definisci il nome della <b>Macro-Materia</b> risultante (es. <i>Filosofia e Storia</i> o <i>Matematica e Fisica</i>) e seleziona le materie componenti.<br>
          Il motore cercherà automaticamente in tutto l'istituto ogni combinazione in cui lo <b>stesso docente</b> insegna tutte queste materie alla <b>stessa classe</b>, proponendole come candidate da accorpare in un solo clic!
        </div>

        <div class="form-group">
          <label class="form-label">Nome Macro-Materia Risultante</label>
          <input type="text" id="newRuleName" class="form-input" placeholder="es. Filosofia e Storia, Matematica e Fisica, Italiano e Latino...">
        </div>

        <div class="form-group">
          <label class="form-label">Materie Componenti da Aggregare (seleziona almeno 2)</label>
          <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;background:#f8fafc;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            ${subjects.map(s => `
              <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;padding:3px 6px;border-radius:4px;background:#fff;border:1px solid #e2e8f0;">
                <input type="checkbox" name="ruleSubjCheck" value="${escapeHtml(s.name)}" onchange="updateNewRuleNameSuggestion()">
                <span>${escapeHtml(s.name)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitAddAccorpamentoRule()">💾 Salva Regola</button>
      </div>
    </div>
  `);
}

function updateNewRuleNameSuggestion() {
  const nameInp = document.getElementById('newRuleName');
  if (nameInp && (!nameInp.dataset.manuallyEdited || nameInp.dataset.manuallyEdited === '0')) {
    const checked = Array.from(document.querySelectorAll('input[name="ruleSubjCheck"]:checked')).map(c => c.value);
    if (checked.length > 0) {
      nameInp.value = checked.join(' e ');
    }
  }
}

async function submitAddAccorpamentoRule() {
  const name = document.getElementById('newRuleName')?.value.trim();
  const checked = Array.from(document.querySelectorAll('input[name="ruleSubjCheck"]:checked')).map(c => c.value);

  if (!name) {
    alert('Inserisci il nome della macro-materia.');
    return;
  }
  if (checked.length < 2) {
    alert('Seleziona almeno 2 materie componenti da accorpare.');
    return;
  }

  showToast('Salvataggio regola in corso...');
  const res = await fetch('/api/accorpamenti/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, components: checked })
  });

  if (res.ok) {
    closeModal();
    showToast(`Regola "${name}" aggiunta! Ricerca candidati aggiornata.`);
    if (currentView === 'accorpamenti') renderAccorpamenti();
    else if (currentView === 'activities') renderActivities();
  } else {
    const err = await res.json().catch(() => ({ error: 'Errore durante il salvataggio' }));
    alert(`Errore: ${err.error || 'Impossibile salvare la regola'}`);
  }
}

async function deleteAccorpamentoRule(ruleId, ruleName) {
  if (confirm(`Eliminare la regola di accorpamento "${ruleName}"?`)) {
    const res = await fetch(`/api/accorpamenti/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(`Regola "${ruleName}" eliminata.`, 'warn');
      if (currentView === 'accorpamenti') renderAccorpamenti();
    } else {
      alert('Impossibile eliminare la regola.');
    }
  }
}

async function openManualAccorpamentoModal() {
  const [teachers, classes, acts] = await Promise.all([
    fetch('/api/teachers').then(r => r.json()),
    fetch('/api/classes').then(r => r.json()),
    fetch('/api/activities').then(r => r.json())
  ]);
  stateData.teachers = teachers;
  stateData.classes = classes;
  stateData.activities = acts;

  classes.sort((a, b) => naturalClassCompare(a.name, b.name));

  showModal(`
    <div class="modal-dialog" style="max-width:680px;">
      <div class="modal-header">
        <div class="modal-title">⚡ Crea Accorpamento Manuale Diretto</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">
          Seleziona un docente e una classe per vedere le cattedre attive e unirle immediatamente in una macro-materia.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Docente Titolare</label>
            <select id="manAccTeacher" class="form-select" onchange="onManualAccorpamentoFilterChange()">
              <option value="">-- Seleziona Docente --</option>
              ${teachers.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Classe / Gruppo Destinatario</label>
            <select id="manAccClass" class="form-select" onchange="onManualAccorpamentoFilterChange()">
              <option value="">-- Seleziona Classe --</option>
              ${classes.map(c => `<option value="${escapeHtml(c.name)}">Classe ${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-top:6px;">
          <label class="form-label">Attività Singole Disponibili da Unire</label>
          <div id="manAccActivitiesContainer" style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;max-height:180px;overflow-y:auto;background:#f8fafc;min-height:70px;">
            <span style="color:var(--text-muted);font-size:12px;">Seleziona docente e classe sopra per visualizzare le attività.</span>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-top:6px;">
          <div class="form-group">
            <label class="form-label">Nome Macro-Materia Risultante</label>
            <input type="text" id="manAccMacroName" class="form-input" placeholder="es. Italiano Latino Storia e Geografia">
          </div>
          <div class="form-group">
            <label class="form-label">Suddivisione Blocchi FET</label>
            <input type="text" id="manAccBlocks" class="form-input" placeholder="es. 2+2+1 o 2+2+2+1">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitManualAccorpamento()">⚡ Unisci in Macro-Materia</button>
      </div>
    </div>
  `);
}

function onManualAccorpamentoFilterChange() {
  const teacher = document.getElementById('manAccTeacher')?.value.trim();
  const cls = document.getElementById('manAccClass')?.value.trim();
  const cont = document.getElementById('manAccActivitiesContainer');
  if (!cont) return;

  if (!teacher || !cls) {
    cont.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Seleziona docente e classe sopra per visualizzare le attività.</span>';
    return;
  }

  const acts = (stateData.activities || []).filter(a => {
    if (!a.active) return false;
    const hasT = (a.teachers || []).includes(teacher);
    const hasC = (a.students || []).includes(cls);
    return hasT && hasC;
  });

  if (!acts.length) {
    cont.innerHTML = `<span style="color:var(--danger);font-size:12px;">Nessuna attività attiva trovata per ${escapeHtml(teacher)} nella classe ${escapeHtml(cls)}.</span>`;
    return;
  }

  cont.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${acts.map(a => `
        <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font-size:12.5px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" name="manAccActCheck" value="${a.id}" data-subject="${escapeHtml(a.subject || '')}" data-hours="${a.duration || 1}" onchange="updateManualAccorpamentoFields()">
            <b>${escapeHtml(a.subject || 'Senza materia')}</b>
            <span style="color:var(--text-muted);font-size:11px;">(#${a.id})</span>
          </div>
          <span class="badge badge-info">${a.duration || 1} h</span>
        </label>
      `).join('')}
    </div>
  `;
}

function updateManualAccorpamentoFields() {
  const checked = Array.from(document.querySelectorAll('input[name="manAccActCheck"]:checked'));
  const subjects = Array.from(new Set(checked.map(c => c.getAttribute('data-subject')).filter(Boolean)));
  const totalH = checked.reduce((acc, c) => acc + (parseInt(c.getAttribute('data-hours'), 10) || 1), 0);

  const nameInp = document.getElementById('manAccMacroName');
  if (nameInp && subjects.length) {
    nameInp.value = subjects.join(' ');
  }

  const blocksInp = document.getElementById('manAccBlocks');
  if (blocksInp && totalH > 0) {
    let preset = `${totalH}`;
    if (totalH === 10) preset = '2+2+2+2+2';
    else if (totalH === 9) preset = '2+2+2+2+1';
    else if (totalH === 8) preset = '2+2+2+2';
    else if (totalH === 7) preset = '2+2+2+1';
    else if (totalH === 6) preset = '2+2+2';
    else if (totalH === 5) preset = '2+2+1';
    else if (totalH === 4) preset = '2+2';
    else if (totalH === 3) preset = '2+1';
    blocksInp.value = preset;
  }
}

async function submitManualAccorpamento() {
  const teacher = document.getElementById('manAccTeacher')?.value.trim();
  const cls = document.getElementById('manAccClass')?.value.trim();
  const macroName = document.getElementById('manAccMacroName')?.value.trim();
  const blocks = document.getElementById('manAccBlocks')?.value.trim();
  const checkedActs = Array.from(document.querySelectorAll('input[name="manAccActCheck"]:checked')).map(c => c.value);

  if (!teacher || !cls) {
    alert('Seleziona docente e classe.');
    return;
  }
  if (checkedActs.length < 2) {
    alert('Seleziona almeno 2 attività da accorpare.');
    return;
  }
  if (!macroName) {
    alert('Inserisci il nome per la macro-materia.');
    return;
  }

  showToast('Accorpamento in corso...');
  const res = await fetch('/api/accorpamenti/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      teachers: [teacher],
      students: [cls],
      macro_subject: macroName,
      component_activity_ids: checkedActs,
      blocks: blocks
    })
  });

  if (res.ok) {
    closeModal();
    showToast(`Macro-materia "${macroName}" creata con successo per ${teacher} (${cls})!`);
    if (currentView === 'accorpamenti') renderAccorpamenti();
    else if (currentView === 'activities') renderActivities();
  } else {
    const err = await res.json().catch(() => ({ error: 'Errore applicazione accorpamento' }));
    alert(`Errore: ${err.error || 'Impossibile unire le attività'}`);
  }
}

// ============================================================================
// 8.B REGOLE SUDDIVISIONE BLOCCHI DIDATTICI & INDIRIZZI SEZIONI
// ============================================================================
function openBlockRulesModal() {
  navigate('block_rules');
}

async function renderBlockRulesView() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const container = document.getElementById('mainContent');
  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">${isEn ? 'Loading block rules & sections...' : 'Caricamento regole blocchi & sezioni...'}</div>`;

  try {
    const [sectionsData, rulesRes, cattedreRes] = await Promise.all([
      fetch('/api/sections/percorsi').then(r => r.json()).catch(() => ({ section_percorsi: {}, sections: [] })),
      fetch('/api/blocks/rules').then(r => r.json()).catch(() => ({ rules: [] })),
      fetch('/api/activities/grouped').then(r => r.json()).catch(() => [])
    ]);

    const rules = Array.isArray(rulesRes) ? rulesRes : (rulesRes.rules || []);
    const cattedre = Array.isArray(cattedreRes) ? cattedreRes : [];

    const totalCattedre = cattedre.length;
    const exceptions = cattedre.filter(c => c.is_exception);
    const standardCount = totalCattedre - exceptions.length;

    // Se il filtro globale per materia è attivo, filtra le regole
    const globalSubjFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim().toLowerCase();
    const displayRules = globalSubjFlt ? rules.filter(r => (r.subject || '').toLowerCase() === globalSubjFlt) : rules;

    container.innerHTML = `
      ${getGlobalFilterBannerHtml()}
      ${getNavReturnBarHtml(isEn ? 'Default block division rules and section tracks.' : 'Regole di default suddivisione blocchi e indirizzi sezioni.')}
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 style="font-size:18px;font-weight:700;color:var(--text-main);margin:0 0 6px 0;display:flex;align-items:center;gap:8px;">
              ${isEn ? '📐 Timetable Block Division Rules & Section Tracks' : '📐 Regole Suddivisione Blocchi Orari & Indirizzi Sezioni'}
              <span class="badge badge-ok">${standardCount} Standard (${Math.round((standardCount/totalCattedre)*100 || 100)}%)</span>
              ${exceptions.length > 0 ? `<span class="badge badge-warn">${exceptions.length} ${isEn ? 'Exceptions' : 'Eccezioni'}</span>` : `<span class="badge badge-ok">0 ${isEn ? 'Exceptions' : 'Eccezioni'}</span>`}
            </h2>
            <div style="font-size:13px;color:var(--text-muted);max-width:850px;line-height:1.5;">
              ${isEn
                ? 'Timetable block division (e.g. <code>2+1</code>, <code>1+1+1</code>, <code>2+2</code>) is governed by the <b>exception principle</b>: each teaching assignment automatically inherits the formula established for its <b>Subject</b>, <b>Weekly Hours</b> (e.g. 4h and 5h have distinct didactic formulas: <code>2+1+1</code> vs <code>2+2+1</code>), <b>Track</b> (High School, Technical, Vocational), and <b>Period</b> (Lower 1-2 or Upper 3-5). Entries with different hour conditions are complementary, distinct rules.'
                : 'La suddivisione dei blocchi orari (es. <code>2+1</code>, <code>1+1+1</code>, <code>2+2</code>) è determinata univocamente dalla combinazione di: <b>Materia</b>, <b>Monte Ore Settimanale</b> (es. cattedre da 4h e 5h hanno suddivisioni didattiche dedicate: <code>2+1+1</code> vs <code>2+2+1</code>), <b>Indirizzo</b> (Liceo, Tecnico o Professionale) e <b>Ciclo</b> (Biennio o Triennio). Ciascuna regola è associata a un monte ore specifico e non entra in contraddizione con cattedre di durata diversa.'}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openAddBlockRuleModal()" title="${isEn ? 'Add a new default formula for a subject' : 'Aggiungi una nuova regola di default per una disciplina'}">
              ${isEn ? '➕ New Default Rule' : '➕ Nuova Regola di Default'}
            </button>
            <button class="btn btn-sec" onclick="navigate('activities')" title="${isEn ? 'Go to all Teaching Assignments' : 'Vai alla schermata di tutte le Cattedre'}">
              ${isEn ? '👥 View Assignments' : '👥 Vai a Vista Cattedre'}
            </button>
            <button class="btn btn-sec" onclick="resetAllCattedreToDefault()" title="${isEn ? 'Reset all assignments to standard didactic defaults' : 'Ripristina tutte le cattedre alla suddivisione standard di default didattico (elimina le eccezioni e suddivisioni puntuali)'}">
              ↩️ ${isEn ? 'Reset All to Defaults' : 'Ripristina Tutte ai Default Didattici'} ${exceptions.length > 0 ? `(${exceptions.length} ${isEn ? 'exceptions' : 'eccezioni'})` : ''}
            </button>
          </div>
        </div>
      </div>

      <!-- SCHEDA 1: INDIRIZZI DELLE SEZIONI -->
      <div class="card" style="margin-bottom:16px;border-left:4px solid var(--primary);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <b style="font-size:14px;color:var(--text-main);">
            ${isEn ? '🏷️ 1. Study Track by Section (High School / Technical / Vocational)' : '🏷️ 1. Indirizzo di Studio per Sezione (Liceo / Tecnico / Professionale)'}
          </b>
          <span style="font-size:12px;color:var(--text-muted);">
            ${isEn ? 'Applies to all classes 1-5 sharing the same section letter' : 'Valido per tutte le classi da 1 a 5 con la stessa lettera di sezione'}
          </span>
        </div>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 12px 0;">
          ${isEn
            ? 'The study track is determined <b>strictly by section</b>. Click buttons below to update the track assigned to each section:'
            : 'L\'indirizzo di studio è determinato <b>esclusivamente in base alla sezione</b>. Clicca sui pulsanti sotto per cambiare l\'indirizzo assegnato a ciascuna sezione dell\'istituto:'}
        </p>

        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          ${(sectionsData.sections || []).map(s => {
            const p = s.percorso || 'tecnico';
            return `
              <div style="background:var(--bg-hover);border:1px solid var(--border);border-radius:6px;padding:8px 12px;display:flex;flex-direction:column;gap:6px;min-width:170px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <b style="font-size:14px;color:var(--primary);">${isEn ? 'Section' : 'Sezione'} ${s.section}</b>
                  <span style="font-size:11.5px;color:var(--text-muted);" title="${(s.classes || []).join(', ')}">${s.classes_count} ${isEn ? 'classes' : 'classi'}</span>
                </div>
                <div class="percorso-btn-group" style="width:100%;justify-content:space-between;">
                  <button type="button" class="percorso-btn ${p === 'liceo' ? 'active liceo' : ''}" onclick="updateSectionPercorso('${s.section}', 'liceo')" title="${isEn ? 'Set Section ' + s.section + ' as High School' : 'Imposta Sezione ' + s.section + ' come Liceo'}">
                    ${isEn ? '🎓 High School' : '🎓 Liceo'}
                  </button>
                  <button type="button" class="percorso-btn ${p === 'tecnico' ? 'active tecnico' : ''}" onclick="updateSectionPercorso('${s.section}', 'tecnico')" title="${isEn ? 'Set Section ' + s.section + ' as Technical' : 'Imposta Sezione ' + s.section + ' come Tecnico'}">
                    ${isEn ? '⚙️ Technical' : '⚙️ Tecnico'}
                  </button>
                  <button type="button" class="percorso-btn ${p === 'professionale' ? 'active professionale' : ''}" onclick="updateSectionPercorso('${s.section}', 'professionale')" title="${isEn ? 'Set Section ' + s.section + ' as Vocational' : 'Imposta Sezione ' + s.section + ' come Professionale'}">
                    ${isEn ? '🏥 Vocat.' : '🏥 Prof.'}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- SCHEDA 2: TABELLA DELLE REGOLE DI DEFAULT -->
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
          <div>
            <b style="font-size:14px;color:var(--text-main);">
              ${isEn ? `📐 2. System Default Rules (${rules.length} Didactic Rules)` : `📐 2. Regole di Default del Sistema (${rules.length} Regole Didattiche)`}
            </b>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
              ${isEn
                ? 'These formulas are automatically assigned to assignments unless an explicit exception is set.'
                : 'Queste formule vengono applicate automaticamente a qualsiasi cattedra in assenza di eccezioni esplicite.'}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" id="blockRulesSearchInput" class="search-input" placeholder="${isEn ? '🔍 Search subject or track...' : '🔍 Cerca materia o percorso...'}" oninput="filterBlockRulesTable(this.value)" style="width:240px;">
            <button class="btn btn-sm btn-primary" onclick="openAddBlockRuleModal()">${isEn ? '+ New Rule' : '+ Nuova Regola'}</button>
          </div>
        </div>

        <div class="table-container" style="max-height:480px;overflow:auto;">
          <table class="data-table" id="blockRulesTable">
            <thead>
              <tr>
                <th style="width:40px;">#</th>
                <th>${isEn ? 'Subject & Curriculum / Note' : 'Materia & Articolazione / Note'}</th>
                <th style="width:130px;text-align:center;">${isEn ? 'Track' : 'Indirizzo'}</th>
                <th style="width:110px;text-align:center;">${isEn ? 'Period' : 'Periodo'}</th>
                <th style="width:105px;text-align:center;">${isEn ? 'Weekly Hours' : 'Monte Ore (h)'}</th>
                <th style="width:130px;text-align:center;">${isEn ? 'Default Formula' : 'Formula Default'}</th>
                <th style="text-align:right;width:120px;">${isEn ? 'Actions' : 'Azioni'}</th>
              </tr>
            </thead>
            <tbody>
              ${displayRules.map((r, idx) => {
                const percBadge = r.percorso === 'liceo' ? 'badge-liceo' : (r.percorso === 'tecnico' ? 'badge-tecnico' : (r.percorso === 'professionale' ? 'badge-professionale' : 'badge-info'));
                const pLabel = (r.percorso || 'tutti').toLowerCase();
                const percDisplay = isEn ? (pLabel === 'tutti' ? 'ALL' : pLabel === 'liceo' ? 'HIGH SCHOOL' : pLabel === 'tecnico' ? 'TECHNICAL' : 'VOCATIONAL') : pLabel.toUpperCase();
                const periodLabel = (r.period || 'tutti').toLowerCase();
                const periodDisplay = isEn ? (periodLabel === 'tutti' ? 'ALL' : periodLabel === 'biennio' ? 'LOWER (1-2)' : 'UPPER (3-5)') : periodLabel.toUpperCase();
                return `
                  <tr class="block-rule-row" data-search="${escapeHtml((r.subject + ' ' + (r.percorso || '') + ' ' + (r.period || '') + ' ' + (r.note || '') + ' ' + r.blocks).toLowerCase())}">
                    <td style="color:var(--text-sub);">${idx + 1}</td>
                    <td>
                      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <b style="color:var(--text-main);font-size:13px;">${escapeHtml(r.subject)}</b>
                        ${r.note ? `<span class="badge" style="background:rgba(59,130,246,0.12);color:var(--primary);font-size:11px;font-weight:600;" title="${isEn ? 'Curriculum / Hours Note' : 'Condizione di indirizzo / ore'}">${escapeHtml(r.note)}</span>` : ''}
                      </div>
                    </td>
                    <td style="text-align:center;">
                      <span class="badge ${percBadge}">${escapeHtml(percDisplay)}</span>
                    </td>
                    <td style="text-align:center;">
                      <span class="badge badge-info">${escapeHtml(periodDisplay)}</span>
                    </td>
                    <td style="text-align:center;">
                      <b style="color:var(--primary);">${r.total_hours ? r.total_hours + ' h' : (isEn ? 'Any' : 'Qualsiasi')}</b>
                    </td>
                    <td style="text-align:center;">
                      <span class="block-badge block-default" style="font-weight:700;">${escapeHtml(r.blocks)}</span>
                    </td>
                    <td style="text-align:right;white-space:nowrap;">
                      <button class="btn btn-sm btn-sec" onclick="openAddBlockRuleModal(${JSON.stringify(r).replace(/"/g, '&quot;')})" title="${isEn ? 'Edit rule' : 'Modifica regola'}">✏️</button>
                      <button class="btn btn-sm btn-danger" onclick="deleteBlockRule('${escapeJs(r.id)}')" title="${isEn ? 'Delete rule' : 'Elimina regola'}">🗑️</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- SCHEDA 3: RIEPILOGO ECCEZIONI ATTIVE -->
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <b style="font-size:14px;color:var(--text-main);display:flex;align-items:center;gap:6px;">
              ${isEn ? `⚡ 3. Active Project Exceptions (${exceptions.length})` : `⚡ 3. Riepilogo Eccezioni Attive nel Progetto (${exceptions.length})`}
            </b>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
              ${isEn
                ? 'Assignments whose block division differs intentionally from standard default formulas.'
                : 'Cattedre la cui suddivisione blocchi differisce intenzionalmente dalla formula standard di default stabilita sopra.'}
            </div>
          </div>
        </div>

        ${exceptions.length === 0 ? `
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:20px;text-align:center;color:#166534;font-size:13px;">
            ${isEn
              ? `✅ <b>No active exceptions:</b> all <b>${totalCattedre}</b> assignments follow default didactic formulas for subject, track and period!`
              : `✅ <b>Nessuna eccezione attiva:</b> tutte le <b>${totalCattedre}</b> cattedre seguono perfettamente le formule standard di default previste per materia, indirizzo e biennio/triennio!`}
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${isEn ? 'Class' : 'Classe'}</th>
                  <th>${isEn ? 'Subject' : 'Materia'}</th>
                  <th>${isEn ? 'Teachers' : 'Docenti'}</th>
                  <th style="width:85px;text-align:center;">${isEn ? 'Hours' : 'Ore'}</th>
                  <th style="width:130px;text-align:center;">${isEn ? 'Applied Division' : 'Suddivisione Applicata'}</th>
                  <th style="width:130px;text-align:center;">${isEn ? 'Standard Formula' : 'Formula Standard'}</th>
                  <th style="text-align:right;width:190px;">${isEn ? 'Actions' : 'Azioni'}</th>
                </tr>
              </thead>
              <tbody>
                ${exceptions.map(e => `
                  <tr>
                    <td><span class="badge badge-info" style="font-weight:700;">${escapeHtml(e.students_display)}</span></td>
                    <td><b>${escapeHtml(e.subject)}</b></td>
                    <td>${escapeHtml(e.teachers_display)}</td>
                    <td style="text-align:center;"><b style="color:var(--primary);">${e.total_hours} h</b></td>
                    <td style="text-align:center;">
                      <span class="block-badge block-exception">⚡ ${escapeHtml(e.blocks)} <span class="exc-tag">Exc</span></span>
                    </td>
                    <td style="text-align:center;">
                      <span class="block-badge block-default">${escapeHtml(e.default_blocks || '')}</span>
                    </td>
                    <td style="text-align:right;white-space:nowrap;">
                      <button class="btn btn-sm btn-sec" onclick="submitResetBlocksToDefault('${e.sub_activity_ids.join(',')}', ${e.total_hours})" title="${isEn ? 'Reset this assignment to default formula' : 'Ripristina questa cattedra alla formula di default'}">
                        ↩️ ${isEn ? 'Reset Default' : 'Ripristina Default'}
                      </button>
                      <button class="btn btn-sm btn-primary" onclick="openEditBlocksModal('${e.sub_activity_ids.join(',')}', '${escapeJs(e.blocks)}', ${e.total_hours}, '${escapeJs(e.teachers_display)} - ${escapeJs(e.subject)} (${escapeJs(e.students_display)})', '${escapeJs(e.default_blocks || '')}', '${escapeJs(e.subject)}', '${escapeJs(e.students_display)}', '${escapeJs(e.percorso || '')}', '${escapeJs(e.period || '')}')">
                        ✏️ ${isEn ? 'Edit' : 'Modifica'}
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  } catch (err) {
    console.error('Errore caricamento regole blocchi:', err);
    container.innerHTML = `<div class="card" style="color:var(--danger);padding:24px;">Errore caricamento regole blocchi: ${escapeHtml(err.message)}</div>`;
  }
}

function filterBlockRulesTable(q) {
  const query = (q || '').toLowerCase();
  document.querySelectorAll('#blockRulesTable tbody tr.block-rule-row').forEach(row => {
    const s = row.getAttribute('data-search') || '';
    row.style.display = s.includes(query) ? '' : 'none';
  });
}

async function openAddBlockRuleModal(existingRule = null) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const res = await fetch('/api/subjects');
  const subjects = await res.json();
  const subjNames = subjects.map(s => s.name);

  const isEdit = !!existingRule;
  const r = existingRule || { id: '', subject: subjNames[0] || '', percorso: 'tutti', period: 'tutti', total_hours: 3, blocks: '2+1' };

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">${isEdit ? (isEn ? '✏️ Edit Default Rule' : '✏️ Modifica Regola di Default') : (isEn ? '➕ New Default Block Division Rule' : '➕ Nuova Regola di Default Suddivisione Blocchi')}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">${isEn ? 'Subject / Discipline' : 'Materia / Disciplina'}</label>
          <select id="ruleSubjectSelect" class="form-select">
            ${subjNames.map(s => `<option value="${escapeHtml(s)}" ${r.subject === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            <option value="*" ${r.subject === '*' ? 'selected' : ''}>* (${isEn ? 'All subjects - General Fallback' : 'Tutte le materie - Fallback Generale'})</option>
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">${isEn ? 'Study Track' : 'Indirizzo di Studio'}</label>
            <select id="rulePercorsoSelect" class="form-select">
              <option value="tutti" ${r.percorso === 'tutti' ? 'selected' : ''}>${isEn ? 'All Tracks' : 'Tutti gli Indirizzi'}</option>
              <option value="liceo" ${r.percorso === 'liceo' ? 'selected' : ''}>${isEn ? '🎓 High School Only' : '🎓 Solo Liceo'}</option>
              <option value="tecnico" ${r.percorso === 'tecnico' ? 'selected' : ''}>${isEn ? '⚙️ Technical Only' : '⚙️ Solo Tecnico'}</option>
              <option value="professionale" ${r.percorso === 'professionale' ? 'selected' : ''}>${isEn ? '🏥 Vocational Only' : '🏥 Solo Professionale'}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${isEn ? 'School Period' : 'Periodo Scolastico'}</label>
            <select id="rulePeriodSelect" class="form-select">
              <option value="tutti" ${r.period === 'tutti' ? 'selected' : ''}>${isEn ? 'All (Lower & Upper Years)' : 'Tutti (Biennio & Triennio)'}</option>
              <option value="biennio" ${r.period === 'biennio' ? 'selected' : ''}>${isEn ? 'Lower Years (Classes 1-2)' : 'Biennio (Classi 1-2)'}</option>
              <option value="triennio" ${r.period === 'triennio' ? 'selected' : ''}>${isEn ? 'Upper Years (Classes 3-5)' : 'Triennio (Classi 3-5)'}</option>
            </select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">${isEn ? 'Weekly Hours' : 'Monte Ore Settimanale'}</label>
            <input type="number" id="ruleTotalHours" class="form-input" min="1" max="10" value="${r.total_hours || 3}">
          </div>
          <div class="form-group">
            <label class="form-label">${isEn ? 'Default Block Formula' : 'Formula Suddivisione di Default'}</label>
            <input type="text" id="ruleBlocks" class="form-input" value="${escapeHtml(r.blocks || '2+1')}" style="font-weight:700;font-family:var(--font-mono);">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">
            <span>${isEn ? 'Curriculum / Note / Condition (Optional)' : 'Articolazione / Note / Condizione (Opzionale)'}</span>
            <span class="form-hint">${isEn ? 'Identifies specific track or hours context' : 'Specifica il contesto o indirizzo'}</span>
          </label>
          <input type="text" id="ruleNoteInput" class="form-input" value="${escapeHtml(r.note || '')}" placeholder="${isEn ? 'E.g. Scientific Track (5h: 2+2+1)' : 'Es. Liceo Scientifico (5h: 2+2+1)'}">
        </div>

        <span class="form-hint">
          ${isEn
            ? 'Example: for 3 hours enter <b>2+1</b> (one double period and one single on different days) or <b>1+1+1</b>. The combination of Subject + Hours + Track + Period forms a unique rule.'
            : 'Esempio: per 3 ore inserisci <b>2+1</b> (una lezione doppia e una singola in giorni diversi) oppure <b>1+1+1</b>. La combinazione di Materia + Monte Ore + Indirizzo + Ciclo costituisce una chiave univoca.'}
        </span>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitBlockRule('${escapeJs(r.id || '')}')">💾 ${isEn ? 'Save Rule' : 'Salva Regola'}</button>
      </div>
    </div>
  `);
}

async function submitBlockRule(existingId) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const subject = document.getElementById('ruleSubjectSelect').value.trim();
  const percorso = document.getElementById('rulePercorsoSelect').value.trim();
  const period = document.getElementById('rulePeriodSelect').value.trim();
  const totalHours = parseInt(document.getElementById('ruleTotalHours').value, 10) || 0;
  const blocks = document.getElementById('ruleBlocks').value.trim();
  const note = document.getElementById('ruleNoteInput') ? document.getElementById('ruleNoteInput').value.trim() : '';

  if (!subject) {
    alert(isEn ? 'Please select a subject.' : 'Selezionare la materia.');
    return;
  }
  if (totalHours <= 0) {
    alert(isEn ? 'Please enter a valid number of weekly hours.' : 'Inserire un monte ore valido.');
    return;
  }
  const blockSum = blocks.replace(/,/g, '+').split('+').map(x => parseInt(x.trim()) || 0).reduce((a, b) => a + b, 0);
  if (blockSum !== totalHours) {
    alert(isEn ? `Block sum (${blockSum}) does not match weekly hours (${totalHours}).` : `La somma dei blocchi (${blockSum}) non corrisponde al monte ore settimanale (${totalHours}).`);
    return;
  }

  const payload = {
    id: existingId || '',
    subject,
    percorso,
    period,
    total_hours: totalHours,
    blocks,
    note
  };

  const res = await fetch('/api/blocks/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    closeModal();
    showToast(`Regola di default per ${subject} (${blocks}) salvata!`, 'success');
    renderBlockRulesView();
  } else {
    alert('Errore durante il salvataggio della regola.');
  }
}

async function deleteBlockRule(ruleId) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (confirm(isEn ? 'Delete this default rule?' : 'Eliminare questa regola di default?')) {
    const res = await fetch('/api/blocks/rules/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ruleId })
    });
    if (res.ok) {
      showToast(isEn ? 'Rule deleted successfully.' : 'Regola eliminata con successo.', 'warn');
      renderBlockRulesView();
    } else {
      alert(isEn ? 'Error deleting rule.' : 'Errore eliminazione regola.');
    }
  }
}

async function resetAllCattedreToDefault() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const msg = isEn
    ? "Reset ALL teaching assignments to standard curriculum default blocks by subject, track, and period?\n\nAll custom splits will be reset and FET sub-activities regenerated according to educational defaults (e.g. 10h -> 2+2+2+2+2, 7h -> 2+2+2+1, 6h -> 2+2+1+1, 4h -> 2+2, 3h -> 1+1+1, 2h -> 2, etc.)."
    : "Reimpostare TUTTE le cattedre alla suddivisione standard di default didattica per materia, percorso e periodo?\n\nTutte le suddivisioni puntuali verranno azzerate e le sotto-attività FET rigenerate secondo i default didattici (es. 10h -> 2+2+2+2+2, 7h -> 2+2+2+1 o 2+2+1+1+1, 6h -> 2+2+1+1, 4h -> 2+1+1 o 2+2, 3h lingue -> 1+1+1, 2h motorie/lab -> 2, ecc.).";
  if (!confirm(msg)) {
    return;
  }
  try {
    const res = await fetch('/api/cattedre/reset_all_to_default', {
      method: 'POST'
    });
    if (res.ok) {
      const data = await res.json();
      showToast(isEn ? `All ${data.cattedre_count} teaching assignments have been reset to curriculum defaults (${data.activities_count} FET sub-activities)!` : `Tutte le ${data.cattedre_count} cattedre sono state ripristinate ai default didattici (${data.activities_count} sotto-attività FET)!`, 'success');
      if (currentView === 'block_rules') renderBlockRulesView();
      else if (currentView === 'activities') renderActivities();
      else if (currentView === 'accorpamenti') renderAccorpamenti();
    } else {
      const err = await res.json().catch(() => ({}));
      alert((isEn ? 'Error resetting assignments: ' : 'Errore durante il reset delle cattedre: ') + (err.error || (isEn ? 'Operation failed' : 'Operazione fallita')));
    }
  } catch (e) {
    alert((isEn ? 'Error during reset: ' : 'Errore durante il reset: ') + e.message);
  }
}


function clearActivityFilter() {
  const inp = document.getElementById('activitySearchInput');
  if (inp) {
    inp.value = '';
    filterActivities('');
  }
  const pill = document.getElementById('activeFilterPill');
  if (pill) pill.remove();
}

function switchActivityView(mode) {
  activityViewMode = mode;
  renderActivities();
}

function filterActivities(query) {
  const q = query.toLowerCase();
  const rows = document.querySelectorAll('#actTable tbody tr');
  rows.forEach(r => {
    const text = r.innerText.toLowerCase();
    r.style.display = text.includes(q) ? '' : 'none';
  });
}

async function deleteActivity(id) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  if (confirm(isEn ? `Delete activity #${id}?` : `Eliminare l'attività #${id}?`)) {
    await fetch(`/api/activities/${id}`, { method: 'DELETE' });
    showToast(isEn ? `Activity #${id} deleted.` : `Attività #${id} eliminata.`, 'warn');
    renderActivities();
  }
}

// --- MODALE: NUOVA CATTEDRA / ATTIVITÀ CON PRESET E SPAZIO DEDICATO ---
let selectedCoTeachers = [];

async function openNewCattedraModal(preset = {}) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  selectedCoTeachers = [];
  const [teachers, classes, groups, subjects, roomsData] = await Promise.all([
    fetch('/api/teachers').then(r => r.json()),
    fetch('/api/classes').then(r => r.json()),
    fetch('/api/groups').then(r => r.json()),
    fetch('/api/subjects').then(r => r.json()),
    fetch('/api/rooms').then(r => r.json())
  ]);
  stateData.teachers = teachers;
  stateData.classes = classes;
  stateData.groups = groups;
  stateData.subjects = subjects;
  stateData.rooms = roomsData.rooms || [];
  stateData.buildings = roomsData.buildings || ['Centrale', 'Succursale'];

  const teacherOpts = buildTeacherSelectOptions(preset.subject || '', preset.teacher || '', preset.cdc || null);
  const coTeacherOpts = buildTeacherSelectOptions('', '', null, true, true);

  let targetOpts = `<optgroup label="${isEn ? 'Entire Classes' : 'Classi Intere'}">` +
    classes.map(c => `
      <option value="${escapeHtml(c.name)}" ${preset.className === c.name ? 'selected' : ''}>
        ${isEn ? 'Class' : 'Classe'} ${escapeHtml(c.name)} (${c.students || 0} ${isEn ? 'students' : 'alunni'} - ${escapeHtml(c.building ? (isEn && c.building === 'Centrale' ? 'Main' : (isEn && c.building.includes('Succ') ? 'Branch' : c.building)) : (isEn ? 'Main' : 'Centrale'))})
      </option>
    `).join('') +
    `</optgroup>`;
  if (groups.length > 0) {
    targetOpts += `<optgroup label="${isEn ? 'Subgroups (Languages, Ethics/Alt, Subgroups)' : 'Gruppi Articolati (Lingue, Religione/Alt, Sottogruppi)'}">` +
      groups.map(g => `
        <option value="${escapeHtml(g.name)}" ${preset.className === g.name ? 'selected' : ''}>
          ${isEn ? 'Group' : 'Gruppo'} ${escapeHtml(g.name)} (${escapeHtml(g.class_name)})
        </option>
      `).join('') +
      `</optgroup>`;
  }
  targetOpts += `<optgroup label="${isEn ? 'Other' : 'Altro'}">
    <option value="__CUSTOM__">➕ ${isEn ? 'Parallel / Combined Classes (e.g. 1C+1D)...' : 'Classi Parallele / Accorpate (es. 1C+1D)...'}</option>
  </optgroup>`;

  const subjOpts = subjects.map(s => `
    <option value="${escapeHtml(s.name)}" ${preset.subject === s.name ? 'selected' : ''}>${escapeHtml(s.name)}${s.cdc ? ` [${escapeHtml(s.cdc)}]` : ''}</option>
  `).join('');

  // Spazi fisici (Aule, Lab, Palestre)
  const rooms = stateData.rooms;
  const labs = rooms.filter(r => r.room_type === 'lab' || (!r.room_type && r.is_lab_or_gym));
  const gyms = rooms.filter(r => r.room_type === 'gym' || (r.name || '').toLowerCase().includes('palestra'));
  const stdRooms = rooms.filter(r => !labs.includes(r) && !gyms.includes(r));

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">➕ ${isEn ? 'New Teaching Assignment / Activity' : 'Nuova Cattedra / Attività d\'Insegnamento'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">
            <span>${isEn ? 'Primary Teacher' : 'Docente Titolare'}</span>
            <span class="form-hint">${isEn ? 'Filtered by subject CDC' : 'Filtrato per CDC della materia'}</span>
          </label>
          <select id="modalTeacher" class="form-select" onchange="onModalTeacherChanged()">
            ${teacherOpts}
          </select>
        </div>

        <div class="form-group">
          <div class="form-label">
            <span>${isEn ? 'Co-Teaching / Co-Teachers' : 'Compresenze / Co-Docenti'}</span>
            <span class="form-hint" style="cursor:pointer;color:var(--primary);font-weight:600;" onclick="toggleCoTeacherRow()">+ ${isEn ? 'Add Co-Teacher' : 'Aggiungi Docente Compresenza'}</span>
          </div>
          <div id="coTeacherRow" style="display:none;margin-bottom:6px;">
            <div style="display:flex;gap:6px;">
              <select id="modalCoTeacherSelect" class="form-select" onchange="onModalCoTeacherChanged()">
                ${coTeacherOpts}
              </select>
              <button class="btn btn-sm btn-sec" type="button" onclick="addCoTeacherChip()">${isEn ? 'Add' : 'Aggiungi'}</button>
            </div>
          </div>
          <div id="coTeacherChips" class="co-teachers-list"></div>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Recipients (Class, Subgroup or Parallel Classes)' : 'Destinatari (Classe, Gruppo Articolato o Classi Parallele)'}</label>
          <select id="modalTargetSelect" class="form-select" onchange="onTargetSelectChange(this.value)">
            ${targetOpts}
          </select>
          <div id="customTargetDiv" style="display:none;margin-top:6px;">
            <input type="text" id="modalCustomTarget" class="form-input" placeholder="${isEn ? 'E.g. 1C+1D (for PE or merged classes)' : 'Es. 1C+1D (per Scienze Motorie o accorpamenti)'}">
            <span class="form-hint">${isEn ? 'Separate with "+" or comma classes attending together at the same time.' : 'Separa con "+" o virgola le classi che partecipano insieme alla stessa ora.'}</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Subject / Discipline' : 'Materia / Disciplina'}</label>
          <select id="modalSubject" class="form-select" onchange="onModalSubjectChanged()">
            <option value="">-- ${isEn ? 'Select Subject' : 'Seleziona Materia'} --</option>
            ${subjOpts}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">
            <span>${isEn ? 'Dedicated Room / Lab / Gym' : 'Aula Dedicata / Laboratorio / Palestra'}</span>
            <span class="form-hint">${isEn ? 'If omitted, uses class resident homeroom' : 'Se omesso, usa l\'aula base della classe'}</span>
          </label>
          <select id="modalRoomSelect" class="form-select" onchange="checkBuildingTransferWarning()">
            <option value="" data-bld="" data-type="default">-- 🏠 ${isEn ? 'Standard Homeroom of Class (No transfer)' : 'Aula Base Ordinaria della Classe (Nessun trasferimento)'} --</option>
            <optgroup label="${isEn ? '🧪 Teaching Laboratories (Triggers campus transfer for classes from other sites)' : '🧪 Laboratori Didattici (Innescano cambio plesso per classi di altra sede)'}">
              ${labs.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="lab">🧪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} ${isEn ? 'students' : 'alunni'}]</option>`).join('')}
            </optgroup>
            <optgroup label="${isEn ? '🏀 Gymnasiums / Sports Facilities' : '🏀 Palestre / Impianti Sportivi'}">
              ${gyms.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="gym">🏀 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} ${isEn ? 'students' : 'alunni'}]</option>`).join('')}
            </optgroup>
            <optgroup label="${isEn ? '🚪 Special Rooms / Other Spaces' : '🚪 Aule Speciali / Altri Spazi'}">
              ${stdRooms.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="standard">🚪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} ${isEn ? 'students' : 'alunni'}]</option>`).join('')}
            </optgroup>
          </select>
          <div id="buildingTransferWarning" style="display:none;margin-top:8px;"></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">${isEn ? 'Weekly Hours' : 'Monte Ore Settimanale'}</label>
            <input type="number" id="modalTotalHours" class="form-input" min="1" max="10" value="3" oninput="onHoursInputChange(this.value)">
          </div>
          <div class="form-group">
            <label class="form-label">${isEn ? 'Block Division' : 'Suddivisione Blocchi'}</label>
            <input type="text" id="modalBlocks" class="form-input" value="2+1" style="font-weight:700;font-family:var(--font-mono);">
          </div>
        </div>

        <div class="form-group">
          <span class="form-label">${isEn ? 'Block Division Presets:' : 'Preset Suddivisione Blocchi:'}</span>
          <div class="preset-pills" id="modalPresetsContainer"></div>
          <span class="form-hint" style="margin-top:4px;">
            ${isEn
              ? 'FET automatically ensures each block (e.g. 2 hrs + 1 hr) takes place on <b>different days</b> via <i>ConstraintMinDaysBetweenActivities</i>.'
              : 'FET garantisce automaticamente che ciascun blocco (es. 2 ore + 1 ora) sia svolto in <b>giorni diversi</b> tramite il vincolo <i>ConstraintMinDaysBetweenActivities</i>.'}
          </span>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Assignment Notes / Details' : 'Note / Dettagli Cattedra'} <span class="form-hint">(${isEn ? 'optional' : 'opzionale'})</span></label>
          <input type="text" id="modalComments" class="form-input" placeholder="${isEn ? 'E.g. Lab with ITP, external timetable assignment...' : 'Es. Laboratorio con ITP, cattedra orario esterna...'}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitNewCattedra()">💾 ${isEn ? 'Save Assignment' : 'Salva Cattedra'}</button>
      </div>
    </div>
  `);

  renderBlockPresets(3);
  checkBuildingTransferWarning();
}

function checkBuildingTransferWarning() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const roomSel = document.getElementById('modalRoomSelect');
  const targetSel = document.getElementById('modalTargetSelect');
  const warnDiv = document.getElementById('buildingTransferWarning');
  if (!roomSel || !targetSel || !warnDiv) return;

  const roomName = roomSel.value;
  const targetVal = targetSel.value;

  if (!roomName) {
    warnDiv.style.display = 'none';
    warnDiv.innerHTML = '';
    return;
  }

  const selectedOpt = roomSel.options[roomSel.selectedIndex];
  const roomBuilding = selectedOpt ? selectedOpt.getAttribute('data-bld') : '';
  const roomType = selectedOpt ? selectedOpt.getAttribute('data-type') : '';

  // Trova il plesso della classe
  let classObj = (stateData.classes || []).find(c => c.name === targetVal);
  if (!classObj && targetVal) {
    const grp = (stateData.groups || []).find(g => g.name === targetVal);
    if (grp) {
      classObj = (stateData.classes || []).find(c => c.name === grp.class_name);
    }
  }

  const classBuilding = classObj ? (classObj.building || 'Centrale') : 'Centrale';

  if (roomBuilding && classBuilding && roomBuilding.toLowerCase() !== classBuilding.toLowerCase()) {
    warnDiv.className = 'info-banner';
    warnDiv.style.display = 'block';
    warnDiv.innerHTML = isEn ? `
      ⚡ <b>CAMPUS TRANSFER DETECTED:</b><br>
      Class <b>${escapeHtml(targetVal || 'selected')}</b> resides in <b>${escapeHtml(classBuilding)}</b>,
      while space <b>${escapeHtml(roomName)}</b> is located in <b>${escapeHtml(roomBuilding)}</b>.<br>
      FET will automatically enforce campus travel time and transfer constraints.
    ` : `
      ⚡ <b>CAMBIO DI PLESSO RILEVATO:</b><br>
      La classe <b>${escapeHtml(targetVal || 'selezionata')}</b> risiede in <b>${escapeHtml(classBuilding)}</b>,
      mentre lo spazio <b>${escapeHtml(roomName)}</b> si trova in <b>${escapeHtml(roomBuilding)}</b>.<br>
      FET applicherà automaticamente il vincolo di trasferimento tra sedi e gli intervalli minimi di percorrenza.
    `;
  } else if (roomType === 'lab' || roomType === 'gym') {
    warnDiv.className = 'info-banner info-banner-blue';
    warnDiv.style.display = 'block';
    warnDiv.innerHTML = isEn ? `
      ℹ️ <b>Dedicated facility:</b> <b>${escapeHtml(roomName)}</b> is on the same campus (<b>${escapeHtml(roomBuilding || classBuilding)}</b>). No campus transfer needed.
    ` : `
      ℹ️ <b>Spazio speciale dedicato:</b> <b>${escapeHtml(roomName)}</b> si trova nella stessa sede (<b>${escapeHtml(roomBuilding || classBuilding)}</b>). Non comporta cambio di edificio.
    `;
  } else {
    warnDiv.style.display = 'none';
    warnDiv.innerHTML = '';
  }
}

function toggleCoTeacherRow() {
  const row = document.getElementById('coTeacherRow');
  if (row) row.style.display = row.style.display === 'none' ? 'block' : 'none';
}

function addCoTeacherChip() {
  const sel = document.getElementById('modalCoTeacherSelect');
  const subjSel = document.getElementById('modalSubject');
  const val = sel.value;
  if (!val) return;
  const currSubj = subjSel ? subjSel.value : '';
  const existing = selectedCoTeachers.find(t => (typeof t === 'string' ? t : t.teacher) === val);
  if (!existing) {
    selectedCoTeachers.push({ teacher: val, subject: currSubj });
    renderCoTeacherChips();
  }
  sel.value = '';
}

function updateCoTeacherSubject(name, subj) {
  const item = selectedCoTeachers.find(t => (typeof t === 'string' ? t : t.teacher) === name);
  if (item) {
    if (typeof item === 'string') {
      const idx = selectedCoTeachers.indexOf(name);
      selectedCoTeachers[idx] = { teacher: name, subject: subj };
    } else {
      item.subject = subj;
    }
  }
}

function removeCoTeacherChip(name) {
  selectedCoTeachers = selectedCoTeachers.filter(t => (typeof t === 'string' ? t : t.teacher) !== name);
  renderCoTeacherChips();
}

function renderCoTeacherChips() {
  const cont = document.getElementById('coTeacherChips');
  if (!cont) return;
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  const subjects = stateData.subjects || [];

  cont.innerHTML = selectedCoTeachers.map(item => {
    const tName = typeof item === 'string' ? item : item.teacher;
    const tSubj = typeof item === 'string' ? '' : item.subject;
    return `
      <div class="co-teacher-row-item">
        <span class="co-teacher-name">👨‍🏫 <b>${escapeHtml(tName)}</b></span>
        <span class="co-teacher-subj-label">${isEn ? 'Subject:' : 'Materia:'}</span>
        <select class="form-select form-select-sm co-teacher-subj-select" onchange="updateCoTeacherSubject('${escapeJs(tName)}', this.value)">
          <option value="">-- ${isEn ? 'Default (Inherit Main Subject)' : 'Predefinita (Eredita materia principale)'} --</option>
          ${subjects.map(s => `<option value="${escapeHtml(s.name)}" ${(tSubj === s.name) ? 'selected' : ''}>${escapeHtml(s.name)}${s.cdc ? ' [' + escapeHtml(s.cdc) + ']' : ''}</option>`).join('')}
        </select>
        <button type="button" class="btn-remove-coteacher" onclick="removeCoTeacherChip('${escapeJs(tName)}')" title="${isEn ? 'Remove co-teacher' : 'Rimuovi compresenza'}">✕</button>
      </div>
    `;
  }).join('');
}

function onTargetSelectChange(val) {
  const customDiv = document.getElementById('customTargetDiv');
  if (customDiv) {
    customDiv.style.display = val === '__CUSTOM__' ? 'block' : 'none';
  }
  checkBuildingTransferWarning();
}

function onHoursInputChange(val) {
  const h = parseInt(val) || 1;
  renderBlockPresets(h);
}

function renderBlockPresets(hours, currentBlock = null) {
  const cont = document.getElementById('modalPresetsContainer');
  if (!cont) return;
  let presets = [];
  if (hours === 1) presets = ['1'];
  else if (hours === 2) presets = ['2', '1+1'];
  else if (hours === 3) presets = ['2+1', '1+1+1', '3'];
  else if (hours === 4) presets = ['2+2', '2+1+1', '3+1', '1+1+1+1'];
  else if (hours === 5) presets = ['2+2+1', '3+2', '2+1+1+1'];
  else if (hours === 6) presets = ['2+2+1+1', '2+2+2', '3+3'];
  else if (hours === 7) presets = ['2+2+2+1', '2+2+1+1+1', '3+2+2'];
  else if (hours === 8) presets = ['2+2+2+2', '2+2+2+1+1'];
  else if (hours === 9) presets = ['3+2+2+2', '2+2+2+2+1'];
  else if (hours === 10) presets = ['3+3+2+2', '2+2+2+2+2'];
  else {
    presets = [`${Math.floor(hours / 2)}+${Math.ceil(hours / 2)}`];
  }

  if (currentBlock && !presets.includes(currentBlock)) {
    presets.unshift(currentBlock);
  }

  const input = document.getElementById('modalBlocks');
  if (currentBlock && presets.includes(currentBlock)) {
    if (input) input.value = currentBlock;
  } else if (input && (!input.value || !presets.includes(input.value))) {
    input.value = presets[0];
  }

  cont.innerHTML = presets.map(p => `
    <button type="button" class="preset-pill ${input && input.value === p ? 'active' : ''}" onclick="selectBlockPreset('${p}')">
      ${p}
    </button>
  `).join('');
}

function selectBlockPreset(p) {
  const input = document.getElementById('modalBlocks');
  if (input) input.value = p;
  document.querySelectorAll('#modalPresetsContainer .preset-pill').forEach(el => {
    el.classList.toggle('active', el.innerText.trim() === p);
  });
}

async function submitNewCattedra() {
  const primaryTeacher = document.getElementById('modalTeacher').value.trim();
  const targetVal = document.getElementById('modalTargetSelect').value.trim();
  const customTarget = document.getElementById('modalCustomTarget') ? document.getElementById('modalCustomTarget').value.trim() : '';
  const subject = document.getElementById('modalSubject').value.trim();
  const room = document.getElementById('modalRoomSelect') ? document.getElementById('modalRoomSelect').value.trim() : '';
  const totalHours = parseInt(document.getElementById('modalTotalHours').value) || 0;
  const blocks = document.getElementById('modalBlocks').value.trim();
  const comments = document.getElementById('modalComments').value.trim();

  let targetStudents = [];
  if (targetVal === '__CUSTOM__') {
    if (!customTarget) {
      alert('Specificare le classi accorpate (es. 1C+1D).');
      return;
    }
    targetStudents = customTarget.replace(/,/g, '+').split('+').map(s => s.trim()).filter(Boolean);
  } else if (targetVal) {
    targetStudents = [targetVal];
  }

  if (!targetStudents.length) {
    alert('Selezionare almeno una classe o gruppo destinatario.');
    return;
  }
  if (!subject) {
    alert('Selezionare la materia.');
    return;
  }
  if (totalHours <= 0) {
    alert('Inserire un monte ore valido.');
    return;
  }

  const allTeachers = [];
  const teacherSubjects = {};
  if (primaryTeacher) {
    allTeachers.push(primaryTeacher);
    teacherSubjects[primaryTeacher] = subject;
  }
  selectedCoTeachers.forEach(item => {
    const tName = typeof item === 'string' ? item : item.teacher;
    const tSubj = (typeof item === 'object' && item.subject) ? item.subject : subject;
    if (!allTeachers.includes(tName)) allTeachers.push(tName);
    teacherSubjects[tName] = tSubj;
  });

  const payload = {
    teachers: allTeachers,
    teacher_subjects: teacherSubjects,
    students: targetStudents,
    subject: subject,
    total_hours: totalHours,
    blocks: blocks,
    room: room,
    active: true,
    comments: comments
  };

  const res = await fetch('/api/cattedre', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    selectedCoTeachers = [];
    closeModal();
    showToast(`Cattedra creata con successo per ${targetStudents.join('+')}!`);
    renderActivities();
  } else {
    const err = await res.json();
    alert('Errore nel salvataggio della cattedra: ' + (err.error || 'Dati non validi'));
  }
}

// ============================================================================
// MODALE: MODIFICA COMPLETA CATTEDRA / INSEGNAMENTO
// ============================================================================
function formatNoteForDisplay(comments) {
  if (!comments) return '';
  const parts = comments.split('|').map(s => s.trim()).filter(Boolean);
  const unique = Array.from(new Set(parts));
  // Esclude etichette interne di riga grezza come "Riga 40"
  const realParts = unique.filter(u => !/^riga\s+\d+$/i.test(u));
  return realParts.join(' | ');
}

async function openEditCattedraModal(idxOrId) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  let g = null;
  if (typeof idxOrId === 'string') {
    g = (stateData.groupedActivities || []).find(item => item.id === idxOrId);
  } else if (typeof idxOrId === 'number') {
    g = (stateData.groupedActivities || [])[idxOrId];
  }
  if (!g && stateData.groupedActivities) {
    g = stateData.groupedActivities[idxOrId];
  }
  if (!g) return;

  const [teachers, classes, groups, subjects, roomsData] = await Promise.all([
    fetch('/api/teachers').then(r => r.json()),
    fetch('/api/classes').then(r => r.json()),
    fetch('/api/groups').then(r => r.json()),
    fetch('/api/subjects').then(r => r.json()),
    fetch('/api/rooms').then(r => r.json())
  ]);
  stateData.teachers = teachers;
  stateData.classes = classes;
  stateData.groups = groups;
  stateData.subjects = subjects;
  stateData.rooms = roomsData.rooms || [];
  stateData.buildings = roomsData.buildings || ['Centrale', 'Succursale'];

  const primaryTeacher = (g.teachers && g.teachers.length > 0) ? g.teachers[0] : '';
  const rawCoTeachers = (g.teachers && g.teachers.length > 1) ? g.teachers.slice(1) : [];
  editSelectedCoTeachers = rawCoTeachers.map(tName => ({
    teacher: tName,
    subject: (g.teacher_subjects && g.teacher_subjects[tName]) ? g.teacher_subjects[tName] : g.subject
  }));

  const teacherOpts = buildTeacherSelectOptions(g.subject || '', primaryTeacher);
  const coTeacherOpts = buildTeacherSelectOptions('', '', null, true, true);

  // Destinatari
  const singleStudent = (g.students && g.students.length === 1) ? g.students[0] : '';
  const isCustomStudent = (g.students && g.students.length > 1) || (!classes.some(c => c.name === singleStudent) && !groups.some(grp => grp.name === singleStudent));

  let targetOpts = `<optgroup label="${isEn ? 'Entire Classes' : 'Classi Intere'}">` +
    classes.map(c => `
      <option value="${escapeHtml(c.name)}" ${(!isCustomStudent && singleStudent === c.name) ? 'selected' : ''}>
        ${isEn ? 'Class' : 'Classe'} ${escapeHtml(c.name)} (${c.students || 0} ${isEn ? 'students' : 'alunni'} - ${escapeHtml(c.building ? (isEn && c.building === 'Centrale' ? 'Main' : (isEn && c.building.includes('Succ') ? 'Branch' : c.building)) : (isEn ? 'Main' : 'Centrale'))})
      </option>
    `).join('') +
    `</optgroup>`;
  if (groups.length > 0) {
    targetOpts += `<optgroup label="${isEn ? 'Subgroups (Languages, Ethics/Alt, Subgroups)' : 'Gruppi Articolati (Lingue, Religione/Alt, Sottogruppi)'}">` +
      groups.map(grp => `
        <option value="${escapeHtml(grp.name)}" ${(!isCustomStudent && singleStudent === grp.name) ? 'selected' : ''}>
          ${isEn ? 'Group' : 'Gruppo'} ${escapeHtml(grp.name)} (${escapeHtml(grp.class_name)})
        </option>
      `).join('') +
      `</optgroup>`;
  }
  targetOpts += `<optgroup label="${isEn ? 'Other' : 'Altro'}">
    <option value="__CUSTOM__" ${isCustomStudent ? 'selected' : ''}>➕ ${isEn ? 'Parallel / Combined Classes (e.g. 1C+1D)...' : 'Classi Parallele / Accorpate (es. 1C+1D)...'}</option>
  </optgroup>`;

  const subjOpts = subjects.map(s => `
    <option value="${escapeHtml(s.name)}" ${g.subject === s.name ? 'selected' : ''}>${escapeHtml(s.name)}${s.cdc ? ` [${escapeHtml(s.cdc)}]` : ''}</option>
  `).join('');

  // Spazi fisici (Aule, Lab, Palestre)
  const rooms = stateData.rooms;
  const currentRoom = (g.rooms && g.rooms.length > 0) ? g.rooms[0] : '';
  const labs = rooms.filter(r => r.room_type === 'lab' || (!r.room_type && r.is_lab_or_gym));
  const gyms = rooms.filter(r => r.room_type === 'gym' || (r.name || '').toLowerCase().includes('palestra'));
  const stdRooms = rooms.filter(r => !labs.includes(r) && !gyms.includes(r));

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">✏️ ${isEn ? 'Edit Teaching Assignment / Activity' : 'Modifica Cattedra / Insegnamento'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="background:#f8fafc;padding:10px 14px;border-radius:6px;border:1px solid var(--border);margin-bottom:14px;font-size:12.5px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <b>${isEn ? 'Linked FET sub-activities:' : 'Sotto-attività FET collegate:'}</b>
            <span class="sub-acts-tag">
              ${(g.sub_activity_ids || []).map(id => `<a href="javascript:void(0)" onclick="jumpToSubActivity('${id}')" class="sub-act-pill" title="${isEn ? 'Jump to FET record #' + id : 'Salta al record FET #' + id}">#${id}</a>`).join('')}
            </span>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;margin:0;">
            <input type="checkbox" id="editModalActive" ${g.active ? 'checked' : ''} style="width:16px;height:16px;">
            <span>${isEn ? 'Active in FET engine' : 'Attiva nel motore FET'}</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">
            <span>${isEn ? 'Primary Teacher' : 'Docente Titolare'}</span>
            <span class="form-hint">${isEn ? 'Filtered by subject CDC' : 'Filtrato per CDC della materia'}</span>
          </label>
          <select id="editModalTeacher" class="form-select" onchange="onEditModalTeacherChanged()">
            ${teacherOpts}
          </select>
        </div>

        <div class="form-group">
          <div class="form-label">
            <span>${isEn ? 'Co-Teaching / Co-Teachers' : 'Compresenze / Co-Docenti'}</span>
            <span class="form-hint" style="cursor:pointer;color:var(--primary);font-weight:600;" onclick="toggleEditCoTeacherRow()">+ ${isEn ? 'Add Co-Teacher' : 'Aggiungi Docente Compresenza'}</span>
          </div>
          <div id="editCoTeacherRow" style="display:none;margin-bottom:6px;">
            <div style="display:flex;gap:6px;">
              <select id="editModalCoTeacherSelect" class="form-select" onchange="onEditModalCoTeacherChanged()">
                ${coTeacherOpts}
              </select>
              <button class="btn btn-sm btn-sec" type="button" onclick="addEditCoTeacherChip()">${isEn ? 'Add' : 'Aggiungi'}</button>
            </div>
          </div>
          <div id="editCoTeacherChips" class="co-teachers-list"></div>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Recipients (Class, Subgroup or Parallel Classes)' : 'Destinatari (Classe, Gruppo Articolato o Classi Parallele)'}</label>
          <select id="editModalTargetSelect" class="form-select" onchange="onEditTargetSelectChange(this.value)">
            ${targetOpts}
          </select>
          <div id="editCustomTargetDiv" style="display:${isCustomStudent ? 'block' : 'none'};margin-top:6px;">
            <input type="text" id="editModalCustomTarget" class="form-input" value="${escapeHtml((g.students || []).join('+'))}" placeholder="${isEn ? 'E.g. 1C+1D (for PE or merged classes)' : 'Es. 1C+1D (per Scienze Motorie o accorpamenti)'}">
            <span class="form-hint">${isEn ? 'Separate with "+" or comma classes attending together at the same time.' : 'Separa con "+" o virgola le classi che partecipano insieme alla stessa ora.'}</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Subject / Discipline' : 'Materia / Disciplina'}</label>
          <select id="editModalSubject" class="form-select" onchange="onEditModalSubjectChanged()">
            <option value="">-- ${isEn ? 'Select Subject' : 'Seleziona Materia'} --</option>
            ${subjOpts}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">
            <span>${isEn ? 'Dedicated Room / Lab / Gym' : 'Aula Dedicata / Laboratorio / Palestra'}</span>
            <span class="form-hint">${isEn ? 'If omitted, uses class resident homeroom' : 'Se omesso, usa l\'aula base della classe'}</span>
          </label>
          <select id="editModalRoomSelect" class="form-select" onchange="checkEditBuildingTransferWarning()">
            <option value="" data-bld="" data-type="default" ${!currentRoom ? 'selected' : ''}>-- 🏠 ${isEn ? 'Standard Homeroom of Class (No transfer)' : 'Aula Base Ordinaria della Classe (Nessun trasferimento)'} --</option>
            <optgroup label="${isEn ? '🧪 Teaching Laboratories (Triggers campus transfer for classes from other sites)' : '🧪 Laboratori Didattici (Innescano cambio plesso per classi di altra sede)'}">
              ${labs.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="lab" ${currentRoom === r.name ? 'selected' : ''}>🧪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} ${isEn ? 'students' : 'alunni'}]</option>`).join('')}
            </optgroup>
            <optgroup label="${isEn ? '🏀 Gymnasiums / Sports Facilities' : '🏀 Palestre / Impianti Sportivi'}">
              ${gyms.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="gym" ${currentRoom === r.name ? 'selected' : ''}>🏀 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} ${isEn ? 'students' : 'alunni'}]</option>`).join('')}
            </optgroup>
            <optgroup label="${isEn ? '🚪 Special Rooms / Other Spaces' : '🚪 Aule Speciali / Altri Spazi'}">
              ${stdRooms.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="standard" ${currentRoom === r.name ? 'selected' : ''}>🚪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} ${isEn ? 'students' : 'alunni'}]</option>`).join('')}
            </optgroup>
          </select>
          <div id="editBuildingTransferWarning" style="display:none;margin-top:8px;"></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">${isEn ? 'Weekly Hours' : 'Monte Ore Settimanale'}</label>
            <input type="number" id="editModalTotalHours" class="form-input" min="1" max="10" value="${g.total_hours || 3}" oninput="onEditHoursInputChange(this.value)">
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;justify-content:space-between;align-items:center;">
              <span>${isEn ? 'Block Division' : 'Suddivisione Blocchi'}</span>
              ${g.default_blocks ? `
                <span style="font-size:11px;font-weight:normal;color:var(--text-muted);">
                  ${isEn ? 'Standard formula:' : 'Formula standard:'} <b style="color:var(--primary);">${escapeHtml(g.default_blocks)}</b> (${escapeHtml(g.percorso || '')} ${escapeHtml(g.period || '')})
                </span>
              ` : ''}
            </label>
            <div style="display:flex;gap:6px;">
              <input type="text" id="editModalBlocks" class="form-input" value="${escapeHtml(g.blocks || '2+1')}" style="font-weight:700;font-family:var(--font-mono);">
              ${g.default_blocks ? `
                <button type="button" class="btn btn-sm btn-sec" onclick="document.getElementById('editModalBlocks').value='${escapeJs(g.default_blocks)}';selectEditBlockPreset('${escapeJs(g.default_blocks)}');" title="${isEn ? 'Reset to default formula' : 'Reimposta la formula di default'}" style="white-space:nowrap;">
                  ↩️ Default
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <div class="form-group">
          <span class="form-label">${isEn ? 'Block Division Presets:' : 'Preset Suddivisione Blocchi:'}</span>
          <div class="preset-pills" id="editModalPresetsContainer"></div>
          <span class="form-hint" style="margin-top:4px;">
            ${isEn
              ? 'FET automatically ensures each block (e.g. 2 hrs + 1 hr) takes place on <b>different days</b> via <i>ConstraintMinDaysBetweenActivities</i>.'
              : 'FET garantisce automaticamente che ciascun blocco (es. 2 ore + 1 ora) sia svolto in <b>giorni diversi</b> tramite il vincolo <i>ConstraintMinDaysBetweenActivities</i>.'}
          </span>
        </div>

        <div class="form-group">
          <label class="form-label">${isEn ? 'Assignment Notes / Details' : 'Note / Dettagli Cattedra'} <span class="form-hint">(${isEn ? 'optional' : 'opzionale'})</span></label>
          <input type="text" id="editModalComments" class="form-input" value="${escapeHtml(formatNoteForDisplay(g.comments || ''))}" placeholder="${isEn ? 'E.g. Lab with ITP, external timetable assignment...' : 'Es. Laboratorio con ITP, cattedra orario esterna...'}">
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;">
        <button class="btn btn-danger" onclick="deleteCattedra('${g.sub_activity_ids.join(',')}', '${escapeJs(g.teachers_display)} - ${escapeJs(g.subject)} (${escapeJs(g.students_display)})')">🗑️ ${isEn ? 'Delete' : 'Elimina'}</button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
          <button class="btn btn-primary" onclick="submitEditCattedra('${g.sub_activity_ids.join(',')}')">💾 ${isEn ? 'Save Changes' : 'Salva Modifiche'}</button>
        </div>
      </div>
    </div>
  `);

  renderEditCoTeacherChips();
  renderEditBlockPresets(g.total_hours || 3, g.blocks || '2+1');
  checkEditBuildingTransferWarning();
}

function toggleEditCoTeacherRow() {
  const row = document.getElementById('editCoTeacherRow');
  if (row) row.style.display = row.style.display === 'none' ? 'block' : 'none';
}

function addEditCoTeacherChip() {
  const sel = document.getElementById('editModalCoTeacherSelect');
  const subjSel = document.getElementById('editModalSubject');
  const val = sel.value;
  if (!val) return;
  const currSubj = subjSel ? subjSel.value : '';
  const existing = editSelectedCoTeachers.find(t => (typeof t === 'string' ? t : t.teacher) === val);
  if (!existing) {
    editSelectedCoTeachers.push({ teacher: val, subject: currSubj });
    renderEditCoTeacherChips();
  }
  sel.value = '';
}

function updateEditCoTeacherSubject(name, subj) {
  const item = editSelectedCoTeachers.find(t => (typeof t === 'string' ? t : t.teacher) === name);
  if (item) {
    if (typeof item === 'string') {
      const idx = editSelectedCoTeachers.indexOf(name);
      editSelectedCoTeachers[idx] = { teacher: name, subject: subj };
    } else {
      item.subject = subj;
    }
  }
}

function removeEditCoTeacherChip(name) {
  editSelectedCoTeachers = editSelectedCoTeachers.filter(t => (typeof t === 'string' ? t : t.teacher) !== name);
  renderEditCoTeacherChips();
}

function renderEditCoTeacherChips() {
  const cont = document.getElementById('editCoTeacherChips');
  if (!cont) return;
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  const subjects = stateData.subjects || [];

  cont.innerHTML = editSelectedCoTeachers.map(item => {
    const tName = typeof item === 'string' ? item : item.teacher;
    const tSubj = typeof item === 'string' ? '' : item.subject;
    return `
      <div class="co-teacher-row-item">
        <span class="co-teacher-name">👨‍🏫 <b>${escapeHtml(tName)}</b></span>
        <span class="co-teacher-subj-label">${isEn ? 'Subject:' : 'Materia:'}</span>
        <select class="form-select form-select-sm co-teacher-subj-select" onchange="updateEditCoTeacherSubject('${escapeJs(tName)}', this.value)">
          <option value="">-- ${isEn ? 'Default (Inherit Main Subject)' : 'Predefinita (Eredita materia principale)'} --</option>
          ${subjects.map(s => `<option value="${escapeHtml(s.name)}" ${(tSubj === s.name) ? 'selected' : ''}>${escapeHtml(s.name)}${s.cdc ? ' [' + escapeHtml(s.cdc) + ']' : ''}</option>`).join('')}
        </select>
        <button type="button" class="btn-remove-coteacher" onclick="removeEditCoTeacherChip('${escapeJs(tName)}')" title="${isEn ? 'Remove co-teacher' : 'Rimuovi compresenza'}">✕</button>
      </div>
    `;
  }).join('');
}

function onEditTargetSelectChange(val) {
  const customDiv = document.getElementById('editCustomTargetDiv');
  if (customDiv) {
    customDiv.style.display = val === '__CUSTOM__' ? 'block' : 'none';
  }
  checkEditBuildingTransferWarning();
}

function onEditHoursInputChange(val) {
  const h = parseInt(val) || 1;
  renderEditBlockPresets(h);
}

function renderEditBlockPresets(hours, currentBlock = null) {
  const cont = document.getElementById('editModalPresetsContainer');
  if (!cont) return;
  let presets = [];
  if (hours === 1) presets = ['1'];
  else if (hours === 2) presets = ['2', '1+1'];
  else if (hours === 3) presets = ['2+1', '1+1+1', '3'];
  else if (hours === 4) presets = ['2+2', '2+1+1', '3+1', '1+1+1+1'];
  else if (hours === 5) presets = ['2+2+1', '3+2', '2+1+1+1'];
  else if (hours === 6) presets = ['2+2+1+1', '2+2+2', '3+3'];
  else if (hours === 7) presets = ['2+2+2+1', '2+2+1+1+1', '3+2+2'];
  else if (hours === 8) presets = ['2+2+2+2', '2+2+2+1+1'];
  else if (hours === 9) presets = ['3+2+2+2', '2+2+2+2+1'];
  else if (hours === 10) presets = ['3+3+2+2', '2+2+2+2+2'];
  else {
    presets = [`${Math.floor(hours / 2)}+${Math.ceil(hours / 2)}`];
  }

  if (currentBlock && !presets.includes(currentBlock)) {
    presets.unshift(currentBlock);
  }

  const input = document.getElementById('editModalBlocks');
  if (currentBlock && presets.includes(currentBlock)) {
    if (input) input.value = currentBlock;
  } else if (input && (!input.value || !presets.includes(input.value))) {
    input.value = presets[0];
  }

  cont.innerHTML = presets.map(p => `
    <button type="button" class="preset-pill ${input && input.value === p ? 'active' : ''}" onclick="selectEditBlockPreset('${p}')">
      ${p}
    </button>
  `).join('');
}

function selectEditBlockPreset(p) {
  const input = document.getElementById('editModalBlocks');
  if (input) input.value = p;
  document.querySelectorAll('#editModalPresetsContainer .preset-pill').forEach(el => {
    el.classList.toggle('active', el.innerText.trim() === p);
  });
}

function checkEditBuildingTransferWarning() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const roomSel = document.getElementById('editModalRoomSelect');
  const targetSel = document.getElementById('editModalTargetSelect');
  const warnDiv = document.getElementById('editBuildingTransferWarning');
  if (!roomSel || !targetSel || !warnDiv) return;

  const roomName = roomSel.value;
  const targetVal = targetSel.value;

  if (!roomName) {
    warnDiv.style.display = 'none';
    warnDiv.innerHTML = '';
    return;
  }

  const selectedOpt = roomSel.options[roomSel.selectedIndex];
  const roomBuilding = selectedOpt ? selectedOpt.getAttribute('data-bld') : '';
  const roomType = selectedOpt ? selectedOpt.getAttribute('data-type') : '';

  // Trova il plesso della classe
  let classObj = (stateData.classes || []).find(c => c.name === targetVal);
  if (!classObj && targetVal) {
    const grp = (stateData.groups || []).find(g => g.name === targetVal);
    if (grp) {
      classObj = (stateData.classes || []).find(c => c.name === grp.class_name);
    }
  }

  const classBuilding = classObj ? (classObj.building || 'Centrale') : 'Centrale';

  if (roomBuilding && classBuilding && roomBuilding.toLowerCase() !== classBuilding.toLowerCase()) {
    warnDiv.className = 'info-banner';
    warnDiv.style.display = 'block';
    warnDiv.innerHTML = isEn ? `
      ⚡ <b>CAMPUS TRANSFER DETECTED:</b><br>
      Class <b>${escapeHtml(targetVal || 'selected')}</b> resides in <b>${escapeHtml(classBuilding)}</b>,
      while <b>${escapeHtml(roomName)}</b> is located in <b>${escapeHtml(roomBuilding)}</b>.<br>
      FET will automatically enforce campus travel time and transfer constraints.
    ` : `
      ⚡ <b>CAMBIO DI PLESSO RILEVATO:</b><br>
      La classe <b>${escapeHtml(targetVal || 'selezionata')}</b> risiede in <b>${escapeHtml(classBuilding)}</b>,
      mentre lo spazio <b>${escapeHtml(roomName)}</b> si trova in <b>${escapeHtml(roomBuilding)}</b>.<br>
      FET applicherà automaticamente il vincolo di trasferimento tra sedi e gli intervalli minimi di percorrenza.
    `;
  } else if (roomType === 'lab' || roomType === 'gym') {
    warnDiv.className = 'info-banner info-banner-blue';
    warnDiv.style.display = 'block';
    warnDiv.innerHTML = isEn ? `
      ℹ️ <b>Dedicated facility:</b> <b>${escapeHtml(roomName)}</b> is on the same campus (<b>${escapeHtml(roomBuilding || classBuilding)}</b>). No campus transfer needed.
    ` : `
      ℹ️ <b>Spazio speciale dedicato:</b> <b>${escapeHtml(roomName)}</b> si trova nella stessa sede (<b>${escapeHtml(roomBuilding || classBuilding)}</b>). Non comporta cambio di plesso tra edifici.
    `;
  } else {
    warnDiv.style.display = 'none';
    warnDiv.innerHTML = '';
  }
}

async function submitEditCattedra(oldSubIdsStr) {
  const primaryTeacher = document.getElementById('editModalTeacher').value.trim();
  const targetVal = document.getElementById('editModalTargetSelect').value.trim();
  const customTarget = document.getElementById('editCustomTargetDiv') && document.getElementById('editModalCustomTarget') ? document.getElementById('editModalCustomTarget').value.trim() : '';
  const subject = document.getElementById('editModalSubject').value.trim();
  const room = document.getElementById('editModalRoomSelect') ? document.getElementById('editModalRoomSelect').value.trim() : '';
  const totalHours = parseInt(document.getElementById('editModalTotalHours').value) || 0;
  const blocks = document.getElementById('editModalBlocks').value.trim();
  const active = document.getElementById('editModalActive') ? document.getElementById('editModalActive').checked : true;
  const comments = document.getElementById('editModalComments').value.trim();

  let targetStudents = [];
  if (targetVal === '__CUSTOM__') {
    if (!customTarget) {
      alert('Specificare le classi accorpate (es. 1C+1D).');
      return;
    }
    targetStudents = customTarget.replace(/,/g, '+').split('+').map(s => s.trim()).filter(Boolean);
  } else if (targetVal) {
    targetStudents = [targetVal];
  }

  if (!targetStudents.length) {
    alert('Selezionare almeno una classe o gruppo destinatario.');
    return;
  }
  if (!subject) {
    alert('Selezionare la materia.');
    return;
  }
  if (totalHours <= 0) {
    alert('Inserire un monte ore valido.');
    return;
  }

  // Verifica somma blocchi
  const blockParts = blocks.replace(/,/g, '+').split('+').map(x => parseInt(x.trim()) || 0);
  const blockSum = blockParts.reduce((a, b) => a + b, 0);
  if (blockSum !== totalHours) {
    alert(`La somma della suddivisione in blocchi (${blockSum}) non corrisponde al monte ore settimanale (${totalHours}).`);
    return;
  }

  const allTeachers = [];
  const teacherSubjects = {};
  if (primaryTeacher) {
    allTeachers.push(primaryTeacher);
    teacherSubjects[primaryTeacher] = subject;
  }
  editSelectedCoTeachers.forEach(item => {
    const tName = typeof item === 'string' ? item : item.teacher;
    const tSubj = (typeof item === 'object' && item.subject) ? item.subject : subject;
    if (!allTeachers.includes(tName)) allTeachers.push(tName);
    teacherSubjects[tName] = tSubj;
  });

  const payload = {
    sub_ids: oldSubIdsStr.split(','),
    teachers: allTeachers,
    teacher_subjects: teacherSubjects,
    students: targetStudents,
    subject: subject,
    total_hours: totalHours,
    blocks: blocks,
    room: room,
    active: active,
    comments: comments
  };

  const res = await fetch('/api/cattedre/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    editSelectedCoTeachers = [];
    closeModal();
    showToast(`Cattedra aggiornata con successo (${targetStudents.join('+')} - ${subject})!`);
    renderActivities();
  } else {
    const err = await res.json();
    alert("Errore durante l'aggiornamento della cattedra: " + (err.error || 'Dati non validi'));
  }
}

// ============================================================================
// MODALE: MODIFICA SINGOLA SOTTO-ATTIVITÀ FET (RAW)
// ============================================================================
async function openEditSingleActivityModal(actId) {
  const act = (stateData.activities || []).find(a => String(a.id) === String(actId));
  if (!act) return;

  const [teachers, classes, groups, subjects, roomsData] = await Promise.all([
    fetch('/api/teachers').then(r => r.json()),
    fetch('/api/classes').then(r => r.json()),
    fetch('/api/groups').then(r => r.json()),
    fetch('/api/subjects').then(r => r.json()),
    fetch('/api/rooms').then(r => r.json())
  ]);
  stateData.teachers = teachers;
  stateData.classes = classes;
  stateData.groups = groups;
  stateData.subjects = subjects;
  stateData.rooms = roomsData.rooms || [];

  const actTeacher = (act.teachers && act.teachers.length > 0) ? act.teachers[0] : '';
  const actStudent = (act.students && act.students.length > 0) ? act.students[0] : '';
  const actSubject = act.subject || '';
  const actRoom = act.room || '';
  const actDur = act.duration || 1;
  const actActive = act.active !== false;
  const actComments = formatNoteForDisplay(act.comments || '');

  const teacherOpts = teachers.map(t => `
    <option value="${escapeHtml(t.name)}" ${actTeacher === t.name ? 'selected' : ''}>${escapeHtml(t.name)}</option>
  `).join('');

  let targetOpts = `<optgroup label="Classi Intere">` +
    classes.map(c => `
      <option value="${escapeHtml(c.name)}" ${actStudent === c.name ? 'selected' : ''}>
        Classe ${escapeHtml(c.name)} (${c.students || 0} alunni)
      </option>
    `).join('') +
    `</optgroup>`;
  if (groups.length > 0) {
    targetOpts += `<optgroup label="Gruppi Articolati">` +
      groups.map(grp => `
        <option value="${escapeHtml(grp.name)}" ${actStudent === grp.name ? 'selected' : ''}>
          Gruppo ${escapeHtml(grp.name)} (${escapeHtml(grp.class_name)})
        </option>
      `).join('') +
      `</optgroup>`;
  }

  const subjOpts = subjects.map(s => `
    <option value="${escapeHtml(s.name)}" ${actSubject === s.name ? 'selected' : ''}>${escapeHtml(s.name)}</option>
  `).join('');

  const rooms = stateData.rooms;
  const labs = rooms.filter(r => r.room_type === 'lab' || (!r.room_type && r.is_lab_or_gym));
  const gyms = rooms.filter(r => r.room_type === 'gym' || (r.name || '').toLowerCase().includes('palestra'));
  const stdRooms = rooms.filter(r => !labs.includes(r) && !gyms.includes(r));

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">✏️ Modifica Sotto-Attività FET #${act.id}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="background:#f8fafc;padding:8px 12px;border-radius:6px;border:1px solid var(--border);margin-bottom:12px;font-size:12.5px;display:flex;justify-content:space-between;align-items:center;">
          <span>ID FET: <b>#${act.id}</b> ${act.group_id ? `(Gruppo Cattedra #${act.group_id})` : ''}</span>
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;margin:0;">
            <input type="checkbox" id="editActActive" ${actActive ? 'checked' : ''} style="width:16px;height:16px;">
            <span>Attiva in FET</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">Docente Titolare</label>
          <select id="editActTeacher" class="form-select">
            <option value="">-- Seleziona Docente --</option>
            ${teacherOpts}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Classe / Gruppo Destinatario</label>
          <select id="editActTarget" class="form-select">
            ${targetOpts}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Materia / Disciplina</label>
          <select id="editActSubject" class="form-select">
            <option value="">-- Seleziona Materia --</option>
            ${subjOpts}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Durata Blocco (Ore consecutive)</label>
          <input type="number" id="editActDuration" class="form-input" min="1" max="6" value="${actDur}">
        </div>

        <div class="form-group">
          <label class="form-label">Spazio / Laboratorio / Palestra</label>
          <select id="editActRoom" class="form-select">
            <option value="" ${!actRoom ? 'selected' : ''}>-- 🏠 Aula Base Ordinaria --</option>
            <optgroup label="🧪 Laboratori Didattici">
              ${labs.map(r => `<option value="${escapeHtml(r.name)}" ${actRoom === r.name ? 'selected' : ''}>🧪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')}]</option>`).join('')}
            </optgroup>
            <optgroup label="🏀 Palestre / Sport">
              ${gyms.map(r => `<option value="${escapeHtml(r.name)}" ${actRoom === r.name ? 'selected' : ''}>🏀 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')}]</option>`).join('')}
            </optgroup>
            <optgroup label="🚪 Altre Aule">
              ${stdRooms.map(r => `<option value="${escapeHtml(r.name)}" ${actRoom === r.name ? 'selected' : ''}>🚪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')}]</option>`).join('')}
            </optgroup>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Note / Commenti</label>
          <input type="text" id="editActComments" class="form-input" value="${escapeHtml(actComments)}">
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;">
        <button class="btn btn-danger" onclick="deleteActivity('${act.id}')">🗑️ Elimina</button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
          <button class="btn btn-primary" onclick="submitEditSingleActivity('${act.id}')">💾 Salva Modifiche</button>
        </div>
      </div>
    </div>
  `);
}

async function submitEditSingleActivity(actId) {
  const teacher = document.getElementById('editActTeacher').value.trim();
  const target = document.getElementById('editActTarget').value.trim();
  const subject = document.getElementById('editActSubject').value.trim();
  const duration = parseInt(document.getElementById('editActDuration').value) || 1;
  const room = document.getElementById('editActRoom').value.trim();
  const active = document.getElementById('editActActive').checked;
  const comments = document.getElementById('editActComments').value.trim();

  if (!target) {
    alert('Selezionare una classe o gruppo destinatario.');
    return;
  }
  if (!subject) {
    alert('Selezionare la materia.');
    return;
  }

  const payload = {
    id: String(actId),
    teachers: teacher ? [teacher] : [],
    students: [target],
    subject: subject,
    duration: duration,
    room: room,
    active: active,
    comments: comments
  };

  const res = await fetch('/api/activities/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    closeModal();
    showToast(`Attività #${actId} aggiornata!`);
    renderActivities();
  } else {
    alert("Errore durante l'aggiornamento dell'attività.");
  }
}

// --- MODALE: MODIFICA SUDDIVISIONE BLOCCHI ---
function openEditBlocksModal(subIdsStr, currentBlocks, totalHours, desc, defaultBlocks = '', subject = '', className = '', percorso = '', period = '', isFeasible = true, feasibilityWarning = '', suggestedBlocks = '') {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  let presets = [];
  if (totalHours === 1) presets = ['1'];
  else if (totalHours === 2) presets = ['2', '1+1'];
  else if (totalHours === 3) presets = ['2+1', '1+1+1', '3'];
  else if (totalHours === 4) presets = ['2+2', '3+1', '1+1+1+1', '4'];
  else if (totalHours === 5) presets = ['2+2+1', '3+2', '1+1+1+1+1'];
  else if (totalHours === 6) presets = ['2+2+2', '3+3', '2+2+1+1'];
  else if (totalHours === 7) presets = ['2+2+2+1', '2+2+1+1+1', '3+2+2'];
  else if (totalHours === 8) presets = ['2+2+2+2', '3+3+2', '2+2+2+1+1'];
  else if (totalHours === 9) presets = ['2+2+2+2+1', '3+2+2+2', '3+3+3'];
  else if (totalHours === 10) presets = ['2+2+2+2+2', '3+3+2+2', '3+3+3+1'];
  else {
    presets = [`${totalHours}`, `${Math.floor(totalHours / 2)}+${Math.ceil(totalHours / 2)}`];
  }

  if (defaultBlocks && !presets.includes(defaultBlocks)) {
    presets.push(defaultBlocks);
  }
  if (suggestedBlocks && !presets.includes(suggestedBlocks)) {
    presets.push(suggestedBlocks);
  }

  const isExc = defaultBlocks && (currentBlocks !== defaultBlocks);

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">⏱️ ${isEn ? 'Edit Timetable Blocks & Exceptions' : 'Modifica Blocchi Orari & Eccezioni'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="background:#f8fafc;padding:12px;border-radius:6px;border:1px solid var(--border);font-size:13px;margin-bottom:12px;">
          <b>${isEn ? 'Assignment:' : 'Cattedra:'}</b> ${escapeHtml(desc)}<br>
          <b>${isEn ? 'Total weekly hours:' : 'Monte ore complessivo:'}</b> <span style="color:var(--primary);font-weight:700;">${totalHours} ${isEn ? 'weekly hrs' : 'h settimanali'}</span>
          ${percorso ? `<br><b>${isEn ? 'Track & Period:' : 'Indirizzo & Periodo:'}</b> <span class="badge ${percorso === 'liceo' ? 'badge-liceo' : (percorso === 'tecnico' ? 'badge-tecnico' : 'badge-professionale')}">${escapeHtml(isEn ? (percorso === 'liceo' ? 'HIGH SCHOOL' : (percorso === 'tecnico' ? 'TECHNICAL' : 'VOCATIONAL')) : percorso.toUpperCase())} (${period})</span>` : ''}
        </div>

        ${(!isFeasible && feasibilityWarning) ? `
          <div class="info-banner" style="margin-top:0;margin-bottom:14px;background:#fef2f2;border-color:#fecaca;color:#991b1b;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div>
                ⚠️ <b>${isEn ? 'Conflict with teacher availability:' : 'Conflitto con la presenza del docente:'}</b>
                <div style="font-size:12px;margin-top:2px;color:#b91c1c;">${escapeHtml(feasibilityWarning)}</div>
              </div>
              ${suggestedBlocks ? `
                <button class="btn btn-sm btn-danger" type="button" onclick="selectEditBlockPreset('${escapeJs(suggestedBlocks)}', '${escapeJs(defaultBlocks)}')" style="white-space:nowrap;">
                  💡 ${isEn ? 'Apply' : 'Applica'} ${escapeHtml(suggestedBlocks)}
                </button>
              ` : ''}
            </div>
          </div>
        ` : ''}

        ${defaultBlocks ? `
          <div class="info-banner" style="margin-top:0;margin-bottom:14px;background:#f0fdf4;border-color:#bbf7d0;color:#166534;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                📐 <b>${isEn ? 'Standard Default Formula:' : 'Formula Standard di Default:'}</b> <span class="block-badge block-default" style="font-size:13px;font-weight:700;">${escapeHtml(defaultBlocks)}</span>
                <div style="font-size:11.5px;color:#15803d;margin-top:2px;">
                  ${isEn
                    ? `Default for <b>${escapeHtml(subject || 'this subject')}</b> (${escapeHtml(percorso || 'track')} ${escapeHtml(period || '')}).`
                    : `Prevista per <b>${escapeHtml(subject || 'questa materia')}</b> (${escapeHtml(percorso || 'indirizzo')} ${escapeHtml(period || '')}).`}
                </div>
              </div>
              <button class="btn btn-sm btn-sec" type="button" onclick="selectEditBlockPreset('${escapeJs(defaultBlocks)}', '${escapeJs(defaultBlocks)}')" style="white-space:nowrap;">
                ↩️ ${isEn ? 'Select Default' : 'Seleziona Default'}
              </button>
            </div>
          </div>
        ` : ''}

        <div class="form-group">
          <label class="form-label" style="display:flex;justify-content:space-between;align-items:center;">
            <span>${isEn ? 'Applied Timetable Block Division:' : 'Suddivisione Blocchi Orari Applicata:'}</span>
            <span id="blockExceptionBadge">
              ${isExc ? `<span class="exc-tag">⚡ ${isEn ? 'Custom Exception' : 'Eccezione Personalizzata'}</span>` : `<span class="badge badge-ok">${isEn ? 'Default Standard' : 'Standard di Default'}</span>`}
            </span>
          </label>
          <input type="text" id="editBlocksInput" class="form-input" value="${escapeHtml(currentBlocks)}" style="font-weight:700;font-family:var(--font-mono);font-size:15px;" oninput="onEditBlocksInputChange('${escapeJs(defaultBlocks)}')">
          <span class="form-hint" id="blockExceptionHint" style="margin-top:4px;">
            ${isExc
              ? (isEn
                  ? `⚡ This assignment differs from standard (<b>${escapeHtml(defaultBlocks)}</b>) and is saved as an exception.`
                  : `⚡ Questa cattedra differisce dallo standard (<b>${escapeHtml(defaultBlocks)}</b>) ed è registrata come eccezione.`)
              : (isEn ? 'This assignment matches the default standard formula.' : 'Questa cattedra coincide con la formula standard di default.')}
          </span>
        </div>

        <div class="form-group">
          <span class="form-label">${isEn ? `Block division presets (total ${totalHours}h):` : `Preset suddivisione (totale ${totalHours}h):`}</span>
          <div class="preset-pills">
            ${presets.map(p => {
              const isDef = defaultBlocks === p;
              const isSug = suggestedBlocks === p;
              const badgeTxt = isSug ? (isEn ? '💡 (Recommended for teacher days)' : '💡 (Consigliato per giorni docente)') : (isDef ? (isEn ? '⭐ (Default)' : '⭐ (Default)') : '');
              return `
                <button type="button" class="preset-pill ${p === currentBlocks ? 'active' : ''}" onclick="selectEditBlockPreset('${p}', '${escapeJs(defaultBlocks)}')">
                  ${p} ${badgeTxt}
                </button>
              `;
            }).join('')}
          </div>
          <span class="form-hint" style="margin-top:6px;">
            ${isEn
              ? 'FET automatically ensures that each block (e.g. <code>2+1</code>) is scheduled on <b>different days</b>.'
              : 'FET garantisce automaticamente che ogni blocco (es. <code>2+1</code>) si svolga in <b>giorni diversi</b>.'}
          </span>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;">
        ${defaultBlocks ? `
          <button class="btn btn-sec" type="button" onclick="submitResetBlocksToDefault('${subIdsStr}', ${totalHours})">
            ↩️ ${isEn ? `Reset Default (${escapeHtml(defaultBlocks)})` : `Ripristina Default (${escapeHtml(defaultBlocks)})`}
          </button>
        ` : '<div></div>'}
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
          <button class="btn btn-primary" onclick="submitUpdateBlocks('${subIdsStr}', ${totalHours})">💾 ${isEn ? 'Save Division' : 'Salva Suddivisione'}</button>
        </div>
      </div>
    </div>
  `);
}

function selectEditBlockPreset(p, defaultBlocks = '') {
  const inp = document.getElementById('editBlocksInput');
  if (inp) {
    inp.value = p;
    onEditBlocksInputChange(defaultBlocks);
  }
  document.querySelectorAll('.preset-pill').forEach(el => {
    el.classList.toggle('active', el.innerText.trim().startsWith(p));
  });
}

function onEditBlocksInputChange(defaultBlocks = '') {
  const inp = document.getElementById('editBlocksInput');
  const badgeSpan = document.getElementById('blockExceptionBadge');
  const hintSpan = document.getElementById('blockExceptionHint');
  if (!inp || !defaultBlocks) return;
  const val = inp.value.trim();
  const isExc = (val !== defaultBlocks);
  if (badgeSpan) {
    badgeSpan.innerHTML = isExc ? `<span class="exc-tag">⚡ Eccezione Personalizzata</span>` : `<span class="badge badge-ok">Standard di Default</span>`;
  }
  if (hintSpan) {
    hintSpan.innerHTML = isExc ? `⚡ Questa cattedra differisce dallo standard (<b>${escapeHtml(defaultBlocks)}</b>) ed è registrata come eccezione.` : `Questa cattedra coincide con la formula standard di default.`;
  }
}

async function submitResetBlocksToDefault(subIdsStr, totalHours) {
  try {
    const res = await fetch('/api/cattedre/reset_default_blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_ids: subIdsStr.split(',') })
    });
    if (res.ok) {
      closeModal();
      showToast("Suddivisione blocchi ripristinata al default stabilito!", "success");
      if (currentView === 'activities') renderActivities();
      else if (currentView === 'accorpamenti') renderAccorpamenti();
      else if (currentView === 'block_rules') renderBlockRulesView();
    } else {
      const err = await res.json();
      alert("Errore ripristino default: " + (err.error || 'Operazione fallita'));
    }
  } catch (e) {
    alert("Errore di rete: " + e.message);
  }
}

async function submitUpdateBlocks(subIdsStr, totalHours) {
  const newBlocks = document.getElementById('editBlocksInput').value.trim();
  const parts = newBlocks.replace(/,/g, '+').split('+').map(x => parseInt(x.trim()) || 0);
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum !== totalHours) {
    alert(`La somma dei blocchi (${sum}) deve essere esattamente uguale al monte ore complessivo (${totalHours}).`);
    return;
  }

  const res = await fetch('/api/cattedre/update_blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sub_ids: subIdsStr.split(','),
      blocks: newBlocks
    })
  });

  if (res.ok) {
    closeModal();
    showToast("Suddivisione blocchi orari salvata con successo!");
    if (currentView === 'accorpamenti') {
      renderAccorpamenti();
    } else {
      renderActivities();
    }
  } else {
    alert("Errore durante l'aggiornamento dei blocchi.");
  }
}

async function deleteCattedra(subIdsStr, desc) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const ids = subIdsStr.split(',');
  const confirmMsg = isEn 
    ? `Are you sure you want to delete teaching assignment:\n"${desc}"\nand all its ${ids.length} linked FET sub-activities?` 
    : `Sei sicuro di voler eliminare la cattedra:\n"${desc}"\ne tutte le sue ${ids.length} sotto-attività FET collegate?`;
  if (confirm(confirmMsg)) {
    const res = await fetch('/api/cattedre/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_ids: ids })
    });
    if (res.ok) {
      renderActivities();
    } else {
      alert(isEn ? 'Error deleting teaching assignment.' : "Errore durante l'eliminazione della cattedra.");
    }
  }
}

// --- GESTIONE MODALI GENERICHE CON ACCESSIBILITÀ WCAG (Focus Trap & ARIA Dialog) ---
let lastFocusedElementBeforeModal = null;
let activeModalKeydownListener = null;

function showModal(html) {
  lastFocusedElementBeforeModal = document.activeElement;
  closeModal();

  const modalDiv = document.createElement('div');
  modalDiv.id = 'activeModal';
  modalDiv.className = 'modal-backdrop';
  modalDiv.setAttribute('role', 'dialog');
  modalDiv.setAttribute('aria-modal', 'true');
  modalDiv.innerHTML = html;

  modalDiv.addEventListener('click', (e) => {
    if (e.target === modalDiv) closeModal();
  });

  document.body.appendChild(modalDiv);

  if (window.I18N) {
    window.I18N.applyStaticTranslations(modalDiv);
  }

  // WCAG 2.1.2 & 2.4.3: Focus Trap all'interno della modale attiva
  const focusableSelector = 'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusableElements = Array.from(modalDiv.querySelectorAll(focusableSelector)).filter(el => !el.disabled && el.offsetParent !== null);
  if (focusableElements.length > 0) {
    setTimeout(() => {
      try { focusableElements[0].focus(); } catch (err) {}
    }, 60);
  }

  activeModalKeydownListener = function(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Tab') {
      const currentFocusables = Array.from(modalDiv.querySelectorAll(focusableSelector)).filter(el => !el.disabled && el.offsetParent !== null);
      if (currentFocusables.length === 0) return;
      const firstEl = currentFocusables[0];
      const lastEl = currentFocusables[currentFocusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl || !modalDiv.contains(document.activeElement)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl || !modalDiv.contains(document.activeElement)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  };

  document.addEventListener('keydown', activeModalKeydownListener);
}

function closeModal() {
  if (activeModalKeydownListener) {
    document.removeEventListener('keydown', activeModalKeydownListener);
    activeModalKeydownListener = null;
  }
  const m = document.getElementById('activeModal');
  if (m) m.remove();

  if (lastFocusedElementBeforeModal && typeof lastFocusedElementBeforeModal.focus === 'function') {
    try { lastFocusedElementBeforeModal.focus(); } catch (err) {}
    lastFocusedElementBeforeModal = null;
  }
}

// ============================================================================
// 9. INDISPONIBILITÀ VISUALE (GRIGLIA INTERATTIVA)
// ============================================================================
// ============================================================================
// 9. INDISPONIBILITÀ (VISTA CALENDARIO SINGOLO & MATRICE COMPLETA STILE EXCEL)
// ============================================================================
let activeAvailLayout = 'single'; // 'single' | 'matrix'
let activeAvailMode = 'teacher';  // 'teacher' | 'class'
let activeAvailEntity = '';
let activeMatrixFilter = 'teachers';   // 'teachers' | 'classes'
let matrixPendingChanges = {};    // entityKey -> Set of unavail slots

async function renderAvailability() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const res = await fetch('/api/availability');
  const av = await res.json();
  stateData.availability = av;

  const container = document.getElementById('mainContent');
  const rawTeacherList = av.all_teachers || Object.keys(av.teachers || {}).sort();
  // Classi ordinate naturalmente per anno di corso e sezione (1A, 1B ... 5L)
  const classList = (av.all_classes || Object.keys(av.classes || {})).sort(naturalClassCompare);
  const liceoSet = new Set(av.liceo_classes || []);

  // Filtraggio docenti se filtro globale per materia è attivo
  const globalSubjFlt = (window.GLOBAL_SUBJECT_FILTER || '').trim();
  let teacherList = rawTeacherList;
  if (globalSubjFlt) {
    const linked = new Set(getTeachersForGlobalSubject(globalSubjFlt));
    const flt = rawTeacherList.filter(t => linked.has(t));
    if (flt.length > 0) teacherList = flt;
  }

  if (!activeAvailEntity) {
    activeAvailEntity = activeAvailMode === 'teacher' ? (teacherList[0] || '') : (classList[0] || '');
  }

  // Assicura che i dati dettagliati dei docenti siano caricati per mostrare le preferenze
  if (!stateData.teachers || stateData.teachers.length === 0) {
    try {
      const tRes = await fetch('/api/teachers');
      stateData.teachers = await tRes.json();
    } catch(e) {}
  }
  const curTeacher = (stateData.teachers || []).find(t => t.name === activeAvailEntity);

  const isSingle = (activeAvailLayout === 'single');
  const currentAvailList = (activeAvailMode === 'teacher' ? teacherList : classList);
  const curAvailIdx = currentAvailList.indexOf(activeAvailEntity);
  const totalAvailEntities = currentAvailList.length;

  const returnDesc = activeAvailEntity
    ? (isEn
        ? `Unavailability configuration for <b>${escapeHtml(activeAvailEntity)}</b> (${activeAvailMode === 'class' ? 'Class' : 'Teacher'})`
        : `Configurazione indisponibilità per <b>${escapeHtml(activeAvailEntity)}</b> (${activeAvailMode === 'class' ? 'Classe' : 'Docente'})`)
    : (isEn ? 'Configure weekly unavailable time slots.' : 'Configura gli slot settimanali non disponibili.');

  container.innerHTML = `
    ${getGlobalFilterBannerHtml()}
    ${getNavReturnBarHtml(returnDesc)}

    <!-- Barra Superiore di Selezione Layout (Singolo vs Matrice Excel) -->
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div class="segmented-control">
            <button class="segmented-btn ${isSingle ? 'active' : ''}" onclick="switchAvailLayout('single')">
              ${isEn ? '👤 Single Calendar' : '👤 Calendario Singolo'}
            </button>
            <button class="segmented-btn ${!isSingle ? 'active' : ''}" onclick="switchAvailLayout('matrix')">
              ${isEn ? '📋 Full Matrix (All Records - Excel Style)' : '📋 Matrice Completa (Tutti i Record - Stile Excel)'}
            </button>
          </div>

          ${isSingle ? `
            <div style="display:flex;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-left:6px;">
              <button class="btn btn-sm ${activeAvailMode === 'teacher' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchAvailMode('teacher')">👨‍🏫 ${isEn ? 'Teachers' : 'Docenti'} (${teacherList.length})</button>
              <button class="btn btn-sm ${activeAvailMode === 'class' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchAvailMode('class')">🎓 ${isEn ? 'Classes' : 'Classi'} (${classList.length})</button>
            </div>

            <select id="availSelect" class="select-input" onchange="switchAvailEntity(this.value)">
              ${currentAvailList.map(name => {
                const isLic = activeAvailMode === 'class' && liceoSet.has(name);
                return `<option value="${escapeHtml(name)}" ${name === activeAvailEntity ? 'selected' : ''}>
                  ${escapeHtml(name)} ${isLic ? (isEn ? '🏛️ (High School - max 6h)' : '🏛️ (Liceo - max 6h)') : ''}
                </option>`;
              }).join('')}
            </select>

            <!-- Cursore e Stepper Rapido di Scorrimento Docenti/Classi (Mouse e Frecce ◀ ▶) -->
            <div class="timetable-stepper-wrap" title="${isEn ? `Quickly browse ${activeAvailMode === 'teacher' ? 'teachers' : 'classes'}: drag slider or use ◀ ▶ keys` : `Scorri velocemente tra i ${activeAvailMode === 'teacher' ? 'docenti' : 'classi'}: trascina il cursore o usa le frecce ◀ ▶ della tastiera`}">
              <button type="button" class="btn btn-sm btn-sec" style="padding:2px 7px;font-size:11px;font-weight:700;" onclick="stepAvailEntity(-1)" ${curAvailIdx <= 0 ? 'disabled' : ''} title="${isEn ? 'Previous (or press Left Arrow ◀)' : 'Precedente (oppure premi Freccia Sinistra ◀)'}">◀</button>
              <input type="range" class="slider-quick-entity" min="0" max="${Math.max(0, totalAvailEntities - 1)}" value="${curAvailIdx >= 0 ? curAvailIdx : 0}" oninput="onAvailSliderChange(this.value)" title="${isEn ? 'Drag slider to browse quickly' : 'Trascina il cursore per scorrere rapidamente'}">
              <button type="button" class="btn btn-sm btn-sec" style="padding:2px 7px;font-size:11px;font-weight:700;" onclick="stepAvailEntity(1)" ${curAvailIdx >= totalAvailEntities - 1 ? 'disabled' : ''} title="${isEn ? 'Next (or press Right Arrow ▶)' : 'Successivo (oppure premi Freccia Destra ▶)'}">▶</button>
              <span style="font-size:11px;font-weight:700;color:var(--text-sub);min-width:44px;text-align:center;">${curAvailIdx >= 0 ? curAvailIdx + 1 : 1}/${totalAvailEntities}</span>
              <span style="font-size:10.5px;color:#94a3b8;" title="${isEn ? 'Keyboard shortcut: press ◀ ▶ arrows to navigate' : 'Scorciatoia tastiera: premi le frecce ◀ ▶ per scorrere'}">⌨️ ◀ ▶</span>
            </div>

            ${activeAvailMode === 'class' && liceoSet.has(activeAvailEntity) ? `
              <span class="badge badge-liceo">
                ${isEn ? '🏛️ High School Class (6 hrs max/day: 7th & 8th periods blocked)' : '🏛️ Classe Liceo (6 ore max/giorno: 7ª e 8ª ora bloccate)'}
              </span>
            ` : ''}
          ` : `
            <div class="segmented-control" style="margin-left:6px;">
              <button class="segmented-btn ${activeMatrixFilter === 'teachers' ? 'active' : ''}" onclick="filterMatrixRows('teachers')">
                👨‍🏫 ${isEn ? 'Teachers Only' : 'Solo Docenti'} (${teacherList.length})
              </button>
              <button class="segmented-btn ${activeMatrixFilter === 'classes' ? 'active' : ''}" onclick="filterMatrixRows('classes')">
                🎓 ${isEn ? 'Classes Only' : 'Solo Classi'} (${classList.length})
              </button>
            </div>
            <input type="text" class="search-input" placeholder="${isEn ? `🔍 Search ${activeMatrixFilter === 'teachers' ? 'teacher' : 'class'}...` : `🔍 Cerca ${activeMatrixFilter === 'teachers' ? 'docente' : 'classe'}...`}" oninput="filterMatrixTable(this.value)" style="width:200px;">
          `}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isSingle ? `
            ${activeAvailMode === 'class' ? `
              <button class="btn btn-sm btn-sec" onclick="applyLiceoPreset(activeAvailEntity)" title="${isEn ? 'Set 7th and 8th periods unavailable for this class' : 'Imposta 7ª e 8ª ora non disponibili per questa classe'}">
                ⚡ ${isEn ? `High School Schedule for ${escapeHtml(activeAvailEntity)}` : `Orario Liceo per ${escapeHtml(activeAvailEntity)}`}
              </button>
            ` : ''}
            <button class="btn btn-sm btn-sec" onclick="applyLiceoPresetAll()" title="${isEn ? 'Apply to all 15 High School classes' : 'Applica a tutte le 15 classi del Liceo'}">
              ⚡ ${isEn ? 'Apply to All High School' : 'Applica a Tutto il Liceo'}
            </button>
            <button class="btn btn-primary" onclick="saveAvailability()">💾 ${isEn ? 'Save Changes' : 'Salva Modifiche'}</button>
          ` : `
            <button class="btn btn-sm btn-sec" onclick="applyLiceoPresetAll()" title="${isEn ? 'Apply to all 15 High School classes' : 'Applica a tutte le 15 classi del Liceo'}">
              ⚡ ${isEn ? 'Block 7th-8th All High School' : 'Blocca 7ª-8ª Tutto Liceo'}
            </button>
            <button class="btn btn-primary" onclick="saveMatrixAvailability()">💾 ${isEn ? 'Save Matrix Changes' : 'Salva Modifiche Matrice'}</button>
          `}
        </div>
      </div>

      <div style="font-size:12px;color:var(--text-muted);margin-top:10px;line-height:1.5;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          ${isEn
            ? '💡 <b>Legend:</b> Click slots to toggle between 🟢 <b>Available</b> (✓) and 🔴 <b>Unavailable</b> (✕). Gray slots (<code>⏸️ BREAK</code>) indicate institute-wide closed hours.'
            : '💡 <b>Legenda:</b> Clicca sulle caselle per alternare tra 🟢 <b>Disponibile</b> (✓) e 🔴 <b>Non disponibile</b> (✕). Le caselle grigie (<code>⏸️ PAUSA</code>) sono ore in cui l\'intero istituto è chiuso per orario settimanale.'}
        </div>
        ${!isSingle ? `
          <div style="font-size:11.5px;color:#0284c7;background:#e0f2fe;padding:3px 10px;border-radius:6px;font-weight:600;display:inline-flex;align-items:center;gap:4px;border:1px solid #bae6fd;">
            ${isEn ? '↔️ Scroll horizontally to view all days and periods (1st-8th)' : '↔️ Scorri orizzontalmente per visualizzare tutti i giorni e le ore (1ª-8ª)'}
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Pannello Interattivo Gestione Preferenze & Desiderata Docente -->
    ${isSingle && activeAvailMode === 'teacher' && curTeacher ? `
      <div class="card" style="padding:12px 16px;margin-bottom:12px;background:var(--bg-hover);border:1.5px solid var(--border);border-radius:var(--radius-md);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:18px;">🎨</span>
            <b style="font-size:13px;color:var(--text-main);">${isEn ? 'Preferences & Desiderata Management:' : 'Gestione Preferenze & Desiderata:'} <u>${escapeHtml(activeAvailEntity)}</u></b>
            <span class="badge badge-info" style="font-size:10.5px;">${curTeacher.cdc || (isEn ? 'Teacher' : 'Docente')}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:11px;color:var(--text-muted);">${isEn ? '💡 Click directly to edit preferences in real time:' : '💡 Clicca direttamente per modificare le preferenze in tempo reale:'}</span>
            <button class="btn btn-sm btn-sec" onclick="openEditTeacherModal('${escapeJs(activeAvailEntity)}')" title="${isEn ? 'Gaps limit, daily span and 2nd choice configuration' : 'Configurazione limiti buche, span permanenza e 2ª scelta'}">⚙️ ${isEn ? 'Advanced Limits' : 'Limiti Avanzati'}</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:10px;">
          <!-- Fascia Oraria Desiderata -->
          <div style="background:var(--bg-card);padding:8px 12px;border:1px solid var(--border);border-radius:6px;">
            <div style="font-size:11px;font-weight:700;color:var(--text-sub);margin-bottom:6px;text-transform:uppercase;">
              ${isEn ? '⏰ Desired Time Slot' : '⏰ Fascia Oraria Desiderata'}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn-pref-pill ${(curTeacher.pref_shift || 'none') === 'prime' ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'pref_shift', 'prime')" title="${isEn ? 'Prefer early hours (1st-4th)' : 'Preferisci lezioni nelle prime ore (1ª-4ª)'}">${isEn ? '🌅 Early Hours (1st-4th)' : '🌅 Prime Ore (1ª-4ª)'}</button>
              <button type="button" class="btn-pref-pill ${(curTeacher.pref_shift || 'none') === 'ultime' ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'pref_shift', 'ultime')" title="${isEn ? 'Prefer late hours (3rd-8th)' : 'Preferisci lezioni nelle ultime ore (3ª-8ª)'}">${isEn ? '🌇 Late Hours (3rd-8th)' : '🌇 Ultime Ore (3ª-8ª)'}</button>
              <button type="button" class="btn-pref-pill ${(curTeacher.pref_shift || 'none') === 'bilanciato' ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'pref_shift', 'bilanciato')" title="${isEn ? 'Balanced central periods (2nd-5th)' : 'Distribuzione oraria centrale (2ª-5ª)'}">${isEn ? '⚖️ Balanced (2nd-5th)' : '⚖️ Bilanciato (2ª-5ª)'}</button>
              <button type="button" class="btn-pref-pill ${(curTeacher.pref_shift || 'none') === 'none' ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'pref_shift', 'none')" title="${isEn ? 'No time slot preference (flexible)' : 'Nessuna preferenza di fascia oraria (orario flessibile)'}">${isEn ? '⚪ Flexible' : '⚪ Flessibile'}</button>
            </div>
          </div>

          <!-- Giorno Libero Desiderato -->
          <div style="background:var(--bg-card);padding:8px 12px;border:1px solid var(--border);border-radius:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;">${isEn ? '⭐ Free Day (1st Choice)' : '⭐ Giorno Libero (1ª Scelta)'}</span>
              <label style="font-size:11px;color:#0284c7;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;" title="${isEn ? 'Check to make free day 100% strict in FET' : 'Spunta per rendere il giorno libero un vincolo FET tassativo al 100%'}">
                <input type="checkbox" ${curTeacher.free_day_strict ? 'checked' : ''} onchange="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'free_day_strict', this.checked)">
                <span>${isEn ? '🔒 100% Strict' : '🔒 100% Tassativo'}</span>
              </label>
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
              ${['Lun', 'Mar', 'Mer', 'Gio', 'Ven'].map(d => {
                const dayLbl = formatDayName(d);
                return `
                  <button type="button" class="btn-pref-day ${curTeacher.free_day_1 === d ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'free_day_1', '${curTeacher.free_day_1 === d ? '' : d}')" title="${curTeacher.free_day_1 === d ? (isEn ? 'Active free day (click to remove)' : 'Giorno libero attivo (clicca per rimuovere)') : (isEn ? `Set ${dayLbl} as free day` : `Imposta ${dayLbl} come giorno libero`)}">${dayLbl}</button>
                `;
              }).join('')}
              ${curTeacher.free_day_1 ? `
                <button type="button" class="btn btn-sm btn-sec" style="font-size:10px;padding:2px 6px;" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'free_day_1', '')" title="${isEn ? 'Remove free day' : 'Rimuovi giorno libero'}">✕ ${isEn ? 'Remove' : 'Rimuovi'}</button>
              ` : ''}
              ${curTeacher.free_day_2 ? `
                <span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:10px;padding:2px 6px;margin-left:auto;" title="${isEn ? 'Configured second choice alternative' : 'Seconda scelta alternativa configurata'}">2ª: ${formatDayName(curTeacher.free_day_2)}</span>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    ` : ''}

    <!-- Contenuto: Calendario Singolo o Matrice Completa -->
    ${isSingle ? `
      <div class="card" style="padding:0;overflow:visible;">
        <div class="grid-scroll-wrapper">
          ${renderAvailabilityGridHtml(av.days, av.hours, (activeAvailMode === 'teacher' ? av.teachers[activeAvailEntity] : av.classes[activeAvailEntity]) || [], av.break_times || [], activeAvailMode === 'teacher' ? curTeacher : null)}
        </div>
      </div>
    ` : `
      <div class="card" style="padding:0;overflow:visible;">
        ${renderAvailabilityMatrixHtml(av, teacherList, classList, liceoSet)}
      </div>
    `}
  `;
}

async function quickSetTeacherPref(tname, key, val) {
  try {
    const t = (stateData.teachers || []).find(x => x.name === tname);
    const payload = t ? { ...t } : { name: tname };
    payload[key] = val;
    const res = await fetch(`/api/teachers/${encodeURIComponent(tname)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast(`Preferenza aggiornata per ${tname}!`, 'info');
      const tRes = await fetch('/api/teachers');
      stateData.teachers = await tRes.json();
      await renderAvailability();
    } else {
      const errData = await res.json().catch(() => ({}));
      alert('Errore aggiornamento preferenza: ' + (errData.error || res.statusText));
    }
  } catch (e) {
    alert('Errore di rete: ' + e.message);
  }
}

function switchAvailLayout(layout) {
  activeAvailLayout = layout;
  renderAvailability();
}

function switchAvailMode(mode) {
  activeAvailMode = mode;
  activeAvailEntity = '';
  renderAvailability();
}

function switchAvailEntity(entity) {
  activeAvailEntity = entity;
  renderAvailability();
}

function stepAvailEntity(delta) {
  const av = stateData.availability;
  if (!av) return;
  const teacherList = av.all_teachers || Object.keys(av.teachers || {}).sort();
  const classList = (av.all_classes || Object.keys(av.classes || {})).sort(naturalClassCompare);
  const currentList = activeAvailMode === 'teacher' ? teacherList : classList;
  if (!currentList || !currentList.length) return;

  const curIdx = currentList.indexOf(activeAvailEntity);
  const newIdx = curIdx + delta;
  if (newIdx >= 0 && newIdx < currentList.length) {
    switchAvailEntity(currentList[newIdx]);
  }
}

function onAvailSliderChange(val) {
  const idx = parseInt(val, 10);
  const av = stateData.availability;
  if (!av) return;
  const teacherList = av.all_teachers || Object.keys(av.teachers || {}).sort();
  const classList = (av.all_classes || Object.keys(av.classes || {})).sort(naturalClassCompare);
  const currentList = activeAvailMode === 'teacher' ? teacherList : classList;
  if (!currentList || !currentList.length) return;

  if (idx >= 0 && idx < currentList.length) {
    switchAvailEntity(currentList[idx]);
  }
}

function filterMatrixRows(filter) {
  activeMatrixFilter = filter;
  renderAvailability();
}

function filterMatrixTable(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('#matrixTable tbody tr.matrix-row').forEach(r => {
    const name = r.getAttribute('data-name') || '';
    r.style.display = name.toLowerCase().includes(q) ? '' : 'none';
  });
}

function renderAvailabilityGridHtml(days, hours, slots, breakTimes, teacherPref = null) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const slotsSet = new Set(slots);
  const breakSet = new Set(breakTimes || []);

  const prefShift = (teacherPref?.pref_shift || 'none').toLowerCase();
  const freeDay1 = teacherPref?.free_day_1 || '';
  const freeDayStrict = teacherPref?.free_day_strict || false;

  const hourHeaderLbl = isEn ? 'Period' : 'Ora';
  let headerHtml = `<div class="tt-header" style="background:#153d61;">${hourHeaderLbl}</div>` + days.map(d => {
    const formattedDay = formatDayName(d, true);
    let dayLabel = formattedDay;
    const isFree = (d === freeDay1);
    const starBtn = (activeAvailMode === 'teacher' && teacherPref) ? `
      <span style="color:${isFree ? '#fde047' : 'rgba(255,255,255,0.6)'};font-size:12px;margin-left:3px;vertical-align:middle;">
        ${isFree ? '⭐' : '☆'}
      </span>
    ` : '';
    if (isFree) {
      const freeTag = isEn ? '⭐ Free Day' : '⭐ Libero';
      dayLabel = `${formattedDay} <span style="font-size:9.5px;background:rgba(255,255,255,0.25);padding:1px 4px;border-radius:3px;margin-left:2px;" title="${freeDayStrict ? (isEn ? 'Strict Free Day 100%' : 'Giorno libero obbligatorio 100%') : (isEn ? 'Preferred Free Day (Soft 85%)' : 'Giorno libero desiderato (Soft 85%)')}">${freeTag}</span>`;
    }
    const clickAttr = (activeAvailMode === 'teacher' && teacherPref) ? `
      onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'free_day_1', '${isFree ? '' : d}')" 
      style="cursor:pointer;user-select:none;" 
      title="${isFree ? (isEn ? 'Click to remove free day (' + formattedDay + ')' : 'Clicca per rimuovere giorno libero (' + formattedDay + ')') : (isEn ? 'Click to set ' + formattedDay + ' as Free Day' : 'Clicca per impostare ' + formattedDay + ' come Giorno Libero')}"
    ` : '';
    return `<div class="tt-header" ${clickAttr}>${dayLabel} ${starBtn}</div>`;
  }).join('');
  let gridCols = `60px repeat(${days.length}, 1fr)`;

  let rowsHtml = '';
  for (const h of hours) {
    const isIntervallo = h.toUpperCase().startsWith('INT');
    rowsHtml += `<div class="tt-hour-col ${isIntervallo ? 'is-break' : ''}">${h}</div>`;

    for (const d of days) {
      if (isIntervallo) {
        rowsHtml += `<div class="tt-cell is-break">${isEn ? 'RECESS' : 'INTERVALLO'}</div>`;
        continue;
      }
      const key = `${d}|${h}`;
      const isBreak = breakSet.has(key);
      const isUnavail = slotsSet.has(key);

      if (isBreak) {
        const breakLabel = d === 'Sab' ? (isEn ? 'SATURDAY CLOSED' : 'SABATO CHIUSO') : (isEn ? '⏸️ BREAK' : '⏸️ PAUSA');
        rowsHtml += `
          <div class="tt-cell is-institute-break" title="${d === 'Sab' ? (isEn ? 'Saturday closed (0 periods - short week)' : 'Sabato chiuso (0 ore di default - settimana corta)') : (isEn ? 'Institute break slot' : 'Pausa orario d\'istituto (lezioni non ammesse in questa fascia)')}">
            <span>${breakLabel}</span>
          </div>
        `;
      } else {
        let isPref = false;
        if (!isUnavail && teacherPref && prefShift !== 'none') {
          const hNum = parseInt(h, 10);
          if (prefShift === 'prime' && hNum >= 1 && hNum <= 4) isPref = true;
          else if (prefShift === 'ultime' && hNum >= 3 && hNum <= 8) isPref = true;
          else if (prefShift === 'bilanciato' && hNum >= 2 && hNum <= 5) isPref = true;
        }

        const availBadge = isEn ? '🟢 AVAIL' : '🟢 DISP';
        const unavailBadge = isEn ? '🔴 UNAVAIL' : '🔴 NON DISP';

        rowsHtml += `
          <div class="tt-cell ${isUnavail ? 'is-unavailable' : 'is-available'} ${isPref ? 'is-preferred' : ''}" 
               data-slot="${key}" 
               onclick="toggleSlot(this)"
               title="${isPref ? (isEn ? `Preferred slot (${teacherPref.pref_shift_weight || 85}%)` : `Fascia preferita (${teacherPref.pref_shift_weight || 85}%)`) : (isUnavail ? (isEn ? 'Unavailable' : 'Non disponibile') : (isEn ? 'Available' : 'Disponibile'))}">
            <span style="font-weight:600;">${isUnavail ? unavailBadge : availBadge}</span>
            ${isPref ? '<span style="font-size:9.5px;color:#1d4ed8;font-weight:700;display:block;margin-top:2px;">⭐ PREF</span>' : ''}
          </div>
        `;
      }
    }
  }

  return `
    <div class="timetable-grid" role="grid" aria-label="${isEn ? 'Timetable grid' : 'Griglia orario'}" style="grid-template-columns: ${gridCols};">
      ${headerHtml}
      ${rowsHtml}
    </div>
  `;
}

function toggleSlot(el) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const isUnavail = el.classList.contains('is-unavailable');
  if (isUnavail) {
    el.classList.remove('is-unavailable');
    el.classList.add('is-available');
    el.innerHTML = `<span style="font-weight:600;">${isEn ? '🟢 AVAIL' : '🟢 DISP'}</span>`;
  } else {
    el.classList.remove('is-available');
    el.classList.add('is-unavailable');
    el.innerHTML = `<span style="font-weight:600;">${isEn ? '🔴 UNAVAIL' : '🔴 NON DISP'}</span>`;
  }
}

async function saveAvailability() {
  const unavailSlots = [];
  document.querySelectorAll('.tt-cell.is-unavailable').forEach(el => {
    unavailSlots.push(el.getAttribute('data-slot'));
  });

  const payload = {
    mode: activeAvailMode,
    entity: activeAvailEntity,
    slots: unavailSlots
  };

  const res = await fetch('/api/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    showToast(`Indisponibilità salvate per "${activeAvailEntity}"!`);
  } else {
    alert('Errore salvataggio indisponibilità.');
  }
}

// --- VISTA MATRICE COMPLETA (RECORD PER RIGA COME EXCEL) ---
function renderAvailabilityMatrixHtml(av, teacherList, classList, liceoSet) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const days = av.days || ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
  const breakSet = new Set(av.break_times || []);

  // Determina ore non-intervallo (es. 1, 2, 3, 4, 5, 6, 7, 8)
  const numericHours = (av.hours || []).filter(h => !h.toUpperCase().startsWith('INT'));

  // Calcola colonne per ogni giorno
  const slotsList = [];
  days.forEach(d => {
    numericHours.forEach(h => {
      slotsList.push({ day: d, hour: h, key: `${d}|${h}` });
    });
  });

  // Prepara record righe in base al filtro attivo (Docenti o Classi)
  let rowsData = [];
  if (activeMatrixFilter === 'teachers') {
    teacherList.forEach(tName => {
      rowsData.push({
        type: 'teacher',
        name: tName,
        slots: new Set(matrixPendingChanges[`teacher:${tName}`] || av.teachers[tName] || [])
      });
    });
  } else {
    classList.forEach(cName => {
      rowsData.push({
        type: 'class',
        name: cName,
        isLiceo: liceoSet.has(cName),
        slots: new Set(matrixPendingChanges[`class:${cName}`] || av.classes[cName] || [])
      });
    });
  }

  const entityHeaderLbl = activeMatrixFilter === 'teachers' ? (isEn ? '👨‍🏫 Teacher' : '👨‍🏫 Docente') : (isEn ? '🎓 Class' : '🎓 Classe');
  let tableHeaderDays = `<th class="sticky-col" rowspan="2" style="width:200px;">${entityHeaderLbl}</th>`;
  days.forEach(d => {
    tableHeaderDays += `<th colspan="${numericHours.length}" class="matrix-day-header">${escapeHtml(formatDayName(d, false))}</th>`;
  });

  let tableHeaderHours = '';
  days.forEach(d => {
    numericHours.forEach(h => {
      tableHeaderHours += `<th style="width:26px;font-size:10.5px;padding:3px 2px;">${h}</th>`;
    });
  });

  let tableBodyRows = rowsData.map((row, idx) => {
    const isTeacher = row.type === 'teacher';
    const isLic = row.isLiceo;

    let cellsHtml = '';
    slotsList.forEach(slot => {
      const isBreak = breakSet.has(slot.key);
      const isUnavail = row.slots.has(slot.key);

      if (isBreak) {
        cellsHtml += `<td class="matrix-slot-cell is-break" title="${isEn ? 'Institute break slot' : 'Pausa d\'istituto'} (${slot.key})">⏸️</td>`;
      } else {
        cellsHtml += `
          <td class="matrix-slot-cell ${isUnavail ? 'is-unavail' : 'is-avail'}"
              data-type="${row.type}"
              data-entity="${escapeHtml(row.name)}"
              data-slot="${slot.key}"
              onclick="toggleMatrixCell(this)"
              title="${escapeHtml(row.name)} - ${slot.key}: ${isUnavail ? (isEn ? 'Unavailable' : 'Non Disponibile') : (isEn ? 'Available' : 'Disponibile')}">
            ${isUnavail ? '✕' : '✓'}
          </td>
        `;
      }
    });

    return `
      <tr class="matrix-row" data-name="${escapeHtml(row.name)}">
        <td class="sticky-col">
          <span style="font-size:12px;margin-right:4px;">${isTeacher ? '👨‍🏫' : '🎓'}</span>
          <b style="font-size:12.5px;color:var(--text-main);">${escapeHtml(row.name)}</b>
          ${isLic ? '<span class="badge badge-liceo" style="font-size:9.5px;padding:1px 4px;margin-left:3px;">Liceo</span>' : ''}
        </td>
        ${cellsHtml}
      </tr>
    `;
  }).join('');

  return `
    <div class="matrix-container" style="max-height:calc(100vh - 270px);min-height:380px;overflow:auto;">
      <table class="matrix-table" id="matrixTable">
        <thead>
          <tr>${tableHeaderDays}</tr>
          <tr>${tableHeaderHours}</tr>
        </thead>
        <tbody>
          ${tableBodyRows}
        </tbody>
      </table>
    </div>
  `;
}

function toggleMatrixCell(el) {
  const type = el.getAttribute('data-type');
  const entity = el.getAttribute('data-entity');
  const slot = el.getAttribute('data-slot');
  const cacheKey = `${type}:${entity}`;

  if (!matrixPendingChanges[cacheKey]) {
    const origSlots = type === 'teacher' ? (stateData.availability.teachers[entity] || []) : (stateData.availability.classes[entity] || []);
    matrixPendingChanges[cacheKey] = new Set(origSlots);
  }

  const slotSet = matrixPendingChanges[cacheKey];
  const isCurrentlyUnavail = el.classList.contains('is-unavail');

  if (isCurrentlyUnavail) {
    slotSet.delete(slot);
    el.classList.remove('is-unavail');
    el.classList.add('is-avail');
    el.innerText = '✓';
    el.title = `${entity} - ${slot}: Disponibile`;
  } else {
    slotSet.add(slot);
    el.classList.remove('is-avail');
    el.classList.add('is-unavail');
    el.innerText = '✕';
    el.title = `${entity} - ${slot}: Non Disponibile`;
  }
}

async function saveMatrixAvailability() {
  const entries = Object.entries(matrixPendingChanges);
  if (entries.length === 0) {
    showToast('Nessuna modifica da salvare nella matrice.');
    return;
  }

  let savedCount = 0;
  for (const [cacheKey, slotsSet] of entries) {
    const [mode, entity] = cacheKey.split(':');
    await fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: mode,
        entity: entity,
        slots: Array.from(slotsSet)
      })
    });
    savedCount++;
  }

  matrixPendingChanges = {};
  showToast(`Matrice aggiornata: ${savedCount} record salvati con successo!`);
  renderAvailability();
}

async function applyLiceoPreset(className) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const msg = isEn 
    ? `Apply High School timetable constraint to class "${className}"?\n(Periods 7 and 8 unavailable on all return days)` 
    : `Applicare il vincolo orario Liceo alla classe "${className}"?\n(Ore 7 e 8 non disponibili in tutti i giorni di rientro)`;
  if (!confirm(msg)) return;
  const res = await fetch('/api/availability/preset_liceo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ class_name: className })
  });
  if (res.ok) {
    showToast(isEn ? `High School constraint applied to ${className}!` : `Vincolo orario Liceo applicato a ${className}!`);
    renderAvailability();
  } else {
    alert(isEn ? 'Error applying constraint.' : 'Errore applicazione vincolo.');
  }
}

async function applyLiceoPresetAll() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const msg = isEn 
    ? 'Apply High School timetable constraint to ALL 15 High School classes (sections C, D, L)?\n(Periods 7 and 8 100% blocked)' 
    : 'Applicare il vincolo orario Liceo a TUTTE le 15 classi del Liceo (sezioni C, D, L)?\n(Ore 7 e 8 bloccate al 100%)';
  if (!confirm(msg)) return;
  const res = await fetch('/api/availability/preset_liceo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (res.ok) {
    showToast(isEn ? 'Timetable constraint applied successfully to all High School classes!' : 'Vincolo orario applicato con successo a tutte le classi del Liceo!');
    renderAvailability();
  } else {
    alert(isEn ? 'Error applying constraint.' : 'Errore applicazione vincolo.');
  }
}

function openTeacherAvailability(name) {
  activeAvailLayout = 'single';
  activeAvailMode = 'teacher';
  activeAvailEntity = name;
  navigate('availability', true, `Docenti (${name})`);
}

function openClassAvailability(name) {
  activeAvailLayout = 'single';
  activeAvailMode = 'class';
  activeAvailEntity = name;
  navigate('availability', true, `Classi (${name})`);
}

// ============================================================================
// 10. VINCOLI ALGORITMO FET (Regole, Pesi e Suddivisione a 3 Gruppi)
// ============================================================================
let activeConstraintCategory = 'all'; // 'all' | 'Docenti' | 'Classi' | 'Spostamenti'

async function renderConstraints() {
  const _t = (k, fb) => window.I18N ? window.I18N.t(k, fb) : fb;
  const res = await fetch('/api/settings');
  const cfg = await res.json();
  stateData.settings = cfg;

  const container = document.getElementById('mainContent');
  const cons = cfg.constraints || {};

  const docentiCons = Object.entries(cons).filter(([k, c]) => c.category === 'Docenti');
  const classiCons = Object.entries(cons).filter(([k, c]) => c.category === 'Classi');
  const spostamentiCons = Object.entries(cons).filter(([k, c]) => c.category === 'Spostamenti');

  let filteredEntries = Object.entries(cons);
  if (activeConstraintCategory === 'Docenti') filteredEntries = docentiCons;
  else if (activeConstraintCategory === 'Classi') filteredEntries = classiCons;
  else if (activeConstraintCategory === 'Spostamenti') filteredEntries = spostamentiCons;

  const activeCount = Object.values(cons).filter(c => c.active).length;

  container.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <div>
          <div class="card-title">${_t('constraints.header_title', '⚡ Regole e Vincoli Rigidi di Calcolo FET')}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
            ${_t('constraints.subtitle_desc', 'Regole matematiche applicate al solutore FET per compattare l\'orario, azzerare le ore buche e gestire i trasferimenti tra plessi')} (<span id="constraintSubtitleCount">${activeCount} ${_t('constraints.active', 'attivi')} / ${Object.keys(cons).length}</span>).
          </div>
        </div>
        <div id="constraintAutoSaveBadge" style="display:inline-flex;align-items:center;gap:7px;background:#f0fdf4;border:1px solid #bbf7d0;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;color:#16a34a;box-shadow:0 1px 2px rgba(0,0,0,0.04);transition:all 0.2s ease;">
          <span id="constraintSaveDot" style="width:8px;height:8px;border-radius:50%;background:#16a34a;display:inline-block;"></span>
          <span id="constraintSaveText">${_t('constraints.saved_status', 'Salvato in tempo reale')}</span>
        </div>
      </div>
    </div>

    <!-- Filtri di Categoria a 3 Gruppi -->
    <div class="toolbar" style="margin-bottom:16px;">
      <div class="segmented-control">
        <button class="segmented-btn ${activeConstraintCategory === 'all' ? 'active' : ''}" onclick="filterConstraints('all')">
          ${_t('constraints.all', 'Tutti i Vincoli')} (${Object.keys(cons).length})
        </button>
        <button class="segmented-btn ${activeConstraintCategory === 'Docenti' ? 'active' : ''}" onclick="filterConstraints('Docenti')">
          ${_t('constraints.teachers', '👨‍🏫 Vincoli Docenti')} (${docentiCons.length})
        </button>
        <button class="segmented-btn ${activeConstraintCategory === 'Classi' ? 'active' : ''}" onclick="filterConstraints('Classi')">
          ${_t('constraints.classes', '🎓 Vincoli Classi & Studenti')} (${classiCons.length})
        </button>
        <button class="segmented-btn ${activeConstraintCategory === 'Spostamenti' ? 'active' : ''}" onclick="filterConstraints('Spostamenti')">
          ${_t('constraints.changes', '🏢 Spostamenti & Plessi')} (${spostamentiCons.length})
        </button>
      </div>
    </div>

    <div class="settings-grid">
      ${filteredEntries.map(([key, c]) => {
        const isRigid = c.is_rigid || false;
        const weightVal = c.weight !== undefined ? c.weight : 100;
        const localizedName = _t(`constraints_dict.${key}.name`, c.name || key);
        const localizedDesc = _t(`constraints_dict.${key}.desc`, c.desc || '');
        const catLabel = c.category === 'Docenti' ? _t('constraints.teachers', 'Docenti') :
                         c.category === 'Classi' ? _t('constraints.classes', 'Classi') :
                         c.category === 'Spostamenti' ? _t('constraints.changes', 'Spostamenti') : (c.category || 'Generale');

        return `
          <div class="constraint-card">
            <div>
              <div class="constraint-header">
                <span class="constraint-title">${escapeHtml(localizedName)}</span>
                <span class="badge ${c.category === 'Docenti' ? 'badge-info' : c.category === 'Classi' ? 'badge-warn' : 'badge-ok'}">${catLabel}</span>
              </div>
              <div class="constraint-desc">${escapeHtml(localizedDesc)}</div>
            </div>

            <div class="constraint-ctrls">
              <div style="display:flex;align-items:center;gap:8px;">
                <label class="switch">
                  <input type="checkbox" id="c_active_${key}" ${c.active ? 'checked' : ''} onchange="autoSaveConstraintSingle('${key}')">
                  <span class="slider"></span>
                </label>
                <span id="c_active_label_${key}" style="font-size:12px;font-weight:600;color:${c.active ? 'var(--primary)' : 'var(--text-muted)'};">
                  ${c.active ? _t('constraints.active', 'Attivo') : _t('constraints.inactive', 'Disattivo')}
                </span>
              </div>

              <div style="display:flex;align-items:center;gap:12px;">
                <div style="display:flex;align-items:center;gap:4px;">
                  <span style="font-size:11px;color:var(--text-muted);">${_t('constraints.param', 'Parametro:')}</span>
                  <input type="number" id="c_val_${key}" class="num-input" value="${c.val !== undefined ? c.val : 0}" min="0" max="100" oninput="debounceAutoSaveConstraint('${key}')" onchange="autoSaveConstraintSingle('${key}')">
                </div>

                <div style="display:flex;align-items:center;gap:4px;">
                  ${isRigid ? `
                    <span class="badge badge-info" style="font-size:10.5px;padding:3px 6px;" title="${_t('constraints.rigid_title', 'FET richiede obbligatoriamente peso 100% per questo vincolo algebrico')}">
                      ${_t('constraints.rigid_badge', '🔒 100% (Rigido)')}
                    </span>
                  ` : `
                    <span style="font-size:11px;color:var(--text-muted);" title="${_t('constraints.weight_title', 'Percentuale peso nel solutore FET (0-100%)')}">${_t('constraints.weight', 'Peso:')}</span>
                    <input type="number" id="c_weight_${key}" class="num-input" value="${weightVal}" min="0" max="100" style="width:58px;" title="${_t('constraints.weight_title', 'Percentuale peso nel solutore FET (0-100%)')}" oninput="debounceAutoSaveConstraint('${key}')" onchange="autoSaveConstraintSingle('${key}')">
                    <span style="font-size:11px;color:var(--text-muted);">%</span>
                  `}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function filterConstraints(cat) {
  activeConstraintCategory = cat;
  renderConstraints();
}

let constraintAutoSaveTimer = null;

function setConstraintSaveStatus(status) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const badge = document.getElementById('constraintAutoSaveBadge');
  const dot = document.getElementById('constraintSaveDot');
  const text = document.getElementById('constraintSaveText');
  if (!badge || !dot || !text) return;

  if (status === 'saving') {
    badge.style.background = '#fef3c7';
    badge.style.borderColor = '#fde68a';
    badge.style.color = '#b45309';
    dot.style.background = '#f59e0b';
    text.innerText = isEn ? 'Saving...' : 'Salvataggio in corso...';
  } else if (status === 'saved') {
    badge.style.background = '#f0fdf4';
    badge.style.borderColor = '#bbf7d0';
    badge.style.color = '#16a34a';
    dot.style.background = '#16a34a';
    text.innerText = isEn ? 'Saved in real-time' : 'Salvato in tempo reale';
  } else if (status === 'error') {
    badge.style.background = '#fef2f2';
    badge.style.borderColor = '#fecaca';
    badge.style.color = '#dc2626';
    dot.style.background = '#dc2626';
    text.innerText = isEn ? 'Save error' : 'Errore salvataggio';
  }
}

function updateConstraintSubtitleCount() {
  const cons = stateData.settings?.constraints || {};
  const activeCount = Object.values(cons).filter(c => c.active).length;
  const countEl = document.getElementById('constraintSubtitleCount');
  if (countEl) {
    countEl.innerText = `${activeCount} vincoli attivi su ${Object.keys(cons).length}`;
  }
}

function autoSaveConstraintSingle(key) {
  if (constraintAutoSaveTimer) {
    clearTimeout(constraintAutoSaveTimer);
    constraintAutoSaveTimer = null;
  }
  const actEl = document.getElementById(`c_active_${key}`);
  const labelEl = document.getElementById(`c_active_label_${key}`);
  if (actEl && labelEl) {
    labelEl.innerText = actEl.checked ? 'Attivo' : 'Disattivo';
    labelEl.style.color = actEl.checked ? 'var(--primary)' : 'var(--text-muted)';
  }
  executeAutoSaveConstraint(key);
}

function debounceAutoSaveConstraint(key) {
  setConstraintSaveStatus('saving');
  if (constraintAutoSaveTimer) clearTimeout(constraintAutoSaveTimer);
  constraintAutoSaveTimer = setTimeout(() => {
    executeAutoSaveConstraint(key);
  }, 400);
}

async function executeAutoSaveConstraint(key) {
  if (!stateData.settings) stateData.settings = {};
  if (!stateData.settings.constraints) stateData.settings.constraints = {};
  const currentConst = stateData.settings.constraints[key] || {};

  const actEl = document.getElementById(`c_active_${key}`);
  const valEl = document.getElementById(`c_val_${key}`);
  const weightEl = document.getElementById(`c_weight_${key}`);

  const updatedItem = {
    ...currentConst,
    active: actEl ? actEl.checked : (currentConst.active !== undefined ? currentConst.active : true),
    val: valEl ? (parseInt(valEl.value, 10) || 0) : (currentConst.val !== undefined ? currentConst.val : 0),
    weight: weightEl ? (parseInt(weightEl.value, 10) || 0) : (currentConst.weight !== undefined ? currentConst.weight : 100)
  };

  stateData.settings.constraints[key] = updatedItem;
  updateConstraintSubtitleCount();
  setConstraintSaveStatus('saving');

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        constraints: {
          [key]: updatedItem
        }
      })
    });

    if (res.ok) {
      setConstraintSaveStatus('saved');
    } else {
      setConstraintSaveStatus('error');
    }
  } catch (err) {
    console.error('Errore durante auto-save vincolo FET:', err);
    setConstraintSaveStatus('error');
  }
}

async function saveConstraintsSettings() {
  // Funzione di retrocompatibilità
  const cons = stateData.settings?.constraints || {};
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ constraints: cons })
  });
  if (res.ok) {
    setConstraintSaveStatus('saved');
    showToast('Vincoli FET aggiornati con successo!');
  }
}

// ============================================================================
// 11. PARAMETRI ISTITUZIONALI COMPLETI (Anagrafica, Calendario, Regole Excel)
// ============================================================================
async function renderParameters() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const res = await fetch('/api/settings');
  const cfg = await res.json();
  stateData.settings = cfg;

  const container = document.getElementById('mainContent');
  const dayLimits = cfg.day_hours_limit || { Lun: 6, Mar: 8, Mer: 6, Gio: 6, Ven: 8, Sab: 0 };
  // Assicura che i 6 giorni standard siano SEMPRE disponibili per la configurazione del calendario
  const standardWeek = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const customDays = (cfg.days || []).filter(d => !standardWeek.includes(d));
  const daysList = [...standardWeek, ...customDays];
  const params = cfg.parameters || {};

  container.innerHTML = `
    <!-- Card Documentazione Ufficiale & Manuale FET -->
    <div class="card" style="margin-bottom:16px;background:linear-gradient(135deg, rgba(37,99,235,0.06), rgba(99,102,241,0.08));border:1px solid rgba(59,130,246,0.3);padding:14px 18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:14px;">
          <span style="font-size:28px;">📖</span>
          <div>
            <div style="font-weight:750;font-size:14px;color:var(--text-title);display:flex;align-items:center;gap:8px;">
              <span>${isEn ? 'Official Eurario Documentation & Knowledge Base' : 'Documentazione Ufficiale & Manuale Operativo Eurario'}</span>
              <span class="badge badge-info" style="font-size:10.5px;padding:2px 6px;">docs.eurario.it</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:3px;line-height:1.45;">
              ${isEn 
                ? 'Comprehensive guide, FET manual cross-reference, constraints catalog and Italian school scheduling use cases.' 
                : 'Guida utente completa, correlazione con il manuale FET, catalogo vincoli orario e 18 casistiche per la scuola italiana.'}
            </div>
          </div>
        </div>
        <div>
          <a href="${isEn ? 'https://docs.eurario.it/en/?lang=en' : 'https://docs.eurario.it/?lang=it'}" target="_blank" rel="noopener" onclick="openDocs(); return false;" class="btn btn-sm btn-primary" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;font-weight:600;padding:7px 14px;box-shadow:0 2px 6px rgba(37,99,235,0.2);">
            <span>${isEn ? 'Consult Documentation' : 'Consulta Documentazione'}</span>
            <span style="font-size:13px;">↗</span>
          </a>
        </div>
      </div>
    </div>

    <!-- Sezione 1: Anagrafica Istituto & Profilo Scuola -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">${isEn ? '🏛️ School / Institution Profile & Metadata' : '🏛️ Anagrafica e Profilo Istituto'}</div>
      <div style="display:grid;grid-template-columns:2fr 1.2fr 1fr;gap:14px;margin-top:12px;">
        <div class="form-group">
          <label class="form-label">${isEn ? 'School / Institution Name *' : "Nome dell'Istituto Scolastico *"}</label>
          <input type="text" id="cfgInstName" class="form-input" value="${escapeHtml(cfg.institution || (currentSchool ? currentSchool.name : ''))}" placeholder="${isEn ? 'e.g. Athens Academy High School' : 'es. Liceo Scientifico Galileo Galilei'}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'City / Town' : 'Città / Comune'}</label>
          <input type="text" id="cfgCity" class="form-input" value="${escapeHtml(cfg.city || (currentSchool ? currentSchool.city : ''))}" placeholder="${isEn ? 'e.g. London, Rome...' : 'es. Padova, Milano, Roma...'}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Country' : 'Nazione'}</label>
          <input type="text" id="cfgCountry" class="form-input" value="${escapeHtml(cfg.country || (currentSchool ? currentSchool.country : (isEn ? 'United States' : 'Italia')))}" placeholder="${isEn ? 'e.g. United States' : 'es. Italia'}">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1.2fr 1.5fr 1.5fr 1.2fr;gap:14px;margin-top:10px;">
        <div class="form-group">
          <label class="form-label">${isEn ? 'School Code (MIM / Unique)' : 'Codice Meccanografico'}</label>
          <input type="text" id="cfgMeccanografico" class="form-input" value="${escapeHtml(cfg.meccanografico || (currentSchool ? currentSchool.meccanografico : ''))}" placeholder="${isEn ? 'e.g. PDIS017007' : 'es. PDIS017007'}" style="text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">
        </div>
        <div class="form-group">
          <label class="form-label">📧 ${isEn ? 'Official Contact / Notification Email' : 'Email Contatto / Notifiche Ufficiale'}</label>
          <input type="email" id="cfgContactEmail" class="form-input" value="${escapeHtml(cfg.contact_email || (currentSchool ? currentSchool.contact_email : ''))}" placeholder="${isEn ? 'e.g. info@school.edu' : 'es. pdis017007@istruzione.it'}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Notes / Timetable Committee Contact' : 'Note / Referente Commissione'}</label>
          <input type="text" id="cfgNotes" class="form-input" value="${escapeHtml(cfg.notes || (currentSchool ? currentSchool.notes : ''))}" placeholder="${isEn ? 'Contact or setup notes...' : 'Recapiti o note di configurazione...'}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'FET Project Comments / Year' : 'Commenti Progetto / Anno'}</label>
          <input type="text" id="cfgComments" class="form-input" value="${escapeHtml(cfg.comments || '')}" placeholder="${isEn ? 'e.g. S.Y. 2026/2027' : 'es. A.S. 2026/2027'}">
        </div>
      </div>
    </div>

    <!-- Sezione 2: Calendario Settimanale con Gestione Sabato -->
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          <div class="card-title">${isEn ? '📅 Weekly Calendar & Daily Period Limits' : '📅 Calendario Settimanale & Monte Ore Giornaliero'}</div>
          <p style="font-size:12px;color:var(--text-muted);margin:6px 0 10px;max-width:750px;line-height:1.5;">
            ${isEn 
              ? 'Configure the maximum teaching periods for each day of the week. <b>Saturday</b> is handled natively: with <b>0 periods</b> the school is on a <i>5-day week</i> (closed); setting e.g. <b>4 or 5 periods</b> automatically opens Saturday to classes.' 
              : 'Configura le ore massime di lezione per ciascun giorno della settimana. Il <b>Sabato</b> è gestito nativamente: con <b>0 ore</b> l\'istituto è su <i>settimana corta</i> (chiuso); impostando ad es. <b>4 o 5 ore</b> il Sabato viene aperto automaticamente alle lezioni.'}
          </p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button id="btnPresetCorta" type="button" class="btn btn-sm btn-sec" onclick="applyDayHoursPreset('corta')" title="${isEn ? 'Mon-Fri open, Saturday closed at 0h' : 'Lun-Ven aperti, Sabato chiuso a 0 ore'}">
            ⚡ ${isEn ? '5-Day Week (Sat 0h)' : 'Settimana Corta (Sabato 0h)'}
          </button>
          <button id="btnPresetLunga5" type="button" class="btn btn-sm btn-sec" onclick="applyDayHoursPreset('lunga_5h')" title="${isEn ? '6-day week with 5-period Saturday' : 'Settimana su 6 giorni con Sabato da 5 ore'}">
            ⚡ ${isEn ? '6-Day Week (Sat 5h)' : 'Settimana Lunga (Sabato 5h)'}
          </button>
          <button id="btnPresetLunga4" type="button" class="btn btn-sm btn-sec" onclick="applyDayHoursPreset('lunga_4h')" title="${isEn ? '6-day week with 4-period Saturday' : 'Settimana su 6 giorni con Sabato da 4 ore'}">
            ⚡ ${isEn ? '6-Day Week (Sat 4h)' : 'Settimana Lunga (Sabato 4h)'}
          </button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:12px;margin-top:14px;">
        ${daysList.map(d => {
          const val = dayLimits[d] !== undefined ? dayLimits[d] : (d === 'Sab' ? 0 : 6);
          const isSab = d === 'Sab';
          const dayLabel = formatDayName(d, true);
          return `
            <div id="day_box_${d}" class="day-hours-box" style="${isSab ? (val === 0 ? 'border: 2px dashed #94a3b8; background: var(--bg-hover, #f1f5f9);' : 'border: 2px solid var(--primary, #3b82f6); background: var(--bg-card, #f8fafc);') : ''}">
              <div class="day-hours-box-name" style="${isSab ? 'color:var(--primary);font-weight:700;' : ''}">${escapeHtml(dayLabel)} ${isSab ? '🗓️' : ''}</div>
              <input type="number" 
                     id="day_limit_${d}" 
                     class="num-input" 
                     min="0" 
                     max="10" 
                     value="${val}" 
                     ${isSab ? 'oninput="updateSabatoBadge(this.value)"' : ''}
                     style="${isSab ? 'font-size:16px;font-weight:700;' : ''}">
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${isEn ? 'max periods' : 'ore max'}</div>
              ${isSab ? `
                <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;align-items:center;">
                  <span id="sabStatusBadge" class="badge ${val === 0 ? 'badge-warn' : 'badge-ok'}" style="font-size:11px;padding:3px 8px;font-weight:600;">
                    ${isEn ? (val === 0 ? '● Closed (0h)' : `● Active (${val}h)`) : (val === 0 ? '● Chiuso (0h)' : `● Attivo (${val}h)`)}
                  </span>
                  <button type="button" id="btnToggleSabato" class="btn btn-sm btn-sec" style="font-size:10.5px;padding:3px 7px;width:100%;" onclick="toggleSabatoQuick()">
                    ${val === 0 ? (isEn ? '➕ Open Saturday (5h)' : '➕ Attiva Sabato (5h)') : (isEn ? '✕ Close Saturday (0h)' : '✕ Chiudi Sabato (0h)')}
                  </button>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Sezione 3: Parametri Istituzionali Avanzati (Foglio Excel "Parametri") -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">${isEn ? '📋 Comprehensive Educational & Institutional Parameters (Excel Parameters Tab)' : '📋 Parametri Didattici & Istituzionali Completi (Tab Parametri Excel)'}</div>
      <p style="font-size:12px;color:var(--text-muted);margin:6px 0 16px;line-height:1.5;">
        ${isEn 
          ? 'Institutional parameters integrated into the automatic FET timetable generation. Hover over <span class="param-help-icon">i</span> to view parameter documentation.' 
          : 'Parametri d\'istituto integrati nella procedura automatica di generazione FET. Passa con il mouse sull\'icona <span class="param-help-icon">i</span> per consultare la documentazione didattica del parametro.'}
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <!-- Blocco A: Sedi & Orari -->
        <div style="background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;">
          <b style="font-size:13px;color:var(--primary);display:block;margin-bottom:10px;">🏢 ${isEn ? 'Buildings, Timetables & Travel' : 'Sedi, Orari & Trasferimenti'}</b>

          <div class="form-group">
            <label class="form-label">
              ${isEn ? 'MAIN_BUILDING_HOURS' : 'ORARIO_SEDE_CENTRALE'} <span class="param-help-icon" title="${isEn ? 'Class start and end times for the Main Building' : 'Orario d\'inizio e fine lezioni per la Sede Centrale'}">i</span>
            </label>
            <input type="text" id="param_ORARIO_SEDE_CENTRALE" class="form-input" value="${escapeHtml(params.ORARIO_SEDE_CENTRALE || '8:00 - 13:00 / 14:00 - 16:00')}">
          </div>

          <div class="form-group">
            <label class="form-label">
              ${isEn ? 'BRANCH_BUILDING_HOURS' : 'ORARIO_SEDE_SUCCURSALE'} <span class="param-help-icon" title="${isEn ? 'Class start and end times for the Branch Building' : 'Orario d\'inizio e fine lezioni per la Sede Succursale'}">i</span>
            </label>
            <input type="text" id="param_ORARIO_SEDE_SUCCURSALE" class="form-input" value="${escapeHtml(params.ORARIO_SEDE_SUCCURSALE || '8:05 - 13:05 / 14:05 - 16:05')}">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'MORNING_PERIODS' : 'ORE_MATTINO'} <span class="param-help-icon" title="${isEn ? 'Maximum number of periods scheduled in the morning' : 'Numero massimo di ore previste al mattino'}">i</span>
              </label>
              <input type="number" id="param_ORE_MATTINO" class="form-input" value="${params.ORE_MATTINO || 6}">
            </div>
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'AFTERNOON_PERIODS' : 'ORE_POMERIGGIO'} <span class="param-help-icon" title="${isEn ? 'Maximum number of periods scheduled in the afternoon' : 'Numero massimo di ore previste nei pomeriggi'}">i</span>
              </label>
              <input type="number" id="param_ORE_POMERIGGIO" class="form-input" value="${params.ORE_POMERIGGIO || 2}">
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'TRAVEL_TIME_BETWEEN_BUILDINGS (min)' : 'TEMPO_SPOSTAMENTO_SEDI (min)'} <span class="param-help-icon" title="${isEn ? 'Minimum travel time between Main and Branch in minutes' : 'Minuti minimi di percorrenza tra Centrale e Succursale'}">i</span>
              </label>
              <input type="number" id="param_TEMPO_SPOSTAMENTO_SEDI_MINUTI" class="form-input" value="${params.TEMPO_SPOSTAMENTO_SEDI_MINUTI || 10}">
            </div>
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'GYM_TRAVEL_BUFFER (min)' : 'MIN_INTERVALLO_PALESTRA (min)'} <span class="param-help-icon" title="${isEn ? 'Buffer time in minutes to reach the gym' : 'Minuti di intervallo per raggiungere la palestra'}">i</span>
              </label>
              <input type="number" id="param_MIN_INTERVALLO_PALESTRA_MINUTI" class="form-input" value="${params.MIN_INTERVALLO_PALESTRA_MINUTI || 15}">
            </div>
          </div>
        </div>

        <!-- Blocco B: Didattica Pomeridiana & Regole FET -->
        <div style="background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;">
          <b style="font-size:13px;color:var(--primary);display:block;margin-bottom:10px;">🧠 ${isEn ? 'Afternoon Teaching & Teacher Rules' : 'Didattica Pomeridiana & Regole Docenti'}</b>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'BLOCK AFTERNOON MATH' : 'BLOCCO NO MATEMATICA POM.'} <span class="param-help-icon" title="${isEn ? 'Excludes mathematics from afternoon periods' : 'Esclude matematica dai rientri pomeridiani'}">i</span>
              </label>
              <select id="param_BLOCCO_POMERIDIANO_NO_MAT" class="form-select">
                <option value="SI" ${params.BLOCCO_POMERIDIANO_NO_MAT !== 'NO' ? 'selected' : ''}>${isEn ? 'YES (Recommended)' : 'SI (Consigliato)'}</option>
                <option value="NO" ${params.BLOCCO_POMERIDIANO_NO_MAT === 'NO' ? 'selected' : ''}>NO</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'BLOCK AFTERNOON HUMANITIES' : 'BLOCCO NO ITALIANO POM.'} <span class="param-help-icon" title="${isEn ? 'Excludes Italian/humanities from afternoon periods' : 'Esclude italiano dai rientri pomeridiani'}">i</span>
              </label>
              <select id="param_BLOCCO_POMERIDIANO_NO_ITA" class="form-select">
                <option value="SI" ${params.BLOCCO_POMERIDIANO_NO_ITA === 'SI' ? 'selected' : ''}>${isEn ? 'YES' : 'SI'}</option>
                <option value="NO" ${params.BLOCCO_POMERIDIANO_NO_ITA !== 'SI' ? 'selected' : ''}>NO</option>
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'PREFER AFTERNOON PE / GYM' : 'PREFERENZA PALESTRA POM.'} <span class="param-help-icon" title="${isEn ? 'Prioritizes physical education in afternoon periods' : 'Favorisce scienze motorie nelle ore pomeridiane'}">i</span>
              </label>
              <select id="param_PREFERENZA_PALESTRA_POMERIGGIO" class="form-select">
                <option value="SI" ${params.PREFERENZA_PALESTRA_POMERIGGIO === 'SI' ? 'selected' : ''}>${isEn ? 'YES' : 'SI'}</option>
                <option value="NO" ${params.PREFERENZA_PALESTRA_POMERIGGIO !== 'SI' ? 'selected' : ''}>NO</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'COMPACT TEACHER SCHEDULES' : 'COMPATTA ORARIO DOCENTI'} <span class="param-help-icon" title="${isEn ? 'Minimizes gaps and compacts schedules' : 'Minimizza le ore buche e compatta le giornate'}">i</span>
              </label>
              <select id="param_COMPATTA_ORARIO_DOCENTI" class="form-select">
                <option value="SI" ${params.COMPATTA_ORARIO_DOCENTI !== 'NO' ? 'selected' : ''}>${isEn ? 'YES' : 'SI'}</option>
                <option value="NO" ${params.COMPATTA_ORARIO_DOCENTI === 'NO' ? 'selected' : ''}>NO</option>
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'MAX TEACHER GAPS / WEEK' : 'MAX BUCHE DOCENTI / SETT.'} <span class="param-help-icon" title="${isEn ? 'Maximum allowed weekly gap hours per teacher' : 'Numero massimo consentito di ore buche settimanali per docente'}">i</span>
              </label>
              <input type="number" id="param_MAX_ORE_BUCHE_DOCENTI_SETTIMANA" class="form-input" value="${params.MAX_ORE_BUCHE_DOCENTI_SETTIMANA || 2}">
            </div>
            <div class="form-group">
              <label class="form-label">
                ${isEn ? 'MAX ATTENDANCE DAYS SHARED TEACHERS' : 'MAX GIORNI DOCENTI COE'} <span class="param-help-icon" title="${isEn ? 'Maximum presence days for teachers shared across multiple schools' : 'Massimo numero di giorni di presenza per docenti su cattedra orario esterna'}">i</span>
              </label>
              <input type="number" id="param_MAX_GIORNI_DOCENTI_COE" class="form-input" value="${params.MAX_GIORNI_DOCENTI_COE || 4}">
            </div>
          </div>
        </div>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;">
      <button class="btn btn-primary" onclick="saveParametersSettings()">💾 ${isEn ? 'Save All Institution Parameters' : 'Salva Tutti i Parametri Istituto'}</button>
    </div>
  `;
}

function updateSabatoBadge(val) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const badge = document.getElementById('sabStatusBadge');
  const toggleBtn = document.getElementById('btnToggleSabato');
  const box = document.getElementById('day_box_Sab');
  const num = parseInt(val, 10) || 0;

  if (badge) {
    if (num === 0) {
      badge.className = 'badge badge-warn';
      badge.innerText = isEn ? '● Closed (0h)' : '● Chiuso (0h)';
    } else {
      badge.className = 'badge badge-ok';
      badge.innerText = isEn ? `● Active (${num}h)` : `● Attivo (${num}h)`;
    }
  }

  if (toggleBtn) {
    toggleBtn.innerText = num === 0 
      ? (isEn ? '➕ Open Saturday (5h)' : '➕ Attiva Sabato (5h)') 
      : (isEn ? '✕ Close Saturday (0h)' : '✕ Chiudi Sabato (0h)');
  }

  if (box) {
    if (num === 0) {
      box.style.border = '2px dashed #94a3b8';
      box.style.background = 'var(--bg-hover, #f1f5f9)';
    } else {
      box.style.border = '2px solid var(--primary, #3b82f6)';
      box.style.background = 'var(--bg-card, #f8fafc)';
    }
  }
}

function toggleSabatoQuick() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const sab = document.getElementById('day_limit_Sab');
  if (!sab) return;
  const cur = parseInt(sab.value, 10) || 0;
  if (cur === 0) {
    sab.value = 5;
    updateSabatoBadge(5);
    showToast(isEn ? '⚡ Saturday activated (5 periods max)' : '⚡ Sabato attivato per le lezioni (5 ore max)');
  } else {
    sab.value = 0;
    updateSabatoBadge(0);
    showToast(isEn ? '⚡ Saturday closed (0 periods)' : '⚡ Sabato chiuso (Settimana Corta a 0 ore)');
  }
}

function applyDayHoursPreset(type) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const lun = document.getElementById('day_limit_Lun');
  const mar = document.getElementById('day_limit_Mar');
  const mer = document.getElementById('day_limit_Mer');
  const gio = document.getElementById('day_limit_Gio');
  const ven = document.getElementById('day_limit_Ven');
  const sab = document.getElementById('day_limit_Sab');

  if (type === 'corta') {
    if (lun) lun.value = 6;
    if (mar) mar.value = 8;
    if (mer) mer.value = 6;
    if (gio) gio.value = 6;
    if (ven) ven.value = 8;
    if (sab) {
      sab.value = 0;
      updateSabatoBadge(0);
    }
    showToast(isEn ? '⚡ 5-Day Week preset applied (Saturday closed at 0h)' : '⚡ Applicata Settimana Corta (Sabato chiuso a 0 ore)');
  } else if (type === 'lunga_5h') {
    if (lun) lun.value = 6;
    if (mar) mar.value = 6;
    if (mer) mer.value = 6;
    if (gio) gio.value = 6;
    if (ven) ven.value = 6;
    if (sab) {
      sab.value = 5;
      updateSabatoBadge(5);
    }
    showToast(isEn ? '⚡ 6-Day Week preset applied (Saturday active with 5 periods)' : '⚡ Applicata Settimana Lunga (Sabato aperto con 5 ore)');
  } else if (type === 'lunga_4h') {
    if (lun) lun.value = 6;
    if (mar) mar.value = 6;
    if (mer) mer.value = 6;
    if (gio) gio.value = 6;
    if (ven) ven.value = 6;
    if (sab) {
      sab.value = 4;
      updateSabatoBadge(4);
    }
    showToast(isEn ? '⚡ 6-Day Week preset applied (Saturday active with 4 periods)' : '⚡ Applicata Settimana Lunga (Sabato aperto con 4 ore)');
  }
}

async function saveParametersSettings() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const instName = document.getElementById('cfgInstName').value.trim();
  const city = (document.getElementById('cfgCity')?.value || '').trim();
  const country = (document.getElementById('cfgCountry')?.value || (isEn ? 'United States' : 'Italia')).trim();
  const meccanografico = (document.getElementById('cfgMeccanografico')?.value || '').trim().toUpperCase();
  const contactEmail = (document.getElementById('cfgContactEmail')?.value || '').trim();
  const notes = (document.getElementById('cfgNotes')?.value || '').trim();
  const comments = document.getElementById('cfgComments').value.trim();
  const dayLimits = {};
  
  const daysList = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  daysList.forEach(d => {
    const el = document.getElementById(`day_limit_${d}`);
    if (el) dayLimits[d] = parseInt(el.value, 10) || 0;
    else if (d === 'Sab') dayLimits[d] = 0;
  });

  const sabHours = dayLimits['Sab'] || 0;
  const activeDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
  if (sabHours > 0) {
    activeDays.push('Sab');
  }

  // Raccogli parametri avanzati
  const updatedParams = { ...(stateData.settings?.parameters || {}) };
  const paramFieldIds = [
    'ORARIO_SEDE_CENTRALE',
    'ORARIO_SEDE_SUCCURSALE',
    'ORE_MATTINO',
    'ORE_POMERIGGIO',
    'TEMPO_SPOSTAMENTO_SEDI_MINUTI',
    'MIN_INTERVALLO_PALESTRA_MINUTI',
    'BLOCCO_POMERIDIANO_NO_MAT',
    'BLOCCO_POMERIDIANO_NO_ITA',
    'PREFERENZA_PALESTRA_POMERIGGIO',
    'COMPATTA_ORARIO_DOCENTI',
    'MAX_ORE_BUCHE_DOCENTI_SETTIMANA',
    'MAX_GIORNI_DOCENTI_COE'
  ];

  paramFieldIds.forEach(id => {
    const el = document.getElementById(`param_${id}`);
    if (el) {
      const val = el.value.trim();
      if (['ORE_MATTINO', 'ORE_POMERIGGIO', 'TEMPO_SPOSTAMENTO_SEDI_MINUTI', 'MIN_INTERVALLO_PALESTRA_MINUTI', 'MAX_ORE_BUCHE_DOCENTI_SETTIMANA', 'MAX_GIORNI_DOCENTI_COE'].includes(id)) {
        updatedParams[id] = parseInt(val, 10) || 0;
      } else {
        updatedParams[id] = val;
      }
    }
  });

  const payload = {
    institution: instName,
    city: city,
    country: country,
    meccanografico: meccanografico,
    contact_email: contactEmail,
    notes: notes,
    comments: comments,
    days: activeDays,
    day_hours_limit: dayLimits,
    parameters: updatedParams
  };

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const resData = await res.json().catch(() => ({}));

  if (res.ok) {
    showToast(isEn ? 'Institution parameters and calendar saved successfully!' : 'Parametri istituto e calendario salvati con successo!');
    const badge = document.getElementById('instBadge');
    if (badge) badge.innerText = instName;
    if (window.currentSchool) {
      window.currentSchool.name = instName;
      window.currentSchool.city = city;
      window.currentSchool.country = country;
      window.currentSchool.meccanografico = meccanografico;
      window.currentSchool.contact_email = contactEmail;
      window.currentSchool.notes = notes;
    }
    const sName = document.getElementById('currentSchoolName');
    if (sName && instName) sName.innerText = instName;
    await loadMySchools();
    renderParameters();
  } else {
    alert(resData.error || (isEn ? 'Error saving parameters.' : 'Errore durante il salvataggio dei parametri.'));
  }
}

function renderSettings() {
  renderParameters();
}

// ============================================================================
// 10. IMPORT / EXPORT
// ============================================================================
// ============================================================================
// 10. IMPORT / EXPORT & BACKUP FILE
// ============================================================================
function renderImportExport() {
  renderSnapshots();
}

async function exportFetFile() {
  try {
    showToast('Generazione file ParametriOrario.fet in corso...');
    const res = await fetch('/api/export/fet');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast('Errore durante la generazione del file FET: ' + (err.error || res.statusText), 'err');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ParametriOrario.fet';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
    showToast('Download ParametriOrario.fet completato con successo!');
  } catch (e) {
    console.warn('Fetch download failed, falling back to direct navigation:', e);
    window.location.href = '/api/export/fet';
  }
}

async function exportSolvedTimetable() {
  try {
    showToast('Download orario risolto in corso...');
    const res = await fetch('/api/export/timetable');
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Nessun orario risolto salvato.' }));
      showToast(err.error || 'Nessun orario risolto ancora salvato o calcolato.', 'err');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Orario_Risolto_data_and_timetable.fet';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
    showToast('Download Orario Risolto (.fet) completato con successo!');
  } catch (e) {
    console.warn('Fetch download failed, falling back to direct navigation:', e);
    window.location.href = '/api/export/timetable';
  }
}

async function downloadCurrentConfigJson() {
  try {
    const res = await fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Backup_${new Date().toISOString().slice(0, 10)}_${new Date().toLocaleTimeString().replace(/:/g, '')}`,
        description: 'Backup rapido esportato'
      })
    });
    if (!res.ok) {
      showToast('Errore durante la generazione del backup JSON', 'err');
      return;
    }
    const d = await res.json();
    const sid = d.snapshot.id;
    window.location.href = `/api/snapshots/${sid}/download`;
    showToast('Configurazione JSON esportata con successo!');
  } catch (e) {
    showToast('Errore export JSON: ' + e.message, 'err');
  }
}

function uploadFetFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const xml = e.target.result;
    showToast(`Caricamento "${file.name}" in corso...`);
    const res = await fetch('/api/import/fet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml: xml, filename: file.name })
    });
    if (res.ok) {
      showToast(`File "${file.name}" importato con successo!`);
      activeEntity = '';
      activeTimetableView = 'teacher';
      stateData.timetableViews = null;
      await refreshAppState();
      navigate('timetable');
    } else {
      alert('Errore durante l\'importazione del file .fet.');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ============================================================================
// 11. ARCHIVIO VERSIONI, SNAPSHOT & STORICO ESECUZIONI
// ============================================================================
async function renderSnapshots() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const container = document.getElementById('mainContent');
  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">${isEn ? 'Loading snapshot archive...' : 'Caricamento archivio snapshot...'}</div>`;

  try {
    const res = await fetch('/api/snapshots');
    const data = await res.json();
    const currentName = data.current_config_name || (isEn ? 'Current Configuration' : 'Configurazione Corrente');
    const snapshots = data.snapshots || [];

    container.innerHTML = `
      <div class="info-banner-blue">
        ${isEn 
          ? '📦 <b>Snapshot System & Version History:</b><br>All changes to constraints, teachers, subjects, and parameters are always saved automatically in the application database. Create a <b>Snapshot / Restore Point</b> before making major edits to enable immediate <b>Rollback</b> to a working configuration at any time.'
          : '📦 <b>Archivio Storico & Sistema Snapshot:</b><br>Tutte le modifiche a vincoli, docenti, materie e parametri rimangono sempre salvate automaticamente nel database dell\'applicazione. Crea uno <b>Snapshot / Punto di Ripristino</b> prima di apportare modifiche radicali per poter effettuare il <b>Rollback</b> immediato a una versione funzionante in qualsiasi momento.'}
      </div>

      <!-- Card Stato Configurazione Corrente -->
      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:0.5px;">${isEn ? 'System Active Configuration' : 'Configurazione Attiva nel Sistema'}</div>
            <div style="font-size:18px;font-weight:800;color:var(--text-main);margin-top:2px;display:flex;align-items:center;gap:8px;">
              <span>⚡</span> <span id="currentConfigTitle">${escapeHtml(currentName)}</span>
              <button class="btn btn-sm btn-sec" onclick="openRenameCurrentModal('${escapeJs(currentName)}')" title="${isEn ? 'Rename active configuration' : 'Rinomina la configurazione attiva'}">✏️ ${isEn ? 'Rename' : 'Rinomina'}</button>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
              ${isEn 
                ? 'Current state is permanently persistent. All edits applied across other views modify this configuration.' 
                : 'Stato corrente sempre salvato e persistente. Tutte le modifiche applicate nelle altre schermate agiscono su questa configurazione.'}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openSaveSnapshotModal()" title="${isEn ? 'Save an instant restore point in the database' : 'Salva un punto di ripristino istantaneo nel database'}">
              📸 ${isEn ? 'Save New Snapshot' : 'Salva Nuovo Snapshot'}
            </button>
            <button class="btn btn-sec" onclick="exportFetFile()" title="${isEn ? 'Download ParametriOrario.fet ready for official FET Desktop application' : 'Scarica il file ParametriOrario.fet pronto per l\'applicazione ufficiale FET Desktop'}">
              📥 ${isEn ? 'Export Parameters (.fet)' : 'Esporta Parametri (.fet)'}
            </button>
            <button class="btn btn-sec" onclick="exportSolvedTimetable()" title="${isEn ? 'Download .fet file with complete generated timetable' : 'Scarica il file .fet con l\'orario completo generato'}">
              🗓️ ${isEn ? 'Export Solved Timetable (.fet)' : 'Esporta Orario Risolto (.fet)'}
            </button>
            <button class="btn btn-sec" onclick="downloadCurrentConfigJson()" title="${isEn ? 'Download complete configuration and database in .json format' : 'Scarica la configurazione completa e l\'intero database in formato .json'}">
              💾 ${isEn ? 'Download Backup (.json)' : 'Scarica Backup (.json)'}
            </button>
          </div>
        </div>
      </div>

      <!-- Card Demo & Inizializzazione Scuola -->
      <div class="card" style="margin-bottom:20px;border-left:4px solid var(--primary);background:var(--bg-card);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;">
          <div>
            <div class="card-title" style="margin-bottom:3px;display:flex;align-items:center;gap:6px;">
              <span>🏰</span> <b>${isEn ? 'Sample Timetables ("School of Athens") & Project Reset' : 'Database Demo Didattici ("Scuola di Atene") & Reset'}</b>
            </div>
            <div style="font-size:12px;color:var(--text-muted);max-width:680px;line-height:1.4;">
              ${isEn 
                ? 'Reload a complete sample school timetable at any time (choose between English or Italian version of <b>"School of Athens"</b>, both with 100% pre-solved timetable) or <b>reset to a clean blank sheet</b> to start a new school from scratch.' 
                : 'Ricarica in qualsiasi momento un orario didattico dimostrativo completo (scegli tra la versione in Italiano oppure in Inglese del <b>Liceo "Scuola di Atene"</b>, entrambi con orario risolto al 100%) oppure <b>azzera l\'applicazione a foglio bianco</b> per iniziare una nuova scuola da zero.'}
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button class="btn btn-outline" onclick="confirmRestoreDemo()" title="${isEn ? 'Restore sample demonstration timetable (\"School of Athens\")' : 'Ripristina un orario didattico dimostrativo (\"Scuola di Atene\")'}" style="font-weight:700;border:1.5px solid var(--primary);color:var(--primary);background:var(--bg-main);">
              🏰 ${isEn ? 'Restore Sample Data (\"School of Athens\")' : 'Ripristina Demo (\"Scuola di Atene\")'}
            </button>
            <button class="btn btn-danger" onclick="confirmResetEmpty()" title="${isEn ? 'Empty database completely and start with a clean school' : 'Svuota completamente il database e crea un nuovo istituto pulito'}" style="font-weight:700;">
              🧹 ${isEn ? 'Reset All (Blank Sheet)' : 'Azzera Tutto (Foglio Bianco)'}
            </button>
          </div>
        </div>
      </div>

      <!-- Card Upload / Import da Computer -->
      <div class="card" style="margin-bottom:20px;">
        <div class="card-title">${isEn ? '📤 Import Files from Computer (FET or JSON)' : '📤 Importa File da Computer (FET o JSON)'}</div>
        <p style="color:var(--text-muted);margin-bottom:12px;font-size:12.5px;">
          ${isEn 
            ? 'You can upload a <b>.fet</b> or <b>.xml</b> file generated by FET Desktop, or a <b>.json</b> backup file: it will be imported and registered as a restore point in the archive.' 
            : 'Puoi caricare un file <b>.fet</b> o <b>.xml</b> generato da FET Desktop, oppure un file di backup <b>.json</b>: verrà importato e registrato come punto di ripristino nell\'archivio.'}
        </p>
        <div style="border: 2px dashed var(--border); border-radius: var(--radius-md); padding: 24px 20px; text-align: center; cursor: pointer; transition: background 0.15s;"
             onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'"
             onclick="document.getElementById('snapshotUploadInput').click()">
          <div style="font-size:28px;margin-bottom:6px;">📂</div>
          <div style="font-size:13.5px;font-weight:600;color:var(--text-main);margin-bottom:4px;">${isEn ? 'Click to select a .fet, .xml or .json file from computer' : 'Clicca per selezionare un file .fet, .xml o .json dal computer'}</div>
          <div style="font-size:11.5px;color:var(--text-muted);">${isEn ? 'Drag and drop or select a file to import directly into the system' : 'Trascina o seleziona un file per importarlo direttamente nel sistema'}</div>
          <input type="file" id="snapshotUploadInput" accept=".json,.fet,.xml" style="display:none;" onchange="uploadSnapshotFile(this.files[0])">
        </div>
      </div>

      <!-- Tabella Archivio Snapshot -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <div class="card-title" style="margin-bottom:0;">
            ${isEn ? `📚 Saved Versions & Restore Points (${snapshots.length})` : `📚 Versioni Salvate & Punti di Ripristino (${snapshots.length})`}
          </div>
          <input type="text" class="search-input" placeholder="${isEn ? '🔍 Search snapshots...' : '🔍 Cerca snapshot...'}" oninput="filterSnapshotsTable(this.value)" style="width:240px;">
        </div>

        ${snapshots.length === 0 ? `
          <div style="text-align:center;padding:36px;color:var(--text-muted);border:1px dashed var(--border);border-radius:var(--radius-md);">
            ${isEn ? 'No snapshots saved yet. Click <b>📸 Save New Snapshot</b> to create your first restore point!' : 'Nessuno snapshot salvato finora. Clicca su <b>📸 Salva Nuovo Snapshot</b> per creare il primo punto di ripristino!'}
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table" id="snapshotsTable">
              <thead>
                <tr>
                  <th style="width:40px;">#</th>
                  <th style="width:145px;">${isEn ? 'Date & Time' : 'Data & Ora'}</th>
                  <th style="min-width:200px;">${isEn ? 'Version / Snapshot Name' : 'Nome Versione / Snapshot'}</th>
                  <th style="min-width:180px;">${isEn ? 'Description / Notes' : 'Descrizione / Note'}</th>
                  <th style="width:190px;">${isEn ? 'Data & Timetable' : 'Dati & Orario'}</th>
                  <th style="text-align:right;min-width:260px;">${isEn ? 'Actions & Rollback' : 'Azioni & Rollback'}</th>
                </tr>
              </thead>
              <tbody>
                ${snapshots.map((s, idx) => {
                  const st = s.stats || {};
                  return `
                    <tr class="snapshot-row" data-search="${escapeHtml((s.name + ' ' + (s.description || '')).toLowerCase())}">
                      <td style="color:var(--text-muted);font-size:12px;">${idx + 1}</td>
                      <td style="font-size:12px;color:var(--text-sub);white-space:nowrap;">
                        📅 ${escapeHtml(s.created_at || '-')}
                      </td>
                      <td>
                        <b style="font-size:13.5px;color:var(--primary);">${escapeHtml(s.name)}</b>
                        <div style="font-size:10.5px;font-family:var(--font-mono);color:var(--text-muted);">${escapeHtml(s.id)}</div>
                      </td>
                      <td style="font-size:12px;color:var(--text-main);">
                        ${s.description ? escapeHtml(s.description) : `<span style="color:var(--text-muted);font-style:italic;">${isEn ? 'No description' : 'Nessuna descrizione'}</span>`}
                      </td>
                      <td>
                        <div style="display:flex;flex-wrap:wrap;gap:4px;">
                          ${st.teachers_count !== undefined ? `<span class="item-chip" title="${isEn ? 'Teachers count' : 'Numero docenti'}">👨‍🏫 ${st.teachers_count}</span>` : ''}
                          ${st.classes_count !== undefined ? `<span class="item-chip" title="${isEn ? 'Classes count' : 'Numero classi'}">🎓 ${st.classes_count}</span>` : ''}
                          ${st.activities_count !== undefined ? `<span class="item-chip" title="${isEn ? 'Activities count' : 'Numero attività'}">📚 ${st.activities_count}</span>` : ''}
                          ${s.has_timetable ? `<span class="badge badge-ok" title="${isEn ? 'Includes complete solved timetable' : 'Include orario risolto completo'}">✅ ${isEn ? 'FET Timetable' : 'Orario FET'}</span>` : `<span class="badge badge-warn" title="${isEn ? 'Parameters and constraints configuration only' : 'Solo configurazione parametri/vincoli'}">⚙️ ${isEn ? 'Data Only' : 'Solo Dati'}</span>`}
                        </div>
                      </td>
                      <td style="text-align:right;white-space:nowrap;">
                        <button class="btn btn-sm btn-primary" onclick="restoreSnapshot('${escapeJs(s.id)}', '${escapeJs(s.name)}')" title="${isEn ? 'Rollback: restore this configuration as active' : 'Esegui il Rollback: ripristina questa configurazione come attiva'}">
                          🔄 Rollback
                        </button>
                        <button class="btn btn-sm btn-sec" onclick="downloadSnapshotJson('${escapeJs(s.id)}')" title="${isEn ? 'Download JSON file for this snapshot' : 'Scarica il file JSON di questo snapshot'}">
                          📥 JSON
                        </button>
                        ${s.has_timetable ? `
                          <button class="btn btn-sm btn-sec" onclick="downloadSnapshotFet('${escapeJs(s.id)}')" title="${isEn ? 'Download FET file associated with this timetable' : 'Scarica il file FET associato a questo orario'}">
                            📥 FET
                          </button>
                        ` : ''}
                        <button class="btn btn-sm btn-sec" onclick="openRenameSnapshotModal('${escapeJs(s.id)}', '${escapeJs(s.name)}', '${escapeJs(s.description || '')}')" title="${isEn ? 'Edit snapshot name and notes' : 'Modifica nome e note dello snapshot'}">
                          ✏️
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteSnapshot('${escapeJs(s.id)}', '${escapeJs(s.name)}')" title="${isEn ? 'Permanently delete this snapshot from archive' : 'Elimina definitivamente questo snapshot dall\'archivio'}">
                          🗑️
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);padding:24px;">${isEn ? 'Error loading snapshots: ' : 'Errore caricamento snapshot: '}${escapeHtml(err.message)}</div>`;
  }
}

function filterSnapshotsTable(query) {
  const q = (query || '').toLowerCase().trim();
  document.querySelectorAll('#snapshotsTable tbody .snapshot-row').forEach(row => {
    const s = row.getAttribute('data-search') || '';
    row.style.display = s.includes(q) ? '' : 'none';
  });
}

// --- GESTIONE DEMO & RESET PROGETTO ---
function confirmRestoreDemo() {
  const isEn = window.I18N && window.I18N.getLanguage() === 'en';
  showModal(`
    <div class="modal-dialog" style="max-width:560px;">
      <div class="modal-header">
        <div class="modal-title">🏰 ${isEn ? 'Restore Sample Timetable (\"School of Athens\")' : 'Ripristina Demo Didattica (\"Scuola di Atene\")'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body" style="padding:18px 22px;display:flex;flex-direction:column;gap:14px;">
        <p style="font-size:13.5px;color:var(--text-main);line-height:1.5;">
          ${isEn 
            ? 'Choose which demonstration database you would like to load. Both include a complete school with 8 faculty members, 5 grade sections, specialized labs, gym and a <b>100% pre-solved timetable</b>.' 
            : 'Scegli quale database dimostrativo desideri caricare. Entrambi includono un istituto completo con 8 docenti storici, 5 classi, laboratori, palestra e un <b>orario già risolto al 100%</b>.'}
        </p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div style="background:var(--bg-app);border:1.5px solid var(--border);border-radius:10px;padding:14px;display:flex;flex-direction:column;justify-content:space-between;gap:10px;">
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--primary);display:flex;align-items:center;gap:6px;">
                <span>🇮🇹</span> <span>Scuola di Atene (ITA)</span>
              </div>
              <div style="font-size:11.5px;color:var(--text-muted);margin-top:6px;line-height:1.4;">
                Liceo Classico e Scientifico "Scuola di Atene" con Platone, Dante, Galileo, Marie Curie e Aristotele.
              </div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="executeLoadDemo('it')" style="width:100%;font-weight:600;">
              🇮🇹 Carica Demo ITA
            </button>
          </div>

          <div style="background:var(--bg-app);border:1.5px solid var(--border);border-radius:10px;padding:14px;display:flex;flex-direction:column;justify-content:space-between;gap:10px;">
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--primary);display:flex;align-items:center;gap:6px;">
                <span>🇬🇧</span> <span>School of Athens (ENG)</span>
              </div>
              <div style="font-size:11.5px;color:var(--text-muted);margin-top:6px;line-height:1.4;">
                School of Athens Classical & Scientific High School with Plato, Dante, Galileo, Marie Curie & Aristotle.
              </div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="executeLoadDemo('en')" style="width:100%;font-weight:600;">
              🇬🇧 Load ENG Demo
            </button>
          </div>
        </div>

        <div class="info-banner-blue" style="font-size:11.5px;line-height:1.4;">
          💡 ${isEn ? 'A security backup snapshot of your current data will be created automatically before loading.' : 'Verrà creato automaticamente uno Snapshot di sicurezza dei dati attuali prima del caricamento.'}
        </div>
      </div>
      <div class="modal-footer" style="padding:12px 20px;display:flex;justify-content:flex-end;">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', 'Annulla')}</button>
      </div>
    </div>
  `);
}

async function executeLoadDemo(lang = 'it') {
  closeModal();
  const isEn = lang === 'en';
  showToast(isEn ? 'Loading "School of Athens" demo dataset...' : 'Caricamento demo "Scuola di Atene" in corso...');
  try {
    const res = await fetch('/api/project/load_demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: lang })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(isEn ? '🎉 "School of Athens" Demo loaded successfully!' : '🎉 Demo "Scuola di Atene" caricata con successo!');
      activeEntity = '';
      activeTimetableView = 'teacher';
      stateData.timetableViews = null;
      await refreshAppState();
      await loadMySchools();
      renderSnapshots();
    } else {
      showToast('Errore nel caricamento demo: ' + (data.error || 'Errore sconosciuto'), 'err');
    }
  } catch (e) {
    showToast('Errore di connessione: ' + e.message, 'err');
  }
}

function confirmResetEmpty() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  showModal(`
    <div class="modal-dialog" style="max-width:540px;">
      <div class="modal-header">
        <div class="modal-title">🧹 ${isEn ? 'Reset All (New School from Scratch)' : 'Azzera Tutto (Nuovo Istituto a Foglio Bianco)'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body" style="padding:18px 22px;">
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:var(--radius-sm);padding:12px 14px;color:#991b1b;font-size:12.5px;margin-bottom:16px;line-height:1.4;">
          ⚠️ <b>${isEn ? 'Warning:' : 'Attenzione:'}</b> ${isEn 
            ? 'This operation clears teachers, classes, subjects, rooms and solved timetables to set up a new school from scratch.<br>An automatic Snapshot will be created before deletion.' 
            : 'Questa operazione svuota docenti, classi, materie, aule e orario risolto per preparare una nuova scuola da zero.<br>Verrà salvato uno Snapshot automatico prima della cancellazione.'}
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label" style="font-weight:700;">${isEn ? 'Name of New Educational Institution' : "Nome del Nuovo Istituto Scolastico"}</label>
          <input type="text" id="resetInstNameInput" class="form-input" placeholder="${isEn ? 'e.g. Athens Academy High School' : 'es. Liceo Scientifico Statale Galileo'}" value="${isEn ? 'New Educational Institution' : 'Nuovo Istituto Scolastico'}">
        </div>
      </div>
      <div class="modal-footer" style="padding:12px 20px;display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', isEn ? 'Cancel' : 'Annulla')}</button>
        <button class="btn btn-danger" onclick="executeResetEmpty()" style="font-weight:700;">
          🧹 ${isEn ? 'Confirm Reset' : 'Conferma Svuotamento'}
        </button>
      </div>
    </div>
  `);
}

async function executeResetEmpty() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const instName = document.getElementById('resetInstNameInput')?.value?.trim() || (isEn ? 'New Educational Institution' : 'Nuovo Istituto Scolastico');
  closeModal();
  showToast(isEn ? 'Resetting project to blank canvas...' : 'Azzeramento progetto in corso...');
  try {
    const res = await fetch('/api/project/reset_empty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution: instName })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(isEn ? '🧹 Project reset to blank canvas successfully!' : '🧹 Progetto azzerato a foglio bianco con successo!');
      activeEntity = '';
      activeTimetableView = 'teacher';
      stateData.timetableViews = null;
      await refreshAppState();
      await loadMySchools();
      renderSnapshots();
    } else {
      showToast((isEn ? 'Error during reset: ' : 'Errore durante l\'azzeramento: ') + (data.error || (isEn ? 'Unknown error' : 'Errore sconosciuto')), 'err');
    }
  } catch (e) {
    showToast((isEn ? 'Connection error: ' : 'Errore di connessione: ') + e.message, 'err');
  }
}

// --- MODALI & AZIONI SNAPSHOT ---
function openSaveSnapshotModal() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const defName = isEn 
    ? `Snapshot ${new Date().toLocaleDateString('en-US')} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
    : `Snapshot ${new Date().toLocaleDateString('it-IT')} ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">📸 ${isEn ? 'Save New Snapshot / Version' : 'Salva Nuovo Snapshot / Versione'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">
          ${isEn 
            ? 'A complete snapshot of current state will be created: teachers, classes, availabilities, constraints, time blocks and current solved timetable.' 
            : 'Verrà creata un\'istantanea completa dello stato attuale: docenti, classi, disponibilità, vincoli, blocchi orari e l\'eventuale orario risolto corrente.'}
        </p>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Snapshot / Version Name' : 'Nome Snapshot / Versione'}</label>
          <input type="text" id="newSnapName" class="form-input" value="${escapeHtml(defName)}" placeholder="${isEn ? 'e.g. Version with 4-hour max constraint' : 'Es. Versione con vincolo 4 ore max'}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Notes / Description (optional)' : 'Note / Descrizione (opzionale)'}</label>
          <textarea id="newSnapDesc" class="form-textarea" rows="3" placeholder="${isEn ? 'e.g. Tested relaxing teacher gap constraints' : 'Es. Provato a rilassare vincolo buchi docenti per testare compilazione'}"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', isEn ? 'Cancel' : 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitSaveSnapshot()">💾 ${isEn ? 'Save Snapshot' : 'Salva Snapshot'}</button>
      </div>
    </div>
  `);
}

async function submitSaveSnapshot() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const name = document.getElementById('newSnapName')?.value.trim();
  const desc = document.getElementById('newSnapDesc')?.value.trim();
  if (!name) {
    alert(isEn ? 'Please enter a name for the snapshot.' : 'Inserisci un nome per lo snapshot.');
    return;
  }
  showToast(isEn ? 'Saving snapshot...' : 'Salvataggio snapshot in corso...');
  const res = await fetch('/api/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, description: desc })
  });
  if (res.ok) {
    closeModal();
    showToast(isEn ? `Snapshot "${name}" saved successfully!` : `Snapshot "${name}" salvato con successo!`);
    renderSnapshots();
  } else {
    alert(isEn ? 'Error saving snapshot.' : 'Errore durante il salvataggio dello snapshot.');
  }
}

function openRenameCurrentModal(currentName) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">✏️ ${isEn ? 'Rename Active Configuration' : 'Rinomina Configurazione Attiva'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">${isEn ? 'New Name for Active Configuration' : 'Nuovo Nome per la Configurazione Attiva'}</label>
          <input type="text" id="renameCurrentInput" class="form-input" value="${escapeHtml(currentName)}" placeholder="${isEn ? 'e.g. Final Timetable 2026/27' : 'Es. Orario Definitivo A.S. 2024/25'}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', isEn ? 'Cancel' : 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitRenameCurrent()">💾 ${isEn ? 'Save Name' : 'Salva Nome'}</button>
      </div>
    </div>
  `);
}

async function submitRenameCurrent() {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const name = document.getElementById('renameCurrentInput')?.value.trim();
  if (!name) {
    alert(isEn ? 'Please enter a valid name.' : 'Inserisci un nome valido.');
    return;
  }
  const res = await fetch('/api/snapshots/rename_current', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  });
  if (res.ok) {
    closeModal();
    showToast(isEn ? `Configuration renamed to "${name}"!` : `Configurazione rinominata in "${name}"!`);
    renderSnapshots();
  } else {
    alert(isEn ? 'Error renaming configuration.' : 'Errore durante la rinomina della configurazione.');
  }
}

function openRenameSnapshotModal(sid, currentName, currentDesc) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">✏️ ${isEn ? 'Edit Snapshot' : 'Modifica Snapshot'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">${isEn ? 'Snapshot Name' : 'Nome Snapshot'}</label>
          <input type="text" id="renameSnapName" class="form-input" value="${escapeHtml(currentName)}">
        </div>
        <div class="form-group">
          <label class="form-label">${isEn ? 'Description / Notes' : 'Descrizione / Note'}</label>
          <textarea id="renameSnapDesc" class="form-textarea" rows="3">${escapeHtml(currentDesc || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()" data-i18n="common.cancel">${_t('common.cancel', isEn ? 'Cancel' : 'Annulla')}</button>
        <button class="btn btn-primary" onclick="submitRenameSnapshot('${escapeJs(sid)}')">💾 ${isEn ? 'Save Changes' : 'Salva Modifiche'}</button>
      </div>
    </div>
  `);
}

async function submitRenameSnapshot(sid) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const name = document.getElementById('renameSnapName')?.value.trim();
  const desc = document.getElementById('renameSnapDesc')?.value.trim();
  if (!name) {
    alert(isEn ? 'Please enter a name for the snapshot.' : 'Inserisci un nome per lo snapshot.');
    return;
  }
  const res = await fetch('/api/snapshots/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sid, name: name, description: desc })
  });
  if (res.ok) {
    closeModal();
    showToast(isEn ? 'Snapshot updated successfully!' : 'Snapshot aggiornato con successo!');
    renderSnapshots();
  } else {
    alert(isEn ? 'Error updating snapshot.' : 'Errore durante la modifica dello snapshot.');
  }
}

async function restoreSnapshot(sid, snapName) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const confirmMsg = isEn 
    ? `Are you sure you want to ROLLBACK to snapshot "${snapName}"?\n\nAll current parameters, constraints, teaching assignments and timetables will be restored to this snapshot's state.`
    : `Sei sicuro di voler eseguire il ROLLBACK allo snapshot "${snapName}"?\n\nTutti i parametri, vincoli, cattedre e orari correnti verranno ripristinati allo stato di questo snapshot.`;
  if (confirm(confirmMsg)) {
    showToast(isEn ? 'Restoring snapshot...' : 'Ripristino snapshot in corso...');
    const res = await fetch('/api/snapshots/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid })
    });
    if (res.ok) {
      showToast(isEn ? `Snapshot "${snapName}" restored successfully!` : `Snapshot "${snapName}" ripristinato con successo!`, 'ok');
      activeEntity = '';
      activeTimetableView = 'teacher';
      stateData.timetableViews = null;
      await refreshAppState();
      await loadMySchools();
      renderSnapshots();
    } else {
      alert(isEn ? 'Error restoring snapshot.' : 'Errore durante il ripristino dello snapshot.');
    }
  }
}

async function deleteSnapshot(sid, snapName) {
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const confirmMsg = isEn
    ? `Are you sure you want to permanently delete snapshot "${snapName}" from archive?`
    : `Sei sicuro di voler eliminare definitivamente lo snapshot "${snapName}" dall'archivio?`;
  if (confirm(confirmMsg)) {
    const res = await fetch(`/api/snapshots/${encodeURIComponent(sid)}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(isEn ? `Snapshot "${snapName}" deleted.` : `Snapshot "${snapName}" eliminato.`, 'warn');
      renderSnapshots();
    } else {
      alert(isEn ? 'Error deleting snapshot.' : 'Errore durante l\'eliminazione dello snapshot.');
    }
  }
}

function downloadSnapshotJson(sid) {
  window.location.href = `/api/snapshots/${encodeURIComponent(sid)}/download`;
}

function downloadSnapshotFet(sid) {
  window.location.href = `/api/snapshots/${encodeURIComponent(sid)}/download_fet`;
}

function uploadSnapshotFile(file) {
  if (!file) return;
  const isEn = window.I18N ? window.I18N.getLanguage() === 'en' : false;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const content = e.target.result;
    showToast(isEn ? `Uploading "${file.name}"...` : `Caricamento "${file.name}" in corso...`);
    try {
      const res = await fetch('/api/snapshots/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content, filename: file.name })
      });
      if (res.ok) {
        const respData = await res.json().catch(() => ({}));
        const snap = respData.snapshot;
        showToast(isEn ? `File "${file.name}" uploaded successfully!` : `File "${file.name}" caricato con successo!`, 'ok');
        const applyMsg = isEn
          ? `File "${file.name}" uploaded to archive!\n\nDo you want to activate and apply it now as the active system configuration?`
          : `File "${file.name}" caricato nell'archivio!\n\nVuoi attivarlo e applicarlo subito come configurazione attiva del sistema?`;
        if (snap && snap.id && confirm(applyMsg)) {
          await restoreSnapshot(snap.id, snap.name);
        } else {
          renderSnapshots();
        }
      } else {
        const err = await res.json().catch(() => ({ error: 'Formato non valido' }));
        alert((isEn ? 'File import error: ' : 'Errore importazione file: ') + (err.error || (isEn ? 'Invalid data' : 'Dati non validi')));
      }
    } catch (ex) {
      alert((isEn ? 'Upload error: ' : 'Errore durante il caricamento: ') + ex.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}


// --- UTILITIES ---
function filterTable(tableId, query) {
  const q = query.toLowerCase();
  const rows = document.querySelectorAll(`#${tableId} tbody tr`);
  rows.forEach(r => {
    const text = r.innerText.toLowerCase();
    r.style.display = text.includes(q) ? '' : 'none';
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function escapeJs(str) {
  if (!str) return '';
  return String(str).replace(/['"\\]/g, '\\$&');
}

// ============================================================================
// STAMPE UFFICIALI & REPORT (PROCEDURA 9: CLASSI, PROCEDURA 12: DOCENTI)
// ============================================================================
let printOptionsCache = null;

async function loadPrintOptionsMetadata() {
  if (printOptionsCache) return printOptionsCache;
  try {
    const res = await fetch('/api/print/options');
    if (res.ok) {
      printOptionsCache = await res.json();
      return printOptionsCache;
    }
  } catch (e) {
    console.error('Errore caricamento opzioni stampa:', e);
  }
  return null;
}

async function openPrintClassesModal() {
  const modal = document.getElementById('printClassesModal');
  if (!modal) return;
  modal.style.display = 'flex';

  const curLang = (window.I18N ? window.I18N.getLanguage() : null) || localStorage.getItem('app_lang') || 'it';
  const langSelect = document.getElementById('printClassesLang');
  if (langSelect) {
    langSelect.value = curLang;
    langSelect.onchange = () => {
      try {
        localStorage.setItem('app_lang', langSelect.value);
        document.cookie = "app_lang=" + langSelect.value + "; path=/; max-age=31536000; SameSite=Lax";
      } catch (_) {}
    };
  }

  // Imposta data di default immediata se vuota
  const dateInput = document.getElementById('printClassesDate');
  if (dateInput && !dateInput.value) {
    const today = new Date();
    const daysAhead = ((7 - today.getDay()) % 7) || 7;
    const nextMon = new Date(today.getTime() + daysAhead * 86400000);
    const dd = String(nextMon.getDate()).padStart(2, '0');
    const mm = String(nextMon.getMonth() + 1).padStart(2, '0');
    const yyyy = nextMon.getFullYear();
    dateInput.value = `${dd}/${mm}/${yyyy}`;
  }

  // Popolamento immediato da stateData se disponibile
  if (stateData && stateData.classes && stateData.classes.length) {
    const fallbackClasses = stateData.classes.map(c => ({
      name: c.name,
      is_subgroup: false,
      mother: ''
    }));
    renderPrintClassesCheckboxes(fallbackClasses);
  }

  const meta = await loadPrintOptionsMetadata();
  if (meta) {
    if (dateInput && meta.default_validity_date) {
      dateInput.value = meta.default_validity_date;
    }
    if (meta.classes && meta.classes.length) {
      renderPrintClassesCheckboxes(meta.classes);
    }
  }
}

function closePrintClassesModal() {
  const modal = document.getElementById('printClassesModal');
  if (modal) modal.style.display = 'none';
}

function renderPrintClassesCheckboxes(classes) {
  const container = document.getElementById('printClassesCheckboxesWrap');
  if (!container) return;

  container.innerHTML = classes.map(c => {
    const isSub = c.is_subgroup;
    const subLabel = isSub ? `<span class="chip-sub">(${escapeHtml(c.mother)})</span>` : '';
    return `
      <label class="class-chip active" id="chip_${escapeHtml(c.name)}" data-name="${escapeHtml(c.name)}" data-year="${c.name.charAt(0)}">
        <input type="checkbox" class="print-class-cb" value="${escapeHtml(c.name)}" checked onchange="onPrintClassCbChange(this)" />
        <span>${escapeHtml(c.name)}</span>
        ${subLabel}
      </label>
    `;
  }).join('');

  updatePrintClassesSelectedCount();
}

function onPrintClassCbChange(cb) {
  const chip = cb.closest('.class-chip');
  if (chip) {
    chip.classList.toggle('active', cb.checked);
  }
  updatePrintClassesSelectedCount();
}

function updatePrintClassesSelectedCount() {
  const total = document.querySelectorAll('.print-class-cb').length;
  const checked = document.querySelectorAll('.print-class-cb:checked').length;
  const badge = document.getElementById('printClassesSelectedCount');
  if (badge) {
    if (checked === total) {
      badge.textContent = 'Tutte le classi (' + total + ')';
      badge.className = 'badge badge-ok';
    } else if (checked === 0) {
      badge.textContent = 'Nessuna selezionata';
      badge.className = 'badge badge-warn';
    } else {
      badge.textContent = checked + ' di ' + total + ' classi';
      badge.className = 'badge badge-info';
    }
  }
}

function setPrintClassesFilter(filterType) {
  const cbs = document.querySelectorAll('.print-class-cb');
  cbs.forEach(cb => {
    let shouldCheck = false;
    if (filterType === 'all') {
      shouldCheck = true;
    } else if (filterType === 'none') {
      shouldCheck = false;
    } else {
      const chip = cb.closest('.class-chip');
      const year = chip ? chip.getAttribute('data-year') : '';
      shouldCheck = (year === filterType);
    }
    cb.checked = shouldCheck;
    const chip = cb.closest('.class-chip');
    if (chip) chip.classList.toggle('active', shouldCheck);
  });
  updatePrintClassesSelectedCount();
}

function filterPrintClassesSearch(query) {
  const q = (query || '').trim().toLowerCase();
  const chips = document.querySelectorAll('.class-chip');
  chips.forEach(chip => {
    const name = (chip.getAttribute('data-name') || '').toLowerCase();
    const match = !q || name.includes(q);
    chip.style.display = match ? 'flex' : 'none';
  });
}

function submitPrintClasses() {
  const dateVal = document.getElementById('printClassesDate')?.value || '';
  const colorVal = document.getElementById('printClassesColor')?.value || 'color';
  const contentVal = document.getElementById('printClassesContent')?.value || 'materia_docente';
  const showRooms = document.getElementById('printClassesShowRooms')?.checked ? '1' : '0';
  const includeSubgroups = document.getElementById('printClassesIncludeSubgroups')?.checked ? '1' : '0';

  const total = document.querySelectorAll('.print-class-cb').length;
  const checkedBoxes = Array.from(document.querySelectorAll('.print-class-cb:checked'));

  if (checkedBoxes.length === 0) {
    showToast('Seleziona almeno una classe da stampare', 'warn');
    return;
  }

  let classesParam = 'all';
  if (checkedBoxes.length < total) {
    classesParam = checkedBoxes.map(cb => cb.value).join(',');
  }

  const appLang = document.getElementById('printClassesLang')?.value || (window.I18N ? window.I18N.getLanguage() : null) || localStorage.getItem('app_lang') || 'it';
  try {
    document.cookie = "app_lang=" + appLang + "; path=/; max-age=31536000; SameSite=Lax";
    localStorage.setItem('app_lang', appLang);
  } catch (_) {}
  const params = new URLSearchParams({
    validity_date: dateVal,
    color_mode: colorVal,
    content_mode: contentVal,
    show_rooms: showRooms,
    include_subgroups: includeSubgroups,
    classes: classesParam,
    lang: appLang
  });

  const url = '/api/print/classes?' + params.toString();
  const win = window.open(url, '_blank');
  if (!win || win.closed || typeof win.closed === 'undefined') {
    window.location.href = url;
  }
  closePrintClassesModal();
}

async function openPrintTeachersModal() {
  const modal = document.getElementById('printTeachersModal');
  if (!modal) return;
  modal.style.display = 'flex';

  const curLang = (window.I18N ? window.I18N.getLanguage() : null) || localStorage.getItem('app_lang') || 'it';
  const langSelect = document.getElementById('printTeachersLang');
  if (langSelect) {
    langSelect.value = curLang;
    langSelect.onchange = () => {
      try {
        localStorage.setItem('app_lang', langSelect.value);
        document.cookie = "app_lang=" + langSelect.value + "; path=/; max-age=31536000; SameSite=Lax";
      } catch (_) {}
    };
  }

  const dateInput = document.getElementById('printTeachersDate');
  if (dateInput && !dateInput.value) {
    const today = new Date();
    const daysAhead = ((7 - today.getDay()) % 7) || 7;
    const nextMon = new Date(today.getTime() + daysAhead * 86400000);
    const dd = String(nextMon.getDate()).padStart(2, '0');
    const mm = String(nextMon.getMonth() + 1).padStart(2, '0');
    const yyyy = nextMon.getFullYear();
    dateInput.value = `${dd}/${mm}/${yyyy}`;
  }

  const meta = await loadPrintOptionsMetadata();
  if (meta && meta.default_validity_date && dateInput) {
    dateInput.value = meta.default_validity_date;
  }
}

function closePrintTeachersModal() {
  const modal = document.getElementById('printTeachersModal');
  if (modal) modal.style.display = 'none';
}

function submitPrintTeachers() {
  const dateVal = document.getElementById('printTeachersDate')?.value || '';
  const paperSize = document.getElementById('printTeachersPaperSize')?.value || 'A3';
  const showRooms = document.getElementById('printTeachersShowRooms')?.checked ? '1' : '0';
  const highlightDisp = document.getElementById('printTeachersHighlightDisp')?.checked ? '1' : '0';

  const appLang = document.getElementById('printTeachersLang')?.value || (window.I18N ? window.I18N.getLanguage() : null) || localStorage.getItem('app_lang') || 'it';
  try {
    document.cookie = "app_lang=" + appLang + "; path=/; max-age=31536000; SameSite=Lax";
    localStorage.setItem('app_lang', appLang);
  } catch (_) {}
  const params = new URLSearchParams({
    validity_date: dateVal,
    paper_size: paperSize,
    show_rooms: showRooms,
    highlight_disp: highlightDisp,
    lang: appLang
  });

  const url = '/api/print/teachers?' + params.toString();
  const win = window.open(url, '_blank');
  if (!win || win.closed || typeof win.closed === 'undefined') {
    window.location.href = url;
  }
  closePrintTeachersModal();
}

function submitDownloadTeachersDocx() {
  const dateVal = document.getElementById('printTeachersDate')?.value || '';
  const paperSize = document.getElementById('printTeachersPaperSize')?.value || 'A3';
  const showRooms = document.getElementById('printTeachersShowRooms')?.checked ? '1' : '0';
  const highlightDisp = document.getElementById('printTeachersHighlightDisp')?.checked ? '1' : '0';

  const appLang = document.getElementById('printTeachersLang')?.value || (window.I18N ? window.I18N.getLanguage() : null) || localStorage.getItem('app_lang') || 'it';
  try {
    document.cookie = "app_lang=" + appLang + "; path=/; max-age=31536000; SameSite=Lax";
    localStorage.setItem('app_lang', appLang);
  } catch (_) {}
  const params = new URLSearchParams({
    validity_date: dateVal,
    paper_size: paperSize,
    show_rooms: showRooms,
    highlight_disp: highlightDisp,
    lang: appLang
  });

  const url = '/api/print/teachers/docx?' + params.toString();
  window.location.href = url;
  closePrintTeachersModal();
}

