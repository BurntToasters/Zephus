import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";

const spawnMock = vi.hoisted(() => vi.fn());
const buildSpawnEnvMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({ spawn: spawnMock }));
vi.mock("../nodeCheck", () => ({
  buildSpawnEnv: buildSpawnEnvMock,
}));

import { startDevServer, stopDevServer, onDevServerExit } from "../devServer";

let tmpDir: string;
let projectDir: string;

function makeProject(withDev = true, withDeps = true): void {
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({
      scripts: withDev ? { dev: "astro dev" } : {},
    }),
  );
  if (withDeps) {
    fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
  }
}

/** A fake child process that emits 'exit' when killed. */
function fakeChild(): EventEmitter & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    child.emit("exit", 0);
    return true;
  });
  return child;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-devserver-"));
  projectDir = path.join(tmpDir, "project");
  spawnMock.mockReset();
  buildSpawnEnvMock.mockReset();
  buildSpawnEnvMock.mockResolvedValue({ PATH: "/usr/bin" });
  stopDevServer();
});

afterEach(() => {
  stopDevServer();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("startDevServer", () => {
  it("rejects an invalid project path", async () => {
    const result = await startDevServer("", () => undefined);
    expect(result.ok).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects projects without a dev script or dependencies", async () => {
    makeProject(false, false);
    const noDev = await startDevServer(projectDir, () => undefined);
    expect(noDev.ok).toBe(false);
    expect(noDev.error).toContain("dev");

    makeProject(true, false);
    const noDeps = await startDevServer(projectDir, () => undefined);
    expect(noDeps.ok).toBe(false);
    expect(noDeps.error).toContain("not installed");
  });

  it("starts the dev server and resolves with the reported URL", async () => {
    makeProject();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const promise = startDevServer(projectDir, () => undefined);
    // Wait for the async spawn path to wire the child, then chunk the URL
    // across two data events.
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.stdout.emit("data", Buffer.from("  Local: http://localhost:43"));
    child.stdout.emit("data", Buffer.from("21/\n"));

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.url).toBe("http://localhost:4321/");
    expect(spawnMock).toHaveBeenCalledWith(
      "npm",
      ["run", "dev"],
      expect.objectContaining({ cwd: projectDir }),
    );
  });

  it("reuses a running server for the same project", async () => {
    makeProject();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const first = startDevServer(projectDir, () => undefined);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.stdout.emit("data", Buffer.from("Local: http://localhost:4321/\n"));
    await first;

    const second = await startDevServer(projectDir, () => undefined);
    expect(second.ok).toBe(true);
    expect(second.alreadyRunning).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("times out when no URL is reported", async () => {
    vi.useFakeTimers();
    try {
      makeProject();
      spawnMock.mockReturnValue(fakeChild());
      const promise = startDevServer(projectDir, () => undefined);
      await vi.advanceTimersByTimeAsync(61_000);
      const result = await promise;
      expect(result.ok).toBe(false);
      // The timeout kills the child, so either the timeout or the exit
      // handler settles the promise — both are failures.
      expect(
        result.error?.includes("did not report a URL") ||
          result.error?.includes("exited before serving"),
      ).toBe(true);
      // The lock must be released after a timeout.
      makeProject();
      spawnMock.mockReturnValue(fakeChild());
      void startDevServer(projectDir, () => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(spawnMock).toHaveBeenCalledTimes(2);
      stopDevServer();
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifies exit listeners when the server dies after starting", async () => {
    makeProject();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const exited = vi.fn();
    const unsub = onDevServerExit(exited);

    const promise = startDevServer(projectDir, () => undefined);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.stdout.emit("data", Buffer.from("Local: http://localhost:4321/\n"));
    await promise;

    child.kill(); // emits 'exit'
    await new Promise((r) => setTimeout(r, 0));
    expect(exited).toHaveBeenCalled();
    unsub();
  });
});
