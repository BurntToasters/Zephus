import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  approveProjectRoot,
  approved,
  assertApprovedProject,
} from "../ipcApproval";

describe("IPC project approval gate", () => {
  it("rejects an unapproved project before invoking the handler", () => {
    const unapprovedPath = path.join(
      os.tmpdir(),
      `zephus-unapproved-${process.pid}-${Date.now()}`,
    );
    const handler = vi.fn(() => "should not run");

    expect(() => approved(unapprovedPath, handler)).toThrowError(
      "Unauthorized project path.",
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts an approved root through its canonical path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-approved-"));
    try {
      approveProjectRoot(root);
      const alias = path.join(root, "nested", "..");

      expect(() => assertApprovedProject(alias)).not.toThrow();
      expect(approved(alias, () => "allowed")).toBe("allowed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
