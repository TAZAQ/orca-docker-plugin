import { StringDecoder } from 'node:string_decoder'

/** Turns the bytes of Docker's /logs stream into text for the panel. */

const HEADER_BYTES = 8
// Colors and cursor moves mean nothing in the panel's plain text.
const ANSI_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/**
 * Without a TTY Docker wraps output into frames: stream type, three zero bytes, then the payload
 * size as a big-endian 32-bit integer. With a TTY the stream is the raw output. A chunk may end
 * anywhere, in the middle of a frame or of a UTF-8 character.
 */
export class LogDecoder {
  private readonly text = new StringDecoder('utf8')
  private pending: Buffer = Buffer.alloc(0)

  constructor(private readonly tty: boolean) {}

  push(chunk: Buffer): string {
    const decoded = this.tty ? this.text.write(chunk) : this.unframe(chunk)
    return decoded.replace(ANSI_SEQUENCE, '')
  }

  private unframe(chunk: Buffer): string {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    let output = ''
    let offset = 0
    while (this.pending.length - offset >= HEADER_BYTES) {
      const size = this.pending.readUInt32BE(offset + 4)
      const end = offset + HEADER_BYTES + size
      if (end > this.pending.length) {
        break
      }
      output += this.text.write(this.pending.subarray(offset + HEADER_BYTES, end))
      offset = end
    }
    this.pending = this.pending.subarray(offset)
    return output
  }
}
