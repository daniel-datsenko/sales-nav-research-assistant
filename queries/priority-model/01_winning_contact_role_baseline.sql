WITH won_contacts AS (
  SELECT
    o.sfdc_opportunity_id,
    o.opportunity_name,
    o.amount,
    o.close_date,
    c.sfdc_account_id,
    c.sfdc_account_name,
    c.sfdc_contact_id,
    c.contact_name,
    c.contact_title,
    c.contact_department,
    c.division,
    LOWER(COALESCE(c.contact_title, '')) AS title_lower
  FROM `your_project.crm_marts.dim_sfdc_opportunities` o
  JOIN `your_project.crm_marts.xref_sfdc_opportunity_contacts` oc
    ON o.sfdc_opportunity_id = oc.sfdc_opportunity_id
  JOIN `your_project.crm_marts.dim_sfdc_contacts` c
    ON oc.sfdc_contact_id = c.sfdc_contact_id
  WHERE o.is_won = TRUE
    AND o.is_closed = TRUE
    AND COALESCE(c.contact_title, '') != ''
)
SELECT
  CASE
    WHEN REGEXP_CONTAINS(title_lower, r'site reliability|\\bsre\\b') THEN 'site_reliability'
    WHEN REGEXP_CONTAINS(title_lower, r'architect|architecture') THEN 'architecture'
    WHEN REGEXP_CONTAINS(title_lower, r'platform') THEN 'platform'
    WHEN REGEXP_CONTAINS(title_lower, r'devops') THEN 'devops'
    WHEN REGEXP_CONTAINS(title_lower, r'infrastructure') THEN 'infrastructure'
    WHEN REGEXP_CONTAINS(title_lower, r'security') THEN 'security'
    WHEN REGEXP_CONTAINS(title_lower, r'cloud') THEN 'cloud'
    WHEN REGEXP_CONTAINS(title_lower, r'engineering|engineer') THEN 'engineering'
    WHEN REGEXP_CONTAINS(title_lower, r'data|analytics') THEN 'data'
    WHEN REGEXP_CONTAINS(title_lower, r'technology|\\bit\\b|sap') THEN 'it_technology'
    ELSE 'other'
  END AS title_family,
  COUNT(DISTINCT sfdc_contact_id) AS unique_contacts,
  COUNT(DISTINCT sfdc_opportunity_id) AS won_opportunities,
  ROUND(SUM(amount), 2) AS total_won_amount,
  ROUND(AVG(amount), 2) AS avg_won_amount
FROM won_contacts
GROUP BY 1
ORDER BY total_won_amount DESC, won_opportunities DESC;
