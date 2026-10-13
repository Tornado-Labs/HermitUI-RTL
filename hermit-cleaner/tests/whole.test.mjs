// Rewrite whole text: the letter frame, the prompts of each pass, the checks on the
// replies and the pass sequence (wholeRewrite with a scripted chat).
import m from "./extract.mjs";
import { check, section, report } from "./check.mjs";

const { splitLetterFrame, buildCritiqueMessages, buildWholeRewriteMessages, buildSentenceFixMessages, wholeSpotNotes,
    buildFactCheckMessages, factCheckErrors, buildFactFixMessages, acceptWholeRewrite, wholeRewrite, buildChatBody, missingNumbers, buildProofreadMessages, isFactError, copiedSentences, cutFillerSentences, buildPlainMessages, WHOLE_PASSES } = m;

const BODY_EN = "The Q3 budget review is next Thursday. I will send a full overview of the key figures by Tuesday.\n\n"
    + "The travel costs for the Berlin fair came in about 4,500 euros over our estimate.";
const LETTER_EN = `Hi Sarah,\n\n${BODY_EN}\n\nBest regards,\nTom\n`;
const BODY_DE = "Ihre Bestellung ist leider nicht am 6. Oktober angekommen, das tut mir leid. Unser Logistikpartner hatte eine St\u00f6rung im Transportnetz. "
    + "Wir haben das Paket neu verschickt, und es kommt bis Donnerstag, den 16. Oktober, bei Ihnen an.";
const LETTER_DE = `Sehr geehrter Herr Becker,\n\n${BODY_DE}\n\nMit freundlichen Gr\u00fc\u00dfen\n\nJulia Hartmann\nKundenservice`;
const ESSAY = "Remote work has changed how teams work together. Companies like Atlassian reported a 23 % rise in productivity after 2021. "
    + "Employees save about 72 minutes a day by not commuting.\n\nCommunication can become fragmented when teams rely only on chat tools.";

section("splitLetterFrame");
{
    const f = splitLetterFrame(LETTER_EN);
    check("parts concatenate back", f.head + f.body + f.tail === LETTER_EN);
    check("greeting and sign-off apart", f.head === "Hi Sarah,\n\n" && f.tail === "\n\nBest regards,\nTom\n" && f.body === BODY_EN, JSON.stringify(f));
    check("is a letter", f.letter);
    const d = splitLetterFrame(LETTER_DE);
    check("German: sign-off block with blank line and role", d.body === BODY_DE && d.tail.startsWith("\n\nMit freundlichen") && d.tail.endsWith("Kundenservice"), JSON.stringify(d.tail));
    check("German parts concatenate back", d.head + d.body + d.tail === LETTER_DE);
    const e = splitLetterFrame(ESSAY);
    check("no frame in an essay", !e.letter && e.body === ESSAY && !e.head && !e.tail);
    check("a long last line is no sign-off", !splitLetterFrame("Hi team,\n\nThe review is on Thursday and the figures follow on Tuesday.").tail);
    check("only a greeting: no frame", splitLetterFrame("Hello there!").body === "Hello there!");
    check("a sign-off alone, no greeting", splitLetterFrame(`${BODY_EN}\n\nCheers,\nTom`).tail === "\n\nCheers,\nTom");
}

section("prompts");
{
    const c = buildCritiqueMessages(BODY_EN);
    check("critique: system and the text", c.length === 2 && c[1].content === BODY_EN && /machine-written/.test(c[0].content));
    const letter = buildWholeRewriteMessages(BODY_EN, "en", { letter: true, critique: "- \"comprehensive\": buzzword" })[0].content;
    check("letter rules for a letter", letter.includes("body of a letter") && !letter.includes("essay, post"));
    check("the critique goes in", letter.includes("- \"comprehensive\": buzzword"));
    check("names the language", letter.includes("Write in English"));
    const essay = buildWholeRewriteMessages(ESSAY, "en", {})[0].content;
    check("essay rules otherwise", essay.includes("essay, post") && essay.includes("\"say\", \"for example\""));
    check("without details: no invented experiences", /never for things that happened/.test(essay) && !essay.includes("details given below"));
    const withDetails = buildWholeRewriteMessages(ESSAY, "en", { details: "I run a  14-person agency\nin Leeds." })[0].content;
    check("details go in, on one line", withDetails.includes("I run a 14-person agency in Leeds.") && withDetails.includes("details given below"));
    const de = buildWholeRewriteMessages(BODY_DE, "de", { letter: true })[0].content;
    check("German examples in a German prompt", de.includes("sondern") && de.includes("Write in German") && !de.includes("not only A but also B"));
    const fr = buildWholeRewriteMessages("Le comit\u00e9 a examin\u00e9 la proposition.", "fr", {})[0].content;
    check("other languages: English examples, the language named", fr.includes("not only A but also B") && fr.includes("Write in French") && !fr.includes("German"));
    check("tone, extra and retry go in", buildWholeRewriteMessages(ESSAY, "en", { tone: "casual", extra: "British spelling", retry: "Shorter." })[0].content
        .includes("- British spelling\n- Shorter."));
    const fc = buildFactCheckMessages(BODY_EN, "x", "en", "I run the finance team.");
    check("fact check: original, details and rewrite", fc[1].content.startsWith("Original:\n") && fc[1].content.includes("Details the writer added") && fc[1].content.includes("Rewrite:\nx"));
    check("fact check: a reworded or split fact is no error", fc[0].content.includes("split over two sentences") && fc[0].content.includes("softer degree word"));
    check("fact check: German illustration markers", buildFactCheckMessages(BODY_DE, "x", "de")[0].content.includes("\"etwa\""));
    const fix = buildFactFixMessages(BODY_EN, "rewritten", "en", ["- \"x\" -> wrong"]);
    check("fix: errors listed, the rewrite edited, the original for facts only", fix[0].content.includes("- \"x\" -> wrong") && fix[1].content === "rewritten" && fix[0].content.includes("Never copy a sentence from the original") && fix[0].content.includes("make sense as a whole"));
    check("sentence fix: notes and the text", buildSentenceFixMessages("t", "en", "- \"a\" -> b")[0].content.includes("- \"a\" -> b"));
    const body = buildChatBody("", [{ role: "user", content: "x" }], 0.6, false);
    check("chat body: model, temperature, no thinking", body.model === "local-model" && body.temperature === 0.6 && body.chat_template_kwargs.enable_thinking === false && body.stream === false);
    check("chat body: every pass prompt gets the no-hidden-marks line", body.messages[0].role === "system" && /no invisible|invisible characters/.test(body.messages[0].content) && body.messages[1].content === "x");
    check("chat body without kwargs", !("chat_template_kwargs" in buildChatBody("m", [], 0.2, true)));
    check("passes: spots come last", WHOLE_PASSES.map(p => p.id).join() === "critique,plan,rewrite,retry,outline,draft,review,sentences,facts,fix,recheck,spots,slop,plain,proof");
}

section("wholeSpotNotes");
{
    const notes = wholeSpotNotes("Moreover, leadership is not a title, it's a service. We met on Monday.", "en");
    check("contrast and stock phrase named", notes.some(n => n.startsWith("- set-up contrast")) && notes.some(n => n.includes("\"Moreover\"")), notes);
    check("plain text: none", !wholeSpotNotes("We met on Monday and agreed on the budget.", "en").length);
    const copied = "I'll send the key figures soon. The travel costs for the Berlin fair came in about 4,500 euros over our estimate.";
    check("a sentence copied from the original", copiedSentences(BODY_EN, copied).join() === "The travel costs for the Berlin fair came in about 4,500 euros over our estimate.", copiedSentences(BODY_EN, copied));
    check("short shared runs don't count", !copiedSentences(BODY_EN, "The Q3 budget review is on Thursday, and the figures follow.").length);
    check("named as a spot with the original", wholeSpotNotes(copied, "en", BODY_EN).some(n => n.startsWith("- copied from the original")) && !wholeSpotNotes(copied, "en").length);
    check("German contrast", wholeSpotNotes("Das ist kein Sprint, sondern ein Marathon.", "de").some(n => n.includes("kein Sprint, sondern")));
    const plain = wholeSpotNotes("Mein Team brauchte mich nicht f\u00fcr Antworten, sondern f\u00fcr meine Haltung.", "de");
    check("German plain nicht ..., sondern", plain.length === 1 && plain[0].includes("nicht f\u00fcr Antworten, sondern"), plain);
    check("one note for an overlapping contrast", wholeSpotNotes("Das ist nicht nur ein Sprint, sondern ein Marathon.", "de").length === 1);
    check("German split contrast", wholeSpotNotes("Es geht ja nicht nur um Software. Es geht darum, dass wir wachsen.", "de").length === 1);
    check("German half contrast", wholeSpotNotes("Es geht hier nicht nur darum, dass jemand eine Software bedienen kann. Es ist auch eine Frage der Neugier.", "de").length === 1);
    const conc = wholeSpotNotes("Nat\u00fcrlich kostet Weiterbildung Geld und Zeit. Aber ich finde, das rechnet sich.", "de");
    check("German concession", conc.length === 1 && conc[0].startsWith("- concession:"), conc);
    check("German concession, aber later", wholeSpotNotes("Nat\u00fcrlich kostet Weiterbildung am Anfang Geld. Die Rechnung geht aber auf.", "de").some(n => n.startsWith("- concession:")));
    check("German concession with ja", wholeSpotNotes("Ja, es kostet erst einmal Geld und Zeit. Aber es lohnt sich.", "de").some(n => n.startsWith("- concession:")));
    check("English concession", wholeSpotNotes("Of course, training costs money. But it pays off.", "en").some(n => n.startsWith("- concession:")));
    check("no concession in a plain sentence", !wholeSpotNotes("Klar war das teuer, und wir haben es trotzdem gemacht.", "de").length);
    for (const c of ["Das passiert selten lautstark, sondern in stillen Momenten.", "F\u00fcr mich ist F\u00fchrung weniger eine Position als eine Aufgabe.",
        "Mein Team brauchte mich nicht wegen der L\u00f6sungen. Es ging eher um meine Haltung.", "Meine Haltung war entscheidend, nicht meine L\u00f6sungen."]) check("German contrast: " + c.slice(0, 30), wholeSpotNotes(c, "de").length === 1, wholeSpotNotes(c, "de"));
    check("German triplet", wholeSpotNotes("Ich wollte schnell sein, effizient sein und Probleme sofort l\u00f6sen.", "de").some(n => n.startsWith("- list of three:")));
    check("English triplet", wholeSpotNotes("We wanted it fast, cheap and simple.", "en").some(n => n.startsWith("- list of three:")));
    check("a relative clause is no triplet", !wholeSpotNotes("Es geht um die Kultur eines Unternehmens, das Neugier und Wachstum f\u00f6rdert.", "de").length);
    check("a pair is no triplet", !wholeSpotNotes("Das ist gezielt und schnell auf die Bed\u00fcrfnisse abgestimmt.", "de").length);
    const filler = wholeSpotNotes("Ehrlich gesagt liegt die Arbeit im Alltag.", "de");
    check("candour filler", filler.length === 1 && filler[0].startsWith("- filler: \"Ehrlich gesagt\""), filler);
    check("English filler", wholeSpotNotes("To be honest, the budget was tight.", "en").some(n => n.includes("To be honest")));
    const essayRules = buildWholeRewriteMessages("Weiterbildung lohnt sich f\u00fcr kleine Firmen, weil sie schneller reagieren k\u00f6nnen.", "de", {})[0].content;
    const postRules = buildWholeRewriteMessages("Vor einem Jahr habe ich mein Team \u00fcbernommen, und ich lerne seitdem.", "de", {})[0].content;
    check("argued text: two illustrations, no pro-contra layout", essayRules.includes("Give two of the abstract claims") && essayRules.includes("pro, then contra") && !essayRules.includes("null"));
    check("first-person post: one illustration, no pro-contra rule", postRules.includes("Give one abstract claim") && !postRules.includes("pro, then contra") && !postRules.includes("null"));
    check("no voice example names a filler", !/honest|ehrlich/i.test(m.WHOLE_EXAMPLES.en.voice + m.WHOLE_EXAMPLES.de.voice));
}

section("missingNumbers");
{
    check("none missing", !missingNumbers(BODY_EN, "4,500 euros, Q3").length);
    check("a dropped figure", missingNumbers(ESSAY, "Atlassian saw productivity rise after 2021.").join() === "23,72");
    check("German dates", missingNumbers(BODY_DE, "am 6. Oktober").join() === "16", missingNumbers(BODY_DE, "am 6. Oktober"));
    check("proofread prompt keeps the casual wording", /casual is not a mistake/.test(buildProofreadMessages("x", "de")[0].content) && buildProofreadMessages("x", "de")[0].content.includes("German"));
}

section("factCheckErrors");
{
    check("OK: none", !factCheckErrors("OK").length && !factCheckErrors("**OK**").length && !factCheckErrors("OK.").length);
    check("bullets", factCheckErrors("- \"a\" -> wrong date\n- \"b\" -> lost the 10 %").length === 2);
    check("only the arrow lines when there are some", factCheckErrors("- \"a\" -> wrong date\n- The original says X, the rewrite says Y, which is fine.").length === 1);
    check("a point called fine is dropped", !factCheckErrors("- \"Let me know\" is a reasonable summary\n- \"by Tuesday\" is accurate").length);
    check("numbered list", factCheckErrors("1. \"x\" -> missing name\n2) \"y\" -> wrong").length === 2);
    check("one sentence without a list is one error", factCheckErrors("The rewrite drops the discount.").length === 1);
    check("thinking stripped", !factCheckErrors("<think>- \"a\" -> b</think>OK").length);
}

section("isFactError");
{
    check("a lost date is a fact error", isFactError("- \"am Montag\" -> the original says 6. Oktober"));
    check("a weaker promise is a fact error", isFactError("- \"soll\" -> the original guarantees arrival, the rewrite only says it should arrive"));
    check("a dropped metaphor is not", !isFactError("- \"Das dauert\" -> The rewrite removes this specific metaphor (Marathon vs Sprint)."));
    check("a lost contrast is not", !isFactError("- \"Vertrauen\" -> missing the specific contrast of giving vs building"));
    check("tone is not", !isFactError("- \"Ich finde\" -> changes the tone and register of the original"));
    check("the quote alone doesn't decide", isFactError("- \"a saying from 2020\" -> the year 2020 is missing"));
}

section("acceptWholeRewrite");
{
    const re = "I'll send you the key figures by Tuesday, before the Q3 review next Thursday.\n\nBerlin: travel came in about 4,500 euros over budget.";
    check("a rewrite is accepted", acceptWholeRewrite(BODY_EN, BODY_EN, re, "en", "rewrite").ok);
    check("an echo is no rewrite", /barely changed/.test(acceptWholeRewrite(BODY_EN, BODY_EN, BODY_EN.replace("full", "complete"), "en", "rewrite").reason || ""));
    check("empty", acceptWholeRewrite(BODY_EN, BODY_EN, "  ", "en", "rewrite").reason === "empty reply");
    check("preamble refused", /introduction/.test(acceptWholeRewrite(BODY_EN, BODY_EN, "Here is the rewritten text: " + re, "en", "rewrite").reason || ""));
    check("much shorter refused", /shorter/.test(acceptWholeRewrite(BODY_EN, BODY_EN, "Review Thursday.", "en", "rewrite").reason || ""));
    check("wrong language refused", /German/.test(acceptWholeRewrite(BODY_EN, BODY_EN, BODY_DE, "en", "rewrite").reason || ""));
    const du = BODY_DE.replace("Ihre Bestellung", "Deine Bestellung").replace("bei Ihnen", "bei dir") + " Das ist f\u00fcr dich.";
    check("German form of address kept", acceptWholeRewrite(BODY_DE, BODY_DE, du, "de", "rewrite").address === "Sie");
    const small = re.replace("before the Q3", "ahead of the Q3");
    check("a fix that edits a few words is accepted", acceptWholeRewrite(BODY_EN, re, small, "en", "fix").ok);
    check("a fix that changed nothing", acceptWholeRewrite(BODY_EN, re, re, "en", "fix").unchanged);
    check("a fix that went back to the original is refused", /original wording/.test(acceptWholeRewrite(BODY_EN, re, BODY_EN, "en", "fix").reason || ""));
    const other = "Our trip to Berlin was expensive and the overview is late, we will talk about the budget on Thursday next week instead of Tuesday.";
    check("a fix that rewrote everything is refused", /far more/.test(acceptWholeRewrite(BODY_EN, re, other, "en", "spots").reason || ""));
    check("a pass that drops a number is refused", /dropped the number 4,500/.test(acceptWholeRewrite(BODY_EN, re, re.replace("about 4,500 euros", "a lot"), "en", "fix").reason || ""));
    check("a comment on the text is refused", /commented on the text/.test(acceptWholeRewrite(BODY_EN, BODY_EN, re + " Though the text does not specify the baseline.", "en", "rewrite").reason || ""));
    check("a cut announced in the text is refused", /commented/.test(acceptWholeRewrite(BODY_DE, BODY_DE, "Das Paket kam nicht am 6. Oktober. Die Gr\u00fcnde lassen wir hier weg. Es kommt bis 16. Oktober.", "de", "rewrite").reason || ""));
    check("German too", /commented/.test(acceptWholeRewrite(BODY_DE, BODY_DE, "Das Paket kam nicht am 6. Oktober, der Text nennt keinen Grund. Es kommt bis 16. Oktober, sagt das Original.", "de", "rewrite").reason || ""));
    const cut = re.split("\n\n")[0];
    check("a sentence pass that cuts is refused", /cut part/.test(acceptWholeRewrite(BODY_EN, re, cut, "en", "sentences").reason || ""));
    check("the fix may shorten", !/cut part/.test(acceptWholeRewrite(BODY_EN, re, re.replace(" next Thursday", ""), "en", "fix").reason || ""));
    check("wrapping quotes dropped", acceptWholeRewrite(BODY_EN, BODY_EN, `"${re}"`, "en", "rewrite").text === re);
}

section("cutFillerSentences");
{
    const T = "We moved the review to Thursday. This flexibility creates trust in the whole team.\n\nThe trip cost 4,500 euros. That shows how much it matters.";
    let c = cutFillerSentences(T, "- \"This flexibility creates trust in the whole team.\"\n- That shows how much it matters. 4,500\n- The trip cost 4,500 euros.");
    check("quoted filler cut, a sentence with a number kept, at most a third", c.cut.length === 1 && c.text === "We moved the review to Thursday.\n\nThe trip cost 4,500 euros. That shows how much it matters.", c);
    c = cutFillerSentences("A one. B two is here. C three is here. D four is here. E five is here. F six is here.", "- B two is here.\n- C three is here. -> generic");
    check("two of six, the arrow note ignored", c.cut.length === 2 && c.text === "A one. D four is here. E five is here. F six is here.", c.text);
    c = cutFillerSentences("Wir bauen um. Man sollte feste Zeiten haben. Diese Struktur schafft Vertrauen. Das Netz w\u00e4chst weiter.", "- Man sollte feste Zeiten haben.\n- Diese Struktur schafft Vertrauen.\n- Wir bauen um.", "de");
    check("German: advice and the writer's own sentences stay", c.cut.join() === "Diese Struktur schafft Vertrauen.", c.cut);
    check("OK cuts nothing", cutFillerSentences(T, "OK").text === T);
    c = cutFillerSentences("Short fact here.\n\nOnly filler sentence in here.\n\nAnother fact stays.", "- Only filler sentence in here.");
    check("an emptied paragraph goes", c.text === "Short fact here.\n\nAnother fact stays.", JSON.stringify(c.text));
}

section("wholeRewrite");
{
    const REWRITE = "I'll send you the key figures by Tuesday, before the Q3 review next Thursday. Moreover, the Berlin trip came in about 4,500 euros over the estimate.";
    const SENTENCES = REWRITE.replace("before the Q3", "ahead of the Q3");
    const SPOTS = SENTENCES.replace("Moreover, the", "The");
    const script = (facts, extra) => {
        const calls = [];
        const answers = { critique: "- \"comprehensive\": buzzword", rewrite: REWRITE, retry: REWRITE, review: "- \"before the Q3\" -> tidy", sentences: SENTENCES, facts, fix: SENTENCES.replace("4,500", "4,500"), spots: SPOTS, proof: c => c.find(x => x.id === "proof").messages[1].content, ...extra };
        return { calls, chat: async (id, messages, maxTokens) => { calls.push({ id, messages, maxTokens }); if (answers[id] instanceof Error) throw answers[id]; return typeof answers[id] === "function" ? answers[id](calls) : answers[id]; } };
    };
    let s = script("OK");
    let r = await wholeRewrite(LETTER_EN, "en", { details: "" }, s.chat);
    check("passes in order, no fix when the check is OK", s.calls.map(c => c.id).join() === "critique,rewrite,review,sentences,facts,spots,proof", s.calls.map(c => c.id));
    check("the body only goes to the model", s.calls.every(c => !c.messages[c.messages.length - 1].content.includes("Hi Sarah")));
    check("the result", r.body === SPOTS && r.frame.head === "Hi Sarah,\n\n" && r.info.letter, r.body);
    check("info", r.info.flagged === 1 && r.info.spotsFound === 1 && r.info.spotsLeft === 0 && !r.info.errors.length && r.info.change > 0.3, JSON.stringify(r.info));
    check("the critique reaches the rewrite", s.calls[1].messages[0].content.includes("buzzword"));

    s = script("- \"over the estimate\" -> it was the initial estimate", { fix: SENTENCES.replace("over the estimate", "over the initial estimate"), recheck: "- \"Berlin trip\" -> it was the Berlin fair" });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    check("errors: the fix runs before the spots", s.calls.map(c => c.id).join() === "critique,rewrite,review,sentences,facts,fix,recheck,spots,proof" && r.info.fixed && r.info.errors.length === 1);
    check("the recheck's findings are kept for the report", r.info.remaining.length === 1, r.info.remaining);
    check("the fix's errors are in its prompt", s.calls[5].messages[0].content.includes("initial estimate"));

    s = script("OK", { rewrite: REWRITE.replace("4,500", "several thousand"), sentences: SENTENCES.replace("4,500", "several thousand"), spots: SPOTS.replace("4,500", "several thousand"),
        fix: SENTENCES.replace("4,500", "several thousand").replace("ahead of", "just ahead of") });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    check("a lost number goes to the fix, and the report knows it is still missing", s.calls.find(c => c.id === "fix").messages[0].content.includes("the number \"4,500\"")
        && r.info.missing.join() === "4,500", r.info.missing);
    check("an unchanged proofreading is not reported as skipped", !r.info.passes.some(p => p.id === "proof"));

    // Rewrite freely: a plan between critique and rewrite, and a number that went with a
    // dropped point is no fact-check error.
    s = script("OK", { plan: "- drop the generic point", rewrite: REWRITE.replace(" Moreover, the Berlin trip came in about 4,500 euros over the estimate.", " Berlin was over budget."),
        sentences: SENTENCES.replace(" Moreover, the Berlin trip came in about 4,500 euros over the estimate.", " Berlin was over budget."), spots: SPOTS.replace(" The Berlin trip came in about 4,500 euros over the estimate.", " Berlin was over budget.") });
    r = await wholeRewrite(LETTER_EN, "en", { free: true }, s.chat);
    check("free: the plan runs after the critique and reaches the rewrite", s.calls.map(c => c.id).slice(0, 3).join() === "critique,plan,rewrite"
        && s.calls[2].messages[0].content.includes("drop the generic point") && s.calls[2].messages[0].content.includes("may change the content"), s.calls.map(c => c.id));
    check("free: a dropped number goes to the report, not to the fix", !s.calls.some(c => c.id === "fix") && r.info.missing.join() === "4,500" && r.info.free, s.calls.map(c => c.id));
    check("free: the slop pass runs before the proofreading", s.calls.map(c => c.id).slice(-2).join() === "slop,proof", s.calls.map(c => c.id));
    check("free: the fact check allows dropped points", s.calls.find(c => c.id === "facts").messages[0].content.includes("allowed to change the content"));
    // Short sentences (German): one more pass before the proofreading, and the fact check again after it.
    const RW_DE = "Ihr Paket kam am 6. Oktober leider nicht an, das tut mir leid. Bei unserem Logistikpartner gab es eine St\u00f6rung im Transportnetz. "
        + "Wir haben es noch einmal losgeschickt, und es ist bis Donnerstag, den 16. Oktober, bei Ihnen.";
    const PLAIN_DE = "Ihr Paket kam am 6. Oktober leider nicht an. Das tut mir leid. Bei unserem Logistikpartner gab es eine St\u00f6rung im Transportnetz. "
        + "Wir haben es noch einmal losgeschickt. Es ist bis Donnerstag, den 16. Oktober, bei Ihnen.";
    const scriptDe = extra => script("OK", { critique: "- stiff", rewrite: RW_DE, review: "", spots: RW_DE, plain: PLAIN_DE, fix: PLAIN_DE, ...extra });
    s = scriptDe();
    r = await wholeRewrite(LETTER_DE, "de", { plain: true }, s.chat);
    check("plain: runs before the proofreading, then the fact check again", s.calls.map(c => c.id).slice(-3).join() === "plain,facts,proof" && r.body === PLAIN_DE, s.calls.map(c => c.id));
    check("plain: the pass gets the current text", s.calls.find(c => c.id === "plain").messages[1].content === RW_DE);
    s = scriptDe({ facts: c => c.filter(x => x.id === "facts").length > 1 ? "- \"16. Oktober\" -> es war der 15. Oktober" : "OK", fix: PLAIN_DE.replace("Es ist bis", "Es ist sicher bis") });
    r = await wholeRewrite(LETTER_DE, "de", { plain: true }, s.chat);
    check("plain: an error it brings in goes to a fix", s.calls.map(c => c.id).slice(-4).join() === "plain,facts,fix,proof" && r.info.errors.length === 1, s.calls.map(c => c.id));
    s = script("OK", { plain: "x" });
    await wholeRewrite(LETTER_EN, "en", { plain: true }, s.chat);
    check("plain: German only", !s.calls.some(c => c.id === "plain"));
    s = scriptDe();
    await wholeRewrite(LETTER_DE, "de", {}, s.chat);
    check("plain: off unless asked for", !s.calls.some(c => c.id === "plain"));
    const pm = buildPlainMessages("Ein Text.");
    check("plain prompt: German rules and the text", /gesprochenem Deutsch/.test(pm[0].content) && /nichts kommt dazu/.test(pm[0].content) && pm[1].content === "Ein Text.");
    check("not free: no plan, the keep-every-claim rules", !s.calls.length || !(await (async () => { const t = script("OK"); await wholeRewrite(LETTER_EN, "en", {}, t.chat); return t.calls.some(c => c.id === "plan") || t.calls[1].messages[0].content.includes("may change the content"); })()));

    s = script("OK", { spots: SENTENCES + " This is not just a fair, it's a showcase." });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    check("spots left after the spots pass get one more round", s.calls.filter(c => c.id === "spots").length === 2 && r.info.spotsLeft > 0
        && s.calls.filter(c => c.id === "spots")[1].messages[0].content.includes("not just a fair"), s.calls.map(c => c.id));

    s = script("OK", { rewrite: BODY_EN, retry: BODY_EN, outline: "- order delayed\n- new date", draft: BODY_EN });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    check("an echoed rewrite: retry, then a draft from notes, then the text stays", r.body === BODY_EN && /barely/.test(r.info.failed || "")
        && s.calls.map(c => c.id).join() === "critique,rewrite,retry,outline,draft" && r.info.passes.length === 1, s.calls.map(c => c.id));
    check("the second try is the hotter retry pass and says why", s.calls[2].id === "retry" && s.calls[2].messages[0].content.includes("copied most of the text"));
    const draft = s.calls.find(c => c.id === "draft").messages;
    check("the draft sees the notes, not the text", draft[1].content === "- order delayed\n- new date" && draft[0].content.includes("content of the text as notes"));
    check("the outline sees the text", s.calls.find(c => c.id === "outline").messages[1].content === BODY_EN);

    s = script("OK", { rewrite: BODY_EN, retry: BODY_EN, outline: "- notes", draft: REWRITE });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    check("a draft from notes can rescue it", r.body === SPOTS && !r.info.failed && r.info.passes[0].id === "rewrite" && r.info.passes[0].ok);

    s = script("OK", { rewrite: "Dear customer,\n\n" + REWRITE + "\n\nBest regards,\nTom" });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    check("a greeting or sign-off the model wrote into a letter body goes", r.body === SPOTS && r.frame.head + r.body + r.frame.tail === LETTER_EN.replace(BODY_EN, SPOTS), r.body);

    s = script("OK", { rewrite: "", retry: "" });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    check("no draft from notes for another refusal", !s.calls.some(c => c.id === "outline") && r.info.failed);

    s = script("OK", { rewrite: "", retry: REWRITE });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    check("a second try can rescue it", r.body === SPOTS && !r.info.failed);

    s = script("OK", { review: "No sentence would be flagged." });
    r = await wholeRewrite(ESSAY, "en", {}, s.chat);
    check("no flagged sentence: no sentence pass", !s.calls.some(c => c.id === "sentences") && r.info.flagged === 0);

    const stop = new Error("Stopped"); stop.name = "AbortError";
    s = script("OK", { review: stop });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    check("Stop keeps the finished rewrite", r.info.stopped && r.body === REWRITE);

    s = script("OK", { sentences: "Here is the edited text: " + SENTENCES });
    r = await wholeRewrite(LETTER_EN, "en", {}, s.chat);
    // The sentence pass is refused, so the spots pass gets the rewrite itself.
    check("a refused pass leaves the text as it was", r.info.passes.some(p => p.id === "sentences" && !p.ok) && s.calls.find(c => c.id === "spots").messages[1].content === REWRITE, r.info.passes);

    s = script("OK");
    r = await wholeRewrite("Hi Sarah,", "en", {}, s.chat);
    check("too short to rewrite", !s.calls.length && /too short/.test(r.info.failed || ""));
}

report();
