// The loop guard (DESIGN §5.8): a third identical action in a row isn't run, a fourth
// pauses the run. The compaction thrash guard (DESIGN §5.4): compacting nearly every
// step pauses the run. Run: node tests/guard.test.mjs
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

report();
