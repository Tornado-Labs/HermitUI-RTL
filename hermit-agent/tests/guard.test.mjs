// The loop guard (DESIGN §5.8): a third identical action in a row isn't run, a fourth
// pauses the run. The compaction thrash guard (DESIGN §5.4): compacting nearly every
// step pauses the run. The error-repeat guard (DESIGN §5.8): the same error three times
// in a row gets advice, five pause the run. Run: node tests/guard.test.mjs
import { check, section, report } from "./check.mjs";
import X from "./extract.mjs";

section("1. actionSignature");
{
    const code = (c) => X.actionSignature({ kind: "code", code: c });
    check("code: the same code, whitespace around it aside, is the same action", code("print(1)\n") === code("  print(1)") && code("print(1)") !== code("print(2)"));
    const files = (actions) => X.actionSignature({ kind: "files", actions });
    const read = { tool: "read_file", args: { path: "a.txt" } };
    check("file actions: tool and arguments count, call ids don't", files([{ ...read, id: "x" }]) === files([{ ...read, id: "y" }]) && files([read]) !== files([{ tool: "read_file", args: { path: "b.txt" } }]));
    check("code and file actions never match", code("a") !== files([read]));
    check("a reply that runs nothing has none", X.actionSignature({ kind: "final", answer: "x" }) === "" && X.actionSignature({ kind: "plan" }) === "" && X.actionSignature(null) === "");
}

section("2. repeatsBefore");
{
    const step = (sig) => ({ type: "step", sig });
    check("counts the same action in the steps right before", X.repeatsBefore([step("b"), step("a"), step("a")], "a") === 2);
    check("a different action ends the count", X.repeatsBefore([step("a"), step("b"), step("a")], "a") === 1);
    check("a note or a compaction in between ends it too", X.repeatsBefore([step("a"), { type: "note", text: "try x" }, step("a")], "a") === 1 && X.repeatsBefore([step("a"), { type: "compaction" }], "a") === 0);
    check("a step that ran nothing (no sig) ends it", X.repeatsBefore([step("a"), { type: "step" }, step("a")], "a") === 1);
    check("nothing before: 0", X.repeatsBefore([], "a") === 0);
}

section("3. repeatAdvice");
{
    const t = X.repeatAdvice("code", 2, false), n = X.repeatAdvice("files", 2, true);
    check("says it was not run, and why", /same code as your last 2 steps, so it was not run again/.test(t), t);
    check("file actions are named as such", /same set of file actions/.test(n));
    check("points to asking the user in each protocol's terms", /ask the user \(ask:\)/.test(t) && /call ask_user/.test(n));
    check("the limit is 3", X.LIMITS.repeatLimit === 3);
}

section("4. compactionThrashing");
{
    const S = { type: "step" }, C = { type: "compaction", reason: "threshold" };
    check("three automatic compactions within 4 steps: thrashing", X.compactionThrashing([S, C, S, C, S, S, C], 3, 4) === true);
    check("spread over more steps: not", X.compactionThrashing([C, S, S, S, S, S, C, S, C], 3, 4) === false);
    check("two are not enough", X.compactionThrashing([S, C, S, C], 3, 4) === false);
    check("a manual compaction doesn't count", X.compactionThrashing([C, S, { type: "compaction", reason: "manual" }, S, C], 3, 4) === false);
    check("overflow and context cuts count", X.compactionThrashing([{ type: "compaction", reason: "overflow" }, S, { type: "compaction", reason: "context" }, C], 3, 4) === true);
    check("the note that paused for it starts the count afresh", X.compactionThrashing([C, S, C, { type: "note", thrash: true }, S, C], 3, 4) === false);
    check("the limits are 3 compactions within 4 steps", X.LIMITS.thrashCompactions === 3 && X.LIMITS.thrashSteps === 4);
    check("an import keeps the note's flag (only a true)", X.validateSession({ task: "x", messages: [{ role: "system", content: "S" }], timeline: [{ type: "note", text: "t", thrash: true }, { type: "note", text: "u", thrash: 1 }] }).timeline.map(t => t.thrash).join() === "true,");
}

section("5. errorSignature");
{
    const edit = (ok, path = "a.py") => ({ tool: "edit_file", path, ok });
    const files = (...fileActions) => X.errorSignature({ status: "error", fileActions });
    check("file actions: the failing ones' tool and path", files({ tool: "read_file", path: "a.py", ok: true }, edit(false)) === "files:edit_file a.py");
    check("…the same whatever the message says", X.errorSignature({ status: "error", fileActions: [{ ...edit(false), message: "<old> was not found" }] }) === X.errorSignature({ status: "error", fileActions: [{ ...edit(false), message: "<old> differs only in whitespace" }] }));
    check("…another file is another error", files(edit(false)) !== files(edit(false, "b.py")));
    const code = (output) => X.errorSignature({ status: "error", output });
    check("code: the last line it printed (the exception)", code("rows: 3\nTraceback (most recent call last):\n  File \"<step>\", line 4\nKeyError: 'Region'\n\n") === "code:KeyError: 'Region'");
    check("…the same exception from other code is the same error", code("Traceback\n  File \"<step>\", line 9\nKeyError: 'Region'") === code("Traceback\n  File \"<step>\", line 2\nKeyError: 'Region'"));
    check("…no output still has one", code("") === "code:");
    check("a step that didn't fail has none", X.errorSignature({ status: "ok", output: "x" }) === "" && X.errorSignature({ status: "rejected", fileActions: [edit(false)] }) === "" && X.errorSignature({ status: "timeout", output: "x" }) === "" && X.errorSignature(null) === "");
}

section("6. errorRunBefore");
{
    const step = (errSig, status = "error") => ({ type: "step", errSig, status });
    check("counts the same error in the steps right before", X.errorRunBefore([step("b"), step("a"), step("a")], "a") === 2);
    check("another error, or a step that worked, ends the count", X.errorRunBefore([step("a"), step("b"), step("a")], "a") === 1 && X.errorRunBefore([step("a"), step(undefined, "ok"), step("a")], "a") === 1);
    check("a step the loop guard didn't run, or a plan-only reply, is passed over", X.errorRunBefore([step("a"), step(undefined, "repeat"), step("a"), step(undefined, "plan")], "a") === 2);
    check("a note (the pause, or the user's) or a compaction ends it", X.errorRunBefore([step("a"), { type: "note", text: "paused" }, step("a")], "a") === 1 && X.errorRunBefore([step("a"), { type: "compaction" }], "a") === 0);
    check("nothing before: 0", X.errorRunBefore([], "a") === 0);
}

section("7. errorRepeatAdvice and withObservationNote");
{
    const f = X.errorRepeatAdvice("files:edit_file a.py", 3, false), c = X.errorRepeatAdvice("code:KeyError: 'Region'", 4, true);
    check("names the failing actions and the count", /Your file actions \(edit_file a\.py\) have now failed 3 times in a row/.test(f), f);
    check("a failing edit_file gets the way out: read_file again, or write_file", /read the file again with read_file/.test(f) && /write_file/.test(f));
    check("…other file actions don't", !/read_file/.test(X.errorRepeatAdvice("files:move_file a.py", 3, false)));
    check("code: names the error", /failed 4 times in a row with the same error \(KeyError: 'Region'\)/.test(c), c);
    check("points to asking the user in each protocol's terms", /ask the user \(ask:\)/.test(f) && /call ask_user/.test(c));
    const obs = X.withObservationNote(X.buildObservation({ step: 3, status: "error", output: "boom $&", notes: ["a"] }), "b $1");
    check("the note goes in before the closing tag, $ kept literally", obs.endsWith("note: a\nnote: b $1\n</observation>") && obs.includes("boom $&"), obs);
    check("the limits: advice at 3, a pause at 5", X.LIMITS.errorRepeatWarn === 3 && X.LIMITS.errorRepeatPause === 5);
    check("the error isn't imported", X.validateSession({ task: "x", messages: [{ role: "system", content: "S" }], timeline: [{ type: "step", n: 1, status: "error", errSig: "code:x" }] }).timeline[0].errSig === undefined);
}

report();
