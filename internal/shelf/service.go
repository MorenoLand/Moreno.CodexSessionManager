package shelf

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var (
	uuidPattern = regexp.MustCompile(`(?i)([0-9a-f-]{36})`)
	tagPattern  = regexp.MustCompile(`(?is)<(recommended_plugins|environment_context|app-context)>.*?</(recommended_plugins|environment_context|app-context)>`)
)

type StorageLocations struct {
	CurrentRoot  string `json:"currentRoot"`
	ArchivedRoot string `json:"archivedRoot"`
	CatalogDB    string `json:"catalogDb"`
}

type StorageSettings struct {
	StorageLocations
	SettingsPath string           `json:"settingsPath"`
	Defaults     StorageLocations `json:"defaults"`
}

type StorageSettingsUpdate struct {
	CurrentRoot  string `json:"currentRoot"`
	ArchivedRoot string `json:"archivedRoot"`
	CatalogDB    string `json:"catalogDb"`
}

type Stats struct {
	FileCount  int     `json:"fileCount"`
	TotalBytes int64   `json:"totalBytes"`
	TotalGiB   float64 `json:"totalGiB"`
	GroupCount int     `json:"groupCount"`
}

type SessionFile struct {
	ID               string  `json:"id"`
	Parent           string  `json:"parent"`
	RootID           string  `json:"rootId"`
	CWD              string  `json:"cwd"`
	Agent            string  `json:"agent"`
	Prompt           string  `json:"prompt"`
	SessionTimestamp string  `json:"sessionTimestamp"`
	LastModified     string  `json:"lastModified"`
	SizeBytes        int64   `json:"sizeBytes"`
	SizeGiB          float64 `json:"sizeGiB"`
	Path             string  `json:"path"`
	Name             string  `json:"name"`
	ReadError        string  `json:"readError"`
	Storage          string  `json:"storage"`
	Archived         bool    `json:"archived"`
	GroupTitle       string  `json:"groupTitle"`
}

type Group struct {
	Key          string        `json:"key"`
	RootID       string        `json:"rootId"`
	Storage      string        `json:"storage"`
	Archived     bool          `json:"archived"`
	SourceLabel  string        `json:"sourceLabel"`
	Title        string        `json:"title"`
	TitleSource  string        `json:"titleSource"`
	Prompt       string        `json:"prompt"`
	CWD          string        `json:"cwd"`
	SizeBytes    int64         `json:"sizeBytes"`
	FileCount    int           `json:"fileCount"`
	LastActivity string        `json:"lastActivity"`
	Agents       []string      `json:"agents"`
	RootPath     string        `json:"rootPath"`
	Files        []SessionFile `json:"files"`
}

type ScanRoot struct {
	Key      string        `json:"key"`
	Label    string        `json:"label"`
	Path     string        `json:"path"`
	Archived bool          `json:"archived"`
	Exists   bool          `json:"exists"`
	Stats    Stats         `json:"stats"`
	Groups   []Group       `json:"groups"`
	Files    []SessionFile `json:"files"`
}

type ScanResult struct {
	Root           string        `json:"root"`
	ArchivedRoot   string        `json:"archivedRoot"`
	ScannedAt      string        `json:"scannedAt"`
	Stats          Stats         `json:"stats"`
	CurrentStats   Stats         `json:"currentStats"`
	ArchivedStats  Stats         `json:"archivedStats"`
	Roots          []ScanRoot    `json:"roots"`
	Groups         []Group       `json:"groups"`
	ArchivedGroups []Group       `json:"archivedGroups"`
	Files          []SessionFile `json:"files"`
}

type ContextMessage struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type ContextPreview struct {
	Name      string           `json:"name"`
	Path      string           `json:"path"`
	Messages  []ContextMessage `json:"messages"`
	Limited   bool             `json:"limited"`
	ReadError string           `json:"readError"`
}

type CatalogRow struct {
	HostID               string `json:"host_id"`
	ThreadID             string `json:"thread_id"`
	DisplayTitle         string `json:"display_title"`
	SourceCreatedAt      string `json:"source_created_at"`
	SourceUpdatedAt      string `json:"source_updated_at"`
	CWD                  string `json:"cwd"`
	SourceKind           string `json:"source_kind"`
	SourceDetail         string `json:"source_detail"`
	ModelProvider        string `json:"model_provider"`
	GitBranch            string `json:"git_branch"`
	ObservationSequence  int64  `json:"observation_sequence"`
	MissingCandidate     int64  `json:"missing_candidate"`
	ThreadSource         string `json:"thread_source"`
	SourceRecencyAt      string `json:"source_recency_at"`
	PendingObservedTitle string `json:"pending_observed_title"`
	Orphaned             bool   `json:"orphaned"`
}

type CatalogView struct {
	DBPath    string       `json:"dbPath"`
	Available bool         `json:"available"`
	Error     string       `json:"error"`
	Rows      []CatalogRow `json:"rows"`
}

type CatalogMutation struct {
	Removed    int      `json:"removed"`
	IDs        []string `json:"ids"`
	BackupPath string   `json:"backupPath"`
}

type RecycleItem struct {
	Path  string `json:"path"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

type RecycleCheck struct {
	Path                string `json:"path"`
	Name                string `json:"name"`
	ThreadID            string `json:"threadId"`
	OK                  bool   `json:"ok"`
	Error               string `json:"error,omitempty"`
	CurrentSizeBytes    int64  `json:"currentSizeBytes"`
	ScannedSizeBytes    int64  `json:"scannedSizeBytes"`
	CurrentLastModified string `json:"currentLastModified"`
	ScannedLastModified string `json:"scannedLastModified"`
}

type CatalogCheck struct {
	DBPath         string   `json:"dbPath"`
	Available      bool     `json:"available"`
	ThreadIDs      []string `json:"threadIds"`
	Requested      int      `json:"requested"`
	BackupRequired bool     `json:"backupRequired"`
	Error          string   `json:"error,omitempty"`
}

type RecycleReview struct {
	Safe       bool           `json:"safe"`
	TotalBytes int64          `json:"totalBytes"`
	Files      []RecycleCheck `json:"files"`
	Catalog    CatalogCheck   `json:"catalog"`
}

type RecycleResponse struct {
	Result  []RecycleItem `json:"result"`
	Catalog struct {
		Requested  int      `json:"requested"`
		Removed    int      `json:"removed"`
		IDs        []string `json:"ids"`
		BackupPath string   `json:"backupPath"`
		Error      string   `json:"error"`
	} `json:"catalog"`
}

type scanSnapshot struct {
	SizeBytes    int64
	LastModified string
}

type sessionSource struct {
	Key      string
	Label    string
	Path     string
	Archived bool
}

type Service struct {
	mu           sync.RWMutex
	currentRoot  string
	archivedRoot string
	catalogDB    string
	settingsPath string
	defaults     StorageLocations
	scanMu       sync.Mutex
	cancelMu     sync.Mutex
	cancel       context.CancelFunc
	lastScan     map[string]scanSnapshot
}

func NewService() (*Service, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	codexHome := filepath.Join(home, ".codex")
	if value := os.Getenv("CODEX_HOME"); value != "" {
		codexHome = value
	}
	defaultLocations := StorageLocations{
		CurrentRoot:  envOr("SESSION_SHELF_ROOT", filepath.Join(codexHome, "sessions")),
		ArchivedRoot: envOr("SESSION_SHELF_ARCHIVED_ROOT", filepath.Join(codexHome, "archived_sessions")),
		CatalogDB:    envOr("CODEX_CATALOG_DB", filepath.Join(codexHome, "sqlite", "codex-dev.db")),
	}
	for key, value := range map[string]*string{"Current sessions directory": &defaultLocations.CurrentRoot, "Archived sessions directory": &defaultLocations.ArchivedRoot, "Catalog DB path": &defaultLocations.CatalogDB} {
		absolute, err := absolutePath(*value, key)
		if err != nil {
			return nil, err
		}
		*value = absolute
	}
	configDir := filepath.Join(home, ".config", "session-shelf")
	if runtime.GOOS == "windows" {
		configDir = filepath.Join(envOr("APPDATA", filepath.Join(home, "AppData", "Roaming")), "Session Shelf")
	} else if runtime.GOOS == "darwin" {
		configDir = filepath.Join(home, "Library", "Application Support", "Session Shelf")
	} else if value := os.Getenv("XDG_CONFIG_HOME"); value != "" {
		configDir = filepath.Join(value, "session-shelf")
	}
	service := &Service{currentRoot: defaultLocations.CurrentRoot, archivedRoot: defaultLocations.ArchivedRoot, catalogDB: defaultLocations.CatalogDB, settingsPath: filepath.Join(configDir, "settings.json"), defaults: defaultLocations, lastScan: map[string]scanSnapshot{}}
	service.loadStoredSettings()
	return service, nil
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func absolutePath(value, label string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !filepath.IsAbs(value) {
		return "", fmt.Errorf("%s must be an absolute path.", label)
	}
	return filepath.Abs(value)
}

func (s *Service) loadStoredSettings() {
	data, err := os.ReadFile(s.settingsPath)
	if err != nil {
		return
	}
	var stored StorageSettingsUpdate
	if json.Unmarshal(data, &stored) != nil {
		return
	}
	if os.Getenv("SESSION_SHELF_ROOT") == "" {
		if value, err := absolutePath(stored.CurrentRoot, "Current sessions directory"); err == nil && stored.CurrentRoot != "" {
			s.currentRoot = value
		}
	}
	if os.Getenv("SESSION_SHELF_ARCHIVED_ROOT") == "" {
		if value, err := absolutePath(stored.ArchivedRoot, "Archived sessions directory"); err == nil && stored.ArchivedRoot != "" {
			s.archivedRoot = value
		}
	}
	if os.Getenv("CODEX_CATALOG_DB") == "" {
		if value, err := absolutePath(stored.CatalogDB, "Catalog DB path"); err == nil && stored.CatalogDB != "" {
			s.catalogDB = value
		}
	}
}

func (s *Service) locations() StorageLocations {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return StorageLocations{CurrentRoot: s.currentRoot, ArchivedRoot: s.archivedRoot, CatalogDB: s.catalogDB}
}

func (s *Service) GetSettings() StorageSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return StorageSettings{StorageLocations: StorageLocations{CurrentRoot: s.currentRoot, ArchivedRoot: s.archivedRoot, CatalogDB: s.catalogDB}, SettingsPath: s.settingsPath, Defaults: s.defaults}
}

func (s *Service) SaveSettings(update StorageSettingsUpdate) (StorageSettings, error) {
	currentRoot, err := absolutePath(update.CurrentRoot, "Current sessions directory")
	if err != nil {
		return StorageSettings{}, err
	}
	archivedRoot, err := absolutePath(update.ArchivedRoot, "Archived sessions directory")
	if err != nil {
		return StorageSettings{}, err
	}
	catalogDB, err := absolutePath(update.CatalogDB, "Catalog DB path")
	if err != nil {
		return StorageSettings{}, err
	}
	if samePath(currentRoot, archivedRoot) {
		return StorageSettings{}, errors.New("Current and archived session directories must be different.")
	}
	s.mu.Lock()
	previous := StorageLocations{CurrentRoot: s.currentRoot, ArchivedRoot: s.archivedRoot, CatalogDB: s.catalogDB}
	s.currentRoot, s.archivedRoot, s.catalogDB = currentRoot, archivedRoot, catalogDB
	s.mu.Unlock()
	data, _ := json.MarshalIndent(StorageSettingsUpdate{CurrentRoot: currentRoot, ArchivedRoot: archivedRoot, CatalogDB: catalogDB}, "", "  ")
	if err := writeAtomic(s.settingsPath, append(data, '\n')); err != nil {
		s.mu.Lock()
		s.currentRoot, s.archivedRoot, s.catalogDB = previous.CurrentRoot, previous.ArchivedRoot, previous.CatalogDB
		s.mu.Unlock()
		return StorageSettings{}, err
	}
	return s.GetSettings(), nil
}

func writeAtomic(filename string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(filename), ".settings-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, filename)
}

func samePath(left, right string) bool {
	return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
}

func (s *Service) Scan(includeArchived bool) (ScanResult, error) {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	s.cancelMu.Lock()
	s.cancel = cancel
	s.cancelMu.Unlock()
	defer func() {
		cancel()
		s.cancelMu.Lock()
		s.cancel = nil
		s.cancelMu.Unlock()
	}()
	locations := s.locations()
	titles := s.loadCatalogTitles()
	sources := []sessionSource{{Key: "current", Label: "Current sessions", Path: locations.CurrentRoot}, {Key: "archived", Label: "Archived sessions", Path: locations.ArchivedRoot, Archived: true}}
	if !includeArchived {
		sources = sources[:1]
	}
	roots := make([]ScanRoot, len(sources))
	for index, source := range sources {
		root, err := s.scanRoot(ctx, source, titles)
		if err != nil {
			return ScanResult{}, err
		}
		roots[index] = root
	}
	var groups []Group
	var files []SessionFile
	for _, root := range roots {
		groups = append(groups, root.Groups...)
		files = append(files, root.Files...)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].SizeBytes > files[j].SizeBytes })
	totalBytes := int64(0)
	for _, file := range files {
		totalBytes += file.SizeBytes
	}
	var currentStats, archivedStats Stats
	for _, root := range roots {
		if root.Archived {
			archivedStats = root.Stats
		} else {
			currentStats = root.Stats
		}
	}
	result := ScanResult{Root: locations.CurrentRoot, ArchivedRoot: locations.ArchivedRoot, ScannedAt: time.Now().UTC().Format(time.RFC3339Nano), Stats: makeStats(len(files), totalBytes, len(groups)), CurrentStats: currentStats, ArchivedStats: archivedStats, Roots: roots, Files: files}
	for _, root := range roots {
		if root.Archived {
			result.ArchivedGroups = root.Groups
		} else {
			result.Groups = root.Groups
		}
	}
	snapshots := make(map[string]scanSnapshot, len(files))
	for _, file := range files {
		snapshots[pathKey(file.Path)] = scanSnapshot{SizeBytes: file.SizeBytes, LastModified: file.LastModified}
	}
	s.mu.Lock()
	s.lastScan = snapshots
	s.mu.Unlock()
	return result, nil
}

func (s *Service) CancelScan() bool {
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	if s.cancel == nil {
		return false
	}
	s.cancel()
	return true
}

func makeStats(fileCount int, totalBytes int64, groupCount int) Stats {
	return Stats{FileCount: fileCount, TotalBytes: totalBytes, TotalGiB: float64(totalBytes) / (1024 * 1024 * 1024), GroupCount: groupCount}
}

func (s *Service) scanRoot(ctx context.Context, source sessionSource, titles map[string]string) (ScanRoot, error) {
	root := ScanRoot{Key: source.Key, Label: source.Label, Path: source.Path, Archived: source.Archived, Groups: []Group{}, Files: []SessionFile{}}
	if _, err := os.Stat(source.Path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return root, nil
		}
		return root, err
	}
	paths, err := listJSONLFiles(ctx, source.Path)
	if err != nil {
		return root, err
	}
	items, err := readSessionFiles(ctx, paths, source)
	if err != nil {
		return root, err
	}
	byID := resolveRoots(items)
	root.Groups = buildGroups(items, byID, titles, source)
	groupByRoot := make(map[string]string, len(root.Groups))
	for _, group := range root.Groups {
		groupByRoot[group.RootID] = group.Title
	}
	for _, item := range items {
		item.GroupTitle = groupByRoot[item.RootID]
		item.SizeGiB = float64(item.SizeBytes) / (1024 * 1024 * 1024)
		root.Files = append(root.Files, item)
	}
	sort.Slice(root.Files, func(i, j int) bool { return root.Files[i].SizeBytes > root.Files[j].SizeBytes })
	totalBytes := int64(0)
	for _, file := range root.Files {
		totalBytes += file.SizeBytes
	}
	root.Stats = makeStats(len(root.Files), totalBytes, len(root.Groups))
	return root, nil
}

func listJSONLFiles(ctx context.Context, root string) ([]string, error) {
	var paths []string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".jsonl") {
			paths = append(paths, path)
		}
		return nil
	})
	return paths, err
}

func readSessionFiles(ctx context.Context, paths []string, source sessionSource) ([]SessionFile, error) {
	items := make([]SessionFile, len(paths))
	jobs := make(chan int)
	var workers sync.WaitGroup
	worker := func() {
		defer workers.Done()
		for index := range jobs {
			if ctx.Err() != nil {
				return
			}
			item := readSessionFile(paths[index])
			item.Storage, item.Archived = source.Key, source.Archived
			items[index] = item
		}
	}
	workerCount := minInt(8, len(paths))
	workers.Add(workerCount)
	for index := 0; index < workerCount; index++ {
		go worker()
	}
	for index := range paths {
		if ctx.Err() != nil {
			break
		}
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func readSessionFile(filename string) SessionFile {
	info, err := os.Stat(filename)
	item := SessionFile{ID: filepath.Base(filename), RootID: filepath.Base(filename), Path: filename, Name: filepath.Base(filename)}
	if matches := uuidPattern.FindStringSubmatch(strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))); len(matches) > 1 {
		item.ID, item.RootID = matches[1], matches[1]
	}
	if err != nil {
		item.ReadError = err.Error()
		return item
	}
	item.SizeBytes = info.Size()
	item.LastModified = info.ModTime().UTC().Format(time.RFC3339Nano)
	file, err := os.Open(filename)
	if err != nil {
		item.ReadError = err.Error()
		return item
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for lineNumber := 0; lineNumber < 100 && scanner.Scan(); lineNumber++ {
		var record any
		if json.Unmarshal(scanner.Bytes(), &record) != nil {
			continue
		}
		if lineNumber == 0 {
			item.Parent = findString(record, "forked_from_id")
			item.CWD = findString(record, "cwd")
			item.Agent = findString(record, "agent_nickname")
			item.SessionTimestamp = findString(record, "timestamp")
		}
		if item.Prompt == "" {
			item.Prompt = extractPrompt(record)
		}
		if item.Prompt != "" {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		item.ReadError = err.Error()
	}
	return item
}

func findString(value any, key string) string {
	switch typed := value.(type) {
	case map[string]any:
		if candidate, ok := typed[key].(string); ok {
			return candidate
		}
		for _, nested := range typed {
			if found := findString(nested, key); found != "" {
				return found
			}
		}
	case []any:
		for _, nested := range typed {
			if found := findString(nested, key); found != "" {
				return found
			}
		}
	}
	return ""
}

func extractPrompt(record any) string {
	root, ok := record.(map[string]any)
	if !ok {
		return ""
	}
	recordType, _ := root["type"].(string)
	payload, _ := root["payload"].(map[string]any)
	if recordType == "response_item" && payload["role"] == "user" {
		return cleanPrompt(extractText(payload["content"]))
	}
	if recordType == "event_msg" && payload["type"] == "user_message" {
		message, _ := payload["message"].(string)
		return cleanPrompt(message)
	}
	return ""
}

func extractText(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	if blocks, ok := value.([]any); ok {
		var parts []string
		for _, block := range blocks {
			if blockMap, ok := block.(map[string]any); ok {
				for _, key := range []string{"text", "value"} {
					if text, ok := blockMap[key].(string); ok && text != "" {
						parts = append(parts, text)
						break
					}
				}
			} else if text, ok := block.(string); ok {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, " ")
	}
	return ""
}

func cleanPrompt(value string) string {
	text := strings.TrimSpace(tagPattern.ReplaceAllString(value, ""))
	if marker := strings.Index(text, "## My request:"); marker >= 0 {
		text = strings.TrimSpace(text[marker+len("## My request:"):])
	}
	if text == "" || strings.HasPrefix(text, "<") || strings.HasPrefix(text, "# AGENTS.md") {
		return ""
	}
	return strings.Join(strings.Fields(text), " ")
}

func cleanContextText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func resolveRoots(items []SessionFile) map[string]SessionFile {
	byID := make(map[string]SessionFile, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	for index := range items {
		rootID := items[index].ID
		seen := map[string]bool{}
		for {
			parent, ok := byID[rootID]
			if !ok || parent.Parent == "" || seen[rootID] {
				break
			}
			seen[rootID] = true
			rootID = parent.Parent
		}
		items[index].RootID = rootID
		byID[items[index].ID] = items[index]
	}
	return byID
}

func buildGroups(items []SessionFile, byID map[string]SessionFile, titles map[string]string, source sessionSource) []Group {
	groupItems := make(map[string][]SessionFile)
	for _, item := range items {
		groupItems[item.RootID] = append(groupItems[item.RootID], item)
	}
	groups := make([]Group, 0, len(groupItems))
	for rootID, files := range groupItems {
		root, ok := byID[rootID]
		if !ok {
			root = files[0]
			for _, candidate := range files[1:] {
				if candidate.SizeBytes > root.SizeBytes {
					root = candidate
				}
			}
		}
		sort.Slice(files, func(i, j int) bool { return files[i].SizeBytes > files[j].SizeBytes })
		totalBytes := int64(0)
		lastActivity := time.Time{}
		agentSet := map[string]bool{}
		for _, file := range files {
			totalBytes += file.SizeBytes
			if parsed, err := time.Parse(time.RFC3339Nano, file.LastModified); err == nil && parsed.After(lastActivity) {
				lastActivity = parsed
			}
			if file.Agent != "" {
				agentSet[file.Agent] = true
			}
		}
		agents := make([]string, 0, len(agentSet))
		for agent := range agentSet {
			agents = append(agents, agent)
		}
		sort.Strings(agents)
		title, titleSource := titles[rootID], "Codex sidebar"
		if title == "" {
			title, titleSource = makeTitle(root.Prompt, root.CWD), "Derived from first request"
		}
		group := Group{Key: source.Key + ":" + rootID, RootID: rootID, Storage: source.Key, Archived: source.Archived, SourceLabel: source.Label, Title: title, TitleSource: titleSource, Prompt: root.Prompt, CWD: root.CWD, SizeBytes: totalBytes, FileCount: len(files), LastActivity: lastActivity.UTC().Format(time.RFC3339Nano), Agents: agents, RootPath: root.Path, Files: files}
		for index := range group.Files {
			group.Files[index].SizeGiB = float64(group.Files[index].SizeBytes) / (1024 * 1024 * 1024)
			group.Files[index].GroupTitle = title
		}
		groups = append(groups, group)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].SizeBytes > groups[j].SizeBytes })
	return groups
}

func pathSegment(value string) string {
	value = strings.TrimRight(value, ".,;:) ]}")
	value = strings.TrimSuffix(value, filepath.Ext(value))
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '/' || r == '\\' })
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

func makeTitle(prompt, cwd string) string {
	text := strings.Join(strings.Fields(prompt), " ")
	if strings.Contains(strings.ToLower(text), "dibblerland") {
		if strings.Contains(strings.ToLower(text), "gdi") && strings.Contains(strings.ToLower(text), "sdl") {
			return "Dibblerland / GDI to SDL"
		}
		return "Dibblerland"
	}
	if strings.Contains(strings.ToLower(text), "graaleditor") {
		return "GraalEditor"
	}
	if match := regexp.MustCompile(`(?i)([^\\/\s]+)\.md\b`).FindStringSubmatch(text); len(match) > 1 {
		return match[1]
	}
	if match := regexp.MustCompile(`[A-Za-z]:[\\/][^\s"'<>` + "`" + `]+`).FindString(text); match != "" {
		segment := pathSegment(match)
		if segment != "" && segment != "Users" && segment != "null" {
			return segment
		}
	}
	if text != "" {
		if len([]rune(text)) > 61 {
			return string([]rune(text)[:61]) + "…"
		}
		return text
	}
	if segment := pathSegment(cwd); segment != "" {
		return segment
	}
	return "Untitled conversation"
}

func (s *Service) loadCatalogTitles() map[string]string {
	rows := s.loadCatalogRows()
	titles := make(map[string]string)
	for _, row := range rows {
		if row.ThreadID != "" && row.DisplayTitle != "" {
			titles[row.ThreadID] = strings.TrimSpace(row.DisplayTitle)
		}
	}
	return titles
}

func (s *Service) loadCatalogRows() []CatalogRow {
	locations := s.locations()
	if _, err := os.Stat(locations.CatalogDB); err != nil {
		return []CatalogRow{}
	}
	database, err := sql.Open("sqlite", locations.CatalogDB)
	if err != nil {
		return []CatalogRow{}
	}
	defer database.Close()
	query := `SELECT host_id, thread_id, display_title, source_created_at, source_updated_at, cwd, source_kind, source_detail, model_provider, git_branch, observation_sequence, missing_candidate, thread_source, source_recency_at, pending_observed_title FROM local_thread_catalog ORDER BY source_updated_at DESC;`
	rows, err := database.Query(query)
	if err != nil {
		return []CatalogRow{}
	}
	defer rows.Close()
	result := []CatalogRow{}
	for rows.Next() {
		var hostID, threadID, displayTitle, created, updated, cwd, sourceKind, sourceDetail, provider, branch, threadSource, recency, pending sql.NullString
		var sequence, missing sql.NullInt64
		if rows.Scan(&hostID, &threadID, &displayTitle, &created, &updated, &cwd, &sourceKind, &sourceDetail, &provider, &branch, &sequence, &missing, &threadSource, &recency, &pending) != nil {
			continue
		}
		result = append(result, CatalogRow{HostID: hostID.String, ThreadID: threadID.String, DisplayTitle: displayTitle.String, SourceCreatedAt: created.String, SourceUpdatedAt: updated.String, CWD: cwd.String, SourceKind: sourceKind.String, SourceDetail: sourceDetail.String, ModelProvider: provider.String, GitBranch: branch.String, ObservationSequence: sequence.Int64, MissingCandidate: missing.Int64, ThreadSource: threadSource.String, SourceRecencyAt: recency.String, PendingObservedTitle: pending.String})
	}
	return result
}

func (s *Service) GetCatalog() CatalogView {
	locations := s.locations()
	_, statErr := os.Stat(locations.CatalogDB)
	available := statErr == nil
	view := CatalogView{DBPath: locations.CatalogDB, Available: available, Rows: []CatalogRow{}}
	if !available {
		view.Error = "Catalog DB was not found at this path."
		return view
	}
	view.Rows = s.loadCatalogRows()
	transcriptIDs := s.findTranscriptIDs()
	for index := range view.Rows {
		row := &view.Rows[index]
		row.Orphaned = row.HostID == "local" && !transcriptIDs[strings.ToLower(row.ThreadID)]
	}
	return view
}

func (s *Service) findTranscriptIDs() map[string]bool {
	ids := map[string]bool{}
	locations := s.locations()
	for _, root := range []string{locations.CurrentRoot, locations.ArchivedRoot} {
		paths, err := listJSONLFiles(context.Background(), root)
		if err != nil {
			continue
		}
		for _, path := range paths {
			if id := threadIDFromPath(path); id != "" {
				ids[strings.ToLower(id)] = true
			}
		}
	}
	return ids
}

func (s *Service) RemoveCatalogRows(confirm string, threadIDs []string) (CatalogMutation, error) {
	return s.removeCatalogRows(confirm, threadIDs, "")
}

func (s *Service) removeCatalogRows(confirm string, threadIDs []string, backupPath string) (CatalogMutation, error) {
	if confirm != "REMOVE" {
		return CatalogMutation{}, errors.New("Type REMOVE to confirm catalog-row deletion")
	}
	ids := uniqueUUIDs(threadIDs)
	if len(ids) == 0 {
		return CatalogMutation{IDs: []string{}}, nil
	}
	catalogDB := s.locations().CatalogDB
	if backupPath == "" {
		var err error
		backupPath, err = backupCatalogDatabase(catalogDB)
		if err != nil {
			return CatalogMutation{}, err
		}
	}
	database, err := sql.Open("sqlite", catalogDB)
	if err != nil {
		return CatalogMutation{}, err
	}
	defer database.Close()
	transaction, err := database.Begin()
	if err != nil {
		return CatalogMutation{}, err
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for index, id := range ids {
		args[index] = id
	}
	result, err := transaction.Exec("DELETE FROM local_thread_catalog WHERE host_id='local' AND thread_id IN ("+placeholders+")", args...)
	if err != nil {
		transaction.Rollback()
		return CatalogMutation{}, err
	}
	if _, err := transaction.Exec("UPDATE local_thread_catalog_metadata SET catalog_revision=catalog_revision+1 WHERE id=1"); err != nil {
		transaction.Rollback()
		return CatalogMutation{}, err
	}
	if err := transaction.Commit(); err != nil {
		return CatalogMutation{}, err
	}
	count, _ := result.RowsAffected()
	return CatalogMutation{Removed: int(count), IDs: ids, BackupPath: backupPath}, nil
}

func backupCatalogDatabase(filename string) (string, error) {
	info, err := os.Stat(filename)
	if err != nil {
		return "", fmt.Errorf("Catalog DB backup failed: %w", err)
	}
	if info.IsDir() {
		return "", errors.New("Catalog DB backup failed: configured path is a directory")
	}
	timestamp := time.Now().UTC().Format("20060102T150405.000000000Z")
	backupPath := filepath.Join(filepath.Dir(filename), filepath.Base(filename)+"."+timestamp+".bak")
	for index := 1; ; index++ {
		if _, statErr := os.Stat(backupPath); os.IsNotExist(statErr) {
			break
		}
		backupPath = filepath.Join(filepath.Dir(filename), fmt.Sprintf("%s.%s.%d.bak", filepath.Base(filename), timestamp, index))
	}
	database, err := sql.Open("sqlite", filename)
	if err != nil {
		return "", fmt.Errorf("Catalog DB backup failed: %w", err)
	}
	defer database.Close()
	if _, err := database.Exec("PRAGMA busy_timeout=5000"); err != nil {
		return "", fmt.Errorf("Catalog DB backup failed: %w", err)
	}
	escaped := strings.ReplaceAll(backupPath, "'", "''")
	if _, err := database.Exec("VACUUM INTO '" + escaped + "'"); err != nil {
		return "", fmt.Errorf("Catalog DB backup failed: %w", err)
	}
	return backupPath, nil
}

func uniqueUUIDs(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if !uuidPattern.MatchString(value) || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func (s *Service) Preview(filename string, limit int) (ContextPreview, error) {
	if !s.isWithinScanRoot(filename) {
		return ContextPreview{}, errors.New("Path is outside a configured sessions directory or is not JSONL")
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 8 {
		limit = 8
	}
	preview := ContextPreview{Name: filepath.Base(filename), Path: filename, Messages: []ContextMessage{}}
	file, err := os.Open(filename)
	if err != nil {
		preview.ReadError = err.Error()
		return preview, nil
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	seen := map[string]bool{}
	readBytes := 0
	for lineNumber := 0; lineNumber < 4000 && readBytes <= 8*1024*1024 && scanner.Scan(); lineNumber++ {
		readBytes += len(scanner.Bytes())
		var record any
		if json.Unmarshal(scanner.Bytes(), &record) != nil {
			continue
		}
		message := extractContextMessage(record)
		if message.Text == "" {
			continue
		}
		if len([]rune(message.Text)) > 720 {
			message.Text = string([]rune(message.Text)[:720]) + "…"
		}
		key := message.Role + "\x00" + message.Text
		if seen[key] {
			continue
		}
		seen[key] = true
		preview.Messages = append(preview.Messages, message)
		if len(preview.Messages) >= limit {
			preview.Limited = true
			break
		}
	}
	if scanner.Err() != nil {
		preview.ReadError = scanner.Err().Error()
	}
	if !preview.Limited && (lineNumberReachedLimit(preview, readBytes) || readBytes > 8*1024*1024) {
		preview.Limited = true
	}
	return preview, nil
}

func lineNumberReachedLimit(preview ContextPreview, readBytes int) bool {
	return len(preview.Messages) > 0 && readBytes >= 8*1024*1024
}

func extractContextMessage(record any) ContextMessage {
	root, ok := record.(map[string]any)
	if !ok {
		return ContextMessage{}
	}
	payload, _ := root["payload"].(map[string]any)
	recordType, _ := root["type"].(string)
	if recordType == "response_item" {
		role, _ := payload["role"].(string)
		if role == "user" || role == "assistant" {
			text := cleanContextText(extractText(payload["content"]))
			if role == "user" {
				text = cleanPrompt(text)
			}
			return ContextMessage{Role: role, Text: text}
		}
	}
	if recordType == "event_msg" {
		typeName, _ := payload["type"].(string)
		message, _ := payload["message"].(string)
		if typeName == "user_message" {
			return ContextMessage{Role: "user", Text: cleanPrompt(message)}
		}
		if typeName == "agent_message" {
			return ContextMessage{Role: "assistant", Text: cleanContextText(message)}
		}
	}
	return ContextMessage{}
}

func (s *Service) isWithinScanRoot(filename string) bool {
	absolute, err := filepath.Abs(filename)
	if err != nil || strings.ToLower(filepath.Ext(absolute)) != ".jsonl" {
		return false
	}
	resolvedFile, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return false
	}
	locations := s.locations()
	for _, root := range []string{locations.CurrentRoot, locations.ArchivedRoot} {
		resolvedRoot, rootErr := filepath.EvalSymlinks(root)
		if rootErr != nil {
			continue
		}
		relative, relErr := filepath.Rel(resolvedRoot, resolvedFile)
		if relErr == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative) {
			return true
		}
	}
	return false
}

func pathKey(filename string) string {
	absolute, err := filepath.Abs(filename)
	if err != nil {
		absolute = filepath.Clean(filename)
	}
	if runtime.GOOS == "windows" {
		return strings.ToLower(absolute)
	}
	return absolute
}

func (s *Service) ReviewRecycle(paths []string, removeCatalogRows bool) (RecycleReview, error) {
	unique := uniqueStrings(paths)
	if len(unique) == 0 {
		return RecycleReview{}, errors.New("No files selected")
	}
	locations := s.locations()
	review := RecycleReview{Safe: true, Files: []RecycleCheck{}, Catalog: CatalogCheck{DBPath: locations.CatalogDB, ThreadIDs: []string{}}}
	for _, filename := range unique {
		check := s.checkRecycleFile(filename)
		review.Files = append(review.Files, check)
		if !check.OK {
			review.Safe = false
			continue
		}
		review.TotalBytes += check.CurrentSizeBytes
		if check.ThreadID != "" {
			review.Catalog.ThreadIDs = append(review.Catalog.ThreadIDs, check.ThreadID)
		}
	}
	review.Catalog.ThreadIDs = uniqueUUIDs(review.Catalog.ThreadIDs)
	review.Catalog.Requested = len(review.Catalog.ThreadIDs)
	if removeCatalogRows && review.Catalog.Requested > 0 {
		info, err := os.Stat(locations.CatalogDB)
		review.Catalog.Available = err == nil && !info.IsDir()
		review.Catalog.BackupRequired = true
		if !review.Catalog.Available {
			review.Catalog.Error = "Catalog DB is unavailable; matching entries cannot be removed safely."
			review.Safe = false
		}
	}
	return review, nil
}

func (s *Service) checkRecycleFile(filename string) RecycleCheck {
	absolute, err := filepath.Abs(filename)
	if err != nil {
		absolute = filepath.Clean(filename)
	}
	check := RecycleCheck{Path: absolute, Name: filepath.Base(absolute), ThreadID: threadIDFromPath(absolute)}
	if !s.isWithinScanRoot(absolute) {
		check.Error = "Path is outside a configured sessions directory or is not JSONL."
		return check
	}
	info, err := os.Stat(absolute)
	if err != nil {
		check.Error = "File is no longer available; scan again before moving it."
		return check
	}
	if info.IsDir() {
		check.Error = "Selected path is a directory."
		return check
	}
	check.CurrentSizeBytes = info.Size()
	check.CurrentLastModified = info.ModTime().UTC().Format(time.RFC3339Nano)
	s.mu.RLock()
	snapshot, found := s.lastScan[pathKey(absolute)]
	s.mu.RUnlock()
	if !found {
		check.Error = "File was not part of the latest scan; scan again before moving it."
		return check
	}
	check.ScannedSizeBytes = snapshot.SizeBytes
	check.ScannedLastModified = snapshot.LastModified
	if check.CurrentSizeBytes != snapshot.SizeBytes || check.CurrentLastModified != snapshot.LastModified {
		check.Error = "File changed since the last scan; scan again before moving it."
		return check
	}
	handle, err := os.Open(absolute)
	if err != nil {
		check.Error = "File cannot be opened for verification; it may be locked or inaccessible."
		return check
	}
	handle.Close()
	check.OK = true
	return check
}

func recycleReviewError(review RecycleReview) error {
	for _, file := range review.Files {
		if !file.OK {
			return fmt.Errorf("Recycle blocked for %s: %s", file.Name, file.Error)
		}
	}
	if review.Catalog.Error != "" {
		return errors.New(review.Catalog.Error)
	}
	return errors.New("Recycle blocked by a safety check")
}

func (s *Service) Recycle(paths []string, removeCatalogRows bool) (RecycleResponse, error) {
	review, err := s.ReviewRecycle(paths, removeCatalogRows)
	if err != nil {
		return RecycleResponse{}, err
	}
	if !review.Safe {
		return RecycleResponse{}, recycleReviewError(review)
	}
	response := RecycleResponse{Result: []RecycleItem{}}
	backupPath := ""
	if removeCatalogRows && review.Catalog.BackupRequired {
		backupPath, err = backupCatalogDatabase(review.Catalog.DBPath)
		if err != nil {
			return RecycleResponse{}, err
		}
	}
	for _, file := range review.Files {
		filename := file.Path
		item := RecycleItem{Path: filename}
		if !trashAvailable() {
			item.Error = "System trash is unavailable on this platform."
		} else if err := moveToTrash(filename); err != nil {
			item.Error = err.Error()
		} else {
			item.OK = true
		}
		response.Result = append(response.Result, item)
	}
	if removeCatalogRows {
		for _, item := range response.Result {
			if item.OK {
				if id := threadIDFromPath(item.Path); id != "" {
					response.Catalog.IDs = append(response.Catalog.IDs, id)
				}
			}
		}
		response.Catalog.IDs = uniqueUUIDs(response.Catalog.IDs)
		response.Catalog.Requested = len(response.Catalog.IDs)
		if len(response.Catalog.IDs) > 0 {
			removed, err := s.removeCatalogRows("REMOVE", response.Catalog.IDs, backupPath)
			if err != nil {
				response.Catalog.Error = err.Error()
			} else {
				response.Catalog.Removed = removed.Removed
				response.Catalog.BackupPath = removed.BackupPath
			}
		}
	}
	return response, nil
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func threadIDFromPath(filename string) string {
	base := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
	match := uuidPattern.FindStringSubmatch(base)
	if len(match) < 2 {
		return ""
	}
	return strings.ToLower(match[1])
}

func (s *Service) Reveal(filename string) error {
	if !s.isWithinScanRoot(filename) {
		return errors.New("Path is outside a configured sessions directory or is not JSONL")
	}
	var command string
	var args []string
	switch runtime.GOOS {
	case "windows":
		command, args = "explorer.exe", []string{"/select," + filename}
	case "darwin":
		command, args = "open", []string{"-R", filename}
	default:
		command, args = "xdg-open", []string{filepath.Dir(filename)}
	}
	process := exec.Command(command, args...)
	if err := process.Start(); err != nil {
		return err
	}
	return nil
}

func (s *Service) Close() {
	s.CancelScan()
}
