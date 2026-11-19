const log = {
  info(...args) {
    console.error("[info]", ...args);
  },
  warn(...args) {
    console.error("[warn]", ...args);
  },
  error(...args) {
    console.error("[error]", ...args);
  },
  debug(...args) {
    console.error("[debug]", ...args);
  },
  transports: {
    file: {
      level: "info",
    },
  },
  initialize() {},
};

module.exports = log;
module.exports.default = log;
