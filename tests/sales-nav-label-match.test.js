const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesSalesNavLabel,
  matchesSalesNavLabelAcrossAttributes,
  normalizeLabelText,
  stripTruncationMarker,
} = require('../src/lib/sales-nav-label-match');

test('matchesSalesNavLabel: exact match', () => {
  assert.equal(matchesSalesNavLabel('My List', 'My List'), true);
});

test('matchesSalesNavLabel: truncated visible text (ellipsis) is a prefix of full name', () => {
  // The Sales Nav UI truncated bug repro: full name vs visible "Foo…"
  assert.equal(matchesSalesNavLabel('Grafana - Daniel Datsenko - PZU PKO', 'Grafana - Daniel Datsenko - …'), true);
});

test('matchesSalesNavLabel: truncated visible with three dots is a prefix', () => {
  assert.equal(matchesSalesNavLabel('Grafana - Daniel Datsenko - PZU PKO', 'Grafana - Daniel Datsenko - ...'), true);
});

test('matchesSalesNavLabel: full text in title attribute matches even when visible is short', () => {
  // Caller will pass title attribute separately - matchesSalesNavLabel should treat it as a label
  assert.equal(matchesSalesNavLabel('My very long list name here', 'My very long list name here'), true);
});

test('matchesSalesNavLabel: empty inputs never match', () => {
  assert.equal(matchesSalesNavLabel('', 'My List'), false);
  assert.equal(matchesSalesNavLabel('My List', ''), false);
  assert.equal(matchesSalesNavLabel(null, null), false);
  assert.equal(matchesSalesNavLabel(undefined, 'My List'), false);
});

test('matchesSalesNavLabel: very short candidate is rejected for prefix-match (anti-false-positive)', () => {
  // "G..." should NOT match "Grafana - GTM Wave 1" because it's too short to be a meaningful prefix
  assert.equal(matchesSalesNavLabel('Grafana - GTM Wave 1', 'G…'), false);
  assert.equal(matchesSalesNavLabel('Grafana - GTM Wave 1', 'Graf'), false);
});

test('matchesSalesNavLabel: 8-char prefix is the minimum (boundary case)', () => {
  // After trim+normalize the candidate must be >= 8 chars to count as a prefix match
  assert.equal(matchesSalesNavLabel('Grafana - GTM Wave', 'Grafana '), false);  // trims to 7 chars
  assert.equal(matchesSalesNavLabel('Grafana - GTM Wave', 'Grafana -'), true);   // 9 chars, above MIN
  assert.equal(matchesSalesNavLabel('Grafana - GTM Wave', 'Grafana'), false);   // 7 chars, below MIN_PREFIX_LEN
});

test('matchesSalesNavLabel: case-insensitive substring match', () => {
  assert.equal(matchesSalesNavLabel('grafana', 'My Lists: Grafana, Foo'), true);
});

test('matchesSalesNavLabel: trims whitespace from both sides', () => {
  assert.equal(matchesSalesNavLabel('  My List  ', 'My List'), true);
  assert.equal(matchesSalesNavLabel('My List', '  My List  '), true);
  assert.equal(matchesSalesNavLabel('My  List  Name', 'My List Name'), true);  // collapsed whitespace
});

test('matchesSalesNavLabelAcrossAttributes: prefers title over truncated text', () => {
  // The classic bug scenario: visible text truncated, but title has full name
  const fullName = 'Grafana - Daniel Datsenko - PZU PKO Millennium TVN Polkomtel';
  const ok = matchesSalesNavLabelAcrossAttributes(fullName, {
    text: 'Grafana - Daniel Datsenko - PZU PKO Millenni...',
    title: fullName,
    aria: '',
  });
  assert.equal(ok, true);
});

test('matchesSalesNavLabelAcrossAttributes: works even when only aria-label has full name', () => {
  const fullName = 'Some long list name that gets truncated in UI';
  const ok = matchesSalesNavLabelAcrossAttributes(fullName, {
    text: 'Some long list...',
    title: '',
    aria: fullName,
  });
  assert.equal(ok, true);
});

test('matchesSalesNavLabelAcrossAttributes: no false positive when none of the attributes match', () => {
  const ok = matchesSalesNavLabelAcrossAttributes('Target List', {
    text: 'Different List',
    title: 'Another Thing',
    aria: 'Saved Searches',
  });
  assert.equal(ok, false);
});

test('normalizeLabelText collapses whitespace and trims', () => {
  assert.equal(normalizeLabelText('  hello\n  world  '), 'hello world');
  assert.equal(normalizeLabelText(null), '');
  assert.equal(normalizeLabelText(undefined), '');
});

test('stripTruncationMarker removes ellipsis and three-dot patterns', () => {
  assert.equal(stripTruncationMarker('Hello…'), 'Hello');
  assert.equal(stripTruncationMarker('Hello...'), 'Hello');
  assert.equal(stripTruncationMarker('Hello'), 'Hello');
  // Three dots in middle should NOT be stripped (only trailing)
  assert.equal(stripTruncationMarker('A...B'), 'A...B');
});
