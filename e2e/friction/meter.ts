import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

/**
 * Keystroke-Level Model operator times in seconds (Card, Moran and Newell), for an average
 * typist. They turn a scripted flow's inputs into an estimate of how long a person takes,
 * which the machine's own elapsed time can't show.
 */
const KLM = { keystroke: 0.28, point: 1.1, button: 0.1, home: 0.4, mental: 1.35 };

const RESULTS_DIRECTORY = join(import.meta.dirname, "..", "..", "tmp", "friction");

type Device = "keyboard" | "mouse";

/** One flow's measured cost. */
export type FlowResult = {
  job: string;
  flow: string;
  perWeek: number;
  /** Discrete key presses; a chord such as Ctrl+Shift+F is one. */
  keystrokes: number;
  /** Characters typed as content (a title, a search word). */
  typed: number;
  clicks: number;
  /** Points where the person has to stop and choose or work something out. */
  decisions: number;
  /** Switches between keyboard and mouse. */
  handSwitches: number;
  /** Time spent waiting on the app, measured. */
  waitMs: number;
  /** The script's wall-clock time from first input to done, measured. */
  elapsedMs: number;
  /** KLM estimate of a person's time, plus the measured waits. */
  humanSeconds: number;
  /** humanSeconds without typing the content itself: the cost the app adds. */
  overheadSeconds: number;
  /** Steps that need the mouse because no key reaches them. */
  mouseOnly: string[];
  /** The decisions, in order, in the person's words. */
  thinking: string[];
  log: string[];
};

/**
 * Drives the app as a person would and counts what it costs them. Every input goes through
 * the meter so a flow's numbers can be compared before and after a change.
 */
export class Meter {
  private readonly started = performance.now();
  private device: Device | null = null;
  private keyCount = 0;
  private typedCount = 0;
  private clickCount = 0;
  private handSwitches = 0;
  private waited = 0;
  private klmSeconds = 0;
  private contentSeconds = 0;
  private readonly mouseOnly: string[] = [];
  private readonly thinking: string[] = [];
  private readonly log: string[] = [];

  constructor(
    private page: Page | null,
    private readonly job: string,
    private readonly flow: string,
    /** How often a typical person does this, per week: the frequency in frequency × pain. */
    private readonly perWeek: number,
  ) {}

  private get window() {
    if (!this.page) throw new Error("The meter has no window; attach one first.");
    return this.page;
  }

  /** Points the meter at a window that opened after it started. */
  attach(page: Page) {
    this.page = page;
  }

  /** A click on the app's icon, then the wait until `start` has the app taking input. */
  async launch(start: () => Promise<void>) {
    this.use("mouse");
    this.clickCount++;
    this.klmSeconds += KLM.point + KLM.button * 2;
    this.log.push("click: the app's icon");
    await this.waitFor("app starts", start);
  }

  private use(device: Device) {
    if (this.device && this.device !== device) {
      this.handSwitches++;
      this.klmSeconds += KLM.home;
    }
    this.device = device;
  }

  /** A person stops to decide or recall something. */
  decide(question: string) {
    this.thinking.push(question);
    this.klmSeconds += KLM.mental;
    this.log.push(`think: ${question}`);
  }

  /** One key or chord, e.g. "ControlOrMeta+Shift+f". */
  async press(key: string, why = "") {
    this.use("keyboard");
    this.keyCount++;
    // Each key held in a chord is a keystroke for the model.
    this.klmSeconds += KLM.keystroke * key.split("+").length;
    this.log.push(`key ${key}${why ? ` (${why})` : ""}`);
    await this.window.keyboard.press(key);
  }

  /** Types content where the focus is. */
  async type(text: string, why = "") {
    this.use("keyboard");
    this.typedCount += text.length;
    this.klmSeconds += KLM.keystroke * text.length;
    this.contentSeconds += KLM.keystroke * text.length;
    this.log.push(`type "${text}"${why ? ` (${why})` : ""}`);
    await this.window.keyboard.type(text);
  }

  /**
   * Points at and clicks `target`. `mouseOnly` names the step when nothing on the keyboard
   * reaches it.
   */
  async click(
    target: Locator,
    why: string,
    options: { button?: "left" | "right"; mouseOnly?: boolean } = {},
  ) {
    this.use("mouse");
    this.clickCount++;
    this.klmSeconds += KLM.point + KLM.button * 2;
    if (options.mouseOnly) this.mouseOnly.push(why);
    this.log.push(`${options.button === "right" ? "right-click" : "click"}: ${why}`);
    await target.click(options.button ? { button: options.button } : {});
  }

  /** Scrolls a list with the wheel until `target` is in view, counting each flick. */
  async scrollTo(list: Locator, target: Locator, why: string) {
    this.use("mouse");
    let flicks = 0;
    await list.hover();
    while (!(await target.isVisible()) && flicks < 400) {
      await this.window.mouse.wheel(0, 600);
      flicks++;
      this.klmSeconds += 0.3;
    }
    this.log.push(`scroll x${flicks}: ${why}`);
    return flicks;
  }

  /** Waits for the app to show something, counting the time as the person's wait. */
  async waitFor(what: string, until: () => Promise<unknown>) {
    const start = performance.now();
    await until();
    const ms = performance.now() - start;
    this.waited += ms;
    this.log.push(`wait ${Math.round(ms)}ms: ${what}`);
    return ms;
  }

  /** Checks something for the script that the person doesn't wait for, such as autosave. */
  async check(until: () => Promise<unknown>) {
    await until();
  }

  /** Notes a fact about the screen in the result's log. */
  observe(fact: string) {
    this.log.push(`seen: ${fact}`);
  }

  /** Writes the result for the report and returns it. */
  finish(): FlowResult {
    const result: FlowResult = {
      job: this.job,
      flow: this.flow,
      perWeek: this.perWeek,
      keystrokes: this.keyCount,
      typed: this.typedCount,
      clicks: this.clickCount,
      decisions: this.thinking.length,
      handSwitches: this.handSwitches,
      waitMs: Math.round(this.waited),
      elapsedMs: Math.round(performance.now() - this.started),
      humanSeconds: Math.round((this.klmSeconds + this.waited / 1000) * 10) / 10,
      overheadSeconds:
        Math.round((this.klmSeconds - this.contentSeconds + this.waited / 1000) * 10) / 10,
      mouseOnly: this.mouseOnly,
      thinking: this.thinking,
      log: this.log,
    };
    mkdirSync(RESULTS_DIRECTORY, { recursive: true });
    const file = `${this.job}--${this.flow}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    writeFileSync(join(RESULTS_DIRECTORY, `${file}.json`), JSON.stringify(result, null, 2));
    return result;
  }
}
