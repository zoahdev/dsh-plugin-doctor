/**
 * Minimal DeepSeek Harness session-log decoder for doctor checks.
 *
 * The on-disk `session.jsonl.zstd` is a concatenated-Zstandard container of
 * JSONL lines (and packed "chunk rows"). This module mirrors the reference
 * frame-scan algorithm (see zoahdev/dsh-replay engine/replay.js) so the doctor
 * can detect broken tool-call sequences without depending on @deepseek-ai/dsh.
 * @module doctor/session-log
 */
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
const ZSTD_MAGIC = 0xfd2fb528;
const ZSTD_FILE_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
function scanZstdFrames(buffer) {
    const frames = [];
    let offset = 0;
    while (offset < buffer.length) {
        const start = offset;
        if (buffer.length - offset < 4)
            return frames;
        if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC)
            return frames;
        offset += 4;
        const descriptor = buffer.readUInt8(offset++);
        if ((descriptor & 0x18) !== 0)
            return frames;
        const contentSizeFlag = descriptor >>> 6;
        const singleSegment = (descriptor & 0x20) !== 0;
        const checksum = (descriptor & 0x04) !== 0;
        const dictionaryFlag = descriptor & 0x03;
        const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
        const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
        const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
        if (buffer.length - offset < remainingHeaderBytes)
            return frames;
        offset += remainingHeaderBytes;
        for (;;) {
            if (buffer.length - offset < 3)
                return frames;
            const blockHeader = buffer.readUIntLE(offset, 3);
            offset += 3;
            const lastBlock = (blockHeader & 1) !== 0;
            const blockType = (blockHeader >>> 1) & 0x03;
            const blockSize = blockHeader >>> 3;
            if (blockType === 0x03)
                return frames;
            const payloadBytes = blockType === 0x01 ? 1 : blockSize;
            if (buffer.length - offset < payloadBytes)
                return frames;
            offset += payloadBytes;
            if (lastBlock)
                break;
        }
        if (checksum) {
            if (buffer.length - offset < 4)
                return frames;
            offset += 4;
        }
        frames.push({ start, end: offset });
    }
    return frames;
}
function decompressContainer(buffer) {
    let out = '';
    for (const frame of scanZstdFrames(buffer)) {
        out += zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8');
    }
    return out;
}
/** Expand a packed chunk row into its individual events (best effort). */
function expandStorageRecord(value) {
    if (value === null || typeof value !== 'object')
        return [value];
    const rec = value;
    const tag = rec.type;
    if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks')
        return [value];
    const d = (rec.data ?? {});
    const members = tag === 'tool-call-chunks' ? d.args : d.texts;
    if (!Array.isArray(members))
        return [value];
    const events = [];
    let time = rec.time0;
    const dt = d.dt ?? [];
    for (let k = 0; k < members.length; k++) {
        if (k > 0)
            time += dt[k - 1] ?? 0;
        const chunk = tag === 'tool-call-chunks'
            ? { type: 'tool-call-delta', index: d.index, id: d.id, argumentsDelta: members[k] }
            : { type: tag === 'text-chunks' ? 'text-delta' : 'reasoning-delta', index: d.index, text: members[k] };
        events.push({
            type: 'assistant/chunk',
            seq: rec.seq0 + k,
            time,
            data: { turn: d.turn, step: d.step, chunk },
        });
    }
    return events;
}
export function decodeSession(file) {
    const buffer = readFileSync(file);
    let plain;
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZSTD_FILE_MAGIC)) {
        plain = decompressContainer(buffer);
    }
    else {
        plain = buffer.toString('utf8');
    }
    const events = [];
    let header;
    for (const line of plain.split(/\r?\n/u)) {
        if (line.trim() === '')
            continue;
        let value;
        try {
            value = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (header === undefined && value?.type === 'session') {
            header = value;
            continue;
        }
        events.push(...expandStorageRecord(value));
    }
    return { header, events };
}
/**
 * Find tool calls that were declared but never received a paired result —
 * the #2334 "insufficient tool messages following tool_calls" class.
 */
export function findBrokenToolCalls(events) {
    const declared = new Map();
    const resolved = new Set();
    for (const event of events) {
        const data = (event.data ?? {});
        const type = event.type;
        if (type === 'assistant/message') {
            const message = data.message;
            for (const block of message?.content ?? []) {
                if (block?.type !== 'tool-call')
                    continue;
                const callId = (block.callId ?? block.id);
                if (callId && !declared.has(callId)) {
                    declared.set(callId, { callId, turn: data.turn ?? 0, step: data.step ?? 0 });
                }
            }
        }
        else if (type === 'tool/call') {
            const callId = data.callId;
            if (callId && !declared.has(callId)) {
                declared.set(callId, { callId, turn: data.turn ?? 0, step: data.step ?? 0 });
            }
        }
        else if (type === 'tool/result') {
            const content = data.message?.content;
            const first = content?.[0];
            const firstContent = first?.content;
            const callId = (first?.toolCallId ?? firstContent?.[0]?.toolCallId);
            if (callId)
                resolved.add(callId);
        }
    }
    return [...declared.values()].filter((c) => !resolved.has(c.callId));
}
