import { render } from "solid-js/web";
import { createSignal } from "solid-js";

function SolidApp() {
  const [count, setCount] = createSignal(0);

  return (
    <div
      style={{
        padding: "16px",
        background: "var(--panel-card)",
        border: "1px solid var(--border)",
        "border-radius": "var(--radius-md)",
        color: "var(--text)",
        "font-family": "var(--font-sans)",
        "margin-top": "16px",
        "box-shadow": "var(--shadow-sm)",
      }}
    >
      <h4
        style={{
          margin: "0 0 8px 0",
          color: "#8da2ff",
          "font-size": "13px",
          "text-transform": "uppercase",
          "letter-spacing": "0.05em",
        }}
      >
        SolidJS Integration Active
      </h4>
      <p style={{ margin: "0 0 12px 0", "font-size": "12px", opacity: 0.8 }}>
        This is a live reactive SolidJS component mounted inside the vanilla
        editor layout.
      </p>
      <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
        <button
          onClick={() => setCount(count() + 1)}
          style={{
            background: "linear-gradient(135deg, #4f46e5, #6366f1)",
            border: "none",
            color: "#ffffff",
            padding: "6px 12px",
            "border-radius": "var(--radius-sm)",
            cursor: "pointer",
            "font-size": "12px",
            "font-weight": "600",
            transition: "all 0.15s ease",
          }}
          class="solid-btn"
        >
          Clicks: {count()}
        </button>
        <span
          style={{
            "font-size": "12px",
            "font-family": "var(--font-mono)",
            opacity: 0.6,
          }}
        >
          State is completely reactive!
        </span>
      </div>
    </div>
  );
}

export function mountSolidApp(container: HTMLElement): void {
  render(() => <SolidApp />, container);
}
