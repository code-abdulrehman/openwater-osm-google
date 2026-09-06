import { useEffect } from "react";

const shell = `
  <main id="app" class="map-app">
    <div id="map" aria-label="Map showing nearby drinking-water points"></div>
    <div class="map-topbar">
      <form id="searchForm" class="map-search" autocomplete="off">
        <span class="search-brand" aria-hidden="true">💧</span>
        <label class="sr-only" for="placeSearch">Search city or place</label>
        <input id="placeSearch" type="search" placeholder="Search a city or place" />
        <button id="searchButton" type="submit" class="search-action" aria-label="Search">⌕</button>
      </form>
      <div id="statusPill" class="status-pill" role="status" aria-live="polite"><span id="statusText">Loading water points…</span></div>
    </div>
    <button id="locateButton" class="map-fab locate-fab" type="button" title="Use my current location" aria-label="Use my current location">◎</button>
    <button id="refreshButton" class="search-area-button" type="button">Search this area</button>
    <section id="resultsPanel" class="results-panel" aria-label="Nearby drinking-water points">
      <div class="results-summary"><div><div class="results-title-row"><span class="water-mini" aria-hidden="true">💧</span><strong id="resultCount">0 water points</strong></div><span id="nearestStat" class="results-subtitle">Looking nearby…</span></div><button id="toggleResults" type="button" class="results-toggle" aria-expanded="true" aria-label="Toggle nearby list">⌃</button></div>
      <div id="results" class="results-list"><div class="empty-result">Loading nearby OpenStreetMap data…</div></div>
    </section>
    <div class="map-note">OpenStreetMap data · Community maintained</div>
  </main>`;

export default function App() {
  useEffect(() => {
    document.getElementById("root").insertAdjacentHTML("beforeend", shell);
    const script = document.createElement("script");
    script.src = "/app.js";
    script.defer = true;
    document.body.appendChild(script);
    return () => script.remove();
  }, []);

  return null;
}
