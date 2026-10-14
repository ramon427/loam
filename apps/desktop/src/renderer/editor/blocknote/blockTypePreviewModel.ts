export type BlockPreviewKind =
  | "bulletListItem"
  | "checkListItem"
  | "columns-2"
  | "columns-3"
  | "divider"
  | "emoji"
  | "generic"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "image"
  | "numberedListItem"
  | "paragraph"
  | "quote"
  | "table"
  | "toggle-heading-1"
  | "toggle-heading-2"
  | "toggle-heading-3"
  | "toggleListItem";

type BlockPreviewLineKind = "bullet" | "check" | "heading" | "number" | "quote" | "text" | "toggle";

export type BlockPreviewLine = {
  checked?: boolean;
  kind: BlockPreviewLineKind;
  marker?: string;
  text: string;
};

export type BlockPreviewExample = {
  columns?: string[][];
  description?: string;
  lines: BlockPreviewLine[];
  table?: string[][];
  title: string;
  variant?: "columns" | "divider" | "emoji" | "image" | "lines" | "table";
};

/** The sample for a block type in the formatting toolbar's block-type menu. */
export const resolveBlockPreviewKind = (
  type: string,
  props?: Record<string, boolean | number | string>,
): BlockPreviewKind => {
  if (type === "heading") {
    let level: 1 | 2 | 3 = 1;
    if (props?.level === 2) level = 2;
    else if (props?.level === 3) level = 3;
    return props?.isToggleable ? `toggle-heading-${level}` : `heading-${level}`;
  }

  if (
    type === "bulletListItem" ||
    type === "checkListItem" ||
    type === "numberedListItem" ||
    type === "quote" ||
    type === "toggleListItem"
  ) {
    return type;
  }

  return "paragraph";
};

/** Sample content showing what a block of the given kind looks like. */
export const getBlockPreviewExample = (
  kind: BlockPreviewKind,
  fallbackTitle: string,
  fallbackDescription?: string,
): BlockPreviewExample => {
  switch (kind) {
    case "heading-1":
      return {
        description: "Large section heading.",
        lines: [
          { kind: "heading", text: "Project plan" },
          { kind: "text", text: "Goals for this week" },
          { kind: "text", text: "Milestones and owners" },
        ],
        title: fallbackTitle,
      };
    case "heading-2":
      return {
        description: "Medium subsection heading.",
        lines: [
          { kind: "heading", text: "Background" },
          { kind: "text", text: "Context and constraints" },
          { kind: "text", text: "What has changed today" },
        ],
        title: fallbackTitle,
      };
    case "heading-3":
      return {
        description: "Small heading for short notes.",
        lines: [
          { kind: "heading", text: "Next steps" },
          { kind: "text", text: "Draft, review, publish" },
          { kind: "text", text: "Check before sharing" },
        ],
        title: fallbackTitle,
      };
    case "toggle-heading-1":
      return {
        description: "Collapsible large heading.",
        lines: [
          { kind: "toggle", marker: "▸", text: "Meeting notes" },
          { kind: "text", text: "Click to open details" },
          { kind: "text", text: "Notes stay tucked away" },
        ],
        title: fallbackTitle,
      };
    case "toggle-heading-2":
      return {
        description: "Collapsible subsection.",
        lines: [
          { kind: "toggle", marker: "▸", text: "Background" },
          { kind: "text", text: "Why this matters" },
          { kind: "text", text: "Sources and open questions" },
        ],
        title: fallbackTitle,
      };
    case "toggle-heading-3":
      return {
        description: "Compact collapsible heading.",
        lines: [
          { kind: "toggle", marker: "▸", text: "Extra Notes" },
          { kind: "text", text: "Keep supporting details here" },
          { kind: "text", text: "Open only when needed" },
        ],
        title: fallbackTitle,
      };
    case "bulletListItem":
      return {
        description: "Simple unordered list.",
        lines: [
          { kind: "bullet", marker: "•", text: "Collect sources" },
          { kind: "bullet", marker: "•", text: "Write a summary" },
          { kind: "bullet", marker: "•", text: "Link related notes" },
        ],
        title: fallbackTitle,
      };
    case "numberedListItem":
      return {
        description: "Ordered steps.",
        lines: [
          { kind: "number", marker: "1.", text: "Outline the idea" },
          { kind: "number", marker: "2.", text: "Write the first draft" },
          { kind: "number", marker: "3.", text: "Review and revise" },
        ],
        title: fallbackTitle,
      };
    case "checkListItem":
      return {
        description: "Tasks with checkboxes.",
        lines: [
          { checked: true, kind: "check", text: "Outline written" },
          { kind: "check", text: "Sources checked" },
          { kind: "check", text: "Ready to share" },
        ],
        title: fallbackTitle,
      };
    case "quote":
      return {
        description: "Quoted thought or rule.",
        lines: [
          { kind: "quote", text: "Write it down before you forget it." },
          { kind: "text", text: "Use quotes for rules, notes, or reminders." },
        ],
        title: fallbackTitle,
      };
    case "toggleListItem":
      return {
        description: "Collapsible list item.",
        lines: [
          { kind: "toggle", marker: "▸", text: "Open question" },
          { kind: "text", text: "Open to show the details" },
          { kind: "text", text: "Keep the page compact" },
        ],
        title: fallbackTitle,
      };
    case "image":
      return {
        description: "Add an image to the note.",
        lines: [],
        title: fallbackTitle,
        variant: "image",
      };
    case "table":
      return {
        description: "Compare data in rows and columns.",
        lines: [],
        table: [
          ["Task", "Owner"],
          ["Draft outline", "Sam"],
          ["Review notes", "Alex"],
        ],
        title: fallbackTitle,
        variant: "table",
      };
    case "columns-2":
      return {
        columns: [
          ["Column 1", "Plan"],
          ["Column 2", "Review"],
        ],
        description: "Place two writing areas side by side.",
        lines: [],
        title: fallbackTitle,
        variant: "columns",
      };
    case "columns-3":
      return {
        columns: [
          ["Column 1", "Ideas"],
          ["Column 2", "Doing"],
          ["Column 3", "Done"],
        ],
        description: "Split notes into three areas.",
        lines: [],
        title: fallbackTitle,
        variant: "columns",
      };
    case "divider":
      return {
        description: "Separate sections with a horizontal rule.",
        lines: [
          { kind: "text", text: "Morning plan" },
          { kind: "text", text: "Afternoon review" },
        ],
        title: fallbackTitle,
        variant: "divider",
      };
    case "emoji":
      return {
        description: "Add a small visual marker.",
        lines: [
          { kind: "heading", text: "🌱 New idea" },
          { kind: "text", text: "Use emoji to label notes." },
        ],
        title: fallbackTitle,
        variant: "emoji",
      };
    case "paragraph":
    case "generic":
    default:
      return {
        description: fallbackDescription ?? "Normal text block.",
        lines: [
          { kind: "text", text: "Write down the idea in your own words." },
          { kind: "text", text: "Add details as they come up." },
          { kind: "text", text: "Keep notes compact and readable." },
        ],
        title: fallbackTitle,
      };
  }
};
