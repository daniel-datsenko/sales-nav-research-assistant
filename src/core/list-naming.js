function buildDeterministicListName({ territoryName, account, template, icpConfig }) {
  const prefix = icpConfig?.listNaming?.prefix || 'OBS';
  const maxLength = icpConfig?.listNaming?.maxLength || 80;
  const parts = [
    prefix,
    territoryName,
    account.region || account.country,
    template.listSegment || template.id,
    account.name,
  ].filter(Boolean);

  const value = parts.join(' | ');
  return value.length > maxLength ? value.slice(0, maxLength - 1).trimEnd() : value;
}

module.exports = {
  buildDeterministicListName,
};
