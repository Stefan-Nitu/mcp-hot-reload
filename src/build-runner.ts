import { execSync } from 'child_process';

export class BuildRunner {
  constructor(
    private command: string,
    private cwd: string,
    private timeoutMs: number = 60000
  ) {}

  run(): boolean {
    // Return true for empty or whitespace-only commands
    if (!this.command || !this.command.trim()) {
      return true;
    }

    try {
      execSync(this.command, {
        stdio: 'ignore',
        cwd: this.cwd,
        timeout: this.timeoutMs
      });
      return true;
    } catch {
      return false;
    }
  }
}