from __future__ import annotations

from collections.abc import Callable
import os
import subprocess
import threading
import time
from pathlib import Path

TranscriptCallback = Callable[[str, float], None]
StatusCallback = Callable[[str, str], None]

_AUDIO_INPUT_CATEGORY = r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\AudioInput"
_CREATE_NO_WINDOW = 0x08000000

_SYSTEM_SPEECH_SCRIPT = r"""
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName System.Speech
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $grammar = New-Object System.Speech.Recognition.DictationGrammar
  $recognizer.LoadGrammar($grammar)
  $recognizer.SetInputToDefaultAudioDevice()
  [Console]::Out.WriteLine("JARVIS_READY")
  [Console]::Out.Flush()
  while ($true) {
    try {
      $result = $recognizer.Recognize([TimeSpan]::FromMilliseconds(700))
      if ($null -ne $result -and -not [string]::IsNullOrWhiteSpace($result.Text)) {
        $clean = $result.Text.Replace([char]13," ").Replace([char]10," ").Replace([char]9," ")
        [Console]::Out.WriteLine("JARVIS_TRANSCRIPT" + [char]9 + $clean)
        [Console]::Out.Flush()
      }
    } catch [System.TimeoutException] {
    }
  }
} catch {
  $msg = $_.Exception.Message.Replace([char]13," ").Replace([char]10," ")
  [Console]::Out.WriteLine("JARVIS_ERROR" + [char]9 + $msg)
  [Console]::Out.Flush()
  exit 21
}
"""


def _dynamic_dispatch(prog_id: str):
    import win32com.client.dynamic
    return win32com.client.dynamic.Dispatch(prog_id)


class WindowsSapiRecognizer:
    """Private Windows recognizer with a hidden second engine fallback."""

    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._status = "stopped"
        self._detail = "not started"
        self._fallback_process: subprocess.Popen[str] | None = None

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive() and self._status == "running")

    @property
    def status(self) -> tuple[str, str]:
        return self._status, self._detail

    def dependencies_available(self) -> tuple[bool, str]:
        if os.name != "nt":
            return False, "Windows speech recognition is only available on Windows"
        try:
            import pythoncom  # noqa: F401
            import win32com.client.dynamic  # noqa: F401
            return True, "private Windows speech engines available"
        except Exception as exc:
            ps = Path(self._powershell_path())
            if ps.exists():
                return True, f"System.Speech fallback available; SAPI unavailable: {exc}"
            return False, f"Windows speech engines unavailable: {exc}"

    def start(self, on_transcript: TranscriptCallback, on_status: StatusCallback | None = None) -> None:
        if self.running:
            return
        ok, detail = self.dependencies_available()
        if not ok:
            self._status, self._detail = "unavailable", detail
            if on_status:
                on_status(self._status, self._detail)
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            args=(on_transcript, on_status),
            name="jarvis-private-voice",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        proc = self._fallback_process
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=2.5)
        self._thread = None
        self._fallback_process = None
        self._status, self._detail = "stopped", "stopped by user"

    def _set_status(self, status: str, detail: str, callback: StatusCallback | None) -> None:
        self._status, self._detail = status, detail
        if callback:
            callback(status, detail)

    @staticmethod
    def _powershell_path() -> str:
        root = Path(os.environ.get("WINDIR", r"C:\Windows"))
        return str(root / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe")

    @staticmethod
    def _default_audio_token():
        category = _dynamic_dispatch("SAPI.SpObjectTokenCategory")
        category.SetId(_AUDIO_INPUT_CATEGORY)
        token_id = category.GetDefaultTokenId()
        token = _dynamic_dispatch("SAPI.SpObjectToken")
        token.SetId(token_id)
        return category, token

    def _run_private_sapi(self, on_transcript: TranscriptCallback) -> None:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        recognizer = context = grammar = sink = None
        audio_category = audio_token = None
        try:
            recognizer = _dynamic_dispatch("SAPI.SpInprocRecognizer")
            audio_category, audio_token = self._default_audio_token()
            recognizer.AudioInput = audio_token
            context = recognizer.CreateRecoContext()
            grammar = context.CreateGrammar(0)
            try:
                grammar.DictationLoad("", 0)
            except Exception:
                pass
            grammar.DictationSetState(1)
            try:
                recognizer.State = 1
            except Exception:
                pass

            callback = on_transcript

            class RecoEvents:
                def OnRecognition(self, StreamNumber, StreamPosition, RecognitionType, Result):
                    try:
                        text = str(Result.PhraseInfo.GetText()).strip()
                        if text:
                            callback(text, time.time())
                    except Exception:
                        pass

            sink = win32com.client.WithEvents(context, RecoEvents)
            while not self._stop.wait(0.03):
                pythoncom.PumpWaitingMessages()
        finally:
            if grammar is not None:
                try:
                    grammar.DictationSetState(0)
                except Exception:
                    pass
            if recognizer is not None:
                try:
                    recognizer.State = 0
                except Exception:
                    pass
            _ = (context, sink, audio_category, audio_token)
            pythoncom.CoUninitialize()

    def _run_system_speech(self, on_transcript: TranscriptCallback, on_status: StatusCallback | None, primary_error: Exception) -> None:
        ps = self._powershell_path()
        if not Path(ps).exists():
            raise RuntimeError(f"private SAPI failed ({primary_error}); System.Speech fallback missing")

        self._set_status("starting", "Switching to hidden Windows System.Speech fallback", on_status)
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        proc = subprocess.Popen(
            [ps, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", _SYSTEM_SPEECH_SCRIPT],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=_CREATE_NO_WINDOW,
            startupinfo=startupinfo,
        )
        self._fallback_process = proc
        ready = False
        assert proc.stdout is not None
        while not self._stop.is_set():
            line = proc.stdout.readline()
            if line == "" and proc.poll() is not None:
                break
            if not line:
                time.sleep(0.03)
                continue
            line = line.strip()
            if line == "JARVIS_READY":
                ready = True
                self._set_status("running", "JARVIS hidden System.Speech recognition active", on_status)
            elif line.startswith("JARVIS_TRANSCRIPT\t"):
                text = line.split("\t", 1)[1].strip()
                if text:
                    on_transcript(text, time.time())
            elif line.startswith("JARVIS_ERROR\t"):
                raise RuntimeError(line.split("\t", 1)[1].strip())

        if self._stop.is_set():
            return
        code = proc.poll()
        if not ready:
            raise RuntimeError(f"System.Speech fallback exited before ready (code {code})")
        raise RuntimeError(f"System.Speech fallback stopped unexpectedly (code {code})")

    def _run(self, on_transcript: TranscriptCallback, on_status: StatusCallback | None) -> None:
        try:
            self._set_status("starting", "Starting JARVIS private speech recognition", on_status)
            try:
                self._run_private_sapi(on_transcript)
                if self._stop.is_set():
                    return
                raise RuntimeError("private SAPI ended unexpectedly")
            except Exception as primary_error:
                if self._stop.is_set():
                    return
                self._run_system_speech(on_transcript, on_status, primary_error)
        except Exception as exc:
            self._set_status("error", f"JARVIS speech recognition failed after both private engines: {exc}", on_status)
        finally:
            proc = self._fallback_process
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                except Exception:
                    pass
            self._fallback_process = None
            if self._stop.is_set() and self._status not in {"error", "unavailable"}:
                self._set_status("stopped", "voice loop ended", on_status)


class WindowsSapiVoice:
    def available(self) -> tuple[bool, str]:
        if os.name != "nt":
            return False, "Windows TTS is only available on Windows"
        return True, "ready"

    def _speak_sapi(self, text: str) -> None:
        import pythoncom
        pythoncom.CoInitialize()
        try:
            voice = _dynamic_dispatch("SAPI.SpVoice")
            voice.Speak(str(text))
        finally:
            pythoncom.CoUninitialize()

    @staticmethod
    def _speak_system_speech(text: str) -> None:
        ps = WindowsSapiRecognizer._powershell_path()
        safe = str(text).replace("'", "''")
        script = "Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$s.Speak('" + safe + "')"
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        subprocess.run(
            [ps, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=_CREATE_NO_WINDOW,
            startupinfo=startupinfo,
            check=True,
        )

    def speak(self, text: str, *, asynchronous: bool = True) -> None:
        def worker() -> None:
            try:
                self._speak_sapi(text)
            except Exception:
                self._speak_system_speech(text)

        if asynchronous:
            threading.Thread(target=worker, name="jarvis-tts", daemon=True).start()
        else:
            worker()
