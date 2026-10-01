import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const engine = require("../api/oregon-window-engine.js");
const { SITE } = engine;
const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(here, "..", "public");
const port = Number(process.env.PORT || 4173);

const source = Object.freeze({ status: "ok" });
const meta = {
  YAQUINA: { id: "yaquina-head", name: "Yaquina Head", place: "Newport, Oregon", station: "Yaquina USCG Station, Newport", stationId: "9435385", authority: "Bureau of Land Management" },
  HAYSTACK: { id: "haystack-rock", name: "Haystack Rock", place: "Cannon Beach, Oregon", station: "Garibaldi, Oregon", stationId: "9437540", authority: "Haystack Rock Awareness Program" },
  HUG_POINT: { id: "hug-point", name: "Hug Point", place: "Arch Cape, Oregon", station: "Garibaldi, Oregon", stationId: "9437540", authority: "Oregon State Parks" },
  THORS_WELL: { id: "thors-well", name: "Thor's Well", place: "Cape Perpetua, Oregon", station: "Waldport, Oregon", stationId: "9434939", authority: "Siuslaw National Forest" },
};

function tides(site, date) {
  const rows = site === SITE.HAYSTACK || site === SITE.HUG_POINT
    ? [["high", "5:04 AM", 304, 6.6], ["low", "10:02 AM", 602, 3.19], ["high", "4:19 PM", 979, 8.65]]
    : site === SITE.THORS_WELL
      ? [["high", "5:38 AM", 338, 6.2], ["low", "10:41 AM", 641, 2.6], ["high", "4:52 PM", 1012, 7.9]]
      : [["high", "5:31 AM", 331, 6.4], ["low", "9:47 AM", 587, 2.7], ["high", "4:43 PM", 1003, 8.1]];
  return rows.map(([type, clock, minute_of_day, height_ft]) => ({ type, clock, minute_of_day, height_ft, local_time: `${date} ${String(Math.floor(minute_of_day / 60)).padStart(2, "0")}:${String(minute_of_day % 60).padStart(2, "0")}` }));
}

function decisionFor(site, date) {
  if (site === SITE.YAQUINA) {
    if (date === "2026-10-01") return engine.evaluate(site, { date, discovery: "8:30 – 10:30a", closing: "6:00p", source });
    if (date === "2026-10-03") return engine.evaluate(site, { date, discovery: "No Exposure", closing: "7:00p", source });
    if (date === "2026-10-28") return engine.evaluate(site, { date, discovery: "8:00 – 8:45p", closing: "6:00p", source });
    return engine.evaluate(site, { date, source: { status: "unavailable" } });
  }
  if (site === SITE.HAYSTACK) return engine.evaluate(site, { date, daylight_low_ft: date === "2026-10-02" ? 0.7 : 2.7, low_tide_time: "9:47 AM", threshold_ft: 1, source });
  if (site === SITE.HUG_POINT) return engine.evaluate(site, { date, low_tide_opportunity: true, low_tide_time: "10:02 AM", hazard_veto: date === "2026-10-02", hazard_reason: date === "2026-10-02" ? "High Surf Warning" : null, source });
  return engine.evaluate(site, { date, source });
}

function sitePayload(site, date) {
  const m = meta[site];
  const decision = decisionFor(site, date);
  const hazards = decision.status === "HAZARD_VETO" ? [{ event: "High Surf Warning", severity: "Severe", headline: "Large breaking waves are expected along the coast.", source: "National Weather Service" }] : [];
  return {
    id: m.id,
    site,
    name: m.name,
    place: m.place,
    claim_type: site === SITE.YAQUINA ? "official_schedule" : site === SITE.HAYSTACK ? "authority_threshold" : site === SITE.HUG_POINT ? "conservative_access" : "research_only",
    coordinates: { lat: 44.6, lon: -124.0 },
    decision,
    context: {
      tides: tides(site, date),
      tide_station: m.stationId,
      tide_station_name: m.station,
      datum: "MLLW",
      daylight: { sunrise_minute: 436, sunset_minute: 1138, sunrise_clock: "7:16 AM", sunset_clock: "6:58 PM" },
      hazards,
      marine: site === SITE.THORS_WELL ? { status: "ok", observation: { station: "46050", station_name: "Stonewall Bank", age_minutes: 42, wave_height_ft: 5.2, wave_period_s: 12, wave_direction_deg: 285, wind_speed_mph: 11 } } : null,
    },
    sources: [
      { role: site === SITE.YAQUINA ? "window" : site === SITE.HAYSTACK ? "rule" : site === SITE.HUG_POINT ? "access guidance" : "site context", agency: m.authority, status: decision.status === "SOURCE_UNAVAILABLE" ? "unavailable" : "ok", url: "https://example.test/authority", detail: site === SITE.YAQUINA ? "Published discovery schedule" : "Site-specific authority guidance", direct: true },
      { role: "tide", agency: "NOAA CO-OPS", status: "ok", url: "https://example.test/noaa", detail: `${m.station} · MLLW`, direct: false },
      ...(site === SITE.THORS_WELL ? [{ role: "waves", agency: "NOAA National Data Buoy Center", status: "ok", url: "https://example.test/ndbc", detail: "Stonewall Bank buoy 46050", direct: false }] : []),
      ...(hazards.length ? [{ role: "hazards", agency: "National Weather Service", status: "ok", url: "https://example.test/nws", detail: "1 active alert", direct: false }] : []),
    ],
  };
}

function desk(date) {
  return {
    date,
    time_zone: "America/Los_Angeles",
    retrieved_at: new Date().toISOString(),
    engine: "oregon-window-engine",
    engine_contract: "visual-fixture-2026-10-01",
    sites: [SITE.YAQUINA, SITE.HAYSTACK, SITE.HUG_POINT, SITE.THORS_WELL].map(site => sitePayload(site, date)),
    supported_states: Object.values(engine.STATUS),
  };
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/national-tools/coastal/oregon/_api/decision") {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? url.searchParams.get("date") : "2026-10-01";
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(desk(date)));
    return;
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!rel) rel = "index.html";
  let file = path.join(publicRoot, rel);
  if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
  if (!file.startsWith(publicRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => console.log(`Oregon frontend fixture server listening on http://127.0.0.1:${port}`));
