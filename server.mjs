import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, realpathSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import trash from 'trash';

let SqliteDatabaseSync = null;
try { ({ DatabaseSync: SqliteDatabaseSync } = await import('node:sqlite')); } catch {}

const appDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(appDir, 'frontend');
const distDir = path.join(frontendDir, 'dist');
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const defaultStorageConfig = {
  currentRoot: path.resolve(process.env.SESSION_SHELF_ROOT || path.join(codexHome, 'sessions')),
  archivedRoot: path.resolve(process.env.SESSION_SHELF_ARCHIVED_ROOT || path.join(codexHome, 'archived_sessions')),
  catalogDb: path.resolve(process.env.CODEX_CATALOG_DB || path.join(codexHome, 'sqlite', 'codex-dev.db'))
};
const configDir = process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Session Shelf') : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Session Shelf') : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'session-shelf');
const settingsPath = path.join(configDir, 'settings.json');
let rootDir = defaultStorageConfig.currentRoot;
let archivedRootDir = defaultStorageConfig.archivedRoot;
let catalogDbPath = defaultStorageConfig.catalogDb;
const port = Number(process.env.PORT || 4310);
const sqliteCommand = process.env.CODEX_SQLITE_COMMAND || (process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3');
let sessionRoots = [];
let lastScanFiles = new Map();

function refreshSessionRoots() {
  sessionRoots = [
    { key: 'current', label: 'Current sessions', path: rootDir, archived: false },
    { key: 'archived', label: 'Archived sessions', path: archivedRootDir, archived: true }
  ].filter((root, index, roots) => roots.findIndex(candidate => candidate.path.toLowerCase() === root.path.toLowerCase()) === index);
}

function absoluteStoragePath(value, label) {
  const text = String(value || '').trim();
  if (!text || !path.isAbsolute(text)) throw new Error(`${label} must be an absolute path.`);
  return path.resolve(text);
}

function getStorageSettings() {
  return { currentRoot: rootDir, archivedRoot: archivedRootDir, catalogDb: catalogDbPath, settingsPath, defaults: defaultStorageConfig };
}

async function loadStorageSettings() {
  try {
    const stored = JSON.parse(await readFile(settingsPath, 'utf8'));
    if (!process.env.SESSION_SHELF_ROOT && stored.currentRoot) rootDir = absoluteStoragePath(stored.currentRoot, 'Current sessions directory');
    if (!process.env.SESSION_SHELF_ARCHIVED_ROOT && stored.archivedRoot) archivedRootDir = absoluteStoragePath(stored.archivedRoot, 'Archived sessions directory');
    if (!process.env.CODEX_CATALOG_DB && stored.catalogDb) catalogDbPath = absoluteStoragePath(stored.catalogDb, 'Catalog DB path');
  } catch {}
  refreshSessionRoots();
}

async function saveStorageSettings() {
  await mkdir(configDir, { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify({ currentRoot: rootDir, archivedRoot: archivedRootDir, catalogDb: catalogDbPath }, null, 2)}\n`, 'utf8');
}

refreshSessionRoots();
await loadStorageSettings();

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function decodeJsonString(value) {
  return value.replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\r/g, '\r').replace(/\\n/g, '\n');
}

function matchJsonField(line, field) {
  const match = line.match(new RegExp(`"${field}":"(?<value>(?:\\\\.|[^"\\\\])*)"`));
  return match ? decodeJsonString(match.groups.value) : '';
}

function cleanPrompt(value) {
  let text = String(value || '').replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi, '').replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, '').replace(/<app-context>[\s\S]*?<\/app-context>/gi, '').trim();
  const requestMarker = text.indexOf('## My request:');
  if (requestMarker >= 0) text = text.slice(requestMarker + '## My request:'.length).trim();
  if (!text || text.startsWith('<') || text.startsWith('# AGENTS.md')) return '';
  return text.replace(/\r?\n/g, ' ');
}

function cleanContextText(value) {
  return String(value || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractMessageText(payload) {
  const content = payload?.content;
  const blocks = Array.isArray(content) ? content.map((block) => typeof block === 'string' ? block : block?.text || block?.value || '').filter(Boolean).join(' ') : typeof content === 'string' ? content : '';
  return cleanContextText(blocks || payload?.message || payload?.text || '');
}

function extractContextMessage(record) {
  const payload = record?.payload || {};
  if (record?.type === 'response_item' && ['user', 'assistant'].includes(payload.role)) {
    const rawText = extractMessageText(payload);
    return { role: payload.role, text: payload.role === 'user' ? cleanPrompt(rawText) : rawText };
  }
  if (record?.type === 'event_msg' && payload.type === 'user_message') return { role: 'user', text: cleanPrompt(payload.message) };
  if (record?.type === 'event_msg' && payload.type === 'agent_message') return { role: 'assistant', text: cleanContextText(payload.message) };
  return null;
}

async function readContext(filePath, limit = 6) {
  const messages = [];
  const seen = new Set();
  const name = path.basename(filePath);
  let lineNumber = 0;
  let readBytes = 0;
  let limited = false;
  let readError = '';
  let finished = false;
  await new Promise((resolve) => {
    const input = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const finish = () => {
      if (finished) return;
      finished = true;
      lines.close();
      input.destroy();
      resolve();
    };
    lines.on('line', (line) => {
      if (finished) return;
      lineNumber += 1;
      readBytes += Buffer.byteLength(line, 'utf8');
      if (lineNumber > 4000 || readBytes > 8 * 1024 * 1024) {
        limited = true;
        finish();
        return;
      }
      try {
        const message = extractContextMessage(JSON.parse(line));
        if (!message?.text) return;
        const text = message.text.length > 720 ? `${message.text.slice(0, 720).trimEnd()}…` : message.text;
        const key = `${message.role}\u0000${text}`;
        if (seen.has(key)) return;
        seen.add(key);
        messages.push({ role: message.role, text });
        if (messages.length >= limit) {
          limited = true;
          finish();
        }
      } catch {}
    });
    lines.on('close', resolve);
    input.on('error', (error) => {
      readError = error.message;
      finish();
    });
  });
  return { name, path: filePath, messages, limited, readError };
}

function runSqlite(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(sqliteCommand, args, { windowsHide: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `sqlite3 exited with code ${code}`)));
    child.stdin.end(input);
  });
}

async function loadCatalogRows() {
  try { await access(catalogDbPath); } catch { return []; }
  const query = "SELECT host_id, thread_id, display_title, source_created_at, source_updated_at, cwd, source_kind, source_detail, model_provider, git_branch, observation_sequence, missing_candidate, thread_source, source_recency_at, pending_observed_title FROM local_thread_catalog ORDER BY source_updated_at DESC;";
  if (SqliteDatabaseSync) {
    try {
      const database = new SqliteDatabaseSync(catalogDbPath, { readOnly: true });
      const rows = database.prepare(query).all();
      database.close();
      return rows;
    } catch {}
  }
  try { return JSON.parse(await runSqlite(['-readonly', '-json', catalogDbPath, query]) || '[]'); } catch { return []; }
}

async function loadCatalogTitles() {
  const rows = await loadCatalogRows();
  return new Map(rows.filter((row) => row.thread_id && row.display_title).map((row) => [String(row.thread_id), String(row.display_title).trim()]));
}

function catalogTranscriptRoots() {
  return sessionRoots.map(root => root.path);
}

async function findTranscriptIds() {
  const ids = new Set();
  for (const root of catalogTranscriptRoots()) {
    try {
      for (const filePath of await listJsonlFiles(root)) {
        const name = path.basename(filePath);
        const match = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl)?$/i);
        if (match) ids.add(match[1].toLowerCase());
      }
    } catch {}
  }
  return ids;
}

async function getCatalogView() {
  const [rows, transcriptIds] = await Promise.all([loadCatalogRows(), findTranscriptIds()]);
  const dbExists = await access(catalogDbPath).then(() => true).catch(() => false);
  return { dbPath: catalogDbPath, available: dbExists, error: dbExists ? '' : 'Catalog DB was not found at this path.', rows: rows.map((row) => ({ ...row, orphaned: row.host_id === 'local' && !transcriptIds.has(String(row.thread_id).toLowerCase()) })) };
}

function sqlQuote(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function backupCatalogDatabase() {
  await access(catalogDbPath);
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
  const backupPath = path.join(path.dirname(catalogDbPath), `${path.basename(catalogDbPath)}.${timestamp}.bak`);
  if (SqliteDatabaseSync) {
    const database = new SqliteDatabaseSync(catalogDbPath);
    try {
      database.exec('PRAGMA busy_timeout=5000;');
      database.exec(`VACUUM INTO ${sqlQuote(backupPath)};`);
      return backupPath;
    } catch (error) {
      throw new Error(`Catalog DB backup failed: ${error.message}`);
    } finally { database.close(); }
  }
  try {
    await copyFile(catalogDbPath, backupPath);
    for (const suffix of ['-wal', '-shm']) {
      try { await copyFile(`${catalogDbPath}${suffix}`, `${backupPath}${suffix}`); } catch {}
    }
    return backupPath;
  } catch (error) {
    throw new Error(`Catalog DB backup failed: ${error.message}`);
  }
}

async function removeCatalogRows(threadIds, backupPath = '') {
  const ids = [...new Set(threadIds.map(String).filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];
  if (!ids.length) return { removed: 0, ids: [] };
  if (!backupPath) backupPath = await backupCatalogDatabase();
  if (SqliteDatabaseSync) {
    const database = new SqliteDatabaseSync(catalogDbPath);
    try {
      database.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
      const statement = database.prepare("DELETE FROM local_thread_catalog WHERE host_id='local' AND thread_id IN (" + ids.map(() => '?').join(',') + ');');
      const result = statement.run(...ids);
      const removed = Number(result.changes || 0);
      if (removed) database.prepare('UPDATE local_thread_catalog_metadata SET catalog_revision=catalog_revision+1 WHERE id=1;').run();
      database.exec('COMMIT;');
      return { removed, ids, backupPath };
    } catch (error) {
      try { database.exec('ROLLBACK;'); } catch {}
      throw error;
    } finally { database.close(); }
  }
  const predicates = ids.map(sqlQuote).join(',');
  const sql = `PRAGMA busy_timeout=5000; BEGIN IMMEDIATE; DELETE FROM local_thread_catalog WHERE host_id='local' AND thread_id IN (${predicates}); UPDATE local_thread_catalog_metadata SET catalog_revision=catalog_revision+1 WHERE id=1; COMMIT; SELECT changes() AS removed;`;
  const output = await runSqlite([catalogDbPath], sql);
  const match = output.match(/(\d+)\s*$/);
  return { removed: Number(match?.[1] || 0), ids, backupPath };
}

function pathSegment(value) {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop()?.replace(/[.,;:)\]}]+$/g, '').replace(/\.[^.]+$/, '') || '';
}

function makeTitle(prompt, cwd) {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (/Dibblerland/i.test(text)) return /GDI/i.test(text) && /SDL/i.test(text) ? 'Dibblerland / GDI to SDL' : 'Dibblerland';
  if (/GraalEditor/i.test(text)) return 'GraalEditor';
  const markdown = text.match(/([^\\/\s]+)\.md\b/i);
  if (markdown) return markdown[1];
  const embeddedPath = text.match(/[A-Za-z]:[\\/][^\s"'`<>]+/);
  const embeddedSegment = pathSegment(embeddedPath?.[0]);
  if (embeddedSegment && !['Users', 'null'].includes(embeddedSegment)) return embeddedSegment;
  const firstToken = text.split(/\s+/)[0]?.replace(/^[\[({]+|[\]})>,.;:]+$/g, '');
  if (firstToken && (firstToken.includes('\\') || /^[A-Za-z]:[\\/]/.test(firstToken))) {
    const segment = pathSegment(firstToken);
    if (segment) return segment;
  }
  if (text) return `${text.slice(0, 61).trimEnd()}${text.length > 61 ? '…' : ''}`;
  const folder = pathSegment(cwd);
  if (folder) return folder;
  return 'Untitled conversation';
}

async function listJsonlFiles(root) {
  const result = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) result.push(fullPath);
    }
  }
  return result;
}

async function readSessionFile(filePath) {
  const file = await stat(filePath);
  const name = path.basename(filePath);
  const idMatch = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  const item = {
    id: idMatch ? idMatch[1] : name,
    parent: '',
    rootId: idMatch ? idMatch[1] : name,
    cwd: '',
    agent: '',
    prompt: '',
    sessionTimestamp: '',
    lastModified: file.mtime.toISOString(),
    sizeBytes: file.size,
    path: filePath,
    name,
    readError: ''
  };
  let lineNumber = 0;
  let finished = false;
  await new Promise((resolve) => {
    const input = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const finish = () => {
      if (finished) return;
      finished = true;
      lines.close();
      input.destroy();
      resolve();
    };
    lines.on('line', (line) => {
      lineNumber += 1;
      if (lineNumber === 1) {
        item.parent = matchJsonField(line, 'forked_from_id');
        item.cwd = matchJsonField(line, 'cwd');
        item.agent = matchJsonField(line, 'agent_nickname');
        item.sessionTimestamp = matchJsonField(line, 'timestamp');
      }
      if (line.includes('"type":"response_item"') && line.includes('"role":"user"')) {
        try {
          const content = JSON.parse(line)?.payload?.content;
          const candidate = Array.isArray(content) ? content.map((block) => block?.text).filter(Boolean).map(cleanPrompt).find(Boolean) : '';
          if (candidate) {
            item.prompt = candidate;
            finish();
          }
        } catch {}
      }
      if (!item.prompt && line.includes('"type":"event_msg"') && line.includes('"type":"user_message"')) {
        try {
          const message = cleanPrompt(JSON.parse(line)?.payload?.message);
          if (message) {
            item.prompt = message;
            finish();
          }
        } catch {}
      }
      if (lineNumber >= 100) finish();
    });
    lines.on('close', resolve);
    input.on('error', (error) => {
      item.readError = error.message;
      finish();
    });
  });
  return item;
}

async function mapLimit(values, limit, mapper) {
  const result = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return result;
}

function resolveRoots(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    let rootId = item.id;
    const seen = new Set();
    while (byId.has(rootId) && byId.get(rootId).parent && !seen.has(rootId)) {
      seen.add(rootId);
      rootId = byId.get(rootId).parent;
    }
    item.rootId = rootId;
  }
  return byId;
}

function buildGroups(items, byId, catalogTitles, source) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.rootId)) groups.set(item.rootId, []);
    groups.get(item.rootId).push(item);
  }
  return [...groups.entries()].map(([rootId, files]) => {
    const root = byId.get(rootId) || [...files].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
    const sortedFiles = [...files].sort((a, b) => b.sizeBytes - a.sizeBytes);
    const sizeBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
    const agents = [...new Set(files.map((file) => file.agent).filter(Boolean))];
    const lastActivity = files.reduce((latest, file) => Math.max(latest, Date.parse(file.lastModified)), 0);
    const title = catalogTitles.get(rootId) || makeTitle(root.prompt, root.cwd);
    return {
      key: `${source.key}:${rootId}`,
      rootId,
      storage: source.key,
      archived: source.archived,
      sourceLabel: source.label,
      title,
      titleSource: catalogTitles.has(rootId) ? 'Codex sidebar' : 'Derived from first request',
      prompt: root.prompt,
      cwd: root.cwd,
      sizeBytes,
      fileCount: files.length,
      lastActivity: new Date(lastActivity || Date.now()).toISOString(),
      agents,
      rootPath: root.path,
      files: sortedFiles.map((file) => ({ ...file, sizeGiB: file.sizeBytes / 1024 ** 3, groupTitle: title, storage: source.key, archived: source.archived }))
    };
  }).sort((a, b) => b.sizeBytes - a.sizeBytes);
}

async function scanSessionRoot(source, catalogTitles) {
  const exists = await access(source.path).then(() => true).catch(() => false);
  if (!exists) return { ...source, exists: false, stats: { fileCount: 0, totalBytes: 0, totalGiB: 0, groupCount: 0 }, groups: [], files: [] };
  const paths = await listJsonlFiles(source.path);
  const items = await mapLimit(paths, 8, async (filePath) => ({ ...await readSessionFile(filePath), storage: source.key, archived: source.archived }));
  const byId = resolveRoots(items);
  const groups = buildGroups(items, byId, catalogTitles, source);
  const groupByRoot = new Map(groups.map((group) => [group.rootId, group]));
  const files = items.map((item) => ({
    ...item,
    sizeGiB: item.sizeBytes / 1024 ** 3,
    groupTitle: groupByRoot.get(item.rootId)?.title || 'Untitled conversation'
  })).sort((a, b) => b.sizeBytes - a.sizeBytes);
  const totalBytes = items.reduce((total, item) => total + item.sizeBytes, 0);
  return {
    ...source,
    exists: true,
    stats: { fileCount: items.length, totalBytes, totalGiB: totalBytes / 1024 ** 3, groupCount: groups.length },
    groups,
    files
  };
}

async function scanSessions(includeArchived = true) {
  const catalogTitles = await loadCatalogTitles();
  const roots = await Promise.all(sessionRoots.filter((source) => includeArchived || !source.archived).map((source) => scanSessionRoot(source, catalogTitles)));
  const groups = roots.flatMap((source) => source.groups);
  const files = roots.flatMap((source) => source.files).sort((a, b) => b.sizeBytes - a.sizeBytes);
  const totalBytes = files.reduce((total, item) => total + item.sizeBytes, 0);
  const current = roots.find((source) => !source.archived);
  const archived = roots.find((source) => source.archived);
  lastScanFiles = new Map(files.map((file) => [path.resolve(file.path).toLowerCase(), { sizeBytes: file.sizeBytes, lastModified: file.lastModified }]));
  return {
    root: rootDir,
    archivedRoot: archivedRootDir,
    scannedAt: new Date().toISOString(),
    stats: { fileCount: files.length, totalBytes, totalGiB: totalBytes / 1024 ** 3, groupCount: groups.length },
    currentStats: current?.stats || { fileCount: 0, totalBytes: 0, totalGiB: 0, groupCount: 0 },
    archivedStats: archived?.stats || { fileCount: 0, totalBytes: 0, totalGiB: 0, groupCount: 0 },
    roots,
    groups: current?.groups || [],
    archivedGroups: archived?.groups || [],
    files
  };
}

function isWithinScanRoot(filePath) {
  const absolute = path.resolve(filePath);
  if (path.extname(absolute).toLowerCase() !== '.jsonl') return false;
  try {
    const resolvedFile = realpathSync(absolute).toLowerCase();
    return sessionRoots.some(root => {
      const resolvedRoot = realpathSync(root.path).toLowerCase();
      return resolvedFile.startsWith(`${resolvedRoot}${path.sep}`);
    });
  } catch {
    return false;
  }
}

async function reviewRecycle(paths, removeCatalogRows) {
  const unique = [...new Set(paths.map((filePath) => String(filePath).trim()).filter(Boolean))];
  if (!unique.length) throw new Error('No files selected');
  const review = { safe: true, totalBytes: 0, files: [], catalog: { dbPath: catalogDbPath, available: false, threadIds: [], requested: 0, backupRequired: false, error: '' } };
  for (const filePath of unique) {
    const absolute = path.resolve(filePath);
    const item = { path: absolute, name: path.basename(absolute), threadId: threadIdFromPath(absolute), ok: false, error: '', currentSizeBytes: 0, scannedSizeBytes: 0, currentLastModified: '', scannedLastModified: '' };
    if (!isWithinScanRoot(absolute)) item.error = 'Path is outside a configured sessions directory or is not JSONL.';
    let info = null;
    if (!item.error) {
      try { info = await stat(absolute); } catch { item.error = 'File is no longer available; scan again before moving it.'; }
    }
    if (info?.isDirectory()) item.error = 'Selected path is a directory.';
    if (info) {
      item.currentSizeBytes = Number(info.size);
      item.currentLastModified = info.mtime.toISOString();
      const snapshot = lastScanFiles.get(absolute.toLowerCase());
      if (!snapshot) item.error = 'File was not part of the latest scan; scan again before moving it.';
      else {
        item.scannedSizeBytes = Number(snapshot.sizeBytes);
        item.scannedLastModified = snapshot.lastModified;
        if (item.currentSizeBytes !== item.scannedSizeBytes || item.currentLastModified !== item.scannedLastModified) item.error = 'File changed since the last scan; scan again before moving it.';
      }
      if (!item.error) {
        try { await access(absolute); item.ok = true; } catch { item.error = 'File cannot be opened for verification; it may be locked or inaccessible.'; }
      }
    }
    if (!item.ok) review.safe = false;
    else {
      review.totalBytes += item.currentSizeBytes;
      if (item.threadId) review.catalog.threadIds.push(item.threadId);
    }
    review.files.push(item);
  }
  review.catalog.threadIds = [...new Set(review.catalog.threadIds.map((id) => id.toLowerCase()))];
  review.catalog.requested = review.catalog.threadIds.length;
  if (removeCatalogRows && review.catalog.requested) {
    review.catalog.backupRequired = true;
    review.catalog.available = await access(catalogDbPath).then(() => true).catch(() => false);
    if (!review.catalog.available) {
      review.catalog.error = 'Catalog DB is unavailable; matching entries cannot be removed safely.';
      review.safe = false;
    }
  }
  return review;
}

function recycleReviewError(review) {
  const file = review.files.find((item) => !item.ok);
  return file ? `Recycle blocked for ${file.name}: ${file.error}` : review.catalog.error || 'Recycle blocked by a safety check';
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) request.destroy(new Error('Request body too large'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}

async function recycleFiles(paths) {
  const result = [];
  for (const filePath of paths) {
    try {
      await trash(filePath);
      result.push({ path: filePath, ok: true });
    } catch (error) {
      result.push({ path: filePath, ok: false, error: error.message });
    }
  }
  return result;
}

function revealFile(filePath) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? [`/select,${filePath}`] : process.platform === 'darwin' ? ['-R', filePath] : [path.dirname(filePath)];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: process.platform === 'win32' });
    child.on('error', reject);
    child.unref();
    resolve();
  });
}

function threadIdFromPath(filePath) {
  return path.basename(filePath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)?.[1] || '';
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const candidate = path.resolve(distDir, `.${decodeURIComponent(requested)}`);
  const safeCandidate = candidate.toLowerCase().startsWith(`${distDir.toLowerCase()}${path.sep}`) ? candidate : path.join(distDir, 'index.html');
  let filePath = safeCandidate;
  try { await access(filePath); } catch { filePath = path.join(distDir, 'index.html'); }
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, { 'content-type': mimeTypes[extension] || 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
}

let viteServer = null;
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
    if (request.method === 'GET' && url.pathname === '/api/settings') return sendJson(response, 200, getStorageSettings());
    if (request.method === 'POST' && url.pathname === '/api/settings') {
      const payload = JSON.parse(await readBody(request));
      let next;
      try {
        next = {
          currentRoot: absoluteStoragePath(payload.currentRoot, 'Current sessions directory'),
          archivedRoot: absoluteStoragePath(payload.archivedRoot, 'Archived sessions directory'),
          catalogDb: absoluteStoragePath(payload.catalogDb, 'Catalog DB path')
        };
      } catch (error) {
        return sendJson(response, 400, { error: error.message });
      }
      const previous = { currentRoot: rootDir, archivedRoot: archivedRootDir, catalogDb: catalogDbPath };
      try {
        rootDir = next.currentRoot;
        archivedRootDir = next.archivedRoot;
        catalogDbPath = next.catalogDb;
        refreshSessionRoots();
        await saveStorageSettings();
        return sendJson(response, 200, { settings: getStorageSettings() });
      } catch (error) {
        rootDir = previous.currentRoot;
        archivedRootDir = previous.archivedRoot;
        catalogDbPath = previous.catalogDb;
        refreshSessionRoots();
        return sendJson(response, 500, { error: error.message });
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/scan') return sendJson(response, 200, await scanSessions(url.searchParams.get('includeArchived') !== '0'));
    if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { ok: true });
    if (request.method === 'GET' && url.pathname === '/api/catalog') return sendJson(response, 200, await getCatalogView());
    if (request.method === 'GET' && url.pathname === '/api/context') {
      const filePath = String(url.searchParams.get('path') || '');
      const requestedLimit = Number(url.searchParams.get('limit') || 6);
      if (!isWithinScanRoot(filePath)) return sendJson(response, 400, { error: 'Path is outside a configured sessions directory or is not JSONL' });
      return sendJson(response, 200, await readContext(filePath, Number.isFinite(requestedLimit) ? Math.min(8, Math.max(1, requestedLimit)) : 6));
    }
    if (request.method === 'POST' && url.pathname === '/api/catalog/remove') {
      const payload = JSON.parse(await readBody(request));
      if (payload.confirm !== 'REMOVE') return sendJson(response, 400, { error: 'Type REMOVE to confirm catalog-row deletion' });
      const ids = Array.isArray(payload.threadIds) ? payload.threadIds : [];
      return sendJson(response, 200, await removeCatalogRows(ids));
    }
    if (request.method === 'POST' && url.pathname === '/api/recycle/review') {
      const payload = JSON.parse(await readBody(request));
      return sendJson(response, 200, await reviewRecycle(Array.isArray(payload.paths) ? payload.paths : [], payload.removeCatalogRows === true));
    }
    if (request.method === 'POST' && url.pathname === '/api/recycle') {
      const payload = JSON.parse(await readBody(request));
      const paths = [...new Set(Array.isArray(payload.paths) ? payload.paths.map(String) : [])];
      const cleanup = payload.removeCatalogRows === true;
      const review = await reviewRecycle(paths, cleanup);
      if (!review.safe) return sendJson(response, 400, { error: recycleReviewError(review), review });
      let backupPath = '';
      if (cleanup && review.catalog.backupRequired) backupPath = await backupCatalogDatabase();
      const result = await recycleFiles(review.files.map((item) => item.path));
      const catalog = { requested: 0, removed: 0, ids: [], error: '' };
      if (cleanup) {
        catalog.ids = result.filter((item) => item.ok).map((item) => threadIdFromPath(item.path)).filter(Boolean);
        catalog.requested = catalog.ids.length;
        if (catalog.ids.length) {
          try {
            const removed = await removeCatalogRows(catalog.ids, backupPath);
            catalog.removed = removed.removed;
            catalog.backupPath = removed.backupPath;
          } catch (error) {
            catalog.error = error.message;
          }
        }
      }
      return sendJson(response, 200, { result, catalog });
    }
    if (request.method === 'POST' && url.pathname === '/api/reveal') {
      const payload = JSON.parse(await readBody(request));
      const filePath = String(payload.path || '');
      if (!isWithinScanRoot(filePath)) return sendJson(response, 400, { error: 'Path is outside a configured sessions directory or is not JSONL' });
      await revealFile(filePath);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'GET') {
      if (viteServer) return viteServer.middlewares(request, response, () => serveStatic(request, response, url.pathname));
      return serveStatic(request, response, url.pathname);
    }
    sendJson(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(response, 500, { error: error.message || String(error) });
  }
});

await mkdir(distDir, { recursive: true });
if (process.env.SESSION_SHELF_DEV !== '0') {
  const { createServer: createViteServer } = await import('vite');
  viteServer = await createViteServer({ root: frontendDir, server: { middlewareMode: true, hmr: { server } } });
}
server.listen(port, '127.0.0.1', () => {
  console.log(`Session Shelf listening at http://127.0.0.1:${port}`);
  console.log(`Sessions directory: ${rootDir}`);
});
