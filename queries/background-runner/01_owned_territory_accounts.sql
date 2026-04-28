WITH owner_aliases AS (
  SELECT owner_alias
  FROM (
    SELECT LOWER('{{owner_name}}') AS owner_alias
    UNION ALL
    SELECT LOWER('{{owner_name_reversed}}')
    UNION ALL
    SELECT LOWER('{{owner_email}}')
  )
  WHERE owner_alias != ''
),
owner_activity AS (
  SELECT
    te.related_account_id AS sfdc_account_id,
    MAX(te.activity_date) AS last_owner_activity_at,
    COUNT(*) AS owner_activity_count
  FROM `your_project.crm_marts.dim_sfdc_task_events` te
  WHERE te.related_account_id IS NOT NULL
    AND LOWER(COALESCE(te.sdr_name, '')) IN (SELECT owner_alias FROM owner_aliases)
    AND (
      te.is_meeting = TRUE
      OR te.is_call = TRUE
      OR COALESCE(te.task_type, '') != ''
      OR LOWER(COALESCE(te.event_category, '')) = 'task'
    )
  GROUP BY 1
),
account_activity AS (
  SELECT
    te.related_account_id AS sfdc_account_id,
    MAX(te.activity_date) AS last_activity_at,
    COUNT(*) AS recent_activity_count
  FROM `your_project.crm_marts.dim_sfdc_task_events` te
  WHERE te.related_account_id IS NOT NULL
    AND (
      te.is_meeting = TRUE
      OR te.is_call = TRUE
      OR COALESCE(te.task_type, '') != ''
      OR LOWER(COALESCE(te.event_category, '')) = 'task'
    )
  GROUP BY 1
),
territory_accounts AS (
  SELECT
    a.sfdc_account_id,
    COALESCE(a.sfdc_account_name, a.name) AS account_name,
    a.sfdc_account_owner_name AS owner_name,
    a.sfdc_account_owner_email AS owner_email,
    a.parent_id AS parent_account_id,
    parent.sfdc_account_name AS parent_account_name,
    a.region,
    a.industry,
    a.tier AS account_tier,
    aa.last_activity_at,
    aa.recent_activity_count,
    DATE_DIFF(CURRENT_DATE(), DATE(aa.last_activity_at), DAY) AS days_since_activity,
    oa.last_owner_activity_at,
    oa.owner_activity_count,
    DATE_DIFF(CURRENT_DATE(), DATE(oa.last_owner_activity_at), DAY) AS days_since_owner_activity,
    a.current_assigned_territory_c AS territory_name,
    a.sfdc_account_sdr_name,
    a.sfdc_account_sdr_email
  FROM owner_activity oa
  JOIN `your_project.crm_marts.dim_sfdc_accounts` a
    ON a.sfdc_account_id = oa.sfdc_account_id
    AND a.is_current = TRUE
  LEFT JOIN `your_project.crm_marts.dim_sfdc_accounts` parent
    ON a.parent_id = parent.sfdc_account_id
    AND parent.is_current = TRUE
  LEFT JOIN account_activity aa
    ON aa.sfdc_account_id = a.sfdc_account_id
)
SELECT *
FROM territory_accounts
WHERE COALESCE(days_since_activity, 99999) >= {{stale_days}}
ORDER BY
  COALESCE(days_since_activity, 99999) DESC,
  account_name ASC;
