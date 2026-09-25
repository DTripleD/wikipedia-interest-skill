# Cheap-model evaluation: Claude Haiku 4.5 (Stage 12)

Run on 2026-09-25 by the user in Claude Code (VS Code extension) with Claude Haiku 4.5
(`claude-haiku-4-5-20251001`, confirmed in the session logs). The procedure and scenarios are in
[haiku-4.5-runbook.md](haiku-4.5-runbook.md). The skill was installed as a junction in
`~/.claude/skills/`, and Claude Code ran in the empty folder `C:\haiku-eval`.

## How the runs were evaluated

- **Source:** the Claude Code session logs (`~/.claude/projects/c--haiku-eval/*.jsonl`). They hold
  every prompt, tool call, CLI output and answer, plus the model and token counts of each
  request. The `/export` files were used for cross-checking only.
- **Numbers:** a script extracted every number from Haiku's answers and looked it up in the CLI
  output of the same session. Each mismatch was then checked by hand. Rounding, list numbering
  and dates were accepted.
- **Behavior:** each run was read against SKILL.md and the runbook checklist.
- **Cost:** computed from the token counts at Haiku 4.5 prices ($1 / $5 per million input / output
  tokens, cache writes ×1.25, cache reads ×0.1).

Two follow-up turns were not exercised: the scripted replies for scenario 1 (accept the broader pl
article) and scenario 5 (5 years + PDF) were not sent. Scenario 3 also received an unscripted
answer: besides the editions, the user chose "the number of views", "the most promising markets"
and "the last year".

## Summary

| # | Scenario | Right article(s) | Right command | Numbers from CLI | Confidence + reasons | Attention ≠ demand | Main problems |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Fasting pl vs cs | yes (pl missing) | yes | yes | level yes, reasons partly | yes | "views per million **residents**"; median labelled "average"; "−25 % is an even steeper fall" (it is smaller than −56 %); unconditional `npm ci` |
| 2 | Astronomy uk | yes | **no**: made a PDF that was not requested | yes | level yes, reasons partly | yes | PowerShell `&&` error, then Bash; one line in Russian |
| 3 | Learning English | **no**: switched to `English language` without asking | report yes | **no**: "3.5 times", "students aged 18–25" | "**very** high" (CLI: high) | yes | named countries and used flags; "Turkey: a growing market" while the data show a decline; "per capita" |
| 4 | Mercury (ambiguous) | yes, asked and did not pick | yes | **no**: "cs 34.9 % higher" (CLI: pl is at 65.1 %, i.e. cs is 53.6 % higher) | level yes, **reason dropped** (unstable ranking) | yes | PowerShell error, 3 attempts for one command; replies partly in English |
| 5 | Chess de/fr | yes | yes | yes | level yes, **main reason dropped** (unstable ranking, "roughly equal") | yes | "both lost about a quarter" (−34 % and −19 %); PowerShell error |
| 6 | Yoga uk/pl/tlh | yes, tlh reported as missing | yes | **no**: "uk 55 % higher" | yes, "roughly equal" | yes | contradicts itself ("55 % higher" and "roughly equal"); PowerShell error |

**What worked:**
- Haiku picked the skill on its own in all six scenarios (in scenario 3, after its own clarifying question).
- It asked instead of guessing on the ambiguous topic (Mercury) and did not choose a meaning.
- The nonexistent edition (tlh) was handled without invented data.
- It stated the attention-not-demand limitation, the period and a confidence level in every answer.
- The values it copied from the JSON were correct.

**What failed:**
1. **It computed its own numbers** in 3 of 6 answers (ratios and "% higher"), although SKILL.md forbids it; one of them was also wrong.
2. **It misread views per million** as per million residents or per capita (scenarios 1 and 3).
3. **It dropped the main confidence reason** in two comparisons (4 and 5): the CLI said the ranking was unstable and the editions should be treated as roughly equal, and Haiku presented a winner instead.
4. **It acted without being asked:** an unrequested PDF (2), and a switch to a broader topic without the user's consent (3).
5. **Shell problems** in 4 of 6 runs: on Windows, Haiku often chose the PowerShell tool, where the `cd … && …` pattern from SKILL.md fails. This led to 1–2 wasted calls per run. It also exposed a real bug (see below).
6. **Setup:** it ran `npm ci` on every run (1 and 3), instead of only when `dist/cli.js` is missing. This reinstalls all dependencies each time.
7. Smaller issues:
   - named countries instead of editions and used flag emojis (3);
   - replies partly in English or Russian;
   - added claims not in the data ("Turkish youth actively learns languages").

## Bug found and fixed

`node <junction path>/dist/cli.js` printed nothing and exited with code 0. The entry-point check
in `src/cli.ts` compared `import.meta.url` (Node resolves it to the real path) with
`process.argv[1]` (it keeps the junction path), so `main()` never ran. It affected PowerShell
calls through the skill junction, and would affect npm bin symlinks too.

Fix: `isEntryPoint()` compares both paths after `realpath`. A unit test covers it with a real
junction. After the fix, the CLI works from any working folder and in both shells when called
by its full path.

## Cost and efficiency

| Scenario | Model requests | Output tokens | CLI calls (incl. failed) | Cost |
| --- | --- | --- | --- | --- |
| 1 | 4 | 1 798 | 2 (`npm ci`, `analyze`) | $0.043 |
| 2 | 4 | 2 425 | 2 (1 failed) | $0.042 |
| 3 | 9 (+1 interrupted) | 4 931 | 6 (`npm ci`, 2 checks, 2 × `resolve`, `report`) | $0.082 (+$0.013) |
| 4 | 7 | 2 891 | 4 (2 failed) | $0.059 |
| 5 | 6 | 1 864 | 4 (2 failed or empty) | $0.048 |
| 6 | 5 | 2 076 | 3 (2 failed or empty) | $0.045 |
| **Total** | | | | **≈ $0.33** |

Each scenario cost 4–5 US cents, which confirms that the skill is cheap enough for a small model.
Most input tokens are cache reads of the Claude Code system prompt and SKILL.md. The failed shell
calls and the unconditional `npm ci` are the avoidable part.

## Second run (same SKILL.md, CLI bug fixed)

Right after the first evaluation, the user re-ran scenarios 1, 3, 4 and 5 with the same SKILL.md.
Only the entry-point bug was fixed by then. This time the follow-up of scenario 5 was sent.

| # | Result | Change from run 1 |
| --- | --- | --- |
| 1 | Correct numbers; per million and median labelled correctly; confidence medium with reasons | better. Suggested looking for another pl article only as advice, not as a question, so the scripted reply did not apply |
| 3 | Again switched to `English language` without asking. Own numbers again: "almost 2 times", "a third of the uk level" (the CLI says tr is at 50.6 %), "es has the biggest fall" (uk falls more). **No confidence level at all** (CLI: medium, unstable es/pl ranking) | same or worse |
| 4 | Asked about the meaning after `TOPIC_AMBIGUOUS`; confidence medium **with** the unstable-ranking reason; no own numbers | better |
| 5 | Made an unrequested PDF on the first turn. The follow-up (`report --months 60`) was correct; "roughly equal" (41 of 59 months) was stated in both turns | better, apart from the unrequested PDF |

The PowerShell `&&` error appeared in 3 of 4 runs. Cost: $0.04–0.07 per scenario.

**Conclusion from two runs:** these failures repeat, so they come from the instructions rather
than chance: own ratios, the unasked topic switch in scenario 3, unrequested PDFs and the shell
syntax. Reading per million and passing on the ranking reason varied between runs, so stronger
wording should fix them.

## Changes applied after run 2

SKILL.md:
1. **Hard rules** block at the top, where a small model reads it first:
   - no own numbers: gaps between editions only as `relativeToLeaderPct` ("pl is at 65.1 % of the cs level");
   - copy `confidence.level` and all its reasons; "not stable" means roughly equal, with no winner;
   - views per million means per million pageviews of that edition, never per person;
   - `report` only on request, and no switch to another or broader article without asking;
   - name editions, not countries, and use no flags.
2. **Invocation:** `node "${CLAUDE_SKILL_DIR}/dist/cli.js" ...` by full path in every example,
   with an explicit "do not use `cd ... &&`, it fails in PowerShell". This works in both shells now
   that the entry-point bug is fixed.
3. **Setup:** `npm ci` and `npm run build` only if `dist/cli.js` is missing; "never run npm otherwise".
4. **Topic:** the "learning English" example now names the exact title,
   `English as a second or foreign language`.
5. **Answer template:** the confidence section is required "even in a short answer". The
   pre-send check now includes "no ratios or '% more' of your own".

`tests/skill.test.ts` was updated for the new command form. SKILL.md is now 162 lines, about
3 100 tokens.

Not done (optional code change): a ready-made comparison sentence in `findings`. Decide after run 3.

## Run 3 (after the SKILL.md changes)

This run was done in a new Claude Code session, so the new SKILL.md was loaded. It covered
scenarios 1, 2, 3 and 5, and the follow-up of scenario 5 was sent.

| # | Result | Cost |
| --- | --- | --- |
| 1 | One CLI call (PowerShell, full path, first try), 3 model requests. All numbers from the CLI; confidence medium with reasons; pl missing; caveat stated. It did not offer a broader pl article, so the scripted reply did not apply (SKILL.md makes this optional) | $0.032 |
| 2 | Correct reading (decreasing, mid-2025 step, edition-wide drop, medium confidence, recent rise not trusted). **Still made an unrequested PDF**: Haiku passed `report: true` to the skill before reading SKILL.md. **The attention-not-demand caveat was missing** this time. The median was called "average" | $0.035 |
| 3 | Asked for the editions, then used `English as a second or foreign language` (the right article, no switch). Gaps given as `relativeToLeaderPct` (36.6 %, 15.5 %); all numbers from the CLI; confidence low with reasons; pl/uk missing; caveat stated. **It made no PDF**, although the user asked for "a short report" | $0.046 |
| 5 | No unrequested PDF. The follow-up was correct (`report --months 60`, PDF path given). "Roughly equal" was stated in both turns. Two small slips: a garbled "% of its level" sentence, and "trend confidence high" for both editions, while it was high for fr and medium for de | $0.051 (2 turns) |

## Results across the three runs

| Problem | Run 1 (6 scenarios) | Run 2 (4) | Run 3 (4) |
| --- | --- | --- | --- |
| Numbers not in the CLI output (own ratios or percentages) | 3 | 1 | **0** |
| "Per million" read as per person | 2 | 0 | **0** |
| Main confidence reason dropped or level missing | 2 | 1 | **0** |
| Topic switched without asking | 1 | 1 | **0** |
| PowerShell `&&` failures | 4 | 3 | **0** |
| Unconditional `npm ci` | 2 | 0 | **0** |
| Unrequested PDF | 1 | 1 | 1 |
| PDF missing when a report was asked for | 0 | 0 | 1 |
| Attention-not-demand caveat missing | 0 | 0 | 1 |

Average cost per scenario went from about $0.05 to about $0.04, with 3–5 model requests per
scenario.

**Conclusion.** With the Hard rules block, Haiku 4.5 uses the skill reliably. It picks the
skill, calls the CLI once, copies the numbers and confidence correctly, and asks when the topic
or editions are unclear.

The remaining weak spot is deciding whether to make a PDF. Haiku decides this before it reads
SKILL.md, from the skill description and the user's wording. The optional code change (a
ready-made comparison sentence) is no longer needed: own ratios disappeared without it.

**Remaining issues (for Stage 13):**
- State the PDF trigger explicitly in SKILL.md and in the skill `description`: words like
  "report / звіт / PDF / to share" mean `report`; a question about trends or trust does not.
- Put the attention-not-demand sentence in the Hard rules, as an item that must appear in every
  answer.

## Reproducing the evaluation

- `node evaluation/scripts/parse-session.mjs <session.jsonl> [--full]` prints a session as a
  readable timeline: prompts, tool calls, CLI output, answers, token usage and model.
- `node evaluation/scripts/check-session.mjs <session.jsonl>` lists the numbers in the answers
  that do not occur in any CLI output of the session. It is a coarse filter: rounded values,
  reformatted dates and list numbers show up too, and each hit is reviewed by hand.

Claude Code writes the sessions to `~/.claude/projects/<working folder>/*.jsonl`.
