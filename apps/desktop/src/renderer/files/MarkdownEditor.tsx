import { useEffect, useEffectEvent, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Markdown shown as written, lightly styled: headings larger, emphasis as
 * emphasis, marks and links muted. What is typed is what the file holds.
 */
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.35em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "650" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "650" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--app-accent)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono, ui-monospace, monospace)" },
  {
    tag: [tags.processingInstruction, tags.contentSeparator, tags.quote],
    color: "var(--app-muted)",
  },
]);

const editorTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--app-text)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6", padding: "1.5rem 0" },
  ".cm-content": {
    maxWidth: "46rem",
    margin: "0 auto",
    padding: "0 1.5rem",
    caretColor: "var(--app-text)",
  },
  ".cm-cursor": { borderLeftColor: "var(--app-text)" },
  ".cm-placeholder": { color: "var(--app-muted)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--app-accent) 25%, transparent)",
  },
});

/**
 * Edits Markdown as text. `text` replaces what the editor shows when it
 * differs, such as when the file changed on disk; `onChange` hears each edit.
 */
export default function MarkdownEditor({
  text,
  onChange,
}: {
  text: string;
  onChange: (text: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changed = useEffectEvent((next: string) => onChange(next));
  const initialText = useEffectEvent(() => text);

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initialText(),
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          syntaxHighlighting(markdownStyle),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Markdown" }),
          placeholder("Write in Markdown…"),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === text) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, [text]);

  return <div ref={hostRef} className="h-full" />;
}
