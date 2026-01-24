import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

let cachedVersion: string | null = null;

export function getVersion(): string {
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  // First try to get version from git tags (get the latest tag)
  try {
    const allTags = execSync('git tag', { encoding: 'utf-8' }).trim().split('\n');
    const versionTags = allTags.filter(tag => tag.startsWith('v')).sort((a, b) => {
      const aVersion = a.substring(1).split('.').map(Number);
      const bVersion = b.substring(1).split('.').map(Number);
      for (let i = 0; i < Math.max(aVersion.length, bVersion.length); i++) {
        const aNum = aVersion[i] || 0;
        const bNum = bVersion[i] || 0;
        if (aNum !== bNum) return bNum - aNum; // Sort descending
      }
      return 0;
    });
    if (versionTags.length > 0) {
      cachedVersion = versionTags[0].substring(1); // Remove 'v' prefix
      return cachedVersion;
    }
  } catch {
    // Git command failed, fall back to package.json
  }

  // Fall back to package.json
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    cachedVersion = packageJson.version || 'unknown';
    return cachedVersion as string;
  } catch {
    cachedVersion = 'unknown';
    return cachedVersion as string;
  }
}