# End-to-end scenarios (Stage 11)

The three assignment scenarios, run end to end on 2026-09-25. Each scenario was handled by a
fresh agent (Claude Opus subagent) that saw only [SKILL.md](../SKILL.md) and the user messages,
not the source code. The user's follow-up replies were scripted in advance:

- scenario 1: accept a broader Polish article if the agent offers one;
- scenario 3: editions `de, es, tr, pl, uk`; decline alternative articles.

The prompts are the assignment's Ukrainian examples. The period is the default: the 24 months
ending yesterday (2024-09-25 to 2026-09-24). Raw CLI outputs were saved during the run and are
not committed; the same flows run with a fixed period in
[tests/integration/scenarios.live.test.ts](../tests/integration/scenarios.live.test.ts)
(`npm run test:integration`).

## How the answers were checked

- Every number in each final answer was extracted by a small script and looked up in the saved
  CLI JSON. All were found; the only mismatches were reformatted dates (`25.09.2024`) and list
  numbering.
- Each answer was read against SKILL.md: request understanding, commands and flags, handling of
  missing editions and questions to the user, confidence, the attention-not-demand limitation.
- The scenario 3 PDF was opened and inspected (one page, banner, table, two charts, findings,
  labelled analyst note, confidence, limitations).

## Results

| Check | 1 | 2 | 3 |
| --- | --- | --- | --- |
| Understood the request (topic, editions, period, report or not) | yes | yes | yes, asked which editions first |
| Resolved the right articles | cs `Přerušovaný půst`; pl has no linked article | uk `Астрономія` | `English as a second or foreign language`: de, es, tr; pl, uk have none |
| Handled missing editions as SKILL.md says | offered a broader pl article, verified it with `resolve --title`, used it only after the user agreed, and flagged it as not directly comparable | n/a | reported pl/uk as missing and offered alternatives; the scripted user did not take them |
| Used only the CLI for data | 3 calls | 1 call | 2 calls (`analyze`, then `report` with a note) |
| Every number in the answer is in the JSON | yes | yes | yes |
| Confidence level and reasons stated | medium | medium, with the per-claim levels | low, with per-edition levels |
| Attention ≠ demand stated | yes | yes | yes (also in the note and the PDF) |
| Charts / PDF | not requested | not requested | one-page PDF with comparison and YoY charts |

## Findings

- **Scenario 1:** the user asked about "growth", and the agent correctly answered that both
  editions are declining. It wrote "Czechia is ahead" and "growth in Poland", mixing up
  editions and countries. Fixed: SKILL.md now says to name editions, not countries.
- **Scenario 2:** the agent explained that the decline is mostly a one-time step in mid-2025,
  when the whole uk edition dropped 33 %. It did not treat the +26.7 % recent change as a
  confirmed reversal.
- **Scenario 3:** the English-learning concept article exists in only 7 of the 20 editions checked
  (de, es, tr, id, ko, zh, ar), so "learning English" comparisons often have missing editions.
  Traffic is 2–5 views/day, so confidence is low even though the ranking held in all 23 months.
- **Report formatting:** views per million are rounded to one decimal in the PDF table and
  findings (`0.12` becomes `0.1`). This loses precision for small articles. The CLI JSON keeps two
  decimals. To fix in Stage 13.

## Transcripts

### Scenario 1 — intermittent fasting, Polish vs Czech Wikipedia, last two years

#### User

> Порівняй зростання інтересу до інтервального голодування в польськомовній та чеськомовній
> Wikipedia за останні два роки.

#### Agent: turn 1

Command: `node dist/cli.js analyze --topic "Intermittent fasting" --languages pl,cs`

pl came back in `missing` ("no article linked to the topic"). The agent answered with the cs
numbers, named the missing edition, and offered (SKILL.md §3) to look for a broader Polish
article whose numbers would not be directly comparable.

#### User

> Так, спробуй знайти ширшу польську статтю і перевір її.

#### Agent: turn 2

Command: `node dist/cli.js resolve --topic "Intermittent fasting" --languages pl --title "pl=Głodówka lecznicza"`

> Я перевірив польську статтю «Głodówka lecznicza» («Лікувальне голодування»). Вона існує, але
> відповідність лише середня (medium). Це інше, ширше поняття: у Wikidata в неї інший елемент
> (Q352490), ніж у «Intermittent fasting» (Q1666254). Тому її цифри не можна напряму порівнювати
> з чеською статтею «Přerušovaný půst». Проаналізувати польську Wikipedia за цією статтею поряд з
> чеською (за той самий період, останні 24 місяці)?

#### User

> Так, проаналізуй польську за цією статтею поряд з чеською.

#### Agent: turn 3 (final answer)

Command: `node dist/cli.js analyze --topic "Intermittent fasting" --languages pl,cs --title "pl=Głodówka lecznicza"`

**Період:** 2024-09-25 – 2026-09-24 (останні 24 місяці).

**Коротко:** Зростання інтересу немає в жодній з двох мовних версій. В обох інтерес статистично
значущо падає. Відносно розміру своєї Wikipedia чеська стаття отримує більше уваги: польська
становить 28 % від рівня чеської. Чехія попереду в 23 з 23 повних місяців.

Важливо: у польській Wikipedia немає статті саме про інтервальне голодування. Для польської мови
використано ширшу статтю «Głodówka lecznicza» (лікувальне голодування). Це інше поняття (у
Wikidata Q352490 проти Q1666254), тому порівняння лише орієнтовне.

**Ключові цифри:**

| | cs: «Přerušovaný půst» | pl: «Głodówka lecznicza» (ширша стаття) |
| --- | --- | --- |
| Переглядів на мільйон переглядів своєї Wikipedia | 4.4 | 1.23 |
| Усього переглядів | 6 697 | 5 819 |
| Медіана на день | 6 | 7 |
| Рік до року | -56.3 % (без сплесків -44.2 %) | -38.3 % (без сплесків -40.8 %) |
| Останні 90 днів проти попередніх 90 | -25 % | +12.4 % (без днів-сплесків -2 %) |
| Тренд | спадний, приблизно -55.3 %/рік (p < 0.001) | спадний, приблизно -40.1 %/рік (p < 0.001) |

**Надійність: середня (medium).**
- cs: трафік низький (медіана 6 переглядів на день). 21 день-сплеск дає 18 % усіх переглядів.
  Найбільший сплеск 2025-04-14: 508 переглядів при звичайних 14. Причину треба перевіряти окремо.
- pl: стаття відповідає темі лише частково (інше поняття в Wikidata). Трафік низький (медіана 7
  переглядів на день).
- Для трендів і зміни рік до року надійність середня в обох мовах. Польське зростання за останні
  90 днів (+12.4 %) тримається майже повністю на днях-сплесках: без них -2 %. Тому говорити про
  нове зростання в Польщі не можна.
- Рейтинг стабільний: чеська стаття попереду щомісяця.

**Обмеження:**
- Перегляди Wikipedia показують увагу до теми та пошук інформації на Wikipedia. Вони не є мірою
  ринкового попиту, наміру купити чи готовності платити.
- Різниця між мовами також залежить від того, наскільки повно кожна Wikipedia висвітлює тему, від
  якості статті та її видимості в пошуку. Вона залежить і від того, скільки людей читають
  Wikipedia іншою мовою, часто англійською. Тут до того ж порівнюються статті різної широти.

### Scenario 2 — astronomy in Ukrainian Wikipedia, with confidence

#### User

> Ми думаємо додати курс з астрономії до освітнього застосунку. Чи зростає інтерес до цієї теми
> в україномовній Wikipedia, і наскільки цьому зростанню можна довіряти?

#### Agent: commands

1. `node dist/cli.js analyze --topic "Astronomy" --languages uk`

No clarification needed: one topic, one edition, default period (24 months). The agent
translated the Ukrainian topic to the English article title as SKILL.md step 1 says.

#### Agent: final answer

**Коротко:** ні, інтерес не зростає. За період 2024-09-25 – 2026-09-24 (730 днів, стандартні
24 місяці) перегляди статті «Астрономія» в україномовній Wikipedia **зменшуються**. Проте
падіння схоже на одноразовий обвал у середині 2025 року, а не на поступове згасання. Частково
цей обвал стосується всієї української Wikipedia, а не лише астрономії.

**Ключові цифри** (стаття «Астрономія», uk; відповідність темі висока, знайдено через міжмовне
посилання з en:"Astronomy"):

| Показник | Значення |
| --- | --- |
| Усього переглядів | 19 963 |
| Медіана за день | 20 |
| На мільйон переглядів розділу | 12.77 |
| Зміна рік до року | −55.5 % (без днів-сплесків: −56 %) |
| Останні 90 днів проти попередніх 90 | +26.7 % |
| Тренд | спадний, близько −62 % на рік (p < 0.001, 23 місяці) |
| Найбільший день | 2025-09-03, 131 перегляд |
| Сезонність | не виявлена |

- **Різкий спад:** між 2025-05 і 2025-06 рівень упав приблизно з 48.3 до 13.5 переглядів на
  день. У той самий час загальні перегляди всієї української Wikipedia змінилися на −33.2 %,
  тому частина падіння не пов'язана з темою. Причину (перейменування чи об'єднання статті,
  зміни в пошуковиках або у Wikipedia, новини) треба перевірити окремо. Я не можу стверджувати
  її як факт.
- За останні 90 днів перегляди зросли на +26.7 % порівняно з попередніми 90 днями. Це ще не
  підтверджений розворот: довіра до цього показника середня, а сезонність на такому короткому
  ряді надійно перевірити не вдалося.
- Сплески майже не впливають на результат: 8 аномальних днів дають лише 1.2 % переглядів.

**Наскільки можна довіряти: середня.** Причини:
1. Трафік низький (медіана 20 переглядів на день), тому окремі події та випадковий шум помітно
   зсувають цифри.
2. Інтерес нерівномірний: типовий місяць відхиляється на 21 % від рівнів до і після спаду.
3. Зміна виглядає як одноразовий стрибок (Pettitt p = 0.008), а не як поступовий тренд.
   Частково вона стосується всього розділу.

Окремо за кожним висновком: тренд — середня довіра (спад статистично значущий, але це радше
одноразовий стрибок); зміна рік до року — середня; останні 90 днів проти попередніх — середня.

**Важливе обмеження:** перегляди Wikipedia показують увагу до теми й пошук інформації у
Wikipedia. Вони не вимірюють ринковий попит, намір купити чи готовність платити за курс. До
того ж дані охоплюють лише одну статтю в одному мовному розділі: перегляди пов'язаних статей,
перенаправлень та інших мов сюди не входять.

**Що робити далі:** перед рішенням про курс перевірте реальний попит: обсяги пошуку українською
(наприклад, Google Trends), опитування ваших користувачів, дані магазинів застосунків про
освітні застосунки з астрономії або пілотний продаж чи список очікування.

### Scenario 3 — interest in learning English across selected editions, short report

#### User

> Ми створюємо застосунок для вивчення мов. Порівняй інтерес до вивчення англійської у вибраних
> нами мовних розділах та підготуй короткий звіт: які аудиторії варто дослідити наступними й чому?

#### Agent: turn 1 (clarification, no commands)

> Які саме мовні розділи Вікіпедії порівняти (наприклад, pl — польська, cs — чеська, uk —
> українська, de — німецька, es — іспанська)? Назвіть, будь ласка, коди або мови.

#### User

> Порівняй німецьку, іспанську, турецьку, польську та українську (de, es, tr, pl, uk).

#### Agent: turn 2 (final answer)

Commands:
1. `node dist/cli.js analyze --topic "English as a second or foreign language" --languages de,es,tr,pl,uk`
2. `node dist/cli.js report --topic "English as a second or foreign language" --languages de,es,tr,pl,uk --note "Relative to edition size, the Turkish article gets the most attention, then Spanish, then German; the order held in every complete month. All three are declining, but traffic is very low (a few views per day), so confidence is low. Polish and Ukrainian have no linked article, so no conclusion is possible there. Treat tr and es as candidates to validate with real demand data (search volume, surveys, app-store data), not as proven markets."`

The agent mapped "learning English" straight to the concept article (SKILL.md step 1), so the
disambiguation page `Learning English` was never hit. It ran `analyze` first to see the numbers
before writing the analyst note, as SKILL.md §5 suggests.

**Відповідь.** Період: 25.09.2024–24.09.2026 (останні 24 місяці). Я брав статтю «English as a
second or foreign language», тобто англійську як іноземну мову, і порівнював розділи з
урахуванням їхнього розміру. Найбільше уваги до теми в турецькому розділі (tr), далі йде
іспанський (es), найменше в німецькому (de). Цей порядок не змінювався в жодному з 23 повних
місяців. В усіх трьох розділах інтерес помітно спадає. Проте переглядів дуже мало, тому довіра
до даних загалом **низька**.

**Ключові цифри**

| Розділ | Стаття | Переглядів на млн | Усього переглядів | Зміна за рік | Тренд |
|---|---|---|---|---|---|
| tr | Yabancı dil olarak İngilizce eğitimi | 0.78 | 2213 | −43.9 % | спадає, ≈ −41.5 %/рік |
| es | Inglés como segunda lengua | 0.28 (36.6 % від лідера) | 4152 | −50 % | спадає, ≈ −47.6 %/рік |
| de | Englisch als Zweitsprache | 0.12 (15.5 % від лідера) | 2113 | −36.2 % | спадає, ≈ −27.3 %/рік |

**Наскільки можна довіряти даним**
- Загальний рівень **низький**: tr низький, es середній, de низький.
- Основна причина в малому трафіку. Типовий день (медіана) дає 2 перегляди в tr, 5 в es і 3 в
  de, тож окремі події та випадковий шум сильно впливають на цифри.
- У de інтерес різко змінився між 2025-08 і 2025-09: приблизно з 3.3 до 2.5 перегляду на день.
  Це схоже на разовий стрибок, а не на поступовий тренд. Причину варто перевірити:
  перейменування статті, зміни в пошуковиках, новини.
- Спад статистично значущий у всіх трьох розділах (p < 0.001). Довіра до трендів і до зміни за
  рік: tr низька, es середня, de низька.
- У tr інтерес сезонний, тому краще дивитися на зміну за рік, а не на порівняння останніх 90
  днів.

**Розділи без даних**
- pl (польська) і uk (українська): немає статті, пов'язаної з цією темою. Тож про ці аудиторії
  висновків немає.
- Якщо хочете, можу пошукати ширшу статтю в цих розділах. Її цифри будуть лише умовно
  порівнянними з рештою.

**Обмеження.** Перегляди Вікіпедії показують увагу до теми та пошук інформації. Це не попит на
ринку, не намір купити і не готовність платити. Крім того, різниця між розділами залежить і від
того, наскільки добре кожен розділ висвітлює тему. Також багато читачів користуються англійською
Вікіпедією замість своєї мовної.

**Які аудиторії досліджувати далі**
1. **Турецька (tr)** — перший кандидат. Відносно розміру розділу уваги тут найбільше, і лідерство
   стабільне щомісяця. Але трафік дуже малий, тож це лише сигнал.
2. **Іспанська (es)** — другий кандидат. Тут найбільше переглядів загалом і найвища довіра до
   даних серед трьох (середня). Врахуйте, що es охоплює Іспанію та Латинську Америку.
3. **Польську й українську** Вікіпедія оцінити не дає, їх потрібно перевіряти іншими джерелами.
4. **Німецька (de)** має найнижчий відносний інтерес і незрозумілий стрибок у 2025 році, тож її
   пріоритет нижчий.

Спад в усіх розділах і низька довіра означають, що рішення варто перевірити на даних про
справжній попит: обсяги пошуку (наприклад, «learn English» місцевими мовами), опитування, дані
магазинів застосунків, пілотні продажі.

**Файли.** PDF-звіт: `output/english-as-a-second-or-foreign-language_de-es-pl-tr-uk_2024-09-25_2026-09-24.pdf`
