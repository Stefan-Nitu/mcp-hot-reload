import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Create a temporary test directory in the system's temp folder.
 * This ensures tests don't pollute the project directory.
 *
 * @param prefix - Directory name prefix (e.g., 'mcp-proxy-test')
 * @returns Absolute path to the created directory
 */
export function createTestDirectory(prefix: string): string {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return testDir;
}

/**
 * Clean up a test directory created by createTestDirectory.
 * Safe to call even if directory doesn't exist.
 *
 * @param testDir - Path to the test directory to clean up
 */
export function cleanupTestDirectory(testDir: string | null | undefined): void {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Create a test directory structure with common subdirectories.
 * Useful for tests that need a standard project structure.
 *
 * @param prefix - Directory name prefix
 * @param subdirs - Optional array of subdirectory names to create
 * @returns Absolute path to the created directory
 */
export function createTestDirectoryWithStructure(
  prefix: string,
  subdirs: string[] = ['src']
): string {
  const testDir = createTestDirectory(prefix);

  for (const subdir of subdirs) {
    fs.mkdirSync(path.join(testDir, subdir), { recursive: true });
  }

  return testDir;
}