// The plan (DESIGN §5.7): update_plan in both protocols, how it rides along with an
// action, and how it survives compaction, rewind and export.
// Run: node tests/plan.test.mjs
import { check, section, report } from "./check.mjs";
import X from "./extract.mjs";

const F = "```";
const call = (name, args, id) => ({ id: id === undefined ? "id_" + name : id, name, arguments: typeof args === "string" ? args : JSON.stringify(args) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const PLAN = [{ step: "Read data.csv", status: "completed" }, { step: "Compute the totals", status: "in_progress" }, { step: "Write report.md", status: "pending" }];

section("1. cleanPlan and the checklist");
{
    check("a clean plan passes as it is", same(X.cleanPlan(PLAN).plan, PLAN));
    const r = X.cleanPlan([{ step: "  a\n b ", status: "Done" }, { step: "c", status: "in-progress" }, { step: "d", status: "weird" }, { step: "", status: "pending" }, "e", null, { status: "completed" }]);
    check("whitespace collapsed, synonyms mapped, empty steps dropped, strings taken", same(r.plan, [{ step: "a b", status: "completed" }, { step: "c", status: "in_progress" }, { step: "d", status: "pending" }, { step: "e", status: "pending" }]), JSON.stringify(r));
    check("not a list → an error naming the shape", /update_plan needs plan: a list of/.test(X.cleanPlan("do it").error));
    check("no steps left → the same error", !!X.cleanPlan([{ status: "pending" }]).error);
    const long = X.cleanPlan(Array.from({ length: 15 }, (_, i) => ({ step: "s" + i, status: "pending" })));
    check("more than 12 steps: the first 12 kept, with a warning", long.plan.length === 12 && /first 12 steps/.test(long.warning));
    check("a long step is clipped", X.cleanPlan([{ step: "x".repeat(500), status: "pending" }]).plan[0].step.length === 200);

    check("formatPlan writes the checklist", X.formatPlan(PLAN) === "- [x] Read data.csv\n- [>] Compute the totals\n- [ ] Write report.md");
    check("parsePlanText reads it back", same(X.parsePlanText(X.formatPlan(PLAN)).plan, PLAN));
    check("other marks: [X] done, [~] [-] [*] [/] in progress, a bare bullet or number to do",
        same(X.parsePlanText("* [X] a\n1. [~] b\n- [-] c\n[*] d\n- [/] e\n- f\n2) g\nprose line").plan.map(p => p.status),
            ["completed", "in_progress", "in_progress", "in_progress", "in_progress", "pending", "pending"]));
    check("no steps → an error in the tag's own terms", /<update_plan> had no steps/.test(X.parsePlanText("just words").error));
    check("planProgress", X.planProgress(PLAN) === "1 of 3 done");
}

section("2. Code-as-action: <update_plan> rides along");
{
    const tag = `<update_plan>\n${X.formatPlan(PLAN)}\n</update_plan>`;
    let r = X.parseReply(`Let me compute.\n${tag}\n${F}python\nprint(1)\n${F}`);
    check("with code: the code runs, the plan comes along", r.kind === "code" && r.code === "print(1)\n" && same(r.plan, PLAN), JSON.stringify(r));
    check("…and the tag isn't in the prose", r.prose === "Let me compute.");
    r = X.parseReply(`${tag}\n<read_file path="a.txt"/>`);
    check("with file actions", r.kind === "files" && r.actions.length === 1 && same(r.plan, PLAN));
    r = X.parseReply(`${tag}\nask: Which year?\n- 2025\n- 2026`);
    check("with ask:", r.kind === "ask" && r.options.length === 2 && same(r.plan, PLAN));
    r = X.parseReply(tag);
    check("alone: kind plan", r.kind === "plan" && same(r.plan, PLAN) && r.prose === "");
    r = X.parseReply(`I'll start by reading the data.\n${tag}`);
    check("with prose while steps are open: kind plan, not a final answer", r.kind === "plan" && r.prose === "I'll start by reading the data.");
    const done = PLAN.map(p => ({ ...p, status: "completed" }));
    r = X.parseReply(`<update_plan>\n${X.formatPlan(done)}\n</update_plan>\nThe totals are in **report.md**.`);
    check("with prose and every step done: the final answer", r.kind === "final" && r.answer === "The totals are in **report.md**." && same(r.plan, done));
    r = X.parseReply(`${tag}\nmore`.replace("</update_plan>", ""));
    check("unclosed: broken, naming the tag", r.kind === "broken" && r.unclosed === "update_plan");
    r = X.parseReply(`<update_plan>\nnothing here\n</update_plan>\n${F}python\nprint(2)\n${F}`);
    check("an unreadable plan doesn't stop the code; the error comes along", r.kind === "code" && !r.plan && /no steps/.test(r.planError));
    r = X.parseReply(`<update_plan>\n- [ ] old\n</update_plan>\n${tag}\nDone?`);
    check("two plans: the last one counts", same(r.plan, PLAN));
    r = X.parseReply(`<write_file path="notes.md">\n<update_plan>\n- [ ] not a plan, file content\n</update_plan>\n</write_file>`);
    check("a plan tag inside a file's content is content", r.kind === "files" && !r.plan && r.actions[0].args.content.includes("<update_plan>"));
    r = X.parseReply(`${F}python\nprint(3)\n${F}`);
    check("no tag: no plan fields", r.kind === "code" && !("plan" in r) && !("planError" in r));
    check("the advice for kind plan says nothing else ran", /Nothing but the plan ran/.test(X.noActionAdvice({ kind: "plan" }, false)) && /finish/.test(X.noActionAdvice({ kind: "plan" }, true)));
}

section("3. Native: update_plan rides along");
{
    const plan = call("update_plan", { plan: PLAN });
    let r = X.parseToolCalls([plan, call("run_python", { code: "print(1)" })], "", "tool_calls", 3);
    check("with run_python: the code runs", r.kind === "code" && r.code === "print(1)\n" && same(r.plan, PLAN), JSON.stringify(r));
    check("…both calls stay in the history, nothing is skipped", r.stored.map(c => c.name).join() === "update_plan,run_python" && r.skipped.length === 0);
    check("…the plan call gets its own result", same(r.planResults, [["id_update_plan", "Plan updated (1 of 3 done)."]]));
    r = X.parseToolCalls([call("read_file", { path: "a" }, "r1"), plan, call("read_file", { path: "b" }, "r2")], "", "tool_calls", 3);
    check("between file calls: they still run as one batch", r.kind === "files" && r.actions.map(a => a.id).join() === "r1,r2" && r.skipped.length === 0);
    r = X.parseToolCalls([plan], "Starting.", "tool_calls", 3);
    check("alone: kind plan, the call kept", r.kind === "plan" && r.stored.length === 1 && r.prose === "Starting." && same(r.plan, PLAN));
    r = X.parseToolCalls([plan, call("finish", { answer: "All done." })], "", "tool_calls", 3);
    check("with finish: the final answer, the plan still counts", r.kind === "final" && r.answer === "All done." && same(r.plan, PLAN) && r.stored.map(c => c.name).join() === "finish");
    r = X.parseToolCalls([plan, call("ask_user", { question: "Which?" })], "", "tool_calls", 3);
    check("with ask_user", r.kind === "ask" && r.question === "Which?" && same(r.plan, PLAN));
    r = X.parseToolCalls([call("update_plan", { plan: "read, then write" }), call("run_python", { code: "x=1" })], "", "tool_calls", 3);
    check("bad arguments: the code still runs; the plan call's result says why", r.kind === "code" && !r.plan && /^ERROR: update_plan needs plan/.test(r.planResults[0][1]) && /not changed/.test(r.planResults[0][1]));
    r = X.parseToolCalls([call("update_plan", { plan: [{ step: "old", status: "pending" }] }, "p1"), call("update_plan", { plan: PLAN }, "p2")], "", "tool_calls", 3);
    check("two plan calls: the last counts, the first is told so", same(r.plan, PLAN) && /later update_plan call/.test(r.planResults[0][1]) && r.planResults[1][0] === "p2");
    r = X.parseToolCalls([plan, call("nonsense", {})], "", "tool_calls", 3);
    check("with an unknown tool: badcall, the plan applied, update_plan not skipped", r.kind === "badcall" && same(r.plan, PLAN) && r.skipped.length === 1 && r.skipped[0][0] === "id_nonsense");
    check("unknown tools are told update_plan exists", /update_plan/.test(r.skipped[0][1]));
    r = X.parseToolCalls([call("run_python", { code: "a" }), call("run_python", { code: "b" }, "r2"), plan], "", "tool_calls", 3);
    check("a second run_python is still skipped, the plan isn't", r.skipped.length === 1 && r.skipped[0][0] === "r2" && same(r.plan, PLAN));
    const defs = X.agentToolDefs();
    const d = defs.find(x => x.function.name === "update_plan");
    check("tool definition: update_plan(plan) with step and status", d && same(d.function.parameters.required, ["plan"]) && same(d.function.parameters.properties.plan.items.properties.status.enum, ["pending", "in_progress", "completed"]));
    const text = X.toolCallAsText({ function: { name: "update_plan", arguments: JSON.stringify({ plan: PLAN }) } });
    check("as text: the code-as-action tag, which parses back", text === `<update_plan>\n${X.formatPlan(PLAN)}\n</update_plan>` && same(X.parseReply(text).plan, PLAN));
}

section("4. Prompts");
{
    const text = X.buildSystemPrompt("", [], "text", 60), tools = X.buildSystemPrompt("", [], "tools", 60);
    check("code-as-action shows the tag and when to use it", text.includes("<update_plan>\n- [x]") && /more than three or four steps/.test(text) && /Skip it for short tasks/.test(text));
    check("…and says any reply may carry it", /Any of these may also carry your plan/.test(text));
    check("native names the tool and that it rides along", /- update_plan: keeps your plan/.test(tools) && /An update_plan call can go along with any of them/.test(tools));
}

section("5. Compaction, rewind, export");
{
    const msgs = [{ role: "system", content: "S" }, { role: "user", content: "Task: x" }, { role: "assistant", content: "a1" }, { role: "user", content: "o1" }, { role: "assistant", content: "a2" }, { role: "user", content: "o2" }];
    const out = X.buildCompactedMessages(msgs, 4, "SUM", 1, [], { plan: PLAN, n: 2 });
    check("a compaction carries the current plan", out[1].content.endsWith(`Your plan, as your last update_plan (step 2) left it:\n${X.formatPlan(PLAN)}`), out[1].content);
    check("…and nothing without one", !X.buildCompactedMessages(msgs, 4, "SUM", 1, [], null)[1].content.includes("Your plan"));

    const tl = [{ type: "task", text: "x" }, { type: "step", n: 1, plan: [{ step: "old", status: "pending" }] }, { type: "step", n: 2, plan: PLAN }, { type: "step", n: 3 }, { type: "note", text: "n" }];
    check("currentPlan: the last step that set one", same(X.currentPlan(tl), { plan: PLAN, n: 2 }));
    check("…after a rewind to step 1 (the timeline cut), that step's plan", same(X.currentPlan(tl.slice(0, 2)).plan, [{ step: "old", status: "pending" }]));
    check("…none before any plan", X.currentPlan(tl.slice(0, 1)) === null && X.currentPlan([]) === null);

    const raw = { task: "x", messages: [{ role: "system", content: "S" }], timeline: [{ type: "step", n: 1, phase: "done", plan: [...PLAN, { step: "<b>x</b>", status: "evil" }, 42, { step: { no: 1 } }], planError: "bad" }] };
    const back = X.validateSession(raw).timeline[0];
    check("import keeps a step's plan, cleaned (text stays text, unknown status → to do, non-steps dropped)", same(back.plan, [...PLAN, { step: "<b>x</b>", status: "pending" }]), JSON.stringify(back.plan));
    check("…and its plan error", back.planError === "bad");
    check("…a plan that isn't one is dropped", !("plan" in X.validateSession({ ...raw, timeline: [{ type: "step", n: 1, plan: "nope" }] }).timeline[0]));
    const md = X.transcriptMarkdown({ timeline: [{ type: "step", n: 1, kind: "final", content: "Done.", plan: PLAN }] });
    check("the transcript shows a final step's plan", md.includes(`Updated the plan (1 of 3 done):\n\n${X.formatPlan(PLAN)}`), md);
}

section("6. The one reminder, from step 2 on");
{
    check("before step 2: nothing", X.planReminder(1, false, false, 2) === "" && X.planReminder(1, false, true, 2) === "");
    const text = X.planReminder(2, false, false, 2), native = X.planReminder(2, false, true, 2);
    check("at step 2 with no plan, code-as-action: the <update_plan> block", /send your plan now in an <update_plan> block/.test(text) && !/with update_plan \(/.test(text), text);
    check("…native: the update_plan call", /send your plan now with update_plan \(it can go along with your next call\)/.test(native) && !/<update_plan>/.test(native), native);
    check("…both say it can be skipped near the end", /Skip it if you are nearly done/.test(text) && /Skip it if you are nearly done/.test(native));
    check("a plan already exists: nothing", X.planReminder(2, true, false, 2) === "" && X.planReminder(2, true, true, 2) === "");
    check("not sent yet after step 2 (step 2 ran nothing): the first step that runs something gets it", X.planReminder(3, false, false, 2, false) !== "" && X.planReminder(10, false, true, 2, false) !== "");
    check("…once only: after it was sent, nothing", X.planReminder(3, false, false, 2, true) === "" && X.planReminder(10, false, true, 2, true) === "");
    check("the step comes from the argument", X.planReminder(4, false, true, 4) !== "" && X.planReminder(2, false, true, 4) === "");
    const kept = X.validateSession({ task: "x", messages: [{ role: "system", content: "S" }], timeline: [{ type: "step", n: 2, phase: "done", planReminded: true }, { type: "step", n: 3, phase: "done", planReminded: "yes" }] }).timeline;
    check("import keeps that a step carried the reminder (only a true)", kept[0].planReminded === true && !("planReminded" in kept[1]));
}

section("7. Plan first");
{
    const tl = (...extra) => [{ type: "task", text: "x" }, { type: "step", n: 1 }, ...extra];
    check("other levels pass through", X.effectiveAutonomy("risk", tl()) === "risk" && X.effectiveAutonomy("approve", tl()) === "approve" && X.effectiveAutonomy("autopilot", []) === "autopilot");
    check("Plan first before an approval: plan", X.effectiveAutonomy("plan", tl({ type: "note", planAsk: true, text: "ready" })) === "plan");
    check("…after the approval note: risk-based", X.effectiveAutonomy("plan", tl({ type: "note", planApproved: true, text: "ok" })) === "risk");
    check("…a rewind past it (the timeline cut) takes it back", X.effectiveAutonomy("plan", tl({ type: "note", planApproved: true }).slice(0, 2)) === "plan");
    check("the model is told to look around and send a plan first", /plan before anything changes/.test(X.PLAN_FIRST_NOTE) && /run Python that only reads/.test(X.PLAN_FIRST_NOTE));
    check("a rolled-back change says why", /hasn't approved your plan yet/.test(X.PLAN_FIRST_REJECT));
    const v = X.validateSession({ task: "x", messages: [{ role: "system", content: "S" }], timeline: [{ type: "note", text: "a", planAsk: true }, { type: "note", text: "b", planApproved: true }, { type: "note", text: "c", planApproved: "yes" }], settings: { autonomy: "plan" } });
    check("import keeps the approval and the review note (only a true), and the level", v.timeline[0].planAsk === true && v.timeline[1].planApproved === true && !("planApproved" in v.timeline[2]) && v.settings.autonomy === "plan");
}

report();
