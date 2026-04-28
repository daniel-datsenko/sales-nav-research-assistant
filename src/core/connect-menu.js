function normalizeConnectMenuLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const CONNECT_MENU_PATTERNS = [
  /\bconnect\b/i,
  /\binvite(?:\s+to\s+connect)?\b/i,
  /\beinladen\b/i,
  /\bvernetzen\b/i,
  /\bverbindungsanfrage\b/i,
];

const PENDING_CONNECT_MENU_PATTERNS = [
  /\bpending\b/i,
  /\bausstehend\b/i,
  /\bgesendet\b/i,
  /\bsent\b/i,
];

const NON_CONNECT_MENU_PATTERNS = [
  /\bmessage\b/i,
  /\bnachricht\b/i,
  /\bsave\b/i,
  /\bspeichern\b/i,
  /\bremove\b/i,
  /\bentfernen\b/i,
  /\bdelete\b/i,
  /\bloschen\b/i,
  /\blöschen\b/i,
  /\bcopy\b/i,
  /\bshare\b/i,
  /\breport\b/i,
  /\bhide\b/i,
  /\bexport\b/i,
];

function classifyConnectMenuActionLabel(value) {
  const normalized = normalizeConnectMenuLabel(value).toLowerCase();
  if (!normalized) {
    return { normalized, isConnectAction: false, isPendingAction: false };
  }

  const isConnectAction = CONNECT_MENU_PATTERNS.some((pattern) => pattern.test(normalized))
    && !NON_CONNECT_MENU_PATTERNS.some((pattern) => pattern.test(normalized));

  if (!isConnectAction) {
    return { normalized, isConnectAction: false, isPendingAction: false };
  }

  return {
    normalized,
    isConnectAction: true,
    isPendingAction: PENDING_CONNECT_MENU_PATTERNS.some((pattern) => pattern.test(normalized)),
  };
}

function isConnectMenuActionLabel(value) {
  return classifyConnectMenuActionLabel(value).isConnectAction;
}

module.exports = {
  normalizeConnectMenuLabel,
  classifyConnectMenuActionLabel,
  isConnectMenuActionLabel,
};
