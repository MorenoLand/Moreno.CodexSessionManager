//go:build !windows

package shelf

import (
	"errors"
	"os/exec"
	"runtime"
	"strings"
)

func trashAvailable() bool {
	if runtime.GOOS == "darwin" {
		_, err := exec.LookPath("osascript")
		return err == nil
	}
	if _, err := exec.LookPath("gio"); err == nil {
		return true
	}
	_, err := exec.LookPath("trash-put")
	return err == nil
}

func moveToTrash(filename string) error {
	if runtime.GOOS == "darwin" {
		script := `tell application "Finder" to delete POSIX file "` + strings.ReplaceAll(strings.ReplaceAll(filename, `\`, `\\`), `"`, `\"`) + `"`
		return exec.Command("osascript", "-e", script).Run()
	}
	if gio, err := exec.LookPath("gio"); err == nil {
		return gioCommand(gio, filename)
	}
	if trashPut, err := exec.LookPath("trash-put"); err == nil {
		return exec.Command(trashPut, filename).Run()
	}
	return errors.New("no desktop trash command is available")
}

func gioCommand(command, filename string) error {
	return exec.Command(command, "trash", filename).Run()
}
