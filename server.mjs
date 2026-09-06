import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

const APP_USER_AGENT = process.env.OPENWATER_USER_AGENT || "OpenWater/0.1 (local-development)";
const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = process.env.NOMINATIM_REVERSE_URL || "https://nominatim.openstreetmap.org/reverse";
const OVERPASS_ENDPOINTS = (process.env.OVERPASS_URLS ||
  "https://overpass.private.coffee/api/interpreter,https://overpass-api.de/api/interpreter")
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);

const WATER_CACHE_TTL_MS = 30 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const waterCache = new Map();
const geocodeCache = new Map();
const reverseCache = new Map();
let lastNominatimRequestAt = 0;
let nominatimQueue = Promise.resolve();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 28000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getFresh(cache, key, ttl) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.savedAt > ttl) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCache(cache, key, value) {
  cache.set(key, { savedAt: Date.now(), value });
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function makeShortPlaceLabel(address = {}, displayName = "") {
  const local = address.road || address.neighbourhood || address.suburb || address.quarter || address.hamlet;
  const city = address.city || address.town || address.village || address.municipality || address.county || address.state_district;
  const region = address.state || address.region;
  const country = address.country;

  const parts = [];
  for (const value of [local, city, region, country]) {
    if (value && !parts.includes(value)) parts.push(value);
  }
  return parts.slice(0, 3).join(", ") || displayName;
}

function normalizeWaterElement(el) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const tags = el.tags || {};
  return {
    osmType: el.type,
    osmId: el.id,
    lat,
    lon,
    name: tags.name || tags["name:en"] || tags.operator || "Drinking-water point",
    tags,
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`
  };
}

async function queryOverpass(lat, lon, radiusKm) {
  const radiusMeters = Math.round(radiusKm * 1000);
  const query = `
[out:json][timeout:25];
(
  nwr["amenity"="drinking_water"](around:${radiusMeters},${lat},${lon});
  nwr["drinking_water"="yes"](around:${radiusMeters},${lat},${lon});
);
out center tags;
`.trim();

  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "Accept": "application/json",
          "User-Agent": APP_USER_AGENT
        },
        body: "data=" + encodeURIComponent(query)
      });

      if (!response.ok) {
        throw new Error(`${new URL(endpoint).host} returned HTTP ${response.status}`);
      }

      const payload = await response.json();
      const dedupe = new Map();

      for (const element of payload.elements || []) {
        const point = normalizeWaterElement(element);
        if (!point) continue;
        dedupe.set(`${point.osmType}:${point.osmId}`, point);
      }

      return {
        points: [...dedupe.values()],
        provider: new URL(endpoint).host
      };
    } catch (error) {
      lastError = error;
      console.warn(`[overpass] ${endpoint}: ${error.message}`);
    }
  }

  throw lastError || new Error("All configured Overpass endpoints failed.");
}

async function geocode(query) {
  const key = query.trim().toLowerCase();
  const cached = getFresh(geocodeCache, key, GEOCODE_CACHE_TTL_MS);
  if (cached) return { ...cached, cache: "hit" };

  // Nominatim asks applications to stay at <= 1 request/sec. This queue
  // enforces that across all browser users of this server process.
  const task = nominatimQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (wait) await sleep(wait);
    lastNominatimRequestAt = Date.now();

    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "1",
      addressdetails: "1"
    });

    const response = await fetchWithTimeout(`${NOMINATIM_URL}?${params}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": APP_USER_AGENT
      }
    }, 15000);

    if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}`);

    const results = await response.json();
    if (!results.length) throw new Error("Place not found.");

    const r = results[0];
    const rawBBox = Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : [];
    const value = {
      lat: Number(r.lat),
      lon: Number(r.lon),
      displayName: r.display_name,
      shortName: makeShortPlaceLabel(r.address || {}, r.display_name),
      bbox: rawBBox.length === 4
        ? [rawBBox[0], rawBBox[2], rawBBox[1], rawBBox[3]]
        : null,
      cache: "miss"
    };
    setCache(geocodeCache, key, value);
    return value;
  });

  nominatimQueue = task.catch(() => {});
  return task;
}

async function reverseGeocode(lat, lon) {
  const key = `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
  const cached = getFresh(reverseCache, key, GEOCODE_CACHE_TTL_MS);
  if (cached) return { ...cached, cache: "hit" };

  const task = nominatimQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (wait) await sleep(wait);
    lastNominatimRequestAt = Date.now();

    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: "jsonv2",
      zoom: "18",
      addressdetails: "1"
    });

    const response = await fetchWithTimeout(`${NOMINATIM_REVERSE_URL}?${params}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": APP_USER_AGENT
      }
    }, 15000);

    if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}`);

    const r = await response.json();
    if (!r || !r.display_name) throw new Error("Current address not found.");

    const value = {
      lat: Number(r.lat ?? lat),
      lon: Number(r.lon ?? lon),
      displayName: r.display_name,
      shortName: makeShortPlaceLabel(r.address || {}, r.display_name),
      cache: "miss"
    };
    setCache(reverseCache, key, value);
    return value;
  });

  nominatimQueue = task.catch(() => {});
  return task;
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health") {
    return json(res, 200, { ok: true, service: "OpenWater", time: new Date().toISOString() });
  }

  if (url.pathname === "/api/geocode") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q || q.length > 160) return json(res, 400, { error: "Enter a valid place search." });

    try {
      const place = await geocode(q);
      return json(res, 200, place);
    } catch (error) {
      console.error("[geocode]", error);
      return json(res, 502, { error: error.message || "Place search failed." });
    }
  }

  if (url.pathname === "/api/reverse") {
    const lat = clampNumber(url.searchParams.get("lat"), -90, 90);
    const lon = clampNumber(url.searchParams.get("lon"), -180, 180);
    if (lat === null || lon === null) return json(res, 400, { error: "Invalid lat/lon." });

    try {
      const place = await reverseGeocode(lat, lon);
      return json(res, 200, place);
    } catch (error) {
      console.error("[reverse]", error);
      return json(res, 502, { error: error.message || "Current address lookup failed." });
    }
  }

  if (url.pathname === "/api/water") {
    const lat = clampNumber(url.searchParams.get("lat"), -90, 90);
    const lon = clampNumber(url.searchParams.get("lon"), -180, 180);
    const radiusKm = clampNumber(url.searchParams.get("radiusKm") || 12, 1, 25);
    const force = url.searchParams.get("force") === "1";

    if (lat === null || lon === null || radiusKm === null) {
      return json(res, 400, { error: "Invalid lat/lon/radiusKm." });
    }

    const key = `${lat.toFixed(3)},${lon.toFixed(3)},${radiusKm.toFixed(1)}`;
    if (!force) {
      const cached = getFresh(waterCache, key, WATER_CACHE_TTL_MS);
      if (cached) return json(res, 200, { ...cached, cache: "hit" });
    }

    try {
      const result = await queryOverpass(lat, lon, radiusKm);
      const payload = {
        ...result,
        center: { lat, lon },
        radiusKm,
        fetchedAt: new Date().toISOString(),
        cache: "miss"
      };
      setCache(waterCache, key, payload);
      return json(res, 200, payload);
    } catch (error) {
      console.error("[water]", error);
      return json(res, 502, {
        error: "OpenStreetMap data providers are temporarily unavailable. Try again shortly."
      });
    }
  }

  return json(res, 404, { error: "API route not found." });
}

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const fullPath = path.resolve(PUBLIC_DIR, "." + requested);
  if (!fullPath.startsWith(PUBLIC_DIR + path.sep) && fullPath !== path.join(PUBLIC_DIR, "index.html")) {
    return null;
  }
  return fullPath;
}

async function serveStatic(res, urlPath) {
  const fullPath = safePublicPath(urlPath);
  if (!fullPath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }

  try {
    const info = await stat(fullPath);
    if (!info.isFile()) throw new Error("not-file");
    const content = await readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }

    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error("[server]", error);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OpenWater running at http://${HOST}:${PORT}`);
  console.log(`User-Agent: ${APP_USER_AGENT}`);
  console.log("Tip: set OPENWATER_USER_AGENT to identify your public deployment.");
});
