# BUG REPORT: Duplicate Empty Lists on Live-Save Workflow

**Date**: 2026-05-12
**Severity**: P0 — Critical
**Reporter**: Daniel Datsenko (SDR)
**Affected Command**: `npm run sdr-research -- --live-save --list-name="..."`
**Affected Driver**: `playwright`
**Reproduction Run**: `bgmp4emaz.output` — 5 PL accounts, list `Grafana - Daniel Datsenko - PZU PKO Millennium TVN Polkomtel` (60 chars)

---

## Symptom

Single live-save run with **155 selected leads** across 5 accounts produced **dozens of empty lead lists in Sales Navigator**, all with the same (truncated) name `Grafana - Daniel Datsenko - PZU PKO Millenni...`. Screenshot from user shows ≥11 visible duplicate lists, the count likely scales 1:1 with save attempts (one new list per saved lead).

Expected behavior: **Exactly one** list named `Grafana - Daniel Datsenko - PZU PKO Millennium TVN Polkomtel` containing 155 leads.

---

## Root Cause Analysis

### The chain that breaks

1. **List name exceeds Sales Nav UI display limit**
   - User-supplied list name: `Grafana - Daniel Datsenko - PZU PKO Millennium TVN Polkomtel` = **60 chars**
   - Sales Navigator truncates display to ~32–46 chars: `Grafana - Daniel Datsenko - PZU PKO Millenni...`
   - The DOM-level `innerText` returns the **truncated** string, not the full title

2. **List-row matching uses exact `innerText` comparison**

   File: `src/drivers/playwright-sales-nav.js:3140` — `clickVisibleListRow()`
   - First selector: `button[aria-label*="${listName}"]` — exact substring match against the full 60-char name
   - Fallback: `page.getByRole('button', { name: new RegExp(escaped, 'i') })` — regex match against full name

   When Sales Nav renders truncated text in DOM, **neither selector matches**, so `clickVisibleListRow` returns `null`.

3. **`null` triggers a fresh `tryCreateList()` call**

   File: `src/drivers/playwright-sales-nav.js:567`
   ```js
   if (rowOutcome?.outcome === 'clicked') { ...existing list... }
   // ...
   const created = await this.tryCreateList(listInfo.listName);  // <-- new list every time
   ```
   `tryCreateList` happily creates another list with the same name — Sales Navigator allows duplicate list names.

4. **Per-save loop = per-save new list**

   The `saveCandidateToList` runs once per candidate. Step 2 fails on every iteration → step 3 creates a new list on every iteration. **155 leads → up to 155 new lists.**

5. **Post-save list verification also fails** (separate symptom, same root cause)

   File: `src/cli.js:1601, 1679, 1742` — `readLeadListSnapshot()` uses:
   ```js
   const match = links.find((link) =>
     normalize(link.innerText) === target_name
   )
   ```
   Exact `innerText === target_name` cannot match a truncated 46-char display against a 60-char target → throws `Unable to open lead list <name>` → save logged as `save_clicked_unverified` for every lead.

---

## Reproduction

```bash
npm run sdr-research -- \
  --accounts="A, B, C, D, E" \
  --list-name="Grafana - Daniel Datsenko - PZU PKO Millennium TVN Polkomtel" \
  --live-save
```

- Any list name >32 chars triggers the bug
- Any account batch with >1 save reveals the duplication

---

## Impact

- **Sales Nav UI pollution**: dozens of empty lists per run, all with identical truncated display names — hard to distinguish in UI
- **Lead-list integrity broken**: no single list contains all saved leads; leads are scattered 1-per-list
- **Connect workflow blocked**: `connect-lead-list` operates on one list at a time — cannot run against 155 fragmented lists
- **No verifiable save state**: tool reports `save_clicked_unverified` for every lead, operator cannot trust the result
- **Cleanup is manual and expensive**: SDR must delete each duplicate list individually in Sales Nav UI

---

## Fix Recommendations (ordered by impact / effort)

### Fix 1 — Hard cap on list-name length (lowest effort, blocks the bug)
Reject or auto-truncate list names >32 chars in `cli.js` before passing to driver.
```js
const MAX_LIST_NAME = 32;
if (listName.length > MAX_LIST_NAME) {
  throw new Error(`List name too long (${listName.length} chars). Sales Nav UI truncates >${MAX_LIST_NAME} chars and triggers list duplication. Shorten to <=${MAX_LIST_NAME}.`);
}
```
**Pros**: 1-line fix, prevents 100% of cases. **Cons**: doesn't fix underlying matching weakness.

### Fix 2 — Per-run list-handle cache (right architecture)
Create the list **once** at the start of the save loop, capture its `href` / `entity-urn`, and pass that handle through every subsequent save. Never call `clickVisibleListRow` by name on iteration N>1.

In `account-batch.js` save loop:
```js
const listHandle = await driver.ensureList(listName);  // creates if missing, returns ref
for (const lead of leads) {
  await driver.saveCandidateToList(lead, listHandle, ctx);  // uses ref, not name
}
```
`ensureList` becomes a real implementation that:
- Searches for an existing list by name (with both exact + truncated-prefix match)
- Creates if not found
- Returns `{ listName, externalRef, listUrl }`
- Caches the handle for the lifetime of the run

**Pros**: removes name-matching dependency. **Cons**: 30–50 lines, needs browser test.

### Fix 3 — Match on `title` attribute or `aria-label`, with prefix fallback
Sales Nav typically populates `title="<full name>"` on truncated elements. Update `clickVisibleListRow`:
```js
const match = await page.evaluate((target) => {
  const buttons = [...document.querySelectorAll('button, a')];
  return buttons.find(el => {
    const title = el.getAttribute('title') || '';
    const aria = el.getAttribute('aria-label') || '';
    const text = el.innerText || '';
    return title === target || aria.includes(target) ||
           target.startsWith(text.replace(/…$/, '').trim());  // truncated-prefix match
  });
}, listName);
```
**Pros**: also fixes verification path. **Cons**: depends on Sales Nav DOM stability.

### Fix 4 — Idempotency sanity check before `tryCreateList`
Before creating, count existing lists with same name. If ≥1 exists, refuse to create and use the existing one.
```js
const existing = await this.findListsByName(listName);
if (existing.length > 0) {
  return { status: 'using_existing', listHandle: existing[0] };
}
return this.tryCreateList(listName);
```
**Pros**: defense in depth. **Cons**: doesn't help with truncation-driven non-detection.

### Fix 5 — `readLeadListSnapshot` should accept truncated match
File `cli.js:1565+, 1627+` — replace `normalize(text) === target_name` with `target_name.startsWith(normalize(text).replace(/…$/, '').trim())`.

---

## Recommended action plan

1. **Immediate (today)**: Apply Fix 1 (hard-cap) as guard. Ship it.
2. **This week**: Implement Fix 2 (per-run list handle) — proper architecture.
3. **Same PR as Fix 2**: Add Fix 3 (title/prefix match) + Fix 5 (verification match) for robustness.
4. **Test matrix**:
   - List name 1 char
   - List name exactly 32 chars
   - List name 33 chars (boundary)
   - List name 60+ chars (current failing case)
   - List name with Unicode (Polish/German umlauts)
   - List name with emoji
   - Re-run against same list (idempotency)

---

## User-Facing Cleanup Required

The 5 PL accounts produced an unknown number of duplicate empty lists. Recommended cleanup:
1. In Sales Nav, sort lead lists by date, filter to `2026-05-12`
2. Delete all duplicates of `Grafana - Daniel Datsenko - PZU PKO Millenni...`
3. Re-run the save with a **shortened list name** (e.g. `Grafana DDS PL Wave 1 2026-05-12` = 31 chars) — under the hard cap
4. Apply Fix 1 to `src/cli.js` before next run

---

## Related observations

- The `Grafana Internal Network - GTM Wave 1` list (38 chars) likely has the **same problem at smaller scale** — please check that list for duplicates as well.
- The `Agirc-Arrco` list runs from earlier this session used shorter names (`SDR Research - Daniel Datsenko - Agirc Arrco 2026-05-07` = 54 chars) — these may also have triggered the bug. Worth verifying.
