import type { Api, Register } from "@loam/plugin-api";

const today = () => new Date().toISOString().slice(0, 10);

const openToday = async ($: Api) => {
  const title = today();
  const existing = (await $.notes.list()).find((note) => note.title === title);
  if (existing) {
    await $.ui.openNote(existing.id);
    return;
  }
  const { template } = await $.settings.get();
  const created = await $.notes.create({
    title,
    markdown: typeof template === "string" ? template : "",
  });
  await $.ui.openNote(created.id);
};

export const register: Register = (on) => {
  on("app.ready", async ($) => {
    await $.commands.register({ id: "today", title: "Open today's note", key: "Mod+Shift+Y" });
    await $.editor.registerSlashItem({
      id: "date",
      title: "Today's date",
      subtext: "Insert the date as YYYY-MM-DD.",
      aliases: ["date", "today"],
    });
  });

  on("command.run", { command: "today" }, async ($) => {
    await openToday($);
  });

  on("slash.run", { item: "date" }, async () => ({ markdown: today() }));
};
