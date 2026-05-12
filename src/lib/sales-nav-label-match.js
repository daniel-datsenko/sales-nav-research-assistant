// Robust list-label matching for Sales Navigator UI.
//
// Why this exists: Sales Nav truncates list names in DOM `innerText` once they
// exceed ~32 chars, but keeps the full string in `title` and `aria-label`.
// Naive `innerText === target` comparisons fail on truncated text and trigger
// the list-duplication bug documented in
// runtime/BUG-REPORT-list-duplication-2026-05-12.md.
//
// Match strategy, ordered:
//   1. exact match against full text / title / aria
//   2. target contains text (truncated visible is a prefix of full target)
//   3. text contains target (full target embedded in a longer label)
//
// Anti-false-positive guards:
//   - empty strings never match
//   - text shorter than MIN_PREFIX_LEN is rejected for prefix-match
//   - "create new list" / "saved searches" labels are explicitly excluded by callers

const MIN_PREFIX_LEN = 8;
const TRUNCATION_MARKERS = /…|\.{3}$/u;

function normalizeLabelText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripTruncationMarker(value) {
  return normalizeLabelText(value).replace(TRUNCATION_MARKERS, '').trim();
}

function matchesSalesNavLabel(fullName, candidateText) {
  const target = normalizeLabelText(fullName);
  const candidate = stripTruncationMarker(candidateText);
  if (!target || !candidate) return false;
  if (target === candidate) return true;
  if (candidate.length >= MIN_PREFIX_LEN && target.startsWith(candidate)) return true;
  if (candidate.toLowerCase().includes(target.toLowerCase())) return true;
  return false;
}

function matchesSalesNavLabelAcrossAttributes(fullName, { text, title, aria } = {}) {
  return (
    matchesSalesNavLabel(fullName, text)
    || matchesSalesNavLabel(fullName, title)
    || matchesSalesNavLabel(fullName, aria)
  );
}

// Browser-side equivalent for use inside page.evaluate / harness JS payloads.
// Returns a serializable function source string so callers can inject it.
function browserSideMatcherSource() {
  return `function matchesSalesNavLabel(fullName, candidateText) {
  var normalize = function (value) { return String(value || '').replace(/\\s+/g, ' ').trim(); };
  var stripTrunc = function (value) { return normalize(value).replace(/…|\\.{3}$/u, '').trim(); };
  var target = normalize(fullName);
  var candidate = stripTrunc(candidateText);
  if (!target || !candidate) return false;
  if (target === candidate) return true;
  if (candidate.length >= 8 && target.startsWith(candidate)) return true;
  if (candidate.toLowerCase().indexOf(target.toLowerCase()) >= 0) return true;
  return false;
}`;
}

module.exports = {
  MIN_PREFIX_LEN,
  matchesSalesNavLabel,
  matchesSalesNavLabelAcrossAttributes,
  browserSideMatcherSource,
  normalizeLabelText,
  stripTruncationMarker,
};
