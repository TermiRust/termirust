/** Stand-in for `Channel` from @tauri-apps/api/core; tests push messages via `emit`. */
export class FakeChannel<T> {
  static created: FakeChannel<unknown>[] = [];
  onmessage: (message: T) => void = () => {};

  constructor() {
    FakeChannel.created.push(this as FakeChannel<unknown>);
  }

  emit(message: T) {
    this.onmessage(message);
  }
}
