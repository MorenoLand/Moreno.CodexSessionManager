let wailsServicePromise;

function runningInWails() {
  return typeof window !== 'undefined' && Boolean(window.wails);
}

async function wailsService() {
  if (!runningInWails()) return null;
  wailsServicePromise ||= import('../bindings/github.com/denveous/session-shelf/internal/shelf/service.js');
  return wailsServicePromise;
}

async function request(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Session Shelf request failed');
  return result;
}

function browserAliases() {
  try { return JSON.parse(localStorage.getItem('session-shelf.aliases') || '{}'); } catch { return {}; }
}

function applyBrowserAliases(data) {
  const aliases = browserAliases();
  const aliasFor = rootId => aliases[String(rootId || '').toLowerCase()];
  const applyGroup = group => { const title = aliasFor(group.rootId); return title ? { ...group, title, titleSource: 'Manual alias', files: group.files.map(file => ({ ...file, groupTitle: title })) } : group; };
  return { ...data, groups: (data.groups || []).map(applyGroup), archivedGroups: (data.archivedGroups || []).map(applyGroup), roots: (data.roots || []).map(root => ({ ...root, groups: (root.groups || []).map(applyGroup), files: (root.files || []).map(file => { const title = aliasFor(file.rootId); return title ? { ...file, groupTitle: title } : file; }) })), files: (data.files || []).map(file => { const title = aliasFor(file.rootId); return title ? { ...file, groupTitle: title } : file; }) };
}

export async function apiScan(includeArchived) {
  const service = await wailsService();
  const result = service ? await service.Scan(includeArchived) : await request('/api/scan?includeArchived=' + (includeArchived ? '1' : '0'));
  return service ? result : applyBrowserAliases(result);
}

export async function apiScanStatus() {
  const service = await wailsService();
  return service ? service.GetScanStatus() : { running: false, cancelable: false, phase: '', filesTotal: 0, filesCompleted: 0, indexHits: 0, indexMisses: 0, cancelled: false };
}

export async function apiCancelScan() {
  const service = await wailsService();
  return service ? service.CancelScan() : false;
}

export async function apiContext(filePath, limit) {
  const service = await wailsService();
  return service ? service.Preview(filePath, limit) : request('/api/context?path=' + encodeURIComponent(filePath) + '&limit=' + limit);
}

export async function apiCatalog() {
  const service = await wailsService();
  return service ? service.GetCatalog() : request('/api/catalog');
}

export async function apiRemoveCatalogRows(confirm, threadIds) {
  const service = await wailsService();
  return service ? service.RemoveCatalogRows(confirm, threadIds) : request('/api/catalog/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm, threadIds }) });
}

export async function apiSettings() {
  const service = await wailsService();
  return service ? service.GetSettings() : request('/api/settings');
}

export async function apiSaveSettings(settings) {
  const service = await wailsService();
  if (service) return service.SaveSettings(settings);
  const result = await request('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) });
  return result.settings;
}

export async function apiReveal(filePath) {
  const service = await wailsService();
  if (service) return service.Reveal(filePath);
  return request('/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: filePath }) });
}

export async function apiRecycle(paths, removeCatalogRows) {
  const service = await wailsService();
  return service ? service.Recycle(paths, removeCatalogRows) : request('/api/recycle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths, removeCatalogRows }) });
}

export async function apiSaveTitleAlias(rootId, title) {
  const service = await wailsService();
  if (service) return service.SaveTitleAlias(rootId, title);
  const aliases = browserAliases();
  const normalized = String(title || '').trim();
  if (normalized) aliases[String(rootId).toLowerCase()] = normalized;
  else delete aliases[String(rootId).toLowerCase()];
  localStorage.setItem('session-shelf.aliases', JSON.stringify(aliases));
  return { rootId, title: normalized };
}

export async function apiReviewRecycle(paths, removeCatalogRows) {
  const service = await wailsService();
  return service ? service.ReviewRecycle(paths, removeCatalogRows) : request('/api/recycle/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths, removeCatalogRows }) });
}
