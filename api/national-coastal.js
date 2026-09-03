const { finite, sourceMeta } = require("@izworskic/national-outdoor-core");

const NWS = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/marine_beachforecast_summary/MapServer";
const NDBC_ACTIVE = "https://www.ndbc.noaa.gov/activestations.xml";
const NDBC_DATA = "https://www.ndbc.noaa.gov/data/realtime2";
const COOPS_META = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
const COOPS_DATA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const UA = "ChrisIzworskiNationalCoastal/1.0 (+https://chrisizworski.com/national-tools/coastal/)";
const RADIUS = 90;
const ADMISSION_MILES = 25;

async function text(url, timeout) {
  const r = await fetch(url, { headers: { accept: "text/plain, text/xml, application/xml, application/json", "user-agent": UA }, signal: AbortSignal.timeout(timeout || 5000) });
  if (!r.ok) throw new Error(new URL(url).hostname + " returned " + r.status);
  return r.text();
}
async function json(url, timeout) {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(timeout || 5000) });
  const body = await r.text();
  if (!r.ok) throw new Error(new URL(url).hostname + " returned " + r.status);
  try { return JSON.parse(body); } catch (_) { throw new Error(new URL(url).hostname + " returned non-JSON"); }
}
function clean(v) { const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim(); return s || null; }
function rad(v) { return Number(v) * Math.PI / 180; }
function miles(a, b, c, d) {
  const lat1 = finite(a, -90, 90), lon1 = finite(b, -180, 180), lat2 = finite(c, -90, 90), lon2 = finite(d, -180, 180);
  if ([lat1, lon1, lat2, lon2].some(function(v){ return v == null; })) return Infinity;
  const dl = rad(lat2 - lat1), dn = rad(lon2 - lon1);
  const x = Math.sin(dl / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dn / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function ringInside(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i] && ring[i][0]), yi = Number(ring[i] && ring[i][1]);
    const xj = Number(ring[j] && ring[j][0]), yj = Number(ring[j] && ring[j][1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
function featureMiles(feature, lat, lon) {
  const rings = feature && feature.geometry && feature.geometry.rings || [];
  if (rings.some(function(r){ return ringInside(lat, lon, r); })) return 0;
  let best = Infinity;
  rings.forEach(function(r){ r.forEach(function(p){ if (Array.isArray(p)) best = Math.min(best, miles(lat, lon, p[1], p[0])); }); });
  return best;
}
function risk(v) {
  const s = (clean(v) || "").toLowerCase();
  if (/\bhigh\b/.test(s)) return "high";
  if (/\bmoderate\b/.test(s)) return "moderate";
  if (/\blow\b/.test(s)) return "low";
  return "unavailable";
}
function isoEpoch(v) { const n = Number(v); if (!Number.isFinite(n)) return null; const d = new Date(n); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function beachUrl(layer, lat, lon) {
  const q = new URLSearchParams({ f:"json", where:"1=1", geometry:String(lon)+","+String(lat), geometryType:"esriGeometryPoint", inSR:"4326", spatialRel:"esriSpatialRelIntersects", distance:String(RADIUS), units:"esriSRUnit_StatuteMile", outFields:"id,sitename,siteid,beachname,productdat,producttim,rip,uv,surf,wtemp,weather,winds,srfprod,period,tstorm,wspout,idp_source,idp_subset,idp_filedate,idp_ingestdate", returnGeometry:"true", outSR:"4326", resultRecordCount:"50" });
  return NWS + "/" + layer + "/query?" + q.toString();
}
function normalizeBeach(f, lat, lon, day) {
  if (!f) return null;
  const a = f.attributes || {}, d = featureMiles(f, lat, lon);
  return { day:day, site_id:clean(a.siteid || a.id), site_name:clean(a.beachname || a.sitename || a.siteid || a.id) || "NWS beach forecast area", distance_miles:Number.isFinite(d) ? Math.round(d * 10) / 10 : null, period:clean(a.period), rip_swim_risk:clean(a.rip), rip_swim_risk_code:risk(a.rip), surf:clean(a.surf), water_temperature:clean(a.wtemp), winds:clean(a.winds), weather:clean(a.weather), thunderstorm:clean(a.tstorm), waterspout:clean(a.wspout), uv:clean(a.uv), product_url:clean(a.srfprod), issued_at:isoEpoch(a.idp_filedate), ingested_at:isoEpoch(a.idp_ingestdate) };
}
async function beach(layer, lat, lon, day) {
  const p = await json(beachUrl(layer, lat, lon), 3500);
  if (p && p.error) throw new Error("NWS beach service: " + (p.error.message || "query failed"));
  const rows = (p && p.features || []).map(function(f){ return { f:f, d:featureMiles(f, lat, lon) }; }).filter(function(x){ return Number.isFinite(x.d) && x.d <= RADIUS; }).sort(function(a,b){ return a.d - b.d; });
  return normalizeBeach(rows[0] && rows[0].f, lat, lon, day);
}
function attrs(s) { const o = {}; String(s || "").replace(/([\w:-]+)="([^"]*)"/g, function(_, k, v){ o[k] = v; return _; }); return o; }
function ndbcStations(xml) {
  const out = [];
  String(xml || "").replace(/<station\b([^>]*)\/?\s*>/gi, function(_, frag){ const a = attrs(frag), lat = finite(a.lat,-90,90), lon = finite(a.lon,-180,180); if (a.id && lat != null && lon != null) out.push({ id:a.id, name:clean(a.name)||a.id, owner:clean(a.owner), latitude:lat, longitude:lon, met:String(a.met||"").toLowerCase()==="y", waterquality:String(a.waterquality||"").toLowerCase()==="y" }); return _; });
  return out;
}
function nearest(rows, lat, lon, max) {
  return (rows || []).map(function(s){ const d = miles(lat, lon, s.latitude, s.longitude); return Object.assign({}, s, { distance_miles:d }); }).filter(function(s){ return Number.isFinite(s.distance_miles) && s.distance_miles <= (max || RADIUS); }).sort(function(a,b){ return a.distance_miles - b.distance_miles; })[0] || null;
}
const missing = { WDIR:999, WSPD:99, GST:99, WVHT:99, DPD:99, MWD:999, ATMP:999, WTMP:999 };
function nnum(v,k){ if (v == null || v === "MM") return null; const n = Number(v); if (!Number.isFinite(n) || (missing[k] != null && n >= missing[k])) return null; return n; }
function ndbcRows(body) {
  const lines = String(body || "").split(/\r?\n/).map(function(x){ return x.trim(); }).filter(Boolean), h = lines.find(function(x){ return /^#YY\s+/i.test(x); });
  if (!h) return [];
  const keys = h.replace(/^#/, "").split(/\s+/), out = [];
  lines.forEach(function(line){
    if (line[0] === "#") return;
    const p = line.split(/\s+/), r = {}; keys.forEach(function(k,i){ r[k] = p[i]; });
    const ts = Date.UTC(Number(r.YY), Number(r.MM)-1, Number(r.DD), Number(r.hh), Number(r.mm));
    if (!Number.isFinite(ts)) return;
    out.push({ observed_at:new Date(ts).toISOString(), wind_direction_deg:nnum(r.WDIR,"WDIR"), wind_mps:nnum(r.WSPD,"WSPD"), gust_mps:nnum(r.GST,"GST"), wave_m:nnum(r.WVHT,"WVHT"), dominant_period_sec:nnum(r.DPD,"DPD"), mean_wave_direction_deg:nnum(r.MWD,"MWD"), air_temp_c:nnum(r.ATMP,"ATMP"), water_temp_c:nnum(r.WTMP,"WTMP") });
  });
  return out.sort(function(a,b){ return Date.parse(b.observed_at) - Date.parse(a.observed_at); });
}
function ctf(v){ return v == null ? null : Math.round((v*9/5+32)*10)/10; }
function mtf(v){ return v == null ? null : Math.round(v*3.28084*10)/10; }
function mph(v){ return v == null ? null : Math.round(v*2.23694*10)/10; }
function change(a,b){ return a == null || b == null ? null : Math.round((a-b)*10)/10; }
function obs(station, rows) {
  if (!station || !rows.length) return null;
  const now = rows[0], target = Date.parse(now.observed_at)-3*3600000;
  let prior = null, best = Infinity;
  rows.forEach(function(r){ const d = Math.abs(Date.parse(r.observed_at)-target); if (d < best){ best=d; prior=r; } });
  if (best > 90*60000) prior = null;
  const wave = mtf(now.wave_m), wind = mph(now.wind_mps), water = ctf(now.water_temp_c);
  return { station:{ id:station.id, name:station.name, owner:station.owner, distance_miles:Math.round(station.distance_miles*10)/10, latitude:station.latitude, longitude:station.longitude }, observed_at:now.observed_at, wave_height_ft:wave, dominant_period_sec:now.dominant_period_sec, mean_wave_direction_deg:now.mean_wave_direction_deg, wind_mph:wind, gust_mph:mph(now.gust_mps), wind_direction_deg:now.wind_direction_deg, air_temperature_f:ctf(now.air_temp_c), water_temperature_f:water, change_3h:prior ? { wave_height_ft:change(wave,mtf(prior.wave_m)), wind_mph:change(wind,mph(prior.wind_mps)), water_temperature_f:change(water,ctf(prior.water_temp_c)), compared_at:prior.observed_at } : null };
}
async function ndbc(lat, lon) {
  const list = ndbcStations(await text(NDBC_ACTIVE, 3000)).filter(function(s){ return s.met || s.waterquality; }), station = nearest(list, lat, lon, RADIUS);
  if (!station) return null;
  return obs(station, ndbcRows(await text(NDBC_DATA + "/" + encodeURIComponent(station.id) + ".txt", 3000)));
}
function coopsStations(p) { const rows = p && (p.stationList || p.stations) || []; return (Array.isArray(rows) ? rows : []).map(function(r){ return { id:clean(r.id), name:clean(r.name)||clean(r.id), state:clean(r.state), latitude:finite(r.lat,-90,90), longitude:finite(r.lng,-180,180) }; }).filter(function(r){ return r.id && r.latitude != null && r.longitude != null; }); }
function pad(v){ return String(v).padStart(2,"0"); }
function begin(now){ now = now || new Date(); return String(now.getUTCFullYear()) + pad(now.getUTCMonth()+1) + pad(now.getUTCDate()) + " " + pad(now.getUTCHours()) + ":" + pad(now.getUTCMinutes()); }
function tideTime(v){ const t = Date.parse(String(v||"").trim().replace(" ","T")+"Z"); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
function tideUrl(id, now) { const q = new URLSearchParams({ product:"predictions", application:"ChrisIzworskiNationalCoastal", begin_date:begin(now), range:"36", datum:"MLLW", station:id, time_zone:"gmt", units:"english", interval:"hilo", format:"json" }); return COOPS_DATA + "?" + q.toString(); }
async function tides(lat, lon) {
  const station = nearest(coopsStations(await json(COOPS_META,3000)), lat, lon, RADIUS);
  if (!station) return null;
  const p = await json(tideUrl(station.id),3500), predictions = p && p.error ? [] : (p && p.predictions || []).map(function(r){ return { time:tideTime(r.t), height_ft:finite(r.v), type:r.type==="H"?"high":r.type==="L"?"low":clean(r.type) }; }).filter(function(r){ return r.time && r.height_ft != null; }).slice(0,8);
  return { station:{ id:station.id, name:station.name, state:station.state, distance_miles:Math.round(station.distance_miles*10)/10 }, datum:"MLLW", predictions:predictions, unavailable_reason:predictions.length ? null : clean(p && p.error && p.error.message) || "No tide predictions returned for this station" };
}
function changed(o){ const c=o && o.change_3h; if(!c) return "Three-hour buoy change is unavailable."; const p=[]; if(c.wave_height_ft!=null&&Math.abs(c.wave_height_ft)>=0.2)p.push("wave height "+(c.wave_height_ft>0?"rose ":"fell ")+Math.abs(c.wave_height_ft).toFixed(1)+" ft"); if(c.wind_mph!=null&&Math.abs(c.wind_mph)>=2)p.push("wind "+(c.wind_mph>0?"increased ":"decreased ")+Math.abs(c.wind_mph).toFixed(1)+" mph"); return p.length ? "At the nearby buoy, "+p.join(" and ")+" over roughly three hours." : "Nearby buoy wave and wind observations changed little over roughly three hours."; }
function next(day1, day2, tide){ const a=day1&&day1.rip_swim_risk_code||"unavailable", b=day2&&day2.rip_swim_risk_code||"unavailable"; if(a!=="unavailable"&&b!=="unavailable"&&a!==b)return "The official beach risk changes from "+a+" today to "+b+" tomorrow for this forecast area."; const n=tide&&tide.predictions&&tide.predictions[0]; if(n)return "The next NOAA tide prediction is "+n.type+" at "+n.time+"; tide height is "+n.height_ft.toFixed(1)+" ft MLLW at the selected station."; if(day2)return "Tomorrow's official beach forecast remains "+(b==="unavailable"?"available without a standardized risk label":b)+"."; return "No reliable next-period coastal change signal is available from the selected sources."; }
function coastalAdmission(day1, day2, beachSettled) {
  const failed = Array.isArray(beachSettled) && beachSettled.length && beachSettled.every(function(x){ return x && x.status === "rejected"; });
  if (failed) return { status:"coverage-unverified", eligible:false, admission_radius_miles:ADMISSION_MILES, nearest_beach_forecast_miles:null, basis:"NWS Marine Beach Forecast Summary", reason:"The NWS beach-forecast coverage lookup failed, so this tool will not substitute distant buoy or tide data." };
  const distances = [day1, day2].map(function(x){ return x && finite(x.distance_miles, 0); }).filter(function(x){ return x != null; });
  const nearest = distances.length ? Math.min.apply(null, distances) : null;
  if (nearest == null) return { status:"not-applicable", eligible:false, admission_radius_miles:ADMISSION_MILES, nearest_beach_forecast_miles:null, basis:"NWS Marine Beach Forecast Summary", reason:"No applicable NWS beach-forecast area was found close enough to this location. Distant buoy or tide stations are not treated as proof that the place is coastal." };
  if (nearest > ADMISSION_MILES) return { status:"not-applicable", eligible:false, admission_radius_miles:ADMISSION_MILES, nearest_beach_forecast_miles:Math.round(nearest*10)/10, basis:"NWS Marine Beach Forecast Summary", reason:"The nearest NWS beach-forecast area is "+Math.round(nearest*10)/10+" miles away, beyond this tool's "+ADMISSION_MILES+"-mile coastal admission boundary. Distant buoy or tide data will not be used to make this location look coastal." };
  return { status:"eligible", eligible:true, admission_radius_miles:ADMISSION_MILES, nearest_beach_forecast_miles:Math.round(nearest*10)/10, basis:"NWS Marine Beach Forecast Summary", reason:"An NWS beach-forecast area is within the coastal admission boundary." };
}
function locationDecision(applicability) {
  if (applicability && applicability.status === "coverage-unverified") return { level:"coverage-unverified", headline:"Coastal applicability cannot be verified right now", detail:applicability.reason, what_changed:"No coastal change is shown until location applicability can be verified.", what_next:"Try again later, or use the U.S. Outdoor Desk for non-coastal decisions." };
  return { level:"not-applicable", headline:"This location is outside the coastal/beach area this tool can responsibly evaluate", detail:applicability && applicability.reason || "No applicable coastal coverage was found close enough to this location.", what_changed:"No coastal signal is shown because this location did not pass the coastal admission check.", what_next:"Use River Conditions or the U.S. Outdoor Desk instead of distant coastal data." };
}
function summary(day1, day2, observation, tide){
  const code=day1&&day1.rip_swim_risk_code||"unavailable"; let level="context", headline="Coastal context is available", detail="Read the official beach forecast first, then use buoy and tide data as separate context.";
  if(code==="high"){level="high";headline="High official rip/swim risk today";detail="The National Weather Service beach forecast is the dominant signal. Calmer-looking buoy or tide data do not override an official High risk.";}
  else if(code==="moderate"){level="moderate";headline="Moderate official rip/swim risk today";detail="The National Weather Service identifies elevated beach risk. Buoy observations and tides add context, not a safety clearance.";}
  else if(code==="low"){level="low";headline="Official rip/swim risk is Low today";detail="Low is the National Weather Service category for this forecast area, not a guarantee of safe swimming. Local flags, closures and lifeguards still control the on-site decision.";}
  else if(!day1&&observation){level="observation-only";headline="Nearby water observations are available, but no official beach-risk forecast was found";detail="Use the buoy reading as environmental context only. It cannot substitute for an official rip/swim-risk forecast or local beach guidance.";}
  else if(!day1&&!observation&&tide){level="tide-only";headline="Tide predictions are available, but beach-risk and buoy context are not";detail="Tide timing alone is not a beach-safety determination. Check the local forecast, flags and closures before going in the water.";}
  else if(!day1&&!observation&&!tide){level="inland-or-uncovered";headline="No nearby coastal source coverage was found";detail="No NWS beach forecast, active NDBC observation or NOAA tide-prediction station was found within "+RADIUS+" miles of this location.";}
  return { level:level, headline:headline, detail:detail, what_changed:changed(observation), what_next:next(day1,day2,tide) };
}

module.exports = async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*"); res.setHeader("X-Robots-Tag","noindex, nofollow"); res.setHeader("Cache-Control","public, s-maxage=300, stale-while-revalidate=900");
  if(req.method!=="GET"&&req.method!=="HEAD"){res.setHeader("Allow","GET, HEAD");return res.status(405).json({error:"Method not allowed"});}
  const lat=finite(req.query&&req.query.lat,-90,90), lon=finite(req.query&&req.query.lon,-180,180); if(lat==null||lon==null)return res.status(400).json({error:"Valid latitude and longitude are required"});
  const settled=await Promise.allSettled([beach(0,lat,lon,"day1"),beach(1,lat,lon,"day2"),ndbc(lat,lon),tides(lat,lon)]), a=settled[0], b=settled[1], c=settled[2], d=settled[3];
  const rawDay1=a.status==="fulfilled"?a.value:null, rawDay2=b.status==="fulfilled"?b.value:null, rawObservation=c.status==="fulfilled"?c.value:null, rawTide=d.status==="fulfilled"?d.value:null;
  const applicability=coastalAdmission(rawDay1,rawDay2,[a,b]), admitted=applicability.eligible===true;
  const day1=admitted?rawDay1:null, day2=admitted?rawDay2:null, observation=admitted?rawObservation:null, tide=admitted?rawTide:null;
  const nwsStatus=a.status==="rejected"&&b.status==="rejected"?"unavailable":admitted?null:"not-applicable";
  const contextStatus=function(result,available){ if(result.status==="rejected")return "unavailable"; if(!admitted)return "suppressed-by-location-admission"; return available?null:"unavailable"; };
  const sources=[sourceMeta({name:"NOAA/NWS Marine Beach Forecast Summary",url:NWS+"/0",updatedAt:day1&&day1.issued_at||day2&&day2.issued_at||null,staleAfterMinutes:1440,available:Boolean(admitted&&(day1||day2)),status:nwsStatus}),sourceMeta({name:"NOAA/NDBC real-time station observations",url:NDBC_ACTIVE,updatedAt:observation&&observation.observed_at||null,staleAfterMinutes:90,available:Boolean(observation),status:contextStatus(c,Boolean(observation))}),sourceMeta({name:"NOAA CO-OPS tide predictions",url:"https://tidesandcurrents.noaa.gov/",updatedAt:null,staleAfterMinutes:null,available:Boolean(tide&&tide.predictions&&tide.predictions.length),status:admitted&&tide&&tide.predictions&&tide.predictions.length?"prediction":contextStatus(d,false)})];
  return res.status(200).json({retrieved_at:new Date().toISOString(),degraded:settled.some(function(x){return x.status==="rejected";}),coastal_available:Boolean(admitted&&(day1||day2||observation||tide&&tide.predictions&&tide.predictions.length)),search_radius_miles:RADIUS,applicability:applicability,location:{latitude:lat,longitude:lon},decision:admitted?summary(day1,day2,observation,tide):locationDecision(applicability),official_beach_forecast:{day1:day1,day2:day2},nearby_observation:observation,tide_context:tide,sources:sources,limitations:["This tool first requires location admission from nearby NWS beach-forecast coverage; distant buoy or tide data alone cannot qualify a place as coastal.","This tool does not produce a universal beach- or boating-safety score.","NWS rip/swim-risk forecasts apply to the named forecast area and do not replace local flags, closures, lifeguards or emergency instructions.","NDBC stations can be offshore or otherwise separated from the exact beach; distance is shown and observations are context, not on-site proof.","NOAA tide predictions are predictions referenced to the named station and datum; they are not observed water level and they do not apply to non-tidal Great Lakes water-level changes.","Missing data remains unavailable rather than being converted into a neutral or favorable value."]});
};
module.exports._test={beachUrl:beachUrl,summary:summary,coastalAdmission:coastalAdmission,locationDecision:locationDecision,miles:miles,normalizeBeach:normalizeBeach,obs:obs,coopsStations:coopsStations,ndbcStations:ndbcStations,ndbcRows:ndbcRows,risk:risk,tideUrl:tideUrl,ADMISSION_MILES:ADMISSION_MILES};
