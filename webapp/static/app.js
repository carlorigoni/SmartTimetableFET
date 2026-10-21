/**
 * SmartTimetable - Single Page Application Controller (Vanilla JS)
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

// --- AUTENTICAZIONE & CONTROLLO ACCESSI (GOOGLE OAUTH & WHITELIST APPROVAL) ---
let currentUser = null;
let authPollInterval = null;
let googleClientId = '';

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
});

async function initAuth() {
  if (localStorage.getItem('sidebar_collapsed') === '1') {
    document.getElementById('appSidebar')?.classList.add('collapsed');
  }
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

    // Se admin, mostra voce gestione accessi nel menu laterale
    const sideItem = document.getElementById('sidebarAccessMgmtItem');
    if (user.role === 'admin') {
      if (sideItem) sideItem.style.display = 'flex';
      updatePendingBadge(data.pending_count || 0);

      // Polling periodico per nuove richieste ogni 30s per l'admin
      if (!authPollInterval) {
        authPollInterval = setInterval(refreshAdminPendingCount, 30000);
      }
    } else {
      if (sideItem) sideItem.style.display = 'none';
    }

    // Carica l'applicazione
    loadInitialData();

  } else if (status === 'pending') {
    showPendingScreen(user);
    if (!authPollInterval) {
      authPollInterval = setInterval(checkAuthMe, 6000);
    }
  } else if (status === 'rejected') {
    showRejectedScreen(user);
  }
}

function updatePendingBadge(count) {
  const badge = document.getElementById('sidebarPendingBadge') || document.getElementById('topbarPendingBadge');
  if (!badge) return;
  if (count > 0) {
    badge.innerText = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

async function refreshAdminPendingCount() {
  if (!currentUser || currentUser.role !== 'admin') return;
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
        showToast('Accesso sbloccato! Benvenuto in SmartTimetable.', 'ok');
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

  const notice = document.getElementById('googleConfigNotice');
  const details = document.getElementById('emergencyDetails');

  if (clientId) {
    if (notice) notice.style.display = 'none';
    initGoogleButton(clientId);
  } else {
    if (notice) notice.style.display = 'block';
    if (details) details.open = true;
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
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredentialResponse,
      auto_select: false
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
  switchAccessTab('pending');
  await loadUsersList();
}

function closeAccessManagementModal() {
  const modal = document.getElementById('accessModal');
  if (modal) modal.style.display = 'none';
}

function switchAccessTab(tab) {
  document.getElementById('tabBtnPending')?.classList.toggle('active', tab === 'pending');
  document.getElementById('tabBtnApproved')?.classList.toggle('active', tab === 'approved');
  document.getElementById('tabBtnConfig')?.classList.toggle('active', tab === 'config');

  document.getElementById('tabPendingUsers').style.display = (tab === 'pending') ? 'block' : 'none';
  document.getElementById('tabApprovedUsers').style.display = (tab === 'approved') ? 'block' : 'none';
  document.getElementById('tabConfig').style.display = (tab === 'config') ? 'block' : 'none';

  if (tab === 'config') {
    populateConfigFields();
  }
}

async function loadUsersList() {
  try {
    const res = await fetch('/api/auth/users');
    if (!res.ok) {
      showToast('Errore caricamento utenti', 'error');
      return;
    }
    currentUsersData = await res.json();
    renderUsersUI();
  } catch (e) {
    showToast('Errore di connessione: ' + e.message, 'error');
  }
}

function renderUsersUI() {
  const users = currentUsersData.users || [];
  const pending = users.filter(u => u.status === 'pending');
  const approved = users.filter(u => u.status === 'approved');

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
        <b>Nessuna richiesta di accesso in attesa.</b>
        <p style="font-size:12px;margin-top:4px;">Tutti i docenti che hanno effettuato il login sono già stati autorizzati.</p>
      </div>`;
  } else {
    pendingContainer.innerHTML = pending.map(u => {
      const emailSafe = btoa(unescape(encodeURIComponent(u.email))).replace(/=/g, '');
      return `
      <div class="user-item-card" id="user-card-${emailSafe}">
        <div class="user-card-left">
          ${u.picture ? `<img src="${u.picture}" class="user-card-avatar" alt="Avatar" />` : `<div class="user-card-avatar">👤</div>`}
          <div class="user-card-info">
            <div class="user-card-name">${escapeHtml(u.name || u.email)}</div>
            <div class="user-card-email">${escapeHtml(u.email)}</div>
            <div class="user-card-meta">Richiesto il: ${u.created_at ? new Date(u.created_at).toLocaleString('it-IT') : 'N/D'}</div>
          </div>
        </div>
        <div class="user-card-actions">
          <select id="role-select-${emailSafe}" class="form-input" style="padding:4px 8px;font-size:12px;width:auto;">
            <option value="editor" selected>Editor (Modifica orario)</option>
            <option value="viewer">Viewer (Sola lettura)</option>
            <option value="admin">Amministratore</option>
          </select>
          <button class="btn btn-sm btn-success" onclick="approveUser('${escapeHtml(u.email)}')">✅ Sblocca Accesso</button>
          <button class="btn btn-sm btn-danger" onclick="rejectUser('${escapeHtml(u.email)}')">❌ Rifiuta</button>
        </div>
      </div>
    `;
    }).join('');
  }

  // Tab 2: Approved Users
  const approvedContainer = document.getElementById('approvedUsersList');
  if (approved.length === 0) {
    approvedContainer.innerHTML = `<div style="text-align:center;padding:24px;color:#64748b;">Nessun utente approvato.</div>`;
  } else {
    approvedContainer.innerHTML = approved.map(u => {
      const isMainAdmin = (u.email === currentUsersData.admin_email);
      return `
      <div class="user-item-card">
        <div class="user-card-left">
          ${u.picture ? `<img src="${u.picture}" class="user-card-avatar" alt="Avatar" />` : `<div class="user-card-avatar">👤</div>`}
          <div class="user-card-info">
            <div class="user-card-name">
              ${escapeHtml(u.name || u.email)}
              <span class="badge ${u.role === 'admin' ? 'badge-primary' : (u.role === 'editor' ? 'badge-info' : 'badge-sec')}" style="font-size:10px;">
                ${u.role.toUpperCase()}
              </span>
            </div>
            <div class="user-card-email">${escapeHtml(u.email)}</div>
            <div class="user-card-meta">Ultimo accesso: ${u.last_login ? new Date(u.last_login).toLocaleString('it-IT') : 'N/D'}</div>
          </div>
        </div>
        <div class="user-card-actions">
          ${isMainAdmin ? `<span style="font-size:11.5px;color:#16a34a;font-weight:700;">Amministratore Principale</span>` : `
            <button class="btn btn-sm btn-outline-warning" onclick="revokeUser('${escapeHtml(u.email)}')">⛔ Revoca</button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${escapeHtml(u.email)}')">🗑️</button>
          `}
        </div>
      </div>`;
    }).join('');
  }
}

async function approveUser(email) {
  const emailSafe = btoa(unescape(encodeURIComponent(email))).replace(/=/g, '');
  const selectId = `role-select-${emailSafe}`;
  const role = document.getElementById(selectId)?.value || 'editor';
  try {
    const res = await fetch('/api/auth/users/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Errore durante l\'approvazione', 'error');
      return;
    }
    showToast(`Accesso sbloccato per ${email} (${role.toUpperCase()})!`, 'ok');
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

function initSidebarResponsive() {
  const sb = document.getElementById('appSidebar');
  if (!sb) return;
  const w = window.innerWidth;
  const saved = localStorage.getItem('sidebar_collapsed');

  // Gestione responsive a 3 stati:
  // Desktop (> 1200px): default espansa (a meno che l'utente non l'abbia contratta: saved === '1')
  // Tablet (768px - 1200px): default mini-sidebar a icone 68px (a meno che l'utente non l'abbia espansa: saved === '0')
  // Mobile (< 768px): drawer nascosto con backdrop
  if (w > 1200) {
    if (saved === '1') {
      sb.classList.add('collapsed');
    } else {
      sb.classList.remove('collapsed');
    }
  } else if (w >= 768) {
    if (saved === '0') {
      sb.classList.remove('collapsed');
    } else {
      sb.classList.add('collapsed');
    }
  } else {
    sb.classList.remove('mobile-open');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (backdrop) backdrop.classList.remove('active');
  }
}

function handleSidebarResize() {
  const sb = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (window.innerWidth >= 768) {
    if (sb) sb.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
  }
}

async function loadInitialData() {
  initSidebarResponsive();
  window.addEventListener('resize', handleSidebarResize);

  try {
    const res = await fetch('/api/summary');
    stateData.summary = await res.json();
    if (stateData.summary.institution) {
      document.getElementById('instBadge').innerText = stateData.summary.institution;
    }
    refreshDiagnosticsBadge();
  } catch (e) {
    console.error('Errore caricamento summary:', e);
  }
  navigate('dashboard');
}

function toggleSidebar(forceState) {
  const sb = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sb) return;

  if (window.innerWidth < 768) {
    // Modalità Mobile: Drawer Overlay con Backdrop
    const shouldOpen = (forceState !== undefined) ? forceState : !sb.classList.contains('mobile-open');
    if (shouldOpen) {
      sb.classList.add('mobile-open');
      if (backdrop) backdrop.classList.add('active');
    } else {
      sb.classList.remove('mobile-open');
      if (backdrop) backdrop.classList.remove('active');
    }
  } else {
    // Modalità Desktop / Tablet: Mini-sidebar icon-only (68px) vs Espansa (250px)
    const shouldCollapse = (forceState !== undefined) ? forceState : !sb.classList.contains('collapsed');
    if (shouldCollapse) {
      sb.classList.add('collapsed');
      localStorage.setItem('sidebar_collapsed', '1');
    } else {
      sb.classList.remove('collapsed');
      localStorage.setItem('sidebar_collapsed', '0');
    }
  }
}

function closeMobileSidebar() {
  const sb = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sb) sb.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('active');
}

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

function updateNavBackButton() {
  const btn = document.getElementById('navBackBtn');
  const txt = document.getElementById('navBackText');
  if (!btn) return;
  if (navigationHistory.length > 0) {
    const prev = navigationHistory[navigationHistory.length - 1];
    btn.style.display = 'inline-flex';
    if (txt) txt.innerText = `Indietro (${prev.label || 'Precedente'})`;
    btn.title = `Torna a ${prev.label || 'schermata precedente'}`;
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
  return `
    <div class="nav-return-bar">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm btn-sec" onclick="navigateBack()" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;">
          <span>◀</span> Torna a ${escapeHtml(prev.label || 'Precedente')}
        </button>
        ${contextDesc ? `<span style="font-size:13px;color:var(--text-sub);">${contextDesc}</span>` : ''}
      </div>
      <span style="font-size:11.5px;color:var(--text-muted);">
        Navigazione rapida contestuale &bull; Clicca per tornare al punto di partenza
      </span>
    </div>
  `;
}

function navigate(view, pushHistory = true, customLabel = null) {
  if (pushHistory && currentView && currentView !== view) {
    let lbl = customLabel || VIEW_SHORT_LABELS[currentView] || currentView;
    if (currentView === 'classes' && typeof activeClassSubView !== 'undefined' && activeClassSubView === 'groups') {
      lbl = 'Gruppi Articolati';
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

  if (window.innerWidth < 768) {
    closeMobileSidebar();
  }

  // Aggiorna classe active nella sidebar (sia menu principale che menu fisso in basso)
  document.querySelectorAll('.sidebar .nav-item').forEach(el => {
    el.classList.remove('active');
    if (el.getAttribute('onclick') && el.getAttribute('onclick').includes(view)) {
      el.classList.add('active');
    }
  });

  document.getElementById('pageTitle').innerText = VIEW_TITLES[view] || 'SmartTimetable';

  const container = document.getElementById('mainContent');
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Caricamento dati in corso...</div>';

  if (view === 'dashboard') renderDashboard();
  else if (view === 'timetable') renderTimetable();
  else if (view === 'solver') renderSolver();
  else if (view === 'diagnostics') renderDiagnostics();
  else if (view === 'teachers') renderTeachers();
  else if (view === 'classes') renderClasses();
  else if (view === 'subjects') renderSubjects();
  else if (view === 'rooms') renderRooms();
  else if (view === 'activities') renderActivities();
  else if (view === 'accorpamenti') renderAccorpamenti();
  else if (view === 'block_rules') renderBlockRulesView();
  else if (view === 'availability') renderAvailability();
  else if (view === 'constraints') renderConstraints();
  else if (view === 'parameters') renderParameters();
  else if (view === 'settings') renderParameters();
  else if (view === 'snapshots' || view === 'import_export') renderSnapshots();
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
  const res = await fetch('/api/summary');
  const s = await res.json();
  stateData.summary = s;

  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat-box clickable" onclick="navigate('teachers')" title="Clicca per gestire i docenti">
        <div class="stat-lbl">Docenti in Organico</div>
        <div class="stat-val">👨‍🏫 ${s.teachers_count}</div>
        <div class="stat-box-link"><span>${s.disp_teachers_count ? `${s.disp_teachers_count} con Disposizione D` : 'Gestione Docenti'}</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('classes')" title="Clicca per gestire classi e gruppi">
        <div class="stat-lbl">Classi Istituite</div>
        <div class="stat-val">🎓 ${s.classes_count}</div>
        <div class="stat-box-link"><span>Gestione Classi</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('rooms')" title="Clicca per gestire aule, laboratori e plessi">
        <div class="stat-lbl">Aule e Laboratori</div>
        <div class="stat-val">🏢 ${s.rooms_count}</div>
        <div class="stat-box-link"><span>Plessi & Aule</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('activities')" title="Clicca per gestire cattedre e attività">
        <div class="stat-lbl">Attività / Lezioni</div>
        <div class="stat-val">📋 ${s.activities_count}</div>
        <div class="stat-box-link"><span>Cattedre & Blocchi</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('constraints')" title="Clicca per configurare vincoli e ore buche">
        <div class="stat-lbl">Monte Ore Settimanale</div>
        <div class="stat-val">⏱️ ${s.total_weekly_hours} h</div>
        <div class="stat-box-link"><span>${s.total_disp_hours ? `+${s.total_disp_hours}h Disposizioni D (${s.total_target_hours || (s.total_weekly_hours + s.total_disp_hours)}h tot)` : 'Regole & Vincoli FET'}</span> <span>→</span></div>
      </div>
      <div class="stat-box clickable" onclick="navigate('timetable')" title="Clicca per visualizzare l'orario settimanale">
        <div class="stat-lbl">Stato Orario</div>
        <div class="stat-val" style="font-size: 19px; color: ${s.has_timetable ? 'var(--success)' : 'var(--warn)'};">
          ${s.has_timetable ? '✅ Risolto (100%)' : '⚠️ Non Risolto'}
        </div>
        <div class="stat-box-link"><span>Vedi Orario</span> <span>→</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Azioni Rapide</span>
        <span class="badge ${s.has_timetable ? 'badge-ok' : 'badge-warn'}">
          ${s.has_timetable ? 'Orario completo disponibile' : 'In attesa di risoluzione'}
        </span>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="navigate('solver')">⚡ Compilatore FET</button>
        <button class="btn btn-sec" onclick="navigate('timetable')">🗓️ Orario Risolto</button>
        <button class="btn btn-sec" onclick="navigate('diagnostics')">🔍 Diagnostica & Advisor</button>
        <button class="btn btn-sec" onclick="navigate('snapshots')">📦 Backup & Snapshot</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Parametri di Struttura dell'Istituto</div>
      <div style="display:grid;grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));gap:16px;">
        <div>
          <b>Nome Istituto:</b> ${escapeHtml(s.institution)}<br>
          <b>Plessi attivi:</b> ${s.buildings_count} (${escapeHtml((s.buildings || ['Centrale', 'Succursale']).join(', '))})
        </div>
        <div>
          <b>Giorni di Lezione:</b> ${(s.days || []).join(', ')} (${(s.days || []).length} giorni)<br>
          <b>Ore Giornaliere:</b> ${(s.hours || []).join(', ')} (${(s.hours || []).length} fasce)
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

  if (!stateData.summary.has_timetable) {
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;">
        <div style="font-size:36px;margin-bottom:10px;">📅</div>
        <h3>Nessun orario risolto ancora disponibile</h3>
        <p style="color:var(--text-muted);margin:8px 0 20px;">Compila l'orario con FET CLI per visualizzare le griglie complete di docenti, classi e aule.</p>
        <button class="btn btn-primary" onclick="navigate('solver')">⚡ Vai al Compilatore FET</button>
      </div>
    `;
    return;
  }

  // Pre-seleziona prima entità se non impostata
  const teachers = Object.keys(views.by_teacher || {}).sort();
  const classes = Object.keys(views.by_class || {}).sort(naturalClassCompare);
  const rooms = Object.keys(views.by_room || {}).sort();

  if (!activeEntity) {
    if (activeTimetableView === 'teacher' && teachers.length) activeEntity = teachers[0];
    else if (activeTimetableView === 'class' && classes.length) activeEntity = classes[0];
    else if (activeTimetableView === 'room' && rooms.length) activeEntity = rooms[0];
  }

  let listOptions = [];
  if (activeTimetableView === 'teacher') listOptions = teachers;
  else if (activeTimetableView === 'class') listOptions = classes;
  else if (activeTimetableView === 'room') listOptions = rooms;

  if (!listOptions.includes(activeEntity) && listOptions.length) {
    activeEntity = listOptions[0];
  }

  const curEntityIdx = listOptions.indexOf(activeEntity);
  const totalEntities = listOptions.length;

  // Statistiche docente se in vista docente
  let statsHtml = '';
  if (activeTimetableView === 'teacher' && views.teacher_stats && views.teacher_stats[activeEntity]) {
    const st = views.teacher_stats[activeEntity];
    statsHtml = `
      <div style="display:flex;gap:10px;align-items:center;">
        <span class="badge badge-info">Ore lezione: <b>${st.total_lessons}</b></span>
        <span class="badge ${st.total_gaps > 0 ? 'badge-warn' : 'badge-ok'}">Ore buche: <b>${st.total_gaps}</b></span>
        <span class="badge ${st.total_transfers > 0 ? 'badge-warn' : 'badge-ok'}">Cambi plesso: <b>${st.total_transfers}</b></span>
      </div>
    `;
  }

  let classLockButtons = '';
  if (activeTimetableView === 'class' && activeEntity) {
    classLockButtons = `
      <button class="btn btn-sec btn-sm" onclick="lockCurrentClass(true)" title="Blocca tutte le ore della classe ${escapeHtml(activeEntity)} per preservarle nel prossimo calcolo FET">🔒 Blocca Classe</button>
      <button class="btn btn-sec btn-sm" onclick="lockCurrentClass(false)" title="Sblocca tutte le ore della classe ${escapeHtml(activeEntity)}">🔓 Sblocca Classe</button>
    `;
  }

  let lockedBadgeHtml = '';
  if (views.locked_count > 0) {
    lockedBadgeHtml = `
      <span class="badge badge-info" title="Numero totale di lezioni bloccate (fissate) che verranno preservate nel calcolo FET" style="display:inline-flex;align-items:center;gap:4px;">
        🔒 <b>${views.locked_count}</b> ore fissate
        <a href="javascript:void(0)" onclick="unlockAllActivities()" title="Sblocca tutte le ore bloccate dell'istituto" style="color:inherit;margin-left:4px;text-decoration:none;font-weight:bold;">&times;</a>
      </span>
    `;
  }

  container.innerHTML = `
    <div class="toolbar">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div style="display:flex;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
          <button class="btn btn-sm ${activeTimetableView === 'teacher' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchTimetableMode('teacher')">👨‍🏫 Docenti</button>
          <button class="btn btn-sm ${activeTimetableView === 'class' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchTimetableMode('class')">🎓 Classi</button>
          <button class="btn btn-sm ${activeTimetableView === 'room' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchTimetableMode('room')">🏫 Aule & Palestre</button>
        </div>
        <select id="entitySelect" class="select-input" onchange="switchEntity(this.value)">
          ${listOptions.map(opt => `<option value="${escapeHtml(opt)}" ${opt === activeEntity ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}
        </select>

        <!-- Cursore e Stepper Rapido di Scorrimento Docenti (Mouse e Frecce ◀ ▶) -->
        <div class="timetable-stepper-wrap" title="Scorri velocemente tra i docenti: trascina il cursore o usa le frecce ◀ ▶ della tastiera">
          <button type="button" class="btn btn-sm btn-sec" style="padding:2px 7px;font-size:11px;font-weight:700;" onclick="stepEntity(-1)" ${curEntityIdx <= 0 ? 'disabled' : ''} title="Docente precedente (oppure premi Freccia Sinistra ◀)">◀</button>
          <input type="range" class="slider-quick-entity" min="0" max="${Math.max(0, totalEntities - 1)}" value="${curEntityIdx >= 0 ? curEntityIdx : 0}" oninput="onEntitySliderChange(this.value)" title="Trascina il cursore per scorrere rapidamente tutti i docenti">
          <button type="button" class="btn btn-sm btn-sec" style="padding:2px 7px;font-size:11px;font-weight:700;" onclick="stepEntity(1)" ${curEntityIdx >= totalEntities - 1 ? 'disabled' : ''} title="Docente successivo (oppure premi Freccia Destra ▶)">▶</button>
          <span style="font-size:11px;font-weight:700;color:var(--text-sub);min-width:44px;text-align:center;">${curEntityIdx >= 0 ? curEntityIdx + 1 : 1}/${totalEntities}</span>
          <span style="font-size:10.5px;color:#94a3b8;" title="Scorciatoia tastiera: premi le frecce ◀ ▶ per cambiare docente">⌨️ ◀ ▶</span>
        </div>

        ${classLockButtons}
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        ${statsHtml}
        ${lockedBadgeHtml}
        <button class="btn btn-sec btn-sm" onclick="recalcDisposizioni()" title="Colloca o ricalcola le ore a disposizione post-calcolo FET (copre buchi orari, preferisce 1ª ora)">📍 Ricalcola Disposizioni</button>
        <button class="btn btn-primary btn-sm" onclick="openPrintClassesModal()" title="Procedura 9: Stampa orario settimanale per classe in A4 Landscape con classi articolate">🖨️ Stampa Classi (PDF)</button>
        <button class="btn btn-sec btn-sm" onclick="openPrintTeachersModal()" title="Procedura 12: Genera tabellone generale docenti in A3 Landscape con bande verticali">📄 Tabellone Docenti (A3)</button>
      </div>
    </div>
        <button class="btn btn-sec btn-sm" onclick="openPrintTeachersModal()" title="Procedura 12: Genera tabellone generale docenti in A3 Landscape con bande verticali">📄 Tabellone Docenti (A3)</button>
      </div>
    </div>

    <div class="print-only print-title" style="display:none;margin-bottom:12px;">
      <h2 style="margin:0;font-size:18px;">${escapeHtml(stateData.summary.institution || 'Istituto Scolastico')}</h2>
      <div style="font-size:14px;color:#333;margin-top:4px;">
        Orario Settimanale Lezioni &mdash; <b>${activeTimetableView === 'teacher' ? 'Docente: ' : (activeTimetableView === 'class' ? 'Classe: ' : 'Aula: ')}${escapeHtml(activeEntity)}</b>
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
  if (!confirm("Sbloccare tutte le ore precedentemente fissate in tutto l'orario?")) return;
  try {
    const res = await fetch('/api/timetable/unlock_all', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Tutte le ore sono state sbloccate (${data.unlocked_count} ore).`, 'info');
      await renderTimetable();
    }
  } catch (e) {
    alert("Errore: " + e.message);
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

function renderTimetableGridHtml(views, mode, entity) {
  const days = stateData.summary.days || [];
  const hours = stateData.summary.hours || [];
  let matrix = {};

  if (mode === 'teacher') matrix = (views.by_teacher || {})[entity] || {};
  else if (mode === 'class') matrix = (views.by_class || {})[entity] || {};
  else if (mode === 'room') matrix = (views.by_room || {})[entity] || {};

  let headerHtml = `<div class="tt-header" style="background:#153d61;">Ora</div>` + days.map(d => `<div class="tt-header">${d}</div>`).join('');
  let gridCols = `60px repeat(${days.length}, 1fr)`;

  let rowsHtml = '';
  for (const h of hours) {
    const isBreakHour = h.toUpperCase().startsWith('INT');
    rowsHtml += `<div class="tt-hour-col ${isBreakHour ? 'is-break' : ''}">${h}</div>`;

    for (const d of days) {
      if (isBreakHour) {
        rowsHtml += `<div class="tt-cell is-break">INTERVALLO</div>`;
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
          const displaySubj = isDisp ? (customDesc ? `🟡 ${escapeHtml(customDesc)}` : '🟡 Disposizione') : escapeHtml(l.subject);
          const dispMeta = customDesc ? `A disposizione (${escapeHtml(customDesc)})` : 'A disposizione';

          cellInner += `
            <div class="lesson-card ${cardClass} ${isLocked ? 'is-locked' : ''}" 
                 id="tt_act_${l.activity_id}"
                 ${isDisp ? `
                   draggable="true" 
                   ondragstart="onDragStartDisposizione(event, '${l.activity_id}')"
                   ondragend="onDragEndDisposizione(event)"
                   title="Trascina quest'ora a disposizione in un altro slot vuoto, oppure clicca ✏️ per rinominarla (es. Lab, Biblioteca)"
                 ` : ''}>
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;">
                <div class="lesson-subj" style="${isDisp ? 'font-weight:700;color:#92400e;' : ''}">
                  ${displaySubj}
                </div>
                <div style="display:flex;align-items:center;gap:2px;">
                  ${isDisp ? `
                    <button type="button" class="btn-lock" style="font-size:9.5px;padding:1px 4px;color:#92400e;background:rgba(217,119,6,0.15);border:none;border-radius:3px;cursor:pointer;" onclick="openEditDispModal('${l.activity_id}', '${escapeJs(customDesc)}')" title="Personalizza descrizione da stampare (es. Lab, Sportello, Ricevimento)">✏️</button>
                  ` : `
                    <button type="button" class="btn-lock ${isLocked ? 'locked' : ''}" onclick="toggleActivityLock('${l.activity_id}')" title="${isLocked ? 'Ora bloccata: preservata nel prossimo calcolo FET. Clicca per sbloccare.' : 'Clicca per bloccare quest\'ora nel prossimo calcolo FET'}">${isLocked ? '🔒' : '🔓'}</button>
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
          const lbl = d === 'Sab' ? 'SABATO CHIUSO' : 'PAUSA';
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
    <div class="timetable-grid" style="grid-template-columns: ${gridCols};">
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
  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>Solver FET CLI Nativo (Apple Silicon 7.12.0)</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <span id="solverStatusBadge" class="badge badge-ok">● Solver Pronto</span>
          ${(stateData.summary?.locked_activities_count > 0) ? `<span class="badge badge-info" title="Ore fissate che non verranno spostate dal calcolo">🔒 <b>${stateData.summary.locked_activities_count}</b> ${stateData.summary.locked_activities_count === 1 ? 'ora fissata' : 'ore fissate'}</span>` : ''}
        </div>
      </div>
      <p style="color:var(--text-muted);margin-bottom:14px;">
        Compilazione dell'orario basata sull'euristica a scambio ricorsivo (Recursive Swapping) di FET.
      </p>

      ${(stateData.summary?.locked_activities_count > 0) ? `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:#1e40af;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:15px;">🔒</span>
          <span><b>Ore fissate attive:</b> ${stateData.summary.locked_activities_count} ${stateData.summary.locked_activities_count === 1 ? 'lezione è bloccata' : 'lezioni sono bloccate'}. All'avvio della compilazione, FET la manterrà rigorosamente nella posizione prefissata.</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sec btn-sm" style="font-size:11px;padding:2px 8px;" onclick="switchTimetableMode('class')">Visualizza in Orario</button>
          <button class="btn btn-sec btn-sm" style="font-size:11px;padding:2px 8px;" onclick="unlockAllActivities()">Sblocca tutte</button>
        </div>
      </div>
      ` : ''}

      <!-- Pre-flight Diagnostic Alert Bar (Fase 2) -->
      <div id="preflightSolverBanner" style="margin-bottom:14px;"></div>

      <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
        <label style="font-size:12px;color:var(--text-muted);">
          Tempo massimo (secondi):
          <input type="number" id="timelimitInput" value="3600" class="search-input" style="width:90px;margin-left:6px;">
        </label>
        <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;background:#f1f5f9;padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--border);">
          <input type="checkbox" id="verboseLogInput" checked style="accent-color:var(--primary);">
          <span><b>Messaggi Verbosi (Stile Desktop App FET)</b></span>
        </label>
        <button id="btnStartSolve" class="btn btn-primary" onclick="startSolver()">▶ Avvia Compilazione Orario</button>
        <button id="btnStopSolve" class="btn btn-danger" onclick="stopSolver()" disabled>⏹ Interrompi Calcolo</button>
      </div>

      <!-- Live Activity Card (attiva durante l'elaborazione) -->
      <div id="liveActivityCard" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">🔄</span>
            <div>
              <div style="font-size:11px;text-transform:uppercase;color:#166534;font-weight:700;">Attività in collocamento (Scambio Ricorsivo):</div>
              <div id="liveActivityDesc" style="font-size:13px;font-weight:600;color:#14532d;">-</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;" id="liveActivityBadges"></div>
        </div>
      </div>

      <div class="bar-bg"><div id="solverFill" class="fill"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-top:6px;">
        <span id="solverLabel">0 / 0 attività collocate (0%)</span>
        <span id="solverTimer">Tempo trascorso: 00:00</span>
      </div>
    </div>

    <!-- Bottleneck Alert Card (visibile se il calcolo si arresta su attività critica) -->
    <div id="bottleneckCard" style="display:none;background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius-md);padding:14px 16px;margin-bottom:16px;">
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <span style="font-size:20px;">⚠️</span>
        <div style="flex:1;">
          <h4 style="margin:0 0 4px;color:#92400e;font-size:14px;">Diagnostica Collo di Bottiglia FET (Stile Desktop App)</h4>
          <p id="bottleneckText" style="margin:0 0 8px;font-size:12.5px;color:#78350f;"></p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-primary" onclick="navigate('activities')" style="background:#b45309;border-color:#b45309;">📝 Vai ad Attività / Cattedre</button>
            <button class="btn btn-sm btn-sec" onclick="navigate('availability')">📅 Controlla Indisponibilità</button>
            <button class="btn btn-sm btn-sec" onclick="navigate('constraints')">⚡ Riduci Peso Vincoli</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Intelligent Advisor Live Card (Fase 2: visibile durante stallo o se FET non chiude) -->
    <div id="solverAdvisorCard" style="display:none;margin-bottom:16px;" class="advisor-box"></div>

    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <span>Log in tempo reale di FET CLI</span>
        <div style="display:flex;gap:8px;align-items:center;font-size:12px;flex-wrap:wrap;">
          <div style="display:flex;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
            <button id="btnLogModeDesktop" class="btn btn-sm ${currentSolverLogMode === 'formatted' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchLogMode('formatted')">🖥️ Stile Desktop</button>
            <button id="btnLogModeRaw" class="btn btn-sm ${currentSolverLogMode === 'raw' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchLogMode('raw')">⚙️ Raw CLI Debug</button>
          </div>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--text-muted);font-size:11.5px;">
            <input type="checkbox" id="autoScrollLog" ${solverAutoScroll ? 'checked' : ''} onchange="solverAutoScroll = this.checked"> Auto-scroll
          </label>
          <button class="btn btn-sm btn-sec" onclick="copySolverLog()" title="Copia log negli appunti">📋 Copia</button>
          <button class="btn btn-sm btn-sec" onclick="clearSolverConsole()" title="Svuota console">🧹 Pulisci</button>
        </div>
      </div>
      <div id="solverConsole" class="console" style="height:380px;">In attesa dell'avvio di fet-cl...</div>
    </div>
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
  const tl = parseInt(document.getElementById('timelimitInput').value || '3600');
  const verbose = document.getElementById('verboseLogInput') ? document.getElementById('verboseLogInput').checked : true;
  document.getElementById('btnStartSolve').disabled = true;
  document.getElementById('btnStopSolve').disabled = false;
  document.getElementById('solverStatusBadge').className = 'badge badge-warn';
  document.getElementById('solverStatusBadge').innerText = '● Compilazione in corso...';

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
      alert('Errore avvio: ' + (data.error || JSON.stringify(data)));
      document.getElementById('btnStartSolve').disabled = false;
      document.getElementById('btnStopSolve').disabled = true;
    }
  } catch (e) {
    alert('Errore chiamata solver: ' + e.message);
    document.getElementById('btnStartSolve').disabled = false;
    document.getElementById('btnStopSolve').disabled = true;
  }
}

async function stopSolver() {
  if (confirm("Vuoi interrompere il calcolo di FET CLI? L'orario e lo stadio massimo raggiunto verranno preservati.")) {
    document.getElementById('btnStopSolve').disabled = true;
    await fetch('/api/solve/stop', { method: 'POST' });
  }
}

async function pollSolverStatus() {
  if (currentView !== 'solver') return;
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
    const highestMsg = s.highest_placed && s.highest_placed > s.placed ? ` (Record: ${s.highest_placed})` : '';
    lbl.innerText = `${s.placed} / ${s.total} attività collocate (${pct}%)${highestMsg}`;

    if (s.running) {
      currentSolverRunning = true;
      fill.className = 'fill';
      if (btnStart) btnStart.disabled = true;
      if (btnStop) btnStop.disabled = false;
      if (badge) {
        badge.className = 'badge badge-warn';
        badge.innerText = '● Compilazione in corso...';
      }

      // Aggiorna banner live attività corrente
      if (s.current_activity && liveCard && liveDesc) {
        liveCard.style.display = 'block';
        const ca = s.current_activity;
        liveDesc.innerText = `Attività #${ca.id}: ${ca.subject} — ${ca.teachers}`;
        if (liveBadges) {
          liveBadges.innerHTML = `
            <span class="badge badge-info">${escapeHtml(ca.classes)}</span>
            <span class="badge badge-ok">Stadio ${ca.stage}/${s.total}</span>
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
      if (btnStop) btnStop.disabled = true;
      if (btnStart) btnStart.disabled = false;
      if (liveCard) liveCard.style.display = 'none';

      if (s.success) {
        fill.className = 'fill ok';
        if (badge) {
          badge.className = 'badge badge-ok';
          badge.innerText = '✅ Risolto al 100%';
        }
        if (bCard) bCard.style.display = 'none';
      } else if (s.stopped) {
        fill.className = 'fill warn';
        if (badge) {
          badge.className = 'badge badge-warn';
          badge.innerText = '⚠️ Interrotto';
        }
      } else {
        fill.className = 'fill err';
        if (badge) {
          badge.className = 'badge badge-err';
          badge.innerText = '❌ Nessuna soluzione (Timeout)';
        }
      }

      // Mostra collo di bottiglia se presente
      if (s.bottleneck && bCard && bText) {
        bCard.style.display = 'block';
        bText.innerHTML = `
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
      timer.innerText = `Tempo trascorso: ${m < 10 ? '0' + m : m}:${remSec < 10 ? '0' + remSec : remSec}`;
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
    document.body.appendChild(cont);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
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
            <b>Rilevati ${r.critical_count} Conflitti Matematici Bloccanti!</b>
            <div style="font-size:12px;margin-top:2px;">Sono presenti vincoli impossibili (cattedre sovraccariche, slot orari insufficienti o aule in sovrapposizione). FET fallirà la risoluzione.</div>
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="navigate('diagnostics')" style="white-space:nowrap;font-weight:700;">🔍 Risolvi nella Diagnostica</button>
      `;
    } else if (r.warning_count > 0) {
      banner.className = 'preflight-solver-banner warn';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;">⚠️</span>
          <div>
            <b>Pre-Validazione: ${r.warning_count} Potenziali Colli di Bottiglia (Salute: ${r.health_score}%)</b>
            <div style="font-size:12px;margin-top:2px;">Il progetto è risolvibile, ma alcuni docenti o spazi hanno margini ristretti che potrebbero allungare i tempi di compilazione.</div>
          </div>
        </div>
        <button class="btn btn-sm btn-sec" onclick="navigate('diagnostics')" style="white-space:nowrap;">Visualizza Dettagli</button>
      `;
    } else {
      banner.className = 'preflight-solver-banner ok';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:20px;">✅</span>
          <div>
            <b>Pre-Validazione Superata con Successo (Salute: ${r.health_score}%)</b>
            <div style="font-size:12px;margin-top:2px;">Nessun conflitto statico o matematico rilevato. Il progetto è pronto per la compilazione FET 7.12.0.</div>
          </div>
        </div>
        <button class="btn btn-sm btn-sec" onclick="navigate('diagnostics')" style="white-space:nowrap;">Report Completo</button>
      `;
    }
  } catch (e) {}
}

function renderAdvisorCardHtml(recommendations, isSolverView = false, advisorReport = null) {
  if (!recommendations || recommendations.length === 0) return '';

  const rep = advisorReport || {};
  const rootCause = rep.root_cause_summary;
  const isErr = rep.root_cause_type && (rep.root_cause_type.includes('CRITICAL') || rep.root_cause_type.includes('CLASH'));

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:24px;">💡</span>
        <div>
          <h4 style="margin:0;color:#065f46;font-size:15px;font-weight:800;">Advisor Intelligente — Diagnosi & Relaxation Engine</h4>
          <div style="font-size:12px;color:#047857;">Algoritmo euristico per l'eliminazione dei colli di bottiglia e deadlock FET:</div>
        </div>
      </div>
      ${isSolverView ? `<button class="btn btn-sm btn-sec" style="font-size:11.5px;" onclick="navigate('diagnostics')">🔍 Apri Diagnostica Completa</button>` : ''}
    </div>

    ${rootCause ? `
      <div class="advisor-root-cause-box ${isErr ? 'err' : 'warn'}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:18px;">🎯</span>
          <b style="font-size:13px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;">Causa Radice Identificata:</b>
        </div>
        <p style="margin:0;font-size:13px;line-height:1.45;color:#1e293b;">
          ${escapeHtml(rootCause)}
        </p>
      </div>
    ` : ''}

    ${recommendations.map(r => {
      const lvl = r.level || 1;
      const lvlClass = `badge-level-${lvl}`;
      const isCombo = Boolean(r.is_combo);

      return `
        <div class="advisor-rec-card" style="${isCombo ? 'border: 2px solid #10b981; background: #f0fdf4;' : ''}">
          <div class="advisor-rec-header">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="${lvlClass}">L${lvl}</span>
              <b style="font-size:14px;color:#0f172a;">${escapeHtml(r.title)}</b>
              <span class="badge badge-${r.badge_color || 'info'}">${escapeHtml(r.badge || r.impact)}</span>
            </div>
            ${r.level_label ? `<span style="font-size:11px;color:#64748b;font-weight:600;">${escapeHtml(r.level_label)}</span>` : ''}
          </div>
          <p class="advisor-rec-desc">${escapeHtml(r.description)}</p>
          <div class="advisor-rec-actions">
            ${isSolverView ? `
              <button class="btn btn-sm ${isCombo ? 'btn-primary' : 'btn-primary'}" 
                      style="font-size:12.5px;white-space:nowrap;font-weight:700;display:inline-flex;align-items:center;gap:6px;${isCombo ? 'background: linear-gradient(135deg, #059669 0%, #10b981 100%);box-shadow: 0 2px 6px rgba(16,185,129,0.3);' : ''}" 
                      onclick="applyAdvisorRelaxation('${r.action_type}', ${JSON.stringify(r.action_payload).replace(/"/g, '&quot;')}, true, this)">
                ⚡ ${escapeHtml(r.button_text || 'Applica')} e Riavvia Solutore
              </button>
            ` : `
              <button class="btn btn-sm btn-primary" 
                      style="font-size:12px;white-space:nowrap;font-weight:700;display:inline-flex;align-items:center;gap:6px;" 
                      onclick="applyAdvisorRelaxation('${r.action_type}', ${JSON.stringify(r.action_payload).replace(/"/g, '&quot;')}, false, this)">
                ⚡ ${escapeHtml(r.button_text || 'Applica Rilassamento')}
              </button>
              <button class="btn btn-sm btn-sec" 
                      style="font-size:12px;white-space:nowrap;font-weight:600;display:inline-flex;align-items:center;gap:6px;" 
                      onclick="applyAdvisorRelaxation('${r.action_type}', ${JSON.stringify(r.action_payload).replace(/"/g, '&quot;')}, true, this)">
                🚀 Applica & Avvia FET
              </button>
            `}
          </div>
        </div>
      `;
    }).join('')}
  `;
}

async function applyAdvisorRelaxation(actionType, payload, restartSolver = false, callerBtn = null) {
  const btn = callerBtn || (window.event && window.event.currentTarget) || null;
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Applicazione in corso...';
  }
  try {
    const res = await fetch('/api/advisor/apply_relax', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_type: actionType,
        payload: payload,
        restart_solver: restartSolver
      })
    });
    const data = await res.json();
    if (data.status === 'ok') {
      showToast(data.message || 'Vincolo aggiornato con successo!', 'ok');
      await refreshDiagnosticsBadge();
      if (restartSolver) {
        navigate('solver');
      } else {
        renderDiagnostics(currentDiagTab);
      }
    } else {
      alert('Errore: ' + (data.error || 'Operazione fallita'));
      if (btn) {
        btn.disabled = false;
        btn.innerText = 'Riprova';
      }
    }
  } catch (e) {
    alert('Errore chiamata: ' + e.message);
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Riprova';
    }
  }
}

async function renderDiagnostics(tab = 'all') {
  currentDiagTab = tab;
  const container = document.getElementById('mainContent');
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Esecuzione scansione algebrica e verifica vincoli in corso...</div>';

  try {
    const [valRes, advRes] = await Promise.all([
      fetch('/api/validator/report'),
      fetch('/api/advisor/analyze', { method: 'POST' })
    ]);
    currentDiagReport = await valRes.json();
    currentAdvReport = await advRes.json();

    refreshDiagnosticsBadge();
    renderDiagnosticsContent();
  } catch (e) {
    container.innerHTML = `<div class="card" style="padding:24px;color:var(--danger);">Errore durante il caricamento della diagnostica: ${escapeHtml(e.message)}</div>`;
  }
}

function setDiagnosticsTab(tab) {
  currentDiagTab = tab;
  renderDiagnosticsContent();
}

function renderDiagnosticsContent() {
  const container = document.getElementById('mainContent');
  if (!currentDiagReport) return;
  const rep = currentDiagReport;
  const adv = currentAdvReport || { recommendations: [] };

  const score = rep.health_score || 0;
  let scoreClass = 'ok';
  let scoreBadge = 'badge-ok';
  let scoreTitle = '✅ Progetto Pronto per la Risoluzione FET';
  if (rep.critical_count > 0) {
    scoreClass = 'err';
    scoreBadge = 'badge-err';
    scoreTitle = '⛔ Rilevati Conflitti Matematici Bloccanti';
  } else if (rep.warning_count > 0 || score < 85) {
    scoreClass = 'warn';
    scoreBadge = 'badge-warn';
    scoreTitle = '⚠️ Rilevati Potenziali Colli di Bottiglia';
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
    teachers: '👨‍🏫 Docenti & Cattedre',
    classes: '🎓 Classi & Monte Ore',
    rooms: '🏢 Spazi & Palestre',
    coteaching: '👥 Co-docenze',
    locks: '🔒 Ore Fissate',
    buildings: '🏫 Plessi & Sedi'
  };

  container.innerHTML = `
    <!-- Header con Health Gauge & Azioni -->
    <div class="diagnostics-header">
      <div class="health-gauge-box">
        <div class="health-gauge-score ${scoreClass}">${score}%</div>
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <h2 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">${scoreTitle}</h2>
            <span class="badge ${scoreBadge}">${rep.status}</span>
          </div>
          <p style="margin:0;font-size:13px;color:var(--text-muted);">
            Pre-flight check algebrico & piccionaia: ${rep.summary_metrics.total_institute_slots} slot settimanali, 
            ${rep.summary_metrics.total_teachers} docenti, ${rep.summary_metrics.total_classes} classi.
          </p>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-sec" onclick="renderDiagnostics(currentDiagTab)">🔄 Riesegui Scansione</button>
        <button class="btn btn-primary" onclick="navigate('solver')">⚡ Apri Compilatore FET</button>
      </div>
    </div>

    <!-- 4 Metric Stat Boxes -->
    <div class="stat-grid" style="margin-bottom:20px;">
      <div class="stat-box">
        <div class="stat-lbl">Indice di Fattibilità</div>
        <div class="stat-val" style="color: ${scoreClass === 'ok' ? '#10b981' : (scoreClass === 'warn' ? '#f59e0b' : '#ef4444')};">
          ${score} / 100
        </div>
        <div class="stat-box-link"><span>Stato: <b>${rep.status}</b></span></div>
      </div>
      <div class="stat-box">
        <div class="stat-lbl">Conflitti Bloccanti</div>
        <div class="stat-val" style="color: ${rep.critical_count > 0 ? '#ef4444' : '#10b981'};">
          ${rep.critical_count}
        </div>
        <div class="stat-box-link"><span>${rep.critical_count === 0 ? 'Nessun blocco matematico' : 'Impediscono la soluzione'}</span></div>
      </div>
      <div class="stat-box">
        <div class="stat-lbl">Colli di Bottiglia & Avvisi</div>
        <div class="stat-val" style="color: ${rep.warning_count > 0 ? '#f59e0b' : '#64748b'};">
          ${rep.warning_count}
        </div>
        <div class="stat-box-link"><span>Rischio swap o stalli</span></div>
      </div>
      <div class="stat-box">
        <div class="stat-lbl">Spazi & Laboratori</div>
        <div class="stat-val" style="font-size:18px;">
          ${(rep.summary_metrics.room_saturations || []).map(r => `${r.type === 'palestra' ? 'Palestre' : 'Lab'}: <b>${r.pct}%</b>`).join(' | ')}
        </div>
        <div class="stat-box-link"><span>Capienza settimanale</span></div>
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
        📋 Tutte le Diagnosi (${rep.total_issues})
      </button>
      <button class="diag-tab-btn ${currentDiagTab === 'critical' ? 'active' : ''}" onclick="setDiagnosticsTab('critical')">
        ⛔ Bloccanti (${rep.critical_count})
      </button>
      <button class="diag-tab-btn ${currentDiagTab === 'warning' ? 'active' : ''}" onclick="setDiagnosticsTab('warning')">
        ⚠️ Colli di Bottiglia (${rep.warning_count})
      </button>
      <button class="diag-tab-btn ${currentDiagTab === 'info' ? 'active' : ''}" onclick="setDiagnosticsTab('info')">
        💡 Suggerimenti & Cattedre (${rep.info_count})
      </button>
      <button class="diag-tab-btn ${currentDiagTab === 'rooms' ? 'active' : ''}" onclick="setDiagnosticsTab('rooms')">
        🏢 Saturazione Palestre & Lab (${(rep.summary_metrics.room_saturations || []).length})
      </button>
    </div>

    <!-- Contenuto Tab: Saturazione Palestre e Lab -->
    ${currentDiagTab === 'rooms' ? `
      <div class="card">
        <div class="card-title">Analisi di Saturazione Spazi Didattici (Capienza Oraria Settimanale)</div>
        <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px;">
          Valuta il carico di ore richieste su strutture a disponibilità limitata (Palestre, Laboratori di Informatica) 
          rispetto agli slot totali d'istituto (${rep.summary_metrics.total_institute_slots} ore settimanali).
        </p>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Struttura / Tipologia</th>
                <th>Ore Richieste</th>
                <th>Capienza Massima</th>
                <th style="min-width:200px;">Percentuale di Saturazione</th>
                <th>Stato di Rischio</th>
                <th>Azione</th>
              </tr>
            </thead>
            <tbody>
              ${(rep.summary_metrics.room_saturations || []).map(r => {
                const barColor = r.status === 'danger' ? '#ef4444' : (r.status === 'warn' ? '#f59e0b' : '#10b981');
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
                        ${r.status === 'danger' ? 'SOVRACCARICO (>100%)' : (r.status === 'warn' ? 'ELEVATA SATURAZIONE' : 'NORMALE')}
                      </span>
                    </td>
                    <td>
                      <button class="btn btn-sm btn-sec" onclick="navigate('rooms')">Gestisci Aule</button>
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
            <div style="font-size:15px;font-weight:700;color:#0f172a;">Nessun problema rilevato in questa categoria!</div>
            <div style="font-size:13px;margin-top:4px;">Il modello rispetta tutti i vincoli matematici e algebrici analizzati.</div>
          </div>
        ` : filteredIssues.map(iss => {
          const catLabel = categoryLabels[iss.category] || iss.category;
          const sevBadge = iss.severity === 'critical'
            ? '<span class="badge badge-err">⛔ BLOCCANTE</span>'
            : (iss.severity === 'warning' ? '<span class="badge badge-warn">⚠️ AVVISO</span>' : '<span class="badge badge-info">💡 SUGGERIMENTO</span>');

          return `
            <div class="diag-issue-card ${iss.severity}">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:8px;">
                  ${sevBadge}
                  <span class="badge badge-sec" style="font-size:11px;">${catLabel}</span>
                  <b style="font-size:14px;color:#0f172a;">${escapeHtml(iss.title)}</b>
                </div>
                ${iss.quick_action ? `
                  <button class="btn btn-sm btn-sec" onclick="navigate('${iss.quick_action.target}')" style="font-size:11.5px;">
                    ${iss.quick_action.target === 'availability' ? '📅 Vai a Disponibilità' : (iss.quick_action.target === 'teachers' ? '👨‍🏫 Gestione Docente' : (iss.quick_action.target === 'classes' ? '🎓 Gestione Classe' : (iss.quick_action.target === 'timetable' ? '🗓️ Vedi in Orario' : '⚡ Vai a Vincoli')))}
                  </button>
                ` : ''}
              </div>
              <div style="font-size:13px;color:#334155;line-height:1.45;margin-bottom:8px;">
                ${escapeHtml(iss.description)}
              </div>
              ${iss.entities && iss.entities.length > 0 ? `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
                  <span style="font-size:11px;color:var(--text-sub);font-weight:600;">Elementi coinvolti:</span>
                  ${iss.entities.map(e => `
                    <span class="badge badge-info" style="font-size:11px;cursor:pointer;" onclick="navigate('${e.type === 'teacher' ? 'availability' : (e.type === 'class' ? 'classes' : (e.type === 'room' ? 'rooms' : 'activities'))}')">
                      ${e.type === 'teacher' ? '👨‍🏫' : (e.type === 'class' ? '🎓' : (e.type === 'room' ? '🏢' : '📋'))} ${escapeHtml(e.name)}
                    </span>
                  `).join('')}
                </div>
              ` : ''}
              ${iss.recommendation ? `
                <div style="background:rgba(255,255,255,0.7);border-radius:var(--radius-sm);padding:6px 10px;font-size:12px;color:#0f172a;border:1px dashed #cbd5e1;display:flex;align-items:center;gap:6px;">
                  <span>💡</span>
                  <span><b>Consiglio di risoluzione:</b> ${escapeHtml(iss.recommendation)}</span>
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
  const teachers = await res.json();
  // Ordinamento alfabetico rigoroso
  teachers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  stateData.teachers = teachers;

  const totalTeachers = teachers.length;
  const dispTeachers = teachers.filter(t => (t.target_hours !== undefined ? t.target_hours : 18) > (t.total_hours || 0)).length;
  const totalDispHours = teachers.reduce((acc, t) => acc + Math.max(0, (t.target_hours !== undefined ? t.target_hours : 18) - (t.total_hours || 0)), 0);
  const interaTeachers = teachers.filter(t => t.contract_type === 'intera' || t.contract_type === 'standard' || (!t.contract_type && (t.target_hours || 18) >= 18)).length;
  const coeTeachers = teachers.filter(t => t.contract_type === 'coe' || (t.is_coe && t.contract_type !== 'part_time' && t.contract_type !== 'spezzone')).length;
  const spezzoneTeachers = teachers.filter(t => t.contract_type === 'spezzone').length;
  const ptTeachers = teachers.filter(t => t.contract_type === 'part_time').length;
  const fullTeachers = teachers.filter(t => (t.total_hours || 0) >= (t.target_hours !== undefined ? t.target_hours : 18)).length;

  const container = document.getElementById('mainContent');
  container.innerHTML = `
    ${getNavReturnBarHtml('Organico docenti e gestione cattedre.')}
    <!-- Barra Filtri e Azioni -->
    <div class="toolbar" style="margin-bottom:10px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1;">
        <input type="text" id="teacherSearch" class="search-input" placeholder="🔍 Cerca docente, nome breve, CDC, materia o classe..." oninput="applyTeacherFilters()" style="flex:1;min-width:240px;">
        <button class="btn btn-outline" onclick="openAggiornaOrganicoModal()" title="Aggiorna l'organico docenti confrontandolo con un file Word (.docx) o Google Doc" style="font-weight:700;border:1.5px solid var(--primary);color:var(--primary);background:var(--bg-main);white-space:nowrap;padding:7px 14px;">
          🔄 Aggiorna Organico (Docx / Google Doc)
        </button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="newTeacherName" class="search-input" placeholder="Nome docente (es. Rossi Mario)" style="width:175px;" oninput="onNewTeacherNameChange(this.value)">
        <input type="text" id="newTeacherShortName" class="search-input" placeholder="Nome Breve (ROSSI M.)" style="width:140px;font-family:var(--font-mono);font-weight:700;text-transform:uppercase;" title="Nome Breve per le stampe (COGNOME N.)">
        <input type="text" id="newTeacherCdc" class="search-input" placeholder="CDC" style="width:70px;">
        <select id="newTeacherContractType" class="table-select" style="width:130px;" title="Tipologia di cattedra/contratto: Intera, COE, Spezzone, Part-Time">
          <option value="intera">🏛️ Intera (18h)</option>
          <option value="coe">🏫 COE</option>
          <option value="spezzone">🧩 Spezzone</option>
          <option value="part_time">⏳ Part-Time</option>
        </select>
        <input type="number" id="newTeacherTarget" class="search-input" placeholder="Ore" value="18" style="width:55px;" title="Ore Cattedra Contrattuali">
        <button class="btn btn-primary" onclick="addTeacher()">+ Aggiungi Docente</button>
      </div>
    </div>

    <!-- Barra Filtri Rapidi Cattedre & Disposizioni D -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap;">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'all' ? 'active' : ''}" id="btnTeachAll" onclick="setTeacherFilter('all')">
          Tutti (${totalTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'intera' ? 'active' : ''}" id="btnTeachIntera" onclick="setTeacherFilter('intera')" title="Docenti con Cattedra Ordinaria Intera (18 ore)">
          🏛️ Intere (${interaTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'coe' ? 'active' : ''}" id="btnTeachCoe" onclick="setTeacherFilter('coe')" title="Docenti con Cattedra Orario Esterna (COE)">
          🏫 COE (${coeTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'spezzone' ? 'active' : ''}" id="btnTeachSpezzone" onclick="setTeacherFilter('spezzone')" title="Docenti su Spezzone Orario (cattedre ridotte/residue)">
          🧩 Spezzoni (${spezzoneTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'pt' ? 'active' : ''}" id="btnTeachPt" onclick="setTeacherFilter('pt')" title="Docenti con contratto Part-Time">
          ⏳ Part-Time (${ptTeachers})
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'disp' ? 'active' : ''}" id="btnTeachDisp" onclick="setTeacherFilter('disp')" title="Docenti con ore cattedra non coperte da lezioni: assegnate a Disposizione">
          📌 Con Disposizione D (${dispTeachers} docenti — ${totalDispHours}h D tot.)
        </button>
        <button class="btn btn-sm btn-sec teacher-filter-btn ${currentTeacherFilterMode === 'full' ? 'active' : ''}" id="btnTeachFull" onclick="setTeacherFilter('full')" title="Docenti con cattedra completamente coperta">
          ✓ Cattedre Piene (${fullTeachers})
        </button>
      </div>
      <div style="font-size:12px;color:var(--text-muted);">
        🏷️ <b>Nome Breve</b> (es. <code>ROSSI M.</code>): utilizzato nelle stampe compatte e orari classi
      </div>
    </div>

    <div class="table-container">
      <table class="data-table" id="teacherTable">
        <thead>
          <tr>
            <th style="width:35px;">#</th>
            <th style="min-width:180px;">Docente (Nome Completo)</th>
            <th style="width:150px;">Nome Breve (Stampa)</th>
            <th style="width:85px;text-align:center;">CDC</th>
            <th style="width:165px;text-align:center;">Cattedra & Ore</th>
            <th style="width:105px;text-align:center;">Giorni Min-Max</th>
            <th style="min-width:160px;">Discipline Insegnate</th>
            <th style="min-width:140px;">Classi Assegnate</th>
            <th>Note</th>
            <th style="text-align:right;min-width:280px;">Azioni Rapide</th>
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
              contractBadge = '<span class="badge badge-spezzone" title="Spezzone Orario Residuo">🧩 Spezzone</span>';
            } else if (contractType === 'part_time') {
              contractBadge = '<span class="badge badge-pt" title="Contratto a Tempo Parziale (Part-Time)">⏳ Part-Time</span>';
            } else {
              contractBadge = '<span class="badge badge-intera" title="Cattedra Ordinaria Intera (18h)">🏛️ Intera</span>';
            }

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
                    ${lessonH}h ${dispH > 0 ? `<b style="color:#d97706;">+ ${dispH}h D</b>` : ''} / ${targetH}h
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
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${(t.classes || []).length > 0 ? (t.classes || []).map(c => `
                    <span class="item-chip" title="Classe assegnata">🎓 ${escapeHtml(c)}</span>
                  `).join('') : '<span style="color:var(--text-muted);font-size:12px;">-</span>'}
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

function updateDispPreview(totalH) {
  const targetVal = parseInt(document.getElementById('editTeacherTarget')?.value, 10) || 18;
  const resEl = document.getElementById('dispCalculationResult');
  if (!resEl) return;
  if (targetVal > totalH) {
    const d = targetVal - totalH;
    resEl.innerHTML = `<span class="badge-disp" style="font-size:12px;padding:3px 10px;">📌 D = ${d}h Disposizione (non coperte da lezioni)</span>`;
  } else if (targetVal === totalH) {
    resEl.innerHTML = `<span style="color:var(--color-ok);font-weight:700;font-size:12px;">✓ Cattedra Coperta al 100% (0h D)</span>`;
  } else {
    resEl.innerHTML = `<span style="color:var(--primary);font-weight:700;font-size:12px;">+${totalH - targetVal}h Esubero / Ore Eccedenti</span>`;
  }
}

function onContractTypeChange(ctype) {
  const hintEl = document.getElementById('contractTypeHint');
  if (!hintEl) return;
  if (ctype === 'coe') {
    hintEl.innerText = "🏫 Cattedra Orario Esterna (COE): il docente completa l'orario in un altro istituto scolastico (solitamente max 3-4 giorni nel nostro istituto).";
  } else if (ctype === 'spezzone') {
    hintEl.innerText = "🧩 Spezzone Orario: cattedra su frazione o spezzone residuo a ore (es. 4h, 6h, 8h, 9h).";
  } else if (ctype === 'part_time') {
    hintEl.innerText = "⏳ Part-Time: docente con contratto a orario parziale su propria richiesta (senza completamento in altra scuola).";
  } else {
    hintEl.innerText = "🏛️ Cattedra Ordinaria Intera (18 ore contrattuali).";
  }
}

function openEditTeacherModal(name) {
  const teacher = (stateData.teachers || []).find(t => t.name === name) || { name: name };
  const cdc = teacher.cdc || '';
  const targetH = teacher.target_hours !== undefined ? teacher.target_hours : 18;
  const minDays = teacher.min_days !== undefined ? teacher.min_days : 4;
  const maxDays = teacher.max_days !== undefined ? teacher.max_days : 5;
  const totalH = teacher.total_hours || 0;
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
        <div class="modal-title">👨‍🏫 Parametri Docente: ${escapeHtml(name)}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <label class="form-label" style="margin-bottom:0;">Nome Completo Docente</label>
              <span style="font-size:11px;color:var(--primary);font-weight:600;">✏️ Modificabile</span>
            </div>
            <input type="text" id="editTeacherFullName" class="form-input" value="${escapeHtml(name)}" placeholder="es. ROSSI MARIO" oninput="onTeacherFullNameChange(this.value)">
          </div>
          <div class="form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <label class="form-label" style="margin-bottom:0;">Nome Breve per Stampe</label>
              <button type="button" class="btn btn-sm btn-sec" style="font-size:10.5px;padding:1px 6px;" onclick="autoComputeShortName(document.getElementById('editTeacherFullName')?.value || '${escapeJs(name)}')">
                ⚡ Ricalcola Standard
              </button>
            </div>
            <input type="text" id="editTeacherShortName" class="form-input" value="${escapeHtml(shortName)}" placeholder="es. ROSSI M." style="font-family:var(--font-mono);font-weight:700;text-transform:uppercase;" oninput="this.dataset.manuallyEdited='1'">
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:-6px;margin-bottom:12px;">
          💡 Puoi modificare il <b>Nome Completo</b> (tutte le cattedre e disponibilità verranno collegate al nuovo nominativo) e il <b>Nome Breve</b> (standard: <code>COGNOME N.</code>).
        </div>

        <!-- Selezione Tipologia di Cattedra (Intera, COE, Spezzone, Part-Time) -->
        <div class="form-group" style="margin-top:6px;">
          <label class="form-label">Tipologia di Cattedra / Contratto</label>
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;">
            <label class="radio-pill ${contractType === 'intera' ? 'active' : ''}" style="border:1px solid var(--border);padding:8px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input type="radio" name="editTeacherContractType" value="intera" ${contractType === 'intera' ? 'checked' : ''} onchange="onContractTypeChange('intera')">
              <span>🏛️ <b>Intera (18h)</b></span>
            </label>
            <label class="radio-pill ${contractType === 'coe' ? 'active' : ''}" style="border:1px solid var(--border);padding:8px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input type="radio" name="editTeacherContractType" value="coe" ${contractType === 'coe' ? 'checked' : ''} onchange="onContractTypeChange('coe')">
              <span>🏫 <b>COE</b></span>
            </label>
            <label class="radio-pill ${contractType === 'spezzone' ? 'active' : ''}" style="border:1px solid var(--border);padding:8px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input type="radio" name="editTeacherContractType" value="spezzone" ${contractType === 'spezzone' ? 'checked' : ''} onchange="onContractTypeChange('spezzone')">
              <span>🧩 <b>Spezzone</b></span>
            </label>
            <label class="radio-pill ${contractType === 'part_time' ? 'active' : ''}" style="border:1px solid var(--border);padding:8px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;">
              <input type="radio" name="editTeacherContractType" value="part_time" ${contractType === 'part_time' ? 'checked' : ''} onchange="onContractTypeChange('part_time')">
              <span>⏳ <b>Part-Time</b></span>
            </label>
          </div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:5px;" id="contractTypeHint">
            ${contractType === 'coe' ? '🏫 Cattedra Orario Esterna (COE): il docente completa l\'orario in un altro istituto scolastico.' : (contractType === 'spezzone' ? '🧩 Spezzone Orario: cattedra su frazione o spezzone residuo a ore.' : (contractType === 'part_time' ? '⏳ Part-Time: docente con contratto a orario parziale su propria richiesta.' : '🏛️ Cattedra Ordinaria Intera (18 ore contrattuali).'))}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Classe di Concorso (CDC)</label>
            <input type="text" id="editTeacherCdc" class="form-input" value="${escapeHtml(cdc)}" placeholder="es. A027, A047, A012">
          </div>
          <div class="form-group">
            <label class="form-label">Ore Cattedra Contrattuali (Target)</label>
            <input type="number" id="editTeacherTarget" class="form-input" value="${targetH}" min="1" max="36" oninput="updateDispPreview(${totalH})">
          </div>
        </div>

        <!-- Box Calcolo e Evidenziazione Disposizione D -->
        <div id="dispPreviewBox" style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <span style="font-size:12px;color:#5b21b6;font-weight:600;">Ore Lezione Frontale Assegnate:</span>
            <b style="font-size:14px;color:#4c1d95;margin-left:4px;">${totalH} h</b>
          </div>
          <div id="dispCalculationResult">
            ${targetH > totalH ? `
              <span class="badge-disp" style="font-size:12px;padding:3px 10px;">
                📌 D = ${targetH - totalH}h Disposizione (non coperte da lezioni)
              </span>
            ` : (targetH === totalH ? `
              <span style="color:var(--color-ok);font-weight:700;font-size:12px;">
                ✓ Cattedra Coperta al 100% (0h D)
              </span>
            ` : `
              <span style="color:var(--primary);font-weight:700;font-size:12px;">
                +${totalH - targetH}h Esubero / Ore Eccedenti
              </span>
            `)}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Minimo Giorni Insegnamento</label>
            <input type="number" id="editTeacherMinDays" class="form-input" value="${minDays}" min="1" max="6">
          </div>
          <div class="form-group">
            <label class="form-label">Massimo Giorni Insegnamento</label>
            <input type="number" id="editTeacherMaxDays" class="form-input" value="${maxDays}" min="1" max="6">
          </div>
        </div>

        <!-- SEZIONE: Preferenze & Desiderata Orario Docente -->
        <div class="pref-section-box">
          <div class="pref-section-title">
            <span>🎨 Preferenze & Desiderata Orario</span>
            <span style="font-size:11px;font-weight:normal;color:var(--text-muted);">(Fasce, Pesi e Giorno Libero)</span>
          </div>

          <!-- 1. Fascia Oraria Preferita -->
          <div style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;margin-bottom:6px;">1. Fascia Oraria Giornaliera Preferita</label>
            <input type="hidden" id="editTeacherPrefShift" value="${escapeHtml(prefShift)}">
            <div class="pref-card-grid">
              <div class="pref-card ${prefShift === 'prime' ? 'selected' : ''}" onclick="selectTeacherPrefShift('prime', event)">
                <div class="pref-card-icon">🌅</div>
                <div class="pref-card-title">Prime Ore</div>
                <div class="pref-card-desc">1ª-4ª ora / uscita anticipata</div>
              </div>
              <div class="pref-card ${prefShift === 'ultime' ? 'selected' : ''}" onclick="selectTeacherPrefShift('ultime', event)">
                <div class="pref-card-icon">🌇</div>
                <div class="pref-card-title">Ultime Ore</div>
                <div class="pref-card-desc">3ª-6ª ora / ingr. posticipato</div>
              </div>
              <div class="pref-card ${prefShift === 'bilanciato' ? 'selected' : ''}" onclick="selectTeacherPrefShift('bilanciato', event)">
                <div class="pref-card-icon">⚖️</div>
                <div class="pref-card-title">Bilanciato</div>
                <div class="pref-card-desc">2ª-5ª ora / distribuzione equa</div>
              </div>
              <div class="pref-card ${prefShift === 'none' ? 'selected' : ''}" onclick="selectTeacherPrefShift('none', event)">
                <div class="pref-card-icon">🎲</div>
                <div class="pref-card-title">Flessibile</div>
                <div class="pref-card-desc">Nessuna preferenza (libero)</div>
              </div>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;background:#fff;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;">
              <span style="font-size:11.5px;color:var(--text-sub);font-weight:600;">Rigidità Preferenza Fascia:</span>
              <input type="hidden" id="editTeacherPrefWeight" value="${prefWeight}">
              <div class="pref-pills-row">
                <button type="button" class="pref-weight-btn ${prefWeight === 70 ? 'active' : ''}" onclick="selectTeacherPrefWeight(70, event)">💡 Soft (70%)</button>
                <button type="button" class="pref-weight-btn ${prefWeight === 85 ? 'active' : ''}" onclick="selectTeacherPrefWeight(85, event)">🎯 Alta Priorità (85%)</button>
                <button type="button" class="pref-weight-btn ${prefWeight === 100 ? 'active' : ''}" onclick="selectTeacherPrefWeight(100, event)">🔒 Tassativo (100%)</button>
              </div>
            </div>
          </div>

          <!-- 2. Giorno Libero Settimanale -->
          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <label class="form-label" style="font-size:12px;margin-bottom:0;">2. Giorno Libero Settimanale Desiderato</label>
              <span style="font-size:11px;color:var(--text-muted);">1° click: ⭐ 1ª scelta | 2° click: 👍 2ª scelta | 3° click: reset</span>
            </div>
            <input type="hidden" id="editTeacherFreeDay1" value="${escapeHtml(freeDay1)}">
            <input type="hidden" id="editTeacherFreeDay2" value="${escapeHtml(freeDay2)}">
            <div class="pref-pills-row" style="margin-bottom:8px;" id="freeDayPillContainer">
              ${['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'].map(d => {
                const isFirst = (freeDay1 === d);
                const isSecond = (freeDay2 === d);
                let label = d;
                let cls = '';
                if (isFirst) { cls = 'is-first'; label = `⭐ ${d} (1ª)`; }
                else if (isSecond) { cls = 'is-second'; label = `👍 ${d} (2ª)`; }
                return `<button type="button" class="pref-day-btn ${cls}" onclick="cycleFreeDay('${d}')">${label}</button>`;
              }).join('')}
            </div>

            <div style="background:#fff;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin:0;">
                <input type="checkbox" id="editTeacherFreeDayStrict" ${freeDayStrict ? 'checked' : ''} style="cursor:pointer;">
                <span>🔒 <b>Giorno Libero 100% Tassativo</b> (Indisponibilità contrattuale assoluta)</span>
              </label>
              <span style="font-size:11px;color:var(--text-muted);">Se disattivo, FET tratterà il giorno libero come desiderata flessibile</span>
            </div>
          </div>

          <!-- 3. Permanenza a Scuola & Carico Giornaliero -->
          <div>
            <label class="form-label" style="font-size:12px;margin-bottom:6px;">3. Limiti di Permanenza & Carico Giornaliero (Opzionali)</label>
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;">
              <div>
                <label style="font-size:11px;color:var(--text-sub);display:block;margin-bottom:3px;">⏱️ Max permanenza (h/die)</label>
                <input type="number" id="editTeacherMaxSpan" class="form-input" style="font-size:12px;padding:5px 8px;" value="${maxSpan}" placeholder="es. 5 (con buche)" min="1" max="8" title="Massimo numero di ore a scuola al giorno compresi gli stacchi/buche">
              </div>
              <div>
                <label style="font-size:11px;color:var(--text-sub);display:block;margin-bottom:3px;">📖 Max lezioni / giorno</label>
                <input type="number" id="editTeacherMaxDailyLessons" class="form-input" style="font-size:12px;padding:5px 8px;" value="${maxDailyLessons}" placeholder="es. 4" min="1" max="8" title="Massimo ore di lezione frontale in una giornata">
              </div>
              <div>
                <label style="font-size:11px;color:var(--text-sub);display:block;margin-bottom:3px;">☕ Max buche / giorno</label>
                <input type="number" id="editTeacherMaxGapsPerDay" class="form-input" style="font-size:12px;padding:5px 8px;" value="${maxGaps}" placeholder="es. 1" min="0" max="4" title="Massimo ore buche al giorno per questo docente">
              </div>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Note / Istruzioni Didattiche</label>
          <textarea id="editTeacherComments" class="form-input" rows="2" placeholder="Note per l'orario o vincoli specifici">${escapeHtml(comments)}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
        <button class="btn btn-primary" onclick="submitEditTeacher('${escapeJs(name)}')">💾 Salva Parametri</button>
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

  const res = await fetch('/api/teachers/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: origName,
      new_name: newName,
      short_name: shortName,
      cdc: cdc,
      target_hours: targetH,
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
  if (confirm(`Sei sicuro di voler eliminare il docente "${name}"?`)) {
    await fetch(`/api/teachers/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(`Docente "${name}" eliminato.`, 'warn');
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
            <div style="font-weight:700;font-size:13px;color:var(--text-main);">📥 Modello Word Ufficiale (.docx)</div>
            <div style="font-size:11.5px;color:var(--text-muted);">Scarica la struttura esatta a 4 colonne o esporta l'organico attuale della scuola in formato Word</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a href="/api/organico/template_docx" download="Modello_Organico_SmartTimetable.docx" class="btn btn-sm btn-outline" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;font-weight:700;border-color:var(--primary);color:var(--primary);">
              📥 Scarica Modello Esempio (.docx)
            </a>
            <a href="/api/organico/template_docx?current=1" download="Organico_Scuola_Attuale.docx" class="btn btn-sm btn-sec" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
              📄 Esporta Organico Attuale (.docx)
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
      <div class="modal-footer" style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:#f8fafc;">
        <button class="btn btn-sec" onclick="closeModal()">Chiudi</button>
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
                    <td style="text-align:center;"><span class="badge badge-info">${doc.target_hours || 18}h</span></td>
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
                      <td><b>👨‍🏫 ${escapeHtml(item.name)}</b></td>
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
  const [resClasses, resGroups, sectionsData] = await Promise.all([
    fetch('/api/classes').then(r => r.json()),
    fetch('/api/groups').then(r => r.json()),
    fetch('/api/sections/percorsi').then(r => r.json()).catch(() => ({ section_percorsi: {}, sections: [] }))
  ]);

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
  const container = document.getElementById('mainContent');

  const centraleClasses = resClasses.filter(c => !(c.building || '').toLowerCase().includes('succ'));
  const succursaleClasses = resClasses.filter(c => (c.building || '').toLowerCase().includes('succ'));

  container.innerHTML = `
    ${getNavReturnBarHtml('Gestione classi, sezioni e studenti per classe.')}
    <div class="info-banner-blue">
      🎓 <b>Architettura Didattica - Classi & Studenti:</b> Le <b>Classi</b> rappresentano i gruppi di studenti dell'anno scolastico (es. <b>2L</b> con <b>26 alunni</b>). Ogni classe ha un'<b>Aula Base</b> (es. <i>Aula 53 - Sede Centrale</i>) in cui risiede per le lezioni ordinarie. Per materie come <i>Scienze Motorie</i> o <i>Informatica</i>, la classe si sposta in <b>Palestra</b> o in <b>Laboratorio</b>; se questi si trovano in un altro plesso, il motore FET pianifica il <b>cambio di plesso</b> e i tempi di trasferimento.
    </div>

    <!-- SELETTORE INDIRIZZO PER SEZIONE (LICEO / TECNICO / PROFESSIONALE) -->
    <div class="card" style="margin-bottom:16px;padding:14px 18px;border-left:4px solid var(--primary);box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:8px;">
            🏷️ Indirizzo di Studio per Sezione (Liceo / Tecnico / Professionale)
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px;max-width:850px;line-height:1.4;">
            L'indirizzo di studio è determinato <b>esclusivamente in base alla sezione</b> (A, B, C, D, E, F, G, H, L) per tutte le classi da 1 a 5. Il sistema rileva automaticamente se la classe appartiene al <b>Biennio</b> (1-2) o al <b>Triennio</b> (3-5) e applica la suddivisione blocchi orari di default (le eventuali eccezioni vengono specificate a livello di singola cattedra).
          </div>
        </div>
        <button class="btn btn-sm btn-sec" onclick="navigate('block_rules')" title="Configura o visualizza la tabella completa delle regole di default">
          📐 Regole Blocchi & Sezioni
        </button>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">
        ${(sectionsData.sections || []).map(s => {
          const p = s.percorso || 'tecnico';
          return `
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:5px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
                <b style="font-size:13px;color:var(--text-main);">Sezione ${s.section}</b>
                <span style="font-size:11px;color:var(--text-muted);" title="${(s.classes || []).join(', ')}">${s.classes_count} classi</span>
              </div>
              <div class="percorso-btn-group">
                <button type="button" class="percorso-btn ${p === 'liceo' ? 'active liceo' : ''}" onclick="updateSectionPercorso('${s.section}', 'liceo')" title="Imposta Sezione ${s.section} come Liceo">
                  🎓 Liceo
                </button>
                <button type="button" class="percorso-btn ${p === 'tecnico' ? 'active tecnico' : ''}" onclick="updateSectionPercorso('${s.section}', 'tecnico')" title="Imposta Sezione ${s.section} come Tecnico">
                  ⚙️ Tecnico
                </button>
                <button type="button" class="percorso-btn ${p === 'professionale' ? 'active professionale' : ''}" onclick="updateSectionPercorso('${s.section}', 'professionale')" title="Imposta Sezione ${s.section} come Professionale">
                  🏥 Prof.
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
          🎓 Classi Ordinarie (${resClasses.length})
        </button>
        <button class="segmented-btn ${!isClassesView ? 'active' : ''}" onclick="switchClassSubView('groups')">
          👥 Gruppi & Articolazioni (${resGroups.length}) (Tab Gruppi Excel)
        </button>
      </div>

      ${isClassesView ? `
        <div class="segmented-control" style="background:var(--bg-card);border:1px solid var(--border);">
          <button class="segmented-btn class-bld-btn ${activeClassBuildingFilter === 'all' ? 'active' : ''}" data-bld="all" onclick="filterClassesByBuilding('all')">
            Tutte (${resClasses.length})
          </button>
          <button class="segmented-btn class-bld-btn ${activeClassBuildingFilter === 'centrale' ? 'active' : ''}" data-bld="centrale" onclick="filterClassesByBuilding('centrale')" title="Mostra solo le classi della Sede Centrale">
            🏛️ Sede Centrale (${centraleClasses.length})
          </button>
          <button class="segmented-btn class-bld-btn ${activeClassBuildingFilter === 'succursale' ? 'active' : ''}" data-bld="succursale" onclick="filterClassesByBuilding('succursale')" title="Mostra solo le classi della Sede Succursale">
            🏛️ Sede Succursale (${succursaleClasses.length})
          </button>
        </div>
      ` : ''}

      <input type="text" id="${isClassesView ? 'classSearchInput' : 'groupSearchInput'}" class="search-input" placeholder="${isClassesView ? '🔍 Cerca classe, aula o sede...' : '🔍 Cerca gruppo o classe...'}" oninput="${isClassesView ? 'applyClassFilters()' : 'filterTable(\'groupTable\', this.value)'}" style="min-width:180px;">

      ${isClassesView ? `
        <div style="display:flex;gap:8px;margin-left:auto;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="openImportStudentsModal()" title="Importa o sincronizza il numero di alunni per classe dal foglio Excel / Parametri Orario" style="font-weight:600;display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--primary);color:var(--primary);background:var(--bg-main);white-space:nowrap;padding:7px 12px;">
            <span>📥</span> Importa Alunni (Excel)
          </button>
          <input type="text" id="newClassName" class="search-input" placeholder="Nuova classe (es. 4A)" style="width:140px;">
          <input type="number" id="newClassStudents" class="search-input" placeholder="Alunni" value="25" style="width:75px;">
          <select id="newClassBuilding" class="search-input" style="width:125px;">
            <option value="Centrale">Sede Centrale</option>
            <option value="Succursale">Sede Succursale</option>
          </select>
          <button class="btn btn-primary" onclick="addClass()">+ Aggiungi Classe</button>
        </div>
      ` : `
        <div style="display:flex;gap:8px;margin-left:auto;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-outline" onclick="openImportStudentsModal()" title="Importa o sincronizza il numero di alunni per classe e gruppo dal foglio Excel / Parametri Orario" style="font-weight:600;display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--primary);color:var(--primary);background:var(--bg-main);white-space:nowrap;padding:7px 12px;">
            <span>📥</span> Importa Alunni (Excel)
          </button>
          <button class="btn btn-primary" onclick="openAddGroupModal()">+ Aggiungi Gruppo Articolato</button>
        </div>
      `}
    </div>

    ${isClassesView ? `
      <div class="table-container">
        <table class="data-table" id="classTable">
          <thead>
            <tr>
              <th style="width:45px;">#</th>
              <th style="width:140px;">Classe & Indirizzo</th>
              <th style="width:95px;text-align:center;">N. Alunni</th>
              <th style="min-width:180px;">Sede & Aula Base Residente</th>
              <th>Gruppi Articolati (Lingue, Religione/Alt, Sottogruppi)</th>
              <th style="width:85px;text-align:center;">Ore/Sett.</th>
              <th style="text-align:right;min-width:270px;">Azioni Rapide</th>
            </tr>
          </thead>
          <tbody>
            ${resClasses.map((c, idx) => {
              const m = c.name.match(/^(\d+)([A-Za-z]+)/);
              const secLetter = m ? m[2].toUpperCase()[0] : '';
              const percorso = (sectionsData.section_percorsi || {})[secLetter] || 'tecnico';
              const yearNum = m ? parseInt(m[1], 10) : 1;
              const period = yearNum <= 2 ? 'Biennio' : 'Triennio';
              const cGroups = groupsByClass[c.name] || [];
              const isSucc = (c.building || '').toLowerCase().includes('succ');
              return `
                <tr class="class-row" data-building="${isSucc ? 'succursale' : 'centrale'}">
                  <td style="color:var(--text-sub);">${idx + 1}</td>
                  <td>
                    <b style="font-size:14.5px;color:var(--primary);">🎓 ${escapeHtml(c.name)}</b>
                    <span class="badge ${percorso === 'liceo' ? 'badge-liceo' : (percorso === 'tecnico' ? 'badge-tecnico' : 'badge-professionale')}" style="font-size:10px;margin-left:4px;" title="Indirizzo determinato dalla Sezione ${secLetter} (${period})">
                      ${percorso.toUpperCase()} (${period})
                    </span>
                  </td>
                  <td style="text-align:center;">
                    <span style="font-size:13px;font-weight:700;color:var(--text-main);">${c.students || 0}</span>
                    <button class="btn-sm btn-sec" style="padding:1px 5px;font-size:10px;margin-left:3px;" onclick="quickEditClassStudents('${escapeJs(c.name)}', ${c.students || 25})" title="Modifica numero alunni">✏️</button>
                  </td>
                  <td>
                    <span class="badge ${isSucc ? 'badge-warn' : 'badge-info'}" style="margin-right:6px;">
                      🏛️ ${escapeHtml(c.building || 'Centrale')}
                    </span>
                    <span class="item-chip" title="Aula Ordinaria di questa classe">
                      🚪 ${escapeHtml(c.base_room || ('Aula ' + c.name))}
                    </span>
                  </td>
                  <td>
                    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;">
                      ${cGroups.length > 0 ? cGroups.map(g => `
                        <span class="group-badge">
                          👥 <b>${escapeHtml(g.name)}</b> ${g.students ? `(${g.students} al.)` : ''}
                          <span class="del-btn" onclick="deleteGroup('${escapeJs(g.name)}')" title="Elimina gruppo articolato">×</span>
                        </span>
                      `).join('') : '<span style="color:var(--text-muted);font-size:12px;margin-right:6px;">Nessun gruppo</span>'}
                      <button class="btn-add-group" onclick="openAddGroupModal('${escapeJs(c.name)}')" title="Crea un gruppo articolato per ${escapeJs(c.name)}">
                        + Gruppo
                      </button>
                    </div>
                  </td>
                  <td style="text-align:center;">
                    <span class="badge badge-info">${c.total_hours || 0} h</span>
                  </td>
                  <td style="text-align:right;white-space:nowrap;">
                    <button class="btn btn-sm btn-primary" onclick="openNewCattedraModal({ className: '${escapeJs(c.name)}' })" title="Assegna nuova cattedra a ${escapeJs(c.name)}">
                      ➕ Cattedra
                    </button>
                    <button class="btn btn-sm btn-sec" onclick="jumpToActivities({ className: '${escapeJs(c.name)}' })" title="Vedi cattedre della classe ${escapeJs(c.name)}">
                      📚 Cattedre
                    </button>
                    <button class="btn btn-sm btn-sec" onclick="openEditClassModal('${escapeJs(c.name)}')" title="Modifica alunni, aula base e sede">✏️ Sede</button>
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
              <th style="width:130px;">Classe Padre</th>
              <th style="min-width:180px;">Nome Gruppo / Articolazione</th>
              <th style="width:110px;text-align:center;">N. Alunni</th>
              <th style="width:110px;text-align:center;">Ore Assegnate</th>
              <th>Note & Tipologia</th>
              <th style="text-align:right;min-width:260px;">Azioni Rapide</th>
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
                  <button class="btn-sm btn-sec" style="padding:1px 5px;font-size:10px;margin-left:3px;" onclick="quickEditGroupStudents('${escapeJs(g.name)}', ${g.students || 0})" title="Modifica numero alunni nel gruppo">✏️</button>
                </td>
                <td style="text-align:center;">
                  <span class="badge ${g.total_hours > 0 ? 'badge-info' : ''}" style="font-weight:700;">${g.total_hours || 0} h</span>
                </td>
                <td style="color:var(--text-muted);font-size:12px;">
                  ${escapeHtml(g.comments || 'Gruppo articolato / sottogruppo')}
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-sec" onclick="openEditGroupModal('${escapeJs(g.name)}')" title="Modifica gruppo">✏️ Modifica</button>
                  <button class="btn btn-sm btn-primary" onclick="openNewCattedraModal({ className: '${escapeJs(g.name)}' })" title="Assegna nuova cattedra a questo gruppo">➕ Cattedra</button>
                  <button class="btn btn-sm btn-sec" onclick="jumpToActivities({ className: '${escapeJs(g.name)}' })" title="Vedi cattedre del gruppo">📚 Cattedre</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteGroup('${escapeJs(g.name)}')" title="Elimina gruppo">🗑️</button>
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
          <input type="text" class="form-input" value="${escapeHtml(cls.name)}" disabled style="background:#f3f4f6;">
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
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
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
  if (confirm(`Eliminare la classe "${name}" e tutti i suoi gruppi?`)) {
    await fetch(`/api/classes/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(`Classe "${name}" eliminata.`, 'warn');
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
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
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
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
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
  if (confirm(`Eliminare il gruppo articolato "${groupName}"?`)) {
    await fetch(`/api/groups/${encodeURIComponent(groupName)}`, { method: 'DELETE' });
    showToast(`Gruppo "${groupName}" eliminato.`, 'warn');
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
        <div class="card" style="margin-bottom:14px;background:#f8fafc;border:1px solid var(--border);">
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
        <div class="card" style="background:#fff;border:1px solid var(--border);margin-bottom:14px;">
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
        <button class="btn btn-sec" onclick="closeModal()">Chiudi</button>
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
// 6. GESTIONE MATERIE (CON CARICO POMERIDIANO, ORE PREFERITE E SALTO CATTEDRE)
// ============================================================================
async function renderSubjects() {
  const res = await fetch('/api/subjects');
  const rawSubjects = await res.json();
  const subjects = (rawSubjects || []).filter(s => !(s.name || '').toLowerCase().startsWith('disposiz'));
  stateData.subjects = subjects;

  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
      <input type="text" class="search-input" placeholder="🔍 Cerca materia, CDC, docente o classe..." oninput="filterTable('subjTable', this.value)" style="min-width:220px;">
      <div style="display:flex;gap:8px;margin-left:auto;">
        <input type="text" id="newSubjName" class="search-input" placeholder="Nome materia (es. Filosofia)" style="width:190px;">
        <input type="text" id="newSubjCdc" class="search-input" placeholder="CDC (es. A018)" style="width:140px;font-family:var(--font-mono);font-weight:600;" title="Classe di concorso abilitata">
        <button class="btn btn-primary" onclick="addSubject()">+ Aggiungi Materia</button>
      </div>
    </div>

    <div class="table-container">
      <table class="data-table" id="subjTable">
        <thead>
          <tr>
            <th style="width:40px;">#</th>
            <th style="min-width:180px;">Materia / Disciplina</th>
            <th style="width:145px;text-align:center;">Classe di Concorso (CDC)</th>
            <th style="width:145px;text-align:center;">Rientri Pomeridiani</th>
            <th style="width:145px;text-align:center;">Fascia Preferita</th>
            <th style="width:110px;text-align:center;">Ore Totali</th>
            <th style="min-width:180px;">Docenti che la Insegnano</th>
            <th style="min-width:160px;">Classi Destinatarie</th>
            <th>Note</th>
            <th style="text-align:right;min-width:260px;">Azioni Rapide</th>
          </tr>
        </thead>
        <tbody>
          ${subjects.map((s, idx) => {
            const noRientri = !!s.no_rientri;
            const prefHours = s.pref_hours || 'INDIFFERENTE';

            return `
            <tr>
              <td style="color:var(--text-sub);">${idx + 1}</td>
              <td>
                <b style="font-size:13.5px;color:var(--text-main);cursor:pointer;" onclick="openEditSubjectModal('${escapeJs(s.name)}')" title="Clicca per modificare regole materia">📚 ${escapeHtml(s.name)}</b>
              </td>
              <td style="text-align:center;">
                ${s.cdc ? `
                  <span class="item-chip" style="font-family:var(--font-mono);font-size:11.5px;font-weight:700;color:var(--primary);cursor:pointer;" onclick="openEditSubjectModal('${escapeJs(s.name)}')" title="Classe di concorso associata (clicca per modificare)">
                    🏷️ ${escapeHtml(s.cdc)}
                  </span>
                ` : `
                  <span style="color:var(--text-muted);font-size:12px;cursor:pointer;" onclick="openEditSubjectModal('${escapeJs(s.name)}')">+ Assegna CDC</span>
                `}
              </td>
              <td style="text-align:center;">
                ${noRientri ? `
                  <span class="badge-no-rientri" title="Esclusa categoricamente dai pomeriggi (ore 7 e 8)">
                    🚫 No Rientri
                  </span>
                ` : `
                  <span class="badge badge-ok" style="font-size:10.5px;" title="Ammessa sia al mattino sia al pomeriggio">
                    ✅ Ammessa
                  </span>
                `}
              </td>
              <td style="text-align:center;">
                ${prefHours === 'PRIME' ? `
                  <span class="badge-pref-prime" title="FET favorisce la collocazione nelle prime 2-3 ore del mattino">
                    🌅 Prime Ore
                  </span>
                ` : prefHours === 'ULTIME' ? `
                  <span class="badge-pref-ultime" title="FET favorisce la collocazione nelle ultime ore di lezione">
                    🌇 Ultime Ore
                  </span>
                ` : `
                  <span style="font-size:11.5px;color:var(--text-muted);">⚖️ Indifferente</span>
                `}
              </td>
              <td style="text-align:center;">
                <span class="badge ${s.total_hours > 0 ? 'badge-info' : ''}" style="font-weight:700;font-size:12px;">
                  ${s.total_hours || 0} h
                </span>
                <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">
                  (${s.cattedre_count || 0} cattedre)
                </div>
              </td>
              <td>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${(s.teachers || []).length > 0 ? (s.teachers || []).map(t => `
                    <span class="item-chip" title="Docente assegnato">👨‍🏫 ${escapeHtml(t)}</span>
                  `).join('') : '<span style="color:var(--text-muted);font-size:12px;">Nessun docente</span>'}
                </div>
              </td>
              <td>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${(s.classes || []).length > 0 ? (s.classes || []).map(c => `
                    <span class="item-chip primary" title="Classe con questa materia">🎓 ${escapeHtml(c)}</span>
                  `).join('') : '<span style="color:var(--text-muted);font-size:12px;">-</span>'}
                </div>
              </td>
              <td style="color:var(--text-muted);font-size:12px;">${escapeHtml(s.comments || '-')}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn btn-sm btn-sec" onclick="openEditSubjectModal('${escapeJs(s.name)}')" title="Modifica regole: CDC, rientri pomeridiani, fascia oraria, note">
                  ✏️ Modifica
                </button>
                <button class="btn btn-sm btn-primary" onclick="openNewCattedraModal({ subject: '${escapeJs(s.name)}' })" title="Assegna un docente e una classe per ${escapeJs(s.name)}">
                  ➕ Cattedra
                </button>
                <button class="btn btn-sm btn-sec" onclick="jumpToActivities({ subject: '${escapeJs(s.name)}' })" title="Vedi tutte le cattedre di ${escapeJs(s.name)}">
                  📚 Cattedre
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteSubject('${escapeJs(s.name)}')">🗑️</button>
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openEditSubjectModal(subjectName) {
  const subj = (stateData.subjects || []).find(s => s.name === subjectName) || { name: subjectName };
  const noRientri = !!subj.no_rientri;
  const prefHours = subj.pref_hours || 'INDIFFERENTE';
  const cdc = subj.cdc || '';
  const comments = subj.comments || '';

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">📚 Disciplina & Regole: ${escapeHtml(subjectName)}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Nome Materia / Disciplina</label>
            <input type="text" class="form-input" value="${escapeHtml(subjectName)}" disabled style="background:#f1f5f9;">
          </div>
          <div class="form-group">
            <label class="form-label">Classe di Concorso (CDC)</label>
            <input type="text" id="editSubjCdc" class="form-input" value="${escapeHtml(cdc)}" placeholder="es. A018 - Filosofia e Scienze Umane" style="font-family:var(--font-mono);font-weight:600;">
          </div>
        </div>

        <div class="form-group" style="background:#f8fafc;padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border-light);">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
            <input type="checkbox" id="editSubjNoRientri" ${noRientri ? 'checked' : ''} style="width:18px;height:18px;margin-top:2px;">
            <div>
              <span style="font-weight:700;font-size:13px;color:#991b1b;">
                🚫 Escludi categoricamente dai Rientri Pomeridiani
              </span>
              <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;line-height:1.4;">
                Impedisce a FET di collocare questa materia nelle ore pomeridiane (7ª e 8ª ora). Consigliato per materie ad alto carico cognitivo come <b>Matematica</b>, <b>Latino</b>, <b>Greco</b> o prove scritte.
              </div>
            </div>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">Fascia Oraria Preferita (Constraint FET)</label>
          <select id="editSubjPrefHours" class="form-select">
            <option value="INDIFFERENTE" ${prefHours === 'INDIFFERENTE' ? 'selected' : ''}>⚖️ Indifferente (Nessuna preferenza di fascia)</option>
            <option value="PRIME" ${prefHours === 'PRIME' ? 'selected' : ''}>🌅 Prime Ore del Mattino (1ª, 2ª, 3ª ora)</option>
            <option value="ULTIME" ${prefHours === 'ULTIME' ? 'selected' : ''}>🌇 Ultime Ore della Giornata (Ore finali / Pomeriggio)</option>
          </select>
          <span class="form-hint">Ideale per favorire materie laboratoriali o motorie (es. Scienze Motorie / Arte) nelle ultime ore.</span>
        </div>

        <div class="form-group">
          <label class="form-label">Note / Raggruppamento</label>
          <input type="text" id="editSubjComments" class="form-input" value="${escapeHtml(comments)}" placeholder="Note didattiche o blocchi previsti">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
        <button class="btn btn-primary" onclick="submitEditSubject('${escapeJs(subjectName)}')">💾 Salva Parametri</button>
      </div>
    </div>
  `);
}

async function submitEditSubject(origName) {
  const cdc = document.getElementById('editSubjCdc')?.value.trim() || '';
  const noRientri = document.getElementById('editSubjNoRientri').checked;
  const prefHours = document.getElementById('editSubjPrefHours').value;
  const comments = document.getElementById('editSubjComments').value.trim();

  const res = await fetch('/api/subjects/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: origName,
      cdc: cdc,
      no_rientri: noRientri,
      pref_hours: prefHours,
      comments: comments
    })
  });

  if (res.ok) {
    closeModal();
    showToast(`Disciplina "${origName}" aggiornata con successo!`);
    renderSubjects();
  } else {
    alert('Errore durante l\'aggiornamento della materia.');
  }
}

async function addSubject() {
  const inp = document.getElementById('newSubjName');
  const cdcInp = document.getElementById('newSubjCdc');
  const name = inp ? inp.value.trim() : '';
  const cdc = cdcInp ? cdcInp.value.trim() : '';
  if (!name) return;
  const res = await fetch('/api/subjects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, cdc: cdc })
  });
  if (res.ok) {
    if (inp) inp.value = '';
    if (cdcInp) cdcInp.value = '';
    showToast(`Materia "${name}" creata!`);
    renderSubjects();
  } else {
    alert('Materia già presente.');
  }
}

async function deleteSubject(name) {
  if (confirm(`Eliminare la materia "${name}"?`)) {
    await fetch(`/api/subjects/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(`Materia "${name}" eliminata.`, 'warn');
    renderSubjects();
  }
}

// ============================================================================
// 7. GESTIONE AULE & PLESSI (DISPOSIZIONE, CAPIENZA, PALESTRA VS LABORATORI)
// ============================================================================
let activeRoomPlessoFilter = 'all'; // 'all' | 'Centrale' | 'Succursale' | 'special'

async function renderRooms() {
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
      🏫 <b>Distinzione Struttura Spazi vs Classi Studenti:</b><br>
      • <b>Nome Aula (Spazio Fisico):</b> Entità dell'edificio (es. <b>Aula 53</b>, <b>INFO 1</b>, <b>Palestra</b>) con <b>Capienza Massima</b> e <b>Plesso</b>.<br>
      • <b>Palestra Unica Sede Centrale:</b> L'istituto dispone di un'<b>unica Palestra in Sede Centrale</b> con capienza massima di <b>57 persone</b>. Il programma gestisce internamente la contemporaneità ospitando 2 o 3 classi per fascia oraria in base alla somma effettiva degli studenti per non superare mai la capienza complessiva. I laboratori <b>INFO 1</b> e <b>INFO 2</b> sono invece <b>spazi fisici separati</b> con 28 postazioni ciascuno.<br>
      • <b>Flag Laboratorio / Palestra:</b> Innescano automaticamente i <b>cambi di plesso</b> e i tempi di trasferimento per le classi residenti in un'altra sede.
    </div>

    <!-- Schede di Gestione Sedi / Plessi -->
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div style="font-weight:700;font-size:14px;color:var(--text-main);">
          🏛️ Configurazione Sedi & Plessi dell'Istituto (${stateData.buildingsList.length} Sedi Attive)
        </div>
        <button class="btn btn-sm btn-primary" onclick="openAddBuildingModal()">+ Aggiungi Nuovo Plesso / Sede</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:12px;">
        ${stateData.buildingsList.map(b => {
          const isSucc = b.name.toLowerCase().includes('succ');
          const rList = rooms.filter(r => r.building === b.name);
          const capTot = rList.reduce((acc, r) => acc + (r.capacity || 30), 0);

          return `
            <div style="background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:16px;">${isSucc ? '🏢' : '🏛️'}</span>
                  <b style="font-size:13.5px;color:var(--text-main);">${escapeHtml(b.name)}</b>
                  <span class="badge ${isSucc ? 'badge-warn' : 'badge-info'}" style="font-weight:700;">
                    Sigla: ${escapeHtml(b.short_code || b.name[0])}
                  </span>
                </div>
                <div style="display:flex;gap:4px;">
                  <button class="btn-sm btn-sec" onclick="openEditBuildingModal('${escapeJs(b.name)}', '${escapeJs(b.short_code || '')}', '${escapeJs(b.comments || '')}')" title="Modifica nome, sigla o note del plesso">✏️</button>
                  <button class="btn-sm btn-danger" onclick="deleteBuilding('${escapeJs(b.name)}')" title="Elimina plesso">🗑️</button>
                </div>
              </div>
              <div style="font-size:12px;color:var(--text-muted);line-height:1.4;">
                <div>Aule associate: <b>${rList.length}</b> (Capienza tot: <b>${capTot} posti</b>)</div>
                ${b.comments ? `<div style="font-style:italic;margin-top:2px;">${escapeHtml(b.comments)}</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Toolbar e Filtri Plesso -->
    <div class="toolbar" style="flex-wrap:wrap;">
      <input type="text" class="search-input" placeholder="🔍 Cerca aula, laboratorio, plesso..." oninput="filterTable('roomTable', this.value)">

      <div class="segmented-control">
        <button class="segmented-btn ${activeRoomPlessoFilter === 'all' ? 'active' : ''}" onclick="filterRoomsByPlesso('all')">
          Tutti (${rooms.length})
        </button>
        <button class="segmented-btn ${activeRoomPlessoFilter === 'Centrale' ? 'active' : ''}" onclick="filterRoomsByPlesso('Centrale')">
          🏛️ Centrale (${centraleRooms.length})
        </button>
        <button class="segmented-btn ${activeRoomPlessoFilter === 'Succursale' ? 'active' : ''}" onclick="filterRoomsByPlesso('Succursale')">
          🏢 Succursale (${succursaleRooms.length})
        </button>
        <button class="segmented-btn ${activeRoomPlessoFilter === 'special' ? 'active' : ''}" onclick="filterRoomsByPlesso('special')">
          🧪 Lab & Palestre (${rooms.filter(r => r.is_lab_or_gym).length})
        </button>
      </div>

      <div style="display:flex;gap:6px;margin-left:auto;">
        <input type="text" id="newRoomName" class="search-input" placeholder="Nome aula (es. Aula 53)" style="width:130px;">
        <select id="newRoomBuilding" class="search-input" style="width:120px;">
          ${stateData.buildings.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}
        </select>
        <select id="newRoomType" class="search-input" style="width:125px;">
          <option value="standard">🚪 Ordinaria</option>
          <option value="lab">🧪 Laboratorio</option>
          <option value="gym">🏀 Palestra</option>
        </select>
        <input type="number" id="newRoomCap" class="search-input" placeholder="Capienza" value="30" style="width:75px;" title="Capienza Massima Alunni">
        <button class="btn btn-primary" onclick="addRoom()">+ Aggiungi</button>
      </div>
    </div>

    <!-- Tabella Aule -->
    <div class="table-container">
      <table class="data-table" id="roomTable">
        <thead>
          <tr>
            <th style="width:40px;">#</th>
            <th style="min-width:170px;">Nome Aula / Spazio</th>
            <th style="width:150px;">Plesso (Disposizione)</th>
            <th style="min-width:180px;">Tipologia & Architettura Spazio</th>
            <th style="width:160px;text-align:center;">Flag Cambio Plesso</th>
            <th style="width:125px;text-align:center;">Capienza Max</th>
            <th style="min-width:180px;">Classe Base Residente</th>
            <th style="text-align:right;width:110px;">Azioni</th>
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
                  <select class="table-select" onchange="changeRoomBuilding('${escapeJs(r.name)}', this.value)" title="Cambia al volo la disposizione del plesso">
                    ${stateData.buildings.map(b => `
                      <option value="${escapeHtml(b)}" ${r.building === b ? 'selected' : ''}>
                        ${b === 'Centrale' ? '🏛️ Centrale' : (b === 'Succursale' ? '🏢 Succursale' : escapeHtml(b))}
                      </option>
                    `).join('')}
                  </select>
                </td>
                <td>
                  ${isGym ? `
                    <span class="badge-gym-module" style="background:#fef3c7;border-color:#f59e0b;color:#92400e;" title="Unico impianto sportivo dell'istituto in Sede Centrale (Capienza max 57 studenti, gestisce internamente 2 o 3 classi contemporanee)">
                      🏀 Palestra Unica (57 posti - 2 o 3 classi)
                    </span>
                  ` : isInfoLab ? `
                    <span class="badge-lab-module" title="Laboratorio Didattico Fisicamente Separato con 28 postazioni PC">
                      🧪 Lab Fisico Separato (28 posti)
                    </span>
                  ` : `
                    <select class="table-select" onchange="changeRoomType('${escapeJs(r.name)}', this.value)" title="Cambia la tipologia di stanza">
                      <option value="standard" ${(!r.is_lab_or_gym && r.room_type === 'standard') ? 'selected' : ''}>🚪 Aula Ordinaria</option>
                      <option value="lab" ${isLab ? 'selected' : ''}>🧪 Laboratorio</option>
                      <option value="gym" ${isGym ? 'selected' : ''}>🏀 Palestra</option>
                    </select>
                  `}
                </td>
                <td style="text-align:center;">
                  ${r.is_lab_or_gym ? `
                    <span class="badge-flag-transfer" title="Quando le classi usano questa stanza, si innescano i vincoli di cambio plesso">
                      ⚡ Innesca Cambio
                    </span>
                  ` : `
                    <span style="font-size:11.5px;color:var(--text-muted);">Interna</span>
                  `}
                </td>
                <td style="text-align:center;">
                  <div style="display:inline-flex;align-items:center;gap:3px;">
                    <input type="number" class="table-num-input" value="${r.capacity || 30}" min="1" max="150" onchange="changeRoomCapacity('${escapeJs(r.name)}', this.value)" title="Modifica e premi invio per salvare la capienza">
                    <span style="font-size:11.5px;color:var(--text-muted);">al.</span>
                  </div>
                </td>
                <td>
                  ${assignedClasses.length > 0 ? `
                    <div style="display:flex;align-items:center;gap:6px;">
                      <span class="item-chip primary" title="Classe residente qui">🎓 ${assignedClasses.join(', ')} (${assignedStud} al.)</span>
                      ${isOvercrowded ? `
                        <span class="badge badge-err" style="font-size:10px;" title="Attenzione: ${assignedStud} studenti per ${r.capacity} posti a sedere!">⚠️ Sovraffollamento</span>
                      ` : `
                        <span class="badge badge-ok" style="font-size:10px;">🟢 OK</span>
                      `}
                    </div>
                  ` : `
                    <span style="font-size:11.5px;color:var(--text-muted);font-style:italic;">Nessuna classe base</span>
                  `}
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-sec" onclick="openEditRoomModal('${escapeJs(r.name)}')" title="Modifica dettagli stanza">✏️</button>
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
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
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
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
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
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
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
  if (confirm(`Sei sicuro di voler eliminare il plesso "${name}"? Tutte le aule e classi associate dovranno essere riassegnate.`)) {
    const res = await fetch(`/api/buildings/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(`Plesso "${name}" eliminato.`, 'warn');
      renderRooms();
    } else {
      alert('Impossibile eliminare il plesso.');
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
  if (confirm(`Eliminare l'aula/spazio "${name}"?`)) {
    await fetch(`/api/rooms/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(`Aula "${name}" eliminata.`, 'warn');
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

  const isGrouped = activityViewMode === 'grouped';
  const totalGrouped = cleanGrouped.length;
  const exceptionsCount = cleanGrouped.filter(g => g.is_exception).length;

  let finalGrouped = cleanGrouped;
  if (activityExceptionFilter === 'exceptions') {
    finalGrouped = cleanGrouped.filter(g => g.is_exception);
  }

  let initialSearch = '';
  let activeFilterLabel = '';
  if (pendingActivityFilter) {
    if (pendingActivityFilter.teacher) {
      initialSearch = pendingActivityFilter.teacher;
      activeFilterLabel = `Docente: ${pendingActivityFilter.teacher}`;
    } else if (pendingActivityFilter.subject) {
      initialSearch = pendingActivityFilter.subject;
      activeFilterLabel = `Materia: ${pendingActivityFilter.subject}`;
    } else if (pendingActivityFilter.className) {
      initialSearch = pendingActivityFilter.className;
      activeFilterLabel = `Classe: ${pendingActivityFilter.className}`;
    }
    pendingActivityFilter = null;
  }

  container.innerHTML = `
    ${getNavReturnBarHtml(activeFilterLabel ? `Filtro visualizzazione: <b>${escapeHtml(activeFilterLabel)}</b>` : 'Cattedre e attività di insegnamento.')}
    <div class="toolbar" style="gap:12px;flex-wrap:wrap;">
      <input type="text" id="activitySearchInput" class="search-input" value="${escapeHtml(initialSearch)}" placeholder="🔍 Cerca docente, classe o materia..." oninput="filterActivities(this.value)">

      ${activeFilterLabel ? `
        <div id="activeFilterPill" style="display:flex;align-items:center;gap:6px;background:var(--primary-subtle);color:var(--primary);padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">
          <span>🔍 Filtro attivo: <b>${escapeHtml(activeFilterLabel)}</b></span>
          <span style="cursor:pointer;font-weight:700;margin-left:4px;" onclick="clearActivityFilter()" title="Azzera filtro">✕</span>
        </div>
      ` : ''}

      <button class="btn btn-primary" onclick="openNewCattedraModal()" title="Crea una nuova cattedra con docente, classe/gruppo e suddivisione blocchi">
        ➕ Nuova Cattedra / Attività
      </button>
      <button class="btn btn-sec" onclick="openAccorpamentiModal()" title="Gestisci accorpamenti di macro-materie (es. Italiano Latino Storia e Geografia)">
        🔗 Accorpamenti Macro-Materie
      </button>
      <button class="btn btn-sec" onclick="navigate('block_rules')" title="Gestisci regole di default suddivisione blocchi e indirizzi sezioni">
        📐 Regole Blocchi & Sezioni
      </button>
      <button class="btn btn-sec" onclick="resetAllCattedreToDefault()" title="Reimposta tutte le cattedre alla formula standard di default didattica (elimina le suddivisioni puntuali)">
        ↩️ Ripristina Default Didattici
      </button>

      <div class="segmented-control">
        <button class="segmented-btn ${isGrouped ? 'active' : ''}" onclick="switchActivityView('grouped')">
          👥 Vista Cattedre (${totalGrouped})
        </button>
        <button class="segmented-btn ${!isGrouped ? 'active' : ''}" onclick="switchActivityView('raw')">
          📋 Dettaglio FET (${resActs.length})
        </button>
      </div>

      ${isGrouped ? `
        <div class="segmented-control" style="background:var(--bg-card);border:1px solid var(--border);">
          <button class="segmented-btn ${activityExceptionFilter === 'all' ? 'active' : ''}" onclick="setActivityExceptionFilter('all')">
            Tutte (${totalGrouped})
          </button>
          <button class="segmented-btn ${activityExceptionFilter === 'exceptions' ? 'active' : ''}" onclick="setActivityExceptionFilter('exceptions')" title="Visualizza solo le cattedre con suddivisione blocchi diversa dallo standard di default">
            ⚡ Solo Eccezioni (${exceptionsCount})
          </button>
        </div>
      ` : ''}

      <div style="font-size:12px;color:var(--text-muted);margin-left:auto;">
        ${isGrouped 
          ? `Cattedre: <b>${finalGrouped.length}</b> (Ore tot: <b>${finalGrouped.reduce((acc, g) => acc + g.total_hours, 0)} h</b>)`
          : `Sotto-attività FET: <b>${resActs.length}</b>`}
      </div>
    </div>

    <div class="table-container">
      <table class="data-table" id="actTable">
        <thead>
          ${isGrouped ? `
            <tr>
              <th style="width:110px;">Classe / Gruppo</th>
              <th>Materia / Disciplina</th>
              <th>Docenti (Compresenze)</th>
              <th style="min-width:140px;">Spazio / Aula</th>
              <th style="width:85px;text-align:center;">Ore/Sett.</th>
              <th style="width:125px;text-align:center;">Suddivisione</th>
              <th>Sotto-attività FET</th>
              <th style="width:85px;text-align:center;">Stato</th>
              <th style="width:140px;text-align:right;">Azioni</th>
            </tr>
          ` : `
            <tr>
              <th style="width:75px;">ID</th>
              <th>Classe / Gruppo</th>
              <th>Materia</th>
              <th>Docenti (Compresenze)</th>
              <th style="min-width:130px;">Spazio / Aula</th>
              <th style="width:80px;text-align:center;">Ore</th>
              <th style="width:80px;text-align:center;">Stato</th>
              <th style="text-align:right;">Azioni</th>
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

            return `
              <tr class="${g.is_exception ? 'has-exception-row' : ''}">
                <td><span class="badge badge-info" style="font-size:12px;font-weight:700;">${escapeHtml(g.students_display)}</span></td>
                <td><b style="color:var(--text-main);cursor:pointer;" onclick="openEditCattedraModal('${escapeJs(g.id)}')" title="Clicca per modificare la cattedra">${escapeHtml(g.subject)}</b></td>
                <td>${escapeHtml(g.teachers_display)}</td>
                <td>
                  ${hasRoom ? `
                    <span class="badge ${roomBadgeClass}" title="Spazio assegnato">
                      ${roomIcon} ${escapeHtml(g.rooms_display)}
                    </span>
                  ` : `<span style="color:var(--text-muted);font-size:12px;" title="Utilizza l'aula base della classe">🏠 Aula Base</span>`}
                </td>
                <td style="text-align:center;"><b style="font-size:13px;color:var(--primary);">${g.total_hours} h</b></td>
                <td style="text-align:center;">
                  ${g.is_exception ? `
                    <span class="block-badge block-exception" title="ECCEZIONE: Differisce dalla formula standard di default (${escapeHtml(g.default_blocks || '')})">
                      ⚡ ${escapeHtml(g.blocks)} <span class="exc-tag">Exc</span>
                    </span>
                  ` : `
                    <span class="block-badge block-default" title="Suddivisione standard di default per ${escapeHtml(g.subject)} (${escapeHtml(g.percorso || '')} ${escapeHtml(g.period || '')})">
                      ${escapeHtml(g.blocks)}
                    </span>
                  `}
                  ${g.is_feasible === false ? `
                    <div style="margin-top:3px;">
                      <span class="badge badge-err" style="font-size:10.5px;cursor:pointer;" onclick="openEditBlocksModal('${g.sub_activity_ids.join(',')}', '${escapeJs(g.blocks)}', ${g.total_hours}, '${escapeJs(g.teachers_display)} - ${escapeJs(g.subject)} (${escapeJs(g.students_display)})', '${escapeJs(g.default_blocks || '')}', '${escapeJs(g.subject)}', '${escapeJs(g.students_display)}', '${escapeJs(g.percorso || '')}', '${escapeJs(g.period || '')}', false, '${escapeJs((g.feasibility_warnings || []).join('\n'))}', '${escapeJs(g.suggested_blocks || '')}')" title="${escapeHtml((g.feasibility_warnings || []).join('\n'))}">
                        ⚠️ Incompatibile (${escapeHtml(g.suggested_blocks || '')})
                      </span>
                    </div>
                  ` : ''}
                </td>
                <td>
                  <span class="sub-acts-tag">
                    ${(g.sub_activity_ids || []).map(id => `<a href="javascript:void(0)" onclick="jumpToSubActivity('${id}')" class="sub-act-pill" title="Salta al record FET #${id}">#${id}</a>`).join('')}
                  </span>
                </td>
                <td style="text-align:center;">
                  <span class="badge ${g.active ? 'badge-ok' : 'badge-err'}">${g.active ? 'Attiva' : 'Disattiva'}</span>
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-primary" onclick="openEditCattedraModal('${escapeJs(g.id)}')" title="Modifica tutti i dati della cattedra: docente, compresenze, classe, materia, ore, blocchi, aula">✏️ Modifica</button>
                  <button class="btn btn-sm ${g.is_feasible === false ? 'btn-danger' : 'btn-sec'}" onclick="openEditBlocksModal('${g.sub_activity_ids.join(',')}', '${escapeJs(g.blocks)}', ${g.total_hours}, '${escapeJs(g.teachers_display)} - ${escapeJs(g.subject)} (${escapeJs(g.students_display)})', '${escapeJs(g.default_blocks || '')}', '${escapeJs(g.subject)}', '${escapeJs(g.students_display)}', '${escapeJs(g.percorso || '')}', '${escapeJs(g.period || '')}', ${g.is_feasible === false ? 'false' : 'true'}, '${escapeJs((g.feasibility_warnings || []).join('\n'))}', '${escapeJs(g.suggested_blocks || '')}')" title="Rimodula la suddivisione blocchi (es. 2+1 o 1+1+1)">⏱️ Blocchi</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteCattedra('${g.sub_activity_ids.join(',')}', '${escapeJs(g.teachers_display)} - ${escapeJs(g.subject)} (${escapeJs(g.students_display)})')" title="Elimina l'intera cattedra">🗑️</button>
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
                  <span class="sub-act-tag-static" title="ID univoco record FET #${a.id}">#${a.id}</span>
                </td>
                <td><b>${escapeHtml((a.students || []).join('+'))}</b></td>
                <td><b style="color:var(--text-main);cursor:pointer;" onclick="openEditSingleActivityModal('${a.id}')" title="Clicca per modificare l'attività">${escapeHtml(a.subject || '')}</b></td>
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
                  <span class="badge ${a.active ? 'badge-ok' : 'badge-err'}">${a.active ? 'Attiva' : 'Disattiva'}</span>
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-primary" onclick="openEditSingleActivityModal('${a.id}')" title="Modifica questa singola attività FET">✏️ Modifica</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteActivity('${a.id}')" title="Elimina attività">🗑️</button>
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
  const res = await fetch('/api/accorpamenti/candidates');
  const data = await res.json();
  const rules = data.rules || [];
  const candidates = data.candidates || [];

  showModal(`
    <div class="modal-dialog" style="max-width:880px;">
      <div class="modal-header">
        <div class="modal-title">🔗 Gestione Accorpamenti Macro-Materie (es. Italiano Latino Storia e Geografia)</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="info-banner" style="margin-top:0;">
          💡 <b>Ottimizzazione Didattica e Solutore FET:</b><br>
          Quando lo stesso docente insegna più materie affini sulla stessa classe (ad es. <i>Italiano</i>, <i>Latino</i> e <i>Storia e Geografia</i>), l'accorpamento in una <b>macro-materia composita</b> (7 o 10 ore totali) permette di definire una suddivisione a blocchi equilibrata (es. <code>2+2+2+1</code> o <code>2+2+2+2+2</code>) impedendo a FET di spezzettare l'orario o concentrare troppe ore nello stesso giorno.<br>
          L'operazione è <b>reversibile al 100%</b>: disaccorpando, le attività atomiche originali vengono ripristinate integralmente.
        </div>

        <div style="margin-bottom:14px;">
          <b style="font-size:13px;color:var(--text-main);">📋 Regole di Macro-Materia Riconosciute nel Sistema:</b>
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
            🎯 Cattedre Accorpate & Candidati Individuati (${candidates.length} Cattedre nel Progetto):
          </b>
          <input type="text" class="search-input" placeholder="🔍 Cerca per docente o classe (es. 1C, Baston)..." oninput="filterAccorpamentiList(this.value)" style="width:280px;">
        </div>

        ${candidates.length === 0 ? `
          <div style="background:#f8fafc;border:1px dashed var(--border);border-radius:var(--radius-sm);padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">
            Nessuna cattedra candidata ad accorpamento trovata.
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
                    <span class="item-chip primary" style="font-weight:700;">🎓 Classe ${escapeHtml(c.class_name)}</span>
                    <span class="badge ${isMerged ? 'badge-ok' : 'badge-warn'}">
                      ${isMerged ? '🟢 Macro-Materia Attiva' : '⚡ Candidata da Accorpare'}
                    </span>
                  </div>
                  <div style="font-size:12.5px;color:var(--text-main);font-weight:600;">
                    📚 ${escapeHtml(c.rule_name)} — <span style="color:var(--primary);">${c.total_hours} ore settimanali</span>
                  </div>
                  <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;display:flex;align-items:center;gap:8px;">
                    <span>Suddivisione Blocchi FET:</span>
                    <span class="block-badge">${escapeHtml(blocksFormula)}</span>
                    ${c.components && c.components.length > 0 && c.components[0].hours > 0 ? `
                      <span>(Componenti: ${c.components.map(comp => `${escapeHtml(comp.subject)} ${comp.hours}h`).join(' + ')})</span>
                    ` : ''}
                  </div>
                </div>

                <div style="display:flex;gap:6px;align-items:center;">
                  ${isMerged ? `
                    <button class="btn btn-sm btn-sec" onclick="openEditBlocksModal('${subIds}', '${escapeJs(blocksFormula)}', ${c.total_hours}, '${escapeJs(c.teacher)} - ${escapeJs(c.rule_name)} (${escapeJs(c.class_name)})')" title="Modifica la formula di scomposizione blocchi orari per questa macro-materia">
                      ⏱️ Blocchi
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="revertAccorpamento('${escapeJs(c.teacher)}', '${escapeJs(c.class_name)}', '${escapeJs(c.rule_id)}')" title="Disaccorpa e ripristina le singole attività atomiche">
                      ↩️ Disaccorpa
                    </button>
                  ` : `
                    <button class="btn btn-sm btn-primary" onclick="applyAccorpamento('${escapeJs(c.teacher)}', '${escapeJs(c.class_name)}', '${escapeJs(c.rule_id)}')">
                      ⚡ Accorpa in Macro-Materia
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
        <button class="btn btn-sec" onclick="closeModal()">Chiudi</button>
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
  const container = document.getElementById('mainContent');
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Caricamento accorpamenti in corso...</div>';

  try {
    const res = await fetch('/api/accorpamenti/candidates');
    const data = await res.json();
    const rules = data.rules || [];
    let candidates = data.candidates || [];

    // Ordina per classe (ordinamento naturale anno poi sezione)
    candidates.sort((a, b) => naturalClassCompare(a.class_name, b.class_name));

    const activeCount = candidates.filter(c => c.is_merged).length;
    const pendingCount = candidates.filter(c => !c.is_merged).length;

    container.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 style="font-size:18px;font-weight:700;color:var(--text-main);margin:0 0 6px 0;display:flex;align-items:center;gap:8px;">
              🔗 Gestione Accorpamenti Macro-Materie
              <span class="badge badge-ok">${activeCount} Attive</span>
              ${pendingCount > 0 ? `<span class="badge badge-warn">${pendingCount} Da Accorpare</span>` : ''}
            </h2>
            <div style="font-size:13px;color:var(--text-muted);max-width:850px;line-height:1.5;">
              Quando lo stesso docente insegna più materie complementari sulla stessa classe (es. <i>Italiano</i>, <i>Latino</i> e <i>Storia e Geografia</i>), l'accorpamento in una <b>macro-materia aggregata</b> (7 o 10 ore complessive) permette al motore FET di suddividere il carico didattico con formule bilanciate (es. <code>2+2+2+1</code> o <code>2+1+2+1+2+1+1</code>), evitando frammentazioni in singole ore sparse o sovraccarichi giornalieri per gli studenti.
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openAddAccorpamentoRuleModal()" title="Definisci una nuova regola per riconoscere automaticamente macro-materie">
              ➕ Nuova Regola
            </button>
            <button class="btn btn-sec" onclick="openManualAccorpamentoModal()" title="Unisci manualmente due o più materie dello stesso docente in una classe">
              ⚡ Accorpa Manualmente
            </button>
            <button class="btn btn-sec" onclick="navigate('activities')" title="Torna a tutte le Attività e Cattedre">
              📝 Vai a Tutte le Cattedre
            </button>
          </div>
        </div>

        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
            <b style="font-size:12.5px;color:var(--text-main);text-transform:uppercase;letter-spacing:0.5px;">📋 Regole Macro-Materia Riconosciute nel Sistema (${rules.length}):</b>
            <button class="btn btn-sm btn-sec" onclick="openAddAccorpamentoRuleModal()">+ Aggiungi Regola</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">
            ${rules.map(r => `
              <span class="item-chip primary" style="font-size:12px;padding:5px 10px;display:inline-flex;align-items:center;gap:6px;">
                <span>⚡ <b>${escapeHtml(r.name)}</b>: <span style="color:var(--text-muted);">${r.components.map(c => escapeHtml(c)).join(' + ')}</span></span>
                <span style="cursor:pointer;color:var(--danger);font-weight:bold;margin-left:4px;font-size:14px;line-height:1;" onclick="deleteAccorpamentoRule('${escapeJs(r.id)}', '${escapeJs(r.name)}')" title="Elimina questa regola">×</span>
              </span>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Barra Filtri e Ricerca -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="accorpamentiPageSearch" class="search-input" placeholder="🔍 Cerca docente, classe o materia..." oninput="filterAccorpamentiPageView(this.value)" style="width:320px;">
          <button class="btn btn-sm btn-sec accorpamenti-filter-btn active" id="btnAccFilterAll" onclick="setAccorpamentiFilter('all')">Tutte (${candidates.length})</button>
          <button class="btn btn-sm btn-sec accorpamenti-filter-btn" id="btnAccFilterActive" onclick="setAccorpamentiFilter('active')">🟢 Solo Attive (${activeCount})</button>
          ${pendingCount > 0 ? `
            <button class="btn btn-sm btn-sec accorpamenti-filter-btn" id="btnAccFilterPending" onclick="setAccorpamentiFilter('pending')">⚡ Da Accorpare (${pendingCount})</button>
          ` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-muted);">
          Tutte le modifiche e disaccorpamenti sono <b>immediati e reversibili al 100%</b>.
        </div>
      </div>

      <!-- Tabella Macro-Materie -->
      <div class="table-container">
        <table class="data-table" id="accorpamentiTable">
          <thead>
            <tr>
              <th style="width:40px;">#</th>
              <th style="min-width:180px;">👨‍🏫 Docente Titolare</th>
              <th style="width:110px;">🎓 Classe</th>
              <th style="min-width:240px;">📚 Macro-Materia / Materia Composta</th>
              <th style="width:100px;text-align:center;">⏱️ Ore Tot.</th>
              <th style="width:170px;">🧩 Blocchi Orari FET</th>
              <th style="width:150px;text-align:center;">Stato</th>
              <th style="text-align:right;width:170px;">Azioni</th>
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
                    <b style="color:var(--text-main);font-size:13.5px;cursor:pointer;" onclick="navigate('activities');setTimeout(() => filterActivities('${escapeJs(c.teacher)}'), 100)" title="Filtra tutte le cattedre di ${escapeHtml(c.teacher)}">
                      👨‍🏫 ${escapeHtml(c.teacher)}
                    </b>
                  </td>
                  <td>
                    <span class="item-chip primary" style="font-weight:700;cursor:pointer;" onclick="navigate('activities');setTimeout(() => filterActivities('${escapeJs(c.class_name)}'), 100)" title="Vedi tutte le cattedre della classe ${escapeHtml(c.class_name)}">
                      🎓 ${escapeHtml(c.class_name)}
                    </span>
                  </td>
                  <td>
                    <div style="font-weight:700;color:var(--primary);font-size:13.5px;">
                      ${escapeHtml(c.rule_name)}
                    </div>
                    ${c.components && c.components.length > 0 && c.components[0].hours > 0 ? `
                      <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                        Componenti: ${c.components.map(comp => `${escapeHtml(comp.subject)} (${comp.hours}h)`).join(' + ')}
                      </div>
                    ` : ''}
                  </td>
                  <td style="text-align:center;">
                    <b style="font-size:14px;color:var(--primary);">${c.total_hours} h</b>
                  </td>
                  <td>
                    <span class="block-badge" style="font-size:12px;cursor:pointer;" onclick="openEditBlocksModal('${subIds}', '${escapeJs(blocksFormula)}', ${c.total_hours}, '${escapeJs(c.teacher)} - ${escapeJs(c.rule_name)} (${escapeJs(c.class_name)})')" title="Clicca per modificare la scomposizione blocchi">
                      ${escapeHtml(blocksFormula)}
                    </span>
                  </td>
                  <td style="text-align:center;">
                    <span class="badge ${isMerged ? 'badge-ok' : 'badge-warn'}">
                      ${isMerged ? '🟢 Attiva' : '⚡ Candidata'}
                    </span>
                  </td>
                  <td style="text-align:right;white-space:nowrap;">
                    ${isMerged ? `
                      <button class="btn btn-sm btn-sec" onclick="openEditBlocksModal('${subIds}', '${escapeJs(blocksFormula)}', ${c.total_hours}, '${escapeJs(c.teacher)} - ${escapeJs(c.rule_name)} (${escapeJs(c.class_name)})')" title="Modifica la scomposizione in blocchi orari per FET">
                        ⏱️ Blocchi
                      </button>
                      <button class="btn btn-sm btn-danger" onclick="revertAccorpamento('${escapeJs(c.teacher)}', '${escapeJs(c.class_name)}', '${escapeJs(c.rule_id)}')" title="Disaccorpa e ripristina le singole attività atomiche">
                        ↩️ Disaccorpa
                      </button>
                    ` : `
                      <button class="btn btn-sm btn-primary" onclick="applyAccorpamento('${escapeJs(c.teacher)}', '${escapeJs(c.class_name)}', '${escapeJs(c.rule_id)}')">
                        ⚡ Accorpa
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
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
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
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
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
  const container = document.getElementById('mainContent');
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Caricamento regole blocchi & sezioni...</div>';

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

    container.innerHTML = `
      ${getNavReturnBarHtml('Regole di default suddivisione blocchi e indirizzi sezioni.')}
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 style="font-size:18px;font-weight:700;color:var(--text-main);margin:0 0 6px 0;display:flex;align-items:center;gap:8px;">
              📐 Regole Suddivisione Blocchi Orari & Indirizzi Sezioni
              <span class="badge badge-ok">${standardCount} Standard (${Math.round((standardCount/totalCattedre)*100 || 100)}%)</span>
              ${exceptions.length > 0 ? `<span class="badge badge-warn">${exceptions.length} Eccezioni</span>` : '<span class="badge badge-ok">0 Eccezioni</span>'}
            </h2>
            <div style="font-size:13px;color:var(--text-muted);max-width:850px;line-height:1.5;">
              La suddivisione dei blocchi orari (es. <code>2+1</code>, <code>1+1+1</code>, <code>2+2</code>, <code>2</code>) è gestita con il <b>principio delle eccezioni</b>: ciascuna cattedra riceve automaticamente la formula di default prestabilita per la specifica materia, per l'indirizzo (<b>Liceo</b>, <b>Tecnico</b> o <b>Professionale</b>, determinato dalla <i>sezione</i>) e per il ciclo (<b>Biennio</b> 1-2 o <b>Triennio</b> 3-5). La suddivisione si specifica <b>solo ed esclusivamente se diversa</b> dal default.
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openAddBlockRuleModal()" title="Aggiungi una nuova regola di default per una disciplina">
              ➕ Nuova Regola di Default
            </button>
            <button class="btn btn-sec" onclick="navigate('activities')" title="Vai alla schermata di tutte le Cattedre">
              👥 Vai a Vista Cattedre
            </button>
            <button class="btn btn-sec" onclick="resetAllCattedreToDefault()" title="Ripristina tutte le cattedre alla suddivisione standard di default didattico (elimina le eccezioni e suddivisioni puntuali)">
              ↩️ Ripristina Tutte ai Default Didattici ${exceptions.length > 0 ? `(${exceptions.length} eccezioni)` : ''}
            </button>
          </div>
        </div>
      </div>

      <!-- SCHEDA 1: INDIRIZZI DELLE SEZIONI -->
      <div class="card" style="margin-bottom:16px;border-left:4px solid var(--primary);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <b style="font-size:14px;color:var(--text-main);">
            🏷️ 1. Indirizzo di Studio per Sezione (Liceo / Tecnico / Professionale)
          </b>
          <span style="font-size:12px;color:var(--text-muted);">
            Valido per tutte le classi da 1 a 5 con la stessa lettera di sezione
          </span>
        </div>
        <p style="font-size:12.5px;color:var(--text-muted);margin:0 0 12px 0;">
          L'indirizzo di studio è determinato <b>esclusivamente in base alla sezione</b>. Clicca sui pulsanti sotto per cambiare l'indirizzo assegnato a ciascuna sezione dell'istituto:
        </p>

        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          ${(sectionsData.sections || []).map(s => {
            const p = s.percorso || 'tecnico';
            return `
              <div style="background:#f8fafc;border:1px solid var(--border);border-radius:6px;padding:8px 12px;display:flex;flex-direction:column;gap:6px;min-width:170px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <b style="font-size:14px;color:var(--primary);">Sezione ${s.section}</b>
                  <span style="font-size:11.5px;color:var(--text-muted);" title="${(s.classes || []).join(', ')}">${s.classes_count} classi</span>
                </div>
                <div class="percorso-btn-group" style="width:100%;justify-content:space-between;">
                  <button type="button" class="percorso-btn ${p === 'liceo' ? 'active liceo' : ''}" onclick="updateSectionPercorso('${s.section}', 'liceo')" title="Imposta Sezione ${s.section} come Liceo">
                    🎓 Liceo
                  </button>
                  <button type="button" class="percorso-btn ${p === 'tecnico' ? 'active tecnico' : ''}" onclick="updateSectionPercorso('${s.section}', 'tecnico')" title="Imposta Sezione ${s.section} come Tecnico">
                    ⚙️ Tecnico
                  </button>
                  <button type="button" class="percorso-btn ${p === 'professionale' ? 'active professionale' : ''}" onclick="updateSectionPercorso('${s.section}', 'professionale')" title="Imposta Sezione ${s.section} come Professionale">
                    🏥 Prof.
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
              📐 2. Regole di Default del Sistema (${rules.length} Regole Didattiche)
            </b>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
              Queste formule vengono applicate automaticamente a qualsiasi cattedra in assenza di eccezioni esplicite.
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" id="blockRulesSearchInput" class="search-input" placeholder="🔍 Cerca materia o percorso..." oninput="filterBlockRulesTable(this.value)" style="width:240px;">
            <button class="btn btn-sm btn-primary" onclick="openAddBlockRuleModal()">+ Nuova Regola</button>
          </div>
        </div>

        <div class="table-container" style="max-height:480px;overflow:auto;">
          <table class="data-table" id="blockRulesTable">
            <thead>
              <tr>
                <th style="width:40px;">#</th>
                <th>Materia / Disciplina</th>
                <th style="width:130px;text-align:center;">Indirizzo</th>
                <th style="width:110px;text-align:center;">Periodo</th>
                <th style="width:85px;text-align:center;">Ore</th>
                <th style="width:130px;text-align:center;">Formula Default</th>
                <th style="text-align:right;width:120px;">Azioni</th>
              </tr>
            </thead>
            <tbody>
              ${rules.map((r, idx) => {
                const percBadge = r.percorso === 'liceo' ? 'badge-liceo' : (r.percorso === 'tecnico' ? 'badge-tecnico' : (r.percorso === 'professionale' ? 'badge-professionale' : 'badge-info'));
                return `
                  <tr class="block-rule-row" data-search="${escapeHtml((r.subject + ' ' + (r.percorso || '') + ' ' + (r.period || '') + ' ' + r.blocks).toLowerCase())}">
                    <td style="color:var(--text-sub);">${idx + 1}</td>
                    <td>
                      <b style="color:var(--text-main);font-size:13px;">${escapeHtml(r.subject)}</b>
                    </td>
                    <td style="text-align:center;">
                      <span class="badge ${percBadge}">${escapeHtml(r.percorso || 'tutti').toUpperCase()}</span>
                    </td>
                    <td style="text-align:center;">
                      <span class="badge badge-info">${escapeHtml(r.period || 'tutti').toUpperCase()}</span>
                    </td>
                    <td style="text-align:center;">
                      <b style="color:var(--primary);">${r.total_hours ? r.total_hours + ' h' : 'Qualsiasi'}</b>
                    </td>
                    <td style="text-align:center;">
                      <span class="block-badge block-default" style="font-weight:700;">${escapeHtml(r.blocks)}</span>
                    </td>
                    <td style="text-align:right;white-space:nowrap;">
                      <button class="btn btn-sm btn-sec" onclick="openAddBlockRuleModal(${JSON.stringify(r).replace(/"/g, '&quot;')})" title="Modifica regola">✏️</button>
                      <button class="btn btn-sm btn-danger" onclick="deleteBlockRule('${escapeJs(r.id)}')" title="Elimina regola">🗑️</button>
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
              ⚡ 3. Riepilogo Eccezioni Attive nel Progetto (${exceptions.length})
            </b>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
              Cattedre la cui suddivisione blocchi differisce intenzionalmente dalla formula standard di default stabilita sopra.
            </div>
          </div>
        </div>

        ${exceptions.length === 0 ? `
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:20px;text-align:center;color:#166534;font-size:13px;">
            ✅ <b>Nessuna eccezione attiva:</b> tutte le <b>${totalCattedre}</b> cattedre seguono perfettamente le formule standard di default previste per materia, indirizzo e biennio/triennio!
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Classe</th>
                  <th>Materia</th>
                  <th>Docenti</th>
                  <th style="width:85px;text-align:center;">Ore</th>
                  <th style="width:130px;text-align:center;">Suddivisione Applicata</th>
                  <th style="width:130px;text-align:center;">Formula Standard</th>
                  <th style="text-align:right;width:190px;">Azioni</th>
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
                      <button class="btn btn-sm btn-sec" onclick="submitResetBlocksToDefault('${e.sub_activity_ids.join(',')}', ${e.total_hours})" title="Ripristina questa cattedra alla formula di default">
                        ↩️ Ripristina Default
                      </button>
                      <button class="btn btn-sm btn-primary" onclick="openEditBlocksModal('${e.sub_activity_ids.join(',')}', '${escapeJs(e.blocks)}', ${e.total_hours}, '${escapeJs(e.teachers_display)} - ${escapeJs(e.subject)} (${escapeJs(e.students_display)})', '${escapeJs(e.default_blocks || '')}', '${escapeJs(e.subject)}', '${escapeJs(e.students_display)}', '${escapeJs(e.percorso || '')}', '${escapeJs(e.period || '')}')">
                        ✏️ Modifica
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
  const res = await fetch('/api/subjects');
  const subjects = await res.json();
  const subjNames = subjects.map(s => s.name);

  const isEdit = !!existingRule;
  const r = existingRule || { id: '', subject: subjNames[0] || '', percorso: 'tutti', period: 'tutti', total_hours: 3, blocks: '2+1' };

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">${isEdit ? '✏️ Modifica Regola di Default' : '➕ Nuova Regola di Default Suddivisione Blocchi'}</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Materia / Disciplina</label>
          <select id="ruleSubjectSelect" class="form-select">
            ${subjNames.map(s => `<option value="${escapeHtml(s)}" ${r.subject === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            <option value="*" ${r.subject === '*' ? 'selected' : ''}>* (Tutte le materie - Fallback Generale)</option>
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Indirizzo di Studio</label>
            <select id="rulePercorsoSelect" class="form-select">
              <option value="tutti" ${r.percorso === 'tutti' ? 'selected' : ''}>Tutti gli Indirizzi</option>
              <option value="liceo" ${r.percorso === 'liceo' ? 'selected' : ''}>🎓 Solo Liceo</option>
              <option value="tecnico" ${r.percorso === 'tecnico' ? 'selected' : ''}>⚙️ Solo Tecnico</option>
              <option value="professionale" ${r.percorso === 'professionale' ? 'selected' : ''}>🏥 Solo Professionale</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Periodo Scolastico</label>
            <select id="rulePeriodSelect" class="form-select">
              <option value="tutti" ${r.period === 'tutti' ? 'selected' : ''}>Tutti (Biennio & Triennio)</option>
              <option value="biennio" ${r.period === 'biennio' ? 'selected' : ''}>Biennio (Classi 1-2)</option>
              <option value="triennio" ${r.period === 'triennio' ? 'selected' : ''}>Triennio (Classi 3-5)</option>
            </select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Monte Ore Settimanale</label>
            <input type="number" id="ruleTotalHours" class="form-input" min="1" max="10" value="${r.total_hours || 3}">
          </div>
          <div class="form-group">
            <label class="form-label">Formula Suddivisione di Default</label>
            <input type="text" id="ruleBlocks" class="form-input" value="${escapeHtml(r.blocks || '2+1')}" style="font-weight:700;font-family:var(--font-mono);">
          </div>
        </div>
        <span class="form-hint">
          Esempio: per 3 ore inserisci <b>2+1</b> (una lezione doppia e una singola in giorni diversi) oppure <b>1+1+1</b>.
        </span>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
        <button class="btn btn-primary" onclick="submitBlockRule('${escapeJs(r.id || '')}')">💾 Salva Regola</button>
      </div>
    </div>
  `);
}

async function submitBlockRule(existingId) {
  const subject = document.getElementById('ruleSubjectSelect').value.trim();
  const percorso = document.getElementById('rulePercorsoSelect').value.trim();
  const period = document.getElementById('rulePeriodSelect').value.trim();
  const totalHours = parseInt(document.getElementById('ruleTotalHours').value, 10) || 0;
  const blocks = document.getElementById('ruleBlocks').value.trim();

  if (!subject) {
    alert('Selezionare la materia.');
    return;
  }
  if (totalHours <= 0) {
    alert('Inserire un monte ore valido.');
    return;
  }
  const blockSum = blocks.replace(/,/g, '+').split('+').map(x => parseInt(x.trim()) || 0).reduce((a, b) => a + b, 0);
  if (blockSum !== totalHours) {
    alert(`La somma dei blocchi (${blockSum}) non corrisponde al monte ore settimanale (${totalHours}).`);
    return;
  }

  const payload = {
    id: existingId || '',
    subject,
    percorso,
    period,
    total_hours: totalHours,
    blocks
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
  if (confirm(`Eliminare questa regola di default?`)) {
    const res = await fetch('/api/blocks/rules/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ruleId })
    });
    if (res.ok) {
      showToast('Regola eliminata con successo.', 'warn');
      renderBlockRulesView();
    } else {
      alert('Errore eliminazione regola.');
    }
  }
}

async function resetAllCattedreToDefault() {
  if (!confirm("Reimpostare TUTTE le cattedre alla suddivisione standard di default didattica per materia, percorso e periodo?\n\nTutte le suddivisioni puntuali verranno azzerate e le sotto-attività FET rigenerate secondo i default didattici (es. 10h -> 2+2+2+2+2, 7h -> 2+2+2+1 o 2+2+1+1+1, 6h -> 2+2+1+1, 4h -> 2+1+1 o 2+2, 3h lingue -> 1+1+1, 2h motorie/lab -> 2, ecc.).")) {
    return;
  }
  try {
    const res = await fetch('/api/cattedre/reset_all_to_default', {
      method: 'POST'
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`Tutte le ${data.cattedre_count} cattedre sono state ripristinate ai default didattici (${data.activities_count} sotto-attività FET)!`, 'success');
      if (currentView === 'block_rules') renderBlockRulesView();
      else if (currentView === 'activities') renderActivities();
      else if (currentView === 'accorpamenti') renderAccorpamenti();
    } else {
      const err = await res.json().catch(() => ({}));
      alert('Errore durante il reset delle cattedre: ' + (err.error || 'Operazione fallita'));
    }
  } catch (e) {
    alert('Errore durante il reset: ' + e.message);
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
  if (confirm(`Eliminare l'attività #${id}?`)) {
    await fetch(`/api/activities/${id}`, { method: 'DELETE' });
    showToast(`Attività #${id} eliminata.`, 'warn');
    renderActivities();
  }
}

// --- MODALE: NUOVA CATTEDRA / ATTIVITÀ CON PRESET E SPAZIO DEDICATO ---
let selectedCoTeachers = [];

async function openNewCattedraModal(preset = {}) {
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

  const teacherOpts = teachers.map(t => `
    <option value="${escapeHtml(t.name)}" ${preset.teacher === t.name ? 'selected' : ''}>${escapeHtml(t.name)}</option>
  `).join('');

  let targetOpts = `<optgroup label="Classi Intere">` +
    classes.map(c => `
      <option value="${escapeHtml(c.name)}" ${preset.className === c.name ? 'selected' : ''}>
        Classe ${escapeHtml(c.name)} (${c.students || 0} alunni - ${escapeHtml(c.building || 'Centrale')})
      </option>
    `).join('') +
    `</optgroup>`;
  if (groups.length > 0) {
    targetOpts += `<optgroup label="Gruppi Articolati (Lingue, Religione/Alt, Sottogruppi)">` +
      groups.map(g => `
        <option value="${escapeHtml(g.name)}" ${preset.className === g.name ? 'selected' : ''}>
          Gruppo ${escapeHtml(g.name)} (${escapeHtml(g.class_name)})
        </option>
      `).join('') +
      `</optgroup>`;
  }
  targetOpts += `<optgroup label="Altro">
    <option value="__CUSTOM__">➕ Classi Parallele / Accorpate (es. 1C+1D)...</option>
  </optgroup>`;

  const subjOpts = subjects.map(s => `
    <option value="${escapeHtml(s.name)}" ${preset.subject === s.name ? 'selected' : ''}>${escapeHtml(s.name)}</option>
  `).join('');

  // Spazi fisici (Aule, Lab, Palestre)
  const rooms = stateData.rooms;
  const labs = rooms.filter(r => r.room_type === 'lab' || (!r.room_type && r.is_lab_or_gym));
  const gyms = rooms.filter(r => r.room_type === 'gym' || (r.name || '').toLowerCase().includes('palestra'));
  const stdRooms = rooms.filter(r => !labs.includes(r) && !gyms.includes(r));

  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">➕ Nuova Cattedra / Attività d'Insegnamento</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">
            <span>Docente Titolare</span>
            <span class="form-hint">Ordinati alfabeticamente</span>
          </label>
          <select id="modalTeacher" class="form-select">
            <option value="">-- Seleziona Docente Titolare --</option>
            ${teacherOpts}
          </select>
        </div>

        <div class="form-group">
          <div class="form-label">
            <span>Compresenze / Co-Docenti</span>
            <span class="form-hint" style="cursor:pointer;color:var(--primary);font-weight:600;" onclick="toggleCoTeacherRow()">+ Aggiungi Docente Compresenza</span>
          </div>
          <div id="coTeacherRow" style="display:none;margin-bottom:6px;">
            <div style="display:flex;gap:6px;">
              <select id="modalCoTeacherSelect" class="form-select">
                <option value="">-- Seleziona Docente per compresenza --</option>
                ${teachers.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('')}
              </select>
              <button class="btn btn-sm btn-sec" type="button" onclick="addCoTeacherChip()">Aggiungi</button>
            </div>
          </div>
          <div id="coTeacherChips" class="co-teachers-list"></div>
        </div>

        <div class="form-group">
          <label class="form-label">Destinatari (Classe, Gruppo Articolato o Classi Parallele)</label>
          <select id="modalTargetSelect" class="form-select" onchange="onTargetSelectChange(this.value)">
            ${targetOpts}
          </select>
          <div id="customTargetDiv" style="display:none;margin-top:6px;">
            <input type="text" id="modalCustomTarget" class="form-input" placeholder="Es. 1C+1D (per Scienze Motorie o accorpamenti)">
            <span class="form-hint">Separa con "+" o virgola le classi che partecipano insieme alla stessa ora.</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Materia / Disciplina</label>
          <select id="modalSubject" class="form-select">
            <option value="">-- Seleziona Materia --</option>
            ${subjOpts}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">
            <span>Aula Dedicata / Laboratorio / Palestra</span>
            <span class="form-hint">Se omesso, usa l'aula base della classe</span>
          </label>
          <select id="modalRoomSelect" class="form-select" onchange="checkBuildingTransferWarning()">
            <option value="" data-bld="" data-type="default">-- 🏠 Aula Base Ordinaria della Classe (Nessun trasferimento) --</option>
            <optgroup label="🧪 Laboratori Didattici (Innescano cambio plesso per classi di altra sede)">
              ${labs.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="lab">🧪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} alunni]</option>`).join('')}
            </optgroup>
            <optgroup label="🏀 Palestre / Impianti Sportivi">
              ${gyms.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="gym">🏀 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} alunni]</option>`).join('')}
            </optgroup>
            <optgroup label="🚪 Aule Speciali / Altri Spazi">
              ${stdRooms.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="standard">🚪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} alunni]</option>`).join('')}
            </optgroup>
          </select>
          <div id="buildingTransferWarning" style="display:none;margin-top:8px;"></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Monte Ore Settimanale</label>
            <input type="number" id="modalTotalHours" class="form-input" min="1" max="10" value="3" oninput="onHoursInputChange(this.value)">
          </div>
          <div class="form-group">
            <label class="form-label">Suddivisione Blocchi</label>
            <input type="text" id="modalBlocks" class="form-input" value="2+1" style="font-weight:700;font-family:var(--font-mono);">
          </div>
        </div>

        <div class="form-group">
          <span class="form-label">Preset Suddivisione Blocchi:</span>
          <div class="preset-pills" id="modalPresetsContainer"></div>
          <span class="form-hint" style="margin-top:4px;">
            FET garantisce automaticamente che ciascun blocco (es. 2 ore + 1 ora) sia svolto in <b>giorni diversi</b> tramite il vincolo <i>ConstraintMinDaysBetweenActivities</i>.
          </span>
        </div>

        <div class="form-group">
          <label class="form-label">Note / Dettagli Cattedra <span class="form-hint">(opzionale)</span></label>
          <input type="text" id="modalComments" class="form-input" placeholder="Es. Laboratorio con ITP, cattedra orario esterna...">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
        <button class="btn btn-primary" onclick="submitNewCattedra()">💾 Salva Cattedra</button>
      </div>
    </div>
  `);

  renderBlockPresets(3);
  checkBuildingTransferWarning();
}

function checkBuildingTransferWarning() {
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
    warnDiv.innerHTML = `
      ⚡ <b>CAMBIO DI PLESSO RILEVATO:</b><br>
      La classe <b>${escapeHtml(targetVal || 'selezionata')}</b> risiede in <b>${escapeHtml(classBuilding)}</b>,
      mentre lo spazio <b>${escapeHtml(roomName)}</b> si trova in <b>${escapeHtml(roomBuilding)}</b>.<br>
      FET applicherà automaticamente il vincolo di trasferimento tra sedi e gli intervalli minimi di percorrenza.
    `;
  } else if (roomType === 'lab' || roomType === 'gym') {
    warnDiv.className = 'info-banner info-banner-blue';
    warnDiv.style.display = 'block';
    warnDiv.innerHTML = `
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
  const val = sel.value;
  if (!val) return;
  if (!selectedCoTeachers.includes(val)) {
    selectedCoTeachers.push(val);
    renderCoTeacherChips();
  }
  sel.value = '';
}

function removeCoTeacherChip(name) {
  selectedCoTeachers = selectedCoTeachers.filter(t => t !== name);
  renderCoTeacherChips();
}

function renderCoTeacherChips() {
  const cont = document.getElementById('coTeacherChips');
  if (!cont) return;
  cont.innerHTML = selectedCoTeachers.map(t => `
    <span class="teacher-chip">
      👨‍🏫 ${escapeHtml(t)}
      <span class="remove-chip" onclick="removeCoTeacherChip('${escapeJs(t)}')">×</span>
    </span>
  `).join('');
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
  if (primaryTeacher) allTeachers.push(primaryTeacher);
  selectedCoTeachers.forEach(t => {
    if (!allTeachers.includes(t)) allTeachers.push(t);
  });

  const payload = {
    teachers: allTeachers,
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
  editSelectedCoTeachers = (g.teachers && g.teachers.length > 1) ? g.teachers.slice(1) : [];

  const teacherOpts = teachers.map(t => `
    <option value="${escapeHtml(t.name)}" ${primaryTeacher === t.name ? 'selected' : ''}>${escapeHtml(t.name)}</option>
  `).join('');

  // Destinatari
  const singleStudent = (g.students && g.students.length === 1) ? g.students[0] : '';
  const isCustomStudent = (g.students && g.students.length > 1) || (!classes.some(c => c.name === singleStudent) && !groups.some(grp => grp.name === singleStudent));

  let targetOpts = `<optgroup label="Classi Intere">` +
    classes.map(c => `
      <option value="${escapeHtml(c.name)}" ${(!isCustomStudent && singleStudent === c.name) ? 'selected' : ''}>
        Classe ${escapeHtml(c.name)} (${c.students || 0} alunni - ${escapeHtml(c.building || 'Centrale')})
      </option>
    `).join('') +
    `</optgroup>`;
  if (groups.length > 0) {
    targetOpts += `<optgroup label="Gruppi Articolati (Lingue, Religione/Alt, Sottogruppi)">` +
      groups.map(grp => `
        <option value="${escapeHtml(grp.name)}" ${(!isCustomStudent && singleStudent === grp.name) ? 'selected' : ''}>
          Gruppo ${escapeHtml(grp.name)} (${escapeHtml(grp.class_name)})
        </option>
      `).join('') +
      `</optgroup>`;
  }
  targetOpts += `<optgroup label="Altro">
    <option value="__CUSTOM__" ${isCustomStudent ? 'selected' : ''}>➕ Classi Parallele / Accorpate (es. 1C+1D)...</option>
  </optgroup>`;

  const subjOpts = subjects.map(s => `
    <option value="${escapeHtml(s.name)}" ${g.subject === s.name ? 'selected' : ''}>${escapeHtml(s.name)}</option>
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
        <div class="modal-title">✏️ Modifica Cattedra / Insegnamento</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="background:#f8fafc;padding:10px 14px;border-radius:6px;border:1px solid var(--border);margin-bottom:14px;font-size:12.5px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <b>Sotto-attività FET collegate:</b>
            <span class="sub-acts-tag">
              ${(g.sub_activity_ids || []).map(id => `<a href="javascript:void(0)" onclick="jumpToSubActivity('${id}')" class="sub-act-pill" title="Salta al record FET #${id}">#${id}</a>`).join('')}
            </span>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;margin:0;">
            <input type="checkbox" id="editModalActive" ${g.active ? 'checked' : ''} style="width:16px;height:16px;">
            <span>Attiva nel motore FET</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">
            <span>Docente Titolare</span>
            <span class="form-hint">Ordinati alfabeticamente</span>
          </label>
          <select id="editModalTeacher" class="form-select">
            <option value="">-- Seleziona Docente Titolare --</option>
            ${teacherOpts}
          </select>
        </div>

        <div class="form-group">
          <div class="form-label">
            <span>Compresenze / Co-Docenti</span>
            <span class="form-hint" style="cursor:pointer;color:var(--primary);font-weight:600;" onclick="toggleEditCoTeacherRow()">+ Aggiungi Docente Compresenza</span>
          </div>
          <div id="editCoTeacherRow" style="display:none;margin-bottom:6px;">
            <div style="display:flex;gap:6px;">
              <select id="editModalCoTeacherSelect" class="form-select">
                <option value="">-- Seleziona Docente per compresenza --</option>
                ${teachers.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('')}
              </select>
              <button class="btn btn-sm btn-sec" type="button" onclick="addEditCoTeacherChip()">Aggiungi</button>
            </div>
          </div>
          <div id="editCoTeacherChips" class="co-teachers-list"></div>
        </div>

        <div class="form-group">
          <label class="form-label">Destinatari (Classe, Gruppo Articolato o Classi Parallele)</label>
          <select id="editModalTargetSelect" class="form-select" onchange="onEditTargetSelectChange(this.value)">
            ${targetOpts}
          </select>
          <div id="editCustomTargetDiv" style="display:${isCustomStudent ? 'block' : 'none'};margin-top:6px;">
            <input type="text" id="editModalCustomTarget" class="form-input" value="${escapeHtml((g.students || []).join('+'))}" placeholder="Es. 1C+1D (per Scienze Motorie o accorpamenti)">
            <span class="form-hint">Separa con "+" o virgola le classi che partecipano insieme alla stessa ora.</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Materia / Disciplina</label>
          <select id="editModalSubject" class="form-select">
            <option value="">-- Seleziona Materia --</option>
            ${subjOpts}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">
            <span>Aula Dedicata / Laboratorio / Palestra</span>
            <span class="form-hint">Se omesso, usa l'aula base della classe</span>
          </label>
          <select id="editModalRoomSelect" class="form-select" onchange="checkEditBuildingTransferWarning()">
            <option value="" data-bld="" data-type="default" ${!currentRoom ? 'selected' : ''}>-- 🏠 Aula Base Ordinaria della Classe (Nessun trasferimento) --</option>
            <optgroup label="🧪 Laboratori Didattici (Innescano cambio plesso per classi di altra sede)">
              ${labs.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="lab" ${currentRoom === r.name ? 'selected' : ''}>🧪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} alunni]</option>`).join('')}
            </optgroup>
            <optgroup label="🏀 Palestre / Impianti Sportivi">
              ${gyms.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="gym" ${currentRoom === r.name ? 'selected' : ''}>🏀 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} alunni]</option>`).join('')}
            </optgroup>
            <optgroup label="🚪 Aule Speciali / Altri Spazi">
              ${stdRooms.map(r => `<option value="${escapeHtml(r.name)}" data-bld="${escapeHtml(r.building || 'Centrale')}" data-type="standard" ${currentRoom === r.name ? 'selected' : ''}>🚪 ${escapeHtml(r.name)} [${escapeHtml(r.building || 'Centrale')} - max ${r.capacity || 30} alunni]</option>`).join('')}
            </optgroup>
          </select>
          <div id="editBuildingTransferWarning" style="display:none;margin-top:8px;"></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Monte Ore Settimanale</label>
            <input type="number" id="editModalTotalHours" class="form-input" min="1" max="10" value="${g.total_hours || 3}" oninput="onEditHoursInputChange(this.value)">
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;justify-content:space-between;align-items:center;">
              <span>Suddivisione Blocchi</span>
              ${g.default_blocks ? `
                <span style="font-size:11px;font-weight:normal;color:var(--text-muted);">
                  Formula standard: <b style="color:var(--primary);">${escapeHtml(g.default_blocks)}</b> (${escapeHtml(g.percorso || '')} ${escapeHtml(g.period || '')})
                </span>
              ` : ''}
            </label>
            <div style="display:flex;gap:6px;">
              <input type="text" id="editModalBlocks" class="form-input" value="${escapeHtml(g.blocks || '2+1')}" style="font-weight:700;font-family:var(--font-mono);">
              ${g.default_blocks ? `
                <button type="button" class="btn btn-sm btn-sec" onclick="document.getElementById('editModalBlocks').value='${escapeJs(g.default_blocks)}';selectEditBlockPreset('${escapeJs(g.default_blocks)}');" title="Reimposta la formula di default" style="white-space:nowrap;">
                  ↩️ Default
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <div class="form-group">
          <span class="form-label">Preset Suddivisione Blocchi:</span>
          <div class="preset-pills" id="editModalPresetsContainer"></div>
          <span class="form-hint" style="margin-top:4px;">
            FET garantisce automaticamente che ciascun blocco (es. 2 ore + 1 ora) sia svolto in <b>giorni diversi</b> tramite il vincolo <i>ConstraintMinDaysBetweenActivities</i>.
          </span>
        </div>

        <div class="form-group">
          <label class="form-label">Note / Dettagli Cattedra <span class="form-hint">(opzionale)</span></label>
          <input type="text" id="editModalComments" class="form-input" value="${escapeHtml(formatNoteForDisplay(g.comments || ''))}" placeholder="Es. Laboratorio con ITP, cattedra orario esterna...">
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;">
        <button class="btn btn-danger" onclick="deleteCattedra('${g.sub_activity_ids.join(',')}', '${escapeJs(g.teachers_display)} - ${escapeJs(g.subject)} (${escapeJs(g.students_display)})')">🗑️ Elimina</button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
          <button class="btn btn-primary" onclick="submitEditCattedra('${g.sub_activity_ids.join(',')}')">💾 Salva Modifiche</button>
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
  const val = sel.value;
  if (!val) return;
  if (!editSelectedCoTeachers.includes(val)) {
    editSelectedCoTeachers.push(val);
    renderEditCoTeacherChips();
  }
  sel.value = '';
}

function removeEditCoTeacherChip(name) {
  editSelectedCoTeachers = editSelectedCoTeachers.filter(t => t !== name);
  renderEditCoTeacherChips();
}

function renderEditCoTeacherChips() {
  const cont = document.getElementById('editCoTeacherChips');
  if (!cont) return;
  cont.innerHTML = editSelectedCoTeachers.map(t => `
    <span class="teacher-chip">
      👨‍🏫 ${escapeHtml(t)}
      <span class="remove-chip" onclick="removeEditCoTeacherChip('${escapeJs(t)}')">×</span>
    </span>
  `).join('');
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
    warnDiv.innerHTML = `
      ⚡ <b>CAMBIO DI PLESSO RILEVATO:</b><br>
      La classe <b>${escapeHtml(targetVal || 'selezionata')}</b> risiede in <b>${escapeHtml(classBuilding)}</b>,
      mentre lo spazio <b>${escapeHtml(roomName)}</b> si trova in <b>${escapeHtml(roomBuilding)}</b>.<br>
      FET applicherà automaticamente il vincolo di trasferimento tra sedi e gli intervalli minimi di percorrenza.
    `;
  } else if (roomType === 'lab' || roomType === 'gym') {
    warnDiv.className = 'info-banner info-banner-blue';
    warnDiv.style.display = 'block';
    warnDiv.innerHTML = `
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
  if (primaryTeacher) allTeachers.push(primaryTeacher);
  editSelectedCoTeachers.forEach(t => {
    if (!allTeachers.includes(t)) allTeachers.push(t);
  });

  const payload = {
    sub_ids: oldSubIdsStr.split(','),
    teachers: allTeachers,
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
          <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
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
        <div class="modal-title">⏱️ Modifica Blocchi Orari & Eccezioni</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="background:#f8fafc;padding:12px;border-radius:6px;border:1px solid var(--border);font-size:13px;margin-bottom:12px;">
          <b>Cattedra:</b> ${escapeHtml(desc)}<br>
          <b>Monte ore complessivo:</b> <span style="color:var(--primary);font-weight:700;">${totalHours} h settimanali</span>
          ${percorso ? `<br><b>Indirizzo & Periodo:</b> <span class="badge ${percorso === 'liceo' ? 'badge-liceo' : (percorso === 'tecnico' ? 'badge-tecnico' : 'badge-professionale')}">${percorso.toUpperCase()} (${period})</span>` : ''}
        </div>

        ${(!isFeasible && feasibilityWarning) ? `
          <div class="info-banner" style="margin-top:0;margin-bottom:14px;background:#fef2f2;border-color:#fecaca;color:#991b1b;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div>
                ⚠️ <b>Conflitto con la presenza del docente:</b>
                <div style="font-size:12px;margin-top:2px;color:#b91c1c;">${escapeHtml(feasibilityWarning)}</div>
              </div>
              ${suggestedBlocks ? `
                <button class="btn btn-sm btn-danger" type="button" onclick="selectEditBlockPreset('${escapeJs(suggestedBlocks)}', '${escapeJs(defaultBlocks)}')" style="white-space:nowrap;">
                  💡 Applica ${escapeHtml(suggestedBlocks)}
                </button>
              ` : ''}
            </div>
          </div>
        ` : ''}

        ${defaultBlocks ? `
          <div class="info-banner" style="margin-top:0;margin-bottom:14px;background:#f0fdf4;border-color:#bbf7d0;color:#166534;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                📐 <b>Formula Standard di Default:</b> <span class="block-badge block-default" style="font-size:13px;font-weight:700;">${escapeHtml(defaultBlocks)}</span>
                <div style="font-size:11.5px;color:#15803d;margin-top:2px;">
                  Prevista per <b>${escapeHtml(subject || 'questa materia')}</b> (${escapeHtml(percorso || 'indirizzo')} ${escapeHtml(period || '')}).
                </div>
              </div>
              <button class="btn btn-sm btn-sec" type="button" onclick="selectEditBlockPreset('${escapeJs(defaultBlocks)}', '${escapeJs(defaultBlocks)}')" style="white-space:nowrap;">
                ↩️ Seleziona Default
              </button>
            </div>
          </div>
        ` : ''}

        <div class="form-group">
          <label class="form-label" style="display:flex;justify-content:space-between;align-items:center;">
            <span>Suddivisione Blocchi Orari Applicata:</span>
            <span id="blockExceptionBadge">
              ${isExc ? `<span class="exc-tag">⚡ Eccezione Personalizzata</span>` : `<span class="badge badge-ok">Standard di Default</span>`}
            </span>
          </label>
          <input type="text" id="editBlocksInput" class="form-input" value="${escapeHtml(currentBlocks)}" style="font-weight:700;font-family:var(--font-mono);font-size:15px;" oninput="onEditBlocksInputChange('${escapeJs(defaultBlocks)}')">
          <span class="form-hint" id="blockExceptionHint" style="margin-top:4px;">
            ${isExc ? `⚡ Questa cattedra differisce dallo standard (<b>${escapeHtml(defaultBlocks)}</b>) ed è registrata come eccezione.` : `Questa cattedra coincide con la formula standard di default.`}
          </span>
        </div>

        <div class="form-group">
          <span class="form-label">Preset suddivisione (totale ${totalHours}h):</span>
          <div class="preset-pills">
            ${presets.map(p => {
              const isDef = defaultBlocks === p;
              const isSug = suggestedBlocks === p;
              const badgeTxt = isSug ? '💡 (Consigliato per giorni docente)' : (isDef ? '⭐ (Default)' : '');
              return `
                <button type="button" class="preset-pill ${p === currentBlocks ? 'active' : ''}" onclick="selectEditBlockPreset('${p}', '${escapeJs(defaultBlocks)}')">
                  ${p} ${badgeTxt}
                </button>
              `;
            }).join('')}
          </div>
          <span class="form-hint" style="margin-top:6px;">
            FET garantisce automaticamente che ogni blocco (es. <code>2+1</code>) si svolga in <b>giorni diversi</b>.
          </span>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;">
        ${defaultBlocks ? `
          <button class="btn btn-sec" type="button" onclick="submitResetBlocksToDefault('${subIdsStr}', ${totalHours})">
            ↩️ Ripristina Default (${escapeHtml(defaultBlocks)})
          </button>
        ` : '<div></div>'}
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
          <button class="btn btn-primary" onclick="submitUpdateBlocks('${subIdsStr}', ${totalHours})">💾 Salva Suddivisione</button>
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
  const ids = subIdsStr.split(',');
  if (confirm(`Sei sicuro di voler eliminare la cattedra:\n"${desc}"\ne tutte le sue ${ids.length} sotto-attività FET collegate?`)) {
    const res = await fetch('/api/cattedre/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_ids: ids })
    });
    if (res.ok) {
      renderActivities();
    } else {
      alert("Errore durante l'eliminazione della cattedra.");
    }
  }
}

// --- GESTIONE MODALI GENERICHE ---
function showModal(html) {
  closeModal();
  const modalDiv = document.createElement('div');
  modalDiv.id = 'activeModal';
  modalDiv.className = 'modal-backdrop';
  modalDiv.innerHTML = html;
  modalDiv.addEventListener('click', (e) => {
    if (e.target === modalDiv) closeModal();
  });
  document.body.appendChild(modalDiv);
}

function closeModal() {
  const m = document.getElementById('activeModal');
  if (m) m.remove();
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
  const res = await fetch('/api/availability');
  const av = await res.json();
  stateData.availability = av;

  const container = document.getElementById('mainContent');
  const teacherList = av.all_teachers || Object.keys(av.teachers || {}).sort();
  // Classi ordinate naturalmente per anno di corso e sezione (1A, 1B ... 5L)
  const classList = (av.all_classes || Object.keys(av.classes || {})).sort(naturalClassCompare);
  const liceoSet = new Set(av.liceo_classes || []);

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

  container.innerHTML = `
    ${getNavReturnBarHtml(activeAvailEntity ? `Configurazione indisponibilità per <b>${escapeHtml(activeAvailEntity)}</b> (${activeAvailMode === 'class' ? 'Classe' : 'Docente'})` : 'Configura gli slot settimanali non disponibili.')}

    <!-- Barra Superiore di Selezione Layout (Singolo vs Matrice Excel) -->
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div class="segmented-control">
            <button class="segmented-btn ${isSingle ? 'active' : ''}" onclick="switchAvailLayout('single')">
              👤 Calendario Singolo
            </button>
            <button class="segmented-btn ${!isSingle ? 'active' : ''}" onclick="switchAvailLayout('matrix')">
              📋 Matrice Completa (Tutti i Record - Stile Excel)
            </button>
          </div>

          ${isSingle ? `
            <div style="display:flex;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;margin-left:6px;">
              <button class="btn btn-sm ${activeAvailMode === 'teacher' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchAvailMode('teacher')">👨‍🏫 Docenti (${teacherList.length})</button>
              <button class="btn btn-sm ${activeAvailMode === 'class' ? 'btn-primary' : 'btn-sec'}" style="border:none;" onclick="switchAvailMode('class')">🎓 Classi (${classList.length})</button>
            </div>

            <select id="availSelect" class="select-input" onchange="switchAvailEntity(this.value)">
              ${currentAvailList.map(name => {
                const isLic = activeAvailMode === 'class' && liceoSet.has(name);
                return `<option value="${escapeHtml(name)}" ${name === activeAvailEntity ? 'selected' : ''}>
                  ${escapeHtml(name)} ${isLic ? '🏛️ (Liceo - max 6h)' : ''}
                </option>`;
              }).join('')}
            </select>

            <!-- Cursore e Stepper Rapido di Scorrimento Docenti/Classi (Mouse e Frecce ◀ ▶) -->
            <div class="timetable-stepper-wrap" title="Scorri velocemente tra i ${activeAvailMode === 'teacher' ? 'docenti' : 'classi'}: trascina il cursore o usa le frecce ◀ ▶ della tastiera">
              <button type="button" class="btn btn-sm btn-sec" style="padding:2px 7px;font-size:11px;font-weight:700;" onclick="stepAvailEntity(-1)" ${curAvailIdx <= 0 ? 'disabled' : ''} title="Precedente (oppure premi Freccia Sinistra ◀)">◀</button>
              <input type="range" class="slider-quick-entity" min="0" max="${Math.max(0, totalAvailEntities - 1)}" value="${curAvailIdx >= 0 ? curAvailIdx : 0}" oninput="onAvailSliderChange(this.value)" title="Trascina il cursore per scorrere rapidamente">
              <button type="button" class="btn btn-sm btn-sec" style="padding:2px 7px;font-size:11px;font-weight:700;" onclick="stepAvailEntity(1)" ${curAvailIdx >= totalAvailEntities - 1 ? 'disabled' : ''} title="Successivo (oppure premi Freccia Destra ▶)">▶</button>
              <span style="font-size:11px;font-weight:700;color:var(--text-sub);min-width:44px;text-align:center;">${curAvailIdx >= 0 ? curAvailIdx + 1 : 1}/${totalAvailEntities}</span>
              <span style="font-size:10.5px;color:#94a3b8;" title="Scorciatoia tastiera: premi le frecce ◀ ▶ per scorrere">⌨️ ◀ ▶</span>
            </div>

            ${activeAvailMode === 'class' && liceoSet.has(activeAvailEntity) ? `
              <span class="badge badge-liceo">
                🏛️ Classe Liceo (6 ore max/giorno: 7ª e 8ª ora bloccate)
              </span>
            ` : ''}
          ` : `
            <div class="segmented-control" style="margin-left:6px;">
              <button class="segmented-btn ${activeMatrixFilter === 'teachers' ? 'active' : ''}" onclick="filterMatrixRows('teachers')">
                👨‍🏫 Solo Docenti (${teacherList.length})
              </button>
              <button class="segmented-btn ${activeMatrixFilter === 'classes' ? 'active' : ''}" onclick="filterMatrixRows('classes')">
                🎓 Solo Classi (${classList.length})
              </button>
            </div>
            <input type="text" class="search-input" placeholder="🔍 Cerca ${activeMatrixFilter === 'teachers' ? 'docente' : 'classe'}..." oninput="filterMatrixTable(this.value)" style="width:200px;">
          `}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isSingle ? `
            ${activeAvailMode === 'class' ? `
              <button class="btn btn-sm btn-sec" onclick="applyLiceoPreset(activeAvailEntity)" title="Imposta 7ª e 8ª ora non disponibili per questa classe">
                ⚡ Orario Liceo per ${escapeHtml(activeAvailEntity)}
              </button>
            ` : ''}
            <button class="btn btn-sm btn-sec" onclick="applyLiceoPresetAll()" title="Applica a tutte le 15 classi del Liceo">
              ⚡ Applica a Tutto il Liceo
            </button>
            <button class="btn btn-primary" onclick="saveAvailability()">💾 Salva Modifiche</button>
          ` : `
            <button class="btn btn-sm btn-sec" onclick="applyLiceoPresetAll()" title="Applica a tutte le 15 classi del Liceo">
              ⚡ Blocca 7ª-8ª Tutto Liceo
            </button>
            <button class="btn btn-primary" onclick="saveMatrixAvailability()">💾 Salva Modifiche Matrice</button>
          `}
        </div>
      </div>

      <div style="font-size:12px;color:var(--text-muted);margin-top:10px;line-height:1.5;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          💡 <b>Legenda:</b> Clicca sulle caselle per alternare tra 🟢 <b>Disponibile</b> (✓) e 🔴 <b>Non disponibile</b> (✕).
          Le caselle grigie (<code>⏸️ PAUSA</code>) sono ore in cui l'intero istituto è chiuso per orario settimanale.
        </div>
        ${!isSingle ? `
          <div style="font-size:11.5px;color:#0284c7;background:#e0f2fe;padding:3px 10px;border-radius:6px;font-weight:600;display:inline-flex;align-items:center;gap:4px;border:1px solid #bae6fd;">
            ↔️ Scorri orizzontalmente per visualizzare tutti i giorni e le ore (1ª-8ª)
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Pannello Interattivo Gestione Preferenze & Desiderata Docente -->
    ${isSingle && activeAvailMode === 'teacher' && curTeacher ? `
      <div class="card" style="padding:12px 16px;margin-bottom:12px;background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:var(--radius-md);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:18px;">🎨</span>
            <b style="font-size:13px;color:#0f172a;">Gestione Preferenze & Desiderata: <u>${escapeHtml(activeAvailEntity)}</u></b>
            <span class="badge badge-info" style="font-size:10.5px;">${curTeacher.cdc || 'Docente'}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:11px;color:var(--text-muted);">💡 Clicca direttamente per modificare le preferenze in tempo reale:</span>
            <button class="btn btn-sm btn-sec" onclick="openEditTeacherModal('${escapeJs(activeAvailEntity)}')" title="Configurazione limiti buche, span permanenza e 2ª scelta">⚙️ Limiti Avanzati</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:10px;">
          <!-- Fascia Oraria Desiderata -->
          <div style="background:#fff;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;">
            <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:6px;text-transform:uppercase;">
              ⏰ Fascia Oraria Desiderata
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn-pref-pill ${(curTeacher.pref_shift || 'none') === 'prime' ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'pref_shift', 'prime')" title="Preferisci lezioni nelle prime ore (1ª-4ª)">🌅 Prime Ore (1ª-4ª)</button>
              <button type="button" class="btn-pref-pill ${(curTeacher.pref_shift || 'none') === 'ultime' ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'pref_shift', 'ultime')" title="Preferisci lezioni nelle ultime ore (3ª-8ª)">🌇 Ultime Ore (3ª-8ª)</button>
              <button type="button" class="btn-pref-pill ${(curTeacher.pref_shift || 'none') === 'bilanciato' ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'pref_shift', 'bilanciato')" title="Distribuzione oraria centrale (2ª-5ª)">⚖️ Bilanciato (2ª-5ª)</button>
              <button type="button" class="btn-pref-pill ${(curTeacher.pref_shift || 'none') === 'none' ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'pref_shift', 'none')" title="Nessuna preferenza di fascia oraria (orario flessibile)">⚪ Flessibile</button>
            </div>
          </div>

          <!-- Giorno Libero Desiderato -->
          <div style="background:#fff;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;">⭐ Giorno Libero (1ª Scelta)</span>
              <label style="font-size:11px;color:#0284c7;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;" title="Spunta per rendere il giorno libero un vincolo FET tassativo al 100%">
                <input type="checkbox" ${curTeacher.free_day_strict ? 'checked' : ''} onchange="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'free_day_strict', this.checked)">
                <span>🔒 100% Tassativo</span>
              </label>
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
              ${['Lun', 'Mar', 'Mer', 'Gio', 'Ven'].map(d => `
                <button type="button" class="btn-pref-day ${curTeacher.free_day_1 === d ? 'active' : ''}" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'free_day_1', '${curTeacher.free_day_1 === d ? '' : d}')" title="${curTeacher.free_day_1 === d ? 'Giorno libero attivo (clicca per rimuovere)' : `Imposta ${d} come giorno libero`}">${d}</button>
              `).join('')}
              ${curTeacher.free_day_1 ? `
                <button type="button" class="btn btn-sm btn-sec" style="font-size:10px;padding:2px 6px;" onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'free_day_1', '')" title="Rimuovi giorno libero">✕ Rimuovi</button>
              ` : ''}
              ${curTeacher.free_day_2 ? `
                <span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:10px;padding:2px 6px;margin-left:auto;" title="Seconda scelta alternativa configurata">2ª: ${curTeacher.free_day_2}</span>
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
  const slotsSet = new Set(slots);
  const breakSet = new Set(breakTimes || []);

  const prefShift = (teacherPref?.pref_shift || 'none').toLowerCase();
  const freeDay1 = teacherPref?.free_day_1 || '';
  const freeDayStrict = teacherPref?.free_day_strict || false;

  let headerHtml = `<div class="tt-header" style="background:#153d61;">Ora</div>` + days.map(d => {
    let dayLabel = d;
    const isFree = (d === freeDay1);
    const starBtn = (activeAvailMode === 'teacher' && teacherPref) ? `
      <span style="color:${isFree ? '#fde047' : 'rgba(255,255,255,0.6)'};font-size:12px;margin-left:3px;vertical-align:middle;">
        ${isFree ? '⭐' : '☆'}
      </span>
    ` : '';
    if (isFree) {
      dayLabel = `${d} <span style="font-size:9.5px;background:rgba(255,255,255,0.25);padding:1px 4px;border-radius:3px;margin-left:2px;" title="${freeDayStrict ? 'Giorno libero obbligatorio 100%' : 'Giorno libero desiderato (Soft 85%)'}">⭐ Libero</span>`;
    }
    const clickAttr = (activeAvailMode === 'teacher' && teacherPref) ? `
      onclick="quickSetTeacherPref('${escapeJs(activeAvailEntity)}', 'free_day_1', '${isFree ? '' : d}')" 
      style="cursor:pointer;user-select:none;" 
      title="${isFree ? 'Clicca per rimuovere giorno libero (' + d + ')' : 'Clicca per impostare ' + d + ' come Giorno Libero'}"
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
        rowsHtml += `<div class="tt-cell is-break">INTERVALLO</div>`;
        continue;
      }
      const key = `${d}|${h}`;
      const isBreak = breakSet.has(key);
      const isUnavail = slotsSet.has(key);

      if (isBreak) {
        const breakLabel = d === 'Sab' ? 'SABATO CHIUSO' : '⏸️ PAUSA';
        rowsHtml += `
          <div class="tt-cell is-institute-break" title="${d === 'Sab' ? 'Sabato chiuso (0 ore di default - settimana corta)' : 'Pausa orario d\'istituto (lezioni non ammesse in questa fascia)'}">
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

        rowsHtml += `
          <div class="tt-cell ${isUnavail ? 'is-unavailable' : 'is-available'} ${isPref ? 'is-preferred' : ''}" 
               data-slot="${key}" 
               onclick="toggleSlot(this)"
               title="${isPref ? `Fascia preferita (${teacherPref.pref_shift_weight || 85}%)` : (isUnavail ? 'Non disponibile' : 'Disponibile')}">
            <span style="font-weight:600;">${isUnavail ? '🔴 NON DISP' : '🟢 DISP'}</span>
            ${isPref ? '<span style="font-size:9.5px;color:#1d4ed8;font-weight:700;display:block;margin-top:2px;">⭐ PREF</span>' : ''}
          </div>
        `;
      }
    }
  }

  return `
    <div class="timetable-grid" style="grid-template-columns: ${gridCols};">
      ${headerHtml}
      ${rowsHtml}
    </div>
  `;
}

function toggleSlot(el) {
  const isUnavail = el.classList.contains('is-unavailable');
  if (isUnavail) {
    el.classList.remove('is-unavailable');
    el.classList.add('is-available');
    el.innerHTML = '<span style="font-weight:600;">🟢 DISP</span>';
  } else {
    el.classList.remove('is-available');
    el.classList.add('is-unavailable');
    el.innerHTML = '<span style="font-weight:600;">🔴 NON DISP</span>';
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

  let tableHeaderDays = `<th class="sticky-col" rowspan="2" style="width:200px;">${activeMatrixFilter === 'teachers' ? '👨‍🏫 Docente' : '🎓 Classe'}</th>`;
  days.forEach(d => {
    tableHeaderDays += `<th colspan="${numericHours.length}" class="matrix-day-header">${d}</th>`;
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
        cellsHtml += `<td class="matrix-slot-cell is-break" title="Pausa d'istituto (${slot.key})">⏸️</td>`;
      } else {
        cellsHtml += `
          <td class="matrix-slot-cell ${isUnavail ? 'is-unavail' : 'is-avail'}"
              data-type="${row.type}"
              data-entity="${escapeHtml(row.name)}"
              data-slot="${slot.key}"
              onclick="toggleMatrixCell(this)"
              title="${escapeHtml(row.name)} - ${slot.key}: ${isUnavail ? 'Non Disponibile' : 'Disponibile'}">
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
  if (!confirm(`Applicare il vincolo orario Liceo alla classe "${className}"?\n(Ore 7 e 8 non disponibili in tutti i giorni di rientro)`)) return;
  const res = await fetch('/api/availability/preset_liceo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ class_name: className })
  });
  if (res.ok) {
    showToast(`Vincolo orario Liceo applicato a ${className}!`);
    renderAvailability();
  } else {
    alert('Errore applicazione vincolo.');
  }
}

async function applyLiceoPresetAll() {
  if (!confirm('Applicare il vincolo orario Liceo a TUTTE le 15 classi del Liceo (sezioni C, D, L)?\n(Ore 7 e 8 bloccate al 100%)')) return;
  const res = await fetch('/api/availability/preset_liceo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (res.ok) {
    showToast('Vincolo orario applicato con successo a tutte le classi del Liceo!');
    renderAvailability();
  } else {
    alert('Errore applicazione vincolo.');
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
          <div class="card-title">⚡ Regole e Vincoli Rigidi di Calcolo FET</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
            Regole matematiche applicate al solutore FET per compattare l'orario, azzerare le ore buche e gestire i trasferimenti tra plessi (${activeCount} vincoli attivi su ${Object.keys(cons).length}).
          </div>
        </div>
        <button class="btn btn-primary" onclick="saveConstraintsSettings()">💾 Salva Vincoli FET</button>
      </div>
    </div>

    <!-- Filtri di Categoria a 3 Gruppi -->
    <div class="toolbar" style="margin-bottom:16px;">
      <div class="segmented-control">
        <button class="segmented-btn ${activeConstraintCategory === 'all' ? 'active' : ''}" onclick="filterConstraints('all')">
          Tutti i Vincoli (${Object.keys(cons).length})
        </button>
        <button class="segmented-btn ${activeConstraintCategory === 'Docenti' ? 'active' : ''}" onclick="filterConstraints('Docenti')">
          👨‍🏫 Vincoli Docenti (${docentiCons.length})
        </button>
        <button class="segmented-btn ${activeConstraintCategory === 'Classi' ? 'active' : ''}" onclick="filterConstraints('Classi')">
          🎓 Vincoli Classi & Studenti (${classiCons.length})
        </button>
        <button class="segmented-btn ${activeConstraintCategory === 'Spostamenti' ? 'active' : ''}" onclick="filterConstraints('Spostamenti')">
          🏢 Spostamenti & Plessi (${spostamentiCons.length})
        </button>
      </div>
    </div>

    <div class="settings-grid">
      ${filteredEntries.map(([key, c]) => {
        const isRigid = c.is_rigid || false;
        const weightVal = c.weight !== undefined ? c.weight : 100;

        return `
          <div class="constraint-card">
            <div>
              <div class="constraint-header">
                <span class="constraint-title">${escapeHtml(c.name || key)}</span>
                <span class="badge ${c.category === 'Docenti' ? 'badge-info' : c.category === 'Classi' ? 'badge-warn' : 'badge-ok'}">${c.category || 'Generale'}</span>
              </div>
              <div class="constraint-desc">${escapeHtml(c.desc || '')}</div>
            </div>

            <div class="constraint-ctrls">
              <div style="display:flex;align-items:center;gap:8px;">
                <label class="switch">
                  <input type="checkbox" id="c_active_${key}" ${c.active ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
                <span style="font-size:12px;font-weight:600;color:${c.active ? 'var(--primary)' : 'var(--text-muted)'};">
                  ${c.active ? 'Attivo' : 'Disattivo'}
                </span>
              </div>

              <div style="display:flex;align-items:center;gap:12px;">
                <div style="display:flex;align-items:center;gap:4px;">
                  <span style="font-size:11px;color:var(--text-muted);">Parametro:</span>
                  <input type="number" id="c_val_${key}" class="num-input" value="${c.val !== undefined ? c.val : 0}" min="0" max="100">
                </div>

                <div style="display:flex;align-items:center;gap:4px;">
                  ${isRigid ? `
                    <span class="badge badge-info" style="font-size:10.5px;padding:3px 6px;" title="FET richiede obbligatoriamente peso 100% per questo vincolo algebrico">
                      🔒 100% (Rigido)
                    </span>
                  ` : `
                    <span style="font-size:11px;color:var(--text-muted);" title="Percentuale peso nel solutore FET (0-100%)">Peso:</span>
                    <input type="number" id="c_weight_${key}" class="num-input" value="${weightVal}" min="0" max="100" style="width:58px;" title="Percentuale peso vincolo FET (Weight_Percentage)">
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

async function saveConstraintsSettings() {
  const cons = stateData.settings?.constraints || {};
  const updatedConstraints = {};

  for (const key of Object.keys(cons)) {
    const actEl = document.getElementById(`c_active_${key}`);
    const valEl = document.getElementById(`c_val_${key}`);
    const weightEl = document.getElementById(`c_weight_${key}`);

    updatedConstraints[key] = {
      ...cons[key],
      active: actEl ? actEl.checked : cons[key].active,
      val: valEl ? parseInt(valEl.value, 10) : cons[key].val,
      weight: weightEl ? parseInt(weightEl.value, 10) : (cons[key].weight !== undefined ? cons[key].weight : 100)
    };
  }

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ constraints: updatedConstraints })
  });

  if (res.ok) {
    showToast('Vincoli FET aggiornati con successo!');
    renderConstraints();
  } else {
    alert('Errore durante il salvataggio dei vincoli.');
  }
}

// ============================================================================
// 11. PARAMETRI ISTITUZIONALI COMPLETI (Anagrafica, Calendario, Regole Excel)
// ============================================================================
async function renderParameters() {
  const res = await fetch('/api/settings');
  const cfg = await res.json();
  stateData.settings = cfg;

  const container = document.getElementById('mainContent');
  const dayLimits = cfg.day_hours_limit || { Lun: 6, Mar: 8, Mer: 6, Gio: 6, Ven: 8, Sab: 0 };
  const daysList = cfg.days || ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const params = cfg.parameters || {};

  container.innerHTML = `
    <!-- Sezione 1: Anagrafica Istituto -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">🏛️ Anagrafica Istituto & File FET</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;">
        <div class="form-group">
          <label class="form-label">Nome dell'Istituto Scolastico</label>
          <input type="text" id="cfgInstName" class="form-input" value="${escapeHtml(cfg.institution || '')}" placeholder="es. Liceo & Tecnico Pico De Paperis">
        </div>
        <div class="form-group">
          <label class="form-label">Note / Anno Scolastico</label>
          <input type="text" id="cfgComments" class="form-input" value="${escapeHtml(cfg.comments || '')}" placeholder="es. A.S. 2026/2027">
        </div>
      </div>
    </div>

    <!-- Sezione 2: Calendario Settimanale con Gestione Sabato -->
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          <div class="card-title">📅 Calendario Settimanale & Monte Ore Giornaliero</div>
          <p style="font-size:12px;color:var(--text-muted);margin:6px 0 10px;max-width:750px;line-height:1.5;">
            Configura le ore massime di lezione per ciascun giorno della settimana.
            Il <b>Sabato</b> è gestito nativamente: con <b>0 ore</b> l'istituto è su <i>settimana corta</i> (chiuso); 
            impostando ad es. <b>4 o 5 ore</b> il Sabato viene aperto automaticamente alle lezioni.
          </p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-sec" onclick="applyDayHoursPreset('corta')" title="Lun-Ven aperti, Sabato chiuso a 0 ore">
            ⚡ Settimana Corta (Sabato 0h)
          </button>
          <button class="btn btn-sm btn-sec" onclick="applyDayHoursPreset('lunga_5h')" title="Settimana su 6 giorni con Sabato da 5 ore">
            ⚡ Settimana Lunga (Sabato 5h)
          </button>
          <button class="btn btn-sm btn-sec" onclick="applyDayHoursPreset('lunga_4h')" title="Settimana su 6 giorni con Sabato da 4 ore">
            ⚡ Settimana Lunga (Sabato 4h)
          </button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:12px;margin-top:14px;">
        ${daysList.map(d => {
          const val = dayLimits[d] !== undefined ? dayLimits[d] : (d === 'Sab' ? 0 : 6);
          const isSab = d === 'Sab';
          return `
            <div class="day-hours-box" style="${isSab ? 'border: 2px solid #cbd5e1; background: #f8fafc;' : ''}">
              <div class="day-hours-box-name" style="${isSab ? 'color:#475569;' : ''}">${d} ${isSab ? '🗓️' : ''}</div>
              <input type="number" 
                     id="day_limit_${d}" 
                     class="num-input" 
                     min="0" 
                     max="10" 
                     value="${val}" 
                     ${isSab ? 'oninput="updateSabatoBadge(this.value)"' : ''}
                     style="${isSab ? 'border-color:#94a3b8; font-size:15px;' : ''}">
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">ore max</div>
              ${isSab ? `
                <div style="margin-top:6px;">
                  <span id="sabStatusBadge" class="badge ${val === 0 ? 'badge-warn' : 'badge-ok'}" style="font-size:10.5px;">
                    ${val === 0 ? '● Chiuso (0h)' : `● Attivo (${val}h)`}
                  </span>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Sezione 3: Parametri Istituzionali Avanzati (Foglio Excel "Parametri") -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">📋 Parametri Didattici & Istituzionali Completi (Tab Parametri Excel)</div>
      <p style="font-size:12px;color:var(--text-muted);margin:6px 0 16px;line-height:1.5;">
        Parametri d'istituto integrati nella procedura automatica di generazione FET. Passa con il mouse sull'icona <span class="param-help-icon">i</span> per consultare la documentazione didattica del parametro.
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <!-- Blocco A: Sedi & Orari -->
        <div style="background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;">
          <b style="font-size:13px;color:var(--primary);display:block;margin-bottom:10px;">🏢 Sedi, Orari & Trasferimenti</b>

          <div class="form-group">
            <label class="form-label">
              ORARIO_SEDE_CENTRALE <span class="param-help-icon" title="Orario d'inizio e fine lezioni per la Sede Centrale">i</span>
            </label>
            <input type="text" id="param_ORARIO_SEDE_CENTRALE" class="form-input" value="${escapeHtml(params.ORARIO_SEDE_CENTRALE || '8:00 - 13:00 / 14:00 - 16:00')}">
          </div>

          <div class="form-group">
            <label class="form-label">
              ORARIO_SEDE_SUCCURSALE <span class="param-help-icon" title="Orario d'inizio e fine lezioni per la Sede Succursale">i</span>
            </label>
            <input type="text" id="param_ORARIO_SEDE_SUCCURSALE" class="form-input" value="${escapeHtml(params.ORARIO_SEDE_SUCCURSALE || '8:05 - 13:05 / 14:05 - 16:05')}">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                ORE_MATTINO <span class="param-help-icon" title="Numero massimo di ore previste al mattino">i</span>
              </label>
              <input type="number" id="param_ORE_MATTINO" class="form-input" value="${params.ORE_MATTINO || 6}">
            </div>
            <div class="form-group">
              <label class="form-label">
                ORE_POMERIGGIO <span class="param-help-icon" title="Numero massimo di ore previste nei pomeriggi">i</span>
              </label>
              <input type="number" id="param_ORE_POMERIGGIO" class="form-input" value="${params.ORE_POMERIGGIO || 2}">
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                TEMPO_SPOSTAMENTO_SEDI (min) <span class="param-help-icon" title="Minuti minimi di percorrenza tra Centrale e Succursale">i</span>
              </label>
              <input type="number" id="param_TEMPO_SPOSTAMENTO_SEDI_MINUTI" class="form-input" value="${params.TEMPO_SPOSTAMENTO_SEDI_MINUTI || 10}">
            </div>
            <div class="form-group">
              <label class="form-label">
                MIN_INTERVALLO_PALESTRA (min) <span class="param-help-icon" title="Minuti di intervallo per raggiungere la palestra">i</span>
              </label>
              <input type="number" id="param_MIN_INTERVALLO_PALESTRA_MINUTI" class="form-input" value="${params.MIN_INTERVALLO_PALESTRA_MINUTI || 15}">
            </div>
          </div>
        </div>

        <!-- Blocco B: Didattica Pomeridiana & Regole FET -->
        <div style="background:#f8fafc;border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;">
          <b style="font-size:13px;color:var(--primary);display:block;margin-bottom:10px;">🧠 Didattica Pomeridiana & Regole Docenti</b>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                BLOCCO NO MATEMATICA POM. <span class="param-help-icon" title="Esclude matematica dai rientri pomeridiani">i</span>
              </label>
              <select id="param_BLOCCO_POMERIDIANO_NO_MAT" class="form-select">
                <option value="SI" ${params.BLOCCO_POMERIDIANO_NO_MAT !== 'NO' ? 'selected' : ''}>SI (Consigliato)</option>
                <option value="NO" ${params.BLOCCO_POMERIDIANO_NO_MAT === 'NO' ? 'selected' : ''}>NO</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">
                BLOCCO NO ITALIANO POM. <span class="param-help-icon" title="Esclude italiano dai rientri pomeridiani">i</span>
              </label>
              <select id="param_BLOCCO_POMERIDIANO_NO_ITA" class="form-select">
                <option value="SI" ${params.BLOCCO_POMERIDIANO_NO_ITA === 'SI' ? 'selected' : ''}>SI</option>
                <option value="NO" ${params.BLOCCO_POMERIDIANO_NO_ITA !== 'SI' ? 'selected' : ''}>NO</option>
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                PREFERENZA PALESTRA POM. <span class="param-help-icon" title="Favorisce scienze motorie nelle ore pomeridiane">i</span>
              </label>
              <select id="param_PREFERENZA_PALESTRA_POMERIGGIO" class="form-select">
                <option value="SI" ${params.PREFERENZA_PALESTRA_POMERIGGIO === 'SI' ? 'selected' : ''}>SI</option>
                <option value="NO" ${params.PREFERENZA_PALESTRA_POMERIGGIO !== 'SI' ? 'selected' : ''}>NO</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">
                COMPATTA ORARIO DOCENTI <span class="param-help-icon" title="Minimizza le ore buche e compatta le giornate">i</span>
              </label>
              <select id="param_COMPATTA_ORARIO_DOCENTI" class="form-select">
                <option value="SI" ${params.COMPATTA_ORARIO_DOCENTI !== 'NO' ? 'selected' : ''}>SI</option>
                <option value="NO" ${params.COMPATTA_ORARIO_DOCENTI === 'NO' ? 'selected' : ''}>NO</option>
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">
                MAX BUCHE DOCENTI / SETT. <span class="param-help-icon" title="Numero massimo consentito di ore buche settimanali per docente">i</span>
              </label>
              <input type="number" id="param_MAX_ORE_BUCHE_DOCENTI_SETTIMANA" class="form-input" value="${params.MAX_ORE_BUCHE_DOCENTI_SETTIMANA || 2}">
            </div>
            <div class="form-group">
              <label class="form-label">
                MAX GIORNI DOCENTI COE <span class="param-help-icon" title="Massimo numero di giorni di presenza per docenti su cattedra orario esterna">i</span>
              </label>
              <input type="number" id="param_MAX_GIORNI_DOCENTI_COE" class="form-input" value="${params.MAX_GIORNI_DOCENTI_COE || 4}">
            </div>
          </div>
        </div>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;">
      <button class="btn btn-primary" onclick="saveParametersSettings()">💾 Salva Tutti i Parametri Istituto</button>
    </div>
  `;
}

function updateSabatoBadge(val) {
  const badge = document.getElementById('sabStatusBadge');
  if (!badge) return;
  const num = parseInt(val, 10) || 0;
  if (num === 0) {
    badge.className = 'badge badge-warn';
    badge.innerText = '● Chiuso (0h)';
  } else {
    badge.className = 'badge badge-ok';
    badge.innerText = `● Attivo (${num}h)`;
  }
}

function applyDayHoursPreset(type) {
  if (type === 'corta') {
    document.getElementById('day_limit_Lun').value = 6;
    document.getElementById('day_limit_Mar').value = 8;
    document.getElementById('day_limit_Mer').value = 6;
    document.getElementById('day_limit_Gio').value = 6;
    document.getElementById('day_limit_Ven').value = 8;
    const sab = document.getElementById('day_limit_Sab');
    if (sab) {
      sab.value = 0;
      updateSabatoBadge(0);
    }
  } else if (type === 'lunga_5h') {
    document.getElementById('day_limit_Lun').value = 6;
    document.getElementById('day_limit_Mar').value = 6;
    document.getElementById('day_limit_Mer').value = 6;
    document.getElementById('day_limit_Gio').value = 6;
    document.getElementById('day_limit_Ven').value = 6;
    const sab = document.getElementById('day_limit_Sab');
    if (sab) {
      sab.value = 5;
      updateSabatoBadge(5);
    }
  } else if (type === 'lunga_4h') {
    document.getElementById('day_limit_Lun').value = 6;
    document.getElementById('day_limit_Mar').value = 6;
    document.getElementById('day_limit_Mer').value = 6;
    document.getElementById('day_limit_Gio').value = 6;
    document.getElementById('day_limit_Ven').value = 6;
    const sab = document.getElementById('day_limit_Sab');
    if (sab) {
      sab.value = 4;
      updateSabatoBadge(4);
    }
  }
}

async function saveParametersSettings() {
  const instName = document.getElementById('cfgInstName').value.trim();
  const comments = document.getElementById('cfgComments').value.trim();
  const dayLimits = {};
  const days = stateData.settings?.days || ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  
  days.forEach(d => {
    const el = document.getElementById(`day_limit_${d}`);
    if (el) dayLimits[d] = parseInt(el.value, 10) || 0;
  });

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
    comments: comments,
    days: days,
    day_hours_limit: dayLimits,
    parameters: updatedParams
  };

  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    showToast('Parametri istituto e calendario salvati con successo!');
    const badge = document.getElementById('instBadge');
    if (badge) badge.innerText = instName;
    renderParameters();
  } else {
    alert('Errore durante il salvataggio dei parametri.');
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
      loadInitialData();
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
  const container = document.getElementById('mainContent');
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Caricamento archivio snapshot...</div>';

  try {
    const res = await fetch('/api/snapshots');
    const data = await res.json();
    const currentName = data.current_config_name || 'Configurazione Corrente';
    const snapshots = data.snapshots || [];

    container.innerHTML = `
      <div class="info-banner-blue">
        📦 <b>Archivio Storico & Sistema Snapshot:</b><br>
        Tutte le modifiche a vincoli, docenti, materie e parametri rimangono sempre salvate automaticamente nel database dell'applicazione.
        Crea uno <b>Snapshot / Punto di Ripristino</b> prima di apportare modifiche radicali per poter effettuare il <b>Rollback</b> immediato a una versione funzionante in qualsiasi momento.
      </div>

      <!-- Card Stato Configurazione Corrente -->
      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:0.5px;">Configurazione Attiva nel Sistema</div>
            <div style="font-size:18px;font-weight:800;color:var(--text-main);margin-top:2px;display:flex;align-items:center;gap:8px;">
              <span>⚡</span> <span id="currentConfigTitle">${escapeHtml(currentName)}</span>
              <button class="btn btn-sm btn-sec" onclick="openRenameCurrentModal('${escapeJs(currentName)}')" title="Rinomina la configurazione attiva">✏️ Rinomina</button>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
              Stato corrente sempre salvato e persistente. Tutte le modifiche applicate nelle altre schermate agiscono su questa configurazione.
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openSaveSnapshotModal()" title="Salva un punto di ripristino istantaneo nel database">
              📸 Salva Nuovo Snapshot
            </button>
            <button class="btn btn-sec" onclick="exportFetFile()" title="Scarica il file ParametriOrario.fet pronto per l'applicazione ufficiale FET Desktop">
              📥 Esporta Parametri (.fet)
            </button>
            <button class="btn btn-sec" onclick="exportSolvedTimetable()" title="Scarica il file .fet con l'orario completo generato">
              🗓️ Esporta Orario Risolto (.fet)
            </button>
            <button class="btn btn-sec" onclick="downloadCurrentConfigJson()" title="Scarica la configurazione completa e l'intero database in formato .json">
              💾 Scarica Backup (.json)
            </button>
          </div>
        </div>
      </div>

      <!-- Card Demo & Inizializzazione Scuola -->
      <div class="card" style="margin-bottom:20px;border-left:4px solid var(--primary);background:var(--bg-card);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;">
          <div>
            <div class="card-title" style="margin-bottom:3px;display:flex;align-items:center;gap:6px;">
              <span>🏰</span> <b>Orario Demo Paperopoli & Inizializzazione Progetto</b>
            </div>
            <div style="font-size:12px;color:var(--text-muted);max-width:680px;line-height:1.4;">
              Ricarica in qualsiasi momento l'orario didattico dimostrativo completo di <b>Paperopoli</b> (8 docenti, 5 classi, orario risolto al 100%) oppure <b>azzera l'applicazione a foglio bianco</b> per iniziare una nuova scuola da zero.
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button class="btn btn-outline" onclick="confirmRestoreDemo()" title="Ripristina l'orario didattico dimostrativo completo di Paperopoli" style="font-weight:700;border:1.5px solid var(--primary);color:var(--primary);background:var(--bg-main);">
              🏰 Ripristina Demo Paperopoli
            </button>
            <button class="btn btn-danger" onclick="confirmResetEmpty()" title="Svuota completamente il database e crea un nuovo istituto pulito" style="font-weight:700;">
              🧹 Azzera Tutto (Foglio Bianco)
            </button>
          </div>
        </div>
      </div>

      <!-- Card Upload / Import da Computer -->
      <div class="card" style="margin-bottom:20px;">
        <div class="card-title">📤 Importa File da Computer (FET o JSON)</div>
        <p style="color:var(--text-muted);margin-bottom:12px;font-size:12.5px;">
          Puoi caricare un file <b>.fet</b> o <b>.xml</b> generato da FET Desktop, oppure un file di backup <b>.json</b>: verrà importato e registrato come punto di ripristino nell'archivio.
        </p>
        <div style="border: 2px dashed var(--border); border-radius: var(--radius-md); padding: 24px 20px; text-align: center; cursor: pointer; transition: background 0.15s;"
             onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'"
             onclick="document.getElementById('snapshotUploadInput').click()">
          <div style="font-size:28px;margin-bottom:6px;">📂</div>
          <div style="font-size:13.5px;font-weight:600;color:var(--text-main);margin-bottom:4px;">Clicca per selezionare un file .fet, .xml o .json dal computer</div>
          <div style="font-size:11.5px;color:var(--text-muted);">Trascina o seleziona un file per importarlo direttamente nel sistema</div>
          <input type="file" id="snapshotUploadInput" accept=".json,.fet,.xml" style="display:none;" onchange="uploadSnapshotFile(this.files[0])">
        </div>
      </div>

      <!-- Tabella Archivio Snapshot -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <div class="card-title" style="margin-bottom:0;">
            📚 Versioni Salvate & Punti di Ripristino (${snapshots.length})
          </div>
          <input type="text" class="search-input" placeholder="🔍 Cerca snapshot..." oninput="filterSnapshotsTable(this.value)" style="width:240px;">
        </div>

        ${snapshots.length === 0 ? `
          <div style="text-align:center;padding:36px;color:var(--text-muted);border:1px dashed var(--border);border-radius:var(--radius-md);">
            Nessuno snapshot salvato finora. Clicca su <b>📸 Salva Nuovo Snapshot</b> per creare il primo punto di ripristino!
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table" id="snapshotsTable">
              <thead>
                <tr>
                  <th style="width:40px;">#</th>
                  <th style="width:145px;">Data & Ora</th>
                  <th style="min-width:200px;">Nome Versione / Snapshot</th>
                  <th style="min-width:180px;">Descrizione / Note</th>
                  <th style="width:190px;">Dati & Orario</th>
                  <th style="text-align:right;min-width:260px;">Azioni & Rollback</th>
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
                        ${s.description ? escapeHtml(s.description) : '<span style="color:var(--text-muted);font-style:italic;">Nessuna descrizione</span>'}
                      </td>
                      <td>
                        <div style="display:flex;flex-wrap:wrap;gap:4px;">
                          ${st.teachers_count !== undefined ? `<span class="item-chip" title="Numero docenti">👨‍🏫 ${st.teachers_count}</span>` : ''}
                          ${st.classes_count !== undefined ? `<span class="item-chip" title="Numero classi">🎓 ${st.classes_count}</span>` : ''}
                          ${st.activities_count !== undefined ? `<span class="item-chip" title="Numero attività">📚 ${st.activities_count}</span>` : ''}
                          ${s.has_timetable ? `<span class="badge badge-ok" title="Include orario risolto completo">✅ Orario FET</span>` : `<span class="badge badge-warn" title="Solo configurazione parametri/vincoli">⚙️ Solo Dati</span>`}
                        </div>
                      </td>
                      <td style="text-align:right;white-space:nowrap;">
                        <button class="btn btn-sm btn-primary" onclick="restoreSnapshot('${escapeJs(s.id)}', '${escapeJs(s.name)}')" title="Esegui il Rollback: ripristina questa configurazione come attiva">
                          🔄 Rollback
                        </button>
                        <button class="btn btn-sm btn-sec" onclick="downloadSnapshotJson('${escapeJs(s.id)}')" title="Scarica il file JSON di questo snapshot">
                          📥 JSON
                        </button>
                        ${s.has_timetable ? `
                          <button class="btn btn-sm btn-sec" onclick="downloadSnapshotFet('${escapeJs(s.id)}')" title="Scarica il file FET associato a questo orario">
                            📥 FET
                          </button>
                        ` : ''}
                        <button class="btn btn-sm btn-sec" onclick="openRenameSnapshotModal('${escapeJs(s.id)}', '${escapeJs(s.name)}', '${escapeJs(s.description || '')}')" title="Modifica nome e note dello snapshot">
                          ✏️
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteSnapshot('${escapeJs(s.id)}', '${escapeJs(s.name)}')" title="Elimina definitivamente questo snapshot dall'archivio">
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
    container.innerHTML = `<div class="card" style="color:var(--danger);padding:24px;">Errore caricamento snapshot: ${escapeHtml(err.message)}</div>`;
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
  showModal(`
    <div class="modal-dialog" style="max-width:540px;">
      <div class="modal-header">
        <div class="modal-title">🏰 Ripristina Demo Paperopoli</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body" style="padding:18px 22px;">
        <p style="font-size:13.5px;color:var(--text-main);line-height:1.5;margin-bottom:12px;">
          Vuoi caricare l'orario didattico dimostrativo completo del <b>Liceo & Tecnico "Pico De Paperis" - Paperopoli</b>?
        </p>
        <div class="info-banner-blue" style="font-size:12px;margin-bottom:14px;line-height:1.4;">
          ✨ Include 8 docenti Disney (Archimede, Paperone, Paperino, Nonna Papera, Gastone...), 5 classi (1A-5A), laboratori, palestra e <b>orario già risolto al 100%</b>.<br>
          Verrà creato automaticamente uno Snapshot di backup dei dati attuali.
        </div>
      </div>
      <div class="modal-footer" style="padding:12px 20px;display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
        <button class="btn btn-primary" onclick="executeLoadDemo()" style="font-weight:700;">
          🏰 Conferma e Carica Demo
        </button>
      </div>
    </div>
  `);
}

async function executeLoadDemo() {
  closeModal();
  showToast('Caricamento demo Paperopoli in corso...');
  try {
    const res = await fetch('/api/project/load_demo', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('🎉 Demo Paperopoli caricata con successo!');
      await loadInitialData();
      renderSnapshots();
    } else {
      showToast('Errore nel caricamento demo: ' + (data.error || 'Errore sconosciuto'), 'err');
    }
  } catch (e) {
    showToast('Errore di connessione: ' + e.message, 'err');
  }
}

function confirmResetEmpty() {
  showModal(`
    <div class="modal-dialog" style="max-width:540px;">
      <div class="modal-header">
        <div class="modal-title">🧹 Azzera Tutto (Nuovo Istituto a Foglio Bianco)</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body" style="padding:18px 22px;">
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:var(--radius-sm);padding:12px 14px;color:#991b1b;font-size:12.5px;margin-bottom:16px;line-height:1.4;">
          ⚠️ <b>Attenzione:</b> Questa operazione svuota docenti, classi, materie, aule e orario risolto per preparare una nuova scuola da zero.<br>
          Verrà salvato uno Snapshot automatico prima della cancellazione.
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label" style="font-weight:700;">Nome del Nuovo Istituto Scolastico</label>
          <input type="text" id="resetInstNameInput" class="form-input" placeholder="es. Liceo Scientifico Statale Galileo" value="Nuovo Istituto Scolastico">
        </div>
      </div>
      <div class="modal-footer" style="padding:12px 20px;display:flex;justify-content:flex-end;gap:10px;">
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
        <button class="btn btn-danger" onclick="executeResetEmpty()" style="font-weight:700;">
          🧹 Conferma Svuotamento
        </button>
      </div>
    </div>
  `);
}

async function executeResetEmpty() {
  const instName = document.getElementById('resetInstNameInput')?.value?.trim() || 'Nuovo Istituto Scolastico';
  closeModal();
  showToast('Azzeramento progetto in corso...');
  try {
    const res = await fetch('/api/project/reset_empty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution: instName })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('🧹 Progetto azzerato a foglio bianco con successo!');
      await loadInitialData();
      renderSnapshots();
    } else {
      showToast('Errore durante l\'azzeramento: ' + (data.error || 'Errore sconosciuto'), 'err');
    }
  } catch (e) {
    showToast('Errore di connessione: ' + e.message, 'err');
  }
}

// --- MODALI & AZIONI SNAPSHOT ---
function openSaveSnapshotModal() {
  const defName = `Snapshot ${new Date().toLocaleDateString('it-IT')} ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">📸 Salva Nuovo Snapshot / Versione</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">
          Verrà creata un'istantanea completa dello stato attuale: docenti, classi, disponibilità, vincoli, blocchi orari e l'eventuale orario risolto corrente.
        </p>
        <div class="form-group">
          <label class="form-label">Nome Snapshot / Versione</label>
          <input type="text" id="newSnapName" class="form-input" value="${escapeHtml(defName)}" placeholder="Es. Versione con vincolo 4 ore max">
        </div>
        <div class="form-group">
          <label class="form-label">Note / Descrizione (opzionale)</label>
          <textarea id="newSnapDesc" class="form-textarea" rows="3" placeholder="Es. Provato a rilassare vincolo buchi docenti per testare compilazione"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
        <button class="btn btn-primary" onclick="submitSaveSnapshot()">💾 Salva Snapshot</button>
      </div>
    </div>
  `);
}

async function submitSaveSnapshot() {
  const name = document.getElementById('newSnapName')?.value.trim();
  const desc = document.getElementById('newSnapDesc')?.value.trim();
  if (!name) {
    alert('Inserisci un nome per lo snapshot.');
    return;
  }
  showToast('Salvataggio snapshot in corso...');
  const res = await fetch('/api/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, description: desc })
  });
  if (res.ok) {
    closeModal();
    showToast(`Snapshot "${name}" salvato con successo!`);
    renderSnapshots();
  } else {
    alert('Errore durante il salvataggio dello snapshot.');
  }
}

function openRenameCurrentModal(currentName) {
  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">✏️ Rinomina Configurazione Attiva</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Nuovo Nome per la Configurazione Attiva</label>
          <input type="text" id="renameCurrentInput" class="form-input" value="${escapeHtml(currentName)}" placeholder="Es. Orario Definitivo A.S. 2024/25">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
        <button class="btn btn-primary" onclick="submitRenameCurrent()">💾 Salva Nome</button>
      </div>
    </div>
  `);
}

async function submitRenameCurrent() {
  const name = document.getElementById('renameCurrentInput')?.value.trim();
  if (!name) {
    alert('Inserisci un nome valido.');
    return;
  }
  const res = await fetch('/api/snapshots/rename_current', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  });
  if (res.ok) {
    closeModal();
    showToast(`Configurazione rinominata in "${name}"!`);
    renderSnapshots();
  } else {
    alert('Errore durante la rinomina della configurazione.');
  }
}

function openRenameSnapshotModal(sid, currentName, currentDesc) {
  showModal(`
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title">✏️ Modifica Snapshot</div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Nome Snapshot</label>
          <input type="text" id="renameSnapName" class="form-input" value="${escapeHtml(currentName)}">
        </div>
        <div class="form-group">
          <label class="form-label">Descrizione / Note</label>
          <textarea id="renameSnapDesc" class="form-textarea" rows="3">${escapeHtml(currentDesc || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-sec" onclick="closeModal()">Annulla</button>
        <button class="btn btn-primary" onclick="submitRenameSnapshot('${escapeJs(sid)}')">💾 Salva Modifiche</button>
      </div>
    </div>
  `);
}

async function submitRenameSnapshot(sid) {
  const name = document.getElementById('renameSnapName')?.value.trim();
  const desc = document.getElementById('renameSnapDesc')?.value.trim();
  if (!name) {
    alert('Inserisci un nome per lo snapshot.');
    return;
  }
  const res = await fetch('/api/snapshots/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sid, name: name, description: desc })
  });
  if (res.ok) {
    closeModal();
    showToast(`Snapshot aggiornato con successo!`);
    renderSnapshots();
  } else {
    alert('Errore durante la modifica dello snapshot.');
  }
}

async function restoreSnapshot(sid, snapName) {
  if (confirm(`Sei sicuro di voler eseguire il ROLLBACK allo snapshot "${snapName}"?\n\nTutti i parametri, vincoli, cattedre e orari correnti verranno ripristinati allo stato di questo snapshot.`)) {
    showToast('Ripristino snapshot in corso...');
    const res = await fetch('/api/snapshots/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sid })
    });
    if (res.ok) {
      showToast(`Snapshot "${snapName}" ripristinato con successo!`, 'ok');
      await loadInitialData();
      renderSnapshots();
    } else {
      alert('Errore durante il ripristino dello snapshot.');
    }
  }
}

async function deleteSnapshot(sid, snapName) {
  if (confirm(`Sei sicuro di voler eliminare definitivamente lo snapshot "${snapName}" dall'archivio?`)) {
    const res = await fetch(`/api/snapshots/${encodeURIComponent(sid)}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(`Snapshot "${snapName}" eliminato.`, 'warn');
      renderSnapshots();
    } else {
      alert('Errore durante l\'eliminazione dello snapshot.');
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
  const reader = new FileReader();
  reader.onload = async function(e) {
    const content = e.target.result;
    showToast(`Caricamento "${file.name}" in corso...`);
    try {
      const res = await fetch('/api/snapshots/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content, filename: file.name })
      });
      if (res.ok) {
        const respData = await res.json().catch(() => ({}));
        const snap = respData.snapshot;
        showToast(`File "${file.name}" caricato con successo!`, 'ok');
        if (snap && snap.id && confirm(`File "${file.name}" caricato nell'archivio!\n\nVuoi attivarlo e applicarlo subito come configurazione attiva del sistema?`)) {
          await restoreSnapshot(snap.id, snap.name);
        } else {
          renderSnapshots();
        }
      } else {
        const err = await res.json().catch(() => ({ error: 'Formato non valido' }));
        alert(`Errore importazione file: ${err.error || 'Dati non validi'}`);
      }
    } catch (ex) {
      alert(`Errore durante il caricamento: ${ex.message}`);
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

  const params = new URLSearchParams({
    validity_date: dateVal,
    color_mode: colorVal,
    content_mode: contentVal,
    show_rooms: showRooms,
    include_subgroups: includeSubgroups,
    classes: classesParam
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

  const params = new URLSearchParams({
    validity_date: dateVal,
    paper_size: paperSize,
    show_rooms: showRooms,
    highlight_disp: highlightDisp
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

  const params = new URLSearchParams({
    validity_date: dateVal,
    paper_size: paperSize,
    show_rooms: showRooms,
    highlight_disp: highlightDisp
  });

  const url = '/api/print/teachers/docx?' + params.toString();
  window.location.href = url;
  closePrintTeachersModal();
}

