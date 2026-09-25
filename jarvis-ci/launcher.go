package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	messageBoxW = user32.NewProc("MessageBoxW")
)

func utf16Ptr(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func msg(title, body string, flags uintptr) {
	messageBoxW.Call(0, uintptr(unsafe.Pointer(utf16Ptr(body))), uintptr(unsafe.Pointer(utf16Ptr(title))), flags)
}

func candidateRoot() string {
	exe, _ := os.Executable()
	here := filepath.Dir(exe)
	if _, err := os.Stat(filepath.Join(here, "runtime", "Scripts", "pythonw.exe")); err == nil {
		return here
	}
	local := os.Getenv("LOCALAPPDATA")
	if local != "" {
		return filepath.Join(local, "Programs", "JARVIS GM")
	}
	return here
}

func main() {
	root := candidateRoot()
	pyw := filepath.Join(root, "runtime", "Scripts", "pythonw.exe")
	if _, err := os.Stat(pyw); err != nil {
		msg("JARVIS GM", "La instalación de JARVIS no está completa. Vuelve a ejecutar JARVIS_GM_Instalar.exe.", 0x10)
		return
	}
	cmd := exec.Command(pyw, "-c", "from jarvis_gm.app import main; main()")
	cmd.Dir = root
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	cmd.Env = append(os.Environ(), fmt.Sprintf("PYTHONUTF8=1"), fmt.Sprintf("PYTHONIOENCODING=utf-8"))
	if err := cmd.Start(); err != nil {
		msg("JARVIS GM", "No se pudo iniciar JARVIS.\n\n"+err.Error(), 0x10)
		return
	}
}
