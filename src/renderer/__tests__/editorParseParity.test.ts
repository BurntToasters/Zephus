// @vitest-environment jsdom
/**
 * Parser parity: the main-process regex parser (schema.ts) and the renderer's
 * DOM parser (editorParse.ts) must produce the SAME section/block tree from
 * the same managed page source. Divergence here means a Code→Visual→Save
 * cycle corrupts content (the tree is re-serialized from whichever parser ran).
 */
import { describe, it, expect } from "vitest";
import { parseSectionsFromSource } from "../../main/services/schema";
import { createEditorPageParser } from "../editorParse";
import { splitManagedPageSource } from "../editorSerialize";
import { KNOWN_BLOCK_TYPES } from "../editorBlocks";
import type { SectionNode } from "../../main/types";

let uidCounter = 0;
const parser = createEditorPageParser({
  uid: () => `gen-${++uidCounter}`,
  createFallbackSection: (): SectionNode => ({
    id: `gen-${++uidCounter}`,
    type: "section",
    label: "Main Content",
    props: { wrapper: "none", cls: "" },
    children: [],
  }),
  knownBlockTypes: KNOWN_BLOCK_TYPES,
});

/** Normalizes random/generated ids so both trees compare positionally. */
function normalizeTree<T>(node: T, path = ""): unknown {
  if (Array.isArray(node))
    return node.map((item, i) => normalizeTree(item, `${path}[${i}]`));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (key === "id") {
        out[key] = `id@${path}`;
      } else if (key === "raw") {
        // The DOM parser re-serializes unknown markup lowercased; the regex
        // parser preserves source case. Tag case is insignificant (parsing is
        // case-insensitive), so compare case-insensitively.
        out[key] = String(value).toLowerCase();
      } else {
        out[key] = normalizeTree(value, `${path}.${key}`);
      }
    }
    return out;
  }
  return node;
}

function parseBoth(source: string): { main: unknown; renderer: unknown } {
  const main = normalizeTree(parseSectionsFromSource(source));
  const { inner } = splitManagedPageSource(source);
  const renderer = normalizeTree(parser.parseSections(inner));
  return { main, renderer };
}

function expectParity(source: string): void {
  const { main, renderer } = parseBoth(source);
  expect(renderer).toEqual(main);
}

const FRONTMATTER = `---
import BaseLayout from '../layouts/BaseLayout.astro';
// zephus:managed schema=.zephus/pages/index.json
---
`;

const WRAP = (body: string): string =>
  `${FRONTMATTER}
<BaseLayout title="Home">
${body}
</BaseLayout>
`;

describe("parser parity (schema regex parser vs renderer DOM parser)", () => {
  it("parses managed Zephus output identically", () => {
    expectParity(
      WRAP(`<h2 data-zephus-id="h1" data-zephus-block="heading" data-zephus-props="%7B%22text%22%3A%22Hello%20%26%20%3Cworld%3E%22%2C%22level%22%3A%222%22%2C%22cls%22%3A%22%22%7D">Hello &amp; &lt;world&gt;</h2>
<p data-zephus-id="t1" data-zephus-block="text" data-zephus-props="%7B%22text%22%3A%22Line%20one%5CnLine%20two%22%2C%22cls%22%3A%22%22%7D">Line one<br />Line two</p>
<a data-zephus-id="b1" data-zephus-block="button" data-zephus-props="%7B%22text%22%3A%22Go%22%2C%22href%22%3A%22%2Fcontact%22%2C%22cls%22%3A%22%22%7D" href="/contact">Go</a>`),
    );
  });

  it("parses entities identically (named, numeric, double-encoded)", () => {
    expectParity(
      WRAP(
        `<p>© 2024 — Café &amp; more &#169; &#x1F600; &amp;copy; literal</p>`,
      ),
    );
  });

  it("parses full HTML5 entity semantics identically", () => {
    // Beyond the 5 core entities: the main parser must use the same decoder
    // as parse5 (legacy no-semicolon references, maximal-name matching,
    // numeric refs without semicolons, U+FFFD for invalid code points).
    // Regressions: &eacute; stayed literal, &amp (no semi) and &#65 stayed
    // undecoded, &notit; stayed literal — all caused hash mismatches and
    // double-escaped rewrites of hand-authored pages.
    expectParity(
      WRAP(
        `<p>&eacute;t&eacute; &#x1F600; &#65 Tom &amp Jerry &copycat &Amp; &#xD800; &#0; &notit; &not= &AMP;</p>`,
      ),
    );
  });

  it("preserves <br> as line breaks in text", () => {
    expectParity(WRAP(`<p>first<br>second<br />third</p>`));
  });

  it("keeps every paragraph of a blockquote", () => {
    expectParity(
      WRAP(
        `<blockquote><p>First paragraph</p><p>Second paragraph</p><cite>Author</cite></blockquote>`,
      ),
    );
  });

  it("preserves top-level HTML comments verbatim", () => {
    expectParity(
      WRAP(
        `<!-- keep me -->\n<p>text</p>\n<!--[if IE]>conditional<![endif]-->`,
      ),
    );
  });

  it("treats legacy <section> wrappers as editable sections", () => {
    expectParity(
      WRAP(`<section class="band"><h2>Title</h2><p>Body</p></section>`),
    );
  });

  it("handles self-closing tags inside prose identically", () => {
    // A top-level bare `<div/>` is a known lossless-normalization difference
    // (the DOM opens it and rewraps siblings); inside prose text both parsers
    // strip the tag and keep the text.
    expectParity(WRAP(`<p>before <span/> after<br/>end</p>`));
  });

  it("reads attributes with > inside quotes and decodes entities", () => {
    expectParity(
      WRAP(`<p data-x="a>b" style="width:50%">T&amp;T</p>
<img src="/assets/a%26b.png" alt="A &amp; B" />`),
    );
  });

  it("preserves stored data-zephus ids", () => {
    const { main, renderer } = parseBoth(
      WRAP(
        `<h2 data-zephus-id="my-heading" data-zephus-block="heading" data-zephus-props="%7B%22text%22%3A%22Hi%22%2C%22level%22%3A%222%22%2C%22cls%22%3A%22%22%7D">Hi</h2>`,
      ),
    );
    // The stored id must survive in BOTH parsers (anchors responsive CSS).
    const findId = (tree: unknown): string | null => {
      const visit = (value: unknown): string | null => {
        if (Array.isArray(value)) {
          for (const item of value) {
            const found = visit(item);
            if (found) return found;
          }
          return null;
        }
        if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          if (record["type"] === "heading") return record["id"] as string;
          for (const item of Object.values(record)) {
            const found = visit(item);
            if (found) return found;
          }
        }
        return null;
      };
      return visit(tree);
    };
    expect(findId(main)).toBe(findId(renderer));
  });

  it("keeps literal angle brackets in text", () => {
    expectParity(WRAP(`<p>Price 2 < 3 and 5 > 4</p>`));
  });

  it("drops top-level <style> in both parsers", () => {
    expectParity(WRAP(`<style>.hero{color:red}</style>\n<h2>Title</h2>`));
  });

  it("parses a full multi-block managed page identically", () => {
    expectParity(
      WRAP(`<h1 data-zephus-id="s" data-zephus-block="heading" data-zephus-props="%7B%22text%22%3A%22Head%22%2C%22level%22%3A%221%22%2C%22cls%22%3A%22%22%7D">Head</h1>
<ul data-zephus-id="l1" data-zephus-block="list" data-zephus-props="%7B%22items%22%3A%22One%5CnTwo%22%2C%22ordered%22%3A%22false%22%2C%22cls%22%3A%22%22%7D"><li>One</li><li>Two</li></ul>
<div data-zephus-id="c1" data-zephus-block="columns" data-zephus-props="%7B%22col1%22%3A%22A%22%2C%22col2%22%3A%22B%22%2C%22count%22%3A%222%22%2C%22cls%22%3A%22%22%7D"><section><div class="zephus-column">A</div><div class="zephus-column">B</div></section></div>
<img data-zephus-id="i1" data-zephus-block="image" data-zephus-props="%7B%22src%22%3A%22%2Fassets%2Fimages%2Fx.svg%22%2C%22alt%22%3A%22X%22%2C%22cls%22%3A%22%22%7D" src="/assets/images/x.svg" alt="X" />
<video data-zephus-id="v1" data-zephus-block="video" data-zephus-props="%7B%22src%22%3A%22https%3A%2F%2Fexample.com%2Fm.mp4%22%2C%22title%22%3A%22V%22%2C%22cls%22%3A%22%22%7D" controls preload="metadata" src="https://example.com/m.mp4" title="V"></video>`),
    );
  });

  it("round-trips unknown markup as raw html blocks", () => {
    expectParity(
      WRAP(`<div class="custom"><span style="color:red">styled</span></div>
<p>after</p>`),
    );
  });

  it("keeps hand-authored content after the layout close tag", () => {
    // Regression: the main-process parser used to slice up to the last
    // </BaseLayout> and silently DROP trailing content (false hash mismatch,
    // data loss on regeneration). Both parsers must keep the full body.
    expectParity(
      `${FRONTMATTER}
<BaseLayout>
  <p>inside</p>
</BaseLayout>
<p>hand-authored trailing</p>
`,
    );
    expectParity(
      `${FRONTMATTER}
<BaseLayout>
  <p>inside</p>
</BaseLayout>
<section class="handmade"><p>more</p></section>
`,
    );
  });

  it("matches mixed-case layout close tags in both parsers", () => {
    expectParity(`${FRONTMATTER}
<BaseLayout>
  <p>inside</p>
</baseLayout>
`);
  });

  it("does not lose content when the layout close tag is missing", () => {
    // The DOM parser re-serializes the unclosed element with an implicit
    // closing tag; the regex parser keeps the source verbatim. The content
    // itself must survive in both.
    const { main, renderer } = parseBoth(`${FRONTMATTER}
<BaseLayout>
  <p>inside</p>
`);
    expect(JSON.stringify(main)).toContain("<p>inside</p>");
    expect(JSON.stringify(renderer)).toContain("<p>inside</p>");
  });

  it("keeps a literal </BaseLayout> inside an html block as content", () => {
    expectParity(
      WRAP(`<div>the text &lt;/BaseLayout&gt; appears literally</div>
<p>rest</p>`),
    );
  });

  it("parses multi-line tags as single blocks in both parsers", () => {
    // Regression: the regex tag matcher excluded "\n", so a hand-formatted
    // multi-line opening tag was split into "<", "div\nclass=…", "</div>"
    // fragments. Both parsers must now keep it as one html block (the DOM
    // normalizes tag-internal whitespace, which the raw comparison ignores).
    const { main, renderer } = parseBoth(
      WRAP(`<div
  class="band"
  data-x="a > b">
  <p>inside</p>
</div>
<p>after</p>`),
    );
    const shape = (tree: unknown): unknown =>
      (tree as Array<{ children: Array<{ type: string }> }>).map((s) => ({
        children: s.children.map((b) => b.type),
      }));
    expect(shape(renderer)).toEqual(shape(main));
  });
});
