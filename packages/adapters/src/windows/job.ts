import koffi from "koffi";
import { AppError } from "../../../contracts/src/error";

function bindings() {
  const kernel = koffi.load("kernel32.dll");
  return {
    create: kernel.func("void * __stdcall CreateJobObjectW(void *, void *)"),
    set: kernel.func(
      "int __stdcall SetInformationJobObject(void *, int, void *, uint32_t)",
    ),
    open: kernel.func("void * __stdcall OpenProcess(uint32_t, int, uint32_t)"),
    assign: kernel.func(
      "int __stdcall AssignProcessToJobObject(void *, void *)",
    ),
    terminate: kernel.func(
      "int __stdcall TerminateJobObject(void *, uint32_t)",
    ),
    query: kernel.func(
      "int __stdcall QueryInformationJobObject(void *, int, _Out_ void *, uint32_t, void *)",
    ),
    close: kernel.func("int __stdcall CloseHandle(void *)"),
    error: kernel.func("uint32_t __stdcall GetLastError()"),
  };
}
export class WindowsJob {
  private readonly api: ReturnType<typeof bindings>;
  private handle: unknown;
  private closing: Promise<void> | null = null;
  constructor() {
    if (process.platform !== "win32" || process.arch !== "x64")
      throw new AppError(
        "UNSUPPORTED_PLATFORM",
        "当前进程所有权实现要求 Windows x64",
      );
    this.api = bindings();
    this.handle = this.api.create(null, null);
    if (!this.handle) throw this.failure("CreateJobObjectW");
    // Windows x64 JOBOBJECT_EXTENDED_LIMIT_INFORMATION: 144 bytes; LimitFlags at offset 16.
    const limits = Buffer.alloc(144);
    limits.writeUInt32LE(0x2000, 16); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!this.api.set(this.handle, 9, limits, limits.length)) {
      const error = this.failure("SetInformationJobObject");
      this.api.close(this.handle);
      this.handle = null;
      throw error;
    }
  }
  private failure(operation: string): AppError {
    return new AppError(
      "PROCESS_OWNERSHIP_FAILED",
      `${operation} 失败（Win32 ${this.api.error()}），禁止启动新的分析进程`,
      "process",
      false,
      "检查系统进程策略，确认遗留进程结束后重新启动应用",
    );
  }
  assign(pid: number): void {
    if (
      !this.handle ||
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      pid === process.pid
    )
      throw new AppError("INVALID_PROCESS", "进程所有权参数无效");
    const processHandle = this.api.open(0x0100 | 0x0001, 0, pid); // PROCESS_SET_QUOTA | PROCESS_TERMINATE
    if (!processHandle) throw this.failure("OpenProcess");
    try {
      if (!this.api.assign(this.handle, processHandle))
        throw this.failure("AssignProcessToJobObject");
    } finally {
      this.api.close(processHandle);
    }
  }
  async terminateAndClose(): Promise<void> {
    if (!this.handle) return;
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (!this.api.terminate(this.handle, 1))
        throw this.failure("TerminateJobObject");
      const deadline = Date.now() + 10000;
      while (true) {
        // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION is 48 bytes; ActiveProcesses at offset 40.
        const accounting = Buffer.alloc(48);
        if (
          !this.api.query(this.handle, 1, accounting, accounting.length, null)
        )
          throw this.failure("QueryInformationJobObject");
        if (accounting.readUInt32LE(40) === 0) break;
        if (Date.now() > deadline)
          throw new AppError(
            "PROCESS_STOP_UNCONFIRMED",
            "旧后台服务的进程尚未全部退出，禁止恢复队列",
            "process",
          );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!this.api.close(this.handle)) throw this.failure("CloseHandle");
      this.handle = null;
    })();
    return this.closing;
  }
}
