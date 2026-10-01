import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const parentPath = path.join(root, "public/national-tools/coastal/index.html");
const sitemapPath = path.join(root, "public/national-tools/coastal/sitemap-locations.xml");
const marker = "data-oregon-opportunity";
const urls = [
  "https://chrisizworski.com/national-tools/coastal/oregon/",
  "https://chrisizworski.com/national-tools/coastal/oregon/yaquina-head/",
  "https://chrisizworski.com/national-tools/coastal/oregon/haystack-rock/",
  "https://chrisizworski.com/national-tools/coastal/oregon/hug-point/",
  "https://chrisizworski.com/national-tools/coastal/oregon/thors-well/",
];

let parent = fs.readFileSync(parentPath, "utf8");
parent = parent.replace(new RegExp(`<section[^>]*${marker}[\\s\\S]*?<\\/section>`, "i"), "");
const section = `<section class="section" ${marker}><div class="wrap"><div style="border:1px solid #ddd7cb;background:#fff;padding:18px;border-radius:6px"><div class="eyebrow">Oregon Coast decision desk</div><h2>What coastal experience is worth doing today?</h2><p>Compare Yaquina Head, Haystack Rock, Hug Point and Thor's Well using site-specific authority rules, tide context and coastal hazards without flattening unlike evidence into one score.</p><p><a href="/national-tools/coastal/oregon/"><strong>Open Oregon coastal windows →</strong></a></p></div></div></section>`;
if (!parent.includes("</main>")) throw new Error("Coastal hub has no </main> insertion point");
parent = parent.replace("</main>", `${section}</main>`);
fs.writeFileSync(parentPath, parent);

if (!fs.existsSync(sitemapPath)) throw new Error("Generated coastal sitemap is missing");
let sitemap = fs.readFileSync(sitemapPath, "utf8");
for (const url of urls) {
  if (!sitemap.includes(`<loc>${url}</loc>`)) sitemap = sitemap.replace("</urlset>", `  <url><loc>${url}</loc><changefreq>daily</changefreq></url>\n</urlset>`);
}
fs.writeFileSync(sitemapPath, sitemap);

const verifiedParent = fs.readFileSync(parentPath, "utf8");
const verifiedSitemap = fs.readFileSync(sitemapPath, "utf8");
if (!verifiedParent.includes(marker) || !verifiedParent.includes("/national-tools/coastal/oregon/")) throw new Error("Oregon coastal hub link was not written");
for (const url of urls) if (!verifiedSitemap.includes(`<loc>${url}</loc>`)) throw new Error(`Missing Oregon sitemap URL: ${url}`);
console.log(`Linked Oregon coastal opportunity desk and ${urls.length} sitemap URLs.`);
