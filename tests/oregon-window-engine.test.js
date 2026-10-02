const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../api/oregon-window-engine");

const { STATUS, SITE } = engine;
const T = engine._test;
const SOURCE = Object.freeze({ status: "ok" });

test("YAQUINA 2026-10-01 preserves the official 8:30–10:30 AM discovery window", () => {
  const result = engine.evaluate(SITE.YAQUINA, {
    date: "2026-10-01", discovery: "8:30 – 10:30a", closing: "6:00p", source: SOURCE,
  });
  assert.equal(result.status, STATUS.OFFICIAL_WINDOW);
  assert.equal(result.reason_code, "PUBLISHED_TIDEPOOL_DISCOVERY_WINDOW");
  assert.equal(result.window.start_minute, 8 * 60 + 30);
  assert.equal(result.window.end_minute, 10 * 60 + 30);
  assert.equal(result.windows.length, 1);
  assert.equal(result.auto_corrected, false);
});

test("YAQUINA supports multiple official discovery intervals without inventing a merged window", () => {
  const result = engine.evaluate(SITE.YAQUINA, {
    date: "2026-09-10",
    discovery_windows: ["8:00 – 8:45a", "4:30 – 5:45p"],
    closing: "6:00p",
    source: SOURCE,
  });
  assert.equal(result.status, STATUS.OFFICIAL_WINDOW);
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[0].start_minute, 8 * 60);
  assert.equal(result.windows[1].start_minute, 16 * 60 + 30);
  assert.equal(result.window, result.windows[0]);
});

test("YAQUINA 2026-10-03 maps the official No Exposure entry to NO_OPPORTUNITY", () => {
  const result = engine.evaluate(SITE.YAQUINA, {
    date: "2026-10-03", discovery: "No Exposure", closing: "7:00p", source: SOURCE,
  });
  assert.equal(result.status, STATUS.NO_OPPORTUNITY);
  assert.equal(result.reason_code, "NO_EXPOSURE");
  assert.equal(result.window, null);
});

test("YAQUINA 2026-10-28 fails closed when the published PM window conflicts with closing time", () => {
  const result = engine.evaluate(SITE.YAQUINA, {
    date: "2026-10-28", discovery: "8:00 – 8:45p", closing: "6:00p", source: SOURCE,
  });
  assert.equal(result.status, STATUS.SOURCE_CONFLICT);
  assert.equal(result.reason_code, "OFFICIAL_WINDOW_AFTER_CLOSING");
  assert.equal(result.source_window.start_minute, 20 * 60);
  assert.equal(result.source_window.end_minute, 20 * 60 + 45);
  assert.equal(result.closing.minute_of_day, 18 * 60);
  assert.equal(result.window, null);
  assert.equal(result.auto_corrected, false);
});

test("published window parser never silently flips PM to AM", () => {
  const parsed = T.parsePublishedWindow("8:00 – 8:45p");
  assert.equal(parsed.start_minute, 20 * 60);
  assert.equal(parsed.end_minute, 20 * 60 + 45);
  assert.equal(parsed.start_meridiem, "p");
  assert.equal(parsed.end_meridiem, "p");
  assert.equal(parsed.auto_corrected, false);
});

test("HAYSTACK 2026-10-01 has NO_OPPORTUNITY when the daylight low exceeds HRAP's <=1.0 ft rule", () => {
  const result = engine.evaluate(SITE.HAYSTACK, {
    date: "2026-10-01", daylight_low_ft: 2.7, low_tide_time: "9:47 AM", threshold_ft: 1.0, source: SOURCE,
  });
  assert.equal(result.status, STATUS.NO_OPPORTUNITY);
  assert.equal(result.reason_code, "DAYLIGHT_LOW_ABOVE_HRAP_THRESHOLD");
  assert.equal(result.threshold_ft, 1.0);
  assert.equal(result.daylight_low_ft, 2.7);
  assert.equal(result.window, null);
});

test("HAYSTACK threshold is inclusive at exactly 1.0 ft", () => {
  const result = engine.evaluate(SITE.HAYSTACK, { date: "fixture", daylight_low_ft: 1.0, source: SOURCE });
  assert.equal(result.status, STATUS.TIDEPOOL_OPPORTUNITY);
});

test("HUG_POINT emits only a conservative access opportunity and never an exact safe-until timestamp", () => {
  const result = engine.evaluate(SITE.HUG_POINT, {
    date: "fixture", low_tide_opportunity: true, low_tide_time: "10:00 AM", low_tide_ft: 0.4, source: SOURCE,
  });
  assert.equal(result.status, STATUS.CONSERVATIVE_ACCESS_OPPORTUNITY);
  assert.equal(result.exact_cutoff, false);
  assert.equal(result.safe_until, null);
  assert.equal(result.window, null);
  assert.equal(result.safe, null);
  assert.equal(result.low_tide_ft, 0.4);
});

test("HUG_POINT hazard veto dominates a low-tide opportunity", () => {
  const result = engine.evaluate(SITE.HUG_POINT, {
    date: "fixture", low_tide_opportunity: true, hazard_veto: true, hazard_reason: "HIGH_SURF_WARNING", source: SOURCE,
  });
  assert.equal(result.status, STATUS.HAZARD_VETO);
  assert.equal(result.safe_until, null);
});

test("THORS_WELL remains RESEARCH_ONLY even when favorable-looking tide and wave inputs are supplied", () => {
  const result = engine.evaluate(SITE.THORS_WELL, {
    date: "fixture", tide_ft: 5.8, wave_height_ft: 6.2, wave_period_sec: 12, source: SOURCE,
  });
  assert.equal(result.status, STATUS.RESEARCH_ONLY);
  assert.equal(result.reason_code, "INSUFFICIENT_CALIBRATION_EVIDENCE");
  assert.equal(result.classifier_enabled, false);
  assert.equal(result.production_window, null);
  assert.equal(result.window, null);
});

test("stale and unavailable source inputs fail closed as distinct states", () => {
  const stale = engine.evaluate(SITE.HAYSTACK, {
    date: "fixture", daylight_low_ft: 0.2, source: { status: "stale" },
  });
  const missing = engine.evaluate(SITE.YAQUINA, {
    date: "fixture", discovery: "8:30 – 10:30a",
  });
  assert.equal(stale.status, STATUS.SOURCE_STALE);
  assert.equal(stale.reason_code, "STALE_SOURCE");
  assert.equal(missing.status, STATUS.SOURCE_UNAVAILABLE);
});
