'use strict';

var K   = require('./constants');
var geo = require('./geo');

/* ── Sequential AppMessage send queue ───────────────────────────────────────── */

var msgQueue   = [];
var msgSending = false;

function drainQueue() {
  if (msgQueue.length === 0) { msgSending = false; return; }
  msgSending = true;
  var msg = msgQueue.shift();
  Pebble.sendAppMessage(msg, drainQueue, drainQueue);
}

function queueMsg(payload) {
  msgQueue.push(payload);
  if (!msgSending) drainQueue();
}

function resetQueue() {
  msgQueue   = [];
  msgSending = false;
}

/* ── Message builders ────────────────────────────────────────────────────────── */

function sendError(text) {
  var p = {};
  p[K.KEY_MSG_TYPE]  = K.MSG_ERROR;
  p[K.KEY_ERROR_MSG] = text.substring(0, 64);
  queueMsg(p);
}

function sendStation(name, arrivals, line, idx, total, meta) {
  var p = {};
  p[K.KEY_MSG_TYPE]     = K.MSG_STATION;
  p[K.KEY_STATION_NAME] = name.substring(0, 47);
  p[K.KEY_ARRIVALS]     = arrivals.substring(0, 127);
  p[K.KEY_LINE_COLOR]   = line;
  p[K.KEY_STATION_IDX]  = idx;
  p[K.KEY_TOTAL_STNS]   = total;
  p[K.KEY_STATION_META] = (meta || '').substring(0, 31);
  queueMsg(p);
}

/* ── Parallel fetch + in-order send ─────────────────────────────────────────── */

function fetchAllAndSend(items, fetchFn, maxCount) {
  if (items.length === 0) { sendError('None found nearby'); return; }

  var total   = Math.min(items.length, maxCount);
  var results = new Array(total);
  var done    = 0;

  items.slice(0, total).forEach(function(item, i) {
    fetchFn(item, i, total, function(data) {
      results[i] = data || {
        name:     item.n || item.public_nam || 'Stop',
        arrivals: 'No data',
        meta:     geo.formatStationMeta(item.distance),
        line:     (item.l !== undefined ? item.l : 8),
        idx:      i,
        total:    total
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

exports.queueMsg        = queueMsg;
exports.resetQueue      = resetQueue;
exports.sendError       = sendError;
exports.sendStation     = sendStation;
exports.fetchAllAndSend = fetchAllAndSend;
