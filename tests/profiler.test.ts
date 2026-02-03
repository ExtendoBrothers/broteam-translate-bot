import { profiler } from '../src/utils/profiler';

describe('Performance Profiler', () => {
    beforeEach(() => {
        process.env.ENABLE_PERFORMANCE_METRICS = 'true';
        profiler.reset();
    });

    afterEach(() => {
        profiler.reset();
    });

    describe('Basic Timing', () => {
        it('should measure async function execution', async () => {
            const result = await profiler.measure('test-async', async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return 'success';
            });

            expect(result).toBe('success');
            
            const stats = profiler.getStats('test-async');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
            expect(stats!.averageDuration).toBeGreaterThanOrEqual(90);
            expect(stats!.averageDuration).toBeLessThan(150);
        });

        it('should measure sync function execution', () => {
            const result = profiler.measureSync('test-sync', () => {
                let sum = 0;
                for (let i = 0; i < 1000; i++) {
                    sum += i;
                }
                return sum;
            });

            expect(result).toBe(499500);
            
            const stats = profiler.getStats('test-sync');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
        });

        it('should handle start/end timing manually', async () => {
            profiler.start('manual-test');
            
            // Simulate async work with a small delay
            await new Promise(resolve => setTimeout(resolve, 5));
            
            const duration = profiler.end('manual-test');
            
            expect(duration).not.toBeNull();
            expect(duration!).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Statistics Calculation', () => {
        it('should calculate accurate statistics', async () => {
            // Run multiple measurements
            for (let i = 0; i < 10; i++) {
                await profiler.measure('multi-test', async () => {
                    await new Promise(resolve => setTimeout(resolve, 10 + i));
                });
            }

            const stats = profiler.getStats('multi-test');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(10);
            expect(stats!.averageDuration).toBeGreaterThan(10);
            expect(stats!.minDuration).toBeLessThan(stats!.maxDuration);
            expect(stats!.p50).toBeGreaterThan(0);
            expect(stats!.p95).toBeGreaterThan(stats!.p50);
            expect(stats!.p99).toBeGreaterThanOrEqual(stats!.p95);
        });

        it('should handle percentile calculation correctly', async () => {
            const delays = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
            
            for (const delay of delays) {
                await profiler.measure('percentile-test', async () => {
                    await new Promise(resolve => setTimeout(resolve, delay));
                });
            }

            const stats = profiler.getStats('percentile-test');
            expect(stats).not.toBeNull();
            // P50 should be around 50-55 (median of 10-100ms delays)
            expect(stats!.p50).toBeGreaterThanOrEqual(40);
            expect(stats!.p50).toBeLessThanOrEqual(75);
            // P95 should be around 95-100
            expect(stats!.p95).toBeGreaterThanOrEqual(85);
        });
    });

    describe('Multiple Metrics', () => {
        it('should track multiple different metrics', async () => {
            await profiler.measure('fetch', async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
            });

            await profiler.measure('translate', async () => {
                await new Promise(resolve => setTimeout(resolve, 30));
            });

            await profiler.measure('post', async () => {
                await new Promise(resolve => setTimeout(resolve, 40));
            });

            const allStats = profiler.getAllStats();
            expect(allStats.size).toBe(3);
            expect(allStats.has('fetch')).toBe(true);
            expect(allStats.has('translate')).toBe(true);
            expect(allStats.has('post')).toBe(true);
        });

        it('should aggregate metrics with same name', async () => {
            for (let i = 0; i < 5; i++) {
                await profiler.measure('repeated', async () => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                });
            }

            const stats = profiler.getStats('repeated');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(5);
        });
    });

    describe('Metadata Support', () => {
        it('should store metadata with metrics', async () => {
            await profiler.measure('with-metadata', async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
            }, { language: 'es', userId: '123' });

            const stats = profiler.getStats('with-metadata');
            expect(stats).not.toBeNull();
        });
    });

    describe('Error Handling', () => {
        it('should measure duration even when function throws', async () => {
            await expect(
                profiler.measure('error-test', async () => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                    throw new Error('Test error');
                })
            ).rejects.toThrow('Test error');

            const stats = profiler.getStats('error-test');
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(1);
        });

        it('should handle missing metrics gracefully', () => {
            const duration = profiler.end('non-existent');
            expect(duration).toBeNull();
        });
    });

    describe('Export and Reset', () => {
        it('should export metrics to JSON', async () => {
            await profiler.measure('export-test', async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
            });

            const json = profiler.exportMetrics();
            const data = JSON.parse(json);
            
            expect(data['export-test']).toBeDefined();
            expect(data['export-test'].count).toBe(1);
        });

        it('should reset all metrics', async () => {
            await profiler.measure('reset-test', async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
            });

            let stats = profiler.getStats('reset-test');
            expect(stats).not.toBeNull();

            profiler.reset();

            stats = profiler.getStats('reset-test');
            expect(stats).toBeNull();
        });
    });

    describe('Disabled Mode', () => {
        it('should not collect metrics when disabled', async () => {
            process.env.ENABLE_PERFORMANCE_METRICS = 'false';
            
            const newProfiler = new (profiler.constructor as any)();
            
            const result = await newProfiler.measure('disabled-test', async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'done';
            });

            expect(result).toBe('done');
            
            const stats = newProfiler.getStats('disabled-test');
            expect(stats).toBeNull();
        });
    });
});
