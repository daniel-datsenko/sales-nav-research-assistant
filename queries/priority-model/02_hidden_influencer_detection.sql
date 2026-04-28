WITH won_opps AS (
  SELECT
    sfdc_opportunity_id,
    sfdc_account_id,
    opportunity_name,
    close_date,
    amount
  FROM `your_project.crm_marts.dim_sfdc_opportunities`
  WHERE is_won = TRUE
    AND is_closed = TRUE
),
opp_contact_emails AS (
  SELECT DISTINCT
    oc.sfdc_opportunity_id,
    LOWER(c.email) AS email
  FROM `your_project.crm_marts.xref_sfdc_opportunity_contacts` oc
  JOIN `your_project.crm_marts.dim_sfdc_contacts` c
    ON oc.sfdc_contact_id = c.sfdc_contact_id
  WHERE c.email IS NOT NULL
),
activity_participants AS (
  SELECT
    t.related_opportunity_id AS sfdc_opportunity_id,
    t.related_account_id AS sfdc_account_id,
    t.activity_date,
    t.task_type,
    t.task_subject,
    t.call_brief,
    LOWER(TRIM(email)) AS participant_email
  FROM `your_project.crm_marts.dim_sfdc_task_events` t,
  UNNEST(SPLIT(COALESCE(t.participant_email_list, ''), ',')) AS email
  WHERE t.related_opportunity_id IS NOT NULL
    AND TRIM(COALESCE(email, '')) != ''
    AND t.activity_classification IN ('Customer-Facing Meeting', 'Successful Call', 'Inbound Response')
),
hidden_influencers AS (
  SELECT
    a.sfdc_opportunity_id,
    a.sfdc_account_id,
    a.participant_email,
    c.contact_title,
    COUNT(*) AS activity_count,
    MIN(a.activity_date) AS first_seen_date,
    MAX(a.activity_date) AS last_seen_date,
    ARRAY_AGG(DISTINCT a.task_type IGNORE NULLS LIMIT 5) AS task_types,
    ARRAY_AGG(DISTINCT a.task_subject IGNORE NULLS LIMIT 5) AS task_subjects
  FROM activity_participants a
  LEFT JOIN opp_contact_emails oc
    ON a.sfdc_opportunity_id = oc.sfdc_opportunity_id
   AND a.participant_email = oc.email
  LEFT JOIN `your_project.crm_marts.dim_sfdc_contacts` c
    ON a.sfdc_account_id = c.sfdc_account_id
   AND a.participant_email = LOWER(c.email)
  WHERE oc.email IS NULL
  GROUP BY 1, 2, 3, 4
)
SELECT
  w.opportunity_name,
  w.amount,
  h.sfdc_account_id,
  h.participant_email,
  h.contact_title,
  h.activity_count,
  h.first_seen_date,
  h.last_seen_date,
  h.task_types,
  h.task_subjects
FROM hidden_influencers h
JOIN won_opps w
  ON h.sfdc_opportunity_id = w.sfdc_opportunity_id
WHERE h.activity_count >= 2
ORDER BY w.amount DESC, h.activity_count DESC;
