/**
 * SITES.JS - Dynamic Job Sites & Attendance Point Manager
 */

const SiteManager = {
  STORAGE_KEY: 'contractor_job_sites_v1',
  ACTIVE_SITE_KEY: 'contractor_active_site_id',

  defaultSites: [
    {
      id: 'site_workshop',
      name: 'Main Electrical Workshop',
      lat: 12.9716,
      lng: 77.5946,
      radius: 150,
      description: 'Office, tool inventory and panel fabrication'
    },
    {
      id: 'site_metro',
      name: 'Metro Substation Line 3',
      lat: 12.9352,
      lng: 77.6245,
      radius: 200,
      description: 'High-voltage cable trenching and earthing'
    },
    {
      id: 'site_towers',
      name: 'Sunrise Apartments Project',
      lat: 12.9912,
      lng: 77.5855,
      radius: 120,
      description: '12-floor internal wiring, DB box & conduit installation'
    }
  ],

  getSites() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse stored sites, using defaults', e);
    }
    this.saveSites(this.defaultSites);
    return this.defaultSites;
  },

  saveSites(sites) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(sites));
    } catch (e) {
      console.error('Storage error', e);
    }
  },

  getSiteById(id) {
    const sites = this.getSites();
    return sites.find(s => s.id === id) || sites[0] || this.defaultSites[0];
  },

  getActiveSite() {
    const sites = this.getSites();
    if (!Array.isArray(sites) || sites.length === 0) {
      return this.defaultSites[0];
    }
    const activeId = localStorage.getItem(this.ACTIVE_SITE_KEY);
    if (activeId) {
      const found = sites.find(s => s.id === activeId);
      if (found) return found;
    }
    return sites[0] || this.defaultSites[0];
  },

  setActiveSite(id) {
    try {
      localStorage.setItem(this.ACTIVE_SITE_KEY, id);
    } catch (e) {
      console.warn('Storage setActiveSite error:', e);
    }
  },

  addSite(siteData) {
    const sites = this.getSites();
    const newSite = {
      id: 'site_' + Date.now(),
      name: (siteData.name || 'New Site').trim(),
      lat: parseFloat(siteData.lat),
      lng: parseFloat(siteData.lng),
      radius: parseInt(siteData.radius, 10) || 150,
      description: siteData.description ? siteData.description.trim() : ''
    };
    sites.push(newSite);
    this.saveSites(sites);
    return newSite;
  },

  updateSite(id, updateData) {
    const sites = this.getSites();
    const idx = sites.findIndex(s => s.id === id);
    if (idx !== -1) {
      sites[idx] = {
        ...sites[idx],
        name: updateData.name !== undefined ? updateData.name.trim() : sites[idx].name,
        lat: updateData.lat !== undefined ? parseFloat(updateData.lat) : sites[idx].lat,
        lng: updateData.lng !== undefined ? parseFloat(updateData.lng) : sites[idx].lng,
        radius: updateData.radius !== undefined ? parseInt(updateData.radius, 10) : sites[idx].radius,
        description: updateData.description !== undefined ? updateData.description.trim() : sites[idx].description
      };
      this.saveSites(sites);
      return sites[idx];
    }
    return null;
  },

  deleteSite(id) {
    let sites = this.getSites();
    if (sites.length <= 1) {
      throw new Error('You must keep at least one job site.');
    }
    sites = sites.filter(s => s.id !== id);
    this.saveSites(sites);
    const active = this.getActiveSite();
    if (active && active.id === id) {
      this.setActiveSite(sites[0].id);
    }
    return sites;
  },

  findNearestSite(lat, lng) {
    const sites = this.getSites();
    if (lat === undefined || lng === undefined || sites.length === 0) return null;

    let closest = null;
    let minDistance = Infinity;

    sites.forEach(site => {
      const dist = GeoEngine.calculateDistanceMeters(lat, lng, site.lat, site.lng);
      if (dist < minDistance) {
        minDistance = dist;
        closest = {
          site,
          distanceMeters: Math.round(dist),
          isWithin: dist <= site.radius
        };
      }
    });

    return closest;
  }
};

window.SiteManager = SiteManager;
