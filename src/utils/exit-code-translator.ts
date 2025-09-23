/**
 * Translates process exit codes and signals into human-readable error messages.
 * Used for providing helpful error messages when the MCP server process crashes.
 *
 * @param code - The exit code (if any)
 * @param signal - The signal that terminated the process (if any)
 * @returns A human-readable description of why the process exited
 */
export function translateExitCondition(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) {
    const signalDescriptions: Partial<Record<NodeJS.Signals, string>> = {
      SIGHUP: 'Hangup detected on controlling terminal',
      SIGINT: 'Interrupt from keyboard (Ctrl+C)',
      SIGQUIT: 'Quit from keyboard',
      SIGILL: 'Illegal instruction',
      SIGTRAP: 'Trace/breakpoint trap',
      SIGABRT: 'Abort signal',
      SIGBUS: 'Bus error - invalid memory access',
      SIGFPE: 'Floating-point exception',
      SIGKILL: 'Killed forcefully - cannot be caught or ignored',
      SIGUSR1: 'User-defined signal 1',
      SIGSEGV: 'Segmentation fault - memory access violation',
      SIGUSR2: 'User-defined signal 2',
      SIGPIPE: 'Broken pipe - write to pipe with no readers',
      SIGALRM: 'Timer alarm signal',
      SIGTERM: 'Termination signal - graceful shutdown requested',
      SIGCHLD: 'Child process terminated',
      SIGCONT: 'Continue if stopped',
      SIGSTOP: 'Stop process - cannot be caught or ignored',
      SIGTSTP: 'Terminal stop signal',
      SIGTTIN: 'Background process attempting to read',
      SIGTTOU: 'Background process attempting to write',
      SIGURG: 'Urgent condition on socket',
      SIGXCPU: 'CPU time limit exceeded',
      SIGXFSZ: 'File size limit exceeded',
      SIGVTALRM: 'Virtual timer alarm',
      SIGPROF: 'Profiling timer expired',
      SIGWINCH: 'Window resize signal',
      SIGIO: 'I/O now possible',
      SIGPWR: 'Power failure',
      SIGSYS: 'Bad system call'
    };

    const description = signalDescriptions[signal] || 'Unknown signal';
    return `killed by signal ${signal} (${description})`;
  }

  if (code !== null) {
    const codeDescriptions: Record<number, string> = {
      0: 'successful exit',
      1: 'general error - check server logs',
      2: 'misuse of shell command',
      126: 'command cannot be executed - permission problem or not executable',
      127: 'command not found',
      128: 'invalid argument to exit',
      130: 'terminated by Ctrl+C (SIGINT)',
      137: 'killed (often out of memory)',
      139: 'segmentation fault',
      143: 'terminated by SIGTERM'
    };

    const description = codeDescriptions[code] || 'unknown error';
    return `exit code ${code} (${description})`;
  }

  return 'unknown termination reason';
}