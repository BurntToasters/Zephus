import { describe, expect, it } from "vitest";
import { parseZephusJsonAttr } from "../editorParse";
import { encodeDataPayload } from "../../shared/renderHelpers";

const RECORDS: Record<string, string>[] = [
  {
    text: "it's fine",
    href: "/docs?query=one%20two&mode=read",
    unicode: "Café — 日本語 — 🚀",
    braces: "{literal} [value] <tag>",
  },
  {
    empty: "",
    quotes: "single ' and double \" quotes",
    lines: "one\ntwo\nthree",
    percent: "%7Bencoded%7D",
  },
];

describe("data-zephus JSON payload round trips", () => {
  it.each(RECORDS)("inverts URI encoding for %#", (record) => {
    const encoded = encodeDataPayload(record);
    expect(parseZephusJsonAttr<Record<string, string>>(encoded)).toEqual(
      record,
    );
  });

  it("strips prototype-pollution keys after decoding", () => {
    const input = JSON.parse(
      '{"safe":"ok","__proto__":{"polluted":true},"constructor":"bad","prototype":"bad"}',
    ) as Record<string, unknown>;
    const decoded = parseZephusJsonAttr<Record<string, unknown>>(
      encodeDataPayload(input),
    );

    expect(decoded).toEqual({ safe: "ok" });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
