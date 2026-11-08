package handlers

import (
	"os"
	"path/filepath"
)

// atomicWriteFile writes data to path durably: it writes to a sibling temp
// file in the same directory, fsyncs, then renames into place. The rename is
// atomic on POSIX as long as source and destination are on the same
// filesystem (guaranteed here because the temp file lives next to the target).
//
// On any failure the temp file is removed so we never leak ".tmp-*" files.
//
// Use this instead of os.WriteFile for any file the app cannot afford to find
// truncated after a crash or signal mid-write (song .txt files, song-meta.json,
// .access_times.json).
func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := f.Name()

	// If anything below fails, drop the temp file so we don't leak garbage.
	committed := false
	defer func() {
		if !committed {
			os.Remove(tmpPath)
		}
	}()

	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, perm); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	committed = true
	return nil
}
