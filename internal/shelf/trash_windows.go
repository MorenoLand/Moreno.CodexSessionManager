//go:build windows

package shelf

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	shFileOperationDelete = 0x0003
	fofSilent             = 0x0004
	fofNoConfirmation     = 0x0010
	fofAllowUndo          = 0x0040
)

type shFileOpStruct struct {
	hwnd                  uintptr
	wFunc                 uint32
	pFrom                 *uint16
	pTo                   *uint16
	flags                 uint16
	fAnyOperationsAborted int32
	hNameMappings         uintptr
	lpszProgressTitle     *uint16
}

var shell32 = windows.NewLazySystemDLL("shell32.dll")

func trashAvailable() bool {
	return shell32.NewProc("SHFileOperationW").Find() == nil
}

func moveToTrash(filename string) error {
	from, err := windows.UTF16FromString(filename)
	if err != nil {
		return err
	}
	from = append(from, 0)
	operation := shFileOpStruct{wFunc: shFileOperationDelete, pFrom: &from[0], flags: fofSilent | fofNoConfirmation | fofAllowUndo}
	result, _, callErr := shell32.NewProc("SHFileOperationW").Call(uintptr(unsafe.Pointer(&operation)))
	if result != 0 {
		return fmt.Errorf("SHFileOperationW failed with code %d: %v", result, callErr)
	}
	return nil
}
