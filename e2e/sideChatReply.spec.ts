import type { Page } from "@playwright/test";

import { expect, test } from "./app";
import { startFakeModel } from "./fakeModel";
import { callStore, createNote } from "./notes";

/** Turns the side chat on, talking to the fake model service at `baseUrl`, and opens it. */
async function openChatWith(window: Page, baseUrl: string) {
  await callStore(window, "ai.configure", {
    enabled: true,
    provider: "openai-compatible",
    baseUrl,
  });
  await callStore(window, "ai.setKey", { provider: "openai-compatible", key: "test-key" });
  await callStore(window, "ai.configure", { model: "fake-model" });
  await window.getByRole("button", { name: "Open side chat" }).click();
  return window.getByRole("complementary", { name: "Side chat" });
}

test("a reply streams in, then folds into an answer to copy, with the files it was sent", async ({
  loam,
}) => {
  const model = await startFakeModel({
    reply: "Here is a short plan for the week, built from your reading list.",
    thinkMs: 600,
    wordMs: 40,
  });
  try {
    const { window } = loam;
    await createNote(window, { title: "Week", body: "Plan." });
    const panel = await openChatWith(window, model.baseUrl);
    const message = panel.getByRole("combobox", { name: "Message" });
    await message.click();

    // A long paste goes as a file of its own.
    await window.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "Read chapter 7. ".repeat(400));
      document
        .querySelector('[aria-label="Side chat"] textarea')!
        .dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
    });
    await expect(panel.getByRole("list", { name: "Files to send" })).toContainText(
      "Pasted text.txt",
    );
    await message.fill("Plan my week");
    await message.press("Enter");

    await expect(panel.getByText("Thinking")).toBeVisible();
    await expect(panel.getByText("built from your reading list.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Copy answer" })).toBeVisible();
    await expect(panel.getByRole("list", { name: "Files sent" })).toContainText("Pasted text.txt");

    // The service got the message, with the pasted text as a file in it.
    const sent = JSON.stringify(model.requests[0]!.messages.at(-1)!.content);
    expect(sent).toContain("Plan my week");
    expect(sent).toContain('<file name=\\"Pasted text.txt\\">');
  } finally {
    await model.close();
  }
});
