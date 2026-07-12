/**
 * Image bytes → base64 for `VisionRequest.images` (no data-URL prefix).
 * The one helper every engine call site uses — pages and crops live in
 * IndexedDB and are encoded per call, never held decoded across steps.
 */

/** btoa takes a binary string; build it in chunks to avoid arg-limit blowups. */
const CHUNK_BYTES = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + CHUNK_BYTES)
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(await blobToBytes(blob))
}
