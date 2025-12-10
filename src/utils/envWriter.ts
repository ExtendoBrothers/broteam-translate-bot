import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const ENV_PATH = path.join(process.cwd(), '.env');

export function setEnvVar(key: string, value: string) {
  try {
    let content = '';
    if (fs.existsSync(ENV_PATH)) {
      content = fs.readFileSync(ENV_PATH, 'utf-8');
    }
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
    if (pattern.test(content)) {
      content = content.replace(pattern, line);
    } else {
      if (content.length && !content.endsWith('\n')) content += '\n';
      content += line + '\n';
    }
    fs.writeFileSync(ENV_PATH, content, 'utf-8');
    logger.info(`Persisted ${key} in .env`);
  } catch (e) {
    logger.error(`Failed to persist ${key} to .env: ${e}`);
  }
}
