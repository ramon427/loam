import type { NotesStore } from "@loam/storage/NotesStore";
import { newNote, noteLink, paragraph, text } from "@loam/storage/testing/storeFixtures";

/** A small seeded random generator, so every run builds the same library. */
export const createRandom = (seed = 42) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!,
  };
};

const WORDS = (
  "market price trend support resistance volume breakout session london new york asia open close " +
  "review lesson setup entry exit risk reward journal note idea research study video chapter " +
  "summary question answer plan goal habit focus routine weekly monthly project draft final " +
  "insight pattern model theory practice example detail context reason result outcome mistake"
).split(" ");

export const BENCH_NOTE_COUNT = 10_000;
const BENCH_FOLDER_COUNT = 100;
/** A word that appears in about 1% of notes, to time a selective search. */
export const RARE_WORD = "zephyrine";

export const benchNoteId = (index: number) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

const sentence = (random: ReturnType<typeof createRandom>, words: number) =>
  Array.from({ length: words }, () => random.pick(WORDS)).join(" ");

const block = (type: string, content: unknown[], props: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  type,
  props,
  content,
  children: [],
});

/** Paragraphs, headings and lists, a few links to other notes, sometimes an image. */
const buildBenchBlocks = (index: number, random: ReturnType<typeof createRandom>) => {
  const blocks: unknown[] = [];
  const count = random.int(8, 30);
  for (let position = 0; position < count; position += 1) {
    if (position % 7 === 0)
      blocks.push(block("heading", [text(sentence(random, 3))], { level: 2 }));
    else if (position % 5 === 0) blocks.push(block("bulletListItem", [text(sentence(random, 8))]));
    else blocks.push(paragraph(text(sentence(random, random.int(20, 80)))));
  }
  for (let link = random.int(0, 4); link > 0; link -= 1) {
    const target = random.int(0, BENCH_NOTE_COUNT - 1);
    if (target !== index)
      blocks.push(paragraph(text("See "), noteLink(benchNoteId(target), "related note")));
  }
  if (index % 100 === 7) blocks.push(paragraph(text(`A rare ${RARE_WORD} detail.`)));
  if (index % 10 === 3)
    blocks.push(
      block("image", [], {
        url: "loam-media://images/11111111-1111-4111-8111-111111111111.png",
        caption: "Chart",
      }),
    );
  return blocks;
};

/** Creates the library through the store's normal path, one note per call. */
export const seedBenchLibrary = async (store: NotesStore, count = BENCH_NOTE_COUNT) => {
  const random = createRandom();
  for (let index = 0; index < count; index += 1) {
    await store.createNote(
      newNote(benchNoteId(index), {
        title: `${random.pick(WORDS)} ${random.pick(WORDS)} ${index}`,
        blocks: buildBenchBlocks(index, random),
      }),
    );
  }
};

/** Places the notes into folders with one library save, as the app does. */
export const placeBenchNotes = async (store: NotesStore, count = BENCH_NOTE_COUNT) => {
  const folders = Array.from({ length: BENCH_FOLDER_COUNT }, (_, position) => ({
    id: `22222222-2222-4222-8222-${String(position + 1).padStart(12, "0")}`,
    name: `Folder ${position + 1}`,
  }));
  await store.saveLayout({
    folders,
    notes: Array.from({ length: count }, (_, index) => ({
      id: benchNoteId(index),
      folderId: folders[index % BENCH_FOLDER_COUNT]!.id,
    })),
  });
};
