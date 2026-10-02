const test = require('node:test');
const assert = require('node:assert/strict');
const cfg = require('../vercel.json');

const rewrites = new Map((cfg.rewrites || []).map(route => [route.source, route.destination]));
const pages = {
  '/national-tools/coastal/oregon': '/national-tools/coastal/oregon/index.html',
  '/national-tools/coastal/oregon/': '/national-tools/coastal/oregon/index.html',
  '/national-tools/coastal/oregon/yaquina-head': '/national-tools/coastal/oregon/yaquina-head/index.html',
  '/national-tools/coastal/oregon/yaquina-head/': '/national-tools/coastal/oregon/yaquina-head/index.html',
  '/national-tools/coastal/oregon/haystack-rock': '/national-tools/coastal/oregon/haystack-rock/index.html',
  '/national-tools/coastal/oregon/haystack-rock/': '/national-tools/coastal/oregon/haystack-rock/index.html',
  '/national-tools/coastal/oregon/hug-point': '/national-tools/coastal/oregon/hug-point/index.html',
  '/national-tools/coastal/oregon/hug-point/': '/national-tools/coastal/oregon/hug-point/index.html',
  '/national-tools/coastal/oregon/thors-well': '/national-tools/coastal/oregon/thors-well/index.html',
  '/national-tools/coastal/oregon/thors-well/': '/national-tools/coastal/oregon/thors-well/index.html'
};

test('Oregon clean URLs explicitly resolve to their static index pages', () => {
  for (const [source, destination] of Object.entries(pages)) {
    assert.equal(rewrites.get(source), destination, `${source} must resolve to ${destination}`);
  }
});

test('Oregon decision API remains routed to the server adapter', () => {
  assert.equal(
    rewrites.get('/national-tools/coastal/oregon/_api/decision'),
    '/api/oregon-coastal'
  );
});
