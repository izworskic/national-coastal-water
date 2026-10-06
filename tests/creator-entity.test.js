const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_URL = 'https://chrisizworski.com/national-tools/coastal/';
const PERSON_ID = 'https://chrisizworski.com/#person';
const html = fs.readFileSync(path.join(__dirname, '..', 'public/national-tools/coastal/index.html'), 'utf8');

function types(node) {
  return Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
}

function walk(value, nodes = []) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, nodes);
  } else if (value && typeof value === 'object') {
    nodes.push(value);
    for (const child of Object.values(value)) walk(child, nodes);
  }
  return nodes;
}

function initialJsonLd(source) {
  const open = '<script type="application/ld+json">';
  const close = '</script>';
  const blocks = [];
  let cursor = 0;
  while (true) {
    const start = source.indexOf(open, cursor);
    if (start < 0) break;
    const bodyStart = start + open.length;
    const end = source.indexOf(close, bodyStart);
    assert.ok(end >= 0, 'JSON-LD script must close');
    blocks.push(JSON.parse(source.slice(bodyStart, end)));
    cursor = end + close.length;
  }
  assert.ok(blocks.length > 0, 'initial HTML must contain parseable JSON-LD');
  return blocks.flatMap(block => walk(block));
}

test('initial page HTML defines Chris and links the application as author and publisher', () => {
  assert.ok(html.includes('<title>Beach &amp; Coastal Conditions Today | Chris Izworski</title>'), 'existing title stays intact');
  assert.ok(html.includes('<link rel="canonical" href="https://chrisizworski.com/national-tools/coastal/">'), 'canonical stays intact');
  assert.ok(html.includes('<h1>Beach &amp; Coastal Conditions Near Me</h1>'), 'initial useful heading stays intact');

  const nodes = initialJsonLd(html);
  const people = nodes.filter(node => types(node).includes('Person') && node['@id'] === PERSON_ID);
  assert.equal(people.length, 1, 'page must define exactly one canonical Person');
  assert.equal(people[0].name, 'Chris Izworski');
  assert.equal(people[0].url, 'https://chrisizworski.com/');

  const applications = nodes.filter(node =>
    (types(node).includes('SoftwareApplication') || types(node).includes('WebApplication'))
    && node.url === PAGE_URL
  );
  assert.equal(applications.length, 1, 'canonical page must have one application node');
  const [application] = applications;
  const pointsToChris = value => Array.isArray(value)
    ? value.some(pointsToChris)
    : value === PERSON_ID || value?.['@id'] === PERSON_ID;
  assert.ok(
    pointsToChris(application.author) || pointsToChris(application.creator),
    'application must reference the canonical Person as author or creator'
  );
  assert.ok(pointsToChris(application.publisher), 'application must reference the canonical Person as publisher');
});
