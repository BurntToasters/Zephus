/**
 * Shared field components + state contract for the per-block-type property
 * editors. Split from BlockProperties.tsx so each block type's editor lives
 * in a small focused file.
 */

import { SelectField } from "../SectionProperties";
export {
  ColorField,
  Group,
  LengthField,
  LinkField,
  SelectField,
  TextareaField,
  TextField,
  ToggleField,
} from "../SectionProperties";
import { createEffect, createSignal, onCleanup } from "solid-js";
import type {
  BlockStyle,
  EditorBlockType,
  ViewportKey,
} from "../../main/types";

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

export function ButtonVariantField(props: {
  cls: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const currentVariant = (props.cls ?? "").split(/\s+/).includes("secondary")
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

export function HeadingLevelField(props: {
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

export const IMAGE_ASPECT_OPTIONS = [
  { value: "", label: "Original" },
  { value: "1/1", label: "Square (1:1)" },
  { value: "4/3", label: "Standard (4:3)" },
  { value: "3/2", label: "Photo (3:2)" },
  { value: "16/9", label: "Widescreen (16:9)" },
  { value: "21/9", label: "Cinematic (21:9)" },
  { value: "4/5", label: "Portrait (4:5)" },
];

export function parseObjectPosition(value: string): { x: number; y: number } {
  const parts = (value || "50% 50%").trim().split(/\s+/);
  const x = Number.parseFloat(parts[0] ?? "50");
  const y = Number.parseFloat(parts[1] ?? "50");
  return {
    x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
    y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
  };
}

export function galleryItems(props: Record<string, string>): GalleryItem[] {
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

export function AssetPreviewImage(props: {
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
    void props.resolveAssetPreviewSrc(source).then(
      (resolved) => {
        if (!cancelled) setPreviewSrc(resolved ?? "");
      },
      () => {
        if (!cancelled) setPreviewSrc("");
      },
    );

    onCleanup(() => {
      cancelled = true;
    });
  });

  return (
    <img
      class={props.class}
      src={previewSrc()}
      alt={props.alt}
      draggable={false}
    />
  );
}
