# Cheap-model evaluation: Claude Haiku 4.5 in Claude Code (Stage 12 runbook)

This is how to run the skill with Claude Haiku 4.5 and record the results. The person running it
plays the user: they paste the prompts below and reply only with the scripted answers. The runs
are evaluated afterwards against the checklist at the end; the results go to
`evaluation/haiku-4.5.md`.

What is measured (from the assignment): instruction following, choice of command and flags,
handling of ambiguity, no invented data, correct reading of the JSON, token use and cost, and
error handling.

## 1. One-time setup (about 5 minutes)

1. **Build the skill** in the repository folder (skip if `dist/cli.js` exists and is up to date):
   ```powershell
   npm ci
   npm run build
   ```
   Check that `.env` has a real contact: `WIKI_SKILL_CONTACT=you@example.org`.

2. **Install the skill for Claude Code** by linking the repository into the personal skills
   folder. The folder name becomes the skill name, so keep `wikipedia-interest-skill`.
   In PowerShell:
   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills"
   New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\wikipedia-interest-skill" -Target "<full path of this repository>"
   ```
   Create the `skills` folder **before** starting Claude Code. Claude Code only watches skill
   folders that existed when the session started.

3. **Use an empty working folder**, so Haiku sees only the skill and not the source code or
   AGENTS.md. This is what a real user's setup looks like:
   ```powershell
   New-Item -ItemType Directory -Force C:\haiku-eval
   cd C:\haiku-eval
   claude
   ```
   (Or open `C:\haiku-eval` in VS Code and start Claude Code there.)

4. **Switch to Haiku:** run `/model haiku`, then run `/model` again to confirm Haiku 4.5 is active.

5. **Check that the skill is loaded**, in a **new** session (a session started before the
   junction existed may not see it): ask `Які skills тобі доступні?` and look for
   `wikipedia-interest-skill`. The `/` menu of the VS Code extension may not list personal
   skills, so don't rely on it. Then run `/clear`. In the scenarios, do not invoke the skill by
   name: the test includes whether Haiku picks it on its own.

## 2. For each scenario

1. Start clean: run `/clear` (or open a new session) and check the model is still Haiku.
2. Paste the **user message** exactly as written.
3. When Claude Code asks for permission to run a command, allow it. If Haiku asks to run
   something unrelated to the skill (for example reading source files), deny it and note it.
4. If Haiku asks a question, reply with the **scripted reply** only. If it asks something that
   has no scripted reply, answer as briefly as possible and note what you answered.
5. If Haiku does not use the skill at all and answers from memory, note it as a failure. Then run
   `/clear` and repeat with `/wikipedia-interest-skill <user message>`, and note that too.
6. When Haiku gives its final answer, run `/export scenario-N.txt` to save the transcript.
   Token use does not need to be copied. Claude Code logs every session, with the model and the
   token counts of each request, in `~/.claude/projects/c--haiku-eval/*.jsonl`, and the
   evaluation reads it from there. (`/cost` is not available in every Claude Code version.)
7. Don't correct Haiku or give hints. Mistakes are what we are measuring.

At the end, copy all `scenario-*.txt` files (and any notes) from `C:\haiku-eval` into
`<repository>/output/haiku-runs/`. The `output/` folder is gitignored. Any PDFs are in the
repository's `output/` folder.

Numbers change daily, because the default period ends yesterday. The answers are checked
against the CLI output inside each transcript, not against earlier runs.

## 3. Scenarios

### Scenario 1: comparison with a missing edition

- **User message:** `Порівняй зростання інтересу до інтервального голодування в польськомовній та чеськомовній Wikipedia за останні два роки.`
- **Scripted replies:**
  - if it offers to look for a broader Polish article: `Так, спробуй знайти ширшу польську статтю і перевір її.`
  - if it asks whether to use the article it found: `Так, проаналізуй польську за цією статтею поряд з чеською.`
- **Expected:**
  - `analyze --topic "Intermittent fasting" --languages pl,cs` (in any order);
  - pl reported as missing, with no pl numbers invented;
  - the cs trend reported as decreasing, not growing;
  - a `--title pl=...` article used only after the user agrees, and called a different or broader article (confidence medium).

### Scenario 2: single edition with a confidence assessment

- **User message:** `Ми думаємо додати курс з астрономії до освітнього застосунку. Чи зростає інтерес до цієї теми в україномовній Wikipedia, і наскільки цьому зростанню можна довіряти?`
- **Scripted replies:** none expected.
- **Expected:**
  - `analyze --topic "Astronomy" --languages uk`, or `--topic "Астрономія" --source uk`;
  - the answer says interest is not growing (decreasing);
  - it mentions the mid-2025 step and that the whole uk edition dropped at the same time;
  - confidence medium with its reasons;
  - the recent 90-day rise is not presented as a confirmed reversal.

### Scenario 3: editions not named, short report

- **User message:** `Ми створюємо застосунок для вивчення мов. Порівняй інтерес до вивчення англійської у вибраних нами мовних розділах та підготуй короткий звіт: які аудиторії варто дослідити наступними й чому?`
- **Scripted replies:**
  - when asked which editions: `Порівняй німецьку, іспанську, турецьку, польську та українську (de, es, tr, pl, uk).`
  - if asked which meaning of "learning English": `Англійська як іноземна мова.`
  - if it offers alternative articles for missing editions: `Ні, достатньо цих розділів.`
- **Expected:**
  - asks for the editions **before** running anything;
  - `report` (a PDF) for `English as a second or foreign language`, or it asks about the meaning after `TOPIC_AMBIGUOUS`;
  - pl and uk reported as missing;
  - the ranking and low confidence stated;
  - the "research next" advice is based only on the JSON and recommends validating with real demand data;
  - the PDF path is given.

### Scenario 4: ambiguous topic

- **User message:** `Порівняй інтерес до Mercury у польській і чеській Wikipedia за останній рік.`
- **Scripted reply:** when asked which meaning: `Планета.`
- **Expected:**
  - Haiku does not pick a meaning itself: either it asks first, or it runs the CLI, gets `TOPIC_AMBIGUOUS` and shows the candidates;
  - after the reply, `--topic "Mercury (planet)" --languages pl,cs --months 12` (pl `Merkury`, cs `Merkur (planeta)`).

### Scenario 5: follow-up request

- **User message:** `Як змінювався інтерес до шахів у німецькій і французькій Wikipedia?`
- **Then, after its answer:** `Покажи те саме за останні 5 років і зроби PDF-звіт.`
- **Expected:**
  - first `analyze --topic "Chess" --languages de,fr` with the default period stated;
  - then `report` with the same topic and editions plus `--months 60`, with no re-asking;
  - for 60 months the ranking is unstable (de ahead in about 41 of 59 months), so the confidence is low and the two editions should be called roughly equal;
  - the PDF path is given.

### Scenario 6: edition that does not exist

- **User message:** `Порівняй інтерес до йоги в українській, польській і клінгонській Wikipedia.`
- **Scripted reply:** if asked for the Klingon code: `Код tlh.`
- **Expected:**
  - `--languages uk,pl,tlh` (or it asks for the code);
  - `tlh` reported as missing ("edition does not exist"), with no data invented;
  - uk and pl compared, with the unstable ranking (low confidence) mentioned;
  - no loops or repeated retries.

## 4. Checklist (filled in during evaluation)

The helper scripts in `evaluation/scripts/` turn the session logs into timelines and check the
numbers (see [haiku-4.5.md](haiku-4.5.md#reproducing-the-evaluation)).


For each scenario: **yes / partly / no**, with a short note.

| # | Criterion |
| --- | --- |
| 1 | Picked the skill without being told |
| 2 | Ran the CLI correctly (setup check, skill folder, `node dist/cli.js ...`) |
| 3 | Chose the right command (`analyze` vs `report`, `resolve` only when needed) |
| 4 | Chose the right flags (topic as an English title or with `--source`, edition codes, period, `--title`) |
| 5 | Asked when it had to (editions missing, ambiguous topic), and only then |
| 6 | Never picked a candidate or an alternative article without the user's consent |
| 7 | Every number in the answer appears in the CLI output (checked by script) |
| 8 | Interpreted the JSON correctly (per-million ranking, trend direction, level shift, spikes) |
| 9 | Stated the confidence level with its reasons |
| 10 | Stated that pageviews are attention, not market demand |
| 11 | Mentioned missing editions and their reasons |
| 12 | Handled errors with at most one retry |
| 13 | Replied in the user's language and named editions, not countries |
| 14 | Efficiency: number of CLI calls, total tokens and cost (from the session logs) |
