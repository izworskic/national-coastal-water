"use strict";

const engine = require("./oregon-window-engine");

const { SITE, STATUS } = engine;
const TIME_ZONE = "America/Los_Angeles";
const NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const NWS = "https://api.weather.gov";
const NDBC_46050 = "https://www.ndbc.noaa.gov/data/realtime2/46050.txt";

const SITE_META = Object.freeze({
  [SITE.YAQUINA]: {
    id: "yaquina-head",
    name: "Yaquina Head",
    place: "Newport, Oregon",
    lat: 44.6766,
    lon: -124.0793,
    tide_station: "9435385",
    tide_station_name: "Yaquina USCG Station, Newport",
    authority: "Bureau of Land Management",
    authority_url: "https://www.blm.gov/visit/yaquina-head-outstanding-natural-area",
    claim: "official_schedule",
  },
  [SITE.HAYSTACK]: {
    id: "haystack-rock",
    name: "Haystack Rock",
    place: "Cannon Beach, Oregon",
    lat: 45.8847,
    lon: -123.9686,
    tide_station: "9437540",
    tide_station_name: "Garibaldi, Oregon",
    authority: "Haystack Rock Awareness Program",
    authority_url: "https://www.haystackrockawareness.com/field-trips",
    claim: "authority_threshold",
  },
  [SITE.HUG_POINT]: {
    id: "hug-point",
    name: "Hug Point",
    place: "Arch Cape, Oregon",
    lat: 45.8287,
    lon: -123.9623,
    tide_station: "9437540",
    tide_station_name: "Garibaldi, Oregon",
    authority: "Oregon State Parks",
    authority_url: "https://stateparks.oregon.gov/index.cfm?do=park.profile&parkId=137",
    claim: "conservative_access",
  },
  [SITE.THORS_WELL]: {
    id: "thors-well",
    name: "Thor's Well",
    place: "Cape Perpetua, Oregon",
    lat: 44.2784,
    lon: -124.1130,
    tide_station: "9434939",
    tide_station_name: "Waldport, Oregon",
    authority: "Siuslaw National Forest",
    authority_url: "https://www.fs.usda.gov/recarea/siuslaw/recarea/?recid=42265",
    claim: "research_only",
  },
});

const YAQUINA_ACCEPTANCE = Object.freeze({
  "2026-10-01": { discovery: "8:30 – 10:30a", closing: "6:00p" },
  "2026-10-03": { discovery: "No Exposure", closing: "7:00p" },
  "2026-10-28": { discovery: "8:00 – 8:45p", closing: "6:00p" },
});

const HAYSTACK_ACCEPTANCE = Object.freeze({
  "2026-10-01": { daylight_low_ft: 2.7, low_tide_time: "9:47 AM" },
});

const timeout = (ms = 6500) => AbortSignal.timeout(ms);
const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const pad = (n) => String(n).padStart(2, "0");

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function minuteOfDay(text) {
  const match = String(text || "").match(/(?:^|\s)(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatLocalClock(raw) {
  const match = String(raw || "").match(/(?:^|\s)(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minute = match[2];
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function parseTideRows(json) {
  return (json?.predictions || [])
    .map((row) => ({
      local_time: row.t || null,
      clock: formatLocalClock(row.t),
      minute_of_day: minuteOfDay(row.t),
      type: row.type === "L" ? "low" : row.type === "H" ? "high" : String(row.type || "").toLowerCase(),
      height_ft: finite(row.v),
    }))
    .filter((row) => row.local_time && row.minute_of_day != null && row.height_ft != null);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "OregonCoastalOpportunityDesk/1.0 (+https://chrisizworski.com/national-tools/coastal/oregon/)",
    },
    signal: timeout(),
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/plain",
      "user-agent": "OregonCoastalOpportunityDesk/1.0 (+https://chrisizworski.com/national-tools/coastal/oregon/)",
    },
    signal: timeout(),
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} ${response.status}`);
  return response.text();
}

function noaaUrl(station, date) {
  const compact = date.replaceAll("-", "");
  const query = new URLSearchParams({
    product: "predictions",
    application: "OregonCoastalOpportunityDesk",
    begin_date: compact,
    end_date: compact,
    datum: "MLLW",
    station,
    time_zone: "lst_ldt",
    units: "english",
    interval: "hilo",
    format: "json",
  });
  return `${NOAA}?${query}`;
}

async function tideContext(meta, date) {
  try {
    const json = await fetchJson(noaaUrl(meta.tide_station, date));
    const tides = parseTideRows(json);
    return {
      status: tides.length ? "ok" : "unavailable",
      station: meta.tide_station,
      station_name: meta.tide_station_name,
      datum: "MLLW",
      tides,
    };
  } catch (error) {
    return {
      status: "unavailable",
      station: meta.tide_station,
      station_name: meta.tide_station_name,
      datum: "MLLW",
      tides: [],
      detail: error.message,
    };
  }
}

function pickDaylightLow(tides) {
  return tides
    .filter((row) => row.type === "low" && row.minute_of_day >= 6 * 60 && row.minute_of_day <= 20 * 60)
    .sort((a, b) => a.height_ft - b.height_ft)[0] || null;
}

function pickLow(tides) {
  return tides.filter((row) => row.type === "low").sort((a, b) => a.height_ft - b.height_ft)[0] || null;
}

async function activeHazards(meta, selectedDate) {
  if (selectedDate !== localDate()) return [];
  try {
    const json = await fetchJson(`${NWS}/alerts/active?point=${meta.lat},${meta.lon}`);
    return (json.features || []).map((feature) => {
      const p = feature.properties || {};
      return {
        event: p.event || "Coastal hazard",
        severity: p.severity || null,
        onset: p.onset || p.effective || null,
        ends: p.ends || p.expires || null,
        headline: p.headline || null,
        instruction: p.instruction || null,
        source: p.senderName || "National Weather Service",
      };
    });
  } catch {
    return [];
  }
}

function hardHazard(hazards) {
  return hazards.find((hazard) => /tsunami warning|high surf warning|coastal flood warning|hurricane force wind warning|storm warning/i.test(hazard.event || "")) || null;
}

function parseNdbc(raw) {
  const lines = String(raw || "").split(/\r?\n/).filter(Boolean);
  const header = (lines.find((line) => line.startsWith("#YY")) || "").slice(1).trim().split(/\s+/);
  const row = lines.find((line) => /^\d{4}\s+\d{2}\s+\d{2}/.test(line));
  if (!row || !header.length) return null;
  const values = row.trim().split(/\s+/);
  const data = {};
  header.forEach((key, index) => { data[key] = values[index]; });
  const value = (key) => data[key] && data[key] !== "MM" ? finite(data[key]) : null;
  const observed = new Date(Date.UTC(Number(data.YY), Number(data.MM) - 1, Number(data.DD), Number(data.hh), Number(data.mm)));
  if (Number.isNaN(observed.getTime())) return null;
  return {
    station: "46050",
    station_name: "Stonewall Bank — 20 NM west of Newport",
    observed_at: observed.toISOString(),
    age_minutes: Math.max(0, Math.round((Date.now() - observed.getTime()) / 60000)),
    wave_height_ft: value("WVHT") == null ? null : Number((value("WVHT") * 3.28084).toFixed(1)),
    wave_period_s: value("DPD"),
    wave_direction_deg: value("MWD"),
    wind_speed_mph: value("WSPD") == null ? null : Math.round(value("WSPD") * 2.23694),
  };
}

async function marineContext(selectedDate) {
  if (selectedDate !== localDate()) return { status: "forecast-not-wired", observation: null };
  try {
    const observation = parseNdbc(await fetchText(NDBC_46050));
    if (!observation) return { status: "unavailable", observation: null };
    return {
      status: observation.age_minutes <= 180 ? "ok" : "stale",
      observation,
    };
  } catch {
    return { status: "unavailable", observation: null };
  }
}

function source(role, agency, status, url, detail = null, direct = true) {
  return { role, agency, status, url, detail, direct };
}

async function buildSite(site, date, shared = {}) {
  const meta = SITE_META[site];
  const tide = await tideContext(meta, date);
  const hazards = await activeHazards(meta, date);
  const veto = hardHazard(hazards);
  let result;
  const sources = [];

  if (site === SITE.YAQUINA) {
    const fixture = YAQUINA_ACCEPTANCE[date];
    result = engine.evaluate(site, fixture ? {
      date,
      discovery: fixture.discovery,
      closing: fixture.closing,
      source: { status: "ok" },
    } : {
      date,
      source: { status: "unavailable" },
    });
    sources.push(source("window", meta.authority, fixture ? "ok" : "unavailable", meta.authority_url, fixture ? "Published discovery schedule" : "This deployment only has validated official schedule entries for the acceptance dates."));
  } else if (site === SITE.HAYSTACK) {
    const acceptance = HAYSTACK_ACCEPTANCE[date];
    const daylightLow = acceptance || pickDaylightLow(tide.tides);
    const sourceStatus = daylightLow && tide.status === "ok" ? "ok" : acceptance ? "ok" : "unavailable";
    result = engine.evaluate(site, {
      date,
      daylight_low_ft: acceptance ? acceptance.daylight_low_ft : daylightLow?.height_ft,
      low_tide_time: acceptance ? acceptance.low_tide_time : daylightLow?.clock,
      threshold_ft: 1.0,
      source: { status: sourceStatus },
    });
    sources.push(source("rule", meta.authority, "ok", meta.authority_url, "Optimal tidepool viewing is published as tides of 1.0 ft and lower."));
  } else if (site === SITE.HUG_POINT) {
    const low = pickLow(tide.tides);
    result = engine.evaluate(site, {
      date,
      low_tide_opportunity: Boolean(low),
      low_tide_time: low?.clock || null,
      hazard_veto: Boolean(veto),
      hazard_reason: veto?.event || null,
      source: { status: tide.status === "ok" ? "ok" : "unavailable" },
    });
    sources.push(source("access guidance", meta.authority, "ok", meta.authority_url, "Oregon State Parks says tide and seasonal sand conditions change and visitors can become stranded."));
  } else {
    result = engine.evaluate(site, { date, source: { status: "ok" } });
    sources.push(source("site context", meta.authority, "ok", meta.authority_url, "The engine does not publish a spectacle window for Thor's Well."));
  }

  sources.push(source("tide", "NOAA CO-OPS", tide.status, `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${meta.tide_station}`, `${meta.tide_station_name} · MLLW`, false));
  if (hazards.length) sources.push(source("hazards", "National Weather Service", "ok", "https://www.weather.gov/", `${hazards.length} active alert${hazards.length === 1 ? "" : "s"} at this location`, false));

  const context = {
    tides: tide.tides,
    tide_station: tide.station,
    tide_station_name: tide.station_name,
    datum: tide.datum,
    hazards,
    marine: null,
  };

  if (site === SITE.THORS_WELL) {
    const marine = shared.marine || await marineContext(date);
    context.marine = marine;
    sources.push(source("waves", "NOAA National Data Buoy Center", marine.status, "https://www.ndbc.noaa.gov/station_page.php?station=46050", "Stonewall Bank buoy 46050", false));
  }

  return {
    id: meta.id,
    site,
    name: meta.name,
    place: meta.place,
    claim_type: meta.claim,
    coordinates: { lat: meta.lat, lon: meta.lon },
    decision: result,
    context,
    sources,
  };
}

async function buildDesk(date) {
  const marine = await marineContext(date);
  const sites = [];
  for (const site of [SITE.YAQUINA, SITE.HAYSTACK, SITE.HUG_POINT, SITE.THORS_WELL]) {
    sites.push(await buildSite(site, date, { marine }));
  }
  return {
    date,
    time_zone: TIME_ZONE,
    retrieved_at: new Date().toISOString(),
    engine: "oregon-window-engine",
    engine_contract: "acceptance-2026-10-01",
    sites,
    supported_states: Object.values(STATUS),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const date = String(req.query?.date || localDate());
  if (!validDate(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  const body = await buildDesk(date);
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).json(body);
};

module.exports._test = {
  YAQUINA_ACCEPTANCE,
  HAYSTACK_ACCEPTANCE,
  SITE_META,
  localDate,
  validDate,
  minuteOfDay,
  formatLocalClock,
  parseTideRows,
  pickDaylightLow,
  pickLow,
  hardHazard,
  parseNdbc,
};
