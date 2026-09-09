/**
 * SUPABASE.JS - Cloud Database Integration Service
 * Provides PostgreSQL storage for Attendance Logs, Job Sites & Workers.
 * Features automatic failover between Supabase JS SDK and native HTTPS REST fetch.
 */

const SupabaseService = {
  CONFIG_KEY: 'contractor_supabase_config_v1',
  client: null,

  getConfig() {
    try {
      const raw = localStorage.getItem(this.CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('Supabase config parse error:', e);
    }
    return {
      url: '',
      anonKey: '',
      enabled: false
    };
  },

  saveConfig(cfg) {
    localStorage.setItem(this.CONFIG_KEY, JSON.stringify(cfg));
    this.init();
  },

  isConfigured() {
    const cfg = this.getConfig();
    return Boolean(cfg.url && cfg.anonKey && cfg.url.trim().startsWith('http'));
  },

  init() {
    const cfg = this.getConfig();
    if (!this.isConfigured()) {
      this.client = null;
      return false;
    }

    const cleanUrl = cfg.url.trim().replace(/\/+$/, '');
    const cleanKey = cfg.anonKey.trim();

    try {
      if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
        this.client = window.supabase.createClient(cleanUrl, cleanKey);
      } else {
        this.client = null; // Will use direct REST API fallback
      }
      return true;
    } catch (err) {
      console.warn('Supabase client init error:', err);
      this.client = null;
      return false;
    }
  },

  // Helper for REST endpoint fallback
  async restFetch(endpoint, options = {}) {
    const cfg = this.getConfig();
    if (!this.isConfigured()) throw new Error('Supabase is not configured');

    const cleanUrl = cfg.url.trim().replace(/\/+$/, '');
    const cleanKey = cfg.anonKey.trim();

    const headers = {
      'apikey': cleanKey,
      'Authorization': `Bearer ${cleanKey}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {})
    };

    const url = `${cleanUrl}/rest/v1/${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Supabase API ${res.status}: ${errorText || res.statusText}`);
      }

      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await res.json();
      }
      return true;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  },

  async testConnection() {
    if (!this.isConfigured()) {
      return { success: false, message: 'Please enter both Supabase URL and Anon Key.' };
    }

    try {
      // Test querying job_sites with limit 1
      const data = await this.restFetch('job_sites?select=id&limit=1');
      return { success: true, message: 'Connected to Supabase successfully!', data };
    } catch (err) {
      return { 
        success: false, 
        message: `Connection failed: ${err.message}. Ensure you ran supabase/schema.sql in your Supabase SQL Editor!` 
      };
    }
  },

  // ==========================================
  // ATTENDANCE LOGS
  // ==========================================

  async recordPunch(punch) {
    if (!this.isConfigured()) return null;

    const row = {
      id: punch.id || ('p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
      timestamp: punch.timestamp || new Date().toISOString(),
      worker_id: punch.workerId || null,
      worker_name: punch.workerName || 'Unknown',
      punch_type: punch.punchType || 'Clock-In',
      site_id: punch.siteId || null,
      site_name: punch.siteName || 'Unassigned',
      is_within_geofence: Boolean(punch.isWithinGeofence),
      distance_meters: (punch.distanceMeters !== undefined && punch.distanceMeters !== null) ? Math.round(punch.distanceMeters) : null,
      latitude: punch.latitude || null,
      longitude: punch.longitude || null,
      accuracy: punch.accuracy || null,
      ip_address: punch.ipAddress || null,
      device_info: punch.deviceInfo || null,
      notes: punch.notes || null
    };

    try {
      if (this.client) {
        const { data, error } = await this.client.from('attendance_logs').insert([row]);
        if (error) throw error;
        return data;
      } else {
        return await this.restFetch('attendance_logs', {
          method: 'POST',
          body: row
        });
      }
    } catch (err) {
      console.warn('Supabase recordPunch error:', err);
      throw err;
    }
  },

  async fetchLogs(limit = 100) {
    if (!this.isConfigured()) return [];

    try {
      if (this.client) {
        const { data, error } = await this.client
          .from('attendance_logs')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(limit);
        if (error) throw error;
        return data;
      } else {
        return await this.restFetch(`attendance_logs?select=*&order=timestamp.desc&limit=${limit}`);
      }
    } catch (err) {
      console.warn('Supabase fetchLogs error:', err);
      return [];
    }
  },

  // ==========================================
  // SITES SYNC
  // ==========================================

  async fetchSites() {
    if (!this.isConfigured()) return [];

    try {
      if (this.client) {
        const { data, error } = await this.client.from('job_sites').select('*').order('created_at', { ascending: true });
        if (error) throw error;
        return data;
      } else {
        return await this.restFetch('job_sites?select=*&order=created_at.asc');
      }
    } catch (err) {
      console.warn('Supabase fetchSites error:', err);
      return [];
    }
  },

  async saveSite(site) {
    if (!this.isConfigured()) return null;

    const row = {
      id: site.id,
      name: site.name,
      lat: site.lat,
      lng: site.lng,
      radius: site.radius || 150
    };

    try {
      if (this.client) {
        const { data, error } = await this.client.from('job_sites').upsert([row]);
        if (error) throw error;
        return data;
      } else {
        return await this.restFetch('job_sites', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates,return=representation',
          body: row
        });
      }
    } catch (err) {
      console.warn('Supabase saveSite error:', err);
      throw err;
    }
  },

  async deleteSite(siteId) {
    if (!this.isConfigured()) return false;

    try {
      if (this.client) {
        const { error } = await this.client.from('job_sites').delete().eq('id', siteId);
        if (error) throw error;
        return true;
      } else {
        await this.restFetch(`job_sites?id=eq.${encodeURIComponent(siteId)}`, {
          method: 'DELETE'
        });
        return true;
      }
    } catch (err) {
      console.warn('Supabase deleteSite error:', err);
      return false;
    }
  },

  // ==========================================
  // WORKERS SYNC
  // ==========================================

  async fetchWorkers() {
    if (!this.isConfigured()) return [];

    try {
      if (this.client) {
        const { data, error } = await this.client.from('workers').select('*').order('created_at', { ascending: true });
        if (error) throw error;
        return data;
      } else {
        return await this.restFetch('workers?select=*&order=created_at.asc');
      }
    } catch (err) {
      console.warn('Supabase fetchWorkers error:', err);
      return [];
    }
  },

  async saveWorker(worker) {
    if (!this.isConfigured()) return null;

    const row = {
      id: worker.id,
      name: worker.name,
      pin: worker.pin || '1111'
    };

    try {
      if (this.client) {
        const { data, error } = await this.client.from('workers').upsert([row]);
        if (error) throw error;
        return data;
      } else {
        return await this.restFetch('workers', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates,return=representation',
          body: row
        });
      }
    } catch (err) {
      console.warn('Supabase saveWorker error:', err);
      throw err;
    }
  },

  async deleteWorker(workerId) {
    if (!this.isConfigured()) return false;

    try {
      if (this.client) {
        const { error } = await this.client.from('workers').delete().eq('id', workerId);
        if (error) throw error;
        return true;
      } else {
        await this.restFetch(`workers?id=eq.${encodeURIComponent(workerId)}`, {
          method: 'DELETE'
        });
        return true;
      }
    } catch (err) {
      console.warn('Supabase deleteWorker error:', err);
      return false;
    }
  }
};

// Auto-initialize on script load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    SupabaseService.init();
  });
}
