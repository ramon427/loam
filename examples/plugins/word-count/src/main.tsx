import type { Register } from "@loam/plugin-api";

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

export const register: Register = (on, options) => {
  const goal = typeof options.goal === "number" ? options.goal : 0;

  on("ui.render", { slot: "note.header" }, async ($, e) => {
    if (e.slot !== "note.header") return null;
    const note = await $.notes.get(e.props.noteId);
    const words = countWords(note.text);
    const label = words === 1 ? "1 word" : `${words} words`;
    return (
      <Text tone={goal && words >= goal ? "success" : "muted"} size="xs">
        {goal ? `${label} of ${goal}` : label}
      </Text>
    );
  });

  // The header draws again once the note is saved, with the new count.
  on("note.saved", async ($) => {
    await $.ui.invalidate();
  });
};
