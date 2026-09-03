const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const coastal = require("../api/national-coastal");

const T = coastal._test;

test("coastal risk normalization never invents a category", () => {
  assert.equal(T.risk("High Risk"), "high");
  assert.equal(T.risk("Moderate"), "moderate");
  assert.equal(T.risk("Low"), "low");
  assert.equal(T.risk("None issued"), "unavailable");
  assert.equal(T.risk(null), "unavailable");
});

test("NDBC active station XML preserves station identity and capabilities", () => {
  const rows = T.ndbcStations('<stations><station id="45003" lat="45.351" lon="-82.840" name="North Huron" owner="NDBC" met="y" waterquality="n"/></stations>');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: "45003",
    name: "North Huron",
    owner: "NDBC",
    latitude: 45.351,
    longitude: -82.84,
    met: true,
    waterquality: false,
  });
});

test("NDBC observations convert units and calculate roughly three-hour change", () => {
  const fixture = [
    "#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE",
    "#yr mo dy hr mn degT m/s m/s m sec sec degT hPa degC degC degC nmi hPa ft",
    "2026 09 02 12 00 180 5.0 7.0 1.2 8 7 190 1013.2 20.0 18.0 15.0 MM MM MM",
    "2026 09 02 09 00 170 4.0 6.0 0.9 7 6 180 1014.0 19.0 17.5 14.0 MM MM MM",
  ].join("\n");
  const rows = T.ndbcRows(fixture);
  assert.equal(rows.length, 2);
  const result = T.obs({ id:"45003", name:"North Huron", owner:"NDBC", latitude:45.351, longitude:-82.84, distance_miles:18.4 }, rows);
  assert.equal(result.station.id, "45003");
  assert.equal(result.station.distance_miles, 18.4);
  assert.equal(result.wave_height_ft, 3.9);
  assert.equal(result.wind_mph, 11.2);
  assert.equal(result.water_temperature_f, 64.4);
  assert.equal(result.change_3h.wave_height_ft, 0.9);
  assert.equal(result.change_3h.wind_mph, 2.3);
});

test("NDBC missing sensor values remain unavailable", () => {
  const fixture = [
    "#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP",
    "2026 09 02 12 00 MM MM MM MM MM MM MM MM MM MM",
  ].join("\n");
  const row = T.ndbcRows(fixture)[0];
  assert.equal(row.wind_mps, null);
  assert.equal(row.wave_m, null);
  assert.equal(row.water_temp_c, null);
});

test("High official beach risk remains the dominant decision", () => {
  const result = T.summary(
    { rip_swim_risk_code:"high", rip_swim_risk:"High" },
    { rip_swim_risk_code:"low", rip_swim_risk:"Low" },
    { change_3h:{ wave_height_ft:-2, wind_mph:-8 }, wave_height_ft:1, wind_mph:4 },
    { predictions:[{ type:"low", time:"2026-09-02T18:00:00.000Z", height_ft:0.5 }] }
  );
  assert.equal(result.level, "high");
  assert.match(result.headline, /High official rip\/swim risk/);
  assert.match(result.detail, /dominant signal/);
  assert.doesNotMatch(result.detail, /safe/i);
});

test("No source coverage stays unavailable instead of neutral", () => {
  const result = T.summary(null, null, null, null);
  assert.equal(result.level, "inland-or-uncovered");
  assert.match(result.detail, /No NWS beach forecast/);
});

test("coastal admission rejects distant beach coverage instead of using nearby-looking source data", () => {
  const result = T.coastalAdmission(
    { distance_miles: 67.4 },
    { distance_miles: 68.1 },
    [{ status:"fulfilled" }, { status:"fulfilled" }]
  );
  assert.equal(T.ADMISSION_MILES, 25);
  assert.equal(result.eligible, false);
  assert.equal(result.status, "not-applicable");
  assert.equal(result.nearest_beach_forecast_miles, 67.4);
  assert.match(result.reason, /beyond this tool's 25-mile coastal admission boundary/);
});

test("coastal admission accepts a place close to an NWS beach forecast area", () => {
  const result = T.coastalAdmission(
    { distance_miles: 3.2 },
    null,
    [{ status:"fulfilled" }, { status:"fulfilled" }]
  );
  assert.equal(result.eligible, true);
  assert.equal(result.status, "eligible");
  assert.equal(result.nearest_beach_forecast_miles, 3.2);
});

test("coastal admission fails closed when NWS applicability cannot be checked", () => {
  const result = T.coastalAdmission(
    null,
    null,
    [{ status:"rejected" }, { status:"rejected" }]
  );
  assert.equal(result.eligible, false);
  assert.equal(result.status, "coverage-unverified");
  const decision = T.locationDecision(result);
  assert.equal(decision.level, "coverage-unverified");
  assert.match(decision.detail, /will not substitute distant buoy or tide data/);
});

test("not-applicable coastal locations get an explicit redirect decision", () => {
  const result = T.locationDecision({ status:"not-applicable", reason:"Nearest beach forecast is too far away." });
  assert.equal(result.level, "not-applicable");
  assert.match(result.headline, /outside the coastal\/beach area/);
  assert.match(result.what_next, /River Conditions|Outdoor Desk/);
});

test("CO-OPS request stays a high-low tide prediction on MLLW", () => {
  const url = new URL(T.tideUrl("9414290", new Date("2026-09-02T12:00:00Z")));
  assert.equal(url.searchParams.get("product"), "predictions");
  assert.equal(url.searchParams.get("interval"), "hilo");
  assert.equal(url.searchParams.get("datum"), "MLLW");
  assert.equal(url.searchParams.get("time_zone"), "gmt");
  assert.equal(url.searchParams.get("units"), "english");
});

test("coastal canonical exposes source truth, entity integrity and privacy-safe analytics", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/national-tools/coastal/index.html"), "utf8");
  assert.match(html, /<link rel="canonical" href="https:\/\/chrisizworski\.com\/national-tools\/coastal\/">/);
  assert.match(html, /"@id":"https:\/\/chrisizworski\.com\/#person"/);
  assert.match(html, /"dateModified":"2026-09-02"/);
  assert.match(html, /official beach-risk forecast/i);
  assert.match(html, /does not declare swimming or boating safe/);
  assert.match(html, /Source proximity is not location eligibility/);
  assert.match(html, /not a coastal location for this tool/);
  assert.match(html, /Michigan has a deeper beach network/);
  assert.match(html, /National Coastal Result/);
  const event = html.match(/N\.track\("National Coastal Result",[\s\S]{0,250}/)?.[0] || "";
  assert.doesNotMatch(event, /latitude|longitude|query|place/);
});

test("coastal API keeps authoritative sources independent and keyless", () => {
  const src = fs.readFileSync(path.join(__dirname, "../api/national-coastal.js"), "utf8");
  assert.match(src, /Promise\.allSettled/);
  assert.match(src, /marine_beachforecast_summary/);
  assert.match(src, /activestations\.xml/);
  assert.match(src, /data\/realtime2/);
  assert.match(src, /mdapi\/prod\/webapi\/stations\.json\?type=tidepredictions/);
  assert.doesNotMatch(src, /API_KEY|apiKey|Authorization|Bearer/);
});
