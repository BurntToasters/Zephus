import { render } from "solid-js/web";

export function HelpModalContent() {
  return (
    <div class="help-modal-content">
      <div class="help-section">
        <h4>Visual Mode Keyboard Shortcuts</h4>
        <table class="help-table">
          <tbody>
            <tr>
              <td>
                <kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd>
              </td>
              <td>Save Changes</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd>
              </td>
              <td>Undo Last Visual Change</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> /{" "}
                <kbd>Y</kbd>
              </td>
              <td>Redo Last Visual Change</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl/Cmd</kbd> + <kbd>D</kbd>
              </td>
              <td>Duplicate Selected Block or Section</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl/Cmd</kbd> + <kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd>
              </td>
              <td>Copy, Cut, or Paste Selected Block/Section</td>
            </tr>
            <tr>
              <td>
                <kbd>Delete</kbd> / <kbd>Backspace</kbd>
              </td>
              <td>Delete Selected Block/Section</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="help-section" style={{ "margin-top": "16px" }}>
        <h4>Code Mode Shortcuts</h4>
        <table class="help-table">
          <tbody>
            <tr>
              <td>
                <kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd>
              </td>
              <td>Undo in the code editor</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> /{" "}
                <kbd>Y</kbd>
              </td>
              <td>Redo in the code editor</td>
            </tr>
            <tr>
              <td>
                <kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd>
              </td>
              <td>Save Changes</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="help-section" style={{ "margin-top": "16px" }}>
        <h4>Useful Tips</h4>
        <ul>
          <li>
            <strong>Double-click</strong> text blocks on the canvas to edit
            inline (HTML blocks use the Inspector markup field).
          </li>
          <li>Drag blocks inside a section or columns to reorder.</li>
          <li>
            Select blocks to edit properties in the Inspector sidebar on the
            right.
          </li>
          <li>
            Detached pages can be reattached from the editor warning banner or
            Page Settings.
          </li>
          <li>
            Press <kbd>?</kbd> or <kbd>H</kbd> on the dashboard or editor canvas
            to view this help guide.
          </li>
        </ul>
      </div>
    </div>
  );
}

export function renderHelpModal(container: HTMLElement): void {
  render(() => <HelpModalContent />, container);
}
