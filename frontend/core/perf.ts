/**
 * Performance Instrumentation for NativeGameLink
 * Namespace: [NGL][Perf]
 */

const PERF_PREFIX = '[NGL][Perf]';
let perfEnabled = true;

export function setPerfLogging(enabled: boolean): void {
	perfEnabled = enabled;
}

export function perfMark(name: string): void {
	try {
		if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
			performance.clearMarks(`ngl:${name}`);
			performance.mark(`ngl:${name}`);
		}
	} catch {}
}

export function perfMeasure(metricName: string, startMark?: string): number {
	try {
		if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
			const start = startMark ? `ngl:${startMark}` : undefined;
			const measureName = `ngl:${metricName}`;
			const entry = performance.measure(measureName, start);
			const duration = entry ? entry.duration : 0;
			performance.clearMeasures(measureName);
			if (perfEnabled && duration >= 0.05) {
				console.log(`${PERF_PREFIX} ${metricName}: ${duration.toFixed(2)}ms`);
			}
			return duration;
		}
	} catch {}
	return 0;
}

export function perfLog(metricName: string, durationMs: number): void {
	if (perfEnabled && durationMs >= 0.05) {
		console.log(`${PERF_PREFIX} ${metricName}: ${durationMs.toFixed(2)}ms`);
	}
}

export function perfTime<T>(metricName: string, operation: () => T): T {
	const start = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
	try {
		const result = operation();
		if (result && typeof (result as any).then === 'function') {
			return (result as Promise<unknown>).then(value => {
				const duration = (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - start;
				perfLog(metricName, duration);
				return value;
			}) as unknown as T;
		}
		const duration = (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - start;
		perfLog(metricName, duration);
		return result;
	} catch (error) {
		const duration = (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - start;
		perfLog(`${metricName} (failed)`, duration);
		throw error;
	}
}
