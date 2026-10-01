const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const engine = require("../api/oregon-window-engine");
const adapter = require("../api/oregon-coastal");

const root = path.join(__dirname, "..", "public", "national-tools", "coastal", "oregon");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const overview = fs.readFileSync(path.join(root, "index.html"), "utf8");
const pages = {
  YAQUINA: fs.readFileSync(path.join(root, "yaquina-head", "index.html"), "utf8"),
  HAYSTACK: fs.readFileSync(path.join(root, "haystack-rock", "index.html"), "utf8"),
  HUG_POINT: fs.readFileSync(path.join(root, "hug-point", "index.html"), "utf8"),
  THORS_WELL: fs.readFileSync(path.join(root, "thors-well", "index.html"), "utf8"),
};

const SOURCE = Object.freeze({ status: "ok" });

test("frontend keeps decision logic server-side", () => {
  assert.match(app, /\/national-tools\/coastal\/oregon\/_api\/decision/);
  assert.doesNotMatch(app, /daylight_low_ft\s*[<>]=?\s*1(?:\.0)?/);
  assert.doesNotMatch(app, /evaluateYaquina|evaluateHaystack|evaluateHugPoint|evaluateThorsWell/);
});

test("all four canonical decision surfaces exist and share one client", () => {
  assert.match(overview, /Oregon Coast · opportunity desk/);
  for (const [site, html] of Object.entries(pages)) {
    assert.match(html, /\/national-tools\/coastal\/oregon\/app\.js/);
    assert.match(html, new RegExp(`data-site="${site}"`));
  }
});

test("state language is claim-specific rather than GOOD FAIR BAD", () => {
  assert.match(app, /Official window/);
  assert.match(app, /Authority threshold met/);
  assert.match(app, /Lower-tide opportunity/);
  assert.match(app, /Conditions only/);
  assert.match(app, /Official information conflicts/);
  assert.doesNotMatch(app, /\bFAIR\b|\bGOOD\b|\bBAD\b/);
});

test("frontend never displays prohibited SAFE state labels", () => {
  const visibleSource = [app, overview, ...Object.values(pages)].join("\n").toUpperCase();
  assert.doesNotMatch(visibleSource, />\s*SAFE\s*</);
  assert.doesNotMatch(visibleSource, /SAFE NOW|SAFE UNTIL|SAFE TO APPROACH|SAFE TIDE|SAFE CONDITIONS/);
});

test("Yaquina acceptance fixtures remain exact and fail closed", () => {
  const fixtures = adapter._test.YAQUINA_ACCEPTANCE;
  const oct1 = engine.evaluate(engine.SITE.YAQUINA, { date: "2026-10-01", ...fixtures["2026-10-01"], source: SOURCE });
  assert.equal(oct1.status, engine.STATUS.OFFICIAL_WINDOW);
  assert.equal(oct1.window.start_minute, 8 * 60 + 30);
  assert.equal(oct1.window.end_minute, 10 * 60 + 30);

  const oct3 = engine.evaluate(engine.SITE.YAQUINA, { date: "2026-10-03", ...fixtures["2026-10-03"], source: SOURCE });
  assert.equal(oct3.status, engine.STATUS.NO_OPPORTUNITY);
  assert.equal(oct3.window, null);

  const oct28 = engine.evaluate(engine.SITE.YAQUINA, { date: "2026-10-28", ...fixtures["2026-10-28"], source: SOURCE });
  assert.equal(oct28.status, engine.STATUS.SOURCE_CONFLICT);
  assert.equal(oct28.window, null);
  assert.equal(oct28.auto_corrected, false);
  assert.equal(oct28.source_window.start_meridiem, "p");
});

test("Haystack Oct 1 stays a deterministic non-qualifying threshold result", () => {
  const fixture = adapter._test.HAYSTACK_ACCEPTANCE["2026-10-01"];
  const result = engine.evaluate(engine.SITE.HAYSTACK, { date: "2026-10-01", ...fixture, threshold_ft: 1, source: SOURCE });
  assert.equal(result.status, engine.STATUS.NO_OPPORTUNITY);
  assert.equal(result.reason_code, "DAYLIGHT_LOW_ABOVE_HRAP_THRESHOLD");
  assert.equal(result.window, null);
});

test("Hug Point never receives an exact access cutoff", () => {
  const result = engine.evaluate(engine.SITE.HUG_POINT, { date: "2026-10-01", low_tide_opportunity: true, low_tide_time: "10:02 AM", source: SOURCE });
  assert.equal(result.status, engine.STATUS.CONSERVATIVE_ACCESS_OPPORTUNITY);
  assert.equal(result.exact_cutoff, false);
  assert.equal(result.safe_until, null);
  assert.equal(result.window, null);
  assert.match(app, /no exact cutoff is published here/i);
});

test("Thor's Well remains conditions-only with no production spectacle window", () => {
  const result = engine.evaluate(engine.SITE.THORS_WELL, { date: "2026-10-01", source: SOURCE });
  assert.equal(result.status, engine.STATUS.RESEARCH_ONLY);
  assert.equal(result.production_window, null);
  assert.equal(result.classifier_enabled, false);
  assert.match(app, /spectacle window not verified/i);
  assert.doesNotMatch(app, /(?:plus|minus|±)\s*1\s*(?:hour|hr).*high tide/i);
});

test("hazards and source conflicts have stronger visual treatment", () => {
  assert.match(css, /\.hazard-banner\{[^}]*border:2px solid var\(--danger\)/);
  assert.match(css, /\.op-card\[data-state=hazard\]/);
  assert.match(css, /\.decision-panel\[data-state=hazard\]/);
  assert.match(app, /The normal opportunity recommendation is suppressed while this hazard is active/);
});

test("390px-oriented responsive rules and accessibility hooks are present", () => {
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(overview, /aria-live="polite"/);
  assert.match(overview, /Skip to today's coastal decisions/);
  for (const html of Object.values(pages)) assert.match(html, /aria-label="Switch Oregon Coast destination"/);
});

test("meaningful analytics hooks are reused rather than a second analytics SDK", () => {
  for (const event of ["coastal_site_view", "date_changed", "location_changed", "source_details_opened", "hazard_details_opened", "research_explanation_opened"]) {
    assert.match(app, new RegExp(event));
  }
  assert.match(app, /NationalTools\.track/);
  assert.doesNotMatch(app, /mixpanel|segment|amplitude/i);
});
