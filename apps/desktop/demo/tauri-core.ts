// Demo stand-in for @tauri-apps/api/core: channels are plain objects the fake backend calls.
export class Channel<T> {
  onmessage: (message: T) => void = () => {};
}
export async function invoke(): Promise<never> {
  throw new Error("no backend in the demo");
}
