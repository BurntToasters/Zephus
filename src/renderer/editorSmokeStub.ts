/** Production stub for the smoke harness: the real module is only bundled
 *  for smoke builds (bundle-renderer.js --smoke); packaged apps never load it. */
import type { EditorSmokeDeps } from "./editorSmoke";

export function installEditorSmokeHook(_deps: EditorSmokeDeps): void {}
