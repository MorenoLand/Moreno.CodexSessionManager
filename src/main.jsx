import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './context.css';
import './file-table.css';

const icons = {
  archive: 'M4 7h16M5 7v12h14V7M8 4h8l1 3H7l1-3',
  branch: 'M6 4v16M6 8h8a4 4 0 0 1 4 4v4M18 16l-2 2 2 2',
  check: 'M5 12l4 4L19 6',
  chevron: 'M7 9l5 5 5-5',
  copy: 'M8 8h11v11H8zM5 5h11v3M5 5v11h3',
  database: 'M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3ZM4 6v6c0 2 4 3 8 3s8-1 8-3V6M4 12v6c0 2 4 3 8 3s8-1 8-3v-6',
  file: 'M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 17h6',
  filter: 'M4 5h16l-6 7v6l-4 2v-8z',
  folder: 'M3 6h7l2 2h9v10H3z',
  home: 'M4 11l8-7 8 7M6 10v9h12v-9M10 19v-5h4v5',
  info: 'M12 11v5M12 7h.01M21 12a9 9 0 1 1-18 0',
  message: 'M5 5h14v10H9l-4 4zM8 9h8M8 12h5',
  refresh: 'M20 11a8 8 0 0 0-14-4L4 9M4 5v4h4M4 13a8 8 0 0 0 14 4l2-2M20 19v-4h-4',
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM16 16l5 5',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4',
  trash: 'M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3',
  unlock: 'M7 10V7a5 5 0 0 1 9.5-2M5 10h14v10H5zM12 14v2',
  x: 'M6 6l12 12M18 6 6 18'
};

function Icon({ name, size = 18 }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name] || icons.archive} /></svg>;
}
function Button({ children, icon, variant = 'secondary', onClick, disabled }) {
  return <button className={'button ' + variant} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={16} />}{children}</button>;
}
function formatBytes(value) {
  const n = Number(value) || 0;
  if (!n) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const index = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return (n / 1024 ** index).toFixed(index ? 1 : 0) + ' ' + units[index];
}
function formatGiB(value) {
  return ((Number(value) || 0) / 1024 ** 3).toFixed(2) + ' GiB';
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
function shortId(value) {
  const text = String(value || '');
  return text.length > 19 ? text.slice(0, 8) + '...' + text.slice(-6) : text;
}
function promptPreview(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 280 ? text.slice(0, 277).trimEnd() + '…' : text;
}

function Sidebar({ view, setView, onScan, queueCount, sessionRoot, archivedRoot }) {
  const primary = [['overview', 'Overview', 'home'], ['roots', 'Conversation roots', 'branch'], ['archived', 'Archived sessions', 'archive'], ['all', 'All files', 'file'], ['catalog', 'Catalog DB', 'database']];
  const settings = [['locations', 'Storage locations', 'folder'], ['filters', 'Filters', 'filter'], ['preferences', 'Preferences', 'settings']];
  return <aside className="sidebar"><div className="brand"><span className="brand-mark"><Icon name="archive" size={19} /></span><span>Session Shelf</span></div><div className="side-scroll"><nav className="side-nav">{primary.map(([id, label, icon]) => <button key={id} className={'nav-item ' + (view === id ? 'active' : '')} onClick={() => setView(id)}><Icon name={icon} /><span>{label}</span></button>)}</nav><div className="nav-heading">Actions</div><nav className="side-nav"><button className="nav-item" onClick={onScan}><Icon name="refresh" /><span>Scan sessions</span></button><button className={'nav-item ' + (view === 'queue' ? 'active' : '')} onClick={() => setView('queue')}><Icon name="archive" /><span>Review queue</span>{queueCount > 0 && <span className="nav-count">{queueCount}</span>}</button><button className={'nav-item ' + (view === 'recycle' ? 'active' : '')} onClick={() => setView('recycle')}><Icon name="trash" /><span>Recycle Bin</span></button></nav><div className="nav-heading">Settings</div><nav className="side-nav">{settings.map(([id, label, icon]) => <button key={id} className={'nav-item ' + (view === id ? 'active' : '')} onClick={() => setView(id)}><Icon name={icon} /><span>{label}</span></button>)}</nav></div><div className="storage-card"><div className="storage-label"><span className="status-dot" />Current sessions</div><div className="storage-path" title={sessionRoot}>{sessionRoot || 'Detecting session directory...'}</div><div className="storage-label"><span className="status-dot" />Archived sessions</div><div className="storage-path" title={archivedRoot}>{archivedRoot || 'Detecting archive directory...'}</div><div className="storage-meta">Local scan only</div></div></aside>;
}
function Header({ data, onScan, scanning, view }) {
  const labels = { overview: 'Overview', roots: 'Conversation roots', archived: 'Archived sessions', all: 'All files', catalog: 'Catalog DB', queue: 'Review queue', recycle: 'Recycle Bin', locations: 'Storage locations', filters: 'Filters', preferences: 'Preferences' };
  const icon = view === 'roots' ? 'folder' : view === 'all' ? 'file' : view === 'catalog' ? 'database' : view === 'recycle' ? 'trash' : 'archive';
  return <header className="topbar"><div className="topbar-title"><Icon name={icon} size={23} /><span>{labels[view] || 'Session Shelf'}</span></div><div className="topbar-stats"><div className="stat-emphasis"><Icon name="database" size={22} /><strong>{data ? formatGiB(data.stats.totalBytes) : '—'}</strong></div><span>{data ? data.stats.fileCount + ' files' : 'Scanning'}</span></div><div className="topbar-actions"><Button icon="refresh" onClick={onScan} disabled={scanning}>{scanning ? 'Scanning...' : 'Scan sessions'}</Button><span className={'scan-state ' + (scanning ? 'scanning' : '')}><Icon name={scanning ? 'refresh' : 'check'} size={16} />{scanning ? 'Reading JSONL metadata' : data ? 'Scanned ' + formatDate(data.scannedAt) : 'Waiting'}</span><Icon name="settings" size={20} /></div></header>;
}
function SearchTools({ query, setQuery, sort, setSort }) {
  return <div className="tools-row"><label className="search-box"><Icon name="search" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search conversation roots..." /><kbd>Ctrl K</kbd></label><button className="icon-button" title="Filters"><Icon name="filter" size={18} /></button><label className="sort-select"><span>Sort by</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="size">size (desc)</option><option value="recent">last activity</option><option value="files">file count</option><option value="name">name</option></select><Icon name="chevron" size={15} /></label></div>;
}
function AgentBadge({ agent }) {
  const name = String(agent || '').trim();
  const isRoot = !name || ['root', 'main'].includes(name.toLowerCase());
  return <span className={'agent-badge ' + (isRoot ? 'root' : '')} title={isRoot ? 'Main/root transcript' : name}><i /><span>{isRoot ? 'Root' : name}</span></span>;
}
function RootRow({ group, selected, selectedPaths, onSelect }) {
  const checked = group.files.length > 0 && group.files.every(file => selectedPaths.has(file.path));
  return <button className={'root-row ' + (selected ? 'selected' : '')} onClick={onSelect}><span className="root-row-check" onClick={event => event.stopPropagation()}><input type="checkbox" checked={checked} onChange={() => onSelect('toggle')} aria-label={'Select all files in ' + group.title} /></span><span className="root-icon"><Icon name="branch" size={19} /></span><span className="root-copy"><strong>{group.title}</strong><small>{shortId(group.rootId)}</small></span><span className="root-files">{group.fileCount}</span><span className="root-size">{formatGiB(group.sizeBytes)}</span><span className="root-date">{formatDate(group.lastActivity)}</span></button>;
}
function RootList({ groups, selectedGroup, selectedPaths, setSelectedGroup, toggleGroup, query, setQuery, sort, setSort }) {
  return <section className="center-pane"><SearchTools query={query} setQuery={setQuery} sort={sort} setSort={setSort} /><div className="list-head"><span>Conversation root</span><span>Files</span><span>Reclaimable size</span><span>Last activity</span></div><div className="root-list">{groups.length ? groups.map(group => <RootRow key={group.key || group.rootId} group={group} selected={(selectedGroup?.key || selectedGroup?.rootId) === (group.key || group.rootId)} selectedPaths={selectedPaths} onSelect={mode => mode === 'toggle' ? (setSelectedGroup(group), toggleGroup(group)) : setSelectedGroup(group)} />) : <EmptyState title="No matching roots" detail="Try a different search or scan the directory again." />}</div><div className="list-footer"><span>{groups.length} visible roots</span><span>Selected: {selectedPaths.size} files</span></div></section>;
}
function FileTable({ files, selectedPaths, toggleFile, reveal }) {
  return <div className="file-table"><div className="file-table-head"><span /><span>Agent</span><span>File name</span><span>Size</span><span>Last modified</span><span /></div>{files.map(file => <div className={'file-row ' + (selectedPaths.has(file.path) ? 'selected' : '')} key={file.path}><input type="checkbox" checked={selectedPaths.has(file.path)} onChange={() => toggleFile(file.path)} aria-label={'Select ' + file.name} /><AgentBadge agent={file.agent} /><button className="file-name" onClick={() => reveal(file.path)} title={file.path}><Icon name="file" size={15} /><span>{file.name}</span></button><span>{formatBytes(file.sizeBytes)}</span><span>{formatDate(file.lastModified)}</span><button className="reveal-button" title="Show in Explorer" onClick={() => reveal(file.path)}><Icon name="folder" size={15} /></button></div>)}</div>;
}
function ContextPreview({ group, context, loading, error, loadContext }) {
  const active = context?.path === group.rootPath;
  const messages = active ? context.messages : [];
  return <section className="context-preview"><div className="context-window-bar"><div className="context-window-ident"><span className="context-window-icon"><Icon name="message" size={15} /></span><div><strong>{group.title}</strong><span>{shortId(group.rootId)} · stored transcript</span></div></div><button className="context-action" onClick={() => loadContext(group.rootPath)} disabled={loading}><Icon name="message" size={15} />{loading && active ? 'Reading...' : active ? 'Refresh' : 'Preview messages'}</button></div>{loading && active ? <div className="context-state">Reading the first messages...</div> : error && active ? <div className="context-state context-error">{error}</div> : active && messages.length ? <div className="context-thread">{messages.map((message, index) => <article className={'context-message ' + message.role} key={message.role + '-' + index}><div className="context-message-meta"><span className={'context-avatar ' + message.role}>{message.role === 'user' ? 'Y' : 'C'}</span><strong>{message.role === 'user' ? 'You' : 'Codex'}</strong><span className="context-message-index">{index + 1}/{messages.length}</span></div><div className="context-bubble"><p>{message.text}</p></div></article>)}</div> : active ? <div className="context-state">No user or assistant messages were found in the preview window.</div> : <div className="context-state">Load a small preview before deciding whether this root is worth keeping.</div>}{active && !loading && messages.length > 0 && <div className="context-note">{context.limited ? 'Showing the first ' + messages.length + ' messages; the transcript stays untouched.' : 'Reached the end of this transcript preview.'}</div>}</section>;
}
function Inspector({ group, selectedPaths, kept, setKept, toggleFile, toggleGroup, review, reveal }) {
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  async function loadContext(filePath) {
    setContext({ path: filePath, messages: [], limited: false });
    setContextError('');
    setContextLoading(true);
    try {
      const response = await fetch('/api/context?path=' + encodeURIComponent(filePath) + '&limit=6');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Context preview failed');
      setContext(result);
    } catch (error) {
      setContextError(error.message);
    } finally {
      setContextLoading(false);
    }
  }
  if (!group) return <aside className="inspector empty-inspector"><div className="empty-illustration"><Icon name="branch" size={30} /></div><h2>Choose a conversation root</h2><p>Select a group to see its forked files, lineage, and reclaimable space.</p></aside>;
  const selectedInGroup = group.files.filter(file => selectedPaths.has(file.path)).length;
  return <aside className="inspector"><div className="inspector-top"><div><h1>{group.title}</h1><p className="inspector-size">{formatGiB(group.sizeBytes)} <span>reclaimable</span></p></div><span className="file-count"><strong>{group.fileCount}</strong><small>files</small></span></div><Button variant="primary" icon="archive" onClick={review} disabled={!selectedInGroup || kept}>Review {selectedInGroup || group.fileCount} files</Button><div className="detail-block"><div className="detail-row"><span>Root thread</span><strong className="copyable" title={group.rootId}>{shortId(group.rootId)} <Icon name="copy" size={14} /></strong></div><div className="detail-row"><span>Codex title</span><strong>{group.title}</strong></div><div className="detail-row"><span>First request</span><strong className="detail-prompt" title={group.prompt}>{promptPreview(group.prompt) || 'No user prompt found'}</strong></div><div className="detail-row"><span>Forked agents</span><div className="agent-list">{group.agents.length ? group.agents.map(agent => <span className="agent-chip" key={agent}><i />{agent}</span>) : <span className="muted">No named agents</span>}</div></div><div className="detail-row"><span>Last activity</span><strong>{formatDate(group.lastActivity)}</strong></div><div className="detail-row"><span>File count</span><strong>{group.fileCount} JSONL files</strong></div><div className="detail-row"><span>Location</span><strong className="path-text" title={group.cwd}>{group.cwd || 'Unknown'}</strong></div></div><ContextPreview group={group} context={context} loading={contextLoading} error={contextError} loadContext={loadContext} /><div className="forked-heading"><h2>Forked files <span>({group.fileCount})</span></h2><label><input type="checkbox" checked={selectedInGroup === group.fileCount} onChange={() => toggleGroup(group)} /> Select all</label></div><FileTable files={group.files} selectedPaths={selectedPaths} toggleFile={toggleFile} reveal={reveal} /><div className="safe-zone"><div className="review-box"><Icon name={kept ? 'check' : 'unlock'} size={20} /><div><strong>{kept ? 'Conversation kept' : 'Review required'}</strong><span>{kept ? 'This root is excluded from the review queue.' : 'Review the selected files before they can move to the Recycle Bin.'}</span></div></div><label className="keep-toggle"><input type="checkbox" checked={kept} onChange={event => setKept(event.target.checked)} /><span><strong>Keep this conversation</strong><small>Exclude from deletion</small></span></label><Button variant="danger" icon="trash" onClick={review} disabled={!selectedInGroup || kept}>Move selected to Recycle Bin</Button><div className="selection-foot"><span>{selectedInGroup} of {group.fileCount} files selected</span><span>{formatBytes(group.files.filter(file => selectedPaths.has(file.path)).reduce((sum, file) => sum + file.sizeBytes, 0))}</span></div></div></aside>;
}
function AllFilesView({ files, selectedPaths, toggleFile, reveal, query, setQuery }) {
  const visible = files.filter(file => (file.name + ' ' + file.groupTitle + ' ' + file.agent + ' ' + file.rootId).toLowerCase().includes(query.toLowerCase()));
  return <section className="center-pane full-pane"><div className="tools-row"><label className="search-box"><Icon name="search" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search files, roots, or agents..." /></label></div><div className="all-files-heading"><div><h1>All JSONL files</h1><p>Every file is shown with its owning conversation root.</p></div><span>{visible.length} visible</span></div><FileTable files={visible} selectedPaths={selectedPaths} toggleFile={toggleFile} reveal={reveal} /></section>;
}
function QueueView({ files, selectedPaths, toggleFile, reveal, onReview }) {
  const selected = files.filter(file => selectedPaths.has(file.path));
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Review queue</h1><p>Only files you explicitly selected are eligible for review.</p></div><Button variant="primary" icon="archive" onClick={onReview} disabled={!selected.length}>Review {selected.length} files</Button></div>{selected.length ? <FileTable files={selected} selectedPaths={selectedPaths} toggleFile={toggleFile} reveal={reveal} /> : <EmptyState title="Nothing queued" detail="Select files from a conversation root and they will appear here." />}</section>;
}
function CatalogView() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [sort, setSort] = useState({ key: 'source_updated_at', direction: 'desc' });
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/catalog');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Catalog load failed');
      setCatalog(result);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const toggle = key => setSort(current => current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });
  const rows = [...(catalog?.rows || [])].sort((a, b) => {
    const left = a[sort.key] ?? '';
    const right = b[sort.key] ?? '';
    const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return sort.direction === 'asc' ? result : -result;
  });
  const headers = [['orphaned', 'Status'], ['host_id', 'Host'], ['display_title', 'Title'], ['thread_id', 'Thread ID'], ['source_kind', 'Source']];
  async function remove() {
    if (!pending || confirmation !== 'REMOVE') return;
    setBusy(true);
    try {
      const response = await fetch('/api/catalog/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'REMOVE', threadIds: [pending.thread_id] }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Catalog row removal failed');
      setPending(null);
      setConfirmation('');
      await load();
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy(false);
    }
  }
  return <><section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Catalog DB</h1><p>Local thread catalog. Orphaned rows have no matching transcript file.</p><p className="path-text">{catalog?.dbPath || 'Loading...'}</p></div><Button icon="refresh" onClick={load} disabled={busy}>Refresh</Button></div>{error && <div className="error-banner">{error}</div>}{catalog?.error && <div className="error-banner">{catalog.error}</div>}<div className="file-table catalog-table"><div className="file-table-head">{headers.map(([key, label]) => <button className="catalog-sort" key={key} onClick={() => toggle(key)}>{label}<span>{sort.key === key ? sort.direction === 'asc' ? '▲' : '▼' : '↕'}</span></button>)}<span /></div>{rows.map(row => <div className={'file-row ' + (row.orphaned ? 'selected' : '')} key={row.host_id + '-' + row.thread_id}><span>{row.orphaned ? 'ORPHANED' : 'OK'}</span><span>{row.host_id}</span><span title={row.display_title}>{row.display_title}</span><span>{row.thread_id}</span><span>{row.source_kind || row.thread_source || 'local'}</span><button className="reveal-button" disabled={!row.orphaned || busy} onClick={() => { setConfirmation(''); setPending(row); }}><Icon name="trash" size={15} /></button></div>)}</div></section>{pending && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setPending(null)}><Icon name="x" /></button><div className="modal-icon"><Icon name="trash" size={24} /></div><h2>Remove orphaned catalog row?</h2><p>This removes only the metadata row. It does not modify any transcript.</p><div className="modal-summary"><strong>{pending.display_title || 'Untitled'}</strong><span className="catalog-modal-id">{pending.thread_id}</span></div><label className="confirm-input"><span>Type REMOVE to confirm</span><input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoFocus /></label><div className="modal-actions"><Button onClick={() => setPending(null)}>Cancel</Button><Button variant="danger" icon="trash" onClick={remove} disabled={confirmation !== 'REMOVE' || busy}>{busy ? 'Removing...' : 'Remove catalog row'}</Button></div></div></div>}</>;
}
function Overview({ data }) {
  const stats = data?.stats;
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Overview</h1><p>Storage summary for your local Codex session data.</p></div><span>{data ? formatDate(data.scannedAt) : 'Scanning...'}</span></div><div className="detail-block"><div className="detail-row"><span>Total storage</span><strong>{stats ? formatGiB(stats.totalBytes) : '—'}</strong></div><div className="detail-row"><span>Conversation roots</span><strong>{stats?.groupCount ?? '—'}</strong></div><div className="detail-row"><span>JSONL files</span><strong>{stats?.fileCount ?? '—'}</strong></div><div className="detail-row"><span>Current sessions</span><strong>{data?.currentStats ? data.currentStats.groupCount + ' roots / ' + data.currentStats.fileCount + ' files' : '—'}</strong></div><div className="detail-row"><span>Archived sessions</span><strong>{data?.archivedStats ? data.archivedStats.groupCount + ' roots / ' + data.archivedStats.fileCount + ' files' : '—'}</strong></div><div className="detail-row"><span>Sessions directory</span><strong className="path-text">{data?.root || 'Detecting...'}</strong></div><div className="detail-row"><span>Archive directory</span><strong className="path-text">{data?.archivedRoot || 'Detecting...'}</strong></div></div></section>;
}
function RecycleView() {
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Recycle Bin</h1><p>Session Shelf sends selected JSONL files to the operating system trash.</p></div></div><div className="empty-state"><Icon name="trash" size={28} /><h2>Nothing to review here</h2><p>Use Conversation roots or Archived sessions to inspect files before moving them. Recovery remains available through the operating system trash.</p></div></section>;
}
function SettingsView({ title }) {
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>{title}</h1><p>This local-only view is reserved for Session Shelf configuration.</p></div></div><div className="empty-state"><Icon name="settings" size={28} /><h2>No changes required</h2><p>The current session directory and safety rules are active.</p></div></section>;
}
function EmptyState({ title, detail }) {
  return <div className="empty-state"><Icon name="archive" size={28} /><h2>{title}</h2><p>{detail}</p></div>;
}
function ReviewModal({ files, onClose, onConfirm, busy, removeCatalogRows, setRemoveCatalogRows }) {
  const [value, setValue] = useState('');
  const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  return <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={onClose}><Icon name="x" /></button><div className="modal-icon"><Icon name="trash" size={24} /></div><h2>Move files to system trash?</h2><p>{files.length} selected JSONL files will be moved reversibly.</p><div className="modal-summary"><strong>{formatBytes(total)}</strong><span>{files.length} files</span></div><div className="modal-file-list">{files.slice(0, 12).map(file => <div key={file.path}><span>{file.name}</span><span>{formatBytes(file.sizeBytes)}</span></div>)}</div><label className="keep-toggle catalog-cleanup-toggle"><input type="checkbox" checked={removeCatalogRows} onChange={event => setRemoveCatalogRows(event.target.checked)} /><span><strong>Remove matching Catalog DB entries</strong><small>Only after the selected files reach system trash.</small></span></label><label className="confirm-input"><span>Type MOVE to confirm</span><input value={value} onChange={event => setValue(event.target.value)} autoFocus /></label><div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="danger" icon="trash" onClick={onConfirm} disabled={value !== 'MOVE' || busy}>{busy ? 'Moving...' : 'Move selected'}</Button></div></div></div>;
}
function App() {
  const [data, setData] = useState(null);
  const [view, setViewState] = useState(() => localStorage.getItem('session-shelf.view') || 'roots');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [selectedRootKey, setSelectedRootKey] = useState('');
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  const [keptRoots, setKeptRoots] = useState(new Set());
  const [reviewFiles, setReviewFiles] = useState(null);
  const [removeCatalogRows, setRemoveCatalogRows] = useState(false);
  const [moving, setMoving] = useState(false);
  const [toast, setToast] = useState('');
  const [rootQuery, setRootQuery] = useState('');
  const [rootSort, setRootSort] = useState('size');
  const [allQuery, setAllQuery] = useState('');
  const setView = useCallback(nextView => { setViewState(nextView); localStorage.setItem('session-shelf.view', nextView); }, []);
  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const response = await fetch('/api/scan?includeArchived=1');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Session scan failed');
      setData(result);
      setError('');
    } catch (scanError) {
      setError(scanError.message);
    } finally {
      setScanning(false);
    }
  }, []);
  useEffect(() => { scan(); }, [scan]);
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  const activeArchived = view === 'archived';
  const activeGroups = activeArchived ? (data?.archivedGroups || []) : (data?.groups || []);
  const selectedGroup = activeGroups.find(group => (group.key || group.rootId) === selectedRootKey) || activeGroups[0];
  const selectedFiles = useMemo(() => data?.files.filter(file => selectedPaths.has(file.path)) || [], [data, selectedPaths]);
  const visibleGroups = useMemo(() => {
    const lower = rootQuery.toLowerCase();
    return activeGroups.filter(group => (group.title + ' ' + group.prompt + ' ' + group.cwd + ' ' + group.rootId).toLowerCase().includes(lower)).sort((a, b) => rootSort === 'recent' ? new Date(b.lastActivity) - new Date(a.lastActivity) : rootSort === 'files' ? b.fileCount - a.fileCount : rootSort === 'name' ? a.title.localeCompare(b.title) : b.sizeBytes - a.sizeBytes);
  }, [activeGroups, rootQuery, rootSort]);
  function toggleFile(filePath) {
    setSelectedPaths(current => { const next = new Set(current); if (next.has(filePath)) next.delete(filePath); else next.add(filePath); return next; });
  }
  function toggleGroup(group) {
    setSelectedPaths(current => { const next = new Set(current); const everySelected = group.files.every(file => next.has(file.path)); group.files.forEach(file => everySelected ? next.delete(file.path) : next.add(file.path)); return next; });
  }
  function setKept(keep) {
    if (!selectedGroup) return;
    const groupKey = selectedGroup.key || selectedGroup.rootId;
    setKeptRoots(current => { const next = new Set(current); if (keep) next.add(groupKey); else next.delete(groupKey); return next; });
    if (keep) setSelectedPaths(current => new Set([...current].filter(filePath => !selectedGroup.files.some(file => file.path === filePath))));
  }
  async function reveal(filePath) {
    try { await fetch('/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: filePath }) }); } catch {}
  }
  function review() {
    const files = selectedGroup?.files.filter(file => selectedPaths.has(file.path)) || [];
    if (files.length) { setRemoveCatalogRows(false); setReviewFiles(files); }
  }
  async function moveSelected() {
    if (!reviewFiles?.length) return;
    setMoving(true);
    try {
      const response = await fetch('/api/recycle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: reviewFiles.map(file => file.path), removeCatalogRows }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Recycle Bin move failed');
      setSelectedPaths(current => new Set([...current].filter(filePath => !reviewFiles.some(file => file.path === filePath))));
      setReviewFiles(null);
      setToast(result.catalog?.error ? 'Files moved; Catalog DB cleanup failed: ' + result.catalog.error : 'Moved ' + reviewFiles.length + ' files to system trash' + (result.catalog?.removed ? ' and removed ' + result.catalog.removed + ' Catalog DB entries.' : '.'));
      await scan();
    } catch (moveError) {
      setError(moveError.message);
    } finally {
      setMoving(false);
    }
  }
  const rootView = <><RootList groups={visibleGroups} selectedGroup={selectedGroup} selectedPaths={selectedPaths} setSelectedGroup={group => setSelectedRootKey(group.key || group.rootId)} toggleGroup={toggleGroup} query={rootQuery} setQuery={setRootQuery} sort={rootSort} setSort={setRootSort} /><Inspector group={selectedGroup} selectedPaths={selectedPaths} kept={selectedGroup ? keptRoots.has(selectedGroup.key || selectedGroup.rootId) : false} setKept={setKept} toggleFile={toggleFile} toggleGroup={toggleGroup} review={review} reveal={reveal} /></>;
  let content = rootView;
  if (view === 'overview') content = <Overview data={data} />;
  if (view === 'all') content = <AllFilesView files={data?.files || []} selectedPaths={selectedPaths} toggleFile={toggleFile} reveal={reveal} query={allQuery} setQuery={setAllQuery} />;
  if (view === 'catalog') content = <CatalogView />;
  if (view === 'queue') content = <QueueView files={data?.files || []} selectedPaths={selectedPaths} toggleFile={toggleFile} reveal={reveal} onReview={review} />;
  if (view === 'recycle') content = <RecycleView />;
  if (['locations', 'filters', 'preferences'].includes(view)) content = <SettingsView title={view === 'locations' ? 'Storage locations' : view[0].toUpperCase() + view.slice(1)} />;
  const browsingRoots = view === 'roots' || view === 'archived';
  return <div className="app-shell"><Sidebar view={view} setView={setView} onScan={scan} queueCount={selectedPaths.size} sessionRoot={data?.root} archivedRoot={data?.archivedRoot} /><div className="main-shell"><Header data={data} onScan={scan} scanning={scanning} view={view} />{error && <div className="error-banner"><Icon name="info" /><span>{error}</span><button onClick={() => setError('')}><Icon name="x" /></button></div>}<main className={'workspace ' + (browsingRoots ? '' : 'single')}>{content}</main><footer className="statusbar"><span><span className="status-dot" />Local only</span><span>{data ? data.stats.groupCount + ' roots / ' + data.stats.fileCount + ' JSONL files' : 'Preparing scan'}</span><span className="status-path">{data?.root || 'Detecting session directory...'}</span></footer></div>{reviewFiles && <ReviewModal files={reviewFiles} onClose={() => { setReviewFiles(null); setRemoveCatalogRows(false); }} onConfirm={moveSelected} busy={moving} removeCatalogRows={removeCatalogRows} setRemoveCatalogRows={setRemoveCatalogRows} />}{toast && <div className="toast"><Icon name="check" size={16} />{toast}</div>}</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
