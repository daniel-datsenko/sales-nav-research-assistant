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

// Conservative: only an exact match counts unless the candidate explicitly
// signals truncation with a trailing ellipsis. This prevents false-positive
// matches on random UI buttons whose text happens to share a prefix or contain
// the target as substring (e.g. "DDS PL Wave 1 2026-05-12" matching a
// "Search saved lists DDS..." input). The Hard-Cap in sdr-workflow.js
// guarantees normal list names never get truncated in the first place; this
// helper is the defense-in-depth fallback for edge cases.
function matchesSalesNavLabel(fullName, candidateText, options = {}) {
  const target = normalizeLabelText(fullName);
  const candidateRaw = normalizeLabelText(candidateText);
  if (!target || !candidateRaw) return false;
  const candidate = stripTruncationMarker(candidateRaw);
  if (!candidate) return false;
  if (target === candidate) return true;
  const wasTruncated = TRUNCATION_MARKERS.test(candidateRaw);
  if (wasTruncated && candidate.length >= MIN_PREFIX_LEN && target.startsWith(candidate)) {
    return true;
  }
  // Substring containment is only safe on attributes where the full target is
  // usually embedded (aria-label, title) - never on arbitrary innerText. Callers
  // must explicitly opt in via options.allowContains.
  if (options.allowContains && candidate.length > target.length && candidate.toLowerCase().includes(target.toLowerCase())) {
    return true;
  }
  return false;
}

function matchesSalesNavLabelAcrossAttributes(fullName, { text, title, aria } = {}) {
  // innerText: strict (exact or explicitly truncated). Avoids matching the
  // target as a substring of random nearby UI text.
  if (matchesSalesNavLabel(fullName, text)) return true;
  // title attribute: full string is usually verbatim. Allow contains as a soft
  // fallback in case Sales Nav wraps the name (e.g. quotes).
  if (matchesSalesNavLabel(fullName, title, { allowContains: true })) return true;
  // aria-label: often contains the target inside a descriptive sentence like
  // "Save this lead to <name>". Allow contains here too.
  if (matchesSalesNavLabel(fullName, aria, { allowContains: true })) return true;
  return false;
}

// Browser-side equivalent for use inside page.evaluate / harness JS payloads.
// Returns a serializable function source string so callers can inject it.
function browserSideMatcherSource() {
  return `function matchesSalesNavLabel(fullName, candidateText, opts) {
  opts = opts || {};
  var normalize = function (value) { return String(value || '').replace(/\\s+/g, ' ').trim(); };
  var TRUNC = /…|\\.{3}$/u;
  var target = normalize(fullName);
  var candidateRaw = normalize(candidateText);
  if (!target || !candidateRaw) return false;
  var candidate = candidateRaw.replace(TRUNC, '').trim();
  if (!candidate) return false;
  if (target === candidate) return true;
  var wasTruncated = TRUNC.test(candidateRaw);
  if (wasTruncated && candidate.length >= 8 && target.startsWith(candidate)) return true;
  if (opts.allowContains && candidate.length > target.length && candidate.toLowerCase().indexOf(target.toLowerCase()) >= 0) return true;
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
