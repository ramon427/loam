import type { Api, Register } from "@loam/plugin-api";

const format = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export const register: Register = (on, options) => {
  const length =
    (typeof options.minutes === "number" && options.minutes > 0 ? options.minutes : 25) * 60;
  let timer: ReturnType<typeof setInterval> | undefined;

  const open = ($: Api) => $.ui.open({ id: "timer", title: "Focus timer" });

  const start = ($: Api) => {
    clearInterval(timer);
    timer = setInterval(async () => {
      const left = ((await $.state.get<number>("left")) ?? length) - 1;
      await $.state.set("left", Math.max(0, left));
      if (left <= 0) {
        clearInterval(timer);
        timer = undefined;
        await $.state.set("running", false);
        await $.ui.toast("Time for a break.", { tone: "success" });
      }
    }, 1000);
    return $.state.set("running", true);
  };

  const pause = ($: Api) => {
    clearInterval(timer);
    timer = undefined;
    return $.state.set("running", false);
  };

  on("app.ready", async ($) => {
    await $.commands.register({ id: "open", title: "Open focus timer" });
  });

  on("command.run", { command: "open" }, async ($) => {
    await open($);
  });

  on("ui.render", { slot: "sidebar.footer" }, async ($) => (
    <Button variant="ghost" size="sm" icon="timer" label="Focus timer" onPress={() => open($)}>
      Focus
    </Button>
  ));

  on("ui.render", { slot: "pane", props: { pane: "timer" } }, async ($) => {
    const left = (await $.state.get<number>("left")) ?? length;
    const running = (await $.state.get<boolean>("running")) ?? false;
    return (
      <Box gap={3} align="center">
        <Text size="md" weight="semibold" mono>
          {format(left)}
        </Text>
        <Box direction="row" gap={2}>
          {running ? (
            <Button icon="timer" onPress={() => pause($)}>
              Pause
            </Button>
          ) : (
            <Button variant="default" icon="play" onPress={() => start($)}>
              Start
            </Button>
          )}
          <Button
            variant="ghost"
            icon="refresh"
            label="Reset"
            onPress={async () => {
              await pause($);
              await $.state.set("left", length);
            }}
          />
        </Box>
      </Box>
    );
  });
};
