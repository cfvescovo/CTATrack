'use strict';

var K = require('./constants');

/* ── Unit helpers ────────────────────────────────────────────────────────────── */

function kmToMiles(km)     { return km * 0.621371; }
function milesToKm(miles)  { return miles / 0.621371; }

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
  var themeRaw = raw && raw.themeMode;
  var themeMode = (themeRaw === 'light' || themeRaw === 'dark' || themeRaw === 'auto') ? themeRaw : 'auto';
  var showTrainRunNumber = !!(raw && raw.showTrainRunNumber);

  var rawTrainKm = raw && raw.trainRadiusKm;
  var rawBusKm   = raw && raw.busRadiusKm;
  if (raw && raw.trainRadius !== undefined) {
    rawTrainKm = (distanceUnit === 'imperial') ? milesToKm(raw.trainRadius) : raw.trainRadius;
  }
  if (raw && raw.busRadius !== undefined) {
    rawBusKm = (distanceUnit === 'imperial') ? milesToKm(raw.busRadius) : raw.busRadius;
  }

  return {
    trainRadiusKm: sanitizeRadiusKm(rawTrainKm, K.DEFAULT_SETTINGS.trainRadiusKm, 1,   25),
    busRadiusKm:   sanitizeRadiusKm(rawBusKm,   K.DEFAULT_SETTINGS.busRadiusKm,   0.1, 10),
    distanceUnit:  distanceUnit,
    themeMode:     themeMode,
    showTrainRunNumber: showTrainRunNumber
  };
}

function loadSettings() {
  try {
    var raw = localStorage.getItem(K.SETTINGS_STORAGE_KEY);
    if (!raw) return sanitizeSettings(K.DEFAULT_SETTINGS);
    return sanitizeSettings(JSON.parse(raw));
  } catch (e) {
    return sanitizeSettings(K.DEFAULT_SETTINGS);
  }
}

function saveSettings(raw) {
  var next = sanitizeSettings(raw);
  try { localStorage.setItem(K.SETTINGS_STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
  return next;
}

/* Module-level singleton — the live settings object */
var appSettings = loadSettings();

function getSettings()    { return appSettings; }
function reloadSettings() { appSettings = loadSettings(); return appSettings; }

function updateSettings(raw) {
  appSettings = saveSettings(raw);
  return appSettings;
}

/* ── Display helpers ─────────────────────────────────────────────────────────── */

function toDisplayRadius(kmValue, unit) {
  if (unit === 'imperial') return Math.round(kmToMiles(kmValue) * 100) / 100;
  return Math.round(kmValue * 100) / 100;
}

function radiusLabel(unit) { return (unit === 'imperial') ? 'mi' : 'km'; }

function getThemeValue(settingsObj) {
  var source = settingsObj || appSettings || K.DEFAULT_SETTINGS;
  var mode = source.themeMode || 'auto';
  if (mode === 'light') return K.THEME_LIGHT;
  if (mode === 'dark') return K.THEME_DARK;
  return K.THEME_AUTO;
}

function suggestedTrainRadiusText(unit) {
  return (unit === 'imperial') ? 'Suggested default: 2.0 mi' : 'Suggested default: 3.2 km';
}

function suggestedBusRadiusText(unit) {
  return (unit === 'imperial') ? 'Suggested default: 0.5 mi.' : 'Suggested default: 0.8 km.';
}

/* ── Radius accessors ────────────────────────────────────────────────────────── */

function getTrainRadiusMeters() { return Math.round(appSettings.trainRadiusKm * 1000); }
function getBusRadiusMeters()   { return Math.round(appSettings.busRadiusKm   * 1000); }

/* ── Exports ─────────────────────────────────────────────────────────────────── */

exports.getSettings              = getSettings;
exports.reloadSettings           = reloadSettings;
exports.updateSettings           = updateSettings;
exports.loadSettings             = loadSettings;
exports.saveSettings             = saveSettings;
exports.kmToMiles                = kmToMiles;
exports.milesToKm                = milesToKm;
exports.toDisplayRadius          = toDisplayRadius;
exports.radiusLabel              = radiusLabel;
exports.getThemeValue            = getThemeValue;
exports.suggestedTrainRadiusText = suggestedTrainRadiusText;
exports.suggestedBusRadiusText   = suggestedBusRadiusText;
exports.getTrainRadiusMeters     = getTrainRadiusMeters;
exports.getBusRadiusMeters       = getBusRadiusMeters;
