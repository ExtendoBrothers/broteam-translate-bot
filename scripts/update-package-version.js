import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function updatePackageVersion() {
  try {
    // Get all tags and find the latest version
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
      const latestVersion = versionTags[0].substring(1); // Remove 'v' prefix

      // Read package.json
      const packagePath = path.join(__dirname, '..', 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

      // Update version
      packageJson.version = latestVersion;

      // Write back to package.json
      fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');

      console.log(`Updated package.json version to ${latestVersion}`);
      return latestVersion;
    }
  } catch (error) {
    console.error('Failed to update package.json version:', error.message);
  }
  return null;
}

// Export for use in other scripts
export { updatePackageVersion };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updatePackageVersion();
}