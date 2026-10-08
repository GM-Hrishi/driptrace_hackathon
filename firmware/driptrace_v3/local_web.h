#pragma once
/*
 * Bedside hotspot dashboard. The ESP32 runs its own access point
 * (DripTrace-<bed>, WPA2) next to the hospital WiFi, so a phone can read the
 * bed at http://192.168.4.1 with no router and no internet.
 *
 *   /             live page (polls /api/live every second, chart from /api/history)
 *   /api/live     the same JSON the unit pushes to Firebase
 *   /api/history  ?min=30: this boot's flash log, downsampled to <= 360 points
 *
 * Needs from the sketch: buildLiveJson() and the `logbook` OfflineLog.
 */
#include <WebServer.h>

WebServer web(80);

static const char LOCAL_PAGE[] PROGMEM = R"HTML(<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DripTrace bedside</title><style>
:root{--bg:#0b1118;--card:#131c27;--line:#223144;--ink:#e6edf5;--mut:#8a9bb0;--ok:#22c55e;--warn:#f59e0b;--crit:#ef4444;--hr:#f472b6;--o2:#38bdf8;--flow:#a78bfa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui,sans-serif;padding:16px}
h1{font-size:18px;margin:0 0 4px}.sub{color:var(--mut);font-size:12px;margin-bottom:12px}
#banner{border-radius:10px;padding:10px 12px;font-weight:600;margin-bottom:12px;background:var(--card);border:1px solid var(--line)}
.crit{background:var(--crit)!important;color:#fff}.warn{background:var(--warn)!important;color:#111}.ok{color:var(--ok)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.k{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.k p{margin:0;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.k b{display:block;font-size:26px;font-variant-numeric:tabular-nums;margin-top:2px}.k small{color:var(--mut);font-size:12px}
canvas{width:100%;height:150px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin-top:10px;display:block}
.lg{color:var(--mut);font-size:12px;margin-top:4px}.lg i{display:inline-block;width:10px;height:3px;margin:0 4px 2px 8px;vertical-align:middle}
</style></head><body>
<h1>DripTrace <span id="bed"></span></h1><div class="sub" id="st">Connecting...</div>
<div id="banner">Waiting for data</div>
<div class="grid">
<div class="k"><p>Bottle</p><b id="pct">-</b><small id="wt"></small></div>
<div class="k"><p>Flow</p><b id="flow">-</b><small>mL/hr</small></div>
<div class="k"><p>Heart rate</p><b id="hr">-</b><small id="hrs"></small></div>
<div class="k"><p>SpO2</p><b id="o2">-</b><small id="rh"></small></div>
</div>
<canvas id="cv"></canvas><div class="lg">Last 30 min <i style="background:var(--hr)"></i>HR <i style="background:var(--o2)"></i>SpO2 <i style="background:var(--flow)"></i>Flow</div>
<script>
const $=id=>document.getElementById(id);
const SIG={"no-finger":"Place finger on sensor","acquiring":"Reading...","motion":"Hold still...","offline":"Pulse sensor offline"};
function banner(d){
 if(d.unresponsive)return["crit","CHECK PATIENT NOW - possible unresponsive"];
 if(!d.sensorOnline)return["crit","Load cell offline"];
 if(d.bottleEmpty)return["crit","Bottle empty"];
 if(d.heartRate&&(d.heartRate<50||d.heartRate>120))return["crit","Heart rate "+d.heartRate+" bpm"];
 if(d.spo2&&d.spo2<92)return["crit","SpO2 "+d.spo2+"%"];
 if(d.rhythm=="irregular")return["warn","Irregular heartbeat"];
 if(d.hrOutOfRange)return["warn","Heart rate outside this patient's normal range"];
 if(d.bottlePercentRemaining<10)return["warn","Low volume"];
 return["ok","All normal"];
}
async function live(){
 try{const d=await(await fetch("/api/live")).json();
  $("bed").textContent=d.bed||"";
  $("pct").textContent=Math.round(d.bottlePercentRemaining)+"%";$("wt").textContent=d.weightGrams.toFixed(0)+" g on hook";
  $("flow").textContent=d.flowRateMlPerHr.toFixed(1);
  const why=SIG[d.signal]||"";
  $("hr").textContent=d.heartRate??"-";$("o2").textContent=d.spo2!=null?d.spo2+"%":"-";
  $("hrs").textContent=d.hrLow?("normal "+d.hrLow+"-"+d.hrHigh+" bpm"):(d.heartRate?("learning range "+d.baselinePct+"%"):why);
  $("rh").textContent=d.signal=="motion"||d.rhythm=="unknown"?why:"rhythm "+d.rhythm;
  const[c,t]=banner(d);const b=$("banner");b.className=c=="ok"?"":c;b.innerHTML=c=="ok"?'<span class="ok">'+t+"</span>":t;
  $("st").textContent=(d.wifi?"Hospital WiFi connected":"No hospital WiFi - local only")+(d.backlog?" | "+d.backlog+" readings waiting to sync":"");
 }catch(e){$("st").textContent="Lost connection to the bedside unit";}
}
async function hist(){
 try{const h=await(await fetch("/api/history?min=30")).json();draw(h.points);}catch(e){}
}
function draw(p){
 const cv=$("cv"),r=devicePixelRatio||1,W=cv.clientWidth*r,H=cv.clientHeight*r;cv.width=W;cv.height=H;
 const x=cv.getContext("2d");x.lineWidth=2*r;const span=1800;
 const X=a=>W-(a/span)*W;
 function line(i,lo,hi,col){x.strokeStyle=col;x.beginPath();let on=false;
  for(const q of p){const v=q[i];if(!v){on=false;continue}const y=H-(Math.min(hi,Math.max(lo,v))-lo)/(hi-lo)*H;
   on?x.lineTo(X(q[0]),y):x.moveTo(X(q[0]),y);on=true}x.stroke()}
 const css=getComputedStyle(document.documentElement);
 line(3,30,180,css.getPropertyValue("--hr"));line(4,70,100,css.getPropertyValue("--o2"));
 line(1,0,Math.max(50,...p.map(q=>q[1])),css.getPropertyValue("--flow"));
}
live();hist();setInterval(live,1000);setInterval(hist,15000);
</script></body></html>)HTML";

int buildLiveJson(char *out, size_t cap);  // defined in the sketch

void webLive() {
  char body[768];
  buildLiveJson(body, sizeof(body));
  web.sendHeader("Cache-Control", "no-store");
  web.send(200, "application/json", body);
}

// [ageSeconds, flow, pct, hr, spo2, flags] per point, newest last.
void webHistory() {
  uint32_t minutes = web.hasArg("min") ? constrain(web.arg("min").toInt(), 1, 120) : 30;
  uint16_t want = minutes * 60;
  LogRec *recs = (LogRec *)ps_malloc(sizeof(LogRec) * want);
  if (!recs) {
    web.send(503, "application/json", "{\"points\":[]}");
    return;
  }
  uint16_t got = logbook.readRecent(recs, want);
  uint16_t step = got > 360 ? (got + 359) / 360 : 1;
  uint32_t now = millis();
  String json;
  json.reserve(32 + (got / step + 1) * 34);
  json = "{\"points\":[";
  char buf[64];
  bool first = true;
  for (uint16_t i = got ? (got - 1) % step : 0; i < got; i += step) {
    const LogRec &r = recs[i];
    snprintf(buf, sizeof(buf), "%s[%lu,%.1f,%u,%u,%u,%u]", first ? "" : ",",
             (unsigned long)((now - r.upMs) / 1000), r.flowX10 / 10.0f, r.pct, r.hr, r.spo2, r.flags);
    json += buf;
    first = false;
  }
  json += "]}";
  free(recs);
  web.sendHeader("Cache-Control", "no-store");
  web.send(200, "application/json", json);
}

void webTask(void *) {
  web.on("/", []() { web.send_P(200, "text/html", LOCAL_PAGE); });
  web.on("/api/live", webLive);
  web.on("/api/history", webHistory);
  web.onNotFound([]() { web.send(404, "text/plain", "Not found"); });
  web.begin();
  for (;;) {
    web.handleClient();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}
