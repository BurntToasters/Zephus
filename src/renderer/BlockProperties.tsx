import {
  ColorField,
  Group,
  LengthField,
  LinkField,
  SelectField,
  TextareaField,
  TextField,
  ToggleField,
} from "./SectionProperties";
import { createEffect, createSignal, For, onCleanup } from "solid-js";
import { render } from "solid-js/web";

interface GalleryItem {
  src: string;
  alt: string;
  altKey: string;
}

export interface BlockPropertiesState {
  title: string;
  subtitle: string;
  blockType: EditorBlockType;
  props: Record<string, string>;
  style: BlockStyle | undefined;
  currentViewport: ViewportKey;
  maxHeadingLevel: number;
  locked: boolean;
  responsive: {
    width?: string;
    height?: string;
    padding?: string;
    margin?: string;
  };
  onFocus: () => void;
  onBlur: () => void;
  onPropChange: (
    key: string,
    value: string,
    rerenderProperties?: boolean,
  ) => void;
  raw?: string;
  onRawChange?: (value: string) => void;
  onStyleChange: (
    key: keyof BlockStyle,
    value: string | boolean | string[],
    rerenderProperties?: boolean,
  ) => void;
  onPickLink: (current: string, onPick: (href: string) => void) => void;
  resolveAssetPreviewSrc?: (src: string) => Promise<string | null>;
  onResponsiveStyleChange: (
    key: "width" | "height" | "padding" | "margin",
    value: string,
  ) => void;
  onPickImage?: () => void;
  onClearImage?: () => void;
  onAddGalleryImage?: () => void;
  onReorderGalleryImage?: (from: number, to: number) => void;
  onRemoveGalleryImage?: (index: number) => void;
  onSaveReusable?: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onWrap: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}

function ButtonVariantField(props: {
  cls: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const currentVariant = /\bsecondary\b/.test(props.cls ?? "")
    ? "secondary"
    : "primary";
  return (
    <SelectField
      label="Button style"
      value={currentVariant}
      options={[
        { value: "primary", label: "Primary (filled)" },
        { value: "secondary", label: "Secondary (outline)" },
      ]}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onChange={(value) => {
        const rest = (props.cls ?? "")
          .split(/\s+/)
          .filter((item) => item && item !== "secondary")
          .join(" ");
        props.onChange(
          value === "secondary" ? `${rest} secondary`.trim() : rest,
        );
      }}
    />
  );
}

function HeadingLevelField(props: {
  value: string;
  maxHeadingLevel: number;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <SelectField
      label="Heading level"
      value={props.value}
      options={Array.from({ length: props.maxHeadingLevel }, (_, index) => ({
        value: String(index + 1),
        label: `H${index + 1}`,
      }))}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onChange={props.onChange}
    />
  );
}

const IMAGE_ASPECT_OPTIONS = [
  { value: "", label: "Original" },
  { value: "1/1", label: "Square (1:1)" },
  { value: "4/3", label: "Standard (4:3)" },
  { value: "3/2", label: "Photo (3:2)" },
  { value: "16/9", label: "Widescreen (16:9)" },
  { value: "21/9", label: "Cinematic (21:9)" },
  { value: "4/5", label: "Portrait (4:5)" },
];

function parseObjectPosition(value: string): { x: number; y: number } {
  const parts = (value || "50% 50%").trim().split(/\s+/);
  const x = Number.parseFloat(parts[0] ?? "50");
  const y = Number.parseFloat(parts[1] ?? "50");
  return {
    x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
    y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
  };
}

function galleryItems(props: Record<string, string>): GalleryItem[] {
  const images = (props["images"] ?? "")
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
  return images.map((src, index) => ({
    src,
    alt: props[`alt${index + 1}`] ?? "",
    altKey: `alt${index + 1}`,
  }));
}

function AssetPreviewImage(props: {
  class: string;
  src: string;
  alt: string;
  resolveAssetPreviewSrc?: (src: string) => Promise<string | null>;
}) {
  const [previewSrc, setPreviewSrc] = createSignal("");

  createEffect(() => {
    const source = props.src.trim();
    let cancelled = false;

    if (!source) {
      setPreviewSrc("");
      return;
    }

    if (!source.startsWith("/") || !props.resolveAssetPreviewSrc) {
      setPreviewSrc(source);
      return;
    }

    setPreviewSrc("");
    void props.resolveAssetPreviewSrc(source).then((resolved) => {
      if (!cancelled) setPreviewSrc(resolved ?? "");
    });

    onCleanup(() => {
      cancelled = true;
    });
  });

  return <img class={props.class} src={previewSrc()} alt={props.alt} />;
}

function ImageContentGroup(props: {
  state: BlockPropertiesState;
  src: string;
  alt: string;
}) {
  const [position, setPosition] = createSignal(
    parseObjectPosition(props.state.style?.objectPosition ?? "50% 50%"),
  );
  let focalBox: HTMLDivElement | undefined;
  let dragging = false;

  const updatePosition = (event: PointerEvent, commit: boolean) => {
    if (!focalBox) return;
    const rect = focalBox.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.round(
      Math.min(
        100,
        Math.max(0, ((event.clientX - rect.left) / rect.width) * 100),
      ),
    );
    const y = Math.round(
      Math.min(
        100,
        Math.max(0, ((event.clientY - rect.top) / rect.height) * 100),
      ),
    );
    setPosition({ x, y });
    if (commit) {
      props.state.onStyleChange("objectPosition", `${x}% ${y}%`);
    }
  };

  return (
    <Group title="Content">
      <div class="prop-actions">
        <button
          type="button"
          class="btn"
          onClick={() => props.state.onPickImage?.()}
        >
          {props.src ? "Replace Image" : "Choose Image"}
        </button>
        <button
          type="button"
          class="btn ghost"
          onClick={() => props.state.onClearImage?.()}
        >
          Remove
        </button>
      </div>
      <TextField
        label="Alt text"
        value={props.alt}
        onFocus={props.state.onFocus}
        onBlur={props.state.onBlur}
        onChange={(next) => props.state.onPropChange("alt", next)}
      />
      {props.src ? (
        <>
          <SelectField
            label="Shape"
            value={(props.state.style?.aspectRatio as string) ?? ""}
            options={IMAGE_ASPECT_OPTIONS}
            onFocus={props.state.onFocus}
            onBlur={props.state.onBlur}
            onChange={(next) => props.state.onStyleChange("aspectRatio", next)}
          />
          <SelectField
            label="Fit"
            value={(props.state.style?.objectFit as string) ?? "cover"}
            options={[
              { value: "cover", label: "Fill frame (crop)" },
              { value: "contain", label: "Fit inside" },
              { value: "fill", label: "Stretch" },
            ]}
            onFocus={props.state.onFocus}
            onBlur={props.state.onBlur}
            onChange={(next) => props.state.onStyleChange("objectFit", next)}
          />
          <div class="meta-field">
            <span>Focus point (drag)</span>
            <div
              ref={(element) => {
                focalBox = element;
              }}
              class="focal-box"
              onPointerDown={(event) => {
                dragging = true;
                props.state.onFocus();
                event.currentTarget.setPointerCapture(event.pointerId);
                updatePosition(event, false);
              }}
              onPointerMove={(event) => {
                if (dragging) updatePosition(event, false);
              }}
              onPointerUp={(event) => {
                if (!dragging) return;
                dragging = false;
                updatePosition(event, true);
                props.state.onBlur();
              }}
              onPointerCancel={() => {
                if (!dragging) return;
                dragging = false;
                const current = position();
                props.state.onStyleChange(
                  "objectPosition",
                  `${current.x}% ${current.y}%`,
                );
                props.state.onBlur();
              }}
            >
              <AssetPreviewImage
                class="focal-img"
                src={props.src}
                alt=""
                resolveAssetPreviewSrc={props.state.resolveAssetPreviewSrc}
              />
              <div
                class="focal-dot"
                style={{
                  left: `${position().x}%`,
                  top: `${position().y}%`,
                }}
              />
            </div>
          </div>
        </>
      ) : null}
    </Group>
  );
}

function GalleryContentGroup(props: { state: BlockPropertiesState }) {
  const items = () => galleryItems(props.state.props);

  return (
    <Group title="Content">
      <div class="prop-actions">
        <button
          type="button"
          class="btn"
          onClick={() => props.state.onAddGalleryImage?.()}
        >
          Add Image from Assets
        </button>
      </div>
      {items().length === 0 ? (
        <p class="muted">No images yet. Add one from your assets.</p>
      ) : (
        <div class="gallery-manager">
          <For each={items()}>
            {(item, index) => (
              <div class="gallery-item">
                <AssetPreviewImage
                  class="gallery-thumb"
                  src={item.src}
                  alt=""
                  resolveAssetPreviewSrc={props.state.resolveAssetPreviewSrc}
                />
                <div class="gallery-item-main">
                  <TextField
                    label={`Alt text ${index() + 1}`}
                    value={item.alt}
                    onFocus={props.state.onFocus}
                    onBlur={props.state.onBlur}
                    onChange={(next) =>
                      props.state.onPropChange(item.altKey, next)
                    }
                  />
                </div>
                <div class="gallery-item-actions">
                  <button
                    type="button"
                    class="btn ghost"
                    title="Move up"
                    aria-label={`Move image ${index() + 1} up`}
                    disabled={index() === 0}
                    onClick={() =>
                      props.state.onReorderGalleryImage?.(index(), index() - 1)
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="btn ghost"
                    title="Move down"
                    aria-label={`Move image ${index() + 1} down`}
                    disabled={index() === items().length - 1}
                    onClick={() =>
                      props.state.onReorderGalleryImage?.(index(), index() + 1)
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    class="btn ghost"
                    title="Remove"
                    aria-label={`Remove image ${index() + 1}`}
                    onClick={() => props.state.onRemoveGalleryImage?.(index())}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      )}
    </Group>
  );
}

function ContentGroup(props: { state: BlockPropertiesState }) {
  const state = props.state;
  const value = (key: string) => state.props[key] ?? "";

  switch (state.blockType) {
    case "html":
      return (
        <Group title="Content">
          <TextareaField
            label="Markup"
            value={state.raw ?? ""}
            rows={12}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onRawChange?.(next)}
          />
          <p class="muted">
            Edits update this HTML block in visual mode. Use Code mode for
            full-page Astro source.
          </p>
        </Group>
      );
    case "heading":
      return (
        <Group title="Content">
          <TextField
            label="Text"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
          <HeadingLevelField
            value={value("level") || "2"}
            maxHeadingLevel={state.maxHeadingLevel}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("level", next)}
          />
        </Group>
      );
    case "text":
    case "section":
      return (
        <Group title="Content">
          <TextareaField
            label="Text"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
        </Group>
      );
    case "quote":
      return (
        <Group title="Content">
          <TextareaField
            label="Text"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
          <TextField
            label="Citation"
            value={value("cite")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("cite", next)}
          />
        </Group>
      );
    case "button":
      return (
        <Group title="Content">
          <TextField
            label="Label"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
          <LinkField
            label="Link"
            value={value("href")}
            onPick={state.onPickLink}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("href", next)}
          />
          <ButtonVariantField
            cls={value("cls")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("cls", next)}
          />
        </Group>
      );
    case "columns": {
      const total = Number(state.style?.columns ?? value("count") ?? 2);
      return (
        <Group title="Content">
          <SelectField
            label="Columns"
            value={String(total)}
            options={["2", "3", "4"].map((option) => ({
              value: option,
              label: option,
            }))}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => {
              state.onPropChange("count", next);
              state.onStyleChange("columns", next, true);
            }}
          />
          {Array.from({ length: total }, (_, index) => (
            <TextareaField
              label={`Column ${index + 1}`}
              value={value(`col${index + 1}`)}
              rows={3}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onPropChange(`col${index + 1}`, next)}
            />
          ))}
        </Group>
      );
    }
    case "card":
      return (
        <Group title="Content">
          <TextField
            label="Title"
            value={value("title")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("title", next)}
          />
          <TextareaField
            label="Body"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
        </Group>
      );
    case "image":
      return (
        <ImageContentGroup
          state={state}
          src={value("src")}
          alt={value("alt")}
        />
      );
    case "gallery":
      return <GalleryContentGroup state={state} />;
    case "list":
      return (
        <Group title="Content">
          <TextareaField
            label="Items"
            value={value("items")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("items", next)}
          />
          <ToggleField
            label="Ordered list"
            checked={value("ordered") === "true"}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) =>
              state.onPropChange("ordered", next ? "true" : "false")
            }
          />
        </Group>
      );
    case "embed":
      return (
        <Group title="Content">
          <TextField
            label="Embed URL"
            value={value("src")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("src", next)}
          />
          <TextField
            label="Title"
            value={value("title")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("title", next)}
          />
        </Group>
      );
    case "spacer":
      return (
        <Group title="Content">
          <TextField
            label="Height"
            value={value("height") || "48px"}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("height", next)}
          />
        </Group>
      );
    case "divider":
      return (
        <Group title="Content">
          <p class="muted">
            Divider blocks render a horizontal rule. Use the layout and style
            controls below to adjust spacing and appearance.
          </p>
        </Group>
      );
    case "feature":
      return (
        <Group title="Content">
          <TextField
            label="Icon (emoji or text)"
            value={value("icon")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("icon", next)}
          />
          <TextField
            label="Title"
            value={value("title")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("title", next)}
          />
          <TextareaField
            label="Description"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
        </Group>
      );
    case "testimonial":
      return (
        <Group title="Content">
          <TextareaField
            label="Quote"
            value={value("quote")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("quote", next)}
          />
          <TextField
            label="Author"
            value={value("author")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("author", next)}
          />
          <TextField
            label="Role / company"
            value={value("role")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("role", next)}
          />
        </Group>
      );
    case "accordion":
      return (
        <Group title="Content">
          <TextareaField
            label="Items (one per line: Question :: Answer)"
            value={value("items")}
            rows={6}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("items", next)}
          />
        </Group>
      );
    case "stats":
      return (
        <Group title="Content">
          <TextareaField
            label="Stats (one per line: Number :: Label)"
            value={value("items")}
            rows={5}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("items", next)}
          />
        </Group>
      );
    case "pricing":
      return (
        <Group title="Content">
          <TextField
            label="Plan name"
            value={value("plan")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("plan", next)}
          />
          <TextField
            label="Price"
            value={value("price")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("price", next)}
          />
          <TextField
            label="Period (e.g. /mo)"
            value={value("period")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("period", next)}
          />
          <TextareaField
            label="Features (one per line)"
            value={value("features")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("features", next)}
          />
          <TextField
            label="Button label"
            value={value("ctaText")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("ctaText", next)}
          />
          <LinkField
            label="Button link"
            value={value("ctaHref")}
            onPick={state.onPickLink}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("ctaHref", next)}
          />
        </Group>
      );
    case "cta":
      return (
        <Group title="Content">
          <TextField
            label="Heading"
            value={value("heading")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("heading", next)}
          />
          <TextareaField
            label="Text"
            value={value("text")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("text", next)}
          />
          <TextField
            label="Button label"
            value={value("buttonText")}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("buttonText", next)}
          />
          <LinkField
            label="Button link"
            value={value("buttonHref")}
            onPick={state.onPickLink}
            onFocus={state.onFocus}
            onBlur={state.onBlur}
            onChange={(next) => state.onPropChange("buttonHref", next)}
          />
        </Group>
      );
    default:
      return null;
  }
}

export function renderBlockProperties(
  container: HTMLElement,
  state: BlockPropertiesState,
): void {
  container.innerHTML = "";
  render(
    () => (
      <>
        <div class="prop-header">
          <strong>{state.title}</strong>
          <span class="muted">{state.subtitle}</span>
        </div>
        {state.locked ? (
          <p class="muted">This block is locked. Unlock it to edit.</p>
        ) : null}

        <fieldset disabled={state.locked} class="prop-fieldset">
          <ContentGroup state={state} />

          <Group title="Layout">
            <SelectField
              label="Alignment"
              value={(state.style?.align as string) ?? "left"}
              options={["left", "center", "right"].map((value) => ({
                value,
                label: value,
              }))}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("align", next)}
            />
            <LengthField
              label="Width"
              value={state.style?.width ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("width", next)}
            />
            <LengthField
              label="Height"
              value={state.style?.height ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("height", next)}
            />
            <LengthField
              label="Max width"
              value={state.style?.maxWidth ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("maxWidth", next)}
            />
            <LengthField
              label="Gap"
              value={state.style?.gap ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("gap", next)}
            />
            {state.blockType === "gallery" ? (
              <TextField
                label="Columns"
                value={state.style?.columns ?? ""}
                onFocus={state.onFocus}
                onBlur={state.onBlur}
                onChange={(next) => state.onStyleChange("columns", next)}
              />
            ) : null}
            <ToggleField
              label="Stack on mobile"
              checked={state.style?.stackOnMobile ?? false}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("stackOnMobile", next)}
            />
          </Group>

          <Group title="Style">
            <ColorField
              label="Background"
              value={state.style?.background ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("background", next)}
            />
            <ColorField
              label="Text color"
              value={state.style?.color ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("color", next)}
            />
            <LengthField
              label="Padding"
              value={state.style?.padding ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("padding", next)}
            />
            <LengthField
              label="Margin"
              value={state.style?.margin ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("margin", next)}
            />
            <LengthField
              label="Radius"
              value={state.style?.radius ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("radius", next)}
            />
            <SelectField
              label="Shadow"
              value={(state.style?.shadow as string) ?? "none"}
              options={["none", "sm", "md", "lg"].map((value) => ({
                value,
                label: value,
              }))}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onStyleChange("shadow", next)}
            />
          </Group>

          <Group title="Advanced">
            <TextField
              label="CSS class (optional)"
              value={state.props["cls"] ?? ""}
              onFocus={state.onFocus}
              onBlur={state.onBlur}
              onChange={(next) => state.onPropChange("cls", next)}
            />
            {state.currentViewport !== "desktop" ? (
              <>
                <div class="responsive-note">
                  <strong>{state.currentViewport}</strong> override
                </div>
                <LengthField
                  label="Viewport width"
                  value={state.responsive.width ?? ""}
                  onFocus={state.onFocus}
                  onBlur={state.onBlur}
                  onChange={(next) =>
                    state.onResponsiveStyleChange("width", next)
                  }
                />
                <LengthField
                  label="Viewport height"
                  value={state.responsive.height ?? ""}
                  onFocus={state.onFocus}
                  onBlur={state.onBlur}
                  onChange={(next) =>
                    state.onResponsiveStyleChange("height", next)
                  }
                />
                <LengthField
                  label="Viewport padding"
                  value={state.responsive.padding ?? ""}
                  onFocus={state.onFocus}
                  onBlur={state.onBlur}
                  onChange={(next) =>
                    state.onResponsiveStyleChange("padding", next)
                  }
                />
                <LengthField
                  label="Viewport margin"
                  value={state.responsive.margin ?? ""}
                  onFocus={state.onFocus}
                  onBlur={state.onBlur}
                  onChange={(next) =>
                    state.onResponsiveStyleChange("margin", next)
                  }
                />
              </>
            ) : null}
            {state.onSaveReusable ? (
              <button class="btn" onClick={state.onSaveReusable}>
                Save as Reusable Section
              </button>
            ) : null}
          </Group>
        </fieldset>

        <div class="prop-actions">
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
          <button class="btn" disabled={state.locked} onClick={state.onWrap}>
            Wrap
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
