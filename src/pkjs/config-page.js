'use strict';

var settings = require('./settings');

function buildConfigPageUrl() {
  var s        = settings.getSettings();
  var unit     = s.distanceUnit || 'metric';
  var dispTrain = settings.toDisplayRadius(s.trainRadiusKm, unit);
  var dispBus   = settings.toDisplayRadius(s.busRadiusKm,   unit);
  var unitText  = settings.radiusLabel(unit);

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
    '<p>Set train and bus search radii independently based on how broad you want each mode to be.</p>',
    '<label for="unit">Distance unit</label>',
    '<select id="unit" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #cfd8d3;border-radius:12px;font-size:16px;background:#fff;">',
    '<option value="metric"',   unit === 'metric'   ? ' selected' : '', '>Metric (km, m)</option>',
    '<option value="imperial"', unit === 'imperial' ? ' selected' : '', '>Imperial (mi, ft)</option>',
    '</select>',
    '<label id="train-label" for="train">Train radius (', unitText, ')</label>',
    '<input id="train" type="number" min="0.1" max="25" step="0.05" value="', String(dispTrain), '">',
    '<div class="hint" id="train-hint">', settings.suggestedTrainRadiusText(unit), '</div>',
    '<label id="bus-label" for="bus">Bus radius (', unitText, ')</label>',
    '<input id="bus" type="number" min="0.05" max="10" step="0.05" value="', String(dispBus), '">',
    '<div class="hint" id="bus-hint">', settings.suggestedBusRadiusText(unit), '</div>',
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
    'trainHint.textContent=(unit==="imperial")?"Suggested default: 2.0 mi":"Suggested default: 3.2 km";',
    'busHint.textContent=(unit==="imperial")?"Suggested default: 0.5 mi.":"Suggested default: 0.8 km.";',
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

exports.buildConfigPageUrl = buildConfigPageUrl;
