const { execSync } = require('child_process');

function getVersion() {
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
      return versionTags[0].substring(1); // Remove 'v' prefix
    }
  } catch (error) {
    // Fall back to package.json if it exists
    try {
      const packageJson = require('../package.json');
      return packageJson.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

module.exports = { getVersion };