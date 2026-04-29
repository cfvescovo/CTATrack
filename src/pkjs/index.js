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

var MSG_REQ_TRAIN = 0;
var MSG_REQ_BUS   = 1;
var MSG_STATION   = 2;
var MSG_ERROR     = 3;

var FETCH_WATCHDOG_MS = 12000;

/* Cached GPS fix — avoids calling getCurrentPosition more than once per session. */
var cachedCoords = null;
var geoInFlight  = false;

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

/* ── Find nearest train stations ────────────────────────────────────────────── */
function findNearestStations(stations, lat, lon, maxCount) {
  var ranked = stations.map(function(s) {
    return { s: s, d: haversine(lat, lon, s.la, s.lo) };
  });
  ranked.sort(function(a, b) { return a.d - b.d; });

  /* Only return stations within 15 km — outside that range = not in Chicago */
  return ranked
    .filter(function(r) { return r.d < 15000; })
    .slice(0, maxCount)
    .map(function(r) { return r.s; });
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

function sendStation(name, arrivals, line, idx, total) {
  var p = {};
  p[KEY_MSG_TYPE]      = MSG_STATION;
  p[KEY_STATION_NAME]  = name.substring(0, 47);
  p[KEY_ARRIVALS]      = arrivals.substring(0, 127);
  p[KEY_LINE_COLOR]    = line;
  p[KEY_STATION_IDX]   = idx;
  p[KEY_TOTAL_STNS]    = total;
  queueMsg(p);
}

var MAX_TRAIN_STATIONS = 4;
var MAX_BUS_STOPS = 8;
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
function fetchNearbyBusStops(lat, lon, cb) {
  var radius = 500; /* metres */
  var url = 'https://data.cityofchicago.org/resource/qs84-j7wh.json'
          + '?$where=within_circle(the_geom,' + lat + ',' + lon + ',' + radius + ')'
          + '&$limit=' + MAX_BUS_STOPS + '&$select=systemstop,public_nam,the_geom';

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
      cb(rows);
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
        line: (item.l !== undefined ? item.l : 8),
        idx: i, total: total
      };
      done++;
      if (done === total) {
        results.forEach(function(r) {
          sendStation(r.name, r.arrivals, r.line, r.idx, r.total);
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
    var nearest = findNearestStations(stations, lat, lon, MAX_TRAIN_STATIONS);
    if (nearest.length === 0) { sendError('Not in Chicago'); return; }
    fetchAllAndSend(nearest, fetchTrainArrivals, MAX_TRAIN_STATIONS);
  });
}

function doFetchBuses(lat, lon) {
  fetchNearbyBusStops(lat, lon, function(stops) {
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
  fetchWithLocation(MSG_REQ_TRAIN);
});

Pebble.addEventListener('appmessage', function(e) {
  var dict = e && e.payload ? e.payload : {};
  var rawMsgType = dict[KEY_MSG_TYPE];
  if (rawMsgType === undefined || rawMsgType === null) {
    rawMsgType = dict.MsgType;
  }
  var msgType = (typeof rawMsgType === 'string') ? parseInt(rawMsgType, 10) : rawMsgType;

  if (msgType === MSG_REQ_TRAIN || msgType === MSG_REQ_BUS) {
    msgQueue   = [];   /* discard any stale pending messages */
    msgSending = false;
    try {
      fetchWithLocation(msgType);
    } catch (err) {
      sendError('Internal JS error');
    }
  }
});
