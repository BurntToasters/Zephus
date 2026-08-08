import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";

const LENGTH_UNITS = ["px", "rem", "em", "%", "vh", "vw", "auto", "custom"];

function parseLength(value: string): {
  num: string;
  unit: string;
  raw?: string;
} {
  const t = (value ?? "").trim();
  if (!t) return { num: "", unit: "px" };
  if (t === "auto") return { num: "", unit: "auto" };
  const match = /^(-?\d*\.?\d+)(px|rem|em|%|vh|vw)?$/.exec(t);
  if (match) return { num: match[1] ?? "", unit: match[2] ?? "px" };
  return { num: "", unit: "custom", raw: t };
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
        .map((char) => char + char)
        .join("")
    );
  }
  return v;
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [current, setCurrent] = createSignal(props.value);
  return (
    <label class="meta-field">
      <span>{props.label}</span>
      <input
        class="text"
        value={current()}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onInput={(event) => {
          const value = event.currentTarget.value;
          setCurrent(value);
          props.onChange(value);
        }}
      />
    </label>
  );
}

export function TextareaField(props: {
  label: string;
  value: string;
  rows?: number;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [current, setCurrent] = createSignal(props.value);
  return (
    <label class="meta-field">
      <span>{props.label}</span>
      <textarea
        rows={props.rows ?? 4}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onInput={(event) => {
          const value = event.currentTarget.value;
          setCurrent(value);
          props.onChange(value);
        }}
      >
        {current()}
      </textarea>
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <label class="meta-field">
      <span>{props.label}</span>
      <select
        value={props.value}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.options.map((option) => (
          <option value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ToggleField(props: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <label class="meta-field">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

export function LengthField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const parsed = parseLength(props.value);
  const [num, setNum] = createSignal(parsed.num);
  const [unit, setUnit] = createSignal(parsed.unit);
  const [raw, setRaw] = createSignal(parsed.raw ?? props.value);

  const emit = () => {
    if (unit() === "auto") props.onChange("auto");
    else if (unit() === "custom") props.onChange(raw().trim());
    else {
      // Sanitize the typed number: ".", "-", "e" mid-typing produce values
      // like ".px" that are invalid CSS and silently drop the declaration
      // (both on the canvas and in the build). Normalize what parses; skip
      // what doesn't.
      const typed = num().trim();
      if (!typed) {
        props.onChange("");
        return;
      }
      const n = Number(typed);
      if (Number.isFinite(n)) props.onChange(`${n}${unit()}`);
    }
  };

  const friendly: Record<string, string> = {
    Padding: "Inner spacing",
    Margin: "Outer spacing",
    Radius: "Corner roundness",
    Gap: "Space between",
  };

  return (
    <label class="meta-field">
      <span>{friendly[props.label] ?? props.label}</span>
      <div class="length-control">
        {unit() === "auto" || unit() === "custom" ? null : (
          <input
            type="number"
            class="text length-num"
            aria-label={`${props.label} value`}
            value={num()}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
            onInput={(event) => {
              setNum(event.currentTarget.value);
              emit();
            }}
          />
        )}
        <select
          class="length-unit"
          aria-label={`${props.label} unit`}
          value={unit()}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          onChange={(event) => {
            setUnit(event.currentTarget.value);
            emit();
          }}
        >
          {LENGTH_UNITS.map((option) => (
            <option value={option}>{option}</option>
          ))}
        </select>
        {unit() === "custom" ? (
          <input
            type="text"
            class="text length-raw"
            placeholder="e.g. 2rem 0"
            aria-label={`${props.label} custom value`}
            value={raw()}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
            onInput={(event) => {
              setRaw(event.currentTarget.value);
              emit();
            }}
          />
        ) : null}
      </div>
    </label>
  );
}

export function ColorField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
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
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setSwatchValue(value);
            setTextValue(value);
            props.onChange(value);
          }}
        />
        <input
          type="text"
          class="text color-text"
          value={textValue()}
          placeholder="#3b82f6, rgb(), var(--accent)…"
          aria-label={props.label}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
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
    </label>
  );
}

export function LinkField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (current: string, onPick: (href: string) => void) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [current, setCurrent] = createSignal(props.value);
  return (
    <label class="meta-field">
      <span>{props.label}</span>
      <div class="link-field">
        <input
          class="text"
          value={current()}
          aria-label={props.label}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setCurrent(value);
            props.onChange(value);
          }}
        />
        <button
          type="button"
          class="btn ghost mini-btn"
          onClick={() =>
            props.onPick(current(), (href) => {
              setCurrent(href);
              props.onChange(href);
            })
          }
        >
          Choose...
        </button>
      </div>
    </label>
  );
}

export function Group(props: { title: string; children: JSX.Element }) {
  return (
    <section class="prop-group">
      <h4>{props.title}</h4>
      {props.children}
    </section>
  );
}

export interface SectionPropertiesState {
  sectionLabel: string;
  currentPageLabel: string;
  wrapper: string;
  cssClass: string;
  width: string;
  height: string;
  padding: string;
  margin: string;
  maxWidth: string;
  gap: string;
  background: string;
  color: string;
  radius: string;
  hideOn: string[] | undefined;
  locked: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onSectionLabelChange: (value: string) => void;
  onWrapperChange: (value: string) => void;
  onCssClassChange: (value: string) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onPaddingChange: (value: string) => void;
  onMarginChange: (value: string) => void;
  onMaxWidthChange: (value: string) => void;
  onGapChange: (value: string) => void;
  onBackgroundChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onRadiusChange: (value: string) => void;
  onHideOnChange: (
    viewport: "desktop" | "tablet" | "mobile",
    hidden: boolean,
  ) => void;
  onAddBlock: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}

export function renderPropertiesEmpty(
  container: HTMLElement,
  hasPage: boolean,
  onPageSettings: () => void,
): void {
  container.innerHTML = "";
  render(
    () => (
      <div class="prop-empty">
        <p class="muted">Select a section or block to edit its properties.</p>
        {hasPage ? (
          <button class="btn" onClick={onPageSettings}>
            Page Settings
          </button>
        ) : null}
      </div>
    ),
    container,
  );
}

export function renderSectionProperties(
  container: HTMLElement,
  state: SectionPropertiesState,
): void {
  container.innerHTML = "";
  render(
    () => (
      <>
        <div class="prop-header">
          <strong>{state.sectionLabel}</strong>
          <span class="muted">{state.currentPageLabel} / section</span>
        </div>
        {state.locked ? (
          <p class="muted">This section is locked. Unlock it to edit.</p>
        ) : null}

        <fieldset disabled={state.locked} class="prop-fieldset">
          <Group title="Content">
            <TextField
              label="Section label"
              value={state.sectionLabel}
              onChange={state.onSectionLabelChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
            <SelectField
              label="Background container"
              value={state.wrapper}
              options={[
                { value: "none", label: "None (transparent)" },
                { value: "box", label: "Boxed surface" },
              ]}
              onChange={state.onWrapperChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
            <TextField
              label="CSS class (optional)"
              value={state.cssClass}
              onChange={state.onCssClassChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
          </Group>

          <Group title="Layout">
            <LengthField
              label="Width"
              value={state.width}
              onChange={state.onWidthChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
            <LengthField
              label="Height"
              value={state.height}
              onChange={state.onHeightChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
            <LengthField
              label="Padding"
              value={state.padding}
              onChange={state.onPaddingChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
            <LengthField
              label="Margin"
              value={state.margin}
              onChange={state.onMarginChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
            <LengthField
              label="Max width"
              value={state.maxWidth}
              onChange={state.onMaxWidthChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
            <LengthField
              label="Gap"
              value={state.gap}
              onChange={state.onGapChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
          </Group>

          <Group title="Visibility">
            <ToggleField
              label="Hide on desktop"
              checked={(state.hideOn ?? []).includes("desktop")}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onHideOnChange("desktop", next)}
            />
            <ToggleField
              label="Hide on tablet"
              checked={(state.hideOn ?? []).includes("tablet")}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onHideOnChange("tablet", next)}
            />
            <ToggleField
              label="Hide on mobile"
              checked={(state.hideOn ?? []).includes("mobile")}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onHideOnChange("mobile", next)}
            />
            <p class="meta-hint">
              Hidden content stays editable on the canvas (dashed outline) and
              disappears from the published site at that width.
            </p>
          </Group>

          <Group title="Style">
            <ColorField
              label="Background"
              value={state.background}
              onChange={state.onBackgroundChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
            <ColorField
              label="Text color"
              value={state.color}
              onChange={state.onColorChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
            <LengthField
              label="Radius"
              value={state.radius}
              onChange={state.onRadiusChange}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
            />
          </Group>
        </fieldset>

        <div class="prop-actions">
          <button
            class="btn"
            disabled={state.locked}
            onClick={state.onAddBlock}
          >
            Add Block
          </button>
          <button class="btn" onClick={state.onDuplicate}>
            Duplicate
          </button>
          <button class="btn" disabled={state.locked} onClick={state.onMoveUp}>
            Move Up
          </button>
          <button
            class="btn"
            disabled={state.locked}
            onClick={state.onMoveDown}
          >
            Move Down
          </button>
          <button class="btn" onClick={state.onToggleLock}>
            {state.locked ? "Unlock" : "Lock"}
          </button>
          <button
            class="btn danger"
            disabled={state.locked}
            onClick={state.onDelete}
          >
            Delete
          </button>
        </div>
      </>
    ),
    container,
  );
}
