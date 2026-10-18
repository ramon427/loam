import { PLUGIN_ICONS } from "./pluginIcons";
import { isHandlerRef, type PluginNode } from "./protocol";

/*
 * What a plugin may draw: each element, the props it takes and what goes inside it. A tree is
 * checked whole before it is drawn: an unknown element or prop, or a value out of range, refuses
 * the tree.
 */

type Check = (value: unknown) => boolean;
const oneOf =
  (...values: unknown[]): Check =>
  (value) =>
    values.includes(value);
const isBool: Check = (value) => typeof value === "boolean";
const isText =
  (max = 500): Check =>
  (value) =>
    typeof value === "string" && value.length <= max;
const isStep: Check = (value) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 8;
const isHandler: Check = isHandlerRef;
const isColumns: Check = (value) =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 7;
/** Links open outside the app, so only web and mail addresses. */
const isHref: Check = (value) =>
  typeof value === "string" && value.length <= 2048 && /^(?:https?:\/\/|mailto:)/i.test(value);
const isOptions: Check = (value) =>
  Array.isArray(value) &&
  value.length <= 100 &&
  value.every(
    (option) =>
      option &&
      typeof option === "object" &&
      isText(200)((option as { value?: unknown }).value) &&
      isText(200)((option as { label?: unknown }).label),
  );

type Spec = { props: Record<string, Check>; children: "any" | "text" | "none" };

const TONES = ["default", "muted", "accent", "success", "warning", "danger"] as const;

const SPECS: Record<string, Spec> = {
  Box: {
    props: {
      direction: oneOf("row", "column"),
      gap: isStep,
      padding: isStep,
      align: oneOf("start", "center", "end", "stretch"),
      justify: oneOf("start", "center", "end", "between"),
      wrap: isBool,
      grow: isBool,
      surface: isBool,
      columns: isColumns,
      onPress: isHandler,
      label: isText(120),
    },
    children: "any",
  },
  Text: {
    props: {
      tone: oneOf(...TONES),
      size: oneOf("xs", "sm", "md"),
      weight: oneOf("normal", "medium", "semibold"),
      mono: isBool,
      truncate: isBool,
    },
    children: "text",
  },
  Heading: { props: { level: oneOf(1, 2, 3) }, children: "text" },
  Badge: { props: { tone: oneOf(...TONES) }, children: "text" },
  Button: {
    props: {
      variant: oneOf("default", "outline", "secondary", "ghost", "destructive"),
      size: oneOf("default", "sm"),
      disabled: isBool,
      icon: oneOf(...Object.keys(PLUGIN_ICONS)),
      label: isText(120),
      onPress: isHandler,
    },
    children: "text",
  },
  Input: {
    props: {
      type: oneOf("text", "date"),
      value: isText(10_000),
      placeholder: isText(200),
      label: isText(120),
      disabled: isBool,
      onChange: isHandler,
      onSubmit: isHandler,
      clearOnSubmit: isBool,
    },
    children: "none",
  },
  Checkbox: {
    props: { checked: isBool, label: isText(200), disabled: isBool, onChange: isHandler },
    children: "none",
  },
  Select: {
    props: {
      value: isText(200),
      options: isOptions,
      label: isText(120),
      disabled: isBool,
      onChange: isHandler,
    },
    children: "none",
  },
  Link: { props: { href: isHref }, children: "text" },
  Divider: { props: {}, children: "none" },
  Icon: {
    props: { name: oneOf(...Object.keys(PLUGIN_ICONS)), tone: oneOf(...TONES) },
    children: "none",
  },
};

const MAX_DEPTH = 24;
const MAX_NODES = 2_000;
const MAX_TEXT = 100_000;

/** Why a tree can't be drawn, or null when it can. */
export const validateTree = (root: unknown): string | null => {
  let nodes = 0;
  let text = 0;
  const visit = (node: unknown, depth: number, inside: Spec["children"]): string | null => {
    if (typeof node === "string") {
      text += node.length;
      return text > MAX_TEXT ? "The drawing holds too much text." : null;
    }
    if (inside === "text") return "Only text goes inside this element.";
    if (inside === "none") return "Nothing goes inside this element.";
    if (depth > MAX_DEPTH) return "The drawing is nested too deeply.";
    if ((nodes += 1) > MAX_NODES) return "The drawing has too many elements.";
    if (!node || typeof node !== "object") return "A drawing is made of elements and text.";
    const { type, props, children } = node as Partial<PluginNode>;
    const spec = typeof type === "string" ? SPECS[type] : undefined;
    if (!spec) return `${String(type)} is not an element plugins can draw.`;
    for (const [name, value] of Object.entries(props ?? {})) {
      if (value === undefined || value === null) continue;
      const check = spec.props[name];
      if (!check) return `${type} has no ${name} prop.`;
      if (!check(value)) return `${type}'s ${name} is not a value it takes.`;
    }
    if (!Array.isArray(children)) return `${type}'s children are not a list.`;
    for (const child of children) {
      const reason = visit(child, depth + 1, spec.children);
      if (reason) return reason;
    }
    return null;
  };
  return visit(root, 0, "any");
};

/** Every handler a tree names, so the window can release them when it is drawn again. */
export const handlerIds = (node: unknown, into: string[] = []): string[] => {
  if (!node || typeof node !== "object") return into;
  const { props, children } = node as PluginNode;
  for (const value of Object.values(props ?? {}))
    if (isHandlerRef(value)) into.push(value.__handler);
  for (const child of children ?? []) handlerIds(child, into);
  return into;
};
