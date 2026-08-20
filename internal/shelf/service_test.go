package shelf

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testService(t *testing.T, root, archive, catalog string) *Service {
	t.Helper()
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(archive, 0o755); err != nil {
		t.Fatal(err)
	}
	return &Service{currentRoot: root, archivedRoot: archive, catalogDB: catalog, lastScan: map[string]scanSnapshot{}}
}

func TestReviewRecycleBlocksChangedFile(t *testing.T) {
	root := t.TempDir()
	service := testService(t, root, filepath.Join(t.TempDir(), "archive"), filepath.Join(t.TempDir(), "catalog.db"))
	filename := filepath.Join(root, "rollout-2026-08-20-01a01cc5-38a6-7431-bb4c-965672f007f6.jsonl")
	if err := os.WriteFile(filename, []byte(`{"type":"user_message","message":{"content":"keep this"}}
`), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filename)
	if err != nil {
		t.Fatal(err)
	}
	service.lastScan[pathKey(filename)] = scanSnapshot{SizeBytes: info.Size(), LastModified: info.ModTime().UTC().Format(time.RFC3339Nano)}
	initial, err := service.ReviewRecycle([]string{filename}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !initial.Safe || !initial.Files[0].OK {
		t.Fatalf("expected unchanged file to pass review: %+v", initial)
	}
	if err := os.WriteFile(filename, []byte(`{"type":"user_message","message":{"content":"changed"}}
`), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err := service.ReviewRecycle([]string{filename}, false)
	if err != nil {
		t.Fatal(err)
	}
	if changed.Safe || !strings.Contains(changed.Files[0].Error, "changed since") {
		t.Fatalf("expected changed file to be blocked: %+v", changed)
	}
}

func TestReviewRecycleRequiresCatalogDBForCleanup(t *testing.T) {
	root := t.TempDir()
	catalog := filepath.Join(t.TempDir(), "missing.db")
	service := testService(t, root, filepath.Join(t.TempDir(), "archive"), catalog)
	filename := filepath.Join(root, "rollout-2026-08-20-01a01cc5-38a6-7431-bb4c-965672f007f6.jsonl")
	if err := os.WriteFile(filename, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filename)
	if err != nil {
		t.Fatal(err)
	}
	service.lastScan[pathKey(filename)] = scanSnapshot{SizeBytes: info.Size(), LastModified: info.ModTime().UTC().Format(time.RFC3339Nano)}
	review, err := service.ReviewRecycle([]string{filename}, true)
	if err != nil {
		t.Fatal(err)
	}
	if review.Safe || review.Catalog.Available || !review.Catalog.BackupRequired {
		t.Fatalf("expected missing catalog DB to block cleanup: %+v", review)
	}
}

func TestRemoveCatalogRowsCreatesBackup(t *testing.T) {
	root := t.TempDir()
	catalog := filepath.Join(root, "catalog.db")
	database, err := sql.Open("sqlite", catalog)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec("CREATE TABLE local_thread_catalog (host_id TEXT, thread_id TEXT); CREATE TABLE local_thread_catalog_metadata (id INTEGER PRIMARY KEY, catalog_revision INTEGER); INSERT INTO local_thread_catalog_metadata(id, catalog_revision) VALUES (1, 0); INSERT INTO local_thread_catalog(host_id, thread_id) VALUES ('local', '01a01cc5-38a6-7431-bb4c-965672f007f6');")
	if err != nil {
		database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	service := testService(t, filepath.Join(root, "sessions"), filepath.Join(root, "archive"), catalog)
	mutation, err := service.RemoveCatalogRows("REMOVE", []string{"01a01cc5-38a6-7431-bb4c-965672f007f6"})
	if err != nil {
		t.Fatal(err)
	}
	if mutation.Removed != 1 || mutation.BackupPath == "" {
		t.Fatalf("expected one removed row and backup path: %+v", mutation)
	}
	if _, err := os.Stat(mutation.BackupPath); err != nil {
		t.Fatalf("backup does not exist: %v", err)
	}
	backup, err := sql.Open("sqlite", mutation.BackupPath)
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	var count int
	if err := backup.QueryRow("SELECT COUNT(*) FROM local_thread_catalog WHERE thread_id='01a01cc5-38a6-7431-bb4c-965672f007f6'").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected backup to retain deleted row, got %d", count)
	}
}

func TestScanUsesMetadataIndexAndTitleAlias(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(root, "archive")
	config := filepath.Join(root, "config")
	filename := filepath.Join(root, "rollout-2026-08-20-01a01cc5-38a6-7431-bb4c-965672f007f6.jsonl")
	if err := os.MkdirAll(archive, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filename, []byte("{\"timestamp\":\"2026-08-20T12:00:00Z\",\"cwd\":\"C:\\\\work\",\"agent_nickname\":\"Maxwell\"}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := &Service{currentRoot: root, archivedRoot: archive, catalogDB: filepath.Join(root, "catalog.db"), indexPath: filepath.Join(config, "index.json"), aliasesPath: filepath.Join(config, "aliases.json"), defaults: StorageLocations{CurrentRoot: root, ArchivedRoot: archive, CatalogDB: filepath.Join(root, "catalog.db")}, lastScan: map[string]scanSnapshot{}, scanIndex: map[string]scanIndexEntry{}, aliases: map[string]string{}}
	first, err := service.Scan(false)
	if err != nil {
		t.Fatal(err)
	}
	if first.IndexHits != 0 || first.IndexMisses != 1 {
		t.Fatalf("expected first scan to miss index: %+v", first)
	}
	second, err := service.Scan(false)
	if err != nil {
		t.Fatal(err)
	}
	if second.IndexHits != 1 || second.IndexMisses != 0 {
		t.Fatalf("expected second scan to hit index: %+v", second)
	}
	if _, err := service.SaveTitleAlias("01a01cc5-38a6-7431-bb4c-965672f007f6", "Dibblerland2"); err != nil {
		t.Fatal(err)
	}
	third, err := service.Scan(false)
	if err != nil {
		t.Fatal(err)
	}
	if len(third.Groups) != 1 || third.Groups[0].Title != "Dibblerland2" || third.Groups[0].TitleSource != "Manual alias" {
		t.Fatalf("expected alias to override title: %+v", third.Groups)
	}
}

func TestSaveSettingsRejectsOverlappingRoots(t *testing.T) {
	root := t.TempDir()
	service := &Service{currentRoot: root, archivedRoot: filepath.Join(root, "archive"), catalogDB: filepath.Join(root, "catalog.db"), settingsPath: filepath.Join(root, "settings.json"), defaults: StorageLocations{CurrentRoot: root, ArchivedRoot: filepath.Join(root, "archive"), CatalogDB: filepath.Join(root, "catalog.db")}}
	_, err := service.SaveSettings(StorageSettingsUpdate{CurrentRoot: root, ArchivedRoot: filepath.Join(root, "archive"), CatalogDB: filepath.Join(root, "catalog.db")})
	if err == nil || !strings.Contains(err.Error(), "must not overlap") {
		t.Fatalf("expected overlapping roots to be rejected, got %v", err)
	}
}

func TestSearchContextFindsMatchingMessages(t *testing.T) {
	root := t.TempDir()
	service := testService(t, root, filepath.Join(t.TempDir(), "archive"), filepath.Join(t.TempDir(), "catalog.db"))
	filename := filepath.Join(root, "rollout-2026-08-20-01a01cc5-38a6-7431-bb4c-965672f007f6.jsonl")
	content := "{\"type\":\"response_item\",\"payload\":{\"role\":\"user\",\"content\":\"Find the Dibblerland title\"}}\n{\"type\":\"response_item\",\"payload\":{\"role\":\"assistant\",\"content\":\"I found the title\"}}\n"
	if err := os.WriteFile(filename, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := service.SearchContext(filename, "dibblerland", 20)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Complete || len(result.Matches) != 1 || result.Matches[0].Role != "user" {
		t.Fatalf("expected one matching user message: %+v", result)
	}
}

func TestArchiveMovesFilesToConfiguredArchive(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(t.TempDir(), "archive")
	filename := filepath.Join(root, "2026", "08", "rollout-2026-08-20-01a01cc5-38a6-7431-bb4c-965672f007f6.jsonl")
	if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
		t.Fatal(err)
	}
	content := []byte("{\"type\":\"response_item\",\"payload\":{\"role\":\"user\",\"content\":\"Archive this\"}}\n")
	if err := os.WriteFile(filename, content, 0o600); err != nil {
		t.Fatal(err)
	}
	service := testService(t, root, archive, filepath.Join(t.TempDir(), "catalog.db"))
	info, err := os.Stat(filename)
	if err != nil {
		t.Fatal(err)
	}
	service.lastScan[pathKey(filename)] = scanSnapshot{SizeBytes: info.Size(), LastModified: info.ModTime().UTC().Format(time.RFC3339Nano)}
	review, err := service.ReviewArchive([]string{filename})
	if err != nil || !review.Safe || len(review.Files) != 1 {
		t.Fatalf("expected safe archive review, review=%+v err=%v", review, err)
	}
	response, err := service.Archive([]string{filename})
	if err != nil || len(response.Result) != 1 || !response.Result[0].OK {
		t.Fatalf("expected archive move, response=%+v err=%v", response, err)
	}
	destination := filepath.Join(archive, "2026", "08", filepath.Base(filename))
	if _, err := os.Stat(destination); err != nil {
		t.Fatalf("archived file missing: %v", err)
	}
	if _, err := os.Stat(filename); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source file still exists or could not be checked: %v", err)
	}
}
