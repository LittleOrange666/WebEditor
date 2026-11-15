# WebEditor 的 Python 執行環境（spec §6.2.2）
import sys
import io
import os
import codecs
import shutil
import runpy
import traceback
import importlib

import _wed  # 由 Worker 以 registerJsModule 提供：read(n) / write(fd, text)

PROJECT_ROOT = "/home/pyodide/project"
sys.setrecursionlimit(10000)


class _Raw(io.RawIOBase):
    def __init__(self, fd):
        self.fd = fd
        self._dec = codecs.getincrementaldecoder("utf-8")("replace")

    def readable(self):
        return self.fd == 0

    def writable(self):
        return self.fd != 0

    def readinto(self, b):
        data = _wed.read(len(b)).to_bytes()
        n = len(data)
        b[:n] = data
        return n

    def write(self, b):
        text = self._dec.decode(bytes(b))
        if text:
            _wed.write(self.fd, text)
        return len(b)

    def isatty(self):
        return False


def _setup_streams(interactive):
    sys.stdin = io.TextIOWrapper(io.BufferedReader(_Raw(0)), encoding="utf-8", errors="replace")
    # 終端機模式逐行送出，讓 input() 前的提示能先顯示；測資模式整批緩衝較快
    sys.stdout = io.TextIOWrapper(io.BufferedWriter(_Raw(1)), encoding="utf-8", errors="replace",
                                  line_buffering=interactive, write_through=interactive)
    sys.stderr = io.TextIOWrapper(io.BufferedWriter(_Raw(2)), encoding="utf-8", errors="replace",
                                  line_buffering=True, write_through=True)


def _write_project(files):
    if os.path.exists(PROJECT_ROOT):
        shutil.rmtree(PROJECT_ROOT)
    os.makedirs(PROJECT_ROOT)
    for f in files:
        full = os.path.join(PROJECT_ROOT, f["path"])
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8", newline="") as fp:
            fp.write(f["content"])


def _format_exc(exc):
    te = traceback.TracebackException.from_exception(exc)
    # 只留下使用者程式的堆疊（去掉 runpy 等內部呼叫）
    te.stack = traceback.StackSummary.from_list(
        [fr for fr in te.stack if fr.filename.startswith(PROJECT_ROOT)]
    )
    text = "".join(te.format())
    return text.replace(PROJECT_ROOT + "/", "")


def _wed_run(path, files, interactive):
    files = files.to_py() if hasattr(files, "to_py") else files
    _write_project(files)
    importlib.invalidate_caches()
    script = os.path.join(PROJECT_ROOT, path)
    workdir = os.path.dirname(script)
    before = set(sys.modules)
    saved_path = list(sys.path)
    saved = (sys.stdin, sys.stdout, sys.stderr, sys.argv)
    _setup_streams(bool(interactive))
    sys.argv = [path]
    sys.path.insert(0, workdir)
    os.chdir(workdir)
    code, message = 0, ""
    try:
        runpy.run_path(script, run_name="__main__")
    except SystemExit as e:
        if e.code is None:
            code = 0
        elif isinstance(e.code, int):
            code = e.code
        else:
            sys.stderr.write(str(e.code) + "\n")
            code = 1
    except BaseException as e:  # noqa: BLE001
        code = 1
        if isinstance(e, RecursionError):
            message = _format_exc(e) + "\n（遞迴太深：瀏覽器中的 Python 遞迴深度有限，在評測機上可能正常）"
        else:
            message = _format_exc(e)
    finally:
        for s in (sys.stdout, sys.stderr):
            try:
                s.flush()
            except Exception:  # noqa: BLE001
                pass
        sys.stdin, sys.stdout, sys.stderr, sys.argv = saved
        sys.path[:] = saved_path
        os.chdir("/home/pyodide")
        # 清掉這次匯入的使用者模組，下次執行重新載入
        for name in set(sys.modules) - before:
            mod = sys.modules.get(name)
            f = getattr(mod, "__file__", None) or ""
            if f.startswith(PROJECT_ROOT) or name == "__main__":
                sys.modules.pop(name, None)
    return [code, message]
