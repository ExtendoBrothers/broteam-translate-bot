// scripts/processQueue.ts
// Script to process the tweet queue immediately

import { translateAndPostWorker } from '../src/workers/translateAndPostWorker';

(async () => {
  console.log('Manually triggering queue processing...');
  await translateAndPostWorker();
  console.log('Queue processing complete.');
})();
