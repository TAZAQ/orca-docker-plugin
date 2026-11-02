import { describe, expect, it } from 'vitest'
import { LogDecoder } from '../src/worker/log-decoder'

function frame(text: string, stream = 1): Buffer {
  const payload = Buffer.from(text)
  const header = Buffer.alloc(8)
  header[0] = stream
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

describe('LogDecoder', () => {
  it('unwraps stdout and stderr frames in order', () => {
    const decoder = new LogDecoder(false)
    expect(decoder.push(Buffer.concat([frame('out\n', 1), frame('err\n', 2)]))).toBe('out\nerr\n')
  })

  it('survives a chunk ending anywhere, one byte at a time', () => {
    const decoder = new LogDecoder(false)
    const bytes = Buffer.concat([frame('привет\n'), frame('мир\n')])
    let text = ''
    for (const byte of bytes) {
      text += decoder.push(Buffer.from([byte]))
    }
    expect(text).toBe('привет\nмир\n')
  })

  it('passes a TTY stream through, keeping characters split across chunks', () => {
    const decoder = new LogDecoder(true)
    const bytes = Buffer.from('я\n')
    expect(decoder.push(bytes.subarray(0, 1)) + decoder.push(bytes.subarray(1))).toBe('я\n')
  })

  it('removes terminal colors', () => {
    expect(new LogDecoder(true).push(Buffer.from('\x1b[32mok\x1b[0m\n'))).toBe('ok\n')
  })
})
