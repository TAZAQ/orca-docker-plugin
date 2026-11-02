/** Copies text; the frame may refuse the Clipboard API, and the old way still works then. */
export async function copyText(text: string, doc: Document = document): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const field = doc.createElement('textarea')
    field.value = text
    doc.body.append(field)
    field.select()
    const copied = doc.execCommand('copy')
    field.remove()
    return copied
  }
}
