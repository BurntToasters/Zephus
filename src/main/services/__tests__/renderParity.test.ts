import { describe, it, expect } from "vitest";
import { renderBlockNode } from "../schema";
import { blockRenderFixture, BLOCK_RENDER_FIXTURES } from "../../../shared/blockRenderFixtures";

/**
 * Golden snapshot of the build-side block renderer (`renderBlockHtml` in
 * src/shared/blockRender.ts, re-exported as schema.ts `renderBlockNode`).
 * This is the canonical markup the editor must emit for serialization
 * (forCanvas: false). If a block's output changes here, update blockRender.ts.
 *
 * Block ids are fixed so the snapshots are deterministic.
 */
describe("build render parity (renderBlockNode goldens)", () => {
  it("covers every block fixture without throwing", () => {
    for (const block of BLOCK_RENDER_FIXTURES) {
      expect(typeof renderBlockNode(block)).toBe("string");
    }
  });

  it.each(BLOCK_RENDER_FIXTURES.map((b, i) => [`${b.type}-${i}`, b] as const))(
    "renders %s to stable markup",
    (_label, block) => {
      expect(renderBlockNode(block)).toMatchSnapshot();
    },
  );

  it("never emits a javascript: URL", () => {
    const danger = "java" + "script:alert(1)";
    const out = renderBlockNode(
      blockRenderFixture("button", { text: "x", href: danger, cls: "" }),
    );
    expect(out).not.toMatch(/javascript:/i);
  });
});
