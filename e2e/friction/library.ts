import type { Page } from "@playwright/test";

/** Words for believable note titles and bodies, so search has realistic near-misses. */
const TOPICS = [
  "Budget",
  "Garden",
  "Kitchen",
  "Lecture",
  "Meeting",
  "Recipe",
  "Trip",
  "Reading",
  "Workout",
  "Invoice",
  "Interview",
  "Project",
  "Research",
  "Journal",
  "Ideas",
  "Plan",
];
const SUBJECTS = [
  "roof",
  "taxes",
  "Lisbon",
  "sourdough",
  "quarterly review",
  "thesis",
  "bike",
  "vet",
  "landlord",
  "onboarding",
  "climbing",
  "pricing",
  "newsletter",
  "wedding",
  "insurance",
  "camera",
  "piano",
  "garage",
  "school",
  "dentist",
  "launch",
  "hiring",
  "podcast",
  "move",
];
const FOLDERS = [
  "Inbox",
  "Work",
  "Home",
  "Health",
  "Money",
  "Travel",
  "Reading",
  "Cooking",
  "Archive",
  "Clients",
  "Study",
  "Side projects",
  "Family",
  "Admin",
  "Ideas",
  "Meetings",
  "Journal",
  "Car",
  "Garden",
  "Writing",
  "Music",
  "Photos",
  "Fitness",
  "Taxes",
  "Old",
];

/** A note the find flows look for: a title and a body phrase only it has. */
export const NEEDLE = {
  title: "Plumber quote for the upstairs bathroom",
  phrase: "copper elbow joint",
  folder: "Home",
};

/**
 * Fills the library with `count` notes spread over 25 folders, through the app's own bridge,
 * then reloads so the window shows them. The NEEDLE note sits in the middle.
 */
export async function seedLibrary(window: Page, count: number) {
  await window.evaluate(
    async ({ count, topics, subjects, folders, needle }) => {
      const invoke = globalThis.window.loam.invoke;
      const paragraph = (text: string) => ({
        id: crypto.randomUUID(),
        type: "paragraph",
        props: {},
        content: [{ type: "text", text, styles: {} }],
        children: [],
      });
      const folderIds = folders.map(() => crypto.randomUUID());
      const placed: Array<{ id: string; folderId: string | null }> = [];
      for (let index = 0; index < count; index++) {
        const isNeedle = index === Math.floor(count / 2);
        const topic = topics[index % topics.length]!;
        const subject = subjects[(index * 7) % subjects.length]!;
        const title = isNeedle ? needle.title : `${topic}: ${subject} ${Math.floor(index / 13)}`;
        const body = isNeedle
          ? `Quote was 420 including the ${needle.phrase}. Call back before Friday.`
          : `Notes about ${subject} for ${topic.toLowerCase()}. Follow up on the ${subjects[(index * 3) % subjects.length]} part next week.`;
        const tabId = crypto.randomUUID();
        const id = crypto.randomUUID();
        const result = await invoke("notes.create", {
          note: {
            id,
            title,
            tabs: [{ id: tabId, title: "Notes", kind: "page" }],
            activeTabId: tabId,
            blocksByTab: { [tabId]: [paragraph(body), paragraph(`Tag ${topic} ${index}`)] },
          },
        });
        if (!result.ok) throw new Error(result.error.message);
        const folderIndex = isNeedle ? folders.indexOf(needle.folder) : index % folders.length;
        // A tenth of the notes stay loose at the top level, as real libraries have.
        placed.push({
          id,
          folderId: index % 10 === 0 && !isNeedle ? null : folderIds[folderIndex]!,
        });
      }
      const layout = await invoke("notes.saveLayout", {
        layout: {
          folders: folders.map((name, index) => ({ id: folderIds[index]!, name })),
          notes: placed,
        },
      });
      if (!layout.ok) throw new Error(layout.error.message);
    },
    { count, topics: TOPICS, subjects: SUBJECTS, folders: FOLDERS, needle: NEEDLE },
  );
  await window.reload();
  await window.getByRole("searchbox", { name: "Search notes" }).waitFor();
}
