/**
 * APP.JS - Main Contractor Attendance UI Controller
 */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}
window.addEventListener('load', () => App.init());

const App = {
  activeTab: 'punch',
  selectedWorker: null,
  currentCoords: null,
  currentIp: 'Detecting...',
  isProcessingPunch: false,
  pendingPunchType: null,
  currentPinInput: '',
  audioCtx: null,
  isAdminUnlocked: false,
  _initialized: false,
  _clockInterval: null,

  init() {
    if (this._initialized) return;
    this._initialized = true;

    // 1. Immediately start clock so UI is never stuck on --:--:--
    try {
      this.updateClock();
      if (!this._clockInterval) {
        this._clockInterval = setInterval(() => this.updateClock(), 1000);
      }
    } catch (e) {
      console.warn('Clock init error:', e);
    }

    // 2. Restore admin session if unlocked
    try {
      this.isAdminUnlocked = sessionStorage.getItem('contractor_admin_session_unlocked') === 'true';
    } catch (e) {
      this.isAdminUnlocked = false;
    }

    // 3. Bind UI event listeners
    try {
      this.bindEvents();
    } catch (e) {
      console.warn('bindEvents error:', e);
    }

    // 4. Setup password toggles & admin navigation state
    try {
      this.setupPasswordToggles();
      this.updateAdminUiState();
    } catch (e) {
      console.warn('Admin UI state error:', e);
    }

    // 5. Populate workers & sites (guaranteed fail-safe)
    try {
      this.loadWorkers();
    } catch (e) {
      console.warn('loadWorkers error:', e);
    }

    try {
      this.loadSites();
    } catch (e) {
      console.warn('loadSites error:', e);
    }

    // 6. Render logs table
    try {
      this.renderLogsTable();
    } catch (e) {
      console.warn('renderLogsTable error:', e);
    }

    // 7. Initial GPS acquisition
    try {
      this.refreshGpsLocation();
      GeoEngine.startWatching(
        (pos) => this.onGpsUpdate(pos),
        (err) => this.onGpsError(err)
      );
    } catch (e) {
      console.warn('GPS watch error:', e);
    }

    // 8. Public IP fetch
    try {
      ApiService.getPublicIp().then(ip => {
        this.currentIp = ip;
        const el = document.getElementById('displayIp');
        if (el) el.textContent = ip;
      }).catch(() => {});
    } catch (e) {}

    // 9. Check offline sync queue
    try {
      window.addEventListener('online', () => {
        this.showToast('Online connection restored. Syncing pending punches...', 'success');
        ApiService.flushOfflineQueue();
        this.syncFromCloud(false);
      });
    } catch (e) {}

    // 10. Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration error:', err));
    }

    // 11. Auto-sync cloud data in background on load
    setTimeout(() => {
      this.syncFromCloud(false);
      ApiService.flushOfflineQueue();
    }, 1200);

    // 12. Fetch backend configuration (including Supabase credentials if configured in environment)
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data && data.supabaseUrl && data.supabaseAnonKey) {
          const cur = (typeof SupabaseService !== 'undefined') ? SupabaseService.getConfig() : null;
          if (!cur || cur.url !== data.supabaseUrl || cur.anonKey !== data.supabaseAnonKey || !cur.enabled) {
            SupabaseService.saveConfig({
              url: data.supabaseUrl,
              anonKey: data.supabaseAnonKey,
              enabled: true
            });
            this.updateSupabaseBadge();
            this.syncFromCloud(false);
          }
        }
      })
      .catch(() => {});
  },

  bindEvents() {
    // Admin Trigger button in top right
    const btnAdminTrigger = document.getElementById('btnAdminTrigger');
    if (btnAdminTrigger) {
      btnAdminTrigger.addEventListener('click', () => {
        if (this.isAdminUnlocked) {
          this.switchTab('logs');
        } else {
          this.openAdminModal();
        }
      });
    }

    // Prominent Admin link at bottom of punch screen
    const btnPunchAdminLink = document.getElementById('btnPunchAdminLink');
    if (btnPunchAdminLink) {
      btnPunchAdminLink.addEventListener('click', () => {
        if (this.isAdminUnlocked) {
          this.switchTab('logs');
        } else {
          this.openAdminModal();
        }
      });
    }

    // Admin Logout button
    const btnAdminLogout = document.getElementById('btnAdminLogout');
    if (btnAdminLogout) {
      btnAdminLogout.addEventListener('click', () => this.logoutAdmin());
    }

    // Navigation Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Worker Selection
    const workerSelect = document.getElementById('workerSelect');
    if (workerSelect) {
      workerSelect.addEventListener('change', (e) => {
        this.onWorkerSelected(e.target.value);
      });
    }

    // Site Selection Dropdown
    const siteSelect = document.getElementById('punchSiteSelect');
    if (siteSelect) {
      siteSelect.addEventListener('change', (e) => {
        SiteManager.setActiveSite(e.target.value);
        this.evaluateGeofence();
      });
    }

    // Punch Buttons
    const btnClockIn = document.getElementById('btnClockIn');
    const btnClockOut = document.getElementById('btnClockOut');
    if (btnClockIn) btnClockIn.addEventListener('click', () => this.initiatePunch('Clock-In'));
    if (btnClockOut) btnClockOut.addEventListener('click', () => this.initiatePunch('Clock-Out'));

    // Refresh GPS button
    const btnRefreshGps = document.getElementById('btnRefreshGps');
    if (btnRefreshGps) btnRefreshGps.addEventListener('click', () => this.refreshGpsLocation());

    // Sync Cloud Logs button in Attendance Records
    const btnSyncCloudLogs = document.getElementById('btnSyncCloudLogs');
    if (btnSyncCloudLogs) {
      btnSyncCloudLogs.addEventListener('click', () => this.syncFromCloud(true));
    }

    // Export to Excel buttons (.xlsx and .xls formats)
    document.querySelectorAll('.btn-export-excel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const fmt = e.currentTarget.dataset.format || 'xlsx';
        ApiService.exportToExcel(fmt);
      });
    });

    // Clear logs button (using reliable in-app confirmation modal)
    const btnClearLogs = document.getElementById('btnClearLogs');
    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', () => {
        this.showConfirmModal({
          icon: '🗑️',
          title: 'Clear Local Records',
          message: 'Are you sure you want to clear local attendance records from this device? (Google Sheets records remain safe in the cloud).',
          okText: 'Clear Logs',
          onConfirm: () => {
            ApiService.clearAllLocalPunches();
            this.renderLogsTable();
            this.showToast('Local attendance logs cleared.', 'info');
          }
        });
      });
    }

    // Action Confirmation Modal Buttons
    const btnConfirmCancel = document.getElementById('btnConfirmCancel');
    if (btnConfirmCancel) {
      btnConfirmCancel.addEventListener('click', () => this.closeConfirmModal());
    }
    const btnConfirmOk = document.getElementById('btnConfirmOk');
    if (btnConfirmOk) {
      btnConfirmOk.addEventListener('click', () => {
        if (typeof this._pendingConfirmAction === 'function') {
          const action = this._pendingConfirmAction;
          this._pendingConfirmAction = null;
          this.closeConfirmModal();
          action();
        }
      });
    }

    // Universal delegated click handler for Delete Site and Remove Worker buttons
    document.addEventListener('click', (e) => {
      const deleteSiteBtn = e.target.closest('.btn-delete-site');
      if (deleteSiteBtn) {
        const id = deleteSiteBtn.getAttribute('data-id');
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          this.handleDeleteSite(id);
        }
        return;
      }

      const deleteWorkerBtn = e.target.closest('.btn-delete-worker');
      if (deleteWorkerBtn) {
        const id = deleteWorkerBtn.getAttribute('data-id');
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          this.handleDeleteWorker(id);
        }
        return;
      }
    });

    // Save Admin Settings
    const btnSaveSettings = document.getElementById('btnSaveSettings');
    if (btnSaveSettings) {
      btnSaveSettings.addEventListener('click', () => this.saveAdminSettings());
    }

    // Supabase Settings & Test
    const btnSaveSupabase = document.getElementById('btnSaveSupabase');
    if (btnSaveSupabase) {
      btnSaveSupabase.addEventListener('click', () => this.saveSupabaseSettings());
    }
    const btnTestSupabase = document.getElementById('btnTestSupabase');
    if (btnTestSupabase) {
      btnTestSupabase.addEventListener('click', () => this.testSupabaseConnection());
    }
    const btnToggleSupabaseKey = document.getElementById('btnToggleSupabaseKey');
    if (btnToggleSupabaseKey) {
      btnToggleSupabaseKey.addEventListener('click', () => {
        const inputKey = document.getElementById('settingSupabaseAnonKey');
        if (inputKey) {
          const isPw = inputKey.type === 'password';
          inputKey.type = isPw ? 'text' : 'password';
          btnToggleSupabaseKey.textContent = isPw ? '🙈' : '👁️';
        }
      });
    }

    // SQL Schema Modal
    const btnShowSqlModal = document.getElementById('btnShowSqlModal');
    if (btnShowSqlModal) {
      btnShowSqlModal.addEventListener('click', () => this.openSqlModal());
    }
    const btnCloseSqlModal = document.getElementById('btnCloseSqlModal');
    if (btnCloseSqlModal) {
      btnCloseSqlModal.addEventListener('click', () => this.closeSqlModal());
    }
    const btnCopySqlSchema = document.getElementById('btnCopySqlSchema');
    if (btnCopySqlSchema) {
      btnCopySqlSchema.addEventListener('click', () => this.copySqlSchema());
    }

    // Update Admin Password
    const btnUpdateAdminPassword = document.getElementById('btnUpdateAdminPassword');
    if (btnUpdateAdminPassword) {
      btnUpdateAdminPassword.addEventListener('click', () => this.handleUpdateAdminPassword());
    }

    // Test Webhook
    const btnTestWebhook = document.getElementById('btnTestWebhook');
    if (btnTestWebhook) {
      btnTestWebhook.addEventListener('click', () => this.testWebhookConnection());
    }

    // Add New Site Form
    const formAddSite = document.getElementById('formAddSite');
    if (formAddSite) {
      formAddSite.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAddSite();
      });
    }

    // Extract location from Google Maps link
    const btnExtractMapLink = document.getElementById('btnExtractMapLink');
    if (btnExtractMapLink) {
      btnExtractMapLink.addEventListener('click', () => this.handleExtractMapLink());
    }
    const inputGoogleMapsLink = document.getElementById('inputGoogleMapsLink');
    if (inputGoogleMapsLink) {
      inputGoogleMapsLink.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleExtractMapLink();
        }
      });
    }

    // 1-Click GPS Capture Button for New Site
    const btnCaptureGps = document.getElementById('btnCaptureGps');
    if (btnCaptureGps) {
      btnCaptureGps.addEventListener('click', () => this.captureGpsForNewSite());
    }
    const btnUseCurrentLocForSite = document.getElementById('btnUseCurrentLocForSite');
    if (btnUseCurrentLocForSite) {
      btnUseCurrentLocForSite.addEventListener('click', () => this.captureGpsForNewSite());
    }

    // Add Worker Form
    const formAddWorker = document.getElementById('formAddWorker');
    if (formAddWorker) {
      formAddWorker.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAddWorker();
      });
    }

    // GPS Simulation Toggle (for testing from home)
    const toggleSimulate = document.getElementById('toggleGpsSimulation');
    if (toggleSimulate) {
      toggleSimulate.addEventListener('change', (e) => {
        if (e.target.checked) {
          const activeSite = SiteManager.getActiveSite();
          if (activeSite) {
            GeoEngine.setSimulatedCoords({ lat: activeSite.lat, lng: activeSite.lng });
            this.onGpsUpdate({
              latitude: activeSite.lat,
              longitude: activeSite.lng,
              accuracy: 5,
              timestamp: Date.now(),
              isSimulated: true
            });
            this.showToast(`Simulating GPS at "${activeSite.name}"`, 'info');
          }
        } else {
          GeoEngine.setSimulatedCoords(null);
          this.refreshGpsLocation();
          this.showToast('Returned to device GPS', 'info');
        }
      });
    }

    // Keypad Event Bindings
    document.querySelectorAll('.btn-key[data-num]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const num = e.currentTarget.dataset.num;
        if (this.currentPinInput.length < 6) {
          this.currentPinInput += num;
          this.updatePinDisplay();
        }
      });
    });

    const btnClear = document.getElementById('btnPinClear');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        this.currentPinInput = '';
        this.updatePinDisplay();
      });
    }

    const btnBackspace = document.getElementById('btnPinBackspace');
    if (btnBackspace) {
      btnBackspace.addEventListener('click', () => {
        this.currentPinInput = this.currentPinInput.slice(0, -1);
        this.updatePinDisplay();
      });
    }

    const btnCancel = document.getElementById('btnPinCancel');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        this.closePinModal();
      });
    }

    const btnSubmit = document.getElementById('btnPinSubmit');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', () => {
        this.submitPin();
      });
    }

    // Direct Physical Keyboard & Mobile Virtual Keyboard Input for PIN
    const pinDisplayInput = document.getElementById('pinDisplayInput');
    if (pinDisplayInput) {
      pinDisplayInput.addEventListener('input', (e) => {
        const cleaned = e.target.value.replace(/\D/g, '').slice(0, 6);
        this.currentPinInput = cleaned;
        e.target.value = cleaned;
      });
      pinDisplayInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.submitPin();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.closePinModal();
        }
      });
    }

    // Admin Auth Form explicit submit handler
    const formAdminAuth = document.getElementById('formAdminAuth');
    if (formAdminAuth) {
      formAdminAuth.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitAdminAuth();
      });
    }

    // Global keyboard shortcuts (Escape key closes any open modal)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAdminModal();
        this.closePinModal();
        this.closeConfirmModal();
        this.closeSqlModal();
        this.closeModal();
      }
    });
  },

  switchTab(tabName) {
    if (!this.isAdminUnlocked && tabName !== 'punch') {
      tabName = 'punch';
    }
    this.activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(section => {
      section.classList.toggle('active', section.id === `tab-${tabName}`);
    });

    if (tabName === 'logs') {
      this.renderLogsTable();
      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConfigured()) {
        this.syncFromCloud(false);
      }
    } else if (tabName === 'sites') {
      this.renderSitesList();
      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConfigured()) {
        this.syncFromCloud(false);
      }
    } else if (tabName === 'workers') {
      this.renderWorkersList();
      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConfigured()) {
        this.syncFromCloud(false);
      }
    } else if (tabName === 'settings') {
      this.loadSettingsForm();
    } else if (tabName === 'punch') {
      this.loadWorkers();
      this.loadSites();
    }
  },

  updateClock() {
    const clockEl = document.getElementById('liveClock');
    const dateEl = document.getElementById('liveDate');
    const now = new Date();
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
  },

  loadWorkers() {
    const cfg = ApiService.getConfig();
    const select = document.getElementById('workerSelect');
    if (!select) return;

    const workers = (cfg && Array.isArray(cfg.workers) && cfg.workers.length > 0)
      ? cfg.workers
      : [
          { id: 'w1', name: 'Ramesh (Senior Electrician)', pin: '1111' },
          { id: 'w2', name: 'Suresh (Wireman)', pin: '2222' },
          { id: 'w3', name: 'Anil Kumar (Assistant)', pin: '3333' },
          { id: 'w4', name: 'Karthik (Supervisor)', pin: '4444' }
        ];

    select.innerHTML = '<option value="" disabled selected>-- Select Your Name --</option>';
    workers.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = w.name;
      select.appendChild(opt);
    });
  },

  onWorkerSelected(workerId) {
    const cfg = ApiService.getConfig();
    const workers = (cfg && Array.isArray(cfg.workers) && cfg.workers.length > 0) ? cfg.workers : [];
    this.selectedWorker = workers.find(w => w.id === workerId) || null;
    const workerBadge = document.getElementById('selectedWorkerBadge');
    if (workerBadge) {
      if (this.selectedWorker) {
        workerBadge.textContent = `Worker: ${this.selectedWorker.name}`;
        workerBadge.style.display = 'inline-block';
      } else {
        workerBadge.style.display = 'none';
      }
    }
  },

  loadSites() {
    let sites = SiteManager.getSites();
    if (!Array.isArray(sites) || sites.length === 0) {
      sites = SiteManager.defaultSites;
    }
    const activeSite = SiteManager.getActiveSite() || sites[0];
    const select = document.getElementById('punchSiteSelect');
    if (!select) return;

    select.innerHTML = '';
    sites.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (±${s.radius}m)`;
      if (activeSite && activeSite.id === s.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    this.evaluateGeofence();
  },

  async refreshGpsLocation() {
    const statusEl = document.getElementById('gpsStatusText');
    const dotEl = document.getElementById('gpsStatusDot');
    if (statusEl) statusEl.textContent = 'Acquiring high-accuracy GPS...';
    if (dotEl) dotEl.className = 'status-dot pulsating-amber';

    try {
      const pos = await GeoEngine.getCurrentPosition();
      this.onGpsUpdate(pos);
    } catch (err) {
      this.onGpsError(err);
    }
  },

  onGpsUpdate(pos) {
    this.currentCoords = pos;
    const statusEl = document.getElementById('gpsStatusText');
    const dotEl = document.getElementById('gpsStatusDot');
    const coordsEl = document.getElementById('displayCoords');
    const accuracyEl = document.getElementById('displayAccuracy');

    if (dotEl) dotEl.className = 'status-dot green';
    if (statusEl) {
      statusEl.textContent = pos.isSimulated ? 'GPS Sim Active (Test Mode)' : 'GPS Locked & Accurate';
    }
    if (coordsEl) {
      coordsEl.textContent = `${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}`;
    }
    if (accuracyEl) {
      accuracyEl.textContent = `±${Math.round(pos.accuracy)}m`;
    }

    this.evaluateGeofence();
  },

  onGpsError(err) {
    const statusEl = document.getElementById('gpsStatusText');
    const dotEl = document.getElementById('gpsStatusDot');
    if (dotEl) dotEl.className = 'status-dot red';
    if (statusEl) statusEl.textContent = 'GPS Signal Waiting / Denied';
    console.warn('GPS Error:', err.message);
  },

  evaluateGeofence() {
    const activeSite = SiteManager.getActiveSite();
    const badge = document.getElementById('geofenceBadge');

    if (!activeSite || !this.currentCoords) {
      if (badge) {
        badge.className = 'geofence-banner neutral';
        badge.innerHTML = '<span class="icon">📍</span> Waiting for GPS lock & site selection...';
      }
      return;
    }

    const result = GeoEngine.checkGeofence(
      this.currentCoords.latitude,
      this.currentCoords.longitude,
      activeSite.lat,
      activeSite.lng,
      activeSite.radius
    );

    if (badge) {
      if (result.isWithin) {
        badge.className = 'geofence-banner verified';
        badge.innerHTML = `
          <div class="badge-icon">✅</div>
          <div class="badge-body">
            <strong>ON-SITE VERIFIED (PERIMETER CLEAR)</strong>
            <div>You are within <b>${result.distanceMeters}m</b> of ${activeSite.name} (Allowed: ${activeSite.radius}m)</div>
          </div>
        `;
      } else {
        badge.className = 'geofence-banner outside';
        badge.innerHTML = `
          <div class="badge-icon">🚫</div>
          <div class="badge-body">
            <strong>OUTSIDE SITE PERIMETER (ATTENDANCE BLOCKED)</strong>
            <div><b>${result.distanceMeters}m</b> away from ${activeSite.name} (${result.differenceMeters}m outside ${activeSite.radius}m radius)</div>
          </div>
        `;
      }
    }

    // Strictly update clock buttons to reflect perimeter status
    const btnClockIn = document.getElementById('btnClockIn');
    const btnClockOut = document.getElementById('btnClockOut');
    const subIn = btnClockIn ? btnClockIn.querySelector('.punch-subtext') : null;
    const subOut = btnClockOut ? btnClockOut.querySelector('.punch-subtext') : null;

    if (result.isWithin || this.isAdminUnlocked) {
      if (btnClockIn) btnClockIn.classList.remove('btn-perimeter-blocked');
      if (btnClockOut) btnClockOut.classList.remove('btn-perimeter-blocked');
      if (subIn) subIn.textContent = 'Morning / Shift Start';
      if (subOut) subOut.textContent = 'Evening / Shift End';
    } else {
      if (btnClockIn) btnClockIn.classList.add('btn-perimeter-blocked');
      if (btnClockOut) btnClockOut.classList.add('btn-perimeter-blocked');
      if (subIn) subIn.textContent = '🚫 Blocked: Outside Site';
      if (subOut) subOut.textContent = '🚫 Blocked: Outside Site';
    }
  },

  initiatePunch(punchType) {
    if (this.isProcessingPunch) return;

    const workerSelect = document.getElementById('workerSelect');
    if (!this.selectedWorker) {
      this.showToast('Please select your name from the dropdown first.', 'warning');
      if (workerSelect) workerSelect.focus();
      return;
    }

    const activeSite = SiteManager.getActiveSite();
    if (!activeSite) {
      this.showToast('Please select an active job site.', 'warning');
      return;
    }

    // Strict Guardrail: Check GPS acquisition
    if (!this.currentCoords) {
      this.showToast('📍 GPS Location Required: Please wait for a GPS lock before clocking in/out.', 'warning');
      this.refreshGpsLocation();
      return;
    }

    // Strict Guardrail: Block simulated GPS for regular field workers
    if (this.currentCoords.isSimulated && !this.isAdminUnlocked) {
      this.playChime(false);
      this.showToast('🚫 GPS Guardrail: Simulated GPS coordinates are blocked. Real physical GPS is required.', 'error');
      return;
    }

    // Strict Perimeter Guardrail: Employee must be inside the site boundary
    const geofenceCheck = GeoEngine.checkGeofence(
      this.currentCoords.latitude,
      this.currentCoords.longitude,
      activeSite.lat,
      activeSite.lng,
      activeSite.radius
    );

    if (!geofenceCheck.isWithin && !this.isAdminUnlocked) {
      this.playChime(false);
      if ('vibrate' in navigator) navigator.vibrate([250, 100, 250]);
      this.showToast(
        `🚫 PERIMETER GUARDRAIL BLOCKED: You are ${geofenceCheck.distanceMeters}m away from "${activeSite.name}". You must be physically on-site (within ${activeSite.radius}m) to clock in or out.`,
        'error'
      );
      return;
    }

    this.pendingPunchType = punchType;

    // Check if worker requires PIN
    if (this.selectedWorker.pin) {
      this.openPinModal();
    } else {
      this.executePunch(punchType);
    }
  },

  openPinModal() {
    this.currentPinInput = '';
    this.updatePinDisplay();
    const modal = document.getElementById('workerPinModal');
    const nameEl = document.getElementById('pinWorkerName');
    if (nameEl && this.selectedWorker) {
      nameEl.textContent = this.selectedWorker.name;
    }
    if (modal) modal.classList.add('open');
  },

  closePinModal() {
    const modal = document.getElementById('workerPinModal');
    if (modal) modal.classList.remove('open');
    this.currentPinInput = '';
    this.pendingPunchType = null;
  },

  updatePinDisplay() {
    const display = document.getElementById('pinDisplayInput');
    if (display) {
      display.value = this.currentPinInput ? '•'.repeat(this.currentPinInput.length) : '';
    }
  },

  submitPin() {
    if (!this.selectedWorker) return;
    if (this.currentPinInput !== this.selectedWorker.pin) {
      this.showToast('Incorrect PIN. Please try again.', 'error');
      this.currentPinInput = '';
      this.updatePinDisplay();
      return;
    }

    const punchType = this.pendingPunchType;
    this.closePinModal();
    if (punchType) {
      this.executePunch(punchType);
    }
  },

  async executePunch(punchType) {
    this.isProcessingPunch = true;
    const btn = punchType === 'Clock-In' ? document.getElementById('btnClockIn') : document.getElementById('btnClockOut');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<span class="spinner"></span> Recording...';

    const activeSite = SiteManager.getActiveSite();

    try {
      let coords = this.currentCoords;
      if (!coords) {
        coords = await GeoEngine.getCurrentPosition(6000);
      }

      if (!coords) {
        throw new Error('GPS coordinates are required to verify site perimeter. Please step outside or enable GPS.');
      }

      const geofence = GeoEngine.checkGeofence(
        coords.latitude,
        coords.longitude,
        activeSite.lat,
        activeSite.lng,
        activeSite.radius
      );

      // Final strict guardrail check before recording
      if (!geofence.isWithin && !this.isAdminUnlocked) {
        this.playChime(false);
        if ('vibrate' in navigator) navigator.vibrate([250, 100, 250]);
        this.showToast(
          `🚫 ATTENDANCE REJECTED: Outside site perimeter (${geofence.distanceMeters}m away from "${activeSite.name}", limit: ${activeSite.radius}m).`,
          'error'
        );
        return;
      }

      const ip = this.currentIp || await ApiService.getPublicIp();

      const punchPayload = {
        workerId: this.selectedWorker.id,
        workerName: this.selectedWorker.name,
        punchType: punchType,
        siteId: activeSite.id,
        siteName: activeSite.name,
        latitude: coords ? coords.latitude : null,
        longitude: coords ? coords.longitude : null,
        accuracy: coords ? coords.accuracy : null,
        isWithinGeofence: geofence.isWithin,
        distanceMeters: geofence.distanceMeters,
        ipAddress: ip,
        deviceInfo: `${navigator.platform || 'Device'} - ${navigator.userAgent.slice(0, 80)}`,
        notes: coords && coords.isSimulated ? '[TEST SIMULATION]' : ''
      };

      const recorded = await ApiService.recordPunch(punchPayload);

      this.playChime(geofence.isWithin);
      if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);

      this.showPunchSuccess(recorded);
      this.renderLogsTable();

    } catch (err) {
      this.showToast(`Punch failed: ${err.message}`, 'error');
    } finally {
      this.isProcessingPunch = false;
      if (btn) btn.innerHTML = originalText;
    }
  },

  showPunchSuccess(record) {
    const modal = document.getElementById('punchSuccessModal');
    if (!modal) return;

    document.getElementById('modalPunchType').textContent = record.punchType;
    document.getElementById('modalWorkerName').textContent = record.workerName;
    document.getElementById('modalSiteName').textContent = record.siteName;
    document.getElementById('modalTime').textContent = new Date(record.timestamp).toLocaleTimeString();
    
    const statusTag = document.getElementById('modalStatusTag');
    if (statusTag) {
      if (record.isWithinGeofence) {
        statusTag.className = 'status-pill on-site';
        statusTag.textContent = `Verified On-Site (${record.distanceMeters}m)`;
      } else {
        statusTag.className = 'status-pill off-site';
        statusTag.textContent = `Off-Site Flagged (${record.distanceMeters}m away)`;
      }
    }

    const syncTag = document.getElementById('modalSyncTag');
    if (syncTag) {
      const syncd = [];
      if (record.syncedToSupabase) syncd.push('⚡ Supabase (PostgreSQL)');
      if (record.syncedToSheet) syncd.push('📊 Google Sheets');
      if (syncd.length > 0) {
        syncTag.textContent = `✅ Live Synced to ${syncd.join(' & ')}`;
      } else {
        syncTag.textContent = '⚡ Saved Locally (Pending Cloud Sync)';
      }
    }

    modal.classList.add('open');
  },

  closeModal() {
    const modal = document.getElementById('punchSuccessModal');
    if (modal) modal.classList.remove('open');

    // Reset worker selection so the next user/worker on the device must explicitly select their own name
    this.selectedWorker = null;
    const workerSelect = document.getElementById('workerSelect');
    if (workerSelect) workerSelect.value = '';
    const workerBadge = document.getElementById('selectedWorkerBadge');
    if (workerBadge) workerBadge.style.display = 'none';
  },

  playChime(isSuccess) {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      
      if (isSuccess) {
        osc.frequency.setValueAtTime(587.33, this.audioCtx.currentTime);
        osc.frequency.setValueAtTime(880.00, this.audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.35);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.35);
      } else {
        osc.frequency.setValueAtTime(440, this.audioCtx.currentTime);
        osc.frequency.setValueAtTime(330, this.audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.4);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.4);
      }
    } catch (e) {
      // audio context may require user interaction
    }
  },

  renderLogsTable() {
    const container = document.getElementById('logsTableBody');
    if (!container) return;

    const records = ApiService.getLocalPunches();
    if (records.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">No attendance punches recorded yet.</td>
        </tr>
      `;
      return;
    }

    container.innerHTML = records.map(r => {
      const d = new Date(r.timestamp);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const statusBadge = r.isWithinGeofence
        ? '<span class="status-pill on-site">On-Site</span>'
        : `<span class="status-pill off-site">${r.distanceMeters !== undefined ? r.distanceMeters + 'm' : 'Off-Site'}</span>`;
      const syncBadge = r.syncedToSupabase
        ? '<span title="Synced to Supabase Cloud PostgreSQL" class="sync-icon synced" style="color: #10b981; font-weight: 700;">⚡ Supabase</span>'
        : (r.syncedToSheet
          ? '<span title="Synced to Webhook" class="sync-icon synced">☁️ Webhook</span>'
          : '<span title="Saved locally on device" class="sync-icon pending">⏳ Device</span>');

      const mapLink = (r.latitude && r.longitude)
        ? `<a href="https://www.google.com/maps?q=${r.latitude},${r.longitude}" target="_blank" rel="noopener" class="map-link">📍 Map</a>`
        : '-';

      return `
        <tr>
          <td><strong>${timeStr}</strong><br><small class="text-muted">${dateStr}</small></td>
          <td><strong>${r.workerName}</strong></td>
          <td><span class="type-pill ${r.punchType === 'Clock-In' ? 'in' : 'out'}">${r.punchType}</span></td>
          <td>${r.siteName}</td>
          <td>${statusBadge}</td>
          <td>${mapLink}</td>
          <td>${syncBadge}</td>
        </tr>
      `;
    }).join('');
  },

  renderSitesList() {
    const listContainer = document.getElementById('sitesListContainer');
    if (!listContainer) return;

    const sites = SiteManager.getSites();
    const activeSite = SiteManager.getActiveSite();

    listContainer.innerHTML = sites.map(s => {
      const isActive = activeSite && activeSite.id === s.id;
      return `
        <div class="site-card ${isActive ? 'active-site' : ''}">
          <div class="site-header">
            <div>
              <h3>${s.name} ${isActive ? '<span class="tag-active">Active Site</span>' : ''}</h3>
              <p class="site-desc">${s.description || 'No notes'}</p>
            </div>
            <button type="button" class="btn-sm btn-delete-site" data-id="${s.id}" title="Delete site">🗑️</button>
          </div>
          <div class="site-details">
            <div><strong>GPS Center:</strong> ${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</div>
            <div><strong>Allowed Radius:</strong> ${s.radius} meters</div>
          </div>
          <div class="site-actions">
            <button type="button" class="btn-sm btn-primary btn-set-active-site" data-id="${s.id}">
              ${isActive ? 'Selected for Punch' : 'Set as Current Site'}
            </button>
            <a href="https://www.google.com/maps?q=${s.lat},${s.lng}" target="_blank" rel="noopener" class="btn-sm btn-secondary">
              View on Google Maps ↗
            </a>
          </div>
        </div>
      `;
    }).join('');

    listContainer.querySelectorAll('.btn-set-active-site').forEach(btn => {
      btn.addEventListener('click', (e) => {
        SiteManager.setActiveSite(e.currentTarget.dataset.id);
        this.loadSites();
        this.renderSitesList();
        this.showToast('Active job site updated!', 'success');
      });
    });

    listContainer.querySelectorAll('.btn-delete-site').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        if (id) this.handleDeleteSite(id);
      });
    });
  },

  handleDeleteSite(id) {
    const site = SiteManager.getSiteById(id);
    const siteName = site ? site.name : 'Job Site';

    this.showConfirmModal({
      icon: '🗑️',
      title: 'Delete Job Site',
      message: `Are you sure you want to delete "${siteName}"? This site will be removed from your active list.`,
      okText: 'Delete Site',
      onConfirm: () => {
        try {
          SiteManager.deleteSite(id);
          if (typeof SupabaseService !== 'undefined' && SupabaseService.isConfigured()) {
            SupabaseService.deleteSite(id).catch(err => console.warn('Supabase site delete error:', err));
          }
          this.loadSites();
          this.renderSitesList();
          this.showToast(`Job site "${siteName}" deleted.`, 'info');
        } catch (err) {
          this.showToast(err.message, 'warning');
        }
      }
    });
  },

  handleAddSite() {
    const name = document.getElementById('newSiteName').value;
    const lat = document.getElementById('newSiteLat').value;
    const lng = document.getElementById('newSiteLng').value;
    const radius = document.getElementById('newSiteRadius').value;
    const desc = document.getElementById('newSiteDesc').value;

    if (!name || !lat || !lng) {
      this.showToast('Please fill in Site Name, Latitude, and Longitude.', 'warning');
      return;
    }

    const newSite = SiteManager.addSite({ name, lat, lng, radius, description: desc });
    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConfigured()) {
      SupabaseService.saveSite(newSite).catch(err => console.warn('Supabase site sync error:', err));
    }
    this.loadSites();
    this.renderSitesList();
    document.getElementById('formAddSite').reset();
    this.showToast(`Added job site "${name}" successfully!`, 'success');
  },

  loadSettingsForm() {
    const cfg = ApiService.getConfig();
    const webhookInput = document.getElementById('settingWebhookUrl');
    const pwdInput = document.getElementById('settingAdminPassword');

    if (webhookInput) webhookInput.value = cfg.webhookUrl || ApiService.DEFAULT_WEBHOOK_URL;
    if (pwdInput) pwdInput.value = '';

    // Load Supabase Settings
    if (typeof SupabaseService !== 'undefined') {
      const sbCfg = SupabaseService.getConfig();
      const sbUrlInput = document.getElementById('settingSupabaseUrl');
      const sbKeyInput = document.getElementById('settingSupabaseAnonKey');
      if (sbUrlInput) sbUrlInput.value = sbCfg.url || '';
      if (sbKeyInput) sbKeyInput.value = sbCfg.anonKey || '';
      this.updateSupabaseBadge();
    }
  },

  renderWorkersList() {
    const container = document.getElementById('workersListContainer');
    if (!container) return;

    const cfg = ApiService.getConfig();
    if (!cfg.workers || cfg.workers.length === 0) {
      container.innerHTML = '<p class="text-muted" style="font-size: 0.8rem; padding: 8px;">No workers registered yet.</p>';
      return;
    }
    container.innerHTML = cfg.workers.map(w => `
      <div class="worker-item">
        <div>
          <strong>${w.name}</strong>
          <small class="text-muted"> (PIN: ${w.pin || 'None'})</small>
        </div>
        <button type="button" class="btn-sm btn-delete-worker" data-id="${w.id}">Remove</button>
      </div>
    `).join('');

    container.querySelectorAll('.btn-delete-worker').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        if (id) this.handleDeleteWorker(id);
      });
    });
  },

  handleDeleteWorker(id) {
    const cfg = ApiService.getConfig();
    const worker = cfg.workers.find(w => w.id === id);
    const workerName = worker ? worker.name : 'Worker';

    this.showConfirmModal({
      icon: '🗑️',
      title: 'Remove Worker',
      message: `Are you sure you want to remove "${workerName}" from the roster?`,
      okText: 'Remove',
      onConfirm: () => {
        const idToDelete = id;
        cfg.workers = cfg.workers.filter(w => w.id !== idToDelete);
        ApiService.saveConfig(cfg);
        if (typeof SupabaseService !== 'undefined' && SupabaseService.isConfigured()) {
          SupabaseService.deleteWorker(idToDelete).catch(err => console.warn('Supabase deleteWorker error:', err));
        }
        this.loadWorkers();
        this.renderWorkersList();
        this.showToast(`Worker "${workerName}" removed from roster.`, 'info');
      }
    });
  },

  // Reliable Action Confirmation Modal
  _pendingConfirmAction: null,

  showConfirmModal({ icon = '⚠️', title = 'Confirm Action', message = 'Are you sure?', okText = 'Delete', onConfirm }) {
    this._pendingConfirmAction = onConfirm;
    const modal = document.getElementById('actionConfirmModal');
    const iconEl = document.getElementById('confirmModalIcon');
    const titleEl = document.getElementById('confirmModalTitle');
    const msgEl = document.getElementById('confirmModalMessage');
    const okBtn = document.getElementById('btnConfirmOk');

    if (iconEl) iconEl.textContent = icon;
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (okBtn) okBtn.textContent = okText;

    if (modal) modal.classList.add('open');
  },

  closeConfirmModal() {
    this._pendingConfirmAction = null;
    const modal = document.getElementById('actionConfirmModal');
    if (modal) modal.classList.remove('open');
  },

  handleAddWorker() {
    const nameInput = document.getElementById('newWorkerName');
    const pinInput = document.getElementById('newWorkerPin');
    if (!nameInput || !nameInput.value.trim()) {
      this.showToast('Please enter worker name.', 'warning');
      return;
    }

    const cfg = ApiService.getConfig();
    const newWorker = {
      id: 'w_' + Date.now(),
      name: nameInput.value.trim(),
      pin: pinInput ? pinInput.value.trim() : ''
    };
    cfg.workers.push(newWorker);

    ApiService.saveConfig(cfg);
    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConfigured()) {
      SupabaseService.saveWorker(newWorker).catch(err => console.warn('Supabase saveWorker error:', err));
    }
    this.loadWorkers();
    this.renderWorkersList();
    const addedName = nameInput.value.trim();
    nameInput.value = '';
    if (pinInput) pinInput.value = '';
    this.showToast(`Worker "${addedName}" added to roster!`, 'success');
  },

  saveAdminSettings() {
    const cfg = ApiService.getConfig();
    const webhookInput = document.getElementById('settingWebhookUrl');

    if (webhookInput) cfg.webhookUrl = webhookInput.value.trim();

    ApiService.saveConfig(cfg);
    this.showToast('Google Sheet Webhook saved!', 'success');
  },

  updateSupabaseBadge() {
    const badge = document.getElementById('supabaseStatusBadge');
    if (!badge) return;
    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConfigured()) {
      badge.className = 'status-pill on-site';
      badge.textContent = '⚡ Connected';
    } else {
      badge.className = 'status-pill off-site';
      badge.textContent = 'Disconnected';
    }
  },

  saveSupabaseSettings() {
    const urlInput = document.getElementById('settingSupabaseUrl');
    const keyInput = document.getElementById('settingSupabaseAnonKey');
    if (!urlInput || !keyInput) return;

    const url = urlInput.value.trim();
    const anonKey = keyInput.value.trim();

    if (url && !url.startsWith('http')) {
      this.showToast('Supabase URL must start with https://', 'warning');
      return;
    }

    SupabaseService.saveConfig({
      url,
      anonKey,
      enabled: Boolean(url && anonKey)
    });

    // Also notify Python backend so other devices on the network can share
    if (url && anonKey) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anonKey })
      }).catch(() => {});
    }

    this.updateSupabaseBadge();
    if (url && anonKey) {
      this.showToast('Supabase credentials saved! Testing connection...', 'info');
      this.testSupabaseConnection();
    } else {
      this.showToast('Supabase configuration cleared.', 'info');
    }
  },

  async testSupabaseConnection() {
    const btn = document.getElementById('btnTestSupabase');
    if (btn) btn.textContent = 'Testing...';

    try {
      const result = await SupabaseService.testConnection();
      if (result.success) {
        this.showToast('✅ Supabase connected & tables verified!', 'success');
        this.updateSupabaseBadge();
        this.syncFromCloud(false);
      } else {
        this.showToast(result.message, 'error');
        this.updateSupabaseBadge();
      }
    } catch (err) {
      this.showToast(`Supabase Error: ${err.message}`, 'error');
    } finally {
      if (btn) btn.textContent = 'Test Connection';
    }
  },

  openSqlModal() {
    const modal = document.getElementById('sqlSchemaModal');
    const textarea = document.getElementById('sqlSchemaText');
    if (textarea) {
      textarea.value = `-- ==============================================================================
-- SUPABASE POSTGRESQL SCHEMA FOR CONTRACTOR SITE ATTENDANCE SYSTEM
-- Copy and paste this script directly into your Supabase SQL Editor and click RUN!
-- ==============================================================================

-- 1. Create Job Sites Table
CREATE TABLE IF NOT EXISTS job_sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius INTEGER DEFAULT 150,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Workers Roster Table
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin TEXT DEFAULT '1111',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Attendance Logs Table
CREATE TABLE IF NOT EXISTS attendance_logs (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  worker_id TEXT,
  worker_name TEXT NOT NULL,
  punch_type TEXT NOT NULL,
  site_id TEXT,
  site_name TEXT NOT NULL,
  is_within_geofence BOOLEAN NOT NULL DEFAULT FALSE,
  distance_meters INTEGER,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  ip_address TEXT,
  device_info TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE job_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;

-- 5. Create Permissive Policies for Field App (Public Anon Access)
DROP POLICY IF EXISTS "Allow anon all job_sites" ON job_sites;
DROP POLICY IF EXISTS "Allow anon all workers" ON workers;
DROP POLICY IF EXISTS "Allow anon all attendance_logs" ON attendance_logs;

CREATE POLICY "Allow anon all job_sites" ON job_sites FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon all workers" ON workers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon all attendance_logs" ON attendance_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 6. Fast Query Indexes
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON attendance_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_worker_name ON attendance_logs (worker_name);
CREATE INDEX IF NOT EXISTS idx_logs_site_name ON attendance_logs (site_name);`;
    }
    if (modal) modal.classList.add('open');
  },

  closeSqlModal() {
    const modal = document.getElementById('sqlSchemaModal');
    if (modal) modal.classList.remove('open');
  },

  copySqlSchema() {
    const textarea = document.getElementById('sqlSchemaText');
    if (!textarea) return;
    textarea.select();
    try {
      navigator.clipboard.writeText(textarea.value);
      this.showToast('📋 SQL Script copied to clipboard! Paste it into Supabase SQL Editor.', 'success');
    } catch (e) {
      document.execCommand('copy');
      this.showToast('📋 SQL Script copied!', 'success');
    }
  },

  handleUpdateAdminPassword() {
    const pwdInput = document.getElementById('settingAdminPassword');
    if (!pwdInput || !pwdInput.value.trim()) {
      this.showToast('Please type a new Admin password.', 'warning');
      return;
    }
    const newPwd = pwdInput.value.trim();
    if (newPwd.length < 4) {
      this.showToast('Admin password must be at least 4 characters long.', 'warning');
      return;
    }
    ApiService.setAdminPassword(newPwd);
    pwdInput.value = '';
    this.showToast('Admin password successfully updated!', 'success');
  },

  // Extract & Pinpoint Location from Google Maps Link (From Home / Anywhere)
  async handleExtractMapLink() {
    const input = document.getElementById('inputGoogleMapsLink');
    const feedback = document.getElementById('mapLinkFeedback');
    const btn = document.getElementById('btnExtractMapLink');

    if (!input || !input.value.trim()) {
      this.showToast('Please paste a Google Maps link or coordinates first.', 'warning');
      if (input) input.focus();
      return;
    }

    const rawInput = input.value.trim();
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Pinpointing...';
    }
    if (feedback) {
      feedback.style.display = 'block';
      feedback.className = 'site-gps-feedback';
      feedback.innerHTML = '<span class="spinner"></span> Resolving Google Maps location & coordinates...';
    }

    try {
      const result = await this.resolveAndParseGoogleMapsUrl(rawInput);
      if (!result || result.lat === null || result.lng === null) {
        throw new Error('Could not find latitude and longitude in this link. Please ensure it is a valid Google Maps location link or coordinates.');
      }

      const lat = Number(result.lat).toFixed(6);
      const lng = Number(result.lng).toFixed(6);

      const latInput = document.getElementById('newSiteLat');
      const lngInput = document.getElementById('newSiteLng');
      if (latInput) latInput.value = lat;
      if (lngInput) lngInput.value = lng;

      const nameInput = document.getElementById('newSiteName');
      if (result.siteName && nameInput && (!nameInput.value.trim() || nameInput.value === 'New Site')) {
        nameInput.value = result.siteName;
      }

      if (feedback) {
        feedback.className = 'site-gps-feedback success';
        feedback.innerHTML = `
          <span>✅ <strong>Location Pinpointed!</strong> ${lat}, ${lng} ${result.siteName ? '("' + result.siteName + '")' : ''}</span>
          <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" class="link-preview-map">
            🗺️ Check on Map ↗
          </a>
        `;
      }
      this.showToast(`Coordinates pinpointed: ${lat}, ${lng}`, 'success');
    } catch (err) {
      console.warn('Map extract error:', err);
      if (feedback) {
        feedback.className = 'site-gps-feedback error';
        feedback.innerHTML = `
          <div>⚠️ <strong>Could not pinpoint automatically:</strong> ${err.message}</div>
          <div style="margin-top: 4px; font-size: 0.72rem;">
            Tip: Open the link in your browser, then copy the address bar URL or copy coordinates!
          </div>
        `;
      }
      this.showToast(err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📍 Pinpoint';
      }
    }
  },

  async resolveAndParseGoogleMapsUrl(input) {
    let url = input.trim();

    // 1. Direct check: if already full URL or raw coordinates, parse immediately in 0ms!
    let parsed = this.parseMapText(url);
    if (parsed.lat !== null && parsed.lng !== null) {
      return parsed;
    }

    // 2. If it's a shortened URL (maps.app.goo.gl or goo.gl/maps or short link)
    if (url.includes('maps.app.goo.gl') || url.includes('goo.gl/maps') || url.includes('bit.ly') || url.includes('tinyurl')) {
      // Try public unshortener
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);
        const res = await fetch('https://unshorten.me/json/' + encodeURIComponent(url), { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (data && data.resolved_url) {
          const unshortened = this.parseMapText(data.resolved_url);
          if (unshortened.lat !== null && unshortened.lng !== null) {
            return unshortened;
          }
        }
      } catch (e) {
        console.warn('Unshorten service query failed:', e.message);
      }

      // Try Google Apps Script Webhook if configured
      const cfg = ApiService.getConfig();
      if (cfg.webhookUrl && cfg.webhookUrl.trim()) {
        try {
          const scriptUrl = `${cfg.webhookUrl.trim()}${cfg.webhookUrl.includes('?') ? '&' : '?'}action=resolveMap&url=${encodeURIComponent(url)}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 7000);
          const res = await fetch(scriptUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          const data = await res.json();
          if (data && data.resolvedUrl) {
            const scriptParsed = this.parseMapText(data.resolvedUrl);
            if (scriptParsed.lat !== null && scriptParsed.lng !== null) {
              return scriptParsed;
            }
          }
        } catch (e) {
          console.warn('Webhook resolveMap query failed:', e.message);
        }
      }
    }

    return parsed;
  },

  parseMapText(text) {
    if (!text) return { lat: null, lng: null, siteName: null };
    const decoded = decodeURIComponent(text).trim();
    let lat = null, lng = null, siteName = null;

    // Place name from /place/Name/@lat,lng
    const placeMatch = decoded.match(/\/place\/([^/@?#]+)/);
    if (placeMatch && placeMatch[1]) {
      const raw = placeMatch[1].replace(/\+/g, ' ').trim();
      if (!raw.match(/^-?\d+\.\d+,-?\d+\.\d+$/)) {
        siteName = raw;
      }
    }

    // @lat,lng
    const atMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) {
      lat = parseFloat(atMatch[1]);
      lng = parseFloat(atMatch[2]);
    }

    // !3dlat!4dlng
    if (lat === null || lng === null) {
      const bangMatch = decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (bangMatch) {
        lat = parseFloat(bangMatch[1]);
        lng = parseFloat(bangMatch[2]);
      }
    }

    // query=lat,lng or q=lat,lng or ll=lat,lng
    if (lat === null || lng === null) {
      const qMatch = decoded.match(/[?&](?:q|ll|query)=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (qMatch) {
        lat = parseFloat(qMatch[1]);
        lng = parseFloat(qMatch[2]);
      }
    }

    // Plain decimal coordinates: 10.030963, 76.321064
    if (lat === null || lng === null) {
      const plainMatch = decoded.match(/(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/);
      if (plainMatch) {
        lat = parseFloat(plainMatch[1]);
        lng = parseFloat(plainMatch[2]);
      }
    }

    return { lat, lng, siteName };
  },

  // 1-Click GPS Capture for Registering New Job Site
  async captureGpsForNewSite() {
    const btn = document.getElementById('btnCaptureGps');
    const icon = document.getElementById('gpsBtnIcon');
    const text = document.getElementById('gpsBtnText');
    const feedback = document.getElementById('siteGpsFeedback');

    if (btn) {
      btn.disabled = true;
      btn.classList.add('loading');
    }
    if (icon) icon.textContent = '📡';
    if (text) text.textContent = 'Acquiring GPS location... Please wait';
    if (feedback) {
      feedback.style.display = 'block';
      feedback.className = 'site-gps-feedback';
      feedback.innerHTML = '<span class="spinner"></span> Contacting device GPS & network triangulation...';
    }

    try {
      const pos = await GeoEngine.getCurrentPosition(10000);
      const lat = pos.latitude.toFixed(6);
      const lng = pos.longitude.toFixed(6);
      const accuracy = Math.round(pos.accuracy);

      const latInput = document.getElementById('newSiteLat');
      const lngInput = document.getElementById('newSiteLng');
      if (latInput) latInput.value = lat;
      if (lngInput) lngInput.value = lng;

      if (feedback) {
        feedback.className = 'site-gps-feedback success';
        feedback.innerHTML = `
          <span>✅ <strong>Coordinates Captured!</strong> ${lat}, ${lng} (±${accuracy}m accuracy)</span>
          <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" class="link-preview-map">
            🗺️ Check Spot on Map ↗
          </a>
        `;
      }
      this.showToast(`GPS captured: ${lat}, ${lng} (±${accuracy}m)`, 'success');
    } catch (err) {
      console.warn('GPS capture error:', err);
      if (feedback) {
        feedback.className = 'site-gps-feedback error';
        feedback.innerHTML = `⚠️ <strong>GPS Lock Failed:</strong> ${err.message}`;
      }
      this.showToast(err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('loading');
      }
      if (icon) icon.textContent = '🎯';
      if (text) text.textContent = 'Re-Capture Current Location';
    }
  },

  // Admin Modal & Access Control
  openAdminModal() {
    const modal = document.getElementById('adminAuthModal');
    const input = document.getElementById('adminAuthPassword');
    if (input) input.value = '';
    if (modal) modal.classList.add('open');
    setTimeout(() => { if (input) input.focus(); }, 150);
  },

  closeAdminModal() {
    const modal = document.getElementById('adminAuthModal');
    if (modal) modal.classList.remove('open');
  },

  submitAdminAuth() {
    const input = document.getElementById('adminAuthPassword');
    if (!input) return;
    const pwd = input.value;
    if (ApiService.verifyAdminPassword(pwd)) {
      this.isAdminUnlocked = true;
      try {
        sessionStorage.setItem('contractor_admin_session_unlocked', 'true');
      } catch (e) {}
      this.closeAdminModal();
      this.updateAdminUiState();
      this.switchTab('logs');
      this.showToast('👑 Admin mode unlocked! Full access granted.', 'success');
    } else {
      this.showToast('Incorrect Admin Password. Access denied.', 'error');
      input.value = '';
      input.focus();
    }
  },

  logoutAdmin() {
    this.isAdminUnlocked = false;
    try {
      sessionStorage.removeItem('contractor_admin_session_unlocked');
    } catch (e) {}
    this.updateAdminUiState();
    this.switchTab('punch');
    this.showToast('Admin locked. Returned to worker mode.', 'info');
  },

  updateAdminUiState() {
    const nav = document.getElementById('mainTabNav');
    const banner = document.getElementById('adminModeBanner');
    const btnTrigger = document.getElementById('btnAdminTrigger');

    if (this.isAdminUnlocked) {
      if (nav) nav.style.display = 'grid';
      if (banner) banner.style.display = 'flex';
      if (btnTrigger) {
        btnTrigger.classList.add('active');
        btnTrigger.innerHTML = '<span class="admin-icon-symbol">🔓</span> <span class="admin-btn-label">Unlocked</span>';
      }
    } else {
      if (nav) nav.style.display = 'none';
      if (banner) banner.style.display = 'none';
      if (btnTrigger) {
        btnTrigger.classList.remove('active');
        btnTrigger.innerHTML = '<span class="admin-icon-symbol">🔒</span> <span class="admin-btn-label">Admin</span>';
      }
    }
  },

  setupPasswordToggles() {
    const btnToggleAuth = document.getElementById('btnToggleAdminPw');
    const inputAuth = document.getElementById('adminAuthPassword');
    if (btnToggleAuth && inputAuth) {
      btnToggleAuth.addEventListener('click', () => {
        const isPassword = inputAuth.type === 'password';
        inputAuth.type = isPassword ? 'text' : 'password';
        btnToggleAuth.textContent = isPassword ? '🙈' : '👁️';
      });
    }

    const btnToggleNew = document.getElementById('btnToggleNewPw');
    const inputNew = document.getElementById('settingAdminPassword');
    if (btnToggleNew && inputNew) {
      btnToggleNew.addEventListener('click', () => {
        const isPassword = inputNew.type === 'password';
        inputNew.type = isPassword ? 'text' : 'password';
        btnToggleNew.textContent = isPassword ? '🙈' : '👁️';
      });
    }
  },

  async testWebhookConnection() {
    const webhookInput = document.getElementById('settingWebhookUrl');
    const url = webhookInput ? webhookInput.value.trim() : '';
    if (!url) {
      this.showToast('Please paste your Google Apps Script Web App URL first.', 'warning');
      return;
    }

    const testBtn = document.getElementById('btnTestWebhook');
    if (testBtn) testBtn.textContent = 'Testing connection...';

    try {
      const testPunch = {
        workerName: 'TEST CONNECTION',
        punchType: 'Check-In',
        siteName: 'Test Site',
        isWithinGeofence: true,
        distanceMeters: 0,
        latitude: 12.9716,
        longitude: 77.5946,
        accuracy: 5,
        ipAddress: '127.0.0.1',
        deviceInfo: 'Connection Diagnostic Test',
        notes: 'Testing Google Sheet connection'
      };

      await ApiService.syncPunchToGoogleSheet(testPunch, url);
      this.showToast('✅ Test punch sent! Check your Google Sheet to verify the new row.', 'success');
    } catch (err) {
      this.showToast(`Connection test failed: ${err.message}`, 'error');
    } finally {
      if (testBtn) testBtn.textContent = 'Send Test Punch to Google Sheet';
    }
  },

  showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  },

  // Multi-Device Cloud Sync for Sites, Workers & Logs
  async syncFromCloud(showFeedback = false) {
    if (typeof SupabaseService === 'undefined' || !SupabaseService.isConfigured()) return;

    try {
      // 1. Sync Sites from Supabase
      const cloudSites = await SupabaseService.fetchSites();
      if (cloudSites && cloudSites.length > 0) {
        const localSites = SiteManager.getSites();
        const siteMap = new Map();
        localSites.forEach(s => siteMap.set(s.id, s));
        cloudSites.forEach(s => siteMap.set(s.id, s));
        SiteManager.saveSites(Array.from(siteMap.values()));
        this.loadSites();
        if (this.activeTab === 'sites') this.renderSitesList();
      }

      // 2. Sync Workers from Supabase
      const cloudWorkers = await SupabaseService.fetchWorkers();
      if (cloudWorkers && cloudWorkers.length > 0) {
        const cfg = ApiService.getConfig();
        const workerMap = new Map();
        (cfg.workers || []).forEach(w => workerMap.set(w.id, w));
        cloudWorkers.forEach(w => workerMap.set(w.id, { id: w.id, name: w.name, pin: w.pin || '' }));
        cfg.workers = Array.from(workerMap.values());
        ApiService.saveConfig(cfg);
        this.loadWorkers();
        if (this.activeTab === 'workers') this.renderWorkersList();
      }

      // 3. Sync Attendance Logs from Supabase
      const cloudLogs = await SupabaseService.fetchLogs(150);
      if (cloudLogs && cloudLogs.length > 0) {
        const localLogs = ApiService.getLocalPunches();
        const logMap = new Map();
        cloudLogs.forEach(l => logMap.set(l.id, l));
        localLogs.forEach(l => {
          if (logMap.has(l.id)) {
            const existing = logMap.get(l.id);
            logMap.set(l.id, { ...existing, syncedToSupabase: true });
          } else {
            logMap.set(l.id, l);
          }
        });
        const merged = Array.from(logMap.values()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        localStorage.setItem(ApiService.PUNCHES_STORAGE_KEY, JSON.stringify(merged));
        if (this.activeTab === 'logs') this.renderLogsTable();
      }

      if (showFeedback) {
        this.showToast('✅ Synced latest records from Supabase cloud!', 'success');
      }
    } catch (err) {
      console.warn('Cloud sync error:', err);
      if (showFeedback) {
        this.showToast(`Cloud sync error: ${err.message}`, 'error');
      }
    }
  }
};

window.App = App;

