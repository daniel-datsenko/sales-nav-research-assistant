WITH owner_activity AS (
  SELECT
    te.related_account_id AS sfdc_account_id
  FROM `your_project.crm_marts.dim_sfdc_task_events` te
  WHERE te.related_account_id IS NOT NULL
    AND LOWER(COALESCE(te.sdr_name, '')) IN (LOWER('{{owner_name}}'), LOWER('{{owner_name_reversed}}'))
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
base_accounts AS (
  SELECT DISTINCT
    a.sfdc_account_id,
    COALESCE(a.sfdc_account_name, a.name) AS account_name,
    a.parent_id AS parent_account_id,
    parent.sfdc_account_name AS parent_account_name,
    a.sfdc_account_owner_name AS owner_name,
    a.sfdc_account_owner_email AS owner_email,
    aa.last_activity_at,
    DATE_DIFF(CURRENT_DATE(), DATE(aa.last_activity_at), DAY) AS days_since_activity
  FROM `your_project.crm_marts.dim_sfdc_accounts`
  AS a
  LEFT JOIN `your_project.crm_marts.dim_sfdc_accounts` parent
    ON a.parent_id = parent.sfdc_account_id
    AND parent.is_current = TRUE
  LEFT JOIN account_activity aa
    ON aa.sfdc_account_id = a.sfdc_account_id
  WHERE a.is_current = TRUE
    AND a.sfdc_account_id IN (SELECT sfdc_account_id FROM owner_activity)
),
subsidiary_candidates AS (
  SELECT
    child.sfdc_account_id,
    COALESCE(child.sfdc_account_name, child.name) AS account_name,
    child.parent_id AS parent_account_id,
    parent.account_name AS parent_account_name,
    child.sfdc_account_owner_name AS owner_name,
    child.sfdc_account_owner_email AS owner_email,
    parent.sfdc_account_id AS matched_parent_account_id,
    parent.account_name AS matched_parent_account_name,
    parent.last_activity_at AS matched_parent_last_activity_at,
    parent.days_since_activity AS matched_parent_days_since_activity
  FROM `your_project.crm_marts.dim_sfdc_accounts` child
  JOIN base_accounts parent
    ON child.parent_id = parent.sfdc_account_id
  WHERE child.is_current = TRUE
)
SELECT *
FROM subsidiary_candidates
ORDER BY
  matched_parent_account_name,
  account_name;
