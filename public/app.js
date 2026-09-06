(() => {
  "use strict";

  const CONFIG = {
    apiBase: "/api",
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    defaultCenter: [51.5074, -0.1278],
    defaultZoom: 13,
    defaultRadiusKm: 8,
    currentLocationZoom: 15,
    maxRadiusKm: 25,
    resultsLimit: 12
  };

  const ui = {
    searchForm: document.querySelector("#searchForm"),
    searchInput: document.querySelector("#placeSearch"),
    searchButton: document.querySelector("#searchButton"),
    locateButton: document.querySelector("#locateButton"),
    refreshButton: document.querySelector("#refreshButton"),
    statusPill: document.querySelector("#statusPill"),
    status: document.querySelector("#statusText"),
    resultsPanel: document.querySelector("#resultsPanel"),
    results: document.querySelector("#results"),
    resultCount: document.querySelector("#resultCount"),
    nearest: document.querySelector("#nearestStat"),
    toggleResults: document.querySelector("#toggleResults")
  };

  if (window.location.protocol === "file:") {
    document.body.innerHTML = `
      <main style="font-family:system-ui;padding:32px;max-width:680px;margin:auto">
        <h1>OpenWater needs a local web server</h1>
        <p>Run <code>npm start</code> from the project folder, then open <code>http://localhost:3000</code>.</p>
      </main>`;
    return;
  }

  if (typeof L === "undefined") {
    document.body.innerHTML = `<p style="font-family:system-ui;padding:24px">Leaflet failed to load. Check your internet connection.</p>`;
    return;
  }

  const map = L.map("map", {
    zoomControl: true,
    preferCanvas: true,
    attributionControl: true
  }).setView(CONFIG.defaultCenter, CONFIG.defaultZoom);

  const tileLayer = L.tileLayer(CONFIG.tileUrl, {
    maxZoom: 19,
    minZoom: 3,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'
  }).addTo(map);

  tileLayer.on("tileerror", () => {
    setStatus("Some map tiles could not load. Check your connection.", "error", 4500);
  });

  const waterLayer = L.layerGroup().addTo(map);
  const originLayer = L.layerGroup().addTo(map);

  let origin = { lat: CONFIG.defaultCenter[0], lon: CONFIG.defaultCenter[1], label: "London, United Kingdom" };
  let currentPoints = [];
  let currentRadiusKm = CONFIG.defaultRadiusKm;
  let suppressMovePrompt = false;
  let statusTimer = null;

  const currentLocationIcon = L.divIcon({
    className: "current-location-wrap",
    html: '<div class="current-location-dot" aria-hidden="true"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  const searchLocationIcon = L.divIcon({
    className: "current-location-wrap",
    html: '<div class="search-location-dot" aria-hidden="true"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  const waterIcon = L.divIcon({
    className: "water-pin-wrap",
    html: `
      <div class="water-pin" aria-hidden="true">
        <svg viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 1.5C9.2 1.5 2 8.5 2 17.2c0 11.3 14.3 24.2 15 24.9a1.45 1.45 0 0 0 2 0c.7-.7 15-13.6 15-24.9C34 8.5 26.8 1.5 18 1.5Z" fill="#0284c7" stroke="#fff" stroke-width="2"/>
          <path d="M18 9.2c-2.7 3.6-5.2 6.4-5.2 9.4a5.2 5.2 0 1 0 10.4 0c0-3-2.5-5.8-5.2-9.4Z" fill="#fff"/>
        </svg>
      </div>`,
    iconSize: [36, 44],
    iconAnchor: [18, 43],
    popupAnchor: [0, -38]
  });

  function setStatus(message, kind = "normal", autoHideMs = 0) {
    if (statusTimer) clearTimeout(statusTimer);
    ui.status.textContent = message;
    ui.statusPill.classList.remove("is-success", "is-error", "is-hidden");
    if (kind === "success") ui.statusPill.classList.add("is-success");
    if (kind === "error") ui.statusPill.classList.add("is-error");
    if (autoHideMs) {
      statusTimer = setTimeout(() => ui.statusPill.classList.add("is-hidden"), autoHideMs);
    }
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[ch]));
  }

  function toRad(v) { return v * Math.PI / 180; }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(km) {
    if (!Number.isFinite(km)) return "—";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(km < 10 ? 1 : 0)} km`;
  }

  function estimateRadiusFromBoundingBox(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return CONFIG.defaultRadiusKm;
    const [south, west, north, east] = bbox.map(Number);
    const centerLat = (south + north) / 2;
    const northSouth = Math.abs(north - south) * 111;
    const eastWest = Math.abs(east - west) * 111 * Math.max(Math.cos(toRad(centerLat)), 0.2);
    const halfSpan = Math.max(northSouth, eastWest) / 2;
    return Math.max(4, Math.min(CONFIG.maxRadiusKm, Math.ceil(halfSpan + 2)));
  }

  function setOrigin(lat, lon, label, accuracyMeters = null, isCurrentLocation = false) {
    origin = { lat: Number(lat), lon: Number(lon), label };
    originLayer.clearLayers();

    if (isCurrentLocation && Number.isFinite(accuracyMeters) && accuracyMeters > 0) {
      L.circle([origin.lat, origin.lon], {
        radius: Math.min(accuracyMeters, 1000),
        color: "#4285f4",
        weight: 1,
        opacity: .35,
        fillColor: "#4285f4",
        fillOpacity: .08,
        interactive: false
      }).addTo(originLayer);
    }

    L.marker([origin.lat, origin.lon], {
      icon: isCurrentLocation ? currentLocationIcon : searchLocationIcon,
      zIndexOffset: 1000,
      keyboard: false
    }).addTo(originLayer).bindPopup(`<strong>${escapeHtml(label)}</strong>`);
  }

  function fixMapSize() {
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    setTimeout(() => map.invalidateSize({ pan: false }), 120);
    setTimeout(() => map.invalidateSize({ pan: false }), 450);
  }

  async function apiJson(url) {
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error || `Request failed with HTTP ${response.status}`);
    if (!body) throw new Error("The API returned an empty response. Please try again.");
    return body;
  }

  function fetchWaterPoints(lat, lon, radiusKm, force = false) {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radiusKm: String(radiusKm), force: force ? "1" : "0" });
    return apiJson(`${CONFIG.apiBase}/water?${params}`);
  }

  function geocodePlace(query) {
    const normalized = query.trim();
    if (!normalized) throw new Error("Enter a city or place.");
    return apiJson(`${CONFIG.apiBase}/geocode?q=${encodeURIComponent(normalized)}`);
  }

  function reverseGeocode(lat, lon) {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    return apiJson(`${CONFIG.apiBase}/reverse?${params}`);
  }

  function renderPoints(points) {
    currentPoints = points
      .map(p => ({ ...p, distanceKm: distanceKm(origin.lat, origin.lon, p.lat, p.lon) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);

    waterLayer.clearLayers();

    currentPoints.forEach((p, index) => {
      const potableText = p.tags?.drinking_water === "yes"
        ? "Explicitly tagged drinking_water=yes"
        : "Tagged amenity=drinking_water";

      const popup = `
        <div style="min-width:220px;font-family:system-ui,sans-serif">
          <div style="display:flex;gap:10px;align-items:flex-start">
            <div style="font-size:20px;color:#0284c7" aria-hidden="true">◆</div>
            <div style="min-width:0">
              <div style="font-weight:750;font-size:14px;color:#0f172a">${escapeHtml(p.name)}</div>
              <div style="margin-top:4px;color:#475569;font-size:12px">${formatDistance(p.distanceKm)} away</div>
            </div>
          </div>
          <div style="margin-top:10px;font-size:11px;color:#64748b">${potableText}</div>
          <a href="${p.osmUrl}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:10px;color:#0369a1;font-size:12px;font-weight:700;text-decoration:none">View on OpenStreetMap ↗</a>
        </div>`;

      const marker = L.marker([p.lat, p.lon], {
        icon: waterIcon,
        riseOnHover: true,
        title: p.name
      }).addTo(waterLayer).bindPopup(popup);

      p._marker = marker;
      p._rank = index + 1;
    });

    const count = currentPoints.length;
    ui.resultCount.textContent = `${count} water point${count === 1 ? "" : "s"}`;
    ui.nearest.textContent = count ? `Nearest ${formatDistance(currentPoints[0].distanceKm)} away` : "No tagged points nearby";

    if (!count) {
      ui.results.innerHTML = `<div class="empty-result">No tagged drinking-water points were found here. OpenStreetMap may be incomplete for this area.</div>`;
      return;
    }

    ui.results.innerHTML = currentPoints.slice(0, CONFIG.resultsLimit).map((p, i) => `
      <button type="button" class="result-item" data-point-index="${i}">
        <span class="result-icon" aria-hidden="true">◆</span>
        <span class="result-copy">
          <span class="result-name">${escapeHtml(p.name)}</span>
          <span class="result-meta">${formatDistance(p.distanceKm)} · ${p.tags?.drinking_water === "yes" ? "potable tag" : "water point"}</span>
        </span>
        <span class="result-chevron">›</span>
      </button>
    `).join("");

    ui.results.querySelectorAll("[data-point-index]").forEach(button => {
      button.addEventListener("click", () => {
        const p = currentPoints[Number(button.dataset.pointIndex)];
        suppressMovePrompt = true;
        map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 17), { duration: .45 });
        setTimeout(() => { suppressMovePrompt = false; }, 600);
        p._marker?.openPopup();
      });
    });
  }

  async function loadArea(lat, lon, radiusKm = CONFIG.defaultRadiusKm, { force = false, zoom = null } = {}) {
    try {
      currentRadiusKm = Math.max(1, Math.min(CONFIG.maxRadiusKm, Number(radiusKm) || CONFIG.defaultRadiusKm));
      setStatus("Finding nearby drinking-water points…");
      ui.refreshButton.classList.remove("is-visible");
      ui.searchButton.disabled = true;

      const payload = await fetchWaterPoints(lat, lon, currentRadiusKm, force);
      renderPoints(payload?.points || []);

      suppressMovePrompt = true;
      map.setView([lat, lon], zoom ?? map.getZoom(), { animate: true });
      setTimeout(() => { suppressMovePrompt = false; }, 450);
      fixMapSize();

      const count = (payload?.points || []).length;
      setStatus(`${count} water point${count === 1 ? "" : "s"} found nearby`, "success", 2600);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not load OpenStreetMap data.", "error", 5000);
      ui.resultCount.textContent = "Water points unavailable";
      ui.nearest.textContent = "Try Search this area again";
      ui.results.innerHTML = `<div class="empty-result">${escapeHtml(error.message || "OpenStreetMap data request failed.")}</div>`;
    } finally {
      ui.searchButton.disabled = false;
    }
  }

  ui.searchForm.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      ui.searchButton.disabled = true;
      setStatus("Finding place…");
      const place = await geocodePlace(ui.searchInput.value);
      currentRadiusKm = estimateRadiusFromBoundingBox(place.bbox);
      setOrigin(place.lat, place.lon, place.displayName);
      ui.searchInput.value = place.shortName || ui.searchInput.value.trim() || place.displayName;
      suppressMovePrompt = true;
      map.setView([place.lat, place.lon], CONFIG.defaultZoom);
      setTimeout(() => { suppressMovePrompt = false; }, 450);
      await loadArea(place.lat, place.lon, currentRadiusKm, { zoom: CONFIG.defaultZoom });
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Place search failed.", "error", 4500);
    } finally {
      ui.searchButton.disabled = false;
    }
  });

  ui.locateButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation is not supported by this browser.", "error", 4500);
      return;
    }

    ui.locateButton.disabled = true;
    ui.searchInput.value = "Locating…";
    setStatus("Getting your current location…");

    navigator.geolocation.getCurrentPosition(
      async position => {
        const { latitude, longitude, accuracy } = position.coords;
        currentRadiusKm = CONFIG.defaultRadiusKm;
        setOrigin(latitude, longitude, "Current location", accuracy, true);

        suppressMovePrompt = true;
        map.setView([latitude, longitude], CONFIG.currentLocationZoom);
        setTimeout(() => { suppressMovePrompt = false; }, 450);
        fixMapSize();

        const reversePromise = reverseGeocode(latitude, longitude)
          .then(place => {
            const readable = place.shortName || place.displayName;
            ui.searchInput.value = readable ? `Current location · ${readable}` : "Current location";
            origin.label = ui.searchInput.value;
          })
          .catch(() => {
            ui.searchInput.value = "Current location";
          });

        await loadArea(latitude, longitude, currentRadiusKm, { zoom: CONFIG.currentLocationZoom });
        await reversePromise;
        ui.locateButton.disabled = false;
      },
      error => {
        ui.searchInput.value = "";
        setStatus(
          error.code === 1
            ? "Location permission denied. Search a city instead."
            : "Could not get your current location.",
          "error",
          5000
        );
        ui.locateButton.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });

  ui.refreshButton.addEventListener("click", async () => {
    const center = map.getCenter();
    setOrigin(center.lat, center.lng, "Map center");
    ui.searchInput.value = "Selected map area";
    await loadArea(center.lat, center.lng, currentRadiusKm, { force: true, zoom: map.getZoom() });
  });

  ui.toggleResults.addEventListener("click", () => {
    const collapsed = ui.resultsPanel.classList.toggle("is-collapsed");
    ui.toggleResults.setAttribute("aria-expanded", String(!collapsed));
  });

  map.on("dragstart zoomstart", () => {
    if (!suppressMovePrompt) ui.refreshButton.classList.add("is-visible");
  });

  window.addEventListener("resize", fixMapSize);
  window.addEventListener("orientationchange", () => setTimeout(fixMapSize, 200));
  window.addEventListener("load", fixMapSize);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) fixMapSize();
  });

  async function boot() {
    ui.searchInput.value = "London, United Kingdom";
    setOrigin(CONFIG.defaultCenter[0], CONFIG.defaultCenter[1], "London, United Kingdom");
    fixMapSize();
    await loadArea(CONFIG.defaultCenter[0], CONFIG.defaultCenter[1], CONFIG.defaultRadiusKm, { zoom: CONFIG.defaultZoom });
  }

  boot();
})();
