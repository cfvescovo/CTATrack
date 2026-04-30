'use strict';

var K          = require('./constants');
var settings   = require('./settings');
var configPage = require('./config-page');
var msg        = require('./messaging');
var trains     = require('./cta-trains');
var buses      = require('./cta-buses');

/* ── GPS state ───────────────────────────────────────────────────────────────── */

/* After the first successful fix, reuse cached coords — no GPS call needed. */
var cachedCoords = null;
var geoInFlight  = false;
var currentMode  = K.MSG_REQ_TRAIN;

function fetchWithLocation(mode) {
  if (cachedCoords) {
    if (mode === K.MSG_REQ_TRAIN) trains.doFetchTrains(cachedCoords.lat, cachedCoords.lon);
    else                          buses.doFetchBuses(cachedCoords.lat, cachedCoords.lon);
    return;
  }

  /* GPS not yet acquired. If already in flight (duplicate startup call), drop. */
  if (geoInFlight) return;

  geoInFlight = true;
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      geoInFlight  = false;
      cachedCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (mode === K.MSG_REQ_TRAIN) trains.doFetchTrains(cachedCoords.lat, cachedCoords.lon);
      else                          buses.doFetchBuses(cachedCoords.lat, cachedCoords.lon);
    },
    function(err) {
      geoInFlight = false;
      msg.sendError('GPS: ' + (err.message || 'unavailable').substring(0, 50));
    },
    { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
  );
}

/* ── Pebble event listeners ──────────────────────────────────────────────────── */

Pebble.addEventListener('ready', function() {
  settings.reloadSettings();
  fetchWithLocation(K.MSG_REQ_TRAIN);
});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(configPage.buildConfigPageUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) return;
  try {
    var payload = JSON.parse(decodeURIComponent(e.response));
    if (payload && !payload.cancelled) {
      settings.updateSettings(payload);
      fetchWithLocation(currentMode);
    }
  } catch (err) {
    /* ignore malformed config payloads */
  }
});

Pebble.addEventListener('appmessage', function(e) {
  var dict       = e && e.payload ? e.payload : {};
  var rawMsgType = dict[K.KEY_MSG_TYPE];
  if (rawMsgType === undefined || rawMsgType === null) rawMsgType = dict.MsgType;
  var msgType = (typeof rawMsgType === 'string') ? parseInt(rawMsgType, 10) : rawMsgType;

  if (msgType === K.MSG_REQ_TRAIN || msgType === K.MSG_REQ_BUS) {
    currentMode = msgType;
    msg.resetQueue();   /* discard any stale pending messages */
    try {
      fetchWithLocation(msgType);
    } catch (err) {
      msg.sendError('Internal JS error');
    }
  }
});
