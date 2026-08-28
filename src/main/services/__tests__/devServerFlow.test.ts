import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import type { Mock } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const buildSpawnEnvMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock,
}));
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
  kill: Mock<() => boolean>;
} {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: Mock<() => boolean>;
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
    // The spawn env must carry the resolved Node dir on PATH plus the
    // no-color flags — deleting that wiring would break Node resolution and
    // ANSI-free logs, and this assertion is the only thing that notices.
    expect(spawnMock).toHaveBeenCalledWith(
      "npm",
      ["run", "dev"],
      expect.objectContaining({
        cwd: projectDir,
        env: expect.objectContaining({
          PATH: "/usr/bin",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
        }),
      }),
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

  it("stop falls back to child.kill when the process group cannot be signalled", async () => {
    makeProject();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const exited = vi.fn();
    const unsub = onDevServerExit(exited);

    const promise = startDevServer(projectDir, () => undefined);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.stdout.emit("data", Buffer.from("Local: http://localhost:4321/\n"));
    await promise;

    // A fake pid has no process group: process.kill(-pid) throws ESRCH and
    // the implementation must fall back to signalling the child directly.
    stopDevServer();
    await new Promise((r) => setTimeout(r, 0));
    expect(child.kill).toHaveBeenCalled();
    expect(exited).toHaveBeenCalled();
    unsub();
  });

  it("escalates to SIGKILL when the group survives SIGTERM", async () => {
    vi.useFakeTimers();
    try {
      makeProject();
      const child = fakeChild();
      // Keep the group "alive" through SIGTERM so the escalation fires.
      const killSpy = vi.spyOn(process, "kill").mockReturnValue(true as never);
      child.kill = vi.fn(() => true);
      spawnMock.mockReturnValue(child);
      const exited = vi.fn();
      const unsub = onDevServerExit(exited);

      const promise = startDevServer(projectDir, () => undefined);
      await vi.advanceTimersByTimeAsync(0);
      child.stdout.emit("data", Buffer.from("Local: http://localhost:4321/\n"));
      await promise;

      stopDevServer();
      await vi.advanceTimersByTimeAsync(5000);
      // SIGTERM for the group, then a SIGKILL escalation after the grace.
      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
      killSpy.mockRestore();
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a second start while the first is still starting", async () => {
    makeProject();
    spawnMock.mockReturnValue(fakeChild());
    const first = startDevServer(projectDir, () => undefined);
    const second = await startDevServer(projectDir, () => undefined);
    expect(second.ok).toBe(false);
    expect(second.error).toContain("already starting");
    stopDevServer();
    await first.catch(() => undefined);
  });

  it("stops a server for a different project before starting a new one", async () => {
    makeProject();
    const other = path.join(tmpDir, "other-project");
    fs.mkdirSync(other, { recursive: true });
    fs.mkdirSync(path.join(other, "node_modules"), { recursive: true });
    fs.writeFileSync(
      path.join(other, "package.json"),
      JSON.stringify({
        scripts: { dev: "astro dev" },
        dependencies: { astro: "^6.0.0" },
      }),
    );
    const childA = fakeChild();
    const childB = fakeChild();
    spawnMock.mockReturnValueOnce(childA).mockReturnValueOnce(childB);
    const exited = vi.fn();
    const unsub = onDevServerExit(exited);

    const first = startDevServer(projectDir, () => undefined);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    childA.stdout.emit("data", Buffer.from("Local: http://localhost:4321/\n"));
    await first;

    const secondPromise = startDevServer(other, () => undefined);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2));
    childB.stdout.emit("data", Buffer.from("Local: http://localhost:5000/\n"));
    const second = await secondPromise;
    expect(second.ok).toBe(true);

    // Starting the second stopped the first (exit fired).
    await new Promise((r) => setTimeout(r, 0));
    expect(exited).toHaveBeenCalled();
    unsub();
    stopDevServer();
  });

  it("treats an unreadable package.json as missing dev script", async () => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "package.json"), "{ broken");
    const result = await startDevServer(projectDir, () => undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dev");
  });

  it("onDevServerExit unsubscribes the listener", async () => {
    makeProject();
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const exited = vi.fn();
    const unsub = onDevServerExit(exited);
    unsub();

    const promise = startDevServer(projectDir, () => undefined);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.stdout.emit("data", Buffer.from("Local: http://localhost:4321/\n"));
    await promise;
    child.kill();
    await new Promise((r) => setTimeout(r, 0));
    expect(exited).not.toHaveBeenCalled();
    stopDevServer();
  });

  it("taskkillProcessTree force-kills a process tree", async () => {
    const { taskkillProcessTree } = await import("../devServer");
    spawnMock.mockClear();
    taskkillProcessTree(4242);
    expect(spawnMock).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "4242", "/t", "/f"],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("reports a synchronous spawn failure cleanly", async () => {
    makeProject();
    spawnMock.mockImplementation(() => {
      throw new Error("spawn EACCES");
    });
    const result = await startDevServer(projectDir, () => undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("spawn EACCES");
  });
});
