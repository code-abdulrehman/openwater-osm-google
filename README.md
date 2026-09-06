# OpenWater v0.1 — Google-style OpenStreetMap water finder

A simple full-screen map web app built with HTML, Tailwind CSS, vanilla JavaScript, Leaflet and OpenStreetMap data.

## What changed in v0.1

- Full-screen map (`100dvh`) instead of a dashboard layout
- Floating Google Maps-style search bar
- Browser current-location button
- Reverse geocoding: after GPS succeeds, the search bar shows a readable current area/address
- Google Maps-style blue current-location dot with an accuracy circle
- Proper SVG water map-pin markers instead of emoji-only markers
- Compact collapsible nearby-results card
- “Search this area” button after dragging/zooming the map
- Multiple `map.invalidateSize()` calls to prevent partially rendered Leaflet tiles
- Same-origin Node proxy for Overpass and Nominatim requests

## Run

Do **not** double-click `index.html`.

```bash
npm start
```

Open:

```text
http://localhost:3000
```

For browser geolocation, use `localhost` during development or HTTPS in production.

## Tailwind

A compiled `public/styles.css` is included, so the app runs immediately without installing dependencies.

If you edit Tailwind classes or `src/input.css`, install dependencies and rebuild:

```bash
npm install
npm run build:css
```

## Data flow

```text
Browser
  -> /api/water
  -> Node server
  -> Overpass API
  -> OpenStreetMap water points

Browser current GPS
  -> /api/reverse
  -> Node server
  -> Nominatim reverse geocoding
  -> readable address shown in search bar
```

The app queries OSM objects tagged `amenity=drinking_water` or `drinking_water=yes`.

## Important

OpenStreetMap is community-maintained. Missing data does not prove there is no water facility in the real world. Keep OSM attribution visible and follow the usage policies of OSM public services before deploying at meaningful scale.
