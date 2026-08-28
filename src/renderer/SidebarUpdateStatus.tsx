import { render } from "solid-js/web";
import { createSignal } from "solid-js";

export interface SidebarUpdateStatusData {
  clickable: boolean;
  dotTone: "default" | "active" | "error";
  label: string;
  emphasized?: boolean;
}

export interface SidebarUpdateStatusHandlers {
  onClick: () => void;
}

const [status, setStatus] = createSignal<SidebarUpdateStatusData>({
  clickable: false,
  dotTone: "default",
  label: "Up to date",
});
let handlers: SidebarUpdateStatusHandlers | null = null;

export function SidebarUpdateStatusPanel() {
  const current = () => status();
  return (
    <button
      type="button"
      classList={{
        "update-status-pill": true,
        clickable: current().clickable,
      }}
      disabled={!current().clickable}
      onClick={() => handlers?.onClick()}
    >
      <div
        classList={{
          "update-status-dot": true,
          active: current().dotTone === "active",
          error: current().dotTone === "error",
        }}
      ></div>
      <span
        style={
          current().emphasized
            ? { color: "#ffffff", "font-weight": "bold" }
            : undefined
        }
      >
        {current().label}
      </span>
    </button>
  );
}

export function updateSidebarUpdateStatus(
  nextStatus: SidebarUpdateStatusData,
): void {
  setStatus(nextStatus);
}

export function registerSidebarUpdateStatusHandlers(
  nextHandlers: SidebarUpdateStatusHandlers,
): void {
  handlers = nextHandlers;
}

export function mountSidebarUpdateStatus(container: HTMLElement): void {
  container.innerHTML = "";
  render(() => <SidebarUpdateStatusPanel />, container);
}
