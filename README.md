# 🚴🏼‍♀️ Bikewatching

DSC 106 Lab 7 — an interactive map of BlueBikes traffic across the Boston area
in March 2024. Built with Mapbox GL JS and D3.

The map shows:
- **Boston + Cambridge bike lanes** (green lines, two open-data GeoJSON sources)
- **BlueBike stations** as circles
  - **Size** = total daily trips at the station (scaled by area, not radius)
  - **Color** = whether riders mostly depart (blue) or arrive (orange) there
- A **time-of-day slider** that filters the data to trips within ±60 minutes of
  the selected time. Trips are pre-bucketed by minute when the CSV loads so
  scrubbing the slider stays smooth even with ~260k trips.

## Setup

The Mapbox access token is already wired into `map.js`. Just open
`index.html` in a browser — no build step.

If you ever rotate your token, replace the `pk.*` string near the top of
`map.js`.

## Publishing

This is a static site. Drop the folder into a GitHub repo (e.g. `bikewatching`),
enable GitHub Pages on `main`, and you're live.

## Files

```
index.html          Page structure, slider, legend, map container
global.css          Page-level styles + the --color CSS variable shared
                    between map circles and the legend swatches
map.css             Map container + SVG-overlay styles (positioning,
                    pointer-events, circle styling)
map.js              All the visualization logic — Mapbox setup, bike-lane
                    layers, station markers, radius/color scales,
                    time-bucketed filtering, slider wiring
assets/favicon.svg  🚴🏼‍♀️ tab icon
```

## Data sources

- BlueBikes station metadata — `https://dsc106.com/labs/lab07/data/bluebikes-stations.json`
- BlueBikes March 2024 trips — `https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv`
- Boston bike network — Boston Open Data ArcGIS
- Cambridge bike facilities — Cambridge GIS GitHub
