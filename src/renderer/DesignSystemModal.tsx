import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";

interface FontOption {
  label: string;
  stack: string;
  google?: string;
}

const FONT_OPTIONS: FontOption[] = [
  { label: "System UI", stack: "system-ui, sans-serif" },
  {
    label: "Inter",
    stack: "'Inter', sans-serif",
    google: "Inter:wght@400;500;600;700",
  },
  {
    label: "Roboto",
    stack: "'Roboto', sans-serif",
    google: "Roboto:wght@400;500;700",
  },
  {
    label: "Open Sans",
    stack: "'Open Sans', sans-serif",
    google: "Open+Sans:wght@400;600;700",
  },
  { label: "Lato", stack: "'Lato', sans-serif", google: "Lato:wght@400;700" },
  {
    label: "Montserrat",
    stack: "'Montserrat', sans-serif",
    google: "Montserrat:wght@400;600;700",
  },
  {
    label: "Poppins",
    stack: "'Poppins', sans-serif",
    google: "Poppins:wght@400;500;600;700",
  },
  {
    label: "Playfair Display",
    stack: "'Playfair Display', serif",
    google: "Playfair+Display:wght@400;600;700",
  },
  {
    label: "Merriweather",
    stack: "'Merriweather', serif",
    google: "Merriweather:wght@400;700",
  },
  { label: "Georgia (serif)", stack: "Georgia, 'Times New Roman', serif" },
  { label: "Monospace", stack: "ui-monospace, 'SF Mono', Menlo, monospace" },
];

export function googleFontForStack(stack: string): string | null {
  return (
    FONT_OPTIONS.find((option) => option.stack === stack.trim())?.google ?? null
  );
}

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function expandHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return (
      "#" +
      v
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  }
  return v;
}

function ColorField(props: {
  label: string;
  value: string;
  textClass?: string;
  error?: string;
  errorClass?: string;
  onChange: (value: string) => void;
}) {
  const [textValue, setTextValue] = createSignal(props.value);
  const [swatchValue, setSwatchValue] = createSignal(
    isHexColor(props.value) ? expandHex(props.value) : "#000000",
  );

  return (
    <label class="meta-field">
      <span>{props.label}</span>
      <div class="color-control">
        <input
          type="color"
          class="color-swatch"
          value={swatchValue()}
          aria-label={`${props.label} color picker`}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setSwatchValue(value);
            setTextValue(value);
            props.onChange(value);
          }}
        />
        <input
          type="text"
          class={`text color-text${props.textClass ? ` ${props.textClass}` : ""}`}
          value={textValue()}
          placeholder="#3b82f6, rgb(), var(--accent)…"
          aria-label={props.label}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setTextValue(value);
            if (isHexColor(value)) setSwatchValue(expandHex(value));
            props.onChange(value);
          }}
        />
        <button
          type="button"
          class="color-clear"
          title="Clear color"
          aria-label="Clear color"
          onClick={() => {
            setTextValue("");
            props.onChange("");
          }}
        >
          X
        </button>
      </div>
      {props.error ? (
        <span
          class={`form-error ${props.errorClass ?? "design-accent-error"}`}
          role="alert"
        >
          {props.error}
        </span>
      ) : null}
    </label>
  );
}

function FontField(props: {
  label: string;
  value: string;
  customClass: string;
  error?: string;
  errorClass?: string;
  onChange: (stack: string, google: string | null) => void;
}) {
  const matchIndex = FONT_OPTIONS.findIndex(
    (option) => option.stack === props.value.trim(),
  );
  const [selected, setSelected] = createSignal(
    matchIndex >= 0 ? String(matchIndex) : props.value.trim() ? "custom" : "0",
  );
  const [customValue, setCustomValue] = createSignal(
    matchIndex >= 0 ? "" : props.value,
  );

  const currentStack = createMemo(() =>
    selected() === "custom"
      ? customValue().trim()
      : (FONT_OPTIONS[Number(selected())]?.stack ?? ""),
  );
  const currentGoogle = createMemo(() =>
    selected() === "custom"
      ? null
      : (FONT_OPTIONS[Number(selected())]?.google ?? null),
  );

  const emit = () => props.onChange(currentStack(), currentGoogle());

  return (
    <label class="meta-field">
      <span>{props.label}</span>
      <div class="font-control">
        <select
          class="text"
          value={selected()}
          onChange={(event) => {
            setSelected(event.currentTarget.value);
            emit();
          }}
        >
          {FONT_OPTIONS.map((option, index) => (
            <option value={String(index)}>{option.label}</option>
          ))}
          <option value="custom">Custom...</option>
        </select>
        {selected() === "custom" ? (
          <input
            class={`text font-custom ${props.customClass}`}
            placeholder="'Brand Sans', system-ui, sans-serif"
            value={customValue()}
            onInput={(event) => {
              setCustomValue(event.currentTarget.value);
              emit();
            }}
          />
        ) : null}
        <div
          class="font-preview"
          style={{ "font-family": currentStack() || "inherit" }}
        >
          The quick brown fox jumps over the lazy dog
        </div>
        {props.error ? (
          <span class={`form-error ${props.errorClass ?? ""}`} role="alert">
            {props.error}
          </span>
        ) : null}
      </div>
    </label>
  );
}

export interface DesignSystemModalState {
  accent: string;
  accentError?: string;
  background: string;
  foreground: string;
  surface: string;
  bodyFont: string;
  headingFont: string;
  radius: string;
  containerWidth: string;
  shadow: DesignTokenSet["shadow"];
  onAccentChange: (value: string) => void;
  onBackgroundChange: (value: string) => void;
  onForegroundChange: (value: string) => void;
  onSurfaceChange: (value: string) => void;
  onBodyFontChange: (stack: string, google: string | null) => void;
  onHeadingFontChange: (stack: string, google: string | null) => void;
  onRadiusChange: (value: string) => void;
  onContainerWidthChange: (value: string) => void;
  onShadowChange: (value: DesignTokenSet["shadow"]) => void;
  /** Set when a color, font, radius, or width would be rewritten at build time. */
  stylesheetError?: { field: string; message: string } | null;
}

export function renderDesignSystemModalBody(
  container: HTMLElement,
  state: DesignSystemModalState,
): () => void {
  container.innerHTML = "";
  return render(
    () => (
      <div class="meta-form">
        <ColorField
          label="Accent color"
          value={state.accent}
          textClass="design-accent"
          error={state.accentError}
          onChange={state.onAccentChange}
        />
        <ColorField
          label="Background"
          value={state.background}
          textClass="design-background"
          error={
            state.stylesheetError?.field === "background"
              ? state.stylesheetError.message
              : undefined
          }
          errorClass="design-background-error"
          onChange={state.onBackgroundChange}
        />
        <ColorField
          label="Foreground"
          value={state.foreground}
          textClass="design-foreground"
          error={
            state.stylesheetError?.field === "foreground"
              ? state.stylesheetError.message
              : undefined
          }
          errorClass="design-foreground-error"
          onChange={state.onForegroundChange}
        />
        <ColorField
          label="Surface"
          value={state.surface}
          textClass="design-surface"
          error={
            state.stylesheetError?.field === "surface"
              ? state.stylesheetError.message
              : undefined
          }
          errorClass="design-surface-error"
          onChange={state.onSurfaceChange}
        />
        <FontField
          label="Body font"
          value={state.bodyFont}
          customClass="design-body-font"
          error={
            state.stylesheetError?.field === "bodyFont"
              ? state.stylesheetError.message
              : undefined
          }
          errorClass="design-body-font-error"
          onChange={state.onBodyFontChange}
        />
        <FontField
          label="Heading font"
          value={state.headingFont}
          customClass="design-heading-font"
          error={
            state.stylesheetError?.field === "headingFont"
              ? state.stylesheetError.message
              : undefined
          }
          errorClass="design-heading-font-error"
          onChange={state.onHeadingFontChange}
        />
        <label class="meta-field">
          <span>Radius</span>
          <input
            class="text design-radius"
            value={state.radius}
            onInput={(event) => state.onRadiusChange(event.currentTarget.value)}
          />
          {state.stylesheetError?.field === "radius" ? (
            <span class="form-error design-radius-error" role="alert">
              {state.stylesheetError.message}
            </span>
          ) : null}
        </label>
        <label class="meta-field">
          <span>Container width</span>
          <input
            class="text design-container"
            value={state.containerWidth}
            onInput={(event) =>
              state.onContainerWidthChange(event.currentTarget.value)
            }
          />
          {state.stylesheetError?.field === "containerWidth" ? (
            <span class="form-error design-container-error" role="alert">
              {state.stylesheetError.message}
            </span>
          ) : null}
        </label>
        <label class="meta-field">
          <span>Shadow depth</span>
          <select
            class="text"
            value={state.shadow}
            onChange={(event) =>
              state.onShadowChange(
                event.currentTarget.value as DesignTokenSet["shadow"],
              )
            }
          >
            <option value="none">none</option>
            <option value="sm">sm</option>
            <option value="md">md</option>
            <option value="lg">lg</option>
          </select>
        </label>
      </div>
    ),
    container,
  );
}
