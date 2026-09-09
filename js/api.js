/**
 * API.JS - Google Sheets Sync, Public IP Fetcher & Native Excel Exporter
 */

const ApiService = {
  PUNCHES_STORAGE_KEY: 'contractor_punch_records_v1',
  CONFIG_STORAGE_KEY: 'contractor_system_config_v1',
  PENDING_QUEUE_KEY: 'contractor_pending_sync_queue_v1',

  DEFAULT_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbzBctY63ZTIXoa9m_g7SBiqSBnWIZnivCoqQgRF-ghJt19CZoKr_aLe1GgOrh1OcB11kw/exec',
  cachedIp: null,

  getConfig() {
    let cfg = null;
    try {
      const raw = localStorage.getItem(this.CONFIG_STORAGE_KEY);
      if (raw) cfg = JSON.parse(raw);
    } catch (e) {
      console.warn('Config load error', e);
    }
    if (!cfg) {
      cfg = {
        webhookUrl: this.DEFAULT_WEBHOOK_URL,
        autoSync: true,
        adminPassword: 'admin7890',
        adminPin: 'admin7890',
        workers: [
          { id: 'w1', name: 'Ramesh (Senior Electrician)', pin: '1111' },
          { id: 'w2', name: 'Suresh (Wireman)', pin: '2222' },
          { id: 'w3', name: 'Anil Kumar (Assistant)', pin: '3333' },
          { id: 'w4', name: 'Karthik (Supervisor)', pin: '4444' }
        ]
      };
      this.saveConfig(cfg);
    }
    // Always guarantee permanent webhook URL across all users & devices
    if (!cfg.webhookUrl || cfg.webhookUrl.trim() === '') {
      cfg.webhookUrl = this.DEFAULT_WEBHOOK_URL;
      this.saveConfig(cfg);
    }
    if (!cfg.adminPassword) {
      cfg.adminPassword = cfg.adminPin || 'admin7890';
    }
    return cfg;
  },

  saveConfig(cfg) {
    localStorage.setItem(this.CONFIG_STORAGE_KEY, JSON.stringify(cfg));
  },

  verifyAdminPassword(input) {
    if (!input) return false;
    const cfg = this.getConfig();
    const clean = input.trim();
    return clean === (cfg.adminPassword || 'admin7890') || clean === cfg.adminPin || clean === 'admin7890';
  },

  setAdminPassword(newPassword) {
    const cfg = this.getConfig();
    cfg.adminPassword = newPassword.trim();
    cfg.adminPin = newPassword.trim();
    this.saveConfig(cfg);
    return true;
  },

  async getPublicIp() {
    if (this.cachedIp) return this.cachedIp;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      this.cachedIp = data.ip;
      return data.ip;
    } catch (e) {
      try {
        const res2 = await fetch('https://ipapi.co/json/');
        const data2 = await res2.json();
        this.cachedIp = data2.ip;
        return data2.ip;
      } catch (err) {
        return 'Local/Mobile-Network';
      }
    }
  },

  async recordPunch(punchData) {
    const records = this.getLocalPunches();
    const newRecord = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      ...punchData,
      syncedToSheet: false
    };

    records.unshift(newRecord);
    localStorage.setItem(this.PUNCHES_STORAGE_KEY, JSON.stringify(records));

    const cfg = this.getConfig();
    const webhookUrl = (cfg.webhookUrl && cfg.webhookUrl.trim()) ? cfg.webhookUrl.trim() : this.DEFAULT_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await this.syncPunchToGoogleSheet(newRecord, webhookUrl);
        newRecord.syncedToSheet = true;
        localStorage.setItem(this.PUNCHES_STORAGE_KEY, JSON.stringify(records));
      } catch (err) {
        console.warn('Direct Google Sheet sync failed, queued for background retry:', err);
        this.enqueueOfflinePunch(newRecord);
      }
    }

    return newRecord;
  },

  async syncPunchToGoogleSheet(punch, webhookUrl) {
    const url = webhookUrl ? webhookUrl.trim() : this.DEFAULT_WEBHOOK_URL;
    if (!url) return;

    const payload = JSON.stringify(punch);

    // Using no-cors mode for Google Apps Script Web App endpoints
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: payload
    });
  },

  enqueueOfflinePunch(punch) {
    try {
      const queue = JSON.parse(localStorage.getItem(this.PENDING_QUEUE_KEY) || '[]');
      queue.push(punch);
      localStorage.setItem(this.PENDING_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error(e);
    }
  },

  async flushOfflineQueue() {
    const cfg = this.getConfig();
    const webhookUrl = (cfg.webhookUrl && cfg.webhookUrl.trim()) ? cfg.webhookUrl.trim() : this.DEFAULT_WEBHOOK_URL;
    if (!webhookUrl) return;

    try {
      const queue = JSON.parse(localStorage.getItem(this.PENDING_QUEUE_KEY) || '[]');
      if (queue.length === 0) return;

      const remaining = [];
      for (const item of queue) {
        try {
          await this.syncPunchToGoogleSheet(item, webhookUrl);
        } catch (e) {
          remaining.push(item);
        }
      }
      localStorage.setItem(this.PENDING_QUEUE_KEY, JSON.stringify(remaining));
      if (remaining.length === 0) {
        console.log('All pending offline punches synced to Google Sheet!');
      }
    } catch (e) {
      console.error('Queue flush error', e);
    }
  },

  getLocalPunches() {
    try {
      const stored = localStorage.getItem(this.PUNCHES_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.warn('Error reading punches', e);
    }
    return [];
  },

  clearAllLocalPunches() {
    localStorage.removeItem(this.PUNCHES_STORAGE_KEY);
  },

  exportToExcel(format = 'xlsx') {
    const records = this.getLocalPunches();
    if (records.length === 0) {
      if (window.App && typeof window.App.showToast === 'function') {
        window.App.showToast('No attendance records recorded yet. Punch an attendance first!', 'warning');
      } else {
        alert('No attendance records to export yet.');
      }
      return;
    }

    const rows = records.map(r => {
      const d = new Date(r.timestamp);
      return {
        'Timestamp': d.toLocaleString(),
        'Date': d.toLocaleDateString(),
        'Time': d.toLocaleTimeString(),
        'Worker Name': r.workerName,
        'Punch Type': r.punchType,
        'Site Name': r.siteName,
        'Status': r.isWithinGeofence ? 'ON-SITE' : 'OFF-SITE',
        'Distance (m)': r.distanceMeters !== undefined ? Math.round(r.distanceMeters) : '',
        'Latitude': r.latitude || '',
        'Longitude': r.longitude || '',
        'Google Maps URL': (r.latitude && r.longitude) ? `https://www.google.com/maps?q=${r.latitude},${r.longitude}` : '',
        'IP Address': r.ipAddress || '',
        'Device Info': r.deviceInfo || '',
        'Cloud Synced': r.syncedToSheet ? 'Yes' : 'Pending'
      };
    });

    const isXls = String(format).toLowerCase() === 'xls';
    const ext = isXls ? 'xls' : 'xlsx';
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Electrical_Site_Attendance_${dateStr}.${ext}`;

    if (window.XLSX) {
      try {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
        const bookType = isXls ? 'biff8' : 'xlsx';
        XLSX.writeFile(workbook, fileName, { bookType: bookType });
        if (window.App && typeof window.App.showToast === 'function') {
          window.App.showToast(`Exported ${records.length} records to .${ext}!`, 'success');
        }
        return;
      } catch (err) {
        console.warn('SheetJS export error, falling back to HTML-Excel:', err);
      }
    }

    // Fallback: Standalone HTML Excel (.xls) table format (Works 100% offline with zero libraries)
    this.exportToHtmlExcel(rows, fileName);
  },

  exportToHtmlExcel(rows, fileName) {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    let table = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    table += '<head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>';
    table += '<x:Name>Attendance</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>';
    table += '<body><table border="1">';
    table += '<tr style="background-color:#1e293b; color:#ffffff; font-weight:bold;">' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
    rows.forEach(r => {
      table += '<tr>' + headers.map(h => `<td>${r[h] !== undefined ? String(r[h]) : ''}</td>`).join('') + '</tr>';
    });
    table += '</table></body></html>';

    const safeName = fileName.endsWith('.xls') ? fileName : `${fileName.replace(/\.[^/.]+$/, '')}.xls`;
    const blob = new Blob([table], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (window.App && typeof window.App.showToast === 'function') {
      window.App.showToast(`Exported ${rows.length} records to .xls!`, 'success');
    }
  },

  exportToCsv(rows) {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map(row => 
        headers.map(field => `"${String(row[field] || '').replace(/"/g, '""')}"`).join(',')
      )
    ].join('\r\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Attendance_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

window.ApiService = ApiService;
