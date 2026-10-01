"use strict";

const engine = require("./oregon-window-engine");

const { SITE, STATUS } = engine;
const TIME_ZONE = "America/Los_Angeles";
const NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const NWS = "https://api.weather.gov";
const NDBC_46050 = "https://www.ndbc.noaa.gov/data/realtime2/46050.txt";

const SITE_META = Object.freeze({
  [SITE.YAQUINA]: {
    id: "yaquina-head", name: "Yaquina Head", place: "Newport, Oregon",
    lat: 44.6766, lon: -124.0793, tide_station: "9435385", tide_station_name: "Yaquina USCG Station, Newport",
    authority: "Bureau of Land Management", authority_url: "https://www.blm.gov/visit/yaquina-head-outstanding-natural-area", claim: "official_schedule",
  },
  [SITE.HAYSTACK]: {
    id: "haystack-rock", name: "Haystack Rock", place: "Cannon Beach, Oregon",
    lat: 45.8847, lon: -123.9686, tide_station: "9437540", tide_station_name: "Garibaldi, Oregon",
    authority: "Haystack Rock Awareness Program", authority_url: "https://www.haystackrockawareness.com/field-trips", claim: "authority_threshold",
  },
  [SITE.HUG_POINT]: {
    id: "hug-point", name: "Hug Point", place: "Arch Cape, Oregon",
    lat: 45.8287, lon: -123.9623, tide_station: "9437540", tide_station_name: "Garibaldi, Oregon",
    authority: "Oregon State Parks", authority_url: "https://stateparks.oregon.gov/index.cfm?do=park.profile&parkId=137", claim: "conservative_access",
  },
  [SITE.THORS_WELL]: {
    id: "thors-well", name: "Thor's Well", place: "Cape Perpetua, Oregon",
    lat: 44.2784, lon: -124.1130, tide_station: "9434939", tide_station_name: "Waldport, Oregon",
    authority: "Siuslaw National Forest", authority_url: "https://www.fs.usda.gov/recarea/siuslaw/recarea/?recid=42265", claim: "research_only",
  },
});

// These are the acceptance entries already validated by the canonical engine work.
// Do not extrapolate an unpublished Yaquina schedule from tide predictions.
const YAQUINA_ACCEPTANCE = Object.freeze({
  "2026-10-01": { discovery: "8:30 – 10:30a", closing: "6:00p" },
  "2026-10-03": { discovery: "No Exposure", closing: "7:00p" },
  "2026-10-28": { discovery: "8:00 – 8:45p", closing: "6:00p" },
});
const HAYSTACK_ACCEPTANCE = Object.freeze({
  "2026-10-01": { daylight_low_ft: 2.7, low_tide_time: "9:47 AM" },
});

const timeout = (ms = 6500) => AbortSignal.timeout(ms);
const finite = (value) => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const rad = (value) => value * Math.PI / 180;
const deg = (value) => value * 180 / Math.PI;
const normalizeDegrees = (value) => ((value % 360) + 360) % 360;
const normalizeHours = (value) => ((value % 24) + 24) % 24;

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")); }
function minuteOfDay(text) {
  const match = String(text || "").match(/(?:^|\s)(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function formatLocalClock(raw) {
  const match = String(raw || "").match(/(?:^|\s)(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour24 = Number(match[1]);
  return `${hour24 % 12 || 12}:${match[2]} ${hour24 >= 12 ? "PM" : "AM"}`;
}
function localMinuteFromDate(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? (hour % 24) * 60 + minute : null;
}
function localClockFromDate(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(date);
}
function dayOfYear(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  const start = Date.UTC(year, 0, 0);
  return Math.floor((Date.UTC(year, month - 1, day) - start) / 86400000);
}
function solarEvent(dateText, lat, lon, sunrise) {
  const [year, month, day] = dateText.split("-").map(Number);
  const n = dayOfYear(dateText);
  const lngHour = lon / 15;
  const t = n + ((sunrise ? 6 : 18) - lngHour) / 24;
  const M = (0.9856 * t) - 3.289;
  let L = M + 1.916 * Math.sin(rad(M)) + 0.020 * Math.sin(rad(2 * M)) + 282.634;
  L = normalizeDegrees(L);
  let RA = normalizeDegrees(deg(Math.atan(0.91764 * Math.tan(rad(L)))));
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(rad(L));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad(90.833)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (cosH < -1 || cosH > 1) return null;
  let H = sunrise ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH));
  H /= 15;
  const T = H + RA - 0.06571 * t - 6.622;
  const utHours = normalizeHours(T - lngHour);
  const utc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  utc.setUTCMinutes(Math.round(utHours * 60));
  return utc;
}
function daylightContext(meta, date) {
  const rise = solarEvent(date, meta.lat, meta.lon, true);
  const set = solarEvent(date, meta.lat, meta.lon, false);
  if (!rise || !set) return null;
  return {
    sunrise_minute: localMinuteFromDate(rise),
    sunset_minute: localMinuteFromDate(set),
    sunrise_clock: localClockFromDate(rise),
    sunset_clock: localClockFromDate(set),
    method: "astronomical",
  };
}

function parseTideRows(json) {
  return (json?.predictions || []).map((row) => ({
    local_time: row.t || null,
    clock: formatLocalClock(row.t),
    minute_of_day: minuteOfDay(row.t),
    type: row.type === "L" ? "low" : row.type === "H" ? "high" : String(row.type || "").toLowerCase(),
    height_ft: finite(row.v),
  })).filter((row) => row.local_time && row.minute_of_day != null && row.height_ft != null);
}
async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "OregonCoastalOpportunityDesk/1.0 (+https://chrisizworski.com/national-tools/coastal/oregon/)" }, signal: timeout() });
  if (!response.ok) throw new Error(`${new URL(url).hostname} ${response.status}`);
  return response.json();
}
async function fetchText(url) {
  const response = await fetch(url, { headers: { accept: "text/plain", "user-agent": "OregonCoastalOpportunityDesk/1.0 (+https://chrisizworski.com/national-tools/coastal/oregon/)" }, signal: timeout() });
  if (!response.ok) throw new Error(`${new URL(url).hostname} ${response.status}`);
  return response.text();
}
function noaaUrl(station, date) {
  const compact = date.replaceAll("-", "");
  const query = new URLSearchParams({ product: "predictions", application: "OregonCoastalOpportunityDesk", begin_date: compact, end_date: compact, datum: "MLLW", station, time_zone: "lst_ldt", units: "english", interval: "hilo", format: "json" });
  return `${NOAA}?${query}`;
}
async function tideContext(meta, date) {
  try {
    const tides = parseTideRows(await fetchJson(noaaUrl(meta.tide_station, date)));
    return { status: tides.length ? "ok" : "unavailable", station: meta.tide_station, station_name: meta.tide_station_name, datum: "MLLW", tides };
  } catch (error) {
    return { status: "unavailable", station: meta.tide_station, station_name: meta.tide_station_name, datum: "MLLW", tides: [], detail: error.message };
  }
}
function cachedTide(meta, date, cache) {
  const key = `${meta.tide_station}:${date}`;
  if (!cache.has(key)) cache.set(key, tideContext(meta, date));
  return cache.get(key);
}
function pickDaylightLow(tides, daylight) {
  const start = daylight?.sunrise_minute ?? 6 * 60;
  const end = daylight?.sunset_minute ?? 20 * 60;
  return tides.filter((row) => row.type === "low" && row.minute_of_day >= start && row.minute_of_day <= end).sort((a, b) => a.height_ft - b.height_ft)[0] || null;
}
function pickLow(tides) { return tides.filter((row) => row.type === "low").sort((a, b) => a.height_ft - b.height_ft)[0] || null; }

async function activeHazards(meta, selectedDate) {
  if (selectedDate !== localDate()) return { status: "not-applicable", hazards: [] };
  try {
    const json = await fetchJson(`${NWS}/alerts/active?point=${meta.lat},${meta.lon}`);
    const hazards = (json.features || []).map((feature) => {
      const p = feature.properties || {};
      return { event: p.event || "Coastal hazard", severity: p.severity || null, onset: p.onset || p.effective || null, ends: p.ends || p.expires || null, headline: p.headline || null, instruction: p.instruction || null, source: p.senderName || "National Weather Service" };
    });
    return { status: "ok", hazards };
  } catch (error) {
    return { status: "unavailable", hazards: [], detail: error.message };
  }
}
function hardHazard(hazards) {
  return hazards.find((hazard) => /tsunami (?:warning|advisory)|high surf warning|coastal flood warning|hurricane force wind warning|storm warning/i.test(hazard.event || "")) || null;
}
function parseNdbc(raw) {
  const lines = String(raw || "").split(/\r?\n/).filter(Boolean);
  const header = (lines.find((line) => line.startsWith("#YY")) || "").slice(1).trim().split(/\s+/);
  const row = lines.find((line) => /^\d{4}\s+\d{2}\s+\d{2}/.test(line));
  if (!row || !header.length) return null;
  const values = row.trim().split(/\s+/), data = {};
  header.forEach((key, index) => { data[key] = values[index]; });
  const value = (key) => data[key] && data[key] !== "MM" ? finite(data[key]) : null;
  const observed = new Date(Date.UTC(Number(data.YY), Number(data.MM) - 1, Number(data.DD), Number(data.hh), Number(data.mm)));
  if (Number.isNaN(observed.getTime())) return null;
  return {
    station: "46050", station_name: "Stonewall Bank — 20 NM west of Newport", observed_at: observed.toISOString(),
    age_minutes: Math.max(0, Math.round((Date.now() - observed.getTime()) / 60000)),
    wave_height_ft: value("WVHT") == null ? null : Number((value("WVHT") * 3.28084).toFixed(1)),
    wave_period_s: value("DPD"), wave_direction_deg: value("MWD"),
    wind_speed_mph: value("WSPD") == null ? null : Math.round(value("WSPD") * 2.23694),
  };
}
async function marineContext(selectedDate) {
  if (selectedDate !== localDate()) return { status: "forecast-not-wired", observation: null };
  try {
    const observation = parseNdbc(await fetchText(NDBC_46050));
    if (!observation) return { status: "unavailable", observation: null };
    return { status: observation.age_minutes <= 180 ? "ok" : "stale", observation };
  } catch (error) {
    return { status: "unavailable", observation: null, detail: error.message };
  }
}
function source(role, agency, status, url, detail = null, direct = true) { return { role, agency, status, url, detail, direct }; }

async function buildSite(site, date, shared) {
  const meta = SITE_META[site];
  const daylight = daylightContext(meta, date);
  const [tide, hazardContext] = await Promise.all([cachedTide(meta, date, shared.tideCache), activeHazards(meta, date)]);
  const hazards = hazardContext.hazards;
  const veto = hardHazard(hazards);
  const vetoFields = { hazard_veto: Boolean(veto), hazard_reason: veto?.event || null };
  let result;
  const sources = [];

  if (site === SITE.YAQUINA) {
    const fixture = YAQUINA_ACCEPTANCE[date];
    result = engine.evaluate(site, fixture ? { date, ...fixture, ...vetoFields, source: { status: "ok" } } : { date, ...vetoFields, source: { status: "unavailable" } });
    sources.push(source("window", meta.authority, fixture ? "ok" : "unavailable", meta.authority_url, fixture ? "Validated published discovery entry" : "No validated official discovery entry is loaded for this selected date."));
  } else if (site === SITE.HAYSTACK) {
    const acceptance = HAYSTACK_ACCEPTANCE[date];
    const daylightLow = acceptance || pickDaylightLow(tide.tides, daylight);
    const sourceStatus = acceptance || (daylightLow && tide.status === "ok") ? "ok" : "unavailable";
    result = engine.evaluate(site, { date, daylight_low_ft: acceptance ? acceptance.daylight_low_ft : daylightLow?.height_ft, low_tide_time: acceptance ? acceptance.low_tide_time : daylightLow?.clock, threshold_ft: 1.0, ...vetoFields, source: { status: sourceStatus } });
    sources.push(source("rule", meta.authority, "ok", meta.authority_url, "Optimal tidepool viewing is published as tides of 1.0 ft and lower."));
  } else if (site === SITE.HUG_POINT) {
    const low = pickLow(tide.tides);
    result = engine.evaluate(site, { date, low_tide_opportunity: Boolean(low), low_tide_time: low?.clock || null, ...vetoFields, source: { status: tide.status === "ok" ? "ok" : "unavailable" } });
    sources.push(source("access guidance", meta.authority, "ok", meta.authority_url, "Tide and seasonal sand conditions vary; the engine does not publish an exact access cutoff."));
  } else {
    result = engine.evaluate(site, { date, ...vetoFields, source: { status: "ok" } });
    sources.push(source("site context", meta.authority, "ok", meta.authority_url, "The engine does not publish a spectacle window for Thor's Well."));
  }

  sources.push(source("tide", "NOAA CO-OPS", tide.status, `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${meta.tide_station}`, `${meta.tide_station_name} · MLLW`, false));
  sources.push(source("hazards", "National Weather Service", hazardContext.status, "https://www.weather.gov/", hazardContext.status === "not-applicable" ? "Active-alert feed is only used for the current date." : hazardContext.status === "ok" ? `${hazards.length} active alert${hazards.length === 1 ? "" : "s"} returned for this point.` : "Active-alert feed could not be refreshed.", false));
  if (daylight) sources.push(source("daylight", "Astronomical calculation", "ok", null, `${daylight.sunrise_clock}–${daylight.sunset_clock}`, false));

  const context = { tides: tide.tides, tide_station: tide.station, tide_station_name: tide.station_name, datum: tide.datum, daylight, hazards, hazard_source_status: hazardContext.status, marine: null };
  if (site === SITE.THORS_WELL) {
    const marine = await shared.marine;
    context.marine = marine;
    sources.push(source("waves", "NOAA National Data Buoy Center", marine.status, "https://www.ndbc.noaa.gov/station_page.php?station=46050", "Stonewall Bank buoy 46050", false));
  }

  return { id: meta.id, site, name: meta.name, place: meta.place, claim_type: meta.claim, coordinates: { lat: meta.lat, lon: meta.lon }, decision: result, context, sources };
}

async function buildDesk(date) {
  const shared = { tideCache: new Map(), marine: marineContext(date) };
  const sites = await Promise.all([SITE.YAQUINA, SITE.HAYSTACK, SITE.HUG_POINT, SITE.THORS_WELL].map((site) => buildSite(site, date, shared)));
  return { date, time_zone: TIME_ZONE, retrieved_at: new Date().toISOString(), engine: "oregon-window-engine", engine_contract: "acceptance-2026-10-01", sites, supported_states: Object.values(STATUS) };
}

module.exports = async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const date = String(req.query?.date || localDate());
  if (!validDate(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  const body = await buildDesk(date);
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).json(body);
};

module.exports._test = { YAQUINA_ACCEPTANCE, HAYSTACK_ACCEPTANCE, SITE_META, localDate, validDate, minuteOfDay, formatLocalClock, parseTideRows, pickDaylightLow, pickLow, hardHazard, parseNdbc, daylightContext, solarEvent, buildDesk };
