import type { Api, Element, Register } from "@loam/plugin-api";

import {
  addTodo,
  checklistMarkdown,
  clearDone,
  doneTodos,
  dueOf,
  dueState,
  openTodos,
  readTodos,
  removeTodo,
  setDone,
  updateTodo,
  type Todo,
} from "./todos";

/*
 * A todo list in a pane, kept in the plugin's storage: add, check off, edit and delete todos,
 * each with an optional due date. "Add todo" in the palette asks for one without opening it.
 */

const PANE = "todos";
const KEY = "todos";

const isoToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const dueLabel = (due: string, today: string) => {
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!).toLocaleDateString([], { month: "short", day: "numeric" });
  const state = dueState(due, today);
  return state === "today" ? "Today" : state === "overdue" ? `Overdue · ${date}` : date;
};

/** Names a todo in a button's label, which holds 120 characters. */
const named = (verb: string, todo: Todo) =>
  `${verb} ${todo.text.length > 100 ? `${todo.text.slice(0, 100)}…` : todo.text}`;

export const register: Register = (on) => {
  let todos: Todo[] = [];
  let loaded: Promise<void> | null = null;
  // What an open edit holds; kept here so typing doesn't draw the pane again.
  let editText = "";
  let editDue = "";

  const load = ($: Api) =>
    (loaded ??= $.store.get(KEY).then((value) => {
      todos = readTodos(value);
    }));

  const save = async ($: Api, next: Todo[]) => {
    todos = next;
    await $.store.set(KEY, todos);
    await $.ui.invalidate();
  };

  const open = ($: Api) => $.ui.open({ id: PANE, title: "Todos" });

  const quickAdd = async ($: Api) => {
    const text = await $.ui.prompt({ title: "Add todo", placeholder: "What needs doing?" });
    if (!text?.trim()) return;
    await load($);
    await save($, addTodo(todos, text, null, Date.now()));
    await $.ui.toast(`Added "${text.trim().slice(0, 80)}".`, { tone: "success" });
  };

  const row = ($: Api, todo: Todo, today: string, editing: boolean): Element => {
    if (editing)
      return (
        <Box surface padding={2} gap={2}>
          <Input
            label="Todo"
            value={editText}
            onChange={(value) => {
              editText = value;
            }}
            onSubmit={async (value) => {
              editText = value;
              if (!value.trim()) return;
              await $.state.set("editing", null);
              await save(
                $,
                updateTodo(todos, todo.id, { text: value.trim(), due: dueOf(editDue) }),
              );
            }}
          />
          <Box direction="row" gap={2} align="center">
            <Text size="xs" tone="muted">
              Due
            </Text>
            <Input
              type="date"
              label="Due date"
              value={editDue}
              onChange={(value) => {
                editDue = value;
              }}
            />
          </Box>
          <Box direction="row" gap={2} justify="end">
            <Button variant="ghost" onPress={() => $.state.set("editing", null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              onPress={async () => {
                if (!editText.trim()) return;
                await $.state.set("editing", null);
                await save(
                  $,
                  updateTodo(todos, todo.id, { text: editText.trim(), due: dueOf(editDue) }),
                );
              }}
            >
              Save
            </Button>
          </Box>
        </Box>
      );
    const state = todo.due ? dueState(todo.due, today) : null;
    return (
      <Box direction="row" gap={1} align="center">
        <Box grow>
          <Checkbox
            label={todo.text}
            checked={todo.done}
            onChange={(checked) => save($, setDone(todos, todo.id, checked, Date.now()))}
          />
        </Box>
        {todo.due && !todo.done ? (
          <Badge tone={state === "overdue" ? "danger" : state === "today" ? "warning" : "muted"}>
            {dueLabel(todo.due, today)}
          </Badge>
        ) : null}
        {todo.done ? null : (
          <Button
            variant="ghost"
            icon="pencil"
            label={named("Edit", todo)}
            onPress={async () => {
              editText = todo.text;
              editDue = todo.due ?? "";
              await $.state.set("editing", todo.id);
            }}
          />
        )}
        <Button
          variant="ghost"
          icon="trash"
          label={named("Delete", todo)}
          onPress={() => save($, removeTodo(todos, todo.id))}
        />
      </Box>
    );
  };

  on("app.ready", async ($) => {
    await $.commands.register({ id: "add", title: "Add todo" });
    await $.commands.register({ id: "open", title: "Open todos" });
    await $.editor.registerSlashItem({
      id: "todos",
      title: "Open todos",
      subtext: "Insert your open todos as a checklist.",
      aliases: ["todo", "todos", "tasks", "checklist"],
    });
  });

  on("command.run", { command: "open" }, async ($) => {
    await open($);
  });

  // The question waits on the user, longer than a hook may run, so the hook doesn't wait for it.
  on("command.run", { command: "add" }, ($) => {
    void quickAdd($);
  });

  on("ui.render", { slot: "sidebar.footer" }, async ($) => (
    <Button variant="ghost" icon="check" label="Todos" onPress={() => open($)} />
  ));

  on("ui.render", { slot: "pane", props: { pane: PANE } }, async ($) => {
    await load($);
    const today = isoToday();
    const editing = await $.state.get<string>("editing");
    const showDone = (await $.state.get<boolean>("showDone")) ?? false;
    const newDue = (await $.state.get<string>("newDue")) ?? "";
    const open = openTodos(todos);
    const done = doneTodos(todos);

    return (
      <Box gap={3}>
        <Box gap={2}>
          <Input
            label="New todo"
            placeholder="Add a todo and press Enter"
            clearOnSubmit
            onSubmit={async (text) => {
              if (!text.trim()) return;
              await $.state.set("newDue", null);
              await save($, addTodo(todos, text, dueOf(newDue), Date.now()));
            }}
          />
          <Box direction="row" gap={2} align="center">
            <Text size="xs" tone="muted">
              Due
            </Text>
            <Input
              type="date"
              label="Due date for the new todo"
              value={newDue}
              onChange={(value) => $.state.set("newDue", value || null)}
            />
          </Box>
        </Box>
        <Box gap={1}>
          {open.length ? (
            open.map((todo) => row($, todo, today, editing === todo.id))
          ) : (
            <Text tone="muted">Nothing to do.</Text>
          )}
        </Box>
        {done.length ? (
          <Box gap={1}>
            <Divider />
            <Box direction="row" align="center" justify="between">
              <Button
                variant="ghost"
                icon={showDone ? "chevron-down" : "chevron-right"}
                onPress={() => $.state.set("showDone", !showDone)}
              >
                {`Done (${done.length})`}
              </Button>
              <Button variant="ghost" icon="trash" onPress={() => save($, clearDone(todos))}>
                Clear done
              </Button>
            </Box>
            {showDone ? done.map((todo) => row($, todo, today, false)) : null}
          </Box>
        ) : null}
      </Box>
    );
  });

  on("slash.run", { item: "todos" }, async ($) => {
    await load($);
    const markdown = checklistMarkdown(todos);
    if (!markdown) await $.ui.toast("You have no open todos.");
    return { markdown };
  });
};
