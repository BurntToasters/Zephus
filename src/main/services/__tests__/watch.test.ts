import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  watchFile,
  stopWatching,
  markSelfWritten,
  watchedFileMatches,
} from "../watch";

let tmpDir: string;
let project: string;
const pageRel = "src/pages/index.astro";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-watch-"));
  project = path.join(tmpDir, "site");
  fs.mkdirSync(path.join(project, "src", "pages"), { recursive: true });
  fs.writeFileSync(path.join(project, pageRel), "<h1>v1</h1>");
});

afterEach(() => {
  stopWatching();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function waitFor(onChange: () => boolean, ms = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (onChange()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        reject(new Error("timed out waiting for the watcher"));
      }
    }, 20);
  });
}

describe("watchFile", () => {
  it("fires for an external edit of the watched file", async () => {
    let fired = false;
    watchFile(project, pageRel, () => {
      fired = true;
    });
    // Let the directory watch register before the write: FSEvents can miss a
    // change made in the same tick as fs.watch().
    await new Promise((r) => setTimeout(r, 50));
    fs.writeFileSync(path.join(project, pageRel), "<h1>external</h1>");
    await waitFor(() => fired);
    expect(fired).toBe(true);
  });

  it("suppresses events for files the app itself wrote", async () => {
    let fired = false;
    watchFile(project, pageRel, () => {
      fired = true;
    });
    // Let the directory watch register before the write (FSEvents can miss a
    // change made in the same tick as fs.watch()).
    await new Promise((r) => setTimeout(r, 50));
    // The schema write path marks the file as self-written before writing.
    markSelfWritten(pageRel);
    fs.writeFileSync(path.join(project, pageRel), "<h1>self write</h1>");
    // Give the watcher time to (not) fire; the debounce is 150ms.
    await new Promise((r) => setTimeout(r, 500));
    expect(fired).toBe(false);
  });

  it("fires again after the self-write suppression window", async () => {
    let fires = 0;
    watchFile(project, pageRel, () => {
      fires += 1;
    });
    await new Promise((r) => setTimeout(r, 50));
    markSelfWritten(pageRel);
    fs.writeFileSync(path.join(project, pageRel), "<h1>self</h1>");
    // Implementation clears the duplicate-event marker only after >500ms;
    // waiting exactly 500ms races the millisecond clock under CI load.
    await new Promise((r) => setTimeout(r, 650));
    expect(fires).toBe(0);

    // A genuinely external edit afterwards still fires.
    fs.writeFileSync(path.join(project, pageRel), "<h1>external2</h1>");
    await waitFor(() => fires > 0);
    expect(fires).toBeGreaterThan(0);
  });

  it("does not retain a self-write marker for another file", async () => {
    let fired = false;
    watchFile(project, pageRel, () => {
      fired = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    markSelfWritten("src/pages/about.astro");
    fs.writeFileSync(path.join(project, pageRel), "<h1>external</h1>");
    await waitFor(() => fired);
    expect(fired).toBe(true);
  });

  it("matches only the watched file from event filenames", () => {
    const full = path.join(project, "src", "pages", "index.astro");
    const base = "index.astro";
    expect(watchedFileMatches(base, base, full)).toBe(true);
    expect(watchedFileMatches(full, base, full)).toBe(true);
    expect(watchedFileMatches(null, base, full)).toBe(true);
    expect(watchedFileMatches("other.astro", base, full)).toBe(false);
    expect(watchedFileMatches("layouts/BaseLayout.astro", base, full)).toBe(
      false,
    );
  });
});

describe("self-write suppression semantics", () => {
  it("suppresses a burst then lets external edits through", async () => {
    let fires = 0;
    watchFile(project, pageRel, () => {
      fires += 1;
    });
    await new Promise((r) => setTimeout(r, 50));
    markSelfWritten(pageRel);
    fs.writeFileSync(path.join(project, pageRel), "<h1>burst1</h1>");
    fs.writeFileSync(path.join(project, pageRel), "<h1>burst2</h1>");
    await new Promise((r) => setTimeout(r, 400));
    expect(fires).toBe(0);

    // Let the 500ms burst window lapse before the external edit.
    await new Promise((r) => setTimeout(r, 500));

    // A genuine external edit after the burst window fires.
    fs.writeFileSync(path.join(project, pageRel), "<h1>external</h1>");
    await waitFor(() => fires > 0);
    expect(fires).toBeGreaterThan(0);
  }, 15000);
});

describe("stopWatching", () => {
  it("stops delivering events after stop", async () => {
    let fires = 0;
    watchFile(project, pageRel, () => {
      fires += 1;
    });
    await new Promise((r) => setTimeout(r, 50));
    stopWatching();
    fs.writeFileSync(path.join(project, pageRel), "<h1>after-stop</h1>");
    await new Promise((r) => setTimeout(r, 400));
    expect(fires).toBe(0);
  });
});
