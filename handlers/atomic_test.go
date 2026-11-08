package handlers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicWriteFile_NewFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "song.txt")

	if err := atomicWriteFile(path, []byte("hello"), 0644); err != nil {
		t.Fatalf("atomicWriteFile: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(got) != "hello" {
		t.Errorf("content = %q, want %q", got, "hello")
	}
}

func TestAtomicWriteFile_Overwrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "song.txt")

	if err := os.WriteFile(path, []byte("old"), 0644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := atomicWriteFile(path, []byte("new"), 0644); err != nil {
		t.Fatalf("atomicWriteFile: %v", err)
	}

	got, _ := os.ReadFile(path)
	if string(got) != "new" {
		t.Errorf("content = %q, want %q", got, "new")
	}
}

// After a successful write, the .tmp-* sidecar must be gone.
func TestAtomicWriteFile_NoLeftoverTemp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "song.txt")

	if err := atomicWriteFile(path, []byte("content"), 0644); err != nil {
		t.Fatalf("atomicWriteFile: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	for _, e := range entries {
		if e.Name() != "song.txt" {
			t.Errorf("unexpected leftover file: %s", e.Name())
		}
	}
}

// MkdirAll the parent so callers don't have to.
func TestAtomicWriteFile_CreatesParentDir(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "deeper", "song.txt")

	if err := atomicWriteFile(path, []byte("x"), 0644); err != nil {
		t.Fatalf("atomicWriteFile: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("expected file to exist: %v", err)
	}
}
