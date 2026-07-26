/**
 * Vitest stub so main-process modules can load without a downloaded Electron binary.
 * Real Electron is only required to run the app (`electron .`) and electron-builder.
 */

import * as os from "os";
import * as path from "path";

const testUserData = path.join(os.tmpdir(), "zephus-vitest-userdata");

function noop(): void {}

const app = {
  getPath: (name: string) => {
    if (name === "userData") return testUserData;
    if (name === "temp") return os.tmpdir();
    return path.join(testUserData, name);
  },
  getVersion: () => "0.0.0-vitest",
  getAppPath: () => process.cwd(),
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  on: noop,
  quit: noop,
  requestSingleInstanceLock: () => true,
};

export { app };
export const shell = {
  openPath: async () => "",
  openExternal: async () => undefined,
};
export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showMessageBox: async () => ({ response: 0 }),
};
export class BrowserWindow {
  webContents = { send: noop, on: noop };
  loadURL = noop;
  on = noop;
  static getAllWindows() {
    return [];
  }
}
export const ipcMain = { handle: noop, on: noop };
export const session = { defaultSession: { webRequest: { onHeadersReceived: noop } } };
export const contextBridge = { exposeInMainWorld: noop };
export const ipcRenderer = { invoke: async () => undefined, on: noop };
export const webUtils = { getPathForFile: () => "" };
