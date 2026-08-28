import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/** The IPC bridge is hand-synced across three files: channel names (src/main/ipcChannels.ts), the preload surface… */

function channelsFromIpcFile(): string[] {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "ipcChannels.ts"),
    "utf8",
  );
  return [...source.matchAll(/^\s{2}([a-zA-Z][\w]*):\s*"/gm)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

function channelNamesFromSource(source: string): string[] {
  return [...source.matchAll(/IPC\.([a-zA-Z][\w]*)/g)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined);
}

describe("IPC bridge sync", () => {
  it("every declared channel is handled or sent in the main process", () => {
    // Handlers live in ipc.ts; send-only channels (preview events, updater
    // status, reload requests) are used in main.ts — either side counts.
    const handlers = fs.readFileSync(
      path.join(__dirname, "..", "ipc.ts"),
      "utf8",
    );
    const mainSource = fs.readFileSync(
      path.join(__dirname, "..", "main.ts"),
      "utf8",
    );
    const updaterSource = fs.readFileSync(
      path.join(__dirname, "..", "updater.ts"),
      "utf8",
    );
    const registered = new Set([
      ...channelNamesFromSource(handlers),
      ...channelNamesFromSource(mainSource),
      ...channelNamesFromSource(updaterSource),
    ]);
    const missing = channelsFromIpcFile().filter(
      (name) => !registered.has(name),
    );
    expect(missing).toEqual([]);
  });

  it("every declared channel is used by the preload bridge", () => {
    const preload = fs.readFileSync(
      path.join(__dirname, "..", "preload.ts"),
      "utf8",
    );
    const used = new Set(channelNamesFromSource(preload));
    const missing = channelsFromIpcFile().filter((name) => !used.has(name));
    expect(missing).toEqual([]);
  });

  it("every channel used by the renderer typing is bridged in preload", () => {
    const preload = fs.readFileSync(
      path.join(__dirname, "..", "preload.ts"),
      "utf8",
    );
    const dts = fs.readFileSync(
      path.join(__dirname, "..", "..", "renderer", "zephus.d.ts"),
      "utf8",
    );
    const preloadUsed = new Set(channelNamesFromSource(preload));
    const dtsUsed = new Set(channelNamesFromSource(dts));
    const missing = [...dtsUsed].filter((name) => !preloadUsed.has(name));
    expect(missing).toEqual([]);
  });

  it("every channel used by the renderer engine is declared", () => {
    const engine = fs.readFileSync(
      path.join(__dirname, "..", "..", "renderer", "zephusEngine.ts"),
      "utf8",
    );
    const engineRefs = [
      ...engine.matchAll(/window\.zephus\.([a-zA-Z][\w]*)/g),
    ].map((m) => m[1]);
    const dts = fs.readFileSync(
      path.join(__dirname, "..", "..", "renderer", "zephus.d.ts"),
      "utf8",
    );
    const declared = new Set(
      [...dts.matchAll(/^\s{2}([a-zA-Z][\w]*)[(;]/gm)].map((m) => m[1]),
    );
    const missing = [...new Set(engineRefs)].filter(
      (name) => !declared.has(name),
    );
    expect(missing).toEqual([]);
  });
});
