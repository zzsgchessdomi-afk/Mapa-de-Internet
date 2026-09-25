from __future__ import annotations

from collections.abc import Callable
import os
import threading
import time


TranscriptCallback = Callable[[str, float], None]
StatusCallback = Callable[[str, str], None]


_AUDIO_INPUT_CATEGORY = r"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\AudioInput"


class WindowsSapiRecognizer:
    """Private in-process SAPI recognizer.

    This intentionally does NOT use SpSharedRecognizer. The shared recognizer is
    coupled to the classic Windows Speech Recognition UI/training experience,
    which is not part of JARVIS. JARVIS owns this recognizer inside its private
    backend and never launches the Windows speech toolbar.
    """

    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._status = "stopped"
        self._detail = "not started"

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    @property
    def status(self) -> tuple[str, str]:
        return self._status, self._detail

    def dependencies_available(self) -> tuple[bool, str]:
        if os.name != "nt":
            return False, "Windows SAPI is only available on Windows"
        try:
            import pythoncom  # noqa: F401
            import win32com.client  # noqa: F401
        except Exception as exc:
            return False, f"pywin32/SAPI unavailable: {exc}"
        return True, "ready"

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
        thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=2.0)
        self._thread = None
        self._status, self._detail = "stopped", "stopped by user"

    def _set_status(self, status: str, detail: str, callback: StatusCallback | None) -> None:
        self._status, self._detail = status, detail
        if callback:
            callback(status, detail)

    @staticmethod
    def _default_audio_token(win32com):
        category = win32com.client.Dispatch("SAPI.SpObjectTokenCategory")
        category.SetId(_AUDIO_INPUT_CATEGORY)
        token_id = category.GetDefaultTokenId()
        token = win32com.client.Dispatch("SAPI.SpObjectToken")
        token.SetId(token_id)
        return category, token

    def _run(self, on_transcript: TranscriptCallback, on_status: StatusCallback | None) -> None:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        recognizer = None
        context = None
        grammar = None
        audio_category = None
        audio_token = None
        try:
            # In-process recognizer: no Speech Recognition toolbar, wizard or
            # shared Windows recognizer state.
            recognizer = win32com.client.Dispatch("SAPI.SpInprocRecognizer")
            audio_category, audio_token = self._default_audio_token(win32com)
            recognizer.AudioInput = audio_token

            context = recognizer.CreateRecoContext()
            grammar = context.CreateGrammar()
            try:
                grammar.DictationLoad("", 0)
            except Exception:
                # Some installed SAPI engines load their dictation grammar
                # implicitly. DictationSetState below remains authoritative.
                pass
            grammar.DictationSetState(1)
            try:
                recognizer.State = 1
            except Exception:
                pass

            owner = self
            callback = on_transcript

            class RecoEvents:
                def OnRecognition(self, StreamNumber, StreamPosition, RecognitionType, Result):  # noqa: N802
                    try:
                        text = str(Result.PhraseInfo.GetText()).strip()
                        if text:
                            callback(text, time.time())
                    except Exception as exc:
                        owner._detail = f"recognition event error: {exc}"

            sink = win32com.client.WithEvents(context, RecoEvents)
            self._set_status("running", "JARVIS private in-process speech recognition active", on_status)
            while not self._stop.wait(0.03):
                pythoncom.PumpWaitingMessages()
            _ = sink
        except Exception as exc:
            self._set_status("error", f"JARVIS private speech recognition failed: {exc}", on_status)
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
            # Keep COM objects referenced until recognition is fully shut down.
            _ = (context, audio_category, audio_token)
            pythoncom.CoUninitialize()
            if self._status not in {"error", "unavailable"}:
                self._set_status("stopped", "voice loop ended", on_status)


class WindowsSapiVoice:
    def available(self) -> tuple[bool, str]:
        if os.name != "nt":
            return False, "Windows SAPI TTS is only available on Windows"
        try:
            import win32com.client  # noqa: F401
        except Exception as exc:
            return False, f"pywin32/SAPI unavailable: {exc}"
        return True, "ready"

    def speak(self, text: str, *, asynchronous: bool = True) -> None:
        ok, detail = self.available()
        if not ok:
            raise RuntimeError(detail)

        def worker() -> None:
            import pythoncom
            import win32com.client
            pythoncom.CoInitialize()
            try:
                voice = win32com.client.Dispatch("SAPI.SpVoice")
                voice.Speak(str(text))
            finally:
                pythoncom.CoUninitialize()

        if asynchronous:
            threading.Thread(target=worker, name="jarvis-tts", daemon=True).start()
        else:
            worker()
