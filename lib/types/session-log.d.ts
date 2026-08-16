/**
 * Minimal DeepSeek Harness session-log decoder for doctor checks.
 *
 * The on-disk `session.jsonl.zstd` is a concatenated-Zstandard container of
 * JSONL lines (and packed "chunk rows"). This module mirrors the reference
 * frame-scan algorithm (see zoahdev/dsh-replay engine/replay.js) so the doctor
 * can detect broken tool-call sequences without depending on @deepseek-ai/dsh.
 * @module doctor/session-log
 */
export declare function decodeSession(file: string): {
    header: unknown;
    events: unknown[];
};
export interface BrokenToolCall {
    callId: string;
    turn: number;
    step: number;
}
/**
 * Find tool calls that were declared but never received a paired result —
 * the #2334 "insufficient tool messages following tool_calls" class.
 */
export declare function findBrokenToolCalls(events: unknown[]): BrokenToolCall[];
