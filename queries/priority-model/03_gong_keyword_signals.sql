WITH tracker_hits AS (
  SELECT
    ctx.salesforce_account_id AS sfdc_account_id,
    ctx.salesforce_account_name AS sfdc_account_name,
    LOWER(t.name) AS tracker_keyword,
    COUNT(*) AS mention_count
  FROM `your_project.conversation_intelligence.CONVERSATION_TRACKERS` ct
  JOIN `your_project.conversation_intelligence.TRACKERS` t
    ON ct.tracker_id = t.id
  JOIN `your_project.conversation_intelligence.CONVERSATION_CONTEXTS` ctx
    ON ct.conversation_id = ctx.conversation_id
  WHERE ctx.salesforce_account_id IS NOT NULL
    AND LOWER(t.name) IN (
      'observability',
      'monitoring',
      'o11y',
      'observability-platform',
      'prometheus',
      'opentelemetry',
      'migration',
      'pricing',
      'evaluation',
      'datadog',
      'splunk',
      'new relic',
      'incident',
      'slo',
      'platform'
    )
  GROUP BY 1, 2, 3
)
SELECT
  sfdc_account_id,
  sfdc_account_name,
  ARRAY_AGG(STRUCT(tracker_keyword, mention_count) ORDER BY mention_count DESC) AS top_keywords
FROM tracker_hits
GROUP BY 1, 2
ORDER BY ARRAY_LENGTH(top_keywords) DESC, sfdc_account_name;
