"""Process-group and Windows Job lifecycle helpers for sealed release commands."""
import os
import signal
import subprocess
import time


class WindowsJob:
    def __init__(self):
        import ctypes
        from ctypes import wintypes

        self.ctypes = ctypes
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        self.kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]

        class Limits(ctypes.Structure):
            _fields_ = [
                ("processTime", ctypes.c_int64),
                ("jobTime", ctypes.c_int64),
                ("flags", wintypes.DWORD),
                ("minimum", ctypes.c_size_t),
                ("maximum", ctypes.c_size_t),
                ("activeLimit", wintypes.DWORD),
                ("affinity", ctypes.c_size_t),
                ("priority", wintypes.DWORD),
                ("scheduling", wintypes.DWORD),
            ]

        class Extended(ctypes.Structure):
            _fields_ = [
                ("basic", Limits),
                ("io", ctypes.c_uint64 * 6),
                ("processMemory", ctypes.c_size_t),
                ("jobMemory", ctypes.c_size_t),
                ("peakProcessMemory", ctypes.c_size_t),
                ("peakJobMemory", ctypes.c_size_t),
            ]

        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise OSError()
        limits = Extended()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.kernel.CloseHandle(self.handle)
            raise OSError()

    def admit(self, child):
        # The child was created suspended: it cannot spawn outside this Job before admission.
        if not self.kernel.AssignProcessToJobObject(self.handle, int(child._handle)):
            child.kill()
            child.wait(timeout=3)
            raise OSError()
        ntdll = self.ctypes.WinDLL("ntdll")
        ntdll.NtResumeProcess.argtypes = [self.ctypes.c_void_p]
        ntdll.NtResumeProcess.restype = self.ctypes.c_long
        if ntdll.NtResumeProcess(int(child._handle)) != 0:
            raise OSError()

    def _active_processes(self, accounting_type):
        accounting = accounting_type()
        ok = self.kernel.QueryInformationJobObject(
            self.handle, 1, self.ctypes.byref(accounting), self.ctypes.sizeof(accounting), None
        )
        if not ok:
            raise OSError()
        return accounting.active

    def close(self):
        if not self.handle:
            return

        class Accounting(self.ctypes.Structure):
            _fields_ = [
                ("times", self.ctypes.c_int64 * 4),
                ("faults", self.ctypes.c_uint32),
                ("total", self.ctypes.c_uint32),
                ("active", self.ctypes.c_uint32),
                ("terminated", self.ctypes.c_uint32),
            ]

        try:
            if not self.kernel.TerminateJobObject(self.handle, 1):
                raise OSError()
            deadline = time.monotonic() + 5
            while self._active_processes(Accounting) != 0:
                if time.monotonic() >= deadline:
                    raise TimeoutError()
                time.sleep(0.05)
        finally:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def _group_gone(pgid):
    try:
        os.killpg(pgid, 0)
        return False
    except ProcessLookupError:
        return True


def _send_group_signal(pgid, sig):
    try:
        os.killpg(pgid, sig)
        return True
    except ProcessLookupError:
        return False


def _wait_after_term(pgid):
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline:
        if _group_gone(pgid):
            return True
        time.sleep(0.05)
    return False


def _eperm_group_exited(pgid):
    # Darwin can return EPERM while a killed group is exiting. Inspect OS
    # states; an executing process still fails closed, and E/Z is polled.
    snapshot = subprocess.run(["ps", "-axo", "pgid=,stat="], capture_output=True, text=True, timeout=3)
    if snapshot.returncode != 0:
        raise OSError()
    target = str(pgid)
    states = [fields[1] for line in snapshot.stdout.splitlines() for fields in [line.split()] if len(fields) == 2 and fields[0] == target]
    if not states:
        return True
    if any(not state.startswith(("E", "Z")) for state in states):
        raise PermissionError()
    return False


def _probe_killed_group(pgid):
    try:
        os.killpg(pgid, 0)
        return False
    except ProcessLookupError:
        return True
    except PermissionError:
        return _eperm_group_exited(pgid)


def kill_owned(child, job):
    if job is not None:
        job.close()
        child.wait(timeout=3)
        return
    # Group liveness is independent of the leader: the shell may already have exited.
    if not _send_group_signal(child.pid, signal.SIGTERM) or _wait_after_term(child.pid):
        child.wait(timeout=3)
        return
    # Always send KILL to the remaining group, even when child.wait() would succeed.
    _send_group_signal(child.pid, signal.SIGKILL)
    child.wait(timeout=3)
    deadline = time.monotonic() + 5
    while not _probe_killed_group(child.pid):
        if time.monotonic() >= deadline:
            raise TimeoutError()
        time.sleep(0.05)
