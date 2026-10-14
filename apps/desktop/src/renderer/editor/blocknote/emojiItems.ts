import type { EmojiMartData } from "@emoji-mart/data";
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from "@blocknote/core";
import { getDefaultReactEmojiPickerItems } from "@blocknote/react";
import type { EmojiItem } from "./EmojiGrid";

let emojiNames: Promise<Map<string, string>> | undefined;
function loadEmojiNames() {
  emojiNames ??= import("@emoji-mart/data").then((module) => {
    const data = ("default" in module ? module.default : module) as EmojiMartData;
    return new Map(
      Object.values(data.emojis).flatMap((emoji) =>
        emoji.skins.map((skin) => [skin.native, emoji.name] as const),
      ),
    );
  });
  return emojiNames;
}

export async function getEmojiItems<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>(editor: BlockNoteEditor<B, I, S>, query: string): Promise<EmojiItem[]> {
  const [items, names] = await Promise.all([
    getDefaultReactEmojiPickerItems(editor, query),
    loadEmojiNames(),
  ]);
  return items.map((item) => ({ ...item, label: names.get(item.id) ?? item.id }));
}
