'use strict';

var K        = require('./constants');
var settings = require('./settings');
var geo      = require('./geo');
var msg      = require('./messaging');

/* ── CTA route → line color code ────────────────────────────────────────────── */
var LINE_COLORS = {
  'Red': 0, 'Blue': 1, 'Brn': 2, 'G': 3,
  'Org': 4, 'Pink': 5, 'P': 6, 'Y': 7
};

/* ── Station data cache state ───────────────────────────────────────────────── */
var ctaStations        = null;
var ctaStationsLoading = false;
var ctaStationsWaiters = [];

/* ── Row normalization helpers ──────────────────────────────────────────────── */

function asBool(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    var s = v.toLowerCase();
    return s === 'true' || s === '1' || s === 'y' || s === 'yes';
  }
  return false;
}

function pickLineCode(row) {
  if (asBool(row.red))                                          return 0;
  if (asBool(row.blue))                                         return 1;
  if (asBool(row.brn)  || asBool(row.brown))                   return 2;
  if (asBool(row.g)    || asBool(row.green))                   return 3;
  if (asBool(row.o)    || asBool(row.org)  || asBool(row.orange)) return 4;
  if (asBool(row.pink))                                         return 5;
  if (asBool(row.p)    || asBool(row.purple) || asBool(row.pexp)) return 6;
  if (asBool(row.y)    || asBool(row.yellow))                  return 7;
  return 0;
}

function normalizeStationRow(row) {
  var idRaw = row.map_id || row.mapid || row.station_id || row.stop_id;
  var id = parseInt(idRaw, 10);
  if (!id) return null;

  var name = row.station_name || row.station_descriptive_name || row.name || row.stop_name;
  if (!name) return null;

  var lat = parseFloat(row.location && row.location.latitude  ? row.location.latitude  : row.latitude);
  var lon = parseFloat(row.location && row.location.longitude ? row.location.longitude : row.longitude);

  if ((!isFinite(lat) || !isFinite(lon)) &&
      row.location && row.location.coordinates && row.location.coordinates.length === 2) {
    lon = parseFloat(row.location.coordinates[0]);
    lat = parseFloat(row.location.coordinates[1]);
  }
  if (!isFinite(lat) || !isFinite(lon)) return null;

  return { id: id, n: String(name), la: lat, lo: lon, l: pickLineCode(row) };
}

function dedupeStations(stations) {
  var seen = {};
  return stations.filter(function(s) {
    if (seen[s.id]) return false;
    seen[s.id] = true;
    return true;
  });
}

/* ── Station data cache ─────────────────────────────────────────────────────── */

function loadStationsFromCache() {
  try {
    var raw = localStorage.getItem(K.CTA_STATIONS_CACHE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.stations) || !parsed.ts) return null;
    if ((Date.now() - parsed.ts) > K.CTA_STATIONS_TTL_MS) return null;
    return parsed.stations;
  } catch (e) {
    return null;
  }
}

function saveStationsToCache(stations) {
  try {
    localStorage.setItem(K.CTA_STATIONS_CACHE_KEY, JSON.stringify({ ts: Date.now(), stations: stations }));
  } catch (e) {}
}

function notifyStationWaiters(stations) {
  var waiters = ctaStationsWaiters;
  ctaStationsWaiters = [];
  waiters.forEach(function(cb) { cb(stations); });
}

function fetchStationsFromPortal(done) {
  var url = 'https://data.cityofchicago.org/resource/8pix-ypme.json?$limit=400';
  var xhr = new XMLHttpRequest();
  xhr.timeout = K.FETCH_WATCHDOG_MS;
  xhr.onload = function() {
    try {
      var rows = JSON.parse(xhr.responseText);
      if (!Array.isArray(rows)) { done([]); return; }
      var stations = dedupeStations(rows.map(normalizeStationRow).filter(function(s) { return !!s; }));
      done(stations);
    } catch (e) { done([]); }
  };
  xhr.onerror = xhr.ontimeout = function() { done([]); };
  xhr.open('GET', url);
  xhr.send();
}

function getCtaStations(cb) {
  if (ctaStations && ctaStations.length) { cb(ctaStations); return; }

  var cached = loadStationsFromCache();
  if (cached && cached.length) { ctaStations = cached; cb(ctaStations); return; }

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

/* ── Nearest-station finder ─────────────────────────────────────────────────── */

function findNearestStations(stations, lat, lon, maxCount, radiusMeters) {
  var ranked = stations.map(function(s) {
    return { s: s, d: geo.haversine(lat, lon, s.la, s.lo) };
  });
  ranked.sort(function(a, b) { return a.d - b.d; });
  return ranked
    .filter(function(r) { return r.d < radiusMeters; })
    .slice(0, maxCount)
    .map(function(r) {
      return { id: r.s.id, n: r.s.n, la: r.s.la, lo: r.s.lo, l: r.s.l, distance: r.d };
    });
}

/* ── CTA time parsing ───────────────────────────────────────────────────────── */
/*
 * Handles two formats the API uses:
 *   eta fields (arrT, prdt): "20240101 12:03:05"  — no dashes
 *   ctatt.tmst             : "2024-01-01 12:00:30" — dashes in date
 * Both are Chicago local time. Since we only ever subtract two CTA times from
 * each other the timezone cancels out and the result is correct everywhere.
 */
function parseCtaTime(t) {
  if (!t) return new Date(0);
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

function formatRunNumber(eta) {
  if (!eta || !eta.rn) return '';
  return ' #' + String(eta.rn);
}

function formatEta(eta, now, showRunNumber) {
  var dest = eta.destNm ? ' > ' + eta.destNm.substring(0, 12) : '';
  var runNumber = showRunNumber ? formatRunNumber(eta) : '';
  if (eta.isDly === '1') return 'Dly' + runNumber + dest;
  if (eta.isApp === '1') return 'Due' + runNumber + dest;
  var mins = Math.round((parseCtaTime(eta.arrT) - now) / 60000);
  return ((mins <= 0) ? 'Due' : (mins + ' min')) + runNumber + dest;
}

/* ── Train arrivals fetch ────────────────────────────────────────────────────── */

function fetchTrainArrivals(station, idx, total, cb) {
  var url = 'https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx'
          + '?key=' + K.TRAIN_API_KEY
          + '&mapid=' + station.id
          + '&max=3&outputType=JSON';

  var xhr = new XMLHttpRequest();
  var done = false;
  var watchdog = setTimeout(function() {
    if (done) return; done = true; cb(null);
  }, K.FETCH_WATCHDOG_MS);

  xhr.timeout = K.FETCH_WATCHDOG_MS;
  xhr.onload = function() {
    if (done) return; done = true; clearTimeout(watchdog);
    try {
      var resp  = JSON.parse(xhr.responseText);
      var ctatt = resp.ctatt;
      if (!ctatt || ctatt.errCd !== '0') { cb(null); return; }

      var etas = ctatt.eta || [];
      if (!Array.isArray(etas)) etas = [etas];

      var serverNow = parseCtaTime(ctatt.tmst);
      var lines     = etas.slice(0, K.MAX_TRAIN_ARRIVALS).map(function(e) {
        return formatEta(e, serverNow, settings.getSettings().showTrainRunNumber);
      });
      var lineCode  = (etas.length > 0 && LINE_COLORS[etas[0].rt] !== undefined)
                    ? LINE_COLORS[etas[0].rt] : station.l;
      cb({ name:     station.n,
           arrivals: lines.join('\n'),
           line:     lineCode,
           meta:     geo.formatStationMeta(station.distance),
           idx:      idx,
           total:    total });
    } catch (e) { cb(null); }
  };
  xhr.onerror = xhr.ontimeout = function() {
    if (done) return; done = true; clearTimeout(watchdog); cb(null);
  };
  xhr.open('GET', url);
  xhr.send();
}

/* ── Main train dispatcher ──────────────────────────────────────────────────── */

function doFetchTrains(lat, lon) {
  if (!K.TRAIN_API_KEY) { msg.sendError('Missing TRAIN_API_KEY'); return; }

  getCtaStations(function(stations) {
    if (!stations || stations.length === 0) { msg.sendError('Station data unavailable'); return; }
    var nearest = findNearestStations(stations, lat, lon, K.MAX_TRAIN_STATIONS, settings.getTrainRadiusMeters());
    if (nearest.length === 0) { msg.sendError('Not in Chicago'); return; }
    msg.fetchAllAndSend(nearest, fetchTrainArrivals, K.MAX_TRAIN_STATIONS);
  });
}

exports.doFetchTrains = doFetchTrains;
