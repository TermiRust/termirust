/** Normalises a channel payload: raw channels deliver ArrayBuffer, JSON channels number[]. */
export function toBytes(payload: unknown): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (Array.isArray(payload)) return Uint8Array.from(payload as number[]);
  throw new TypeError(`unexpected terminal payload: ${Object.prototype.toString.call(payload)}`);
}
