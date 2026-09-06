import { useEffect } from "react";

const shell = `
  <main id="app" class="map-app">
    <div id="map" aria-label="Map showing nearby drinking-water points"></div>
    <div class="map-topbar">
      <form id="searchForm" class="map-search" autocomplete="off">
        <span class="search-brand" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2.4c-2.9 4-5.8 7.4-5.8 11A5.8 5.8 0 0 0 12 19.2a5.8 5.8 0 0 0 5.8-5.8c0-3.6-2.9-7-5.8-11Z" fill="currentColor"/><path d="M9.1 14.1c.45 1.2 1.46 1.9 2.75 2.02" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg></span>
        <label class="sr-only" for="placeSearch">Search city or place</label>
        <input id="placeSearch" type="search" placeholder="Search a city or place" />
        <button id="searchButton" type="submit" class="search-action" aria-label="Search"><svg viewBox="0 0 24 24" width="21" height="21" fill="none"><circle cx="10.8" cy="10.8" r="6.4" stroke="currentColor" stroke-width="2"/><path d="m15.6 15.6 4.2 4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      </form>
      <div id="statusPill" class="status-pill" role="status" aria-live="polite"><span id="statusText">Loading water points…</span></div>
    </div>
    <button id="locateButton" class="map-fab locate-fab" type="button" title="Use my current location" aria-label="Use my current location"><svg viewBox="0 0 24 24" width="23" height="23" fill="none"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2"/><path d="M12 2V5M12 19V22M2 12H5M19 12H22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    <button id="refreshButton" class="search-area-button" type="button">Search this area</button>
    <section id="resultsPanel" class="results-panel" aria-label="Nearby drinking-water points">
      <div class="results-summary"><div><div class="results-title-row"><span class="water-mini" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2.4c-2.9 4-5.8 7.4-5.8 11A5.8 5.8 0 0 0 12 19.2a5.8 5.8 0 0 0 5.8-5.8c0-3.6-2.9-7-5.8-11Z" fill="currentColor"/></svg></span><strong id="resultCount">0 water points</strong></div><span id="nearestStat" class="results-subtitle">Looking nearby…</span></div><button id="toggleResults" type="button" class="results-toggle" aria-expanded="true" aria-label="Toggle nearby list"><svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="m7 14 5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
      <div id="results" class="results-list"><div class="empty-result">Loading nearby OpenStreetMap data…</div></div>
      <footer class="site-footer"><span>Want your water point listed?</span><a href="https://imabdulrehman.site" target="_blank" rel="noreferrer">@abdulrehman</a></footer>
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
