import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './context.css';
import './file-table.css';
import './window-chrome.css';
import { apiArchive, apiCancelScan, apiCatalog, apiContext, apiDiagnostics, apiExport, apiPickStorage, apiRecycle, apiRemoveCatalogRows, apiReveal, apiReviewArchive, apiReviewRecycle, apiSaveSettings, apiSaveTitleAlias, apiScan, apiScanStatus, apiSearchContext, apiSettings } from './backend.js';
import { closeWindow, hasDesktopWindow, isWindowMaximised, minimiseWindow, subscribeWindowState, toggleMaximiseWindow } from './windowControls.js';

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
  maximize: 'M5 5h14v14H5z',
  minimize: 'M5 12h14',
  refresh: 'M20 11a8 8 0 0 0-14-4L4 9M4 5v4h4M4 13a8 8 0 0 0 14 4l2-2M20 19v-4h-4',
  restore: 'M8 8h11v11H8zM5 5h11v3M5 5v11h3',
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
function csvCell(value) { return '"' + String(value ?? '').replaceAll('"', '""') + '"'; }
const defaultPreferences = { includeArchived: true, previewLimit: 6 };
const defaultFilters = { minGiB: '', minFiles: '', agent: 'all', forkedOnly: false };
function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('session-shelf.preferences') || '{}');
    const previewLimit = Math.min(8, Math.max(1, Number(saved.previewLimit) || defaultPreferences.previewLimit));
    return { includeArchived: saved.includeArchived !== false, previewLimit };
  } catch { return defaultPreferences; }
}
function loadFilters() {
  try { return { ...defaultFilters, ...JSON.parse(localStorage.getItem('session-shelf.filters') || '{}') }; } catch { return defaultFilters; }
}
function loadSavedViews() {
  try { const saved = JSON.parse(localStorage.getItem('session-shelf.saved-views') || '[]'); return Array.isArray(saved) ? saved.filter(view => view && view.id && view.name && view.filters) : []; } catch { return []; }
}
function loadStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function FilterControls({ filters, setFilters, agents, compact = false }) {
  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  return <div className={'filter-controls ' + (compact ? 'compact' : '')}><label className="filter-field"><span>Minimum size (GiB)</span><input type="number" min="0" step="0.1" value={filters.minGiB} onChange={event => update('minGiB', event.target.value)} placeholder="Any size" /></label><label className="filter-field"><span>Minimum files</span><input type="number" min="1" step="1" value={filters.minFiles} onChange={event => update('minFiles', event.target.value)} placeholder="Any count" /></label><label className="filter-field"><span>Agent</span><select value={filters.agent} onChange={event => update('agent', event.target.value)}><option value="all">All agents</option><option value="root">Root / unnamed</option>{agents.map(agent => <option key={agent} value={agent}>{agent}</option>)}</select></label><label className="filter-check"><input type="checkbox" checked={filters.forkedOnly} onChange={event => update('forkedOnly', event.target.checked)} /><span>Forked sessions only</span></label><button className="button" onClick={() => setFilters(defaultFilters)}>Clear filters</button></div>;
}

function WindowChrome() {
  const desktop = hasDesktopWindow();
  const [maximised, setMaximised] = useState(false);
  useEffect(() => {
    if (!desktop) return undefined;
    let active = true;
    const unsubscribe = subscribeWindowState(value => { if (active) setMaximised(value); });
    isWindowMaximised().then(value => { if (active) setMaximised(value); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [desktop]);
  async function toggleMaximise() { try { await toggleMaximiseWindow(); setMaximised(await isWindowMaximised()); } catch {} }
  return <div className="window-chrome" role="toolbar" aria-label="Window controls"><div className="window-drag-region" onDoubleClick={desktop ? toggleMaximise : undefined}><img className="window-app-icon" src="/favicon.svg" alt="" /><strong>Session Shelf</strong></div>{desktop && <div className="window-controls"><button className="window-control" type="button" onClick={() => minimiseWindow().catch(() => {})} aria-label="Minimize" title="Minimize"><Icon name="minimize" size={15} /></button><button className="window-control" type="button" onClick={toggleMaximise} aria-label={maximised ? 'Restore' : 'Maximize'} title={maximised ? 'Restore' : 'Maximize'}><Icon name={maximised ? 'restore' : 'maximize'} size={14} /></button><button className="window-control close" type="button" onClick={() => closeWindow().catch(() => {})} aria-label="Close" title="Close"><Icon name="x" size={15} /></button></div>}</div>;
}
function Sidebar({ view, setView, onScan, queueCount }) {
  const primary = [['overview', 'Overview', 'home'], ['roots', 'Active sessions', 'branch'], ['archived', 'Archived sessions', 'archive'], ['all', 'All files', 'file'], ['catalog', 'Catalog DB', 'database']];
  const settings = [['locations', 'Storage locations', 'folder'], ['filters', 'Filters', 'filter'], ['preferences', 'Preferences', 'settings'], ['diagnostics', 'Diagnostics', 'info']];
  return <aside className="sidebar"><div className="side-scroll"><nav className="side-nav">{primary.map(([id, label, icon]) => <button key={id} className={'nav-item ' + (view === id ? 'active' : '')} onClick={() => setView(id)}><Icon name={icon} /><span>{label}</span></button>)}</nav><div className="nav-heading">Actions</div><nav className="side-nav"><button className="nav-item" onClick={onScan}><Icon name="refresh" /><span>Scan sessions</span></button><button className={'nav-item ' + (view === 'queue' ? 'active' : '')} onClick={() => setView('queue')}><Icon name="archive" /><span>Review queue</span>{queueCount > 0 && <span className="nav-count">{queueCount}</span>}</button><button className={'nav-item ' + (view === 'recycle' ? 'active' : '')} onClick={() => setView('recycle')}><Icon name="trash" /><span>Recycle Bin</span></button></nav><div className="nav-heading">Settings</div><nav className="side-nav">{settings.map(([id, label, icon]) => <button key={id} className={'nav-item ' + (view === id ? 'active' : '')} onClick={() => setView(id)}><Icon name={icon} /><span>{label}</span></button>)}</nav></div></aside>;
}
function Header({ data, onScan, onCancel, scanning, scanStatus, view }) {
  const labels = { overview: 'Overview', roots: 'Active sessions', archived: 'Archived sessions', all: 'All files', catalog: 'Catalog DB', queue: 'Review queue', recycle: 'Recycle Bin', locations: 'Storage locations', filters: 'Filters', preferences: 'Preferences', diagnostics: 'Diagnostics' };
  const icon = view === 'roots' ? 'folder' : view === 'all' ? 'file' : view === 'catalog' ? 'database' : view === 'recycle' ? 'trash' : view === 'locations' ? 'folder' : view === 'filters' ? 'filter' : view === 'preferences' ? 'settings' : view === 'diagnostics' ? 'info' : 'archive';
  return <header className="topbar"><div className="topbar-title"><Icon name={icon} size={23} /><span>{labels[view] || 'Session Shelf'}</span></div><div className="topbar-stats"><div className="stat-emphasis"><Icon name="database" size={22} /><strong>{data ? formatGiB(data.stats.totalBytes) : '—'}</strong></div><span>{data ? data.stats.fileCount + ' files' : 'Scanning'}</span></div><div className="topbar-actions"><Button icon="refresh" onClick={onScan} disabled={scanning}>{scanning ? 'Scanning...' : 'Scan sessions'}</Button>{scanning && scanStatus?.cancelable && <Button icon="x" onClick={onCancel}>Cancel scan</Button>}<span className={'scan-state ' + (scanning ? 'scanning' : '')}><Icon name={scanning ? 'refresh' : 'check'} size={16} />{scanning ? (scanStatus?.phase || 'Reading JSONL metadata') + (scanStatus?.filesTotal ? ' · ' + scanStatus.filesCompleted + '/' + scanStatus.filesTotal : '') : data ? 'Scanned ' + formatDate(data.scannedAt) : 'Waiting'}</span><Icon name="settings" size={20} /></div></header>;
}
function SearchTools({ query, setQuery, sort, setSort, filters, setFilters, agents }) {
  const sortKey = typeof sort === 'string' ? sort === 'name' ? 'title' : sort === 'recent' ? 'lastActivity' : sort === 'files' ? 'fileCount' : 'sizeBytes' : sort.key;
  const [filtersOpen, setFiltersOpen] = useState(false);
  return <div className="tools-row"><label className="search-box"><Icon name="search" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sessions..." /><kbd>Ctrl K</kbd></label><div className="filter-wrap"><button className="icon-button" title="Filters" aria-label="Filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}><Icon name="filter" size={18} /></button>{filtersOpen && <div className="filter-popover"><FilterControls filters={filters} setFilters={setFilters} agents={agents} compact /></div>}</div><label className="sort-select"><span>Sort by</span><select value={sortKey} onChange={event => setSort({ key: event.target.value, direction: event.target.value === 'title' ? 'asc' : 'desc' })}><option value="sizeBytes">reclaimable size</option><option value="lastActivity">last activity</option><option value="fileCount">file count</option><option value="title">name</option></select><Icon name="chevron" size={15} /></label></div>;
}
function fileForAgent(files, agent) {
  const target = String(agent || '').trim().toLowerCase();
  return files.find(file => String(file.agent || '').trim().toLowerCase() === target);
}
function AgentBadge({ agent, onPreview }) {
  const name = String(agent || '').trim();
  const isRoot = !name || ['root', 'main'].includes(name.toLowerCase());
  const label = isRoot ? 'Root' : name;
  const content = <><i /><span>{label}</span></>;
  return onPreview ? <button type="button" className={'agent-badge ' + (isRoot ? 'root' : '')} onClick={event => { event.stopPropagation(); onPreview(); }} title={'Preview ' + label + ' transcript'} aria-label={'Preview ' + label + ' transcript'}>{content}</button> : <span className={'agent-badge ' + (isRoot ? 'root' : '')} title={isRoot ? 'Main/root transcript' : name}>{content}</span>;
}
function RootRow({ group, selected, selectedPaths, onSelect }) {
  const checked = group.files.length > 0 && group.files.every(file => selectedPaths.has(file.path));
  return <button className={'root-row ' + (selected ? 'selected' : '')} onClick={onSelect}><span className="root-row-check" onClick={event => event.stopPropagation()}><input type="checkbox" checked={checked} onChange={() => onSelect('toggle')} aria-label={'Select all files in ' + group.title} /></span><span className="root-icon"><Icon name="branch" size={19} /></span><span className="root-copy"><strong>{group.title}</strong><small>{shortId(group.rootId)}</small></span><span className="root-files">{group.fileCount}</span><span className="root-size">{formatGiB(group.sizeBytes)}</span><span className="root-date">{formatDate(group.lastActivity)}</span></button>;
}
function RootList({ groups, selectedGroup, selectedPaths, setSelectedGroup, toggleGroup, query, setQuery, sort, setSort, archived, filters, setFilters, agents }) {
  const currentSort = typeof sort === 'string' ? { key: sort === 'name' ? 'title' : sort === 'recent' ? 'lastActivity' : sort === 'files' ? 'fileCount' : 'sizeBytes', direction: 'desc' } : sort;
  const toggleSort = key => setSort(current => { const next = typeof current === 'string' ? { key: current === 'name' ? 'title' : current === 'recent' ? 'lastActivity' : current === 'files' ? 'fileCount' : 'sizeBytes', direction: 'desc' } : current; return next.key === key ? { ...next, direction: next.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'title' ? 'asc' : 'desc' }; });
  const sortHeader = (key, label) => <button className="root-sort" aria-label={'Sort by ' + label} aria-sort={currentSort.key === key ? currentSort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} onClick={() => toggleSort(key)}>{label}<span>{currentSort.key === key ? currentSort.direction === 'asc' ? '▲' : '▼' : '↕'}</span></button>;
  return <section className="center-pane"><SearchTools query={query} setQuery={setQuery} sort={sort} setSort={setSort} filters={filters} setFilters={setFilters} agents={agents} /><div className="list-head">{sortHeader('title', archived ? 'Archived session' : 'Active session')}{sortHeader('fileCount', 'Files')}{sortHeader('sizeBytes', 'Reclaimable size')}{sortHeader('lastActivity', 'Last activity')}</div><div className="root-list">{groups.length ? groups.map(group => <RootRow key={group.key || group.rootId} group={group} selected={(selectedGroup?.key || selectedGroup?.rootId) === (group.key || group.rootId)} selectedPaths={selectedPaths} onSelect={mode => mode === 'toggle' ? (setSelectedGroup(group), toggleGroup(group)) : setSelectedGroup(group)} />) : <EmptyState title="No matching sessions" detail="Try a different search or scan the directory again." />}</div><div className="list-footer"><span>{groups.length} visible sessions</span><span>Selected: {selectedPaths.size} files</span></div></section>;
}
function FileTable({ files, selectedPaths, toggleFile, reveal, onPreview }) {
  return <div className="file-table"><div className="file-table-head"><span /><span>Agent</span><span>File name</span><span>Size</span><span>Last modified</span><span /></div>{files.map(file => <div className={'file-row ' + (selectedPaths.has(file.path) ? 'selected' : '')} key={file.path}><input type="checkbox" checked={selectedPaths.has(file.path)} onChange={() => toggleFile(file.path)} aria-label={'Select ' + file.name} /><AgentBadge agent={file.agent} onPreview={onPreview ? () => onPreview(file.path) : undefined} /><button className="file-name" onClick={() => reveal(file.path)} title={file.path}><Icon name="file" size={15} /><span>{file.name}</span></button><span>{formatBytes(file.sizeBytes)}</span><span>{formatDate(file.lastModified)}</span><button className="reveal-button" title="Show in Explorer" onClick={() => reveal(file.path)}><Icon name="folder" size={15} /></button></div>)}</div>;
}
function ContextPreview({ group, context, loading, error, loadContext }) {
  const selectedFile = group.files.find(file => file.path === context?.path);
  const active = Boolean(selectedFile);
  const messages = active ? context.messages || [] : [];
  const agent = String(selectedFile?.agent || '').trim();
  const isRoot = !agent || ['root', 'main'].includes(agent.toLowerCase());
  const title = isRoot ? group.title : agent;
  const subtitle = isRoot ? 'Root transcript' : 'Sub-agent transcript';
  return <section className="context-preview"><div className="context-window-bar"><div className="context-window-ident"><span className="context-window-icon"><Icon name="message" size={15} /></span><div><strong>{title}</strong><span>{subtitle} · {shortId(group.rootId)}</span></div></div><button className="context-action" onClick={() => loadContext(group.rootPath)} disabled={loading}><Icon name="message" size={15} />{loading && active ? 'Reading...' : active ? 'Refresh' : 'Preview messages'}</button></div>{loading && active ? <div className="context-state">Reading the first messages...</div> : error && active ? <div className="context-state context-error">{error}</div> : active && messages.length ? <div className="context-thread">{messages.map((message, index) => <article className={'context-message ' + message.role} key={message.role + '-' + index}><div className="context-message-meta"><span className={'context-avatar ' + message.role}>{message.role === 'user' ? 'Y' : 'C'}</span><strong>{message.role === 'user' ? 'You' : 'Codex'}</strong><span className="context-message-index">{index + 1}/{messages.length}</span></div><div className="context-bubble"><p>{message.text}</p></div></article>)}</div> : active ? <div className="context-state">No user or assistant messages were found in the preview window.</div> : <div className="context-state">Load a small preview before deciding whether this root is worth keeping.</div>}{active && !loading && messages.length > 0 && <div className="context-note">{context.limited ? 'Showing the first ' + messages.length + ' messages; the transcript stays untouched.' : 'Reached the end of this transcript preview.'}</div>}</section>;
}
function TranscriptSearch({ group }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setQuery(''); setResult(null); }, [group?.rootId]);
  async function search() {
    const value = query.trim();
    if (!value) { setResult(null); return; }
    setBusy(true);
    try { setResult(await apiSearchContext(group.rootPath, value, 20)); } catch (error) { setResult({ query: value, matches: [], complete: true, readError: error.message }); } finally { setBusy(false); }
  }
  return <section className="transcript-search"><div className="transcript-search-head"><strong>Search transcript</strong><span>Searches the selected root without editing it.</span></div><div className="transcript-search-form"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') search(); }} placeholder="Search messages..." /><Button onClick={search} disabled={busy || !query.trim()}>{busy ? 'Searching...' : 'Search'}</Button></div>{result && <div className="transcript-search-results">{result.readError ? <p className="context-error">{result.readError}</p> : result.matches.length ? result.matches.map((message, index) => <article className={'context-message ' + message.role} key={message.role + '-' + index}><div className="context-message-meta"><strong>{message.role === 'user' ? 'You' : 'Codex'}</strong><span>{index + 1}/{result.matches.length}</span></div><div className="context-bubble"><p>{message.text}</p></div></article>) : <p className="context-state">No matching messages.</p>}{result.matches.length > 0 && <small>{result.complete ? 'Search reached the end of the transcript.' : 'Showing the first 20 matches.'}</small>}</div>}</section>;
}
function Inspector({ group, selectedPaths, kept, setKept, toggleFile, toggleGroup, review, reveal, previewLimit, onAlias, onArchive, archiveBusy }) {
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const [aliasEditing, setAliasEditing] = useState(false);
  const [aliasDraft, setAliasDraft] = useState('');
  const [aliasError, setAliasError] = useState('');
  const [aliasBusy, setAliasBusy] = useState(false);
  const loadContext = useCallback(async (filePath) => {
    setContext({ path: filePath, messages: [], limited: false });
    setContextError('');
    setContextLoading(true);
    try {
      const result = await apiContext(filePath, previewLimit);
      setContext(result);
    } catch (error) {
      setContextError(error.message);
    } finally {
      setContextLoading(false);
    }
  }, [previewLimit]);
  useEffect(() => { if (group?.rootPath) loadContext(group.rootPath); }, [group?.rootPath, previewLimit, loadContext]);
  useEffect(() => { setAliasDraft(group?.title || ''); setAliasEditing(false); setAliasError(''); }, [group?.rootId, group?.title]);
  async function saveAlias() {
    setAliasBusy(true);
    setAliasError('');
    try { await onAlias(group.rootId, aliasDraft); setAliasEditing(false); } catch (error) { setAliasError(error.message); } finally { setAliasBusy(false); }
  }
  if (!group) return <aside className="inspector empty-inspector"><div className="empty-illustration"><Icon name="branch" size={30} /></div><h2>Choose a conversation root</h2><p>Select a group to see its forked files, lineage, and reclaimable space.</p></aside>;
  const selectedInGroup = group.files.filter(file => selectedPaths.has(file.path)).length;
  return <aside className="inspector"><div className="inspector-top"><div><h1>{group.title}</h1><p className="inspector-size">{formatGiB(group.sizeBytes)} <span>reclaimable</span></p></div><span className="file-count"><strong>{group.fileCount}</strong><small>files</small></span></div><div className="inspector-actions"><Button variant="primary" icon="archive" onClick={review} disabled={!selectedInGroup || kept}>Review {selectedInGroup || group.fileCount} files</Button>{!group.archived && <Button icon="archive" onClick={onArchive} disabled={archiveBusy}>Archive conversation</Button>}</div><div className="detail-block"><div className="detail-row"><span>Root thread</span><strong className="copyable" title={group.rootId}>{shortId(group.rootId)} <Icon name="copy" size={14} /></strong></div><div className="detail-row"><span>Codex title</span><div className="title-value"><strong>{group.title}</strong><button className="title-edit" onClick={() => { setAliasDraft(group.title); setAliasEditing(true); }}>Rename</button></div></div>{aliasEditing && <div className="alias-editor"><input value={aliasDraft} onChange={event => setAliasDraft(event.target.value)} maxLength={120} autoFocus /><div><Button onClick={() => setAliasEditing(false)} disabled={aliasBusy}>Cancel</Button><Button variant="primary" onClick={saveAlias} disabled={aliasBusy}>{aliasBusy ? 'Saving...' : 'Save alias'}</Button></div>{aliasError && <small>{aliasError}</small>}</div>}<div className="detail-row"><span>First request</span><strong className="detail-prompt" title={group.prompt}>{promptPreview(group.prompt) || 'No user prompt found'}</strong></div><div className="detail-row"><span>Forked agents</span><div className="agent-list">{group.agents.length ? group.agents.map(agent => { const target = fileForAgent(group.files, agent); return <button type="button" className="agent-chip" key={agent} onClick={() => target && loadContext(target.path)} disabled={!target} title={'Preview ' + agent + ' transcript'}><i />{agent}</button>; }) : <span className="muted">No named agents</span>}</div></div><div className="detail-row"><span>Last activity</span><strong>{formatDate(group.lastActivity)}</strong></div><div className="detail-row"><span>File count</span><strong>{group.fileCount} JSONL files</strong></div><div className="detail-row"><span>Location</span><strong className="path-text" title={group.cwd}>{group.cwd || 'Unknown'}</strong></div></div><ContextPreview group={group} context={context} loading={contextLoading} error={contextError} loadContext={loadContext} /><TranscriptSearch group={group} /><div className="forked-heading"><h2>Forked files <span>({group.fileCount})</span></h2><label><input type="checkbox" checked={selectedInGroup === group.fileCount} onChange={() => toggleGroup(group)} /> Select all</label></div><FileTable files={group.files} selectedPaths={selectedPaths} toggleFile={toggleFile} reveal={reveal} onPreview={loadContext} /><div className="safe-zone"><div className="review-box"><Icon name={kept ? 'check' : 'unlock'} size={20} /><div><strong>{kept ? 'Conversation kept' : 'Review required'}</strong><span>{kept ? 'This root is excluded from the review queue.' : 'Review the selected files before they can move to the Recycle Bin.'}</span></div></div><label className="keep-toggle"><input type="checkbox" checked={kept} onChange={event => setKept(event.target.checked)} /><span><strong>Keep this conversation</strong><small>Exclude from deletion</small></span></label><Button variant="danger" icon="trash" onClick={review} disabled={!selectedInGroup || kept}>Move selected to Recycle Bin</Button><div className="selection-foot"><span>{selectedInGroup} of {group.fileCount} files selected</span><span>{formatBytes(group.files.filter(file => selectedPaths.has(file.path)).reduce((sum, file) => sum + file.sizeBytes, 0))}</span></div></div></aside>;
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
      const result = await apiCatalog();
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
      const result = await apiRemoveCatalogRows('REMOVE', [pending.thread_id]);
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
function Overview({ data, onExport }) {
  const stats = data?.stats;
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Overview</h1><p>Storage summary for your local Codex session data.</p></div><div className="heading-actions"><span>{data ? formatDate(data.scannedAt) : 'Scanning...'}</span><Button onClick={() => onExport('json')} disabled={!data}>Export JSON</Button><Button onClick={() => onExport('csv')} disabled={!data}>Export CSV</Button></div></div><div className="detail-block"><div className="detail-row"><span>Total storage</span><strong>{stats ? formatGiB(stats.totalBytes) : '—'}</strong></div><div className="detail-row"><span>All session roots</span><strong>{stats?.groupCount ?? '—'}</strong></div><div className="detail-row"><span>JSONL files</span><strong>{stats?.fileCount ?? '—'}</strong></div><div className="detail-row"><span>Current sessions</span><strong>{data?.currentStats ? data.currentStats.groupCount + ' roots / ' + data.currentStats.fileCount + ' files' : '—'}</strong></div><div className="detail-row"><span>Archived sessions</span><strong>{data?.archivedStats ? data.archivedStats.groupCount + ' roots / ' + data.archivedStats.fileCount + ' files' : '—'}</strong></div><div className="detail-row"><span>Sessions directory</span><strong className="path-text">{data?.root || 'Detecting...'}</strong></div><div className="detail-row"><span>Archive directory</span><strong className="path-text">{data?.archivedRoot || 'Detecting...'}</strong></div></div></section>;
}
function RecycleView() {
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Recycle Bin</h1><p>Session Shelf sends selected JSONL files to the operating system trash.</p></div></div><div className="empty-state"><Icon name="trash" size={28} /><h2>Nothing to review here</h2><p>Use Active sessions or Archived sessions to inspect files before moving them. Recovery remains available through the operating system trash.</p></div></section>;
}
function PreferencesView({ preferences, updatePreferences }) {
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Preferences</h1><p>Real settings for scan scope and transcript previews. Changes are saved in this browser.</p></div><span>Saved locally</span></div><div className="settings-card"><label className="setting-row"><span><strong>Scan archived sessions</strong><small>Include the configured archive directory in every scan.</small></span><input type="checkbox" checked={preferences.includeArchived} onChange={event => updatePreferences({ includeArchived: event.target.checked })} /></label><label className="setting-row"><span><strong>Preview message count</strong><small>Number of user/assistant messages loaded when a session opens.</small></span><select value={preferences.previewLimit} onChange={event => updatePreferences({ previewLimit: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6, 7, 8].map(value => <option key={value} value={value}>{value} messages</option>)}</select></label></div><div className="settings-note"><Icon name="info" size={16} /><span>Transcript previews stay read-only and are capped at eight messages.</span></div></section>;
}
function DiagnosticsView() {
  const [diagnostics, setDiagnostics] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { apiDiagnostics().then(setDiagnostics).catch(loadError => setError(loadError.message)); }, []);
  if (!diagnostics) return <section className="center-pane full-pane"><div className="empty-state">{error ? <><Icon name="info" size={28} /><h2>Diagnostics unavailable</h2><p>{error}</p></> : <><Icon name="info" size={28} /><h2>Loading diagnostics...</h2></>}</div></section>;
  const status = value => value ? 'Available' : 'Missing';
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Diagnostics</h1><p>Local runtime and storage checks for support and issue reports.</p></div><span>{diagnostics.platform} / {diagnostics.architecture}</span></div><div className="detail-block"><div className="detail-row"><span>Runtime</span><strong>{diagnostics.desktop ? 'Wails desktop' : 'Browser fallback'}</strong></div><div className="detail-row"><span>Platform</span><strong>{diagnostics.platform} {diagnostics.architecture}</strong></div><div className="detail-row"><span>Go</span><strong>{diagnostics.goVersion || 'Not applicable'}</strong></div><div className="detail-row"><span>System trash</span><strong>{status(diagnostics.trashAvailable)}</strong></div><div className="detail-row"><span>Current sessions</span><strong className="path-text" title={diagnostics.currentRoot}>{status(diagnostics.currentRootExists)} · {diagnostics.currentRoot}</strong></div><div className="detail-row"><span>Archived sessions</span><strong className="path-text" title={diagnostics.archivedRoot}>{status(diagnostics.archivedRootExists)} · {diagnostics.archivedRoot}</strong></div><div className="detail-row"><span>Catalog DB</span><strong className="path-text" title={diagnostics.catalogDb}>{status(diagnostics.catalogDbExists)} · {diagnostics.catalogDb}</strong></div><div className="detail-row"><span>Metadata index</span><strong>{diagnostics.indexEntries} entries</strong></div><div className="detail-row"><span>Last scan</span><strong>{diagnostics.scan.phase || 'Not started'}{diagnostics.scan.filesTotal ? ' · ' + diagnostics.scan.filesCompleted + '/' + diagnostics.scan.filesTotal : ''}</strong></div></div><div className="settings-note"><Icon name="info" size={16} /><span>Paths are shown here intentionally for diagnostics; they are not displayed in the global status bar.</span></div></section>;
}
function FiltersView({ filters, setFilters, agents }) {
  const activeCount = [filters.minGiB, filters.minFiles, filters.agent !== 'all' ? filters.agent : '', filters.forkedOnly ? 'forked' : ''].filter(Boolean).length;
  const [savedViews, setSavedViews] = useState(loadSavedViews);
  const [viewName, setViewName] = useState('');
  function saveView() {
    const name = viewName.trim();
    if (!name) return;
    const next = [...savedViews.filter(view => view.name.toLowerCase() !== name.toLowerCase()), { id: Date.now().toString(36), name, filters }];
    setSavedViews(next);
    localStorage.setItem('session-shelf.saved-views', JSON.stringify(next));
    setViewName('');
  }
  function deleteView(id) {
    const next = savedViews.filter(view => view.id !== id);
    setSavedViews(next);
    localStorage.setItem('session-shelf.saved-views', JSON.stringify(next));
  }
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Filters</h1><p>These filters apply to both Active sessions and Archived sessions.</p></div><span>{activeCount ? activeCount + ' active' : 'No filters'}</span></div><div className="settings-card"><FilterControls filters={filters} setFilters={setFilters} agents={agents} /></div><div className="settings-card saved-view-card"><div><strong>Saved filter views</strong><small>Save named filter presets locally for repeat cleanup reviews.</small></div><div className="saved-view-create"><input value={viewName} onChange={event => setViewName(event.target.value)} placeholder="View name" onKeyDown={event => { if (event.key === 'Enter') saveView(); }} /><Button onClick={saveView} disabled={!viewName.trim()}>Save view</Button></div>{savedViews.length ? <div className="saved-view-list">{savedViews.map(view => <div className="saved-view-row" key={view.id}><button onClick={() => setFilters({ ...defaultFilters, ...view.filters })}>{view.name}</button><button onClick={() => deleteView(view.id)} aria-label={'Delete saved view ' + view.name}><Icon name="x" size={14} /></button></div>)}</div> : <small className="muted">No saved views.</small>}</div><div className="settings-note"><Icon name="filter" size={16} /><span>Search text and filters combine; sorting still comes from the table headers or the sort menu.</span></div></section>;
}
function StorageLocationsView({ onSaved }) {
  const [settings, setSettings] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [form, setForm] = useState({ currentRoot: '', archivedRoot: '', catalogDb: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { apiSettings().then(result => { setSettings(result); setDefaults(result.defaults); setForm({ currentRoot: result.currentRoot, archivedRoot: result.archivedRoot, catalogDb: result.catalogDb }); }).catch(loadError => setError(loadError.message)); }, []);
  function update(key, value) { setForm(current => ({ ...current, [key]: value })); setNotice(''); }
  async function pick(kind, key) { try { const selected = await apiPickStorage(kind, form[key]); if (selected) update(key, selected); } catch (pickError) { setError(pickError.message); } }
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiSaveSettings(form);
      setSettings(result); setForm({ currentRoot: result.currentRoot, archivedRoot: result.archivedRoot, catalogDb: result.catalogDb });
      await onSaved();
      setNotice('Saved locations and rescanned sessions.');
    } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  }
  if (!settings) return <section className="center-pane full-pane"><div className="empty-state">{error ? <><Icon name="info" size={28} /><h2>Storage settings unavailable</h2><p>{error}</p></> : <><Icon name="folder" size={28} /><h2>Loading storage settings...</h2></>}</div></section>;
  return <section className="center-pane full-pane"><div className="all-files-heading"><div><h1>Storage locations</h1><p>These absolute paths control what the server scans and which Catalog DB it reads.</p></div><span>Config: {settings.settingsPath}</span></div>{error && <div className="error-banner">{error}</div>}{notice && <div className="settings-success"><Icon name="check" size={16} />{notice}</div>}<div className="settings-card location-card"><label className="settings-field"><span>Current sessions directory</span><div className="path-input"><input className="settings-input" value={form.currentRoot} onChange={event => update('currentRoot', event.target.value)} spellCheck="false" /><button className="path-browse" onClick={() => pick('current', 'currentRoot')} disabled={busy}>Browse</button></div></label><label className="settings-field"><span>Archived sessions directory</span><div className="path-input"><input className="settings-input" value={form.archivedRoot} onChange={event => update('archivedRoot', event.target.value)} spellCheck="false" /><button className="path-browse" onClick={() => pick('archived', 'archivedRoot')} disabled={busy}>Browse</button></div></label><label className="settings-field"><span>Catalog DB path</span><div className="path-input"><input className="settings-input" value={form.catalogDb} onChange={event => update('catalogDb', event.target.value)} spellCheck="false" /><button className="path-browse" onClick={() => pick('catalog', 'catalogDb')} disabled={busy}>Browse</button></div></label><div className="settings-actions"><Button onClick={() => setForm({ currentRoot: defaults.currentRoot, archivedRoot: defaults.archivedRoot, catalogDb: defaults.catalogDb })} disabled={busy}>Reset defaults</Button><Button variant="primary" icon="check" onClick={save} disabled={busy}>{busy ? 'Saving and scanning...' : 'Save & rescan'}</Button></div></div></section>;
}
function EmptyState({ title, detail }) {
  return <div className="empty-state"><Icon name="archive" size={28} /><h2>{title}</h2><p>{detail}</p></div>;
}
function ReviewModal({ files, safety, onClose, onConfirm, busy, reviewBusy, removeCatalogRows, onCleanupChange, archive = false }) {
  archive = archive || Boolean(safety?.archivedRoot);
  const [value, setValue] = useState('');
  const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const blocked = !reviewBusy && safety && !safety.safe;
  const firstError = safety?.files?.find(file => !file.ok)?.error || safety?.catalog?.error;
  const confirmation = archive ? 'ARCHIVE' : 'MOVE';
  return <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={onClose}><Icon name="x" /></button><div className={'modal-icon ' + (archive ? 'archive-modal-icon' : '')}><Icon name={archive ? 'archive' : 'trash'} size={24} /></div><h2>{archive ? 'Archive conversation files?' : 'Move files to system trash?'}</h2><p>{archive ? `${files.length} selected JSONL files will move into the configured archive directory. Catalog DB entries stay intact because the transcripts remain available.` : `${files.length} selected JSONL files will be moved reversibly after a fresh safety check.`}</p><div className="modal-summary"><strong>{formatBytes(total)}</strong><span>{files.length} files</span></div><div className={'safety-check ' + (reviewBusy ? 'checking' : blocked ? 'blocked' : 'ready')}><Icon name={reviewBusy ? 'refresh' : blocked ? 'info' : 'check'} size={16} /><div><strong>{reviewBusy ? 'Checking file state...' : blocked ? (archive ? 'Archive blocked' : 'Move blocked') : 'Preflight passed'}</strong><span>{reviewBusy ? 'Verifying the files have not changed since the scan.' : blocked ? firstError : archive ? 'The active files are unchanged, inside the configured sessions directory, and have no archive destination collision.' : 'The selected paths are inside the configured roots and match the latest scan.'}</span></div></div><div className="modal-file-list">{files.slice(0, 12).map(file => <div key={file.path}><span>{file.name}</span><span>{formatBytes(file.sizeBytes)}</span></div>)}{files.length > 12 && <div><span>+ {files.length - 12} more files</span><span /></div>}</div>{!archive && <label className="keep-toggle catalog-cleanup-toggle"><input type="checkbox" checked={removeCatalogRows} onChange={event => onCleanupChange(event.target.checked)} disabled={busy || reviewBusy} /><span><strong>Remove matching Catalog DB entries</strong><small>A SQLite backup is created before any matching rows are removed.</small></span></label>}{!archive && safety?.catalog?.backupRequired && <div className="backup-note"><Icon name="database" size={14} />Catalog cleanup is armed; a backup will be created before the move.</div>}<label className="confirm-input"><span>Type {confirmation} to confirm</span><input value={value} onChange={event => setValue(event.target.value)} autoFocus /></label><div className="modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant={archive ? 'primary' : 'danger'} icon={archive ? 'archive' : 'trash'} onClick={onConfirm} disabled={value !== confirmation || busy || reviewBusy || blocked}>{busy ? (archive ? 'Archiving...' : 'Moving...') : (archive ? 'Archive selected' : 'Move selected')}</Button></div></div></div>;
}
function App() {
  const [data, setData] = useState(null);
  const [view, setViewState] = useState(() => localStorage.getItem('session-shelf.view') || 'roots');
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [error, setError] = useState('');
  const [selectedRootKey, setSelectedRootKey] = useState('');
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  const [keptRoots, setKeptRoots] = useState(new Set());
  const [reviewFiles, setReviewFiles] = useState(null);
  const [reviewMode, setReviewMode] = useState('recycle');
  const [recycleReview, setRecycleReview] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [removeCatalogRows, setRemoveCatalogRows] = useState(false);
  const [moving, setMoving] = useState(false);
  const [toast, setToast] = useState('');
  const [rootQuery, setRootQuery] = useState(() => localStorage.getItem('session-shelf.root-query') || '');
  const [rootSort, setRootSort] = useState(() => loadStored('session-shelf.root-sort', { key: 'sizeBytes', direction: 'desc' }));
  const [allQuery, setAllQuery] = useState(() => localStorage.getItem('session-shelf.all-query') || '');
  const [preferences, setPreferences] = useState(loadPreferences);
  const [filters, setFilters] = useState(loadFilters);
  const setView = useCallback(nextView => { setViewState(nextView); localStorage.setItem('session-shelf.view', nextView); }, []);
  const updatePreferences = useCallback(patch => { setPreferences(current => { const next = { ...current, ...patch }; localStorage.setItem('session-shelf.preferences', JSON.stringify(next)); return next; }); }, []);
  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const result = await apiScan(preferences.includeArchived);
      setData(result);
      setError('');
    } catch (scanError) {
      setError(scanError.message);
    } finally {
      setScanning(false);
    }
  }, [preferences.includeArchived]);
  useEffect(() => { scan(); }, [scan]);
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { localStorage.setItem('session-shelf.filters', JSON.stringify(filters)); }, [filters]);
  useEffect(() => { localStorage.setItem('session-shelf.root-query', rootQuery); }, [rootQuery]);
  useEffect(() => { localStorage.setItem('session-shelf.root-sort', JSON.stringify(rootSort)); }, [rootSort]);
  useEffect(() => { localStorage.setItem('session-shelf.all-query', allQuery); }, [allQuery]);
  useEffect(() => {
    if (!scanning) return undefined;
    let active = true;
    const poll = () => { apiScanStatus().then(status => { if (active) setScanStatus(status); }).catch(() => {}); };
    poll();
    const timer = setInterval(poll, 400);
    return () => { active = false; clearInterval(timer); };
  }, [scanning]);
  useEffect(() => {
    const onKeyDown = event => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector('input[placeholder="Search sessions..."]')?.focus();
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setView('filters');
      } else if (event.key === 'Escape' && reviewFiles) {
        setReviewFiles(null);
        setReviewMode('recycle');
        setRecycleReview(null);
        setRemoveCatalogRows(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reviewFiles, setView]);
  const activeArchived = view === 'archived';
  const activeGroups = activeArchived ? (data?.archivedGroups || []) : (data?.groups || []);
  const availableAgents = useMemo(() => [...new Set([...(data?.groups || []), ...(data?.archivedGroups || [])].flatMap(group => group.agents || []))].sort((left, right) => left.localeCompare(right)), [data]);
  const selectedGroup = activeGroups.find(group => (group.key || group.rootId) === selectedRootKey) || activeGroups[0];
  const selectedFiles = useMemo(() => data?.files.filter(file => selectedPaths.has(file.path)) || [], [data, selectedPaths]);
  const visibleGroups = useMemo(() => {
    const lower = rootQuery.toLowerCase();
    const minimumBytes = Math.max(0, Number(filters.minGiB) || 0) * 1024 ** 3;
    const minimumFiles = Math.max(0, Number(filters.minFiles) || 0);
    const filtered = activeGroups.filter(group => (group.title + ' ' + group.prompt + ' ' + group.cwd + ' ' + group.rootId).toLowerCase().includes(lower) && group.sizeBytes >= minimumBytes && group.fileCount >= minimumFiles && (filters.agent === 'all' || (filters.agent === 'root' ? !group.agents.length : group.agents.includes(filters.agent))) && (!filters.forkedOnly || group.fileCount > 1));
    const sortKey = typeof rootSort === 'string' ? rootSort === 'name' ? 'title' : rootSort === 'recent' ? 'lastActivity' : rootSort === 'files' ? 'fileCount' : 'sizeBytes' : rootSort.key;
    const direction = (typeof rootSort === 'string' ? 'desc' : rootSort.direction) === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => { const result = sortKey === 'title' ? a.title.localeCompare(b.title) : sortKey === 'fileCount' ? a.fileCount - b.fileCount : sortKey === 'lastActivity' ? new Date(a.lastActivity) - new Date(b.lastActivity) : a.sizeBytes - b.sizeBytes; return result * direction; });
  }, [activeGroups, rootQuery, rootSort, filters]);
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
    try { await apiReveal(filePath); } catch {}
  }
  async function cancelScan() {
    try { await apiCancelScan(); } catch (cancelError) { setError(cancelError.message); }
  }
  async function saveAlias(rootId, title) {
    const result = await apiSaveTitleAlias(rootId, title);
    if (!result.title) {
      await scan();
      return;
    }
    const applyAlias = group => group.rootId === rootId ? { ...group, title: result.title, titleSource: result.title ? 'Manual alias' : group.titleSource, files: group.files.map(file => ({ ...file, groupTitle: result.title || file.groupTitle })) } : group;
    setData(current => current ? { ...current, groups: (current.groups || []).map(applyAlias), archivedGroups: (current.archivedGroups || []).map(applyAlias), roots: (current.roots || []).map(root => ({ ...root, groups: (root.groups || []).map(applyAlias), files: (root.files || []).map(file => file.rootId === rootId ? { ...file, groupTitle: result.title || file.groupTitle } : file) })), files: (current.files || []).map(file => file.rootId === rootId ? { ...file, groupTitle: result.title || file.groupTitle } : file) } : current);
  }
  async function prepareReview(files, cleanup) {
    setReviewFiles(files);
    setReviewMode('recycle');
    setRemoveCatalogRows(cleanup);
    setRecycleReview(null);
    setReviewBusy(true);
    try {
      setRecycleReview(await apiReviewRecycle(files.map(file => file.path), cleanup));
    } catch (reviewError) {
      setReviewFiles(null);
      setError(reviewError.message);
    } finally {
      setReviewBusy(false);
    }
  }
  async function prepareArchive(files) {
    setReviewFiles(files);
    setReviewMode('archive');
    setRemoveCatalogRows(false);
    setRecycleReview({ safe: true, archivedRoot: true, files: [] });
    setReviewBusy(true);
    try {
      setRecycleReview(await apiReviewArchive(files.map(file => file.path)));
    } catch (reviewError) {
      setReviewFiles(null);
      setError(reviewError.message);
    } finally {
      setReviewBusy(false);
    }
  }
  function review() {
    const files = view === 'queue' ? selectedFiles : selectedGroup?.files.filter(file => selectedPaths.has(file.path)) || [];
    if (files.length) prepareReview(files, false);
  }
  function archiveConversation() {
    if (activeArchived || !selectedGroup?.files.length) return;
    prepareArchive(selectedGroup.files);
  }
  async function changeCleanup(value) {
    setRemoveCatalogRows(value);
    if (!reviewFiles?.length) return;
    setReviewBusy(true);
    try {
      setRecycleReview(await apiReviewRecycle(reviewFiles.map(file => file.path), value));
    } catch (reviewError) {
      setError(reviewError.message);
    } finally {
      setReviewBusy(false);
    }
  }
  async function moveSelected() {
    if (!reviewFiles?.length || !recycleReview?.safe) return;
    setMoving(true);
    try {
      const archive = reviewMode === 'archive';
      const result = archive ? await apiArchive(reviewFiles.map(file => file.path)) : await apiRecycle(reviewFiles.map(file => file.path), removeCatalogRows);
      setSelectedPaths(current => new Set([...current].filter(filePath => !reviewFiles.some(file => file.path === filePath))));
      setReviewFiles(null);
      setReviewMode('recycle');
      setRecycleReview(null);
      if (archive) {
        const moved = result.result?.filter(item => item.ok).length || 0;
        const failed = result.result?.length - moved || 0;
        setToast(failed ? 'Archived ' + moved + ' files; ' + failed + ' could not be moved.' : 'Archived ' + moved + ' conversation files.');
      } else setToast(result.catalog?.error ? 'Files moved; Catalog DB cleanup failed: ' + result.catalog.error : 'Moved ' + reviewFiles.length + ' files to system trash' + (result.catalog?.removed ? ' and removed ' + result.catalog.removed + ' Catalog DB entries.' : '') + (result.catalog?.backupPath ? ' Catalog DB backup created.' : '.'));
      await scan();
    } catch (moveError) {
      setError(moveError.message);
    } finally {
      setMoving(false);
    }
  }
  async function exportData(format) {
    if (!data) return;
    const contents = format === 'json' ? JSON.stringify({ exportedAt: new Date().toISOString(), stats: data.stats, groups: data.groups, archivedGroups: data.archivedGroups, files: data.files }, null, 2) : [['storage', 'archived', 'rootId', 'groupTitle', 'agent', 'name', 'sizeBytes', 'lastModified', 'path'].map(csvCell).join(','), ...data.files.map(file => [file.storage, file.archived, file.rootId, file.groupTitle, file.agent || 'Root', file.name, file.sizeBytes, file.lastModified, file.path].map(csvCell).join(','))].join('\n');
    try { const destination = await apiExport(format, contents, 'session-shelf-export.' + format); if (destination) setToast('Exported ' + destination.split(/[\\/]/).pop()); } catch (exportError) { setError(exportError.message); }
  }
  const rootView = <><RootList groups={visibleGroups} selectedGroup={selectedGroup} selectedPaths={selectedPaths} setSelectedGroup={group => setSelectedRootKey(group.key || group.rootId)} toggleGroup={toggleGroup} query={rootQuery} setQuery={setRootQuery} sort={rootSort} setSort={setRootSort} archived={activeArchived} filters={filters} setFilters={setFilters} agents={availableAgents} /><Inspector group={selectedGroup} selectedPaths={selectedPaths} kept={selectedGroup ? keptRoots.has(selectedGroup.key || selectedGroup.rootId) : false} setKept={setKept} toggleFile={toggleFile} toggleGroup={toggleGroup} review={review} reveal={reveal} previewLimit={preferences.previewLimit} onAlias={saveAlias} onArchive={archiveConversation} archiveBusy={moving} /></>;
  let content = rootView;
  if (view === 'overview') content = <Overview data={data} onExport={exportData} />;
  if (view === 'all') content = <AllFilesView files={data?.files || []} selectedPaths={selectedPaths} toggleFile={toggleFile} reveal={reveal} query={allQuery} setQuery={setAllQuery} />;
  if (view === 'catalog') content = <CatalogView />;
  if (view === 'queue') content = <QueueView files={data?.files || []} selectedPaths={selectedPaths} toggleFile={toggleFile} reveal={reveal} onReview={review} />;
  if (view === 'recycle') content = <RecycleView />;
  if (view === 'locations') content = <StorageLocationsView onSaved={scan} />;
  if (view === 'filters') content = <FiltersView filters={filters} setFilters={setFilters} agents={availableAgents} />;
  if (view === 'preferences') content = <PreferencesView preferences={preferences} updatePreferences={updatePreferences} />;
  if (view === 'diagnostics') content = <DiagnosticsView />;
  const browsingRoots = view === 'roots' || view === 'archived';
  return <div className="app-shell"><WindowChrome /><div className="app-body"><Sidebar view={view} setView={setView} onScan={scan} queueCount={selectedPaths.size} /><div className="main-shell"><Header data={data} onScan={scan} onCancel={cancelScan} scanning={scanning} scanStatus={scanStatus} view={view} />{error && <div className="error-banner"><Icon name="info" /><span>{error}</span><button onClick={() => setError('')}><Icon name="x" /></button></div>}<main className={'workspace ' + (browsingRoots ? '' : 'single')}>{content}</main><footer className="statusbar"><span><span className="status-dot" />Local only</span><span>{data ? data.stats.groupCount + ' sessions / ' + data.stats.fileCount + ' JSONL files' : 'Preparing scan'}</span></footer></div></div>{reviewFiles && <ReviewModal files={reviewFiles} safety={recycleReview} onClose={() => { setReviewFiles(null); setRecycleReview(null); setRemoveCatalogRows(false); }} onConfirm={moveSelected} busy={moving} reviewBusy={reviewBusy} removeCatalogRows={removeCatalogRows} onCleanupChange={changeCleanup} />}{toast && <div className="toast"><Icon name="check" size={16} />{toast}</div>}</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
