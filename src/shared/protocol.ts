/** The contract between the panel and the worker, shared by both sides. */

export const SEND_TEXT_REQUEST = 'terminal.send'

export type SendTextInput = { terminalId: string; text: string; enter: boolean }
export type SendTextOutput = { accepted: boolean }
