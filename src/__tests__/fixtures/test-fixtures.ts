/**
 * Test Fixture Inventory
 * Centralized paths for all test fixtures to ensure consistency
 */

import { fileURLToPath } from 'url';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base directories
export const FIXTURES_ROOT = __dirname;
export const SERVERS_DIR = path.join(FIXTURES_ROOT, 'servers');
export const PROJECT_ROOT = path.join(FIXTURES_ROOT, '..', '..', '..');
export const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

// Main proxy executable
export const PROXY_PATH = path.join(DIST_DIR, 'index.js');

// Test server paths
export const TEST_SERVERS = {
  ALL_CONTENT_TYPES: path.join(SERVERS_DIR, 'all-content-types-server.js'),
  CRASH_AFTER_INIT: path.join(SERVERS_DIR, 'crash-after-init-server.js'),
  EXIT_IMMEDIATELY: path.join(SERVERS_DIR, 'exit-immediately-server.js'),
  REAL_MCP: path.join(SERVERS_DIR, 'real-mcp-server.js'),
  SIGNAL_TEST: path.join(SERVERS_DIR, 'signal-test-server.js'),
  SIMPLE_ECHO: path.join(SERVERS_DIR, 'simple-echo-server.js'),
  STDIN_TEST: path.join(SERVERS_DIR, 'stdin-test-server.js'),
  VERSIONED_TEST: path.join(SERVERS_DIR, 'versioned-test-server.js'),
} as const;

// Test file paths
export const TEST_FILES = {
  TEST_FILE_TS: path.join(FIXTURES_ROOT, 'test-file.ts'),
} as const;

// Helper to get paths relative to test file location
export function getPathsRelativeToTest(testFileDir: string) {
  return {
    PROXY_PATH: path.relative(testFileDir, PROXY_PATH),
    PROJECT_ROOT: path.relative(testFileDir, PROJECT_ROOT),
    TEST_SERVERS: Object.fromEntries(
      Object.entries(TEST_SERVERS).map(([key, serverPath]) => [
        key,
        path.relative(testFileDir, serverPath)
      ])
    ),
    TEST_FILES: Object.fromEntries(
      Object.entries(TEST_FILES).map(([key, filePath]) => [
        key,
        path.relative(testFileDir, filePath)
      ])
    )
  };
}

// Export everything as default for convenient access
export default {
  FIXTURES_ROOT,
  SERVERS_DIR,
  PROJECT_ROOT,
  DIST_DIR,
  PROXY_PATH,
  TEST_SERVERS,
  TEST_FILES,
  getPathsRelativeToTest
};