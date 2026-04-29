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

/* ── CTA route → line color code mapping ────────────────────────────────────── */
var LINE_COLORS = {
  'Red': 0, 'Blue': 1, 'Brn': 2, 'G': 3,
  'Org': 4, 'Pink': 5, 'P': 6, 'Y': 7
};

/* ── CTA Train station database ─────────────────────────────────────────────── */
/*
 * Format: {id, n, la, lo, l}
 *   id : CTA map ID (for ttarrivals.aspx)
 *   n  : display name (≤47 chars)
 *   la : latitude
 *   lo : longitude
 *   l  : line color code (0–7, see LINE_COLORS)
 *
 * Source: CTA GTFS stops.txt
 *   https://www.transitchicago.com/downloads/sch_data/
 * Full dataset can be imported to replace/extend this list.
 */
var CTA_STATIONS = [
  /* RED LINE ──────────────────────────────────────────────────────────────── */
  {id:40900,n:'Howard',            la:42.0191,lo:-87.6723,l:0},
  {id:41190,n:'Jarvis',            la:42.0154,lo:-87.6688,l:0},
  {id:40100,n:'Morse',             la:42.0086,lo:-87.6685,l:0},
  {id:41300,n:'Loyola',            la:41.9999,lo:-87.6691,l:0},
  {id:40760,n:'Granville',         la:41.9941,lo:-87.6667,l:0},
  {id:40880,n:'Thorndale',         la:41.9896,lo:-87.6667,l:0},
  {id:41380,n:'Bryn Mawr',         la:41.9835,lo:-87.6587,l:0},
  {id:40340,n:'Berwyn',            la:41.9777,lo:-87.6581,l:0},
  {id:41200,n:'Argyle',            la:41.9737,lo:-87.6586,l:0},
  {id:40770,n:'Lawrence',          la:41.9686,lo:-87.6586,l:0},
  {id:40540,n:'Wilson',            la:41.9647,lo:-87.6577,l:0},
  {id:40080,n:'Sheridan',          la:41.9538,lo:-87.6546,l:0},
  {id:41420,n:'Addison/Red',       la:41.9474,lo:-87.6536,l:0},
  {id:41320,n:'Belmont',           la:41.9398,lo:-87.6528,l:0},
  {id:41220,n:'Fullerton',         la:41.9251,lo:-87.6529,l:0},
  {id:40650,n:'North/Clybourn',    la:41.9106,lo:-87.6492,l:0},
  {id:40630,n:'Clark/Division',    la:41.9043,lo:-87.6314,l:0},
  {id:41450,n:'Chicago/Red',       la:41.8969,lo:-87.6282,l:0},
  {id:40330,n:'Grand/Red',         la:41.8914,lo:-87.6280,l:0},
  {id:41660,n:'Lake/Red',          la:41.8849,lo:-87.6278,l:0},
  {id:41090,n:'Monroe/Red',        la:41.8807,lo:-87.6277,l:0},
  {id:40560,n:'Jackson/Red',       la:41.8785,lo:-87.6276,l:0},
  {id:41490,n:'Harrison',          la:41.8741,lo:-87.6275,l:0},
  {id:41400,n:'Roosevelt',         la:41.8672,lo:-87.6271,l:0},
  {id:41000,n:'Cermak-Chinatown',  la:41.8530,lo:-87.6307,l:0},
  {id:40190,n:'Sox-35th',          la:41.8314,lo:-87.6307,l:0},
  {id:41230,n:'47th/Red',          la:41.8094,lo:-87.6304,l:0},
  {id:41170,n:'Garfield/Red',      la:41.7957,lo:-87.6306,l:0},
  {id:40910,n:'63rd/Red',          la:41.7805,lo:-87.6308,l:0},
  {id:40990,n:'69th',              la:41.7686,lo:-87.6308,l:0},
  {id:40240,n:'79th',              la:41.7502,lo:-87.6307,l:0},
  {id:41430,n:'87th',              la:41.7355,lo:-87.6307,l:0},
  {id:40450,n:'95th/Dan Ryan',     la:41.7227,lo:-87.6245,l:0},

  /* BLUE LINE ─────────────────────────────────────────────────────────────── */
  {id:40890,n:"O'Hare",            la:41.9779,lo:-87.9071,l:1},
  {id:40820,n:'Rosemont',          la:41.9835,lo:-87.8594,l:1},
  {id:41280,n:'Cumberland',        la:41.9844,lo:-87.8387,l:1},
  {id:41360,n:"Harlem/O'Hare",     la:41.9835,lo:-87.8088,l:1},
  {id:41250,n:'Jefferson Park',    la:41.9708,lo:-87.7609,l:1},
  {id:41680,n:'Montrose/Blue',     la:41.9619,lo:-87.7438,l:1},
  {id:40550,n:'Irving Park/Blue',  la:41.9527,lo:-87.7294,l:1},
  {id:41240,n:'Addison/Blue',      la:41.9473,lo:-87.7178,l:1},
  {id:41060,n:'Belmont/Blue',      la:41.9392,lo:-87.7123,l:1},
  {id:40440,n:'Logan Square',      la:41.9289,lo:-87.7079,l:1},
  {id:40680,n:'California/Blue',   la:41.9218,lo:-87.6961,l:1},
  {id:40390,n:"Western/O'Hare Br", la:41.9162,lo:-87.6875,l:1},
  {id:41410,n:'Damen/Blue',        la:41.9099,lo:-87.6779,l:1},
  {id:40590,n:'Division/Blue',     la:41.9037,lo:-87.6680,l:1},
  {id:40670,n:'Chicago/Blue',      la:41.8960,lo:-87.6560,l:1},
  {id:40490,n:'Grand/Blue',        la:41.8913,lo:-87.6476,l:1},
  {id:40380,n:'Clark/Lake',        la:41.8858,lo:-87.6311,l:1},
  {id:40370,n:'Washington/Blue',   la:41.8832,lo:-87.6282,l:1},
  {id:40790,n:'Monroe/Blue',       la:41.8806,lo:-87.6282,l:1},
  {id:40070,n:'Jackson/Blue',      la:41.8784,lo:-87.6276,l:1},
  {id:41340,n:'LaSalle/Blue',      la:41.8756,lo:-87.6316,l:1},
  {id:40160,n:'Clinton/Blue',      la:41.8755,lo:-87.6408,l:1},
  {id:40850,n:'UIC-Halsted',       la:41.8751,lo:-87.6493,l:1},
  {id:40050,n:'Racine/Blue',       la:41.8752,lo:-87.6589,l:1},
  {id:40810,n:'IL Medical Dist',   la:41.8753,lo:-87.6689,l:1},
  {id:40220,n:'Western/FP Br',     la:41.8753,lo:-87.6823,l:1},
  {id:40250,n:'Kedzie-Homan',      la:41.8754,lo:-87.7055,l:1},
  {id:40920,n:'Pulaski/Blue',      la:41.8760,lo:-87.7249,l:1},
  {id:40970,n:'Cicero/Blue',       la:41.8761,lo:-87.7454,l:1},
  {id:40010,n:'Austin/Blue',       la:41.8762,lo:-87.7768,l:1},
  {id:40180,n:'Oak Park/Blue',     la:41.8762,lo:-87.7910,l:1},
  {id:40980,n:'Harlem/FP Br',      la:41.8762,lo:-87.8066,l:1},
  {id:40310,n:'Forest Park',       la:41.8763,lo:-87.8172,l:1},

  /* BROWN LINE ────────────────────────────────────────────────────────────── */
  {id:41700,n:'Kimball',           la:41.9672,lo:-87.7136,l:2},
  {id:40870,n:'Kedzie/Brown',      la:41.9646,lo:-87.7088,l:2},
  {id:41180,n:'Francisco',         la:41.9609,lo:-87.6985,l:2},
  {id:40510,n:'Rockwell',          la:41.9597,lo:-87.6944,l:2},
  {id:40660,n:'Western/Brown',     la:41.9488,lo:-87.6879,l:2},
  {id:41310,n:'Damen/Brown',       la:41.9350,lo:-87.6787,l:2},
  {id:40090,n:'Montrose/Brown',    la:41.9612,lo:-87.6750,l:2},
  {id:40360,n:'Southport',         la:41.9433,lo:-87.6637,l:2},
  {id:41500,n:'Paulina',           la:41.9436,lo:-87.6611,l:2},
  {id:41460,n:'Addison/Brown',     la:41.9473,lo:-87.6561,l:2},
  {id:41010,n:'Wellington',        la:41.9365,lo:-87.6528,l:2},
  {id:40530,n:'Diversey',          la:41.9323,lo:-87.6528,l:2},
  {id:40660,n:'Armitage',          la:41.9181,lo:-87.6532,l:2},
  {id:40800,n:'Sedgwick',          la:41.9107,lo:-87.6388,l:2},
  {id:41320,n:'Chicago/Brown',     la:41.8968,lo:-87.6361,l:2},
  {id:40460,n:'Merchandise Mart',  la:41.8882,lo:-87.6337,l:2},
  /* Loop elevated stations shared with Green/Orange/Pink/Purple */
  {id:40260,n:'State/Lake',        la:41.8860,lo:-87.6278,l:2},
  {id:40730,n:'Randolph/Wabash',   la:41.8847,lo:-87.6265,l:2},
  {id:40040,n:'Washington/Wabash', la:41.8831,lo:-87.6260,l:2},
  {id:40680,n:'Adams/Wabash',      la:41.8795,lo:-87.6260,l:2},
  {id:40340,n:'Harold Wash Lib',   la:41.8763,lo:-87.6278,l:2},
  {id:40850,n:'LaSalle/Van Buren', la:41.8754,lo:-87.6323,l:2},
  {id:40160,n:'Quincy',            la:41.8788,lo:-87.6374,l:2},
  {id:40040,n:'Wells/Wabash',      la:41.8826,lo:-87.6330,l:2},

  /* GREEN LINE ────────────────────────────────────────────────────────────── */
  {id:40020,n:'Harlem/Lake',       la:41.8869,lo:-87.8034,l:3},
  {id:41350,n:'Oak Park/Green',    la:41.8869,lo:-87.7936,l:3},
  {id:40610,n:'Ridgeland',         la:41.8868,lo:-87.7843,l:3},
  {id:40940,n:'Lake/Green',        la:41.8869,lo:-87.7762,l:3},
  {id:40830,n:'Laramie',           la:41.8870,lo:-87.7547,l:3},
  {id:41260,n:'Cicero/Green',      la:41.8868,lo:-87.7449,l:3},
  {id:41700,n:'Pulaski/Green',     la:41.8866,lo:-87.7249,l:3},
  {id:40290,n:'Conservatory',      la:41.8871,lo:-87.7173,l:3},
  {id:40480,n:'Kedzie/Green',      la:41.8869,lo:-87.7057,l:3},
  {id:41670,n:'California/Green',  la:41.8866,lo:-87.6961,l:3},
  {id:41070,n:'Ashland/Green',     la:41.8851,lo:-87.6646,l:3},
  {id:41360,n:'Morgan/Green',      la:41.8855,lo:-87.6514,l:3},
  {id:40170,n:'Clinton/Green',     la:41.8858,lo:-87.6416,l:3},
  /* Downtown Green shares Clark/Lake (40380), State/Lake (40260), etc. */
  {id:40300,n:'Cottage Grove',     la:41.7803,lo:-87.6059,l:3},
  {id:40030,n:'Garfield/Green',    la:41.7959,lo:-87.6096,l:3},
  {id:41120,n:'King Drive',        la:41.8051,lo:-87.6155,l:3},
  {id:40120,n:'35th-Bronzeville',  la:41.8318,lo:-87.6259,l:3},
  {id:41270,n:'Indiana',           la:41.8214,lo:-87.6213,l:3},
  {id:40510,n:'43rd',              la:41.8167,lo:-87.6183,l:3},
  {id:41080,n:'47th/Green',        la:41.8097,lo:-87.6183,l:3},

  /* ORANGE LINE ───────────────────────────────────────────────────────────── */
  {id:40930,n:'Midway',            la:41.7866,lo:-87.7378,l:4},
  {id:41150,n:'Pulaski/Orange',    la:41.7989,lo:-87.7249,l:4},
  {id:40960,n:'Kedzie/Orange',     la:41.8070,lo:-87.7057,l:4},
  {id:41280,n:'Western/Orange',    la:41.8045,lo:-87.6821,l:4},
  {id:40120,n:'35th/Archer',       la:41.8296,lo:-87.6805,l:4},
  {id:41060,n:'Halsted/Orange',    la:41.8448,lo:-87.6482,l:4},
  {id:41130,n:'Roosevelt/Orange',  la:41.8671,lo:-87.6271,l:4},
  /* Downtown Orange shares Loop elevated stations */

  /* PINK LINE ─────────────────────────────────────────────────────────────── */
  {id:40580,n:'54th/Cermak',       la:41.8523,lo:-87.7572,l:5},
  {id:41040,n:'Cermak/Pink',       la:41.8530,lo:-87.7447,l:5},
  {id:40420,n:'Kostner',           la:41.8534,lo:-87.7338,l:5},
  {id:40600,n:'Pulaski/Pink',      la:41.8534,lo:-87.7249,l:5},
  {id:41490,n:'Central Park',      la:41.8534,lo:-87.7140,l:5},
  {id:40780,n:'Kedzie/Pink',       la:41.8533,lo:-87.7058,l:5},
  {id:41430,n:'California/Pink',   la:41.8534,lo:-87.6964,l:5},
  {id:40170,n:'Western/Pink',      la:41.8534,lo:-87.6821,l:5},
  {id:40420,n:'Damen/Pink',        la:41.8534,lo:-87.6777,l:5},
  {id:40830,n:'18th/Pink',         la:41.8577,lo:-87.6695,l:5},
  {id:40170,n:'Polk/Pink',         la:41.8716,lo:-87.6672,l:5},
  {id:41030,n:'Ashland/Pink',      la:41.8851,lo:-87.6668,l:5},
  {id:40580,n:'Morgan/Pink',       la:41.8855,lo:-87.6514,l:5},
  {id:41490,n:'Clinton/Pink',      la:41.8858,lo:-87.6408,l:5},
  /* Downtown Pink shares Loop elevated stations */

  /* PURPLE LINE ───────────────────────────────────────────────────────────── */
  {id:41050,n:'Linden',            la:42.0731,lo:-87.6849,l:6},
  {id:41170,n:'Central/Purple',    la:42.0638,lo:-87.6838,l:6},
  {id:40720,n:'Noyes',             la:42.0582,lo:-87.6834,l:6},
  {id:40750,n:'Foster',            la:42.0511,lo:-87.6835,l:6},
  {id:40840,n:'Davis',             la:42.0469,lo:-87.6827,l:6},
  {id:40900,n:'Dempster/Purple',   la:42.0409,lo:-87.6817,l:6},
  {id:40480,n:'Main',              la:42.0339,lo:-87.6806,l:6},
  {id:40020,n:'South Blvd',        la:42.0275,lo:-87.6796,l:6},
  /* Howard (shared with Red): 40900 already listed */

  /* YELLOW LINE ───────────────────────────────────────────────────────────── */
  {id:40140,n:'Dempster-Skokie',   la:42.0380,lo:-87.7511,l:7},
  {id:41680,n:'Oakton-Skokie',     la:42.0247,lo:-87.7513,l:7}
  /* Howard (shared with Red): 40900 already listed */
];

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
function findNearestStations(lat, lon, maxCount) {
  /* Deduplicate: only one entry per map ID (some IDs appear in multiple lines) */
  var seen   = {};
  var unique = CTA_STATIONS.filter(function(s) {
    if (seen[s.id]) return false;
    seen[s.id] = true;
    return true;
  });

  var ranked = unique.map(function(s) {
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
  if (eta.isDly === '1') return 'Delayed';
  if (eta.isApp === '1') return 'Due';
  var mins = Math.round((parseCtaTime(eta.arrT) - now) / 60000);
  var time = (mins <= 0) ? 'Due' : (mins + ' min');
  var dest = eta.destNm ? ' > ' + eta.destNm.substring(0, 12) : '';
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

/* ── Train arrivals fetch ────────────────────────────────────────────────────── */
function fetchTrainArrivals(station, idx, total, cb) {
  var url = 'https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx'
          + '?key=' + TRAIN_API_KEY
          + '&mapid=' + station.id
          + '&max=3&outputType=JSON';

  var xhr = new XMLHttpRequest();
  xhr.timeout = 10000;
  xhr.onload = function() {
    try {
      var resp  = JSON.parse(xhr.responseText);
      var ctatt = resp.ctatt;
      if (!ctatt || ctatt.errCd !== '0') { cb(null); return; }

      var etas      = ctatt.eta || [];
      if (!Array.isArray(etas)) etas = [etas];

      var serverNow = parseCtaTime(ctatt.tmst);
      var lines     = etas.slice(0, 3).map(function(e) { return formatEta(e, serverNow); });
      var lineCode = (etas.length > 0 && LINE_COLORS[etas[0].rt] !== undefined)
                   ? LINE_COLORS[etas[0].rt]
                   : station.l;
      cb({ name: station.n, arrivals: lines.join('\n'), line: lineCode,
           idx: idx, total: total });
    } catch(e) { cb(null); }
  };
  xhr.onerror = xhr.ontimeout = function() { cb(null); };
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
          + '&$limit=8&$select=systemstop,public_nam,the_geom';

  var xhr = new XMLHttpRequest();
  xhr.timeout = 10000;
  xhr.onload = function() {
    try {
      var rows = JSON.parse(xhr.responseText);
      if (!Array.isArray(rows)) { cb([]); return; }
      cb(rows);
    } catch(e) { cb([]); }
  };
  xhr.onerror = xhr.ontimeout = function() { cb([]); };
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
  xhr.timeout = 10000;
  xhr.onload = function() {
    try {
      var resp = JSON.parse(xhr.responseText);
      var btr  = resp['bustime-response'];
      if (!btr || btr.error) { cb(null); return; }

      var prd  = btr.prd || [];
      if (!Array.isArray(prd)) prd = [prd];

      var lines = prd.slice(0, 3).map(function(p) {
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
  xhr.onerror = xhr.ontimeout = function() { cb(null); };
  xhr.open('GET', url);
  xhr.send();
}

/* ── Parallel fetch + in-order send helpers ──────────────────────────────────── */
function fetchAllAndSend(items, fetchFn) {
  if (items.length === 0) { sendError('None found nearby'); return; }

  var total   = Math.min(items.length, 5);
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
  var nearest = findNearestStations(lat, lon, 5);
  if (nearest.length === 0) { sendError('Not in Chicago'); return; }
  fetchAllAndSend(nearest, fetchTrainArrivals);
}

function doFetchBuses(lat, lon) {
  fetchNearbyBusStops(lat, lon, function(stops) {
    if (!stops || stops.length === 0) {
      sendError('No bus stops nearby');
      return;
    }
    fetchAllAndSend(stops, fetchBusPredictions);
  });
}

/* ── Geolocation wrapper ─────────────────────────────────────────────────────── */
function fetchWithLocation(mode) {
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      var lat = pos.coords.latitude;
      var lon = pos.coords.longitude;
      if (mode === MSG_REQ_TRAIN) {
        doFetchTrains(lat, lon);
      } else {
        doFetchBuses(lat, lon);
      }
    },
    function(err) {
      sendError('GPS: ' + (err.message || 'unavailable').substring(0, 50));
    },
    { timeout: 12000, maximumAge: 30000, enableHighAccuracy: false }
  );
}

/* ── Pebble event listeners ──────────────────────────────────────────────────── */
Pebble.addEventListener('ready', function() {
  console.log('RouteRush JS ready');
  /* The watch sends an initial MSG_REQ_TRAIN right after launch;
   * no need to pro-actively push data here. */
});

Pebble.addEventListener('appmessage', function(e) {
  var dict    = e.payload;
  var msgType = dict[KEY_MSG_TYPE];

  if (msgType === MSG_REQ_TRAIN || msgType === MSG_REQ_BUS) {
    msgQueue   = [];   /* discard any stale pending messages */
    msgSending = false;
    fetchWithLocation(msgType);
  }
});
