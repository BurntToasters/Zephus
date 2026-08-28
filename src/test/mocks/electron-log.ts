const logFn = Object.assign(() => undefined, {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
  silly: () => undefined,
  log: () => undefined,
  transports: { file: { level: "info" }, console: { level: "info" } },
});

export default logFn;
