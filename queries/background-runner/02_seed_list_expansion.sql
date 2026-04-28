WITH seed_accounts AS (
  SELECT DISTINCT
    LOWER(TRIM(seed.account_name)) AS account_name_key,
    seed.account_name,
    seed.seed_type,
    seed.seed_name
  FROM `{{seed_dataset}}.territory_runner_seed_accounts` seed
  WHERE LOWER(seed.owner_name) IN (LOWER('{{owner_name}}'), LOWER('{{owner_name_reversed}}'))
),
crm_accounts AS (
  SELECT
    a.sfdc_account_id,
    COALESCE(a.sfdc_account_name, a.name) AS account_name,
    a.sfdc_account_owner_name AS owner_name,
    a.sfdc_account_owner_email AS owner_email,
    a.parent_id AS parent_account_id,
    parent.sfdc_account_name AS parent_account_name,
    a.region,
    a.industry
  FROM `your_project.crm_marts.dim_sfdc_accounts` a
  LEFT JOIN `your_project.crm_marts.dim_sfdc_accounts` parent
    ON a.parent_id = parent.sfdc_account_id
    AND parent.is_current = TRUE
  WHERE a.is_current = TRUE
)
SELECT
  crm_accounts.*,
  seed_accounts.seed_type,
  seed_accounts.seed_name
FROM seed_accounts
JOIN crm_accounts
  ON LOWER(TRIM(crm_accounts.account_name)) = seed_accounts.account_name_key
ORDER BY
  seed_accounts.seed_type,
  crm_accounts.account_name;
