const { readJson } = require('../lib/json');

function loadPersonaModes(filePath) {
  const modes = readJson(filePath);
  return Array.isArray(modes) ? modes : [];
}

function getPersonaModeById(modes, modeId) {
  return (modes || []).find((mode) => mode.id === modeId) || null;
}

function expandModeSearchTemplates(mode, searchTemplates) {
  if (!mode) {
    return [];
  }

  const templateMap = new Map((searchTemplates || []).map((template) => [template.id, template]));
  return (mode.searchTemplateIds || [])
    .map((templateId) => templateMap.get(templateId))
    .filter(Boolean);
}

module.exports = {
  loadPersonaModes,
  getPersonaModeById,
  expandModeSearchTemplates,
};
