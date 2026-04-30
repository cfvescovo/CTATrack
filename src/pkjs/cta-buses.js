'use strict';

var K        = require('./constants');
var settings = require('./settings');
var geo      = require('./geo');
var msg      = require('./messaging');

/* ── Bus stop normalization ──────────────────────────────────────────────────── */
/*
 * Dataset: CTA_BusStops  qs84-j7wh  (City of Chicago / Socrata)
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
    dir:        row.dir || '',
    routesstpg: row.routesstpg || '',
    lat:        stopLat,
    lon:        stopLon,
    distance:   geo.haversine(originLat, originLon, stopLat, stopLon)
  };
}

/* ── Nearby bus stops from Chicago Open Data Portal ─────────────────────────── */

function fetchNearbyBusStops(lat, lon, radiusMeters, cb) {
  var url = 'https://data.cityofchicago.org/resource/qs84-j7wh.json'
          + '?$where=within_circle(the_geom,' + lat + ',' + lon + ',' + radiusMeters + ')'
          + '&$limit=40&$select=systemstop,public_nam,dir,routesstpg,the_geom';

  var xhr = new XMLHttpRequest();
  var done = false;
  var watchdog = setTimeout(function() {
    if (done) return; done = true; cb([]);
  }, K.FETCH_WATCHDOG_MS);

  xhr.timeout = K.FETCH_WATCHDOG_MS;
  xhr.onload = function() {
    if (done) return; done = true; clearTimeout(watchdog);
    try {
      var rows = JSON.parse(xhr.responseText);
      if (!Array.isArray(rows)) { cb([]); return; }
      var stops = rows
        .map(function(row) { return normalizeBusStopRow(row, lat, lon); })
        .filter(function(stop) { return !!stop && stop.distance <= radiusMeters; })
        .sort(function(a, b) { return a.distance - b.distance; })
        .slice(0, K.MAX_BUS_STOPS);
      cb(stops);
    } catch (e) { cb([]); }
  };
  xhr.onerror = xhr.ontimeout = function() {
    if (done) return; done = true; clearTimeout(watchdog); cb([]);
  };
  xhr.open('GET', url);
  xhr.send();
}

/* ── Bus Tracker API helpers ─────────────────────────────────────────────────── */

function normalizeStopName(name) {
  return String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

function dirShortToLong(dir) {
  var key = String(dir || '').toUpperCase();
  if (key === 'EB') return 'Eastbound';
  if (key === 'WB') return 'Westbound';
  if (key === 'NB') return 'Northbound';
  if (key === 'SB') return 'Southbound';
  return null;
}

function requestBusPredictionsByStopId(stpid, done) {
  var url = 'https://www.ctabustracker.com/bustime/api/v2/getpredictions'
          + '?key=' + K.BUS_API_KEY
          + '&stpid=' + stpid
          + '&top=3&format=json';

  var xhr = new XMLHttpRequest();
  var finished = false;
  var watchdog = setTimeout(function() {
    if (finished) return; finished = true; done(null, 'timeout');
  }, K.FETCH_WATCHDOG_MS);

  xhr.timeout = K.FETCH_WATCHDOG_MS;
  xhr.onload = function() {
    if (finished) return; finished = true; clearTimeout(watchdog);
    try {
      var resp = JSON.parse(xhr.responseText);
      var btr  = resp['bustime-response'];
      if (!btr) { done(null, 'invalid response'); return; }
      if (btr.error && btr.error.length) { done(null, btr.error[0].msg || 'api error'); return; }
      var prd = btr.prd || [];
      if (!Array.isArray(prd)) prd = [prd];
      done(prd, null);
    } catch (e) { done(null, 'parse error'); }
  };
  xhr.onerror = xhr.ontimeout = function() {
    if (finished) return; finished = true; clearTimeout(watchdog); done(null, 'network error');
  };
  xhr.open('GET', url);
  xhr.send();
}

/* Resolve the live Bus Tracker stop ID when the dataset ID returns no data */
function resolveLiveStopId(stop, done) {
  var dirLong = dirShortToLong(stop && stop.dir);
  var routes = String(stop && stop.routesstpg ? stop.routesstpg : '')
    .split(',').map(function(r) { return r.trim(); }).filter(function(r) { return !!r; });

  if (!dirLong || routes.length === 0) { done(null); return; }

  var targetName = normalizeStopName(stop.public_nam);
  var routeIdx   = 0;

  function tryNextRoute() {
    if (routeIdx >= routes.length) { done(null); return; }

    var rt = routes[routeIdx++];
    var url = 'https://www.ctabustracker.com/bustime/api/v2/getstops'
            + '?key=' + K.BUS_API_KEY
            + '&rt=' + encodeURIComponent(rt)
            + '&dir=' + encodeURIComponent(dirLong)
            + '&format=json';

    var xhr = new XMLHttpRequest();
    var finished = false;
    var watchdog = setTimeout(function() {
      if (finished) return; finished = true; tryNextRoute();
    }, K.FETCH_WATCHDOG_MS);

    xhr.timeout = K.FETCH_WATCHDOG_MS;
    xhr.onload = function() {
      if (finished) return; finished = true; clearTimeout(watchdog);
      try {
        var resp  = JSON.parse(xhr.responseText);
        var btr   = resp['bustime-response'];
        if (!btr || btr.error) { tryNextRoute(); return; }
        var stops = btr.stops || [];
        if (!Array.isArray(stops)) stops = [stops];
        var match = stops.find(function(s) { return normalizeStopName(s.stpnm) === targetName; });
        if (match && match.stpid) { done(String(match.stpid)); return; }
        tryNextRoute();
      } catch (e) { tryNextRoute(); }
    };
    xhr.onerror = xhr.ontimeout = function() {
      if (finished) return; finished = true; clearTimeout(watchdog); tryNextRoute();
    };
    xhr.open('GET', url);
    xhr.send();
  }

  tryNextRoute();
}

/* ── Bus predictions fetch ───────────────────────────────────────────────────── */

function fetchBusPredictions(stop, idx, total, cb) {
  /* systemstop comes back as a float string like "14007.0" — Bus Tracker wants "14007" */
  var stpid = String(parseInt(stop.systemstop, 10));

  function finalizeFromPredictions(prd) {
    var lines = prd.slice(0, K.MAX_BUS_PREDICTIONS).map(function(p) {
      var mins   = p.prdctdn;
      var rt     = p.rt || '';
      var dir    = p.rtdir ? p.rtdir.charAt(0).toUpperCase() : '';
      var dirStr = dir ? ' ' + dir : '';
      if (mins === 'DUE') return rt + ': Due' + dirStr;
      return rt + ': ' + mins + ' min' + dirStr;
    });
    cb({ name:     stop.public_nam || 'Bus Stop',
         arrivals: lines.length ? lines.join('\n') : 'No buses',
         meta:     geo.formatStationMeta(stop.distance),
         line:     8,   /* LINE_BUS */
         idx:      idx,
         total:    total });
  }

  requestBusPredictionsByStopId(stpid, function(prd, errMsg) {
    if (prd) { finalizeFromPredictions(prd); return; }

    if (!errMsg || errMsg.indexOf('No data found for parameter') === -1) { cb(null); return; }

    resolveLiveStopId(stop, function(resolvedStpid) {
      if (!resolvedStpid || resolvedStpid === stpid) { cb(null); return; }
      requestBusPredictionsByStopId(resolvedStpid, function(fallbackPrd) {
        if (!fallbackPrd) { cb(null); return; }
        finalizeFromPredictions(fallbackPrd);
      });
    });
  });
}

/* ── Main bus dispatcher ─────────────────────────────────────────────────────── */

function doFetchBuses(lat, lon) {
  if (!K.BUS_API_KEY) { msg.sendError('Missing BUS_API_KEY'); return; }

  fetchNearbyBusStops(lat, lon, settings.getBusRadiusMeters(), function(stops) {
    if (!stops || stops.length === 0) { msg.sendError('No bus stops nearby'); return; }
    msg.fetchAllAndSend(stops, fetchBusPredictions, K.MAX_BUS_STOPS);
  });
}

exports.doFetchBuses = doFetchBuses;
