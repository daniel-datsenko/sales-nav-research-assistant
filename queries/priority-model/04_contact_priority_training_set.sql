WITH won_contacts AS (
  SELECT
    o.sfdc_opportunity_id,
    o.sfdc_account_id,
    o.opportunity_name,
    o.amount,
    o.close_date,
    c.sfdc_contact_id,
    c.contact_name,
    c.contact_title,
    c.contact_department,
    c.division,
    c.email
  FROM `your_project.crm_marts.dim_sfdc_opportunities` o
  JOIN `your_project.crm_marts.xref_sfdc_opportunity_contacts` oc
    ON o.sfdc_opportunity_id = oc.sfdc_opportunity_id
  JOIN `your_project.crm_marts.dim_sfdc_contacts` c
    ON oc.sfdc_contact_id = c.sfdc_contact_id
  WHERE o.is_won = TRUE
    AND o.is_closed = TRUE
),
activity_summary AS (
  SELECT
    related_opportunity_id AS sfdc_opportunity_id,
    LOWER(TRIM(email)) AS participant_email,
    COUNT(*) AS activity_count,
    MAX(engagement_score) AS max_engagement_score,
    MAX(IF(conversation_intelligence_call_object_id IS NOT NULL, 1, 0)) AS has_conversation_intelligence_call
  FROM `your_project.crm_marts.dim_sfdc_task_events`,
  UNNEST(SPLIT(COALESCE(participant_email_list, ''), ',')) AS email
  WHERE related_opportunity_id IS NOT NULL
    AND TRIM(COALESCE(email, '')) != ''
  GROUP BY 1, 2
)
SELECT
  wc.sfdc_account_id,
  wc.sfdc_opportunity_id,
  wc.opportunity_name,
  wc.amount,
  wc.close_date,
  wc.sfdc_contact_id,
  wc.contact_name,
  wc.contact_title,
  wc.contact_department,
  wc.division,
  COALESCE(a.activity_count, 0) AS activity_count,
  COALESCE(a.max_engagement_score, 0) AS max_engagement_score,
  COALESCE(a.has_conversation_intelligence_call, 0) AS has_conversation_intelligence_call,
  TRUE AS label_closed_won_contact
FROM won_contacts wc
LEFT JOIN activity_summary a
  ON wc.sfdc_opportunity_id = a.sfdc_opportunity_id
 AND LOWER(wc.email) = a.participant_email;
