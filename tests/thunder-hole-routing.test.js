const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const cfg=JSON.parse(fs.readFileSync('vercel.json','utf8'));
const html=fs.readFileSync('public/national-tools/thunder-hole-live/index.html','utf8');
const app=fs.readFileSync('public/national-tools/thunder-hole-live/app.js','utf8');
const rewrites=new Map((cfg.rewrites||[]).map(x=>[x.source,x.destination]));
const canonical='https://chrisizworski.com/national-tools/coastal/thunder-hole-live/';

test('Thunder Hole uses the existing direct coastal production route',()=>{
  assert.equal(rewrites.get('/national-tools/coastal/thunder-hole-live'),'/national-tools/thunder-hole-live/index.html');
  assert.equal(rewrites.get('/national-tools/coastal/thunder-hole-live/'),'/national-tools/thunder-hole-live/index.html');
  assert.equal(rewrites.get('/national-tools/coastal/thunder-hole-live/:path*'),'/national-tools/thunder-hole-live/:path*');
  assert.equal(rewrites.get('/national-tools/coastal/thunder-hole-live/_api/live'),'/api/thunder-hole');
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`));
  assert.ok(html.includes('/national-tools/coastal/thunder-hole-live/styles.css'));
  assert.ok(html.includes('/national-tools/coastal/thunder-hole-live/app.js'));
  assert.ok(app.includes("fetch('/national-tools/coastal/thunder-hole-live/_api/live'"));
});
