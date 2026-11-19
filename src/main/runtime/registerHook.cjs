const Module = require("module");
const path = require("path");

if (process.env.ZEPHUS_HOST !== "tauri") {
  return;
}

const runtimeDir = __dirname;
const redirects = {
  electron: path.join(runtimeDir, "electronShim.cjs"),
  "electron-log": path.join(runtimeDir, "logShim.cjs"),
  "electron-updater": path.join(runtimeDir, "updaterShim.cjs"),
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(
  request,
  parent,
  isMain,
  options,
) {
  if (Object.prototype.hasOwnProperty.call(redirects, request)) {
    return redirects[request];
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
