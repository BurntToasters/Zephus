/** Points the editor skip link at the surface the user can actually edit. */

export function syncEditorSkipLink(
  root: ParentNode,
  mode: "visual" | "code",
): void {
  const link = root.querySelector<HTMLAnchorElement>("#view-editor .skip-link");
  if (!link) return;
  const code = mode === "code";
  link.setAttribute("href", code ? "#code-editor" : "#canvas");
  link.textContent = code ? "Skip to code" : "Skip to canvas";
}
