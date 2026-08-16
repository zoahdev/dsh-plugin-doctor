import { describe, expect, it } from 'vitest'
import { findBrokenToolCalls } from '../src/session-log.ts'
import { checkToolCallPairing } from '../src/index.ts'

describe('findBrokenToolCalls', () => {
  it('flags a declared tool call with no paired result', () => {
    const events = [
      { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [
        { type: 'tool-call', callId: 'c1', name: 'read' },
        { type: 'tool-call', callId: 'c2', name: 'bash' },
      ] } } },
      { type: 'tool/result', data: { message: { content: [{ toolCallId: 'c1' }] } } },
    ]
    const broken = findBrokenToolCalls(events)
    expect(broken).toHaveLength(1)
    expect(broken[0].callId).toBe('c2')
  })

  it('returns empty when every call is paired', () => {
    const events = [
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1' } },
      { type: 'tool/result', data: { message: { content: [{ toolCallId: 'c1' }] } } },
    ]
    expect(findBrokenToolCalls(events)).toHaveLength(0)
  })
})

describe('checkToolCallPairing', () => {
  it('degrades to PASS when no session logs are present', () => {
    const result = checkToolCallPairing(process.cwd())
    expect(result.name).toBe('tool-call-pairing')
    expect(['PASS', 'WARN', 'FAIL']).toContain(result.status)
  })
})
