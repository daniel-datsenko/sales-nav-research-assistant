const { spawnSync } = require('node:child_process');
const { DriverAdapter } = require('./driver-adapter');
const { buildCompanyFilterTargets } = require('./playwright-sales-nav');
const { limitCandidatesByTemplate, normalizeCandidateLimit } = require('../core/candidate-limits');

const SALES_HOME_URL = 'https://www.linkedin.com/sales/home';
const COMPANY_SEARCH_URL = 'https://www.linkedin.com/sales/search/company';
const PEOPLE_SEARCH_URL = 'https://www.linkedin.com/sales/search/people';

class BrowserHarnessSalesNavigatorDriver extends DriverAdapter {
  constructor(options = {}) {
    super();
    this.options = {
      harnessCommand: 'browser-harness',
      browserHarnessName: 'sales-nav-research-assistant',
      allowMutations: false,
      allowListCreate: false,
      recoveryMode: 'screenshot-only',
      settleMs: 350,
      commandTimeoutMs: 90000,
      commandRunner: defaultCommandRunner,
      dryRun: true,
      connectAttemptPacingMs: 3000,
      connectCacheFlushEvery: 3,
      ...options,
    };
    this.runContext = null;
    this.connectAttemptCount = 0;
  }

  async openSession(context) {
    this.runContext = context;
    this.assertHarnessAvailable();
  }

  async checkSessionHealth() {
    const payload = this.runHarnessJson(`
import json
new_tab(${pyString(SALES_HOME_URL)})
wait_for_load()
body = js(${pyString("document.body ? document.body.innerText.slice(0, 3000) : ''")}) or ""
page = page_info()
print(json.dumps({"page": page, "body": body}))
`);

    const page = payload.page || {};
    const state = classifyLinkedInPageState(page.url || '', payload.body || '', page.title || '');
    return {
      ok: state === 'authenticated',
      authenticated: state === 'authenticated',
      state,
      mode: 'browser-harness',
      url: page.url || null,
      pageTitle: page.title || null,
      harnessCommand: this.options.harnessCommand,
      browserHarnessName: this.options.browserHarnessName,
    };
  }

  async openAccountSearch() {
    this.runHarness(`
new_tab(${pyString(COMPANY_SEARCH_URL)})
wait_for_load()
`);
  }

  async enumerateAccounts(accounts) {
    return accounts;
  }

  async openAccount(account) {
    const targetUrl = account.salesNav?.accountUrl
      || account.salesNav?.peopleSearchUrl
      || PEOPLE_SEARCH_URL;

    this.runHarness(`
new_tab(${pyString(targetUrl)})
wait_for_load()
`);
  }

  async openPeopleSearch(account) {
    const targetUrl = account.salesNav?.peopleSearchUrl || PEOPLE_SEARCH_URL;
    const filterTargets = buildCompanyFilterTargets(account);
    const targetList = pyStringArray(filterTargets);

    this.runHarness(`
new_tab(${pyString(targetUrl)})
wait_for_load()
targets = ${targetList}
if targets:
    js(${pyString(`
(() => {
  const normalize = (value) => (value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
  const targets = ${JSON.stringify(filterTargets)}.map(normalize).filter(Boolean);
  const text = normalize(document.body ? document.body.innerText : '');
  return targets.some((target) => text.includes(target));
})()
`)})
`);
  }

  async applySearchTemplate(template) {
    const keywords = (template.keywords || []).join(' ').trim();
    if (!keywords) {
      return;
    }

    this.runHarness(`
kw = ${pyString(keywords)}
result = js(${pyString(`
(() => {
  const selectors = [
    'input[placeholder="Keywords für Suche"]',
    'input[placeholder="Search keywords"]',
    'input[placeholder*="Keywords"]',
    'input[aria-label*="Keywords"]'
  ];
  const input = selectors
    .map((selector) => document.querySelector(selector))
    .find(Boolean);
  if (!input) {
    return false;
  }
  input.focus();
  input.value = ${JSON.stringify(keywords)};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()
`)})
if result:
    press_key("Enter")
    wait(${Math.max(1, this.options.settleMs / 300)})
else:
    js(${pyString(`
(() => {
  const url = new URL(window.location.href);
  url.searchParams.set('keywords', ${JSON.stringify(keywords)});
  window.location.assign(url.toString());
  return true;
})()
`)})
    wait_for_load()
`);
  }

  async scrollAndCollectCandidates(account, template) {
    const maxCandidates = normalizeCandidateLimit(template.maxCandidates);
    const maxSteps = Math.max(1, this.options.maxScrollSteps || 8);
    const candidatesByKey = new Map();

    for (let step = 0; step < maxSteps; step += 1) {
      const extracted = this.runHarnessJson(`
import json
items = js(${pyString(`
(() => {
  const rows = [...document.querySelectorAll('a[href*="/sales/lead/"]')]
    .map((link) => link.closest('li, article, div') || link)
    .slice(0, 80);

  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();

  return rows.map((row) => {
    const link = row.querySelector('a[href*="/sales/lead/"]');
    if (!link) {
      return null;
    }

    const textLines = normalize(row.innerText).split('•').map((value) => normalize(value)).filter(Boolean);
    const name = normalize(link.innerText) || normalize(textLines[0]) || 'Unknown';
    const title = normalize(textLines[1]) || normalize(textLines[0]) || 'Unknown title';
    const company = normalize(textLines.find((value) => value !== name && value !== title)) || ${JSON.stringify(account.name)};
    const href = link.getAttribute('href') || '';
    const absoluteHref = href.startsWith('http') ? href : ('https://www.linkedin.com' + href);

    return {
      fullName: name,
      title,
      headline: normalize(row.innerText).slice(0, 240),
      company,
      location: normalize(textLines[textLines.length - 1]) || '',
      profileUrl: absoluteHref,
      salesNavigatorUrl: absoluteHref,
      summary: normalize(row.innerText).slice(0, 500),
      fromListPage: true
    };
  }).filter(Boolean);
})()
`)}) or []
print(json.dumps({"items": items}))
`);

      for (const candidate of extracted.items || []) {
        const key = candidate.profileUrl || candidate.salesNavigatorUrl || `${candidate.fullName}:${candidate.title}`;
        if (!candidatesByKey.has(key)) {
          candidatesByKey.set(key, candidate);
        }
      }

      if (maxCandidates !== null && candidatesByKey.size >= maxCandidates) {
        break;
      }

      this.runHarness(`
js(${pyString("window.scrollBy(0, Math.floor(window.innerHeight * 0.85)); true")})
wait(${Math.max(1, this.options.settleMs / 300)})
`);
    }

    return limitCandidatesByTemplate(Array.from(candidatesByKey.values()), template);
  }

  async openCandidate(candidate) {
    const targetUrl = candidate.salesNavigatorUrl || candidate.profileUrl;
    if (!targetUrl) {
      throw new Error(`Candidate ${candidate.fullName} has no profile URL`);
    }

    this.runHarness(`
new_tab(${pyString(targetUrl)})
wait_for_load()
`);
  }

  async ensureList(listName) {
    return {
      listName,
      externalRef: null,
      status: this.options.allowMutations ? 'ready' : 'simulated',
      driver: 'browser-harness',
    };
  }

  async saveCandidateToList(candidate, listInfo, context) {
    if (!this.options.allowMutations) {
      return {
        status: context?.dryRun ? 'simulated' : 'planned',
        listName: listInfo.list_name || listInfo.listName || candidate.listName,
        driver: 'browser-harness',
      };
    }

    const targetUrl = candidate.salesNavigatorUrl || candidate.profileUrl;
    if (!targetUrl || !/linkedin\.com\/sales\/lead\//i.test(targetUrl)) {
      throw new Error(`Candidate ${candidate.fullName || 'unknown'} does not point to a Sales Navigator lead URL`);
    }

    const targetList = listInfo.list_name || listInfo.listName || candidate.listName;
    const targetListLiteral = JSON.stringify(targetList);
    const listRowStateExpression = pyString(`
(() => {
  const target = ${targetListLiteral}.toLowerCase().trim();
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const extractCount = (value) => {
    const match = normalize(value).match(/\\((\\d+)\\)\\s*$/);
    return match ? Number.parseInt(match[1], 10) : null;
  };
  const isSelected = (element) => {
    const nodes = [element, ...element.querySelectorAll('*')];
    return nodes.some((node) => {
      if (!node || typeof node.getAttribute !== 'function') {
        return false;
      }
      const ariaChecked = String(node.getAttribute('aria-checked') || '').toLowerCase();
      const ariaSelected = String(node.getAttribute('aria-selected') || '').toLowerCase();
      const ariaPressed = String(node.getAttribute('aria-pressed') || '').toLowerCase();
      const ariaCurrent = String(node.getAttribute('aria-current') || '').toLowerCase();
      if (ariaChecked === 'true' || ariaSelected === 'true' || ariaPressed === 'true' || ariaCurrent === 'true') {
        return true;
      }
      if (node.tagName === 'INPUT' && node.checked) {
        return true;
      }
      const className = String(node.className || '').toLowerCase();
      if (/(selected|checked|is-selected)/.test(className) && !/(unselected|unchecked)/.test(className)) {
        return true;
      }
      const label = normalize(node.getAttribute('aria-label') || '').toLowerCase();
      return label.includes('selected')
        || label.includes('ausgewählt')
        || label.includes('saved')
        || label.includes('gespeichert');
    });
  };

  const candidates = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],li,label,div,span')]
    .map((element) => {
      const text = normalize(element.innerText || element.textContent || '');
      const lower = text.toLowerCase();
      const rect = typeof element.getBoundingClientRect === 'function'
        ? element.getBoundingClientRect()
        : { left: 0, top: 0, width: 0, height: 0, bottom: 0 };
      return {
        text,
        lower,
        role: element.getAttribute('role') || '',
        className: String(element.className || ''),
        selected: isSelected(element),
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
        width: rect.width,
        height: rect.height,
        interactive: rect.width > 20 && rect.height > 10,
      };
    })
    .filter((row) => row.interactive && (row.lower === target || row.lower.startsWith(target + ' (')))
    .sort((left, right) => {
      const leftScore = left.y + (left.height * 0.1);
      const rightScore = right.y + (right.height * 0.1);
      return leftScore - rightScore;
    });

  const preferred = candidates.find((row) => row.role === 'menuitem' && row.height <= 80)
    || candidates.find((row) => /_list-item_|list-item|_item_/.test(row.className) && row.height <= 80)
    || candidates.find((row) => row.height <= 80)
    || null;
  if (!preferred) {
    return null;
  }
  return {
    text: preferred.text,
    count: extractCount(preferred.text),
    selected: preferred.selected,
    x: preferred.x,
    y: preferred.y,
  };
})()
`);
    const confirmTargetExpression = pyString(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const buttons = [...document.querySelectorAll('button,[role="button"]')]
    .map((element) => {
      const text = normalize(element.innerText || element.textContent || '');
      const rect = typeof element.getBoundingClientRect === 'function'
        ? element.getBoundingClientRect()
        : { left: 0, top: 0, width: 0, height: 0, bottom: 0 };
      return {
        text,
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
        width: rect.width,
        height: rect.height,
        visible: rect.width > 20
          && rect.height > 10
          && rect.bottom > 0
          && rect.top < window.innerHeight,
      };
    })
    .filter((row) => row.visible);
  return buttons.find((row) => row.text === 'speichern'
    || row.text === 'save'
    || row.text === 'fertig'
    || row.text === 'done') || null;
})()
`);
    const successStatusExpression = pyString(`
(() => {
  const target = ${targetListLiteral}.toLowerCase().trim();
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const statuses = [...document.querySelectorAll('[role="status"],[aria-live]')]
    .map((element) => normalize(element.innerText || element.textContent || ''))
    .filter(Boolean);
  return statuses.find((value) => {
    const lower = value.toLowerCase();
    return lower.includes(target)
      && (lower.includes('wurde der liste') || lower.includes('added to the list'));
  }) || null;
})()
`);
    const result = this.runHarnessJson(stripHarnessScriptIndent(`
import json
new_tab(${pyString(targetUrl)})
wait_for_load()
wait(${Math.max(1, this.options.settleMs / 300)})

	save_target = js(${pyString(`
	(() => {
	  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
	  const elements = [...document.querySelectorAll('button,[role="button"],a')];
	  const match = elements.find((element) => {
	    const text = normalize(element.innerText || element.textContent || '').toLowerCase();
	    const label = normalize(element.getAttribute('aria-label') || '').toLowerCase();
	    return text === 'speichern'
	      || text === 'gespeichert'
	      || text === 'save'
	      || text === 'saved'
	      || label.includes('save')
	      || label.includes('speichern')
	      || label.includes('gespeichert')
	      || label.includes('zu einer userdefinierten liste hinzufügen')
	      || label.includes('add to a custom list');
	  });
	  if (!match || typeof match.getBoundingClientRect !== 'function') {
	    return null;
	  }
	  const rect = match.getBoundingClientRect();
	  return {
	    x: rect.left + (rect.width / 2),
	    y: rect.top + (rect.height / 2),
	    text: normalize(match.innerText || match.textContent || ''),
	    label: normalize(match.getAttribute('aria-label') || ''),
	  };
	})()
	`)})

	if not save_target:
	    print(json.dumps({"status": "failed", "message": "save_button_not_found"}))
	else:
	    click(save_target["x"], save_target["y"])
	    wait(${Math.max(1, this.options.settleMs / 250)})
	    target_list = ${pyString(targetList)}
	    before_state = js(${listRowStateExpression})

	    if not before_state:
	        print(json.dumps({"status": "failed", "message": "list_not_found", "listName": target_list}))
	    elif before_state.get("selected"):
	        print(json.dumps({
	            "status": "already_saved",
	            "listName": target_list,
	            "selectionMode": "existing_list",
	            "beforeCount": before_state.get("count"),
	            "afterCount": before_state.get("count"),
	            "rowText": before_state.get("text"),
	        }))
	    else:
	        click(before_state["x"], before_state["y"])
	        wait(${Math.max(1, this.options.settleMs / 250)})
	        confirm_target = js(${confirmTargetExpression})

	        confirm_clicked = False
	        if confirm_target:
	            click(confirm_target["x"], confirm_target["y"])
	            confirm_clicked = True
	            wait(${Math.max(1, this.options.settleMs / 250)})

	        verification = js(${listRowStateExpression})
	        success_status = js(${successStatusExpression})

	        verified = False
	        if success_status:
	            verified = True
	        elif verification.get("selected"):
	            verified = True
	        elif before_state.get("count") is not None and verification.get("count") is not None:
	            verified = verification["count"] > before_state["count"]

	        if not verified:
	            print(json.dumps({
	                "status": "failed",
	                "message": "save_not_verified",
	                "listName": target_list,
	                "beforeCount": before_state.get("count"),
	                "afterCount": verification.get("count"),
	                "rowText": verification.get("text"),
	                "selected": verification.get("selected"),
	                "successStatus": success_status,
	                "confirmClicked": confirm_clicked,
	            }))
	        else:
	            print(json.dumps({
	                "status": "saved",
	                "listName": target_list,
	                "selectionMode": "existing_list",
	                "confirmClicked": confirm_clicked,
	                "beforeCount": before_state.get("count"),
	                "afterCount": verification.get("count"),
	                "selected": verification.get("selected"),
	                "successStatus": success_status,
	            }))
`));

    if (!['saved', 'already_saved'].includes(result.status)) {
      throw new Error(result.message || `Unable to save ${candidate.fullName || 'candidate'} to ${targetList}`);
    }

    return {
      ...result,
      driver: 'browser-harness',
    };
  }

  async sendConnect(candidate, context) {
    if (!this.options.allowMutations) {
      return {
        status: context?.dryRun ? 'simulated' : 'planned',
        note: 'mutations disabled',
        driver: 'browser-harness',
      };
    }

    const targetUrl = candidate.salesNavigatorUrl || candidate.profileUrl;
    if (!targetUrl) {
      throw new Error(`Candidate ${candidate.fullName || 'unknown'} has no profile URL`);
    }
    const shouldFlushCache = this.connectAttemptCount > 0
      && this.options.connectCacheFlushEvery > 0
      && this.connectAttemptCount % this.options.connectCacheFlushEvery === 0;
    this.connectAttemptCount += 1;

    const bodyStateExpression = pyString(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const body = normalize(document.body ? document.body.innerText : '');
  const controls = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],a,[data-test-pending-connect],.artdeco-toast--success')]
    .map((element) => [
      normalize(element.innerText || element.textContent || ''),
      normalize(element.getAttribute('aria-label') || ''),
      normalize(element.getAttribute('data-test-pending-connect') || ''),
    ].join(' '))
    .join(' ');
  const combined = [body, controls].join(' ');
  const hasInvitationSent = combined.includes('invitation sent')
    || body.includes('invitation pending')
    || combined.includes('connection sent')
    || combined.includes('einladung gesendet')
    || combined.includes('einladung ausstehend')
    || combined.includes('verbindung gesendet')
    || /\\b(connect|invite|invitation|vernetzen|einladung)\\b[^.]{0,80}\\b(pending|sent|ausstehend|gesendet)\\b/.test(combined)
    || /\\b(pending|sent|ausstehend|gesendet)\\b[^.]{0,80}\\b(connect|invite|invitation|vernetzen|einladung)\\b/.test(combined);
  const hasConnectedMessage = combined.includes('bereits vernetzt')
    || combined.includes('already connected');
  const hasEmailRequired = body.includes('email address')
    || body.includes('e-mail address')
    || body.includes('geschäftliche e-mail-adresse')
    || body.includes('enter their email')
    || body.includes('enter your recipient')
    || body.includes('enter a valid email');
  const hasRestrictedConnect = body.includes("can't connect")
    || body.includes('cannot connect')
    || body.includes('unable to connect')
    || body.includes('connect not available')
    || body.includes('outside your network')
    || body.includes('außerhalb deines netzwerks')
    || /\\b3rd\\b|\\bthird degree\\b/.test(body);
  return {
    hasInvitationSent,
    hasConnectedMessage,
    hasEmailRequired,
    hasRestrictedConnect,
    body,
  };
})()
`);
    const visibleConnectTargetExpression = pyString(`
(() => {
  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const buttons = [...document.querySelectorAll('button,[role="button"],a')];
  const match = buttons.find((element) => {
    const label = normalize(element.getAttribute('aria-label') || '');
    const text = normalize(element.innerText || element.textContent || '');
    return text === 'connect'
      || text === 'vernetzen'
      || text === 'einladen'
      || text.startsWith('connect — pending')
      || text.startsWith('connect - pending')
      || text.startsWith('vernetzen — ausstehend')
      || text.startsWith('vernetzen - ausstehend')
      || text.startsWith('already connected')
      || text.startsWith('bereits vernetzt')
      || label === 'connect'
      || label === 'vernetzen'
      || label === 'einladen'
      || label.includes('connect')
      || label.includes('vernetzen')
      || label.includes('einladen')
      || label.includes('pending')
      || label.includes('ausstehend')
      || label.includes('connected')
      || label.includes('vernetzt');
  });
  if (!match || typeof match.getBoundingClientRect !== 'function') {
    return null;
  }
  const rect = match.getBoundingClientRect();
  return {
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
    text: normalize(match.innerText || match.textContent || ''),
    label: normalize(match.getAttribute('aria-label') || ''),
  };
})()
`);
    const overflowTargetExpression = pyString(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const buttons = [...document.querySelectorAll('button,[role="button"],a')];
  const match = buttons.find((element) => {
    const label = normalize(element.getAttribute('aria-label') || '');
    const text = normalize(element.innerText || element.textContent || '');
    return label.includes('open actions overflow menu')
      || label.includes('aktions-überlaufmenü öffnen')
      || label.includes('overflow')
      || label.includes('actions')
      || label.includes('aktionen')
      || text === '...';
  });
  if (!match || typeof match.getBoundingClientRect !== 'function') {
    return null;
  }
  const rect = match.getBoundingClientRect();
  return {
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
  };
})()
`);
    const connectTargetExpression = pyString(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const items = [...document.querySelectorAll('[role="menuitem"],li,button,[role="button"],a')];
  const match = items.find((element) => {
    const text = normalize(element.innerText || element.textContent || '');
    return text === 'connect'
      || text === 'vernetzen'
      || text === 'einladen';
  });
  if (!match || typeof match.getBoundingClientRect !== 'function') {
    return null;
  }
  const rect = match.getBoundingClientRect();
  return {
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
    text: normalize(match.innerText || match.textContent || ''),
    label: normalize(match.getAttribute('aria-label') || ''),
  };
})()
`);
    const sendButtonExpression = pyString(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const buttons = [...document.querySelectorAll('button,[role="button"],a')];
  const match = buttons.find((element) => {
    const text = normalize(element.innerText || element.textContent || '');
    const label = normalize(element.getAttribute('aria-label') || '');
    return text === 'send invitation'
      || text === 'send without a note'
      || text === 'send'
      || text === 'einladung senden'
      || text === 'ohne nachricht senden'
      || label.includes('send invitation')
      || label.includes('einladung senden');
  });
  if (!match || typeof match.getBoundingClientRect !== 'function') {
    return null;
  }
  const rect = match.getBoundingClientRect();
  return {
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
    text: normalize(match.innerText || match.textContent || ''),
  };
})()
`);
    const result = this.runHarnessJson(`
import json
${shouldFlushCache ? 'new_tab("about:blank")\nwait(1)\n' : ''}
new_tab(${pyString(targetUrl)})
wait_for_load()
wait(${Math.max(1, this.options.connectAttemptPacingMs / 1000)})
initial_state = js(${bodyStateExpression})
if initial_state.get("hasInvitationSent"):
    print(json.dumps({"status": "already_sent", "note": "invitation already sent"}))
elif initial_state.get("hasConnectedMessage"):
    print(json.dumps({"status": "already_connected", "note": "lead already connected"}))
elif initial_state.get("hasEmailRequired"):
    print(json.dumps({"status": "email_required", "note": "connect requires email address"}))
elif initial_state.get("hasRestrictedConnect"):
    print(json.dumps({"status": "connect_unavailable", "reason": "structural_restricted_profile", "note": "connect unavailable because LinkedIn shows a restricted profile state"}))
else:
    visible_connect_target = js(${visibleConnectTargetExpression})
    connect_target = visible_connect_target
    if not connect_target:
        overflow_target = js(${overflowTargetExpression})
        if not overflow_target:
            print(json.dumps({"status": "connect_unavailable", "note": "connect overflow menu not found"}))
        else:
            click(overflow_target["x"], overflow_target["y"])
            wait(${Math.max(1, this.options.settleMs / 250)})
            connect_target = js(${connectTargetExpression})
    if not connect_target:
        followup_state = js(${bodyStateExpression})
        status = "connect_unavailable"
        note = "connect action not available"
        if followup_state.get("hasInvitationSent"):
            status = "already_sent"
            note = "invitation already sent"
        elif followup_state.get("hasConnectedMessage"):
            status = "already_connected"
            note = "lead already connected"
        elif followup_state.get("hasEmailRequired"):
            status = "email_required"
            note = "connect requires email address"
        reason = "render_failure_retry_suggested"
        if followup_state.get("hasRestrictedConnect"):
            note = "connect unavailable because LinkedIn shows a restricted profile state"
            reason = "structural_restricted_profile"
        print(json.dumps({"status": status, "reason": reason, "note": note}))
    else:
        connect_text = (connect_target.get("text") or connect_target.get("label") or "").lower()
        if "pending" in connect_text or "ausstehend" in connect_text:
            print(json.dumps({"status": "already_sent", "note": "invitation already pending"}))
        else:
            click(connect_target["x"], connect_target["y"])
            wait(${Math.max(1, this.options.settleMs / 250)})
            send_button = js(${sendButtonExpression})
            if not send_button:
                post_click_state = js(${bodyStateExpression})
                post_click_visible = js(${visibleConnectTargetExpression})
                post_click_overflow = js(${connectTargetExpression})
                if post_click_state.get("hasInvitationSent"):
                    print(json.dumps({"status": "sent", "note": "invitation sent"}))
                elif post_click_state.get("hasConnectedMessage"):
                    print(json.dumps({"status": "already_connected", "note": "lead already connected"}))
                elif post_click_state.get("hasEmailRequired"):
                    print(json.dumps({"status": "email_required", "note": "connect requires email address"}))
                else:
                    post_click_label = ((post_click_visible or {}).get("text")
                        or (post_click_visible or {}).get("label")
                        or (post_click_overflow or {}).get("text")
                        or (post_click_overflow or {}).get("label")
                        or "").lower()
                    if "pending" in post_click_label or "ausstehend" in post_click_label or "sent" in post_click_label or "gesendet" in post_click_label:
                        print(json.dumps({"status": "sent", "note": "connect pending via post-click state"}))
                    elif "connected" in post_click_label or "vernetzt" in post_click_label:
                        print(json.dumps({"status": "already_connected", "note": "lead already connected"}))
                    else:
                        print(json.dumps({"status": "manual_review", "note": "connect send dialog did not render verifiable controls"}))
            else:
                click(send_button["x"], send_button["y"])
                wait(${Math.max(1, this.options.settleMs / 250)})
                final_state = js(${bodyStateExpression})
                if final_state.get("hasInvitationSent"):
                    print(json.dumps({"status": "sent", "note": "invitation sent"}))
                elif final_state.get("hasConnectedMessage"):
                    print(json.dumps({"status": "already_connected", "note": "lead already connected"}))
                elif final_state.get("hasEmailRequired"):
                    print(json.dumps({"status": "email_required", "note": "connect requires email address"}))
                else:
                    final_visible = js(${visibleConnectTargetExpression})
                    final_overflow = js(${connectTargetExpression})
                    final_label = ((final_visible or {}).get("text")
                        or (final_visible or {}).get("label")
                        or (final_overflow or {}).get("text")
                        or (final_overflow or {}).get("label")
                        or "").lower()
                    if "pending" in final_label or "ausstehend" in final_label or "sent" in final_label or "gesendet" in final_label:
                        print(json.dumps({"status": "sent", "note": "connect pending"}))
                    elif "connected" in final_label or "vernetzt" in final_label:
                        print(json.dumps({"status": "already_connected", "note": "lead already connected"}))
                    else:
                        print(json.dumps({"status": "manual_review", "note": "connect outcome could not be verified"}))
`);

    if (!['sent', 'already_sent', 'already_connected', 'connect_unavailable', 'email_required', 'manual_review'].includes(result.status)) {
      throw new Error(result.message || `Connect flow failed for ${candidate.fullName || 'candidate'}`);
    }

    return {
      ...result,
      driver: 'browser-harness',
    };
  }

  async captureEvidence(candidate) {
    const payload = this.runHarnessJson(`
import json
page = page_info()
snippet = js(${pyString("document.body ? document.body.innerText.slice(0, 600) : ''")}) or ""
print(json.dumps({"page": page, "snippet": snippet}))
`);

    return {
      pageTitle: payload.page?.title || null,
      pageUrl: payload.page?.url || null,
      snippet: (payload.snippet || candidate.summary || candidate.headline || candidate.title || '').slice(0, 600),
      extraction: candidate.fromListPage ? 'list-page' : 'browser-harness',
    };
  }

  async recoverFromInterruption(event) {
    if (!event?.screenshotPath) {
      return { status: 'recorded', screenshotPath: null };
    }

    this.runHarness(`
screenshot(${pyString(event.screenshotPath)}, full=True)
`);

    return {
      status: 'captured',
      screenshotPath: event.screenshotPath,
      htmlPath: null,
      textPath: null,
      driver: 'browser-harness',
    };
  }

  async saveSession() {
    return null;
  }

  async exportStorageState() {
    return null;
  }

  async close() {
    return null;
  }

  assertHarnessAvailable() {
    const result = this.options.commandRunner({
      command: this.options.harnessCommand,
      args: ['--help'],
      input: '',
      env: this.buildHarnessEnv(),
      cwd: process.cwd(),
      timeoutMs: Math.min(this.options.commandTimeoutMs, 10000),
    });

    if (result.error) {
      throw new Error(`browser-harness is not available: ${result.error.message}`);
    }

    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error(summarizeHarnessFailure(result, 'browser-harness --help failed'));
    }
  }

  runHarness(code) {
    const maxAttempts = 2;
    let lastResult = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = this.options.commandRunner({
        command: this.options.harnessCommand,
        args: [],
        input: code,
        env: this.buildHarnessEnv(),
        cwd: process.cwd(),
        timeoutMs: this.options.commandTimeoutMs,
      });
      lastResult = result;

      if (result.error) {
        throw new Error(`browser-harness execution failed: ${result.error.message}`);
      }

      if (typeof result.status !== 'number' || result.status === 0) {
        return result.stdout || '';
      }

      if (attempt < maxAttempts && isTransientHarnessTransportFailure(result)) {
        continue;
      }

      throw new Error(summarizeHarnessFailure(result, 'browser-harness returned a non-zero exit code'));
    }

    throw new Error(summarizeHarnessFailure(lastResult || {}, 'browser-harness returned a non-zero exit code'));
  }

  runHarnessJson(code) {
    const output = this.runHarness(code);
    return extractHarnessJson(output);
  }

  buildHarnessEnv(extraEnv = {}) {
    return {
      ...process.env,
      BU_NAME: this.options.browserHarnessName,
      ...extraEnv,
    };
  }
}

function defaultCommandRunner({ command, args = [], input = '', env, cwd, timeoutMs = 90000 }) {
  return spawnSync(command, args, {
    input,
    env,
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 8,
  });
}

function extractHarnessJson(output) {
  const lines = String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // try earlier lines
    }
  }

  throw new Error(`browser-harness did not emit JSON output. Last output: ${lines.slice(-3).join(' | ') || '(empty)'}`);
}

function isTransientHarnessTransportFailure(result) {
  const combined = `${result?.stderr || ''}\n${result?.stdout || ''}`.toLowerCase();
  return combined.includes('no close frame received or sent')
    || combined.includes('websocket')
    || combined.includes('connection closed');
}

function stripHarnessScriptIndent(script) {
  return String(script || '').replace(/^\t+/gm, '');
}

function summarizeHarnessFailure(result, fallback) {
  const stderr = String(result.stderr || '').trim();
  const stdout = String(result.stdout || '').trim();
  const message = stderr || stdout || fallback;
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
  const meaningful = lines.find((line) => /^(runtimeerror|error|exception):/i.test(line))
    || lines.find((line) => !/^traceback/i.test(line) && !/^file\s+/i.test(line))
    || lines[lines.length - 1]
    || fallback;
  return meaningful.length > 240 ? `${meaningful.slice(0, 237)}...` : meaningful;
}

function classifyLinkedInPageState(url, bodyText, title = '') {
  const normalizedUrl = String(url || '');
  const normalizedBody = String(bodyText || '').toLowerCase();
  const normalizedTitle = String(title || '').toLowerCase();

  if (/\/checkpoint\//i.test(normalizedUrl)
    || /captcha|security verification|verify your identity|sicherheitsüberprüfung/i.test(normalizedBody)) {
    return 'captcha_or_checkpoint';
  }

  if (/\/login/i.test(normalizedUrl)
    || /sign in|anmelden|log in/i.test(normalizedTitle)
    || /session_key|forgot password/i.test(normalizedBody)) {
    return 'reauth_required';
  }

  if (/temporarily restricted|unusual activity|zu viele anfragen|eingeschränkt/i.test(normalizedBody)) {
    return 'blocked';
  }

  if (/linkedin\.com\/sales\//i.test(normalizedUrl)
    || /sales navigator/i.test(normalizedTitle)
    || /sales navigator/i.test(normalizedBody)) {
    return 'authenticated';
  }

  return 'blocked';
}

function pyString(value) {
  return JSON.stringify(String(value));
}

function pyStringArray(values) {
  return JSON.stringify((values || []).map((value) => String(value)));
}

module.exports = {
  BrowserHarnessSalesNavigatorDriver,
  classifyLinkedInPageState,
  defaultCommandRunner,
  extractHarnessJson,
};
