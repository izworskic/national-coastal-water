import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:4173";
const out = process.env.SCREENSHOT_DIR || path.resolve("artifacts/oregon-coastal");
fs.mkdirSync(out, { recursive: true });

const cases = [
  { name: "overview-390", width: 390, height: 844, path: "/national-tools/coastal/oregon/?date=2026-10-01", expect: "Go 8:30 AM–10:30 AM", firstViewport: true },
  { name: "yaquina-430", width: 430, height: 932, path: "/national-tools/coastal/oregon/yaquina-head/?date=2026-10-01", expect: "Go 8:30 AM–10:30 AM", firstViewport: true },
  { name: "haystack-390", width: 390, height: 844, path: "/national-tools/coastal/oregon/haystack-rock/?date=2026-10-01", expect: "Not a tidepool day here", firstViewport: true },
  { name: "hug-tablet", width: 768, height: 1024, path: "/national-tools/coastal/oregon/hug-point/?date=2026-10-01", expect: "Target the lower-tide period" },
  { name: "thor-desktop", width: 1440, height: 1000, path: "/national-tools/coastal/oregon/thors-well/?date=2026-10-01", expect: "Conditions available — spectacle window not verified" },
  { name: "yaquina-conflict", width: 390, height: 844, path: "/national-tools/coastal/oregon/yaquina-head/?date=2026-10-28", expect: "Official information conflicts" },
  { name: "hug-hazard", width: 390, height: 844, path: "/national-tools/coastal/oregon/hug-point/?date=2026-10-02", expect: "Coastal hazard active", firstViewport: true },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const c of cases) {
    const page = await browser.newPage({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
    await page.goto(`${base}${c.path}`, { waitUntil: "networkidle" });
    await page.getByText(c.expect, { exact: false }).first().waitFor({ state: "visible", timeout: 8000 });
    const bodyText = await page.locator("body").innerText();
    assert.match(bodyText, new RegExp(c.expect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    assert.doesNotMatch(bodyText, /SAFE NOW|SAFE UNTIL|SAFE TO APPROACH|SAFE TIDE|SAFE CONDITIONS/i);
    assert.doesNotMatch(bodyText, /\bFAIR\b|\bGOOD\b|\bBAD\b/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${c.name} has ${overflow}px horizontal overflow`);
    if (c.firstViewport) {
      const target = page.getByText(c.expect, { exact: false }).first();
      const box = await target.boundingBox();
      assert.ok(box && box.y < c.height, `${c.name} primary decision is below the first viewport`);
    }
    assert.deepEqual(errors, [], `${c.name} browser errors: ${errors.join(" | ")}`);
    await page.screenshot({ path: path.join(out, `${c.name}.png`), fullPage: true });
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/national-tools/coastal/oregon/yaquina-head/?date=2026-10-03`, { waitUntil: "networkidle" });
  await page.getByText("No official tidepool exposure window today", { exact: false }).waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), /Go \d{1,2}:\d{2}/i);
  await page.screenshot({ path: path.join(out, "yaquina-no-exposure.png"), fullPage: true });
  await page.close();

  console.log(`Captured ${cases.length + 1} verified screenshots in ${out}`);
} finally {
  await browser.close();
}
