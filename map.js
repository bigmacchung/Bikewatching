// =====================================================================
// Bikewatching — DSC 106 Lab 7
//
// Visualizes BlueBikes station traffic on a Mapbox map of the Boston
// area. Builds steps 1–6 of the lab in a single module:
//
//   1. Mapbox map with custom style
//   2. Boston + Cambridge bike-lane layers (GeoJSON sources)
//   3. SVG overlay with station markers, kept in sync with the map
//      through map.project() and the move/zoom/resize/moveend events
//   4. Circles sized by total traffic (scaleSqrt so AREA, not radius,
//      encodes the value) with native <title> tooltips
//   5. Time-of-day slider with minute-bucketed trips for fast filtering
//   6. Color = ratio of departures to total traffic (scaleQuantize +
//      a per-circle --departure-ratio CSS variable, mixed into --color
//      in CSS so legend swatches use the exact same logic)
// =====================================================================

import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// ---------------------------------------------------------------------
// Mapbox access token
//
// IMPORTANT — replace this with your own public access token.
// Get yours at https://account.mapbox.com/access-tokens/ (starts with `pk.`)
// ---------------------------------------------------------------------
mapboxgl.accessToken = 'pk.eyJ1IjoibWFjMDUwIiwiYSI6ImNtcDZ6d3B6bTAxam8ycXB4NmhjeHI2c3EifQ.Q5Az7Am5Qocn0xMFZzJ6Sw';

// Sanity-check that JS is wired up at all
console.log('Mapbox GL JS Loaded:', mapboxgl);

// ---------------------------------------------------------------------
// Initialize the map
// ---------------------------------------------------------------------
const map = new mapboxgl.Map({
  container: 'map',
  // Clean light base — bike-lane greens and station colors pop on it.
  // Swap for 'mapbox://styles/mapbox/streets-v12' or your own Studio
  // style URL if you'd rather have a different look.
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-71.09415, 42.36027],  // Boston / Cambridge
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Shared paint properties for both bike-lane layers — define once so
// tweaks only need to happen in one place.
const bikeLanePaint = {
  'line-color': '#32D400',
  'line-width': 4,
  'line-opacity': 0.5,
};

// ---------------------------------------------------------------------
// Global helpers (defined outside map.on('load') so they're hoisted
// into scope for every event handler that needs them)
// ---------------------------------------------------------------------

/** Convert a station's lon/lat to {cx, cy} pixel coords on the map. */
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

/** Format a "minutes since midnight" integer as "HH:MM AM/PM". */
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

/** Get minutes since midnight from a Date object. */
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Pre-bucketed trips by minute-of-day. Populated once when the CSV
// loads; thereafter, filtering by time window is a couple of array
// slices instead of scanning ~260k rows. (Step 5.4 optimization.)
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute   = Array.from({ length: 1440 }, () => []);

/**
 * Return trips falling within +/- 60 minutes of `minute`.
 * If `minute === -1`, return ALL trips (no filtering applied).
 * Handles the case where the window wraps past midnight.
 */
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    // Window wraps across midnight — take [minMinute..end] and [0..maxMinute]
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight  = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  }
  return tripsByMinute.slice(minMinute, maxMinute).flat();
}

/**
 * Compute arrivals/departures/totalTraffic for each station using the
 * pre-bucketed minute arrays. Pass `-1` for `timeFilter` to use all trips.
 */
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals     = arrivals.get(id)   ?? 0;
    station.departures   = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Quantize scale used for circle color. Maps the ratio
// (departures / totalTraffic) — which is in [0, 1] — into one of three
// discrete buckets: 0 = all arrivals, 0.5 = balanced, 1 = all departures.
// Three colors is a deliberate choice: humans are bad at reading
// continuous color scales, so discrete buckets surface the flow trend
// much more clearly.
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// ---------------------------------------------------------------------
// Main: wait for the map to finish loading before fetching data /
// adding layers
// ---------------------------------------------------------------------
map.on('load', async () => {
  // -------- Step 2: Boston + Cambridge bike-lane layers --------------
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  // -------- Step 3.1: Load station metadata --------------------------
  let jsonData;
  try {
    jsonData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  // -------- Step 4.1 + 5.4: Load trips, parse dates, bucket ----------
  // Parse the date strings into real Date objects at load time. Then,
  // immediately drop each trip into the right minute-bucket so future
  // filtering is O(window size) instead of O(all trips).
  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at   = new Date(trip.ended_at);

      const startedMinutes = minutesSinceMidnight(trip.started_at);
      const endedMinutes   = minutesSinceMidnight(trip.ended_at);

      departuresByMinute[startedMinutes].push(trip);
      arrivalsByMinute[endedMinutes].push(trip);

      return trip;
    },
  );
  console.log(`Loaded ${trips.length} trips`);

  // -------- Compute initial station traffic --------------------------
  // No filter applied → all 260k trips contribute to the totals.
  const stations = computeStationTraffic(jsonData.data.stations);
  console.log('Stations with traffic:', stations);

  // -------- Step 4.3: Radius scale -----------------------------------
  // Use scaleSqrt so the CIRCLE AREA — not the radius — encodes traffic.
  // (A linear scale would visually exaggerate larger values.)
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // -------- Step 3.2: SVG overlay ------------------------------------
  const svg = d3.select('#map').select('svg');

  // -------- Step 3.3 + 4.3 + 4.4 + 6.1: Append circles --------------
  // Use station.short_name as the data key so D3 can match existing
  // circles to incoming station data when we re-render on filter
  // changes (instead of destroying and recreating every circle).
  // -------- Custom tooltip helpers ----------------------------------
  // Native SVG <title> tooltips work but have a built-in ~1.5s hover
  // delay. A small floating div positioned by JS appears instantly.
  const tooltip = document.getElementById('tooltip');

  function showTooltip(event, d) {
    tooltip.hidden = false;
    tooltip.innerHTML = `
      <div class="tt-title">${d.name || d.short_name || 'Station'}</div>
      <div class="tt-row"><span class="tt-label">Total trips</span><span class="tt-total">${d.totalTraffic}</span></div>
      <div class="tt-row"><span class="tt-label">Departures</span><span>${d.departures}</span></div>
      <div class="tt-row"><span class="tt-label">Arrivals</span><span>${d.arrivals}</span></div>
    `;
    moveTooltip(event);
  }

  function moveTooltip(event) {
    // Offset 14px right + below the cursor so the pointer doesn't cover it.
    tooltip.style.left = `${event.clientX + 14}px`;
    tooltip.style.top  = `${event.clientY + 14}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  // -------- Append circles ------------------------------------------
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
      // Guard against 0/0 — stations with no traffic in the current
      // window would otherwise produce NaN, which would invalidate
      // var(--color) and make the circle fall back to default fill.
      stationFlow(
        d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5,
      ),
    )
    .on('mouseover', showTooltip)
    .on('mousemove', moveTooltip)
    .on('mouseout',  hideTooltip);

  // -------- Step 3.3: Keep markers aligned with the map --------------
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }
  updatePositions();
  map.on('move',    updatePositions);
  map.on('zoom',    updatePositions);
  map.on('resize',  updatePositions);
  map.on('moveend', updatePositions);

  // -------- Step 5: Slider wiring ------------------------------------
  const timeSlider     = document.getElementById('time-slider');
  const selectedTime   = document.getElementById('selected-time');
  const anyTimeLabel   = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // When filtering, fewer trips contribute to each station so absolute
    // counts drop. Bumping the radius range keeps stations visible and
    // proportional rather than shrinking to dots.
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) =>
        stationFlow(
          d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5,
        ),
      );
    // The mouseover handler reads the bound datum every time it fires,
    // so the tooltip always shows the *current* filtered values
    // without us needing to re-bind any handlers here.
  }

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
