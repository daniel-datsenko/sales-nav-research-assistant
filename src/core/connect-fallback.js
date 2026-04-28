async function maybeFallbackToLeadPageConnect({
  initialResult,
  driver,
  row,
  accountKey = 'unknown',
  runId = 'pilot-connect-batch-list-row-fallback',
}) {
  const result = await Promise.resolve(initialResult || {});
  const status = String(result.status || '').trim();
  const targetUrl = String(row?.salesNavigatorUrl || row?.profileUrl || '').trim();

  if (!['menu_empty', 'connect_unavailable'].includes(status)) {
    return result;
  }
  if (!targetUrl || typeof driver?.sendConnect !== 'function') {
    return result;
  }

  const buildFallbackErrorResult = (message) => {
    const normalizedMessage = String(message || '').trim() || 'unknown fallback error';
    const notes = [result.note, `lead-page fallback failed: ${normalizedMessage}`].filter(Boolean);
    return {
      ...result,
      note: notes.join(' | '),
      connectPath: 'lead_page_fallback_failed',
      fallbackTriggeredBy: status,
      fallbackError: normalizedMessage,
      initialStatus: status,
      initialNote: result.note || null,
    };
  };

  let fallbackResult = null;
  try {
    fallbackResult = await driver.sendConnect(
      {
        fullName: row?.fullName,
        salesNavigatorUrl: targetUrl,
        profileUrl: targetUrl,
      },
      {
        runId,
        accountKey,
        dryRun: false,
      },
    );
  } catch (error) {
    return buildFallbackErrorResult(error?.message);
  }

  if (!fallbackResult || typeof fallbackResult !== 'object') {
    return buildFallbackErrorResult('lead-page fallback returned no structured result');
  }

  const notes = [fallbackResult.note, `lead-page fallback after ${status}`].filter(Boolean);
  return {
    ...fallbackResult,
    note: notes.join(' | '),
    connectPath: 'lead_page_fallback',
    fallbackTriggeredBy: status,
    initialStatus: status,
    initialNote: result.note || null,
  };
}

module.exports = {
  maybeFallbackToLeadPageConnect,
};
