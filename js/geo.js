/**
 * GEO.JS - High Accuracy Geolocation & Geofencing Engine
 */

const GeoEngine = {
  currentPosition: null,
  watchId: null,
  subscribers: [],
  simulatedCoords: null,

  calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return Infinity;
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  checkGeofence(workerLat, workerLng, siteLat, siteLng, radiusMeters) {
    const dist = this.calculateDistanceMeters(workerLat, workerLng, siteLat, siteLng);
    return {
      isWithin: dist <= radiusMeters,
      distanceMeters: Math.round(dist),
      radiusMeters: radiusMeters,
      differenceMeters: Math.round(dist - radiusMeters)
    };
  },

  async getCurrentPosition(timeoutMs = 8000) {
    if (this.simulatedCoords) {
      this.currentPosition = {
        latitude: this.simulatedCoords.lat,
        longitude: this.simulatedCoords.lng,
        accuracy: 5,
        altitude: 0,
        timestamp: Date.now(),
        isSimulated: true
      };
      this.notifySubscribers();
      return this.currentPosition;
    }

    if (!('geolocation' in navigator)) {
      throw new Error('Geolocation is not supported by your browser.');
    }

    const tryGetPos = (options) => {
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
      });
    };

    // First attempt: High Accuracy (GPS hardware)
    try {
      const pos = await tryGetPos({
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 10000
      });
      this.currentPosition = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        timestamp: pos.timestamp,
        isSimulated: false
      };
      this.notifySubscribers();
      return this.currentPosition;
    } catch (firstErr) {
      // If permission was denied by user, fail immediately with clear instructions
      if (firstErr.code === 1) {
        throw new Error('Location permission denied. Please click the padlock/settings icon in your browser address bar and enable Location access.');
      }

      // Second attempt: Fallback to Network/WiFi triangulation (low accuracy, very fast)
      try {
        const fallbackPos = await tryGetPos({
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60000
        });
        this.currentPosition = {
          latitude: fallbackPos.coords.latitude,
          longitude: fallbackPos.coords.longitude,
          accuracy: fallbackPos.coords.accuracy,
          altitude: fallbackPos.coords.altitude,
          timestamp: fallbackPos.timestamp,
          isSimulated: false
        };
        this.notifySubscribers();
        return this.currentPosition;
      } catch (secErr) {
        let msg = 'Unable to capture GPS coordinates.';
        if (secErr.code === 1) msg = 'Location permission denied. Please allow location in your browser settings.';
        else if (secErr.code === 2) msg = 'GPS signal unavailable. Please ensure device Location / GPS is turned ON in system settings.';
        else if (secErr.code === 3) msg = 'GPS request timed out. Please check signal or move near an open window.';
        throw new Error(msg);
      }
    }
  },

  startWatching(onUpdate, onError) {
    if (this.watchId) this.stopWatching();

    if (this.simulatedCoords) {
      this.currentPosition = {
        latitude: this.simulatedCoords.lat,
        longitude: this.simulatedCoords.lng,
        accuracy: 5,
        timestamp: Date.now(),
        isSimulated: true
      };
      if (onUpdate) onUpdate(this.currentPosition);
      this.notifySubscribers();
      return;
    }

    if (!('geolocation' in navigator)) return;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.currentPosition = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          timestamp: pos.timestamp,
          isSimulated: false
        };
        if (onUpdate) onUpdate(this.currentPosition);
        this.notifySubscribers();
      },
      (err) => {
        if (onError) onError(err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 4000,
        timeout: 10000
      }
    );
  },

  stopWatching() {
    if (this.watchId && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  },

  setSimulatedCoords(coords) {
    this.simulatedCoords = coords;
    if (coords) {
      this.currentPosition = {
        latitude: coords.lat,
        longitude: coords.lng,
        accuracy: 5,
        timestamp: Date.now(),
        isSimulated: true
      };
      this.notifySubscribers();
    }
  },

  subscribe(callback) {
    this.subscribers.push(callback);
    if (this.currentPosition) callback(this.currentPosition);
  },

  notifySubscribers() {
    this.subscribers.forEach((cb) => {
      try {
        cb(this.currentPosition);
      } catch (e) {
        console.error(e);
      }
    });
  },

  formatDistance(meters) {
    if (meters === Infinity || meters === null || meters === undefined) return 'Calculating...';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  },

  getMapsLink(lat, lng) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }
};

window.GeoEngine = GeoEngine;
