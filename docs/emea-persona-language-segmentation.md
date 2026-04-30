# EMEA Persona and Language Segmentation

## Goal

Make Account Coverage safer and more useful for EMEA SDAs by separating three decisions that were previously implicit:

1. **Territory context:** the SDA should state which territory/account scope they are working unless connected GTM/BigQuery data can infer it.
2. **EMEA persona expansion:** searches and scoring should recognize localized EMEA platform, cloud, observability, data-platform, FinOps, CCOE, and technical-lead titles, not only English titles.
3. **Email-language split:** exported/review lists should be splittable into `DE` and `EN` buckets, where `DE` means profile language German and `EN` means English plus all other non-German profile languages.

## Territory context policy

Default behavior should be explicit:

- If no GTM/BigQuery-derived territory rows are available, ask the SDA to provide:
  - `territoryId` or a human-readable territory name,
  - countries/account scope,
  - preferred primary language if they want a non-default split.
- If BigQuery rows are available, infer:
  - `territoryId`,
  - `territoryName`,
  - `region`,
  - account countries,
  - language split default.

The implementation lives in `src/core/emea-territory.js` and is intentionally pure/testable. It does not connect to BigQuery itself; it can consume rows from the existing GTM/BigQuery adapter path once a user has configured access.

## EMEA persona coverage

Additions focus on SDR-validated hidden-stakeholder patterns:

- FinOps / Cloud Governance / CCOE:
  - `FinOps`, `CCOE`, `Cloud Center of Excellence`, `Cloud Centre of Excellence`, `Cloud Competency Center`, `Cloud Governance`, `Cloud Practice`.
- Observability / SRE / Monitoring:
  - `Observability Leader`, `Observability Manager`, `Monitoring Lead`, `SRE Lead`, plus tool signals.
- Data/AI platform:
  - `Data Platform Lead`, `Data Platform Architect`, `MLOps`, `AIOps`, `DataOps`, `AI Platform`.
- Platform delivery/tooling:
  - `Technical Lead`, `Tech Lead`, `DevSecOps`, `Kubernetes`, `Terraform`, `Ansible`, `CI/CD`.
- Vendor/tool signals:
  - `Datadog`, `Dynatrace`, `New Relic`, `Splunk`, `Prometheus`, `Grafana`, `Elastic`, `AppDynamics`, `Instana`, `Honeycomb`, `Jaeger`, `Zipkin`, `Victoria Metrics`, `Zabbix`, `Nagios`.

Localized EMEA title hints now include French, German, Italian, and Spanish examples, e.g. `Responsable Plateforme`, `Directeur Technique`, `Leiter Cloud`, `Cloud Kompetenzzentrum`, `Responsabile Piattaforma`, `Direttore Tecnico`, `Jefe de Plataforma`, and `Director Técnico`.

## False-positive protection

Expanded search terms increase recall, so exclusions were strengthened for non-ICP commercial/operational profiles:

- Facilities / Facility / Hard FM / Catering
- Fleet
- HSEQ / Health & Safety / Environmental
- Procurement / Purchasing / Category Manager
- Commercial Finance / Finance
- Supply Chain / Logistics
- Sales Director / Director of Sales
- localized buying/sales terms such as `Achats`, `Einkauf`, `Compras`, `Acquisti`, `Vendite`

## Email list split

`splitCandidatesByProfileLanguage()` creates:

- `DE`: explicit or inferred German profile language.
- `EN`: English and all other languages.

This directly supports the SDA email workflow: one German-language outreach list and one English/default-language outreach list.

List names are deterministic via `buildLanguageSplitListNames()`:

- `<Account> - <segment> - DE`
- `<Account> - <segment> - EN`

## Safety

This is config/scoring/list-segmentation work only. It does not save lists, send messages, connect to candidates, or open Sales Navigator profiles. Live Sales Navigator mutation gates remain unchanged and still require explicit operator opt-in.
