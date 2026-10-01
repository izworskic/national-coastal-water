const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../api/oregon-window-engine");
const adapter = require("../api/oregon-coastal");

test("authoritative hazard veto dominates every Oregon site claim type", () => {
  for (const site of Object.values(engine.SITE)) {
    const result = engine.evaluate(site, {
      date: "2026-10-01",
      hazard_veto: true,
      hazard_reason: "High Surf Warning",
      source: { status: "ok" },
      discovery: "8:30 – 10:30a",
      closing: "6:00p",
      daylight_low_ft: 0.4,
      low_tide_opportunity: true,
    });
    assert.equal(result.status, engine.STATUS.HAZARD_VETO, `${site} must be vetoed`);
    assert.equal(result.reason_code, "High Surf Warning");
    assert.equal(result.window, null);
  }
});

test("hazard veto also dominates missing source guidance", () => {
  const result = engine.evaluate(engine.SITE.YAQUINA, {
    date: "2026-10-02",
    hazard_veto: true,
    hazard_reason: "Tsunami Warning",
    source: { status: "unavailable" },
  });
  assert.equal(result.status, engine.STATUS.HAZARD_VETO);
  assert.equal(result.window, null);
});

test("astronomical daylight context is plausible for the Oregon coast", () => {
  const meta = adapter._test.SITE_META[engine.SITE.YAQUINA];
  const daylight = adapter._test.daylightContext(meta, "2026-10-01");
  assert.ok(daylight);
  assert.ok(daylight.sunrise_minute > 6 * 60 && daylight.sunrise_minute < 9 * 60, daylight.sunrise_clock);
  assert.ok(daylight.sunset_minute > 17 * 60 && daylight.sunset_minute < 20 * 60, daylight.sunset_clock);
  assert.ok(daylight.sunset_minute > daylight.sunrise_minute);
});

test("daylight-low selection honors the actual daylight interval", () => {
  const tides = [
    { type: "low", minute_of_day: 5 * 60, height_ft: -0.5, clock: "5:00 AM" },
    { type: "low", minute_of_day: 10 * 60, height_ft: 0.8, clock: "10:00 AM" },
    { type: "low", minute_of_day: 22 * 60, height_ft: -1.0, clock: "10:00 PM" },
  ];
  const low = adapter._test.pickDaylightLow(tides, { sunrise_minute: 7 * 60, sunset_minute: 19 * 60 });
  assert.equal(low.clock, "10:00 AM");
});

test("hard-hazard classifier is narrow and authority oriented", () => {
  assert.equal(adapter._test.hardHazard([{ event: "High Surf Warning" }]).event, "High Surf Warning");
  assert.equal(adapter._test.hardHazard([{ event: "Tsunami Advisory" }]).event, "Tsunami Advisory");
  assert.equal(adapter._test.hardHazard([{ event: "Small Craft Advisory" }]), null);
});
