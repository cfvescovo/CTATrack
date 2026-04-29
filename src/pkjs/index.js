/*
 * RouteRush companion JS
 *
 * Handles GPS, nearby station/stop discovery, and CTA API calls.
 *
 * SETUP: Replace the two placeholder API keys below.
 * Free keys: https://www.transitchicago.com/developers/
 *   - Train Tracker API key → TRAIN_API_KEY
 *   - Bus Tracker API key   → BUS_API_KEY
 *
 * Bus stop discovery uses the Chicago Open Data Portal (no key required).
 * Dataset: CTA Bus Stops  https://data.cityofchicago.org/d/d5bx-dr8z
 */

'use strict';

/* ── API keys ──────────────────────────────────────────────────────────────── */
var TRAIN_API_KEY = 'TRAIN_API_KEY_REDACTED';
var BUS_API_KEY   = 'BUS_API_KEY_REDACTED';

/* ── AppMessage key constants (must match package.json messageKeys) ─────────── */
var KEY_MSG_TYPE      = 0;
var KEY_STATION_NAME  = 1;
var KEY_ARRIVALS      = 2;
var KEY_LINE_COLOR    = 3;
var KEY_STATION_IDX   = 4;
var KEY_TOTAL_STNS    = 5;
var KEY_ERROR_MSG     = 6;
var KEY_STATION_META  = 7;

var MSG_REQ_TRAIN = 0;
var MSG_REQ_BUS   = 1;
var MSG_STATION   = 2;
var MSG_ERROR     = 3;

var FETCH_WATCHDOG_MS = 12000;
var SETTINGS_STORAGE_KEY = 'route_rush_settings_v1';
var DEFAULT_SETTINGS = {
  trainRadiusKm: 2.5,
  busRadiusKm: 0.75,
  distanceUnit: 'metric'
};

/* Cached GPS fix — avoids calling getCurrentPosition more than once per session. */
var cachedCoords = null;
var geoInFlight  = false;
var currentMode = MSG_REQ_TRAIN;

function sanitizeRadiusKm(value, fallback, min, max) {
  var parsed = parseFloat(value);
  if (!isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return Math.round(parsed * 100) / 100;
}

function sanitizeSettings(raw) {
  var unitRaw = raw && raw.distanceUnit;
  var distanceUnit = (unitRaw === 'imperial') ? 'imperial' : 'metric';

  var rawTrainKm = raw && raw.trainRadiusKm;
  var rawBusKm = raw && raw.busRadiusKm;
  if (raw && raw.trainRadius !== undefined) {
    rawTrainKm = (distanceUnit === 'imperial')
      ? milesToKm(raw.trainRadius)
      : raw.trainRadius;
  }
  if (raw && raw.busRadius !== undefined) {
    rawBusKm = (distanceUnit === 'imperial')
      ? milesToKm(raw.busRadius)
      : raw.busRadius;
  }

  var trainRadiusKm = sanitizeRadiusKm(
    rawTrainKm,
    DEFAULT_SETTINGS.trainRadiusKm,
    1,
    25
  );
  var busRadiusKm = sanitizeRadiusKm(
    rawBusKm,
    DEFAULT_SETTINGS.busRadiusKm,
    0.1,
    10
  );

  if (busRadiusKm >= trainRadiusKm) {
    busRadiusKm = Math.max(0.1, Math.round((trainRadiusKm - 0.1) * 100) / 100);
  }

  return {
    trainRadiusKm: trainRadiusKm,
    busRadiusKm: busRadiusKm,
    distanceUnit: distanceUnit
  };
}

function loadSettings() {
  try {
    var raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return sanitizeSettings(DEFAULT_SETTINGS);
    return sanitizeSettings(JSON.parse(raw));
  } catch (e) {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
}

function saveSettings(raw) {
  var nextSettings = sanitizeSettings(raw);
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  } catch (e) {
    /* ignore storage failures */
  }
  return nextSettings;
}

var appSettings = loadSettings();

function kmToMiles(km) {
  return km * 0.621371;
}

function milesToKm(miles) {
  return miles / 0.621371;
}

function toDisplayRadius(kmValue, unit) {
  if (unit === 'imperial') {
    return Math.round(kmToMiles(kmValue) * 100) / 100;
  }
  return Math.round(kmValue * 100) / 100;
}

function radiusLabel(unit) {
  return (unit === 'imperial') ? 'mi' : 'km';
}

function suggestedTrainRadiusText(unit) {
  return (unit === 'imperial') ? 'Suggested default: 1.5 mi' : 'Suggested default: 2.5 km';
}

function suggestedBusRadiusText(unit) {
  return (unit === 'imperial')
    ? 'Suggested default: 0.47 mi. Must stay smaller than train radius.'
    : 'Suggested default: 0.75 km. Must stay smaller than train radius.';
}

function getTrainRadiusMeters() {
  return Math.round(appSettings.trainRadiusKm * 1000);
}

function getBusRadiusMeters() {
  return Math.round(appSettings.busRadiusKm * 1000);
}

function buildConfigPageUrl() {
  var unit = appSettings.distanceUnit || 'metric';
  var displayTrain = toDisplayRadius(appSettings.trainRadiusKm, unit);
  var displayBus = toDisplayRadius(appSettings.busRadiusKm, unit);
  var unitText = radiusLabel(unit);
  var html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>RouteRush Settings</title>',
    '<style>',
    'body{font-family:Helvetica,Arial,sans-serif;margin:0;padding:20px;background:#f4f1ea;color:#1f2a2e;}',
    '.card{max-width:420px;margin:0 auto;background:#fffdf8;border-radius:18px;padding:20px;box-shadow:0 10px 30px rgba(31,42,46,.12);}',
    'h1{margin:0 0 8px;font-size:28px;line-height:1.1;}',
    'p{margin:0 0 16px;line-height:1.4;color:#556368;}',
    'label{display:block;margin:16px 0 8px;font-weight:700;}',
    'input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #cfd8d3;border-radius:12px;font-size:16px;background:#fff;}',
    '.hint{font-size:13px;color:#6c7a7f;margin-top:6px;}',
    '.actions{display:flex;gap:12px;margin-top:24px;}',
    'button{flex:1;padding:13px 14px;border:0;border-radius:999px;font-size:16px;font-weight:700;}',
    '.save{background:#0b7a75;color:#fff;}',
    '.cancel{background:#d8e0dc;color:#233136;}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="card">',
    '<h1>Station Radius</h1>',
    '<p>Train stations can use a wider search area. Bus stops should stay tighter so results stay local.</p>',
    '<label for="unit">Distance unit</label>',
    '<select id="unit" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #cfd8d3;border-radius:12px;font-size:16px;background:#fff;">',
    '<option value="metric"', unit === 'metric' ? ' selected' : '', '>Metric (km, m)</option>',
    '<option value="imperial"', unit === 'imperial' ? ' selected' : '', '>Imperial (mi, ft)</option>',
    '</select>',
    '<label id="train-label" for="train">Train radius (', unitText, ')</label>',
    '<input id="train" type="number" min="0.1" max="25" step="0.05" value="', String(displayTrain), '">',
    '<div class="hint" id="train-hint">', suggestedTrainRadiusText(unit), '</div>',
    '<label id="bus-label" for="bus">Bus radius (', unitText, ')</label>',
    '<input id="bus" type="number" min="0.05" max="10" step="0.05" value="', String(displayBus), '">',
    '<div class="hint" id="bus-hint">', suggestedBusRadiusText(unit), '</div>',
    '<div class="actions">',
    '<button class="cancel" id="cancel" type="button">Cancel</button>',
    '<button class="save" id="save" type="button">Save</button>',
    '</div>',
    '</div>',
    '<script>',
    '(function(){',
    'var KM_TO_MI=0.621371;',
    'var trainInput=document.getElementById("train");',
    'var busInput=document.getElementById("bus");',
    'var unitInput=document.getElementById("unit");',
    'var trainLabel=document.getElementById("train-label");',
    'var busLabel=document.getElementById("bus-label");',
    'var trainHint=document.getElementById("train-hint");',
    'var busHint=document.getElementById("bus-hint");',
    'var currentUnit="', unit, '";',
    'function closeWith(payload){window.location="pebblejs://close#"+encodeURIComponent(JSON.stringify(payload));}',
    'function round2(v){return Math.round(v*100)/100;}',
    'function applyUnitLabels(unit){',
    'var u=(unit==="imperial")?"mi":"km";',
    'trainLabel.textContent="Train radius ("+u+")";',
    'busLabel.textContent="Bus radius ("+u+")";',
    'trainHint.textContent=(unit==="imperial")?"Suggested default: 1.5 mi":"Suggested default: 2.5 km";',
    'busHint.textContent=(unit==="imperial")?"Suggested default: 0.5 mi.":"Suggested default: 0.75 km.";',
    '}',
    'function convertInputValues(nextUnit){',
    'if(nextUnit===currentUnit){return;}',
    'var train=parseFloat(trainInput.value);',
    'var bus=parseFloat(busInput.value);',
    'if(isFinite(train)){trainInput.value=String(round2(nextUnit==="imperial"?train*KM_TO_MI:train/KM_TO_MI));}',
    'if(isFinite(bus)){busInput.value=String(round2(nextUnit==="imperial"?bus*KM_TO_MI:bus/KM_TO_MI));}',
    'currentUnit=nextUnit;',
    'applyUnitLabels(nextUnit);',
    '}',
    'unitInput.addEventListener("change",function(){convertInputValues(unitInput.value);});',
    'document.getElementById("cancel").addEventListener("click",function(){closeWith({cancelled:true});});',
    'document.getElementById("save").addEventListener("click",function(){',
    'var train=parseFloat(trainInput.value);',
    'var bus=parseFloat(busInput.value);',
    'closeWith({distanceUnit:unitInput.value,trainRadius:train,busRadius:bus});',
    '});',
    'applyUnitLabels(currentUnit);',
    '}());',
    '</script>',
    '</body>',
    '</html>'
  ].join('');

  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/* ── CTA route → line color code mapping ────────────────────────────────────── */
var LINE_COLORS = {
  'Red': 0, 'Blue': 1, 'Brn': 2, 'G': 3,
  'Org': 4, 'Pink': 5, 'P': 6, 'Y': 7
};

/* ── CTA rail stations runtime source/cache ─────────────────────────────────── */
var CTA_STATIONS_CACHE_KEY = 'cta_stations_v1';
var CTA_STATIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
var ctaStations = null;
var ctaStationsLoading = false;
var ctaStationsWaiters = [];

function asBool(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    var s = v.toLowerCase();
    return s === 'true' || s === '1' || s === 'y' || s === 'yes';
  }
  return false;
}

function pickLineCode(row) {
  if (asBool(row.red)) return 0;
  if (asBool(row.blue)) return 1;
  if (asBool(row.brn) || asBool(row.brown)) return 2;
  if (asBool(row.g) || asBool(row.green)) return 3;
  if (asBool(row.o) || asBool(row.org) || asBool(row.orange)) return 4;
  if (asBool(row.pink)) return 5;
  if (asBool(row.p) || asBool(row.purple) || asBool(row.pexp)) return 6;
  if (asBool(row.y) || asBool(row.yellow)) return 7;
  return 0;
}

function normalizeStationRow(row) {
  var idRaw = row.map_id || row.mapid || row.station_id || row.stop_id;
  var id = parseInt(idRaw, 10);
  if (!id) return null;

  var name = row.station_name || row.station_descriptive_name || row.name || row.stop_name;
  if (!name) return null;

  var lat = parseFloat(row.location && row.location.latitude ? row.location.latitude : row.latitude);
  var lon = parseFloat(row.location && row.location.longitude ? row.location.longitude : row.longitude);

  if ((!isFinite(lat) || !isFinite(lon)) && row.location && row.location.coordinates && row.location.coordinates.length === 2) {
    lon = parseFloat(row.location.coordinates[0]);
    lat = parseFloat(row.location.coordinates[1]);
  }
  if (!isFinite(lat) || !isFinite(lon)) return null;

  return {
    id: id,
    n: String(name),
    la: lat,
    lo: lon,
    l: pickLineCode(row)
  };
}

function dedupeStations(stations) {
  var seen = {};
  return stations.filter(function(s) {
    if (seen[s.id]) return false;
    seen[s.id] = true;
    return true;
  });
}

function loadStationsFromCache() {
  try {
    var raw = localStorage.getItem(CTA_STATIONS_CACHE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.stations) || !parsed.ts) return null;
    if ((Date.now() - parsed.ts) > CTA_STATIONS_TTL_MS) return null;
    return parsed.stations;
  } catch (e) {
    return null;
  }
}

function saveStationsToCache(stations) {
  try {
    localStorage.setItem(CTA_STATIONS_CACHE_KEY, JSON.stringify({ ts: Date.now(), stations: stations }));
  } catch (e) {
    /* ignore cache failures */
  }
}

function notifyStationWaiters(stations) {
  var waiters = ctaStationsWaiters;
  ctaStationsWaiters = [];
  waiters.forEach(function(cb) { cb(stations); });
}

function fetchStationsFromPortal(done) {
  var url = 'https://data.cityofchicago.org/resource/8pix-ypme.json?$limit=400';
  var xhr = new XMLHttpRequest();
  xhr.timeout = FETCH_WATCHDOG_MS;
  xhr.onload = function() {
    try {
      var rows = JSON.parse(xhr.responseText);
      if (!Array.isArray(rows)) { done([]); return; }
      var stations = dedupeStations(rows.map(normalizeStationRow).filter(function(s) { return !!s; }));
      done(stations);
    } catch (e) {
      done([]);
    }
  };
  xhr.onerror = xhr.ontimeout = function() { done([]); };
  xhr.open('GET', url);
  xhr.send();
}

function getCtaStations(cb) {
  if (ctaStations && ctaStations.length) {
    cb(ctaStations);
    return;
  }

  var cached = loadStationsFromCache();
  if (cached && cached.length) {
    ctaStations = cached;
    cb(ctaStations);
    return;
  }

  ctaStationsWaiters.push(cb);
  if (ctaStationsLoading) return;

  ctaStationsLoading = true;
  fetchStationsFromPortal(function(stations) {
    ctaStationsLoading = false;
    ctaStations = stations;
    if (stations.length) saveStationsToCache(stations);
    notifyStationWaiters(stations);
  });
}

/* ── Haversine distance (metres) ────────────────────────────────────────────── */
function haversine(lat1, lon1, lat2, lon2) {
  var R    = 6371000;
  var phi1 = lat1 * Math.PI / 180;
  var phi2 = lat2 * Math.PI / 180;
  var dp   = (lat2 - lat1) * Math.PI / 180;
  var dl   = (lon2 - lon1) * Math.PI / 180;
  var a    = Math.sin(dp / 2) * Math.sin(dp / 2)
           + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distanceMeters) {
  if (!isFinite(distanceMeters) || distanceMeters < 0) return '';
  if (appSettings.distanceUnit === 'imperial') {
    var feet = distanceMeters * 3.28084;
    if (feet < 5280) {
      return Math.round(feet / 10) * 10 + ' ft';
    }
    var miles = distanceMeters / 1609.344;
    return (Math.round(miles * 10) / 10).toFixed(1) + ' mi';
  }
  if (distanceMeters < 1000) {
    return Math.round(distanceMeters / 10) * 10 + ' m';
  }
  return (Math.round(distanceMeters / 100) / 10).toFixed(1) + ' km';
}

function formatStationMeta(distanceMeters) {
  var distanceText = formatDistance(distanceMeters);
  return distanceText || '';
}

/* ── Find nearest train stations ────────────────────────────────────────────── */
function findNearestStations(stations, lat, lon, maxCount, radiusMeters) {
  var ranked = stations.map(function(s) {
    return { s: s, d: haversine(lat, lon, s.la, s.lo) };
  });
  ranked.sort(function(a, b) { return a.d - b.d; });

  return ranked
    .filter(function(r) { return r.d < radiusMeters; })
    .slice(0, maxCount)
    .map(function(r) {
      return {
        id: r.s.id,
        n: r.s.n,
        la: r.s.la,
        lo: r.s.lo,
        l: r.s.l,
        distance: r.d
      };
    });
}

/*
 * Parse CTA time strings. Handles two formats the API uses:
 *   eta fields  (arrT, prdt): "20240101 12:03:05"  — no dashes
 *   ctatt.tmst              : "2024-01-01 12:00:30" — dashes in date
 * Both are Chicago local time. We parse into a JS Date using the device's
 * local timezone; since we only ever subtract two CTA times from each other
 * the timezone cancels out and the result is correct everywhere.
 */
function parseCtaTime(t) {
  if (!t) return new Date(0);
  /* strip dashes so both formats become "YYYYMMDD HH:MM:SS" */
  var s = t.replace(/-/g, '');
  return new Date(
    parseInt(s.substr(0, 4)),
    parseInt(s.substr(4, 2)) - 1,
    parseInt(s.substr(6, 2)),
    parseInt(s.substr(9, 2)),
    parseInt(s.substr(12, 2)),
    parseInt(s.substr(15, 2)) || 0
  );
}

/* now = parseCtaTime(ctatt.tmst) — the server's "right now" in Chicago time */
function formatEta(eta, now) {
  var dest = eta.destNm ? ' > ' + eta.destNm.substring(0, 12) : '';
  if (eta.isDly === '1') return 'Delayed' + dest;
  if (eta.isApp === '1') return 'Due' + dest;
  var mins = Math.round((parseCtaTime(eta.arrT) - now) / 60000);
  var time = (mins <= 0) ? 'Due' : (mins + ' min');
  return time + dest;
}

/* ── Sequential AppMessage send queue ───────────────────────────────────────── */
var msgQueue   = [];
var msgSending = false;

function queueMsg(payload) {
  msgQueue.push(payload);
  if (!msgSending) drainQueue();
}

function drainQueue() {
  if (msgQueue.length === 0) { msgSending = false; return; }
  msgSending = true;
  var msg = msgQueue.shift();
  Pebble.sendAppMessage(msg, drainQueue, drainQueue);
}

function sendError(text) {
  var p = {};
  p[KEY_MSG_TYPE] = MSG_ERROR;
  p[KEY_ERROR_MSG] = text.substring(0, 64);
  queueMsg(p);
}

function sendStation(name, arrivals, line, idx, total, meta) {
  var p = {};
  p[KEY_MSG_TYPE]      = MSG_STATION;
  p[KEY_STATION_NAME]  = name.substring(0, 47);
  p[KEY_ARRIVALS]      = arrivals.substring(0, 127);
  p[KEY_LINE_COLOR]    = line;
  p[KEY_STATION_IDX]   = idx;
  p[KEY_TOTAL_STNS]    = total;
  p[KEY_STATION_META]  = (meta || '').substring(0, 31);
  queueMsg(p);
}

var MAX_TRAIN_STATIONS = 16;
var MAX_BUS_STOPS = 16;
var MAX_TRAIN_ARRIVALS = 3;
var MAX_BUS_PREDICTIONS = 3;

/* ── Train arrivals fetch ────────────────────────────────────────────────────── */
function fetchTrainArrivals(station, idx, total, cb) {
  var url = 'https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx'
          + '?key=' + TRAIN_API_KEY
          + '&mapid=' + station.id
          + '&max=3&outputType=JSON';

  var xhr = new XMLHttpRequest();
  var done = false;
  var watchdog = setTimeout(function() {
    if (done) return;
    done = true;
    cb(null);
  }, FETCH_WATCHDOG_MS);

  xhr.timeout = FETCH_WATCHDOG_MS;
  xhr.onload = function() {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    try {
      var resp  = JSON.parse(xhr.responseText);
      var ctatt = resp.ctatt;
      if (!ctatt || ctatt.errCd !== '0') { cb(null); return; }

      var etas      = ctatt.eta || [];
      if (!Array.isArray(etas)) etas = [etas];

      var serverNow = parseCtaTime(ctatt.tmst);
      var lines     = etas.slice(0, MAX_TRAIN_ARRIVALS).map(function(e) { return formatEta(e, serverNow); });
      var lineCode = (etas.length > 0 && LINE_COLORS[etas[0].rt] !== undefined)
                   ? LINE_COLORS[etas[0].rt]
                   : station.l;
      cb({ name: station.n, arrivals: lines.join('\n'), line: lineCode,
         meta: formatStationMeta(station.distance),
           idx: idx, total: total });
    } catch(e) { cb(null); }
  };
  xhr.onerror = xhr.ontimeout = function() {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    cb(null);
  };
  xhr.open('GET', url);
  xhr.send();
}

/* ── Nearby bus stops from Chicago Open Data Portal ─────────────────────────── */
/*
 * Dataset: CTA_BusStops  qs84-j7wh  (city of Chicago / Socrata)
 *   systemstop : stop ID (float, e.g. 14007.0) — strip ".0" for Bus Tracker
 *   public_nam : stop name
 *   the_geom   : GeoJSON Point — used for within_circle spatial query
 */
function normalizeBusStopRow(row, originLat, originLon) {
  if (!row || !row.systemstop) return null;

  var coords = row.the_geom && row.the_geom.coordinates;
  if (!coords || coords.length !== 2) return null;

  var stopLon = parseFloat(coords[0]);
  var stopLat = parseFloat(coords[1]);
  if (!isFinite(stopLat) || !isFinite(stopLon)) return null;

  return {
    systemstop: row.systemstop,
    public_nam: row.public_nam || 'Bus Stop',
    lat: stopLat,
    lon: stopLon,
    distance: haversine(originLat, originLon, stopLat, stopLon)
  };
}

function fetchNearbyBusStops(lat, lon, radiusMeters, cb) {
  var url = 'https://data.cityofchicago.org/resource/qs84-j7wh.json'
          + '?$where=within_circle(the_geom,' + lat + ',' + lon + ',' + radiusMeters + ')'
          + '&$limit=40&$select=systemstop,public_nam,the_geom';

  var xhr = new XMLHttpRequest();
  var done = false;
  var watchdog = setTimeout(function() {
    if (done) return;
    done = true;
    cb([]);
  }, FETCH_WATCHDOG_MS);

  xhr.timeout = FETCH_WATCHDOG_MS;
  xhr.onload = function() {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    try {
      var rows = JSON.parse(xhr.responseText);
      if (!Array.isArray(rows)) { cb([]); return; }
      var stops = rows
        .map(function(row) { return normalizeBusStopRow(row, lat, lon); })
        .filter(function(stop) { return !!stop && stop.distance <= radiusMeters; })
        .sort(function(a, b) { return a.distance - b.distance; })
        .slice(0, MAX_BUS_STOPS);
      cb(stops);
    } catch(e) { cb([]); }
  };
  xhr.onerror = xhr.ontimeout = function() {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    cb([]);
  };
  xhr.open('GET', url);
  xhr.send();
}

/* ── Bus predictions from CTA Bus Tracker API ────────────────────────────────── */
function fetchBusPredictions(stop, idx, total, cb) {
  /* systemstop comes back as a float string like "14007.0" — Bus Tracker wants "14007" */
  var stpid = String(parseInt(stop.systemstop, 10));
  var url = 'https://www.ctabustracker.com/bustime/api/v2/getpredictions'
          + '?key=' + BUS_API_KEY
          + '&stpid=' + stpid
          + '&top=3&format=json';

  var xhr = new XMLHttpRequest();
  var done = false;
  var watchdog = setTimeout(function() {
    if (done) return;
    done = true;
    cb(null);
  }, FETCH_WATCHDOG_MS);

  xhr.timeout = FETCH_WATCHDOG_MS;
  xhr.onload = function() {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    try {
      var resp = JSON.parse(xhr.responseText);
      var btr  = resp['bustime-response'];
      if (!btr || btr.error) { cb(null); return; }

      var prd  = btr.prd || [];
      if (!Array.isArray(prd)) prd = [prd];

      var lines = prd.slice(0, MAX_BUS_PREDICTIONS).map(function(p) {
        var mins = p.prdctdn;
        var rt   = p.rt || '';
        var dir  = p.rtdir ? p.rtdir.charAt(0).toUpperCase() : '';
        var dirStr = dir ? ' ' + dir : '';
        if (mins === 'DUE') return rt + ': Due' + dirStr;
        return rt + ': ' + mins + ' min' + dirStr;
      });

      cb({ name: stop.public_nam || 'Bus Stop',
           arrivals: lines.length ? lines.join('\n') : 'No buses',
         meta: formatStationMeta(stop.distance),
           line: 8,          /* LINE_BUS */
           idx: idx, total: total });
    } catch(e) { cb(null); }
  };
  xhr.onerror = xhr.ontimeout = function() {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    cb(null);
  };
  xhr.open('GET', url);
  xhr.send();
}

/* ── Parallel fetch + in-order send helpers ──────────────────────────────────── */
function fetchAllAndSend(items, fetchFn, maxCount) {
  if (items.length === 0) { sendError('None found nearby'); return; }

  var total   = Math.min(items.length, maxCount);
  var results = new Array(total);
  var done    = 0;

  items.slice(0, total).forEach(function(item, i) {
    fetchFn(item, i, total, function(data) {
      results[i] = data || {
        name: (item.n || item.public_nam || 'Stop'),
        arrivals: 'No data',
        meta: formatStationMeta(item.distance),
        line: (item.l !== undefined ? item.l : 8),
        idx: i, total: total
      };
      done++;
      if (done === total) {
        results.forEach(function(r) {
          sendStation(r.name, r.arrivals, r.line, r.idx, r.total, r.meta);
        });
      }
    });
  });
}

/* ── Main fetch dispatchers ──────────────────────────────────────────────────── */
function doFetchTrains(lat, lon) {
  getCtaStations(function(stations) {
    if (!stations || stations.length === 0) {
      sendError('Station data unavailable');
      return;
    }
    var nearest = findNearestStations(
      stations,
      lat,
      lon,
      MAX_TRAIN_STATIONS,
      getTrainRadiusMeters()
    );
    if (nearest.length === 0) { sendError('Not in Chicago'); return; }
    fetchAllAndSend(nearest, fetchTrainArrivals, MAX_TRAIN_STATIONS);
  });
}

function doFetchBuses(lat, lon) {
  fetchNearbyBusStops(lat, lon, getBusRadiusMeters(), function(stops) {
    if (!stops || stops.length === 0) { sendError('No bus stops nearby'); return; }
    fetchAllAndSend(stops, fetchBusPredictions, MAX_BUS_STOPS);
  });
}

/* ── Geolocation wrapper ─────────────────────────────────────────────────────── */
function fetchWithLocation(mode) {
  /* After the first successful fix, reuse cached coords — no GPS call needed. */
  if (cachedCoords) {
    if (mode === MSG_REQ_TRAIN) doFetchTrains(cachedCoords.lat, cachedCoords.lon);
    else doFetchBuses(cachedCoords.lat, cachedCoords.lon);
    return;
  }

  /* GPS not yet acquired. If already in flight (duplicate startup call), drop. */
  if (geoInFlight) {
    return;
  }

  geoInFlight = true;
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      geoInFlight = false;
      cachedCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (mode === MSG_REQ_TRAIN) doFetchTrains(cachedCoords.lat, cachedCoords.lon);
      else doFetchBuses(cachedCoords.lat, cachedCoords.lon);
    },
    function(err) {
      geoInFlight = false;
      sendError('GPS: ' + (err.message || 'unavailable').substring(0, 50));
    },
    { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
  );
}

/* ── Pebble event listeners ──────────────────────────────────────────────────── */
Pebble.addEventListener('ready', function() {
  appSettings = loadSettings();
  fetchWithLocation(MSG_REQ_TRAIN);
});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(buildConfigPageUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) return;

  try {
    var payload = JSON.parse(decodeURIComponent(e.response));
    if (payload && !payload.cancelled) {
      appSettings = saveSettings(payload);
      fetchWithLocation(currentMode);
    }
  } catch (err) {
    /* ignore malformed config payloads */
  }
});

Pebble.addEventListener('appmessage', function(e) {
  var dict = e && e.payload ? e.payload : {};
  var rawMsgType = dict[KEY_MSG_TYPE];
  if (rawMsgType === undefined || rawMsgType === null) {
    rawMsgType = dict.MsgType;
  }
  var msgType = (typeof rawMsgType === 'string') ? parseInt(rawMsgType, 10) : rawMsgType;

  if (msgType === MSG_REQ_TRAIN || msgType === MSG_REQ_BUS) {
    currentMode = msgType;
    msgQueue   = [];   /* discard any stale pending messages */
    msgSending = false;
    try {
      fetchWithLocation(msgType);
    } catch (err) {
      sendError('Internal JS error');
    }
  }
});
