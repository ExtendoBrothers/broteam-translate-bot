#!/usr/bin/env node

'use strict';

function parseVersion(version) {
  const [major, minor, patch] = version.split('.').map((part) => Number(part));
  return { major: major || 0, minor: minor || 0, patch: patch || 0 };
}

function isAtLeast(current, target) {
  if (current.major !== target.major) {
    return current.major > target.major;
  }

  if (current.minor !== target.minor) {
    return current.minor > target.minor;
  }

  return current.patch >= target.patch;
}

function isSupportedForEslint10(version) {
  const v = parseVersion(version);
  return (
    isAtLeast(v, { major: 24, minor: 0, patch: 0 }) ||
    isAtLeast(v, { major: 22, minor: 13, patch: 0 }) ||
    isAtLeast(v, { major: 20, minor: 19, patch: 0 })
  );
}

const nodeVersion = process.versions.node;

if (!isSupportedForEslint10(nodeVersion)) {
  console.error(
    [
      'Node ' + nodeVersion + ' is not supported by ESLint 10.',
      'Use one of: >=20.19.0, >=22.13.0, or >=24.0.0.',
      'You can still build/run the bot on older Node if needed, but lint requires a newer Node runtime.'
    ].join('\n')
  );
  process.exit(1);
}
