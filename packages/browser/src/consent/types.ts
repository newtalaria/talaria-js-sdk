/** Banner report for analytics, heatmaps, and session replay. Errors are not gated. */
export type MeasurementSignal = 'granted' | 'denied' | 'pending';

export type MeasurementReporter = (signal: MeasurementSignal) => void;
