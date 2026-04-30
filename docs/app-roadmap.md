# Sales Navigator App Roadmap

This roadmap turns the current Sales Navigator research workflow into a real internal app for territory-based prospecting and list building.

## What the app already has

- account-first LinkedIn Sales Navigator traversal
- Playwright for fast discovery and automated live mutations such as save-to-list
- Browser Harness as an explicit manual diagnostic surface for fragile LinkedIn UI variants
- SQLite state, approvals, checkpoints, and local dashboard
- configurable ICP scoring and deep profile review

## What the app should become

The app should let a rep choose:

- an account or territory
- a search mode
- a persona focus
- a save strategy

Then the app should:

1. identify the correct Sales Navigator account
2. run the right search templates for the selected mode
3. score candidates with title, profile, and historical Salesforce winner patterns
4. recover hidden influencers using profile review and meeting/conversation data
5. write the best candidates into a list
6. place connect-worthy people into an approval queue

## Product Modes

The current first-pass modes are defined in `config/modes/default.json`.

- `account-mode`
  Best for one named account and one focused list.
- `territory-sweep`
  Best for SDR or AE territory traversal at scale.
- `platform-owner-mode`
  Best for platform, architecture, and infrastructure ownership.
- `technical-champion-mode`
  Best for hands-on operators and likely evaluators.
- `executive-buyer-mode`
  Best for directors, heads, VPs, and technical decision makers.
- `hidden-influencer-mode`
  Best for people whose titles are weak but whose profile or activity signals are strong.

## Data sources we should leverage

### LinkedIn Sales Navigator

- fast candidate discovery
- real profile text
- list building
- direct human-review surface

### Salesforce in BigQuery

- `dim_sfdc_contacts`
  current-state people, titles, departments, divisions, owners, territories
- `xref_sfdc_opportunity_contacts`
  which contacts were actually linked to opportunities
- `dim_sfdc_opportunities`
  stage, value, deal type, won/lost, dates
- `dim_sfdc_task_events`
  meetings, calls, LinkedIn activity, participant emails, call briefs, next steps

### Conversation Intelligence in BigQuery

- keyword mentions
- account-level call contexts
- evaluation, pricing, migration, and competitor language
- hidden influencers that never became proper CRM contacts

## Priority Model v1

The app should score people across four dimensions:

1. `ICP fit`
   title, role family, seniority, profile signals
2. `Historical win fit`
   how similar the person is to contacts found on closed-won opportunities
3. `Engagement fit`
   whether similar titles or people show up in meetings, task events, or Conversation Intelligence
4. `Coverage fit`
   whether the account is still missing a needed role in the buying group

## Coverage model

For good multi-threading, we should not optimize for a single “best lead.”
We should optimize for a balanced buying-group shape:

- one or more technical champions
- one platform or architecture owner
- one management-layer sponsor
- one buyer or sign-off role when present

## App ideas that will improve outcomes

### 1. Buying-group coverage meter

Show which roles are already covered and which are missing:

- `Champion found`
- `Platform owner found`
- `Security/infrastructure owner found`
- `Director/head found`
- `Executive buyer missing`

This helps reps avoid overfilling one persona and missing another.

### 2. Hidden influencer detector

Use Salesforce task participants and Conversation Intelligence-linked people to find names or titles that appear in real deal work but are missing from CRM opportunity contacts.

### 3. “Why this lead” explanations

Every recommended lead should show:

- why the title matches
- which profile signals matched
- whether similar titles have historically led to won deals
- whether this role fills a missing buying-group gap

### 4. Quality tiers

Each saved lead should get a tier:

- `Core`
- `Secondary`
- `Exploratory`

That keeps lists useful instead of miexample-network strong and weak leads together.

### 5. Account memory

When we revisit an account, the app should remember:

- which modes worked best
- which keywords produced the strongest candidates
- which weak candidates were later promoted or rejected

## Next implementation steps

1. add persona mode selection to the CLI and dashboard
2. build the first BigQuery-derived `priority_score_v1`
3. add a coverage-meter view to the dashboard
4. store lead tiering and mode provenance on candidates
5. add “suggested removals” for weak exploratory leads already saved
