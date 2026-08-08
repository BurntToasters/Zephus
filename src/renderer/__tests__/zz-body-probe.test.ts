// @vitest-environment jsdom
import { it } from "vitest";
import { splitManagedPageSource } from "../editorSerialize";
import { extractManagedInner } from "../../main/services/schema";

it("probe body split parity", () => {
  // A `<body`-looking string inside a later script must not shift the split.
  const src = `<html>
<body class="real">
  <h1>Title</h1>
  <script>const x = "<body class='fake'>";</script>
</body>
</html>`;
  const main = extractManagedInner(src);
  const ren = splitManagedPageSource(src).inner;
  console.log("main:", JSON.stringify(main));
  console.log("ren :", JSON.stringify(ren));
  console.log("parity:", main === ren);
});
