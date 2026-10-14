/** Elements imported HTML loses: anything that runs, embeds or takes input. */
const UNSAFE_ELEMENTS =
  "script, style, iframe, object, embed, form, input, button, link, meta, noscript, template";

/** Removes what imported HTML must not bring in: scripts, embeds, forms and the like. */
export const removeUnsafeElements = (root: ParentNode) => {
  for (const element of root.querySelectorAll(UNSAFE_ELEMENTS)) element.remove();
};
