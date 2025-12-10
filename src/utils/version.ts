import * as fs from 'fs';
import * as path from 'path';

let cachedVersion: string | null = null;

export function getVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    cachedVersion = packageJson.version || 'unknown';
    return cachedVersion;
  } catch (error) {
    console.warn('Failed to read version from package.json:', error);
    cachedVersion = 'unknown';
    return cachedVersion;
  }
}