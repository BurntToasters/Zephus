const { EventEmitter } = require("node:events");

class CancellationToken {
  constructor() {
    this.cancelled = false;
  }
  cancel() {
    this.cancelled = true;
  }
}

class AutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = false;
    this.autoInstallOnAppQuit = false;
    this.allowDowngrade = false;
    this.channel = "latest";
    this.logger = null;
  }

  checkForUpdates() {
    return Promise.resolve(null);
  }

  downloadUpdate() {
    return Promise.resolve([]);
  }

  quitAndInstall() {}
}

const autoUpdater = new AutoUpdater();

module.exports = { autoUpdater, CancellationToken };
