import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

let cachedVersion: string | null = null;

export function getVersion(): string {
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  // First try to get version from git tags
  try {
    const gitVersion = execSync('git describe --tags --abbrev=0 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (gitVersion && gitVersion.startsWith('v')) {
      cachedVersion = gitVersion.substring(1); // Remove 'v' prefix
      return cachedVersion;
    }
  } catch (error) {
    // Git command failed, fall back to package.json
  }

  // Fall back to package.json
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    cachedVersion = packageJson.version || 'unknown';
    return cachedVersion as string;
  } catch (error) {
    console.warn('Failed to read version from package.json:', error);
    cachedVersion = 'unknown';
    return cachedVersion as string;
  }
}