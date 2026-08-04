/**
 * The block catalog: palette order/icons, default props per block type, the
 * prebuilt section templates, and the runtime allowlist of block types.
 * Pure data + tiny factories, so the editor engine stays thinner and the
 * catalog is unit-testable in isolation.
 */

import type { BlockNode, BlockStyle, EditorBlockType } from "../main/types";

export type BlockType = EditorBlockType;

export interface SectionTemplate {
  id: string;
  label: string;
  /** Schema block factory — produces fresh editable blocks per insert. */
  blocks?: () => BlockNode[];
  /** Legacy/saved sections inserted as a single preserved HTML block. */
  html?: string;
  deletable?: boolean;
  onDelete?: () => void | Promise<void>;
}

// The engine registers its id generator so template blocks use the same id
// scheme as everything else in the session.
let uidGenerator: () => string = () =>
  "b" + Math.random().toString(36).slice(2, 9);

export function setUidGenerator(fn: () => string): void {
  uidGenerator = fn;
}

function uid(): string {
  return uidGenerator();
}

export const PALETTE: { type: BlockType; label: string }[] = [
  { type: "heading", label: "Heading" },
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "button", label: "Button" },
  { type: "section", label: "Section" },
  { type: "divider", label: "Divider" },
  { type: "spacer", label: "Spacer" },
  { type: "columns", label: "Columns" },
  { type: "card", label: "Card" },
  { type: "gallery", label: "Gallery" },
  { type: "quote", label: "Quote" },
  { type: "list", label: "List" },
  { type: "embed", label: "Embed" },
  { type: "video", label: "Video" },
  { type: "feature", label: "Feature" },
  { type: "testimonial", label: "Testimonial" },
  { type: "accordion", label: "FAQ / Accordion" },
  { type: "stats", label: "Stats" },
  { type: "pricing", label: "Pricing" },
  { type: "cta", label: "Call to Action" },
  { type: "postlist", label: "Post List" },
  { type: "html", label: "HTML" },
];

export const PALETTE_ICONS: Record<BlockType, string> = {
  heading: "heading",
  text: "align-left",
  image: "image",
  button: "square",
  section: "layout",
  divider: "align-left",
  spacer: "layout",
  columns: "layout-template",
  card: "square",
  gallery: "image",
  quote: "align-left",
  list: "align-left",
  embed: "link",
  video: "video",
  feature: "star",
  testimonial: "quote",
  accordion: "chevron-down",
  stats: "bar-chart",
  pricing: "tag",
  cta: "megaphone",
  postlist: "newspaper",
  html: "code-xml",
};

/** Runtime set of all valid block types, used to validate untrusted code-mode input. */
export const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set(
  Object.keys(PALETTE_ICONS),
);

/** Block types whose text is editable inline on the canvas. */
export const TEXT_EDITABLE: BlockType[] = [
  "heading",
  "text",
  "button",
  "section",
  "columns",
  "card",
  "quote",
  "list",
  "feature",
  "testimonial",
  "accordion",
  "stats",
  "pricing",
  "cta",
];

/** Build a fresh editable block node with merged default props. */
export function mk(
  type: BlockType,
  props: Record<string, string> = {},
  style?: BlockStyle,
): BlockNode {
  const node: BlockNode = {
    id: uid(),
    type,
    props: { ...defaultProps(type), ...props },
  };
  if (style) node.style = style;
  return node;
}

// Prebuilt section clusters inserted as fully editable schema blocks.
export const TEMPLATES: SectionTemplate[] = [
  {
    id: "hero",
    label: "Hero",
    blocks: () => [
      mk(
        "heading",
        { text: "Your headline goes here", level: "1" },
        { align: "center" },
      ),
      mk(
        "text",
        {
          text: "A short supporting sentence about your product or site.",
          cls: "lead",
        },
        { align: "center" },
      ),
      mk("button", { text: "Get started", href: "#" }, { align: "center" }),
    ],
  },
  {
    id: "features",
    label: "Features",
    blocks: () => [
      mk("heading", { text: "Why choose us", level: "2" }, { align: "center" }),
      mk("feature", {
        icon: "⚡",
        title: "Fast",
        text: "Describe a key benefit in one short sentence.",
      }),
      mk("feature", {
        icon: "🎯",
        title: "Simple",
        text: "Describe a key benefit in one short sentence.",
      }),
      mk("feature", {
        icon: "🧩",
        title: "Flexible",
        text: "Describe a key benefit in one short sentence.",
      }),
    ],
  },
  {
    id: "stats",
    label: "Stats",
    blocks: () => [
      mk(
        "heading",
        { text: "By the numbers", level: "2" },
        { align: "center" },
      ),
      mk("stats", {
        items:
          "10k+ :: Happy customers\n99.9% :: Uptime\n4.9/5 :: Average rating",
      }),
    ],
  },
  {
    id: "pricing",
    label: "Pricing",
    blocks: () => [
      mk(
        "heading",
        { text: "Simple, honest pricing", level: "2" },
        { align: "center" },
      ),
      mk(
        "text",
        { text: "Choose the plan that fits your needs.", cls: "lead" },
        { align: "center" },
      ),
      mk("pricing", {
        plan: "Starter",
        price: "$9",
        period: "/mo",
        features: "One site\nEmail support",
        ctaText: "Choose Starter",
      }),
      mk("pricing", {
        plan: "Pro",
        price: "$29",
        period: "/mo",
        features: "Unlimited pages\nPriority support",
        ctaText: "Choose Pro",
      }),
      mk("pricing", {
        plan: "Studio",
        price: "$99",
        period: "/mo",
        features: "Team seats\nCustom onboarding",
        ctaText: "Choose Studio",
      }),
    ],
  },
  {
    id: "faq",
    label: "FAQ",
    blocks: () => [
      mk(
        "heading",
        { text: "Frequently asked questions", level: "2" },
        { align: "center" },
      ),
      mk("accordion", {
        items:
          "What is this for? :: Answer the most common buyer question.\nHow long does setup take? :: Share the expected time-to-value.\nCan I customize it? :: Explain the limits and flexibility.",
      }),
    ],
  },
  {
    id: "testimonials",
    label: "Testimonials",
    blocks: () => [
      mk(
        "heading",
        { text: "Loved by teams everywhere", level: "2" },
        { align: "center" },
      ),
      mk("testimonial", {
        quote: "A short customer quote that builds trust.",
        author: "Customer Name",
        role: "Founder, Studio",
      }),
      mk("testimonial", {
        quote: "Another proof point from a happy client.",
        author: "Happy Client",
        role: "CEO, Company",
      }),
    ],
  },
  {
    id: "cta",
    label: "Call to action",
    blocks: () => [
      mk("cta", {
        heading: "Ready to begin?",
        text: "Join thousands already building with us.",
        buttonText: "Contact us",
        buttonHref: "#",
      }),
    ],
  },
  {
    id: "logo-wall",
    label: "Logo Wall",
    blocks: () => [
      mk("heading", { text: "Trusted by", level: "3" }, { align: "center" }),
      mk(
        "text",
        {
          text: "Client One · Client Two · Client Three · Client Four",
          cls: "lead",
        },
        { align: "center" },
      ),
    ],
  },
  {
    id: "contact",
    label: "Contact",
    blocks: () => [
      mk("heading", { text: "Say hello", level: "2" }),
      mk("text", { text: "Drop in your email, address, or scheduling link." }),
      mk("button", { text: "Email us", href: "mailto:hello@example.com" }),
    ],
  },
  {
    id: "footer",
    label: "Footer",
    blocks: () => [
      mk("divider"),
      mk(
        "text",
        { text: "© Your Site. Built with Zephus." },
        { align: "center" },
      ),
    ],
  },
];

/** Default props for a freshly inserted block of the given type. */
export function defaultProps(type: BlockType): Record<string, string> {
  switch (type) {
    case "heading":
      return { text: "New heading", level: "2", cls: "" };
    case "text":
      return { text: "New paragraph of text.", cls: "" };
    case "image":
      return {
        src: "/assets/images/placeholder-landscape.svg",
        alt: "",
        cls: "",
      };
    case "button":
      return { text: "Click me", href: "#", cls: "" };
    case "section":
      return { text: "A new content section", cls: "" };
    case "divider":
      return { cls: "" };
    case "spacer":
      return { height: "48px", cls: "" };
    case "columns":
      return {
        col1: "Column one content",
        col2: "Column two content",
        count: "2",
        cls: "",
      };
    case "card":
      return { title: "Card title", text: "Card body copy.", cls: "" };
    case "gallery":
      return {
        images:
          "/assets/images/placeholder-square.svg\n/assets/images/placeholder-square.svg\n/assets/images/placeholder-square.svg",
        cls: "",
      };
    case "quote":
      return {
        text: "A quote or testimonial.",
        cite: "Customer Name",
        cls: "",
      };
    case "list":
      return {
        items: "First item\nSecond item\nThird item",
        ordered: "false",
        cls: "",
      };
    case "embed":
      return { src: "", title: "Embed", cls: "" };
    case "video":
      return { src: "", title: "Video", cls: "" };
    case "feature":
      return {
        icon: "★",
        title: "Feature title",
        text: "A short sentence describing this feature or benefit.",
        cls: "",
      };
    case "testimonial":
      return {
        quote: "This product changed how our whole team works.",
        author: "Customer Name",
        role: "Title, Company",
        cls: "",
      };
    case "accordion":
      return {
        items:
          "What is your refund policy? :: We offer a 30-day money-back guarantee.\nDo you offer support? :: Yes, by email within one business day.",
        cls: "",
      };
    case "stats":
      return {
        items: "10k+ :: Happy customers\n99.9% :: Uptime\n24/7 :: Support",
        cls: "",
      };
    case "pricing":
      return {
        plan: "Pro",
        price: "$12",
        period: "/mo",
        features: "Everything in Free\nUnlimited projects\nPriority support",
        ctaText: "Choose Pro",
        ctaHref: "#",
        cls: "",
      };
    case "cta":
      return {
        heading: "Ready to get started?",
        text: "Join thousands of happy customers today.",
        buttonText: "Get started",
        buttonHref: "#",
        cls: "",
      };
    case "postlist":
      return {
        folder: "/posts",
        limit: "5",
        showDate: "true",
        showAuthor: "false",
        showExcerpt: "true",
        showImage: "false",
        emptyText: "No posts yet. Add a page with a publish date.",
        cls: "",
      };
    case "html":
      return {};
  }
}
