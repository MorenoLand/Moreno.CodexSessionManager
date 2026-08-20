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

export async function apiScan(includeArchived) {
  const service = await wailsService();
  return service ? service.Scan(includeArchived) : request('/api/scan?includeArchived=' + (includeArchived ? '1' : '0'));
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

export async function apiReviewRecycle(paths, removeCatalogRows) {
  const service = await wailsService();
  return service ? service.ReviewRecycle(paths, removeCatalogRows) : request('/api/recycle/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths, removeCatalogRows }) });
}
