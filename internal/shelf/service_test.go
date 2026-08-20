package shelf

import (
	"database/sql"
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
