'use strict';

var settings = require('./settings');

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
  if (settings.getSettings().distanceUnit === 'imperial') {
    var feet = distanceMeters * 3.28084;
    if (feet < 5280) return Math.round(feet / 10) * 10 + ' ft';
    var miles = distanceMeters / 1609.344;
    return (Math.round(miles * 10) / 10).toFixed(1) + ' mi';
  }
  if (distanceMeters < 1000) return Math.round(distanceMeters / 10) * 10 + ' m';
  return (Math.round(distanceMeters / 100) / 10).toFixed(1) + ' km';
}

function formatStationMeta(distanceMeters) {
  return formatDistance(distanceMeters) || '';
}

exports.haversine         = haversine;
exports.formatDistance    = formatDistance;
exports.formatStationMeta = formatStationMeta;
