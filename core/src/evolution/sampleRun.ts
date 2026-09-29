export const SAMPLE_CHUNK_SIZE = 20;
/** Public recordings have no owner, credentials, or capability to resume the engine. */
export interface SampleRun {
  id: string;
  title: string;
  recorded_at: string;
  frames: number;
  interval_ms: number;
  duration_seconds: number;
  notes: string;
}

export const SAMPLE_WRITE_ERROR =
  'This is a recorded sample. Add your API key to run your own simulation.';
export function assertSampleCommand(action: string) {
  if (['start', 'reset', 'drought', 'map'].includes(action)) throw new Error(SAMPLE_WRITE_ERROR);
}
