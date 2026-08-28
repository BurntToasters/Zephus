import { describe, it, expect } from "vitest";
import { DevServerUrlScanner } from "../devServer";

describe("DevServerUrlScanner", () => {
  it("finds a URL in a single chunk", () => {
    const scanner = new DevServerUrlScanner();
    expect(
      scanner.push("  VITE ready in 500ms\n  Local: http://localhost:4321/\n"),
    ).toBe("http://localhost:4321/");
  });

  it("finds a URL split across chunk boundaries", () => {
    const scanner = new DevServerUrlScanner();
    expect(scanner.push("  Local: http://localhost:43")).toBeNull();
    expect(scanner.push("21/\n  Network: use --host")).toBe(
      "http://localhost:4321/",
    );
  });

  it("survives ANSI sequences split across chunks", () => {
    const scanner = new DevServerUrlScanner();
    expect(scanner.push("  Local: \u001b[32mhttp://localhost:4321")).toBeNull();
    expect(scanner.push("\u001b[39m\n")).toBe("http://localhost:4321");
  });

  it("does not swallow trailing punctuation", () => {
    const scanner = new DevServerUrlScanner();
    expect(scanner.push("(http://127.0.0.1:4321).")).toBe(
      "http://127.0.0.1:4321",
    );
  });

  it("ignores non-local hosts", () => {
    const scanner = new DevServerUrlScanner();
    expect(scanner.push("http://192.168.1.5:4321")).toBeNull();
  });

  it("ignores noise until a URL appears", () => {
    const scanner = new DevServerUrlScanner();
    expect(scanner.push("building...")).toBeNull();
    expect(scanner.push("  Local: http://[::1]:4321/")).toBe(
      "http://[::1]:4321/",
    );
  });
});
