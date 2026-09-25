//go:build windows

package main

import (
	"archive/zip"
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

//go:embed payload.zip
var payloadZip []byte

//go:embed JARVIS_GM.exe
var launcherExe []byte

const (
	WM_DESTROY               = 0x0002
	WM_CLOSE                 = 0x0010
	WM_COMMAND               = 0x0111
	WM_USER                  = 0x0400
	WM_APP                   = 0x8000
	WM_PROGRESS              = WM_APP + 1
	WM_DONE                  = WM_APP + 2
	WM_FAIL                  = WM_APP + 3
	WM_STAGE                 = WM_APP + 4
	SW_SHOW                  = 5
	SW_SHOWNORMAL            = 1
	WS_OVERLAPPED            = 0x00000000
	WS_CAPTION               = 0x00C00000
	WS_SYSMENU               = 0x00080000
	WS_MINIMIZEBOX           = 0x00020000
	WS_VISIBLE               = 0x10000000
	WS_CHILD                 = 0x40000000
	WS_TABSTOP               = 0x00010000
	BS_PUSHBUTTON            = 0x00000000
	SS_LEFT                  = 0x00000000
	PBS_SMOOTH               = 0x01
	PBM_SETRANGE32           = WM_USER + 6
	PBM_SETPOS               = WM_USER + 2
	MB_OK                    = 0x00000000
	MB_ICONERROR             = 0x00000010
	MB_ICONINFORMATION       = 0x00000040
	MB_YESNO                 = 0x00000004
	IDYES                    = 6
	IDC_CANCEL               = 1001
	IDC_DETAILS              = 1002
	PROCESS_CREATE_NO_WINDOW = 0x08000000
)

var (
	user32                   = syscall.NewLazyDLL("user32.dll")
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	comctl32                 = syscall.NewLazyDLL("comctl32.dll")
	shell32                  = syscall.NewLazyDLL("shell32.dll")
	procRegisterClassExW     = user32.NewProc("RegisterClassExW")
	procCreateWindowExW      = user32.NewProc("CreateWindowExW")
	procDefWindowProcW       = user32.NewProc("DefWindowProcW")
	procShowWindow           = user32.NewProc("ShowWindow")
	procUpdateWindow         = user32.NewProc("UpdateWindow")
	procGetMessageW          = user32.NewProc("GetMessageW")
	procTranslateMessage     = user32.NewProc("TranslateMessage")
	procDispatchMessageW     = user32.NewProc("DispatchMessageW")
	procPostQuitMessage      = user32.NewProc("PostQuitMessage")
	procPostMessageW         = user32.NewProc("PostMessageW")
	procSetWindowTextW       = user32.NewProc("SetWindowTextW")
	procEnableWindow         = user32.NewProc("EnableWindow")
	procMessageBoxW          = user32.NewProc("MessageBoxW")
	procSendMessageW         = user32.NewProc("SendMessageW")
	procGetModuleHandleW     = kernel32.NewProc("GetModuleHandleW")
	procInitCommonControlsEx = comctl32.NewProc("InitCommonControlsEx")
	procShellExecuteW        = shell32.NewProc("ShellExecuteW")
)

type WNDCLASSEX struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     syscall.Handle
	HIcon         syscall.Handle
	HCursor       syscall.Handle
	HbrBackground syscall.Handle
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       syscall.Handle
}

type MSG struct {
	Hwnd    syscall.Handle
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}

type INITCOMMONCONTROLSEX struct {
	DwSize uint32
	DwICC  uint32
}

var (
	ciMode        bool
	hwndMain      syscall.Handle
	hwndStage     syscall.Handle
	hwndDetail    syscall.Handle
	hwndProgress  syscall.Handle
	hwndCancel    syscall.Handle
	hwndDetails   syscall.Handle
	installCancel context.CancelFunc
	stateMu       sync.Mutex
	lastError     string
	logPath       string
	stageMu       sync.Mutex
	pendingStage  string
)

func u16(s string) *uint16    { p, _ := syscall.UTF16PtrFromString(s); return p }
func loWord(v uintptr) uint16 { return uint16(v & 0xffff) }

func setText(hwnd syscall.Handle, s string) {
	procSetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(u16(s))))
}
func post(hwnd syscall.Handle, msg uint32, wparam, lparam uintptr) {
	procPostMessageW.Call(uintptr(hwnd), uintptr(msg), wparam, lparam)
}
func msgBox(title, body string, flags uintptr) uintptr {
	r, _, _ := procMessageBoxW.Call(uintptr(hwndMain), uintptr(unsafe.Pointer(u16(body))), uintptr(unsafe.Pointer(u16(title))), flags)
	return r
}

func setLastError(s string) { stateMu.Lock(); lastError = s; stateMu.Unlock() }
func getLastError() string  { stateMu.Lock(); defer stateMu.Unlock(); return lastError }

func wndProc(hwnd syscall.Handle, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case WM_COMMAND:
		switch loWord(wParam) {
		case IDC_CANCEL:
			if installCancel != nil {
				if msgBox("JARVIS GM", "¿Cancelar la instalación? La instalación activa no será reemplazada.", MB_YESNO) == IDYES {
					installCancel()
					setText(hwndDetail, "Cancelando de forma segura…")
					procEnableWindow.Call(uintptr(hwndCancel), 0)
				}
			}
			return 0
		case IDC_DETAILS:
			if logPath != "" {
				procShellExecuteW.Call(0, uintptr(unsafe.Pointer(u16("open"))), uintptr(unsafe.Pointer(u16("notepad.exe"))), uintptr(unsafe.Pointer(u16("\""+logPath+"\""))), 0, SW_SHOWNORMAL)
			} else if e := getLastError(); e != "" {
				msgBox("JARVIS GM — Diagnóstico", e, MB_OK|MB_ICONERROR)
			}
			return 0
		}
	case WM_CLOSE:
		if installCancel != nil {
			if msgBox("JARVIS GM", "La instalación sigue en curso. ¿Cancelar y cerrar?", MB_YESNO) != IDYES {
				return 0
			}
			installCancel()
		}
		procPostQuitMessage.Call(0)
		return 0
	case WM_DESTROY:
		procPostQuitMessage.Call(0)
		return 0
	case WM_STAGE:
		stageMu.Lock()
		txt := pendingStage
		stageMu.Unlock()
		setText(hwndStage, txt)
		return 0
	case WM_PROGRESS:
		procSendMessageW.Call(uintptr(hwndProgress), PBM_SETPOS, wParam, 0)
		return 0
	case WM_DONE:
		setText(hwndStage, "JARVIS GM instalado correctamente")
		setText(hwndDetail, "La instalación y el self-test terminaron correctamente. Abriendo JARVIS…")
		procSendMessageW.Call(uintptr(hwndProgress), PBM_SETPOS, 100, 0)
		procEnableWindow.Call(uintptr(hwndCancel), 0)
		procEnableWindow.Call(uintptr(hwndDetails), 1)
		installCancel = nil
		msgBox("JARVIS GM", "JARVIS GM quedó instalado y validado correctamente.", MB_OK|MB_ICONINFORMATION)
		return 0
	case WM_FAIL:
		setText(hwndStage, "JARVIS GM no fue instalado")
		setText(hwndDetail, "La instalación se detuvo de forma segura. La instalación anterior no fue reemplazada. Pulsa “Diagnóstico” para ver el registro.")
		procEnableWindow.Call(uintptr(hwndCancel), 0)
		procEnableWindow.Call(uintptr(hwndDetails), 1)
		installCancel = nil
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(uintptr(hwnd), uintptr(msg), wParam, lParam)
	return r
}

func createChild(class, text string, style uint32, x, y, w, h int32, parent syscall.Handle, id uintptr) syscall.Handle {
	r, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(u16(class))), uintptr(unsafe.Pointer(u16(text))), uintptr(style), uintptr(x), uintptr(y), uintptr(w), uintptr(h), uintptr(parent), id, 0, 0)
	return syscall.Handle(r)
}

func stage(s string) {
	if ciMode {
		appendLog("STAGE " + s)
		return
	}
	stageMu.Lock()
	pendingStage = s
	stageMu.Unlock()
	post(hwndMain, WM_STAGE, 0, 0)
}
func progress(n int) {
	if ciMode {
		appendLog(fmt.Sprintf("PROGRESS %d", n))
		return
	}
	post(hwndMain, WM_PROGRESS, uintptr(n), 0)
}

func appendLog(line string) {
	if logPath == "" {
		return
	}
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s %s\n", time.Now().Format(time.RFC3339), line)
}

func runHidden(ctx context.Context, exe string, args ...string) (string, error) {
	appendLog("RUN " + exe + " " + strings.Join(args, " "))
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: PROCESS_CREATE_NO_WINDOW}
	cmd.Env = append(os.Environ(), "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8", "PIP_DISABLE_PIP_VERSION_CHECK=1")
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if text != "" {
		appendLog(text)
	}
	if err != nil {
		return text, fmt.Errorf("%s: %w", filepath.Base(exe), err)
	}
	return text, nil
}

func validPython(ctx context.Context, exe string) bool {
	if exe == "" {
		return false
	}
	if _, err := os.Stat(exe); err != nil {
		return false
	}
	out, err := runHidden(ctx, exe, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}'); print(sys.executable)")
	return err == nil && strings.HasPrefix(strings.TrimSpace(out), "3.11")
}

func findPython(ctx context.Context) string {
	candidates := []string{}
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		candidates = append(candidates,
			filepath.Join(local, "Programs", "Python", "Python311", "python.exe"),
			filepath.Join(local, "Python", "Python311", "python.exe"))
	}
	if pf := os.Getenv("ProgramFiles"); pf != "" {
		candidates = append(candidates, filepath.Join(pf, "Python311", "python.exe"))
	}
	if pfx := os.Getenv("ProgramFiles(x86)"); pfx != "" {
		candidates = append(candidates, filepath.Join(pfx, "Python311", "python.exe"))
	}
	for _, c := range candidates {
		if validPython(ctx, c) {
			return c
		}
	}
	if py, err := exec.LookPath("py.exe"); err == nil {
		out, err := runHidden(ctx, py, "-3.11", "-c", "import sys; print(sys.executable)")
		if err == nil {
			lines := strings.Fields(strings.TrimSpace(out))
			if len(lines) > 0 && validPython(ctx, lines[len(lines)-1]) {
				return lines[len(lines)-1]
			}
		}
	}
	for _, name := range []string{"python.exe", "python3.exe"} {
		if p, err := exec.LookPath(name); err == nil && validPython(ctx, p) {
			return p
		}
	}
	return ""
}

func installPython(ctx context.Context) error {
	winget, err := exec.LookPath("winget.exe")
	if err != nil {
		return errors.New("Windows Package Manager (winget) no está disponible para preparar el runtime automáticamente")
	}
	_, err = runHidden(ctx, winget, "install", "--id", "Python.Python.3.11", "--exact", "--silent", "--scope", "user", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity")
	return err
}

func unzipBytes(data []byte, dest string) error {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	for _, f := range zr.File {
		clean := filepath.Clean(f.Name)
		if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			return fmt.Errorf("ruta inválida en payload: %s", f.Name)
		}
		target := filepath.Join(dest, clean)
		rel, err := filepath.Rel(dest, target)
		if err != nil || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("ruta fuera de destino: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
		if err != nil {
			rc.Close()
			return err
		}
		_, cpErr := io.Copy(out, rc)
		out.Close()
		rc.Close()
		if cpErr != nil {
			return cpErr
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func desktopDir() string {
	if one := os.Getenv("OneDrive"); one != "" {
		d := filepath.Join(one, "Desktop")
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			return d
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, "Desktop")
	}
	return ""
}

func performInstall(ctx context.Context) error {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return errors.New("LOCALAPPDATA no está disponible")
	}
	logDir := filepath.Join(local, "JARVIS_GM", "Installer")
	_ = os.MkdirAll(logDir, 0700)
	logPath = filepath.Join(logDir, "install.log")
	_ = os.WriteFile(logPath, []byte("JARVIS GM installer v6\n"), 0600)

	stage("Comprobando el runtime de JARVIS…")
	progress(5)
	py := findPython(ctx)
	if py == "" {
		stage("Preparando el runtime privado…")
		progress(10)
		if err := installPython(ctx); err != nil {
			return fmt.Errorf("no se pudo preparar Python 3.11 automáticamente: %w", err)
		}
		time.Sleep(800 * time.Millisecond)
		py = findPython(ctx)
		if py == "" {
			return errors.New("Python 3.11 terminó de instalarse pero Windows no expuso un ejecutable utilizable")
		}
	}
	appendLog("PYTHON=" + py)

	programs := filepath.Join(local, "Programs")
	target := filepath.Join(programs, "JARVIS GM")
	stageDir := filepath.Join(programs, "JARVIS GM.__new__")
	backup := filepath.Join(programs, "JARVIS GM.__old__")
	_ = os.RemoveAll(stageDir)
	_ = os.RemoveAll(backup)
	if err := os.MkdirAll(stageDir, 0700); err != nil {
		return err
	}

	stage("Preparando archivos de JARVIS…")
	progress(18)
	if err := unzipBytes(payloadZip, stageDir); err != nil {
		return fmt.Errorf("payload: %w", err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, "JARVIS_GM.exe"), launcherExe, 0700); err != nil {
		return err
	}

	runtime := filepath.Join(stageDir, "runtime")
	stage("Creando runtime privado…")
	progress(28)
	if _, err := runHidden(ctx, py, "-m", "venv", "--copies", runtime); err != nil {
		return fmt.Errorf("runtime privado: %w", err)
	}
	vpy := filepath.Join(runtime, "Scripts", "python.exe")
	if !validPython(ctx, vpy) {
		return errors.New("el runtime privado se creó pero no supera la validación de Python 3.11")
	}

	appDir := filepath.Join(stageDir, "app")
	stage("Instalando componentes internos de JARVIS…")
	progress(38)
	installSpec := appDir + "[windows]"
	if _, err := runHidden(ctx, vpy, "-m", "pip", "install", "--no-input", "--prefer-binary", installSpec); err != nil {
		return fmt.Errorf("componentes internos: %w", err)
	}

	stage("Validando módulos de Windows, visión y seguridad…")
	progress(76)
	check := `import jarvis_gm, tkinter, cv2, mediapipe, win32api, pywinauto, PIL, keyring, cryptography; print(jarvis_gm.__version__)`
	out, err := runHidden(ctx, vpy, "-c", check)
	if err != nil {
		return fmt.Errorf("validación de imports: %w", err)
	}
	if !strings.Contains(out, "1.7.0rc1") {
		return fmt.Errorf("versión inesperada durante validación: %s", out)
	}

	stage("Ejecutando self-test de JARVIS…")
	progress(84)
	if _, err := runHidden(ctx, vpy, "-m", "jarvis_gm.self_test"); err != nil {
		return fmt.Errorf("self-test: %w", err)
	}

	_ = os.RemoveAll(appDir)
	marker := map[string]any{"version": "1.7.0rc1", "installed_at": time.Now().Format(time.RFC3339), "runtime": "private-venv"}
	if b, err := json.MarshalIndent(marker, "", "  "); err == nil {
		_ = os.WriteFile(filepath.Join(stageDir, "install.json"), b, 0600)
	}

	stage("Activando instalación validada…")
	progress(93)
	if _, err := os.Stat(target); err == nil {
		if err := os.Rename(target, backup); err != nil {
			return fmt.Errorf("no se pudo reemplazar la instalación anterior; cierra JARVIS si está abierto: %w", err)
		}
	}
	if err := os.Rename(stageDir, target); err != nil {
		if _, stErr := os.Stat(backup); stErr == nil {
			_ = os.Rename(backup, target)
		}
		return fmt.Errorf("no se pudo activar la instalación: %w", err)
	}
	_ = os.RemoveAll(backup)

	if desk := desktopDir(); desk != "" {
		_ = copyFile(filepath.Join(target, "JARVIS_GM.exe"), filepath.Join(desk, "JARVIS_GM.exe"))
	}

	stage("Abriendo JARVIS GM…")
	progress(98)
	if ciMode {
		return nil
	}
	cmd := exec.Command(filepath.Join(target, "JARVIS_GM.exe"))
	cmd.Dir = target
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: PROCESS_CREATE_NO_WINDOW}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("instalado, pero no se pudo abrir JARVIS: %w", err)
	}
	return nil
}

func installWorker(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			setLastError(fmt.Sprint(r))
			appendLog("PANIC " + fmt.Sprint(r))
			post(hwndMain, WM_FAIL, 0, 0)
		}
	}()
	if err := performInstall(ctx); err != nil {
		setLastError(err.Error())
		appendLog("ERROR " + err.Error())
		post(hwndMain, WM_FAIL, 0, 0)
		return
	}
	post(hwndMain, WM_DONE, 0, 0)
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--ci-smoke" {
		ciMode = true
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
		defer cancel()
		if err := performInstall(ctx); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	icc := INITCOMMONCONTROLSEX{DwSize: uint32(unsafe.Sizeof(INITCOMMONCONTROLSEX{})), DwICC: 0x00000020}
	procInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&icc)))
	hInst, _, _ := procGetModuleHandleW.Call(0)
	cls := u16("JARVISGMInstallerV6")
	wc := WNDCLASSEX{CbSize: uint32(unsafe.Sizeof(WNDCLASSEX{})), LpfnWndProc: syscall.NewCallback(wndProc), HInstance: syscall.Handle(hInst), HbrBackground: syscall.Handle(6), LpszClassName: cls}
	if r, _, e := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		panic(e)
	}
	r, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(u16("JARVIS GM — Instalación profesional"))), WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU|WS_MINIMIZEBOX, 200, 120, 760, 410, 0, 0, hInst, 0)
	hwndMain = syscall.Handle(r)
	createChild("STATIC", "JARVIS GM", WS_CHILD|WS_VISIBLE|SS_LEFT, 36, 28, 650, 34, hwndMain, 0)
	hwndStage = createChild("STATIC", "Preparando instalación…", WS_CHILD|WS_VISIBLE|SS_LEFT, 36, 78, 650, 30, hwndMain, 0)
	hwndDetail = createChild("STATIC", "Esta instalación mantiene la interfaz activa y valida JARVIS antes de reemplazar la versión anterior.", WS_CHILD|WS_VISIBLE|SS_LEFT, 36, 116, 660, 54, hwndMain, 0)
	hwndProgress = createChild("msctls_progress32", "", WS_CHILD|WS_VISIBLE|PBS_SMOOTH, 36, 188, 660, 24, hwndMain, 0)
	procSendMessageW.Call(uintptr(hwndProgress), PBM_SETRANGE32, 0, 100)
	hwndDetails = createChild("BUTTON", "Diagnóstico", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_PUSHBUTTON, 36, 255, 150, 38, hwndMain, IDC_DETAILS)
	procEnableWindow.Call(uintptr(hwndDetails), 0)
	hwndCancel = createChild("BUTTON", "Cancelar", WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_PUSHBUTTON, 546, 255, 150, 38, hwndMain, IDC_CANCEL)
	procShowWindow.Call(uintptr(hwndMain), SW_SHOW)
	procUpdateWindow.Call(uintptr(hwndMain))
	ctx, cancel := context.WithCancel(context.Background())
	installCancel = cancel
	go installWorker(ctx)
	var m MSG
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

var _ = strconv.IntSize
