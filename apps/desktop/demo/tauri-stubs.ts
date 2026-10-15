// Demo stand-ins for the Tauri window/webview APIs and plugins used by the UI.
const noop = async () => {};
export const getCurrentWindow = () => ({ isMaximized: async () => false, onResized: async () => noop, minimize: noop, toggleMaximize: noop, close: noop });
export const getCurrentWebview = () => ({ onDragDropEvent: async () => noop });
export const openUrl = noop;
export const open = async () => null;
export const relaunch = noop;
export const check = async () => null;
