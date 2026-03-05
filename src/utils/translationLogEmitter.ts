/**
 * Translation Log Emitter
 *
 * Simple EventEmitter singleton used to pipe real-time translation-step
 * log lines from candidateGenerator → dashboardServer SSE endpoint.
 *
 * No file I/O involved — purely in-process, zero latency.
 */

import { EventEmitter } from 'events';

export const translationLogEmitter = new EventEmitter();

// Allow many concurrent dashboard tabs without warnings
translationLogEmitter.setMaxListeners(100);

/**
 * Emit a single log line to all SSE subscribers.
 * Call this wherever a translation step should be surfaced.
 */
export function emitLogLine(line: string): void {
  translationLogEmitter.emit('line', line.trimEnd());
}
