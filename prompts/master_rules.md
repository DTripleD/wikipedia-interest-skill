# Wikipedia Interest Analysis Agent Skill — Master Development Prompt

> The prompt that drove the development of this repository with Claude Code, one roadmap
> stage per session. It was prepared with the help of ChatGPT and is kept here as a record of
> the AI-assisted process (see README → "AI-assisted development"). Only the Markdown layout
> was tidied after the fact; the wording is unchanged.

You are working with me on a take-home assignment.

Your job is to help me build a production-quality standalone Agent Skill that allows AI agents
to analyze Wikipedia article pageviews across languages and topics, identify trends, compare
audiences, generate charts, and produce short shareable reports.

## 1. Assignment

Build a standalone Agent Skill for AI agents that helps B2C product founders analyze Wikipedia
pageviews across languages and topics to decide which topics/languages may be worth
researching further.

Example user requests:

- “Compare interest in intermittent fasting in Polish vs Czech Wikipedia over the last 2 years.”
- “Assess interest in astronomy in Ukrainian Wikipedia and provide a confidence assessment.”
- “Compare interest in learning English across several language Wikipedias and prepare a short report about which audiences should be researched next.”

The Skill must:

- analyze Wikipedia pageview data;
- work across multiple Wikipedia language editions;
- resolve human-readable topics to the correct Wikipedia articles;
- fetch and process historical pageview data;
- calculate meaningful statistics and trends;
- generate charts;
- generate a short shareable report, such as a one-page PDF;
- provide evidence-based confidence/quality indicators;
- clearly communicate limitations;
- contain a SKILL.md;
- contain custom executable code that performs meaningful data work.

A markdown-only Skill is NOT sufficient.

The implementation must be efficient enough to be usable by a relatively cheap/fast model such
as Claude Haiku 4.5 or an equivalent model.

## 2. Core architecture

Use this separation of responsibilities:

**AI Agent / LLM.** The AI agent should be responsible for:

- understanding the user’s natural-language request;
- identifying the topic and languages;
- deciding which Skill workflow to execute;
- asking clarification questions when the request is ambiguous;
- orchestrating the deterministic tools;
- interpreting the resulting structured data;
- producing the final natural-language explanation.

**Deterministic code.** The custom code must be responsible for:

- Wikipedia article resolution;
- Wikimedia API requests;
- data validation;
- caching;
- normalization;
- aggregation;
- statistical calculations;
- trend calculations;
- outlier detection;
- confidence/evidence calculations;
- chart generation;
- PDF/report generation.

Do NOT rely on the LLM to calculate statistics from raw pageview data.

The goal is to make numerical results reproducible, testable, and resistant to hallucinations.

## 3. Technology

Use TypeScript + Node.js unless you identify a strong technical reason to use another stack.

Prefer:

- TypeScript
- Node.js
- native fetch where practical
- Vitest for tests
- a suitable charting library
- a suitable PDF generation library
- minimal dependencies

Keep the implementation reasonably simple and maintainable. Do not over-engineer the project.

## 4. Expected project structure

You may improve this structure if there is a good reason, but keep the responsibilities clearly
separated.

```
wikipedia-interest-skill/
├── SKILL.md
├── README.md
├── AGENTS.md
├── package.json
├── tsconfig.json
├── src/
│   ├── wikipedia/
│   │   ├── api.ts
│   │   └── resolver.ts
│   ├── analysis/
│   │   ├── trends.ts
│   │   ├── outliers.ts
│   │   └── confidence.ts
│   ├── charts/
│   ├── reports/
│   └── cli.ts
├── tests/
├── examples/
└── evaluation/
```

The exact structure is your decision as long as the architecture remains clean.

## 5. Development roadmap

Develop the project incrementally in the following stages.

### Stage 1 — Project setup

Create:

- Node.js + TypeScript project;
- package configuration;
- TypeScript configuration;
- test setup;
- basic directory structure;
- initial README;
- AGENTS.md containing the project’s current state and development rules.

At the end, verify that the project builds and tests run.

### Stage 2 — Wikimedia Pageviews API

Implement a robust Wikimedia Pageviews API client.

It should support:

- language/project;
- article;
- date range;
- pageview data retrieval;
- validation;
- HTTP/API error handling;
- reasonable retry/error behavior.

Use real Wikimedia API requests for integration testing where appropriate, but keep unit tests
deterministic.

Document the API assumptions instead of guessing them.

### Stage 3 — Wikipedia article resolver

Implement a resolver that can take something like:

```
topic = "intermittent fasting"
language = "pl"
```

and resolve it to the appropriate Wikipedia article.

Handle:

- normal article matches;
- redirects;
- alternative titles;
- missing articles;
- disambiguation pages;
- ambiguous matches.

If confidence is insufficient, the system should expose that uncertainty instead of silently
selecting an arbitrary article.

### Stage 4 — Data model, normalization and caching

Define a clean internal data model for pageview data. For example:

```
date
language
article
views
```

Implement:

- validation;
- normalization;
- aggregation;
- caching.

Caching should reduce unnecessary Wikimedia API requests and make repeated analyses faster.

### Stage 5 — Analytics engine

Implement deterministic analysis functions for:

- total views;
- monthly aggregation;
- recent vs previous period;
- year-over-year change;
- trend/slope;
- moving averages;
- volatility;
- outlier detection;
- cross-language comparison.

All important calculations must have automated tests using deterministic fixtures.

Do not let the LLM perform these calculations.

### Stage 6 — Confidence / evidence model

Create an evidence-based confidence or data-quality assessment.

Consider factors such as:

- trend strength;
- data coverage;
- sample size;
- volatility;
- outliers;
- consistency;
- seasonality where appropriate.

Do NOT create arbitrary confidence numbers such as “87%” without a defensible methodology.

The system should explain why confidence is high, medium, or low.

Also clearly distinguish **Wikipedia attention / information-seeking behavior** from **actual
market demand / willingness to pay**.

Wikipedia pageviews must never be presented as direct proof of commercial demand.

### Stage 7 — Charts

Generate useful visualizations from the deterministic analysis results.

Potential charts:

- views over time;
- moving average;
- language comparison;
- year-over-year comparison.

Charts should consume already-processed structured data.

Do not put statistical calculations inside the chart layer.

### Stage 8 — Report generation

Generate a short, shareable report, preferably a one-page PDF.

It should contain:

- title;
- analysis period;
- languages/topics;
- key metrics;
- one or more useful charts;
- concise findings;
- confidence/evidence assessment;
- limitations.

The report should be understandable without reading the source code.

### Stage 9 — CLI / tool interface

Create a clean interface through which the Agent Skill can invoke the deterministic
functionality.

Possible commands:

```
resolve
fetch
analyze
chart
report
```

You may design a better interface if appropriate.

The interface should return structured, predictable output that is easy for a cheap LLM to
consume.

Avoid forcing the LLM to parse huge raw datasets.

### Stage 10 — SKILL.md

Only after the underlying implementation is working, create the final SKILL.md.

It should explain:

- when the Skill should be used;
- how the agent should interpret user requests;
- how to identify topics and languages;
- when clarification is required;
- which tools/commands to call;
- in what order;
- how to interpret results;
- how to handle uncertainty;
- what the agent must never invent;
- how to produce the final response;
- how to generate reports.

The Skill should be optimized for use by a cheap/fast model.

Keep instructions explicit and operational rather than overly verbose.

### Stage 11 — End-to-end scenarios

Test the complete Skill against the assignment scenarios. At minimum:

1. Compare intermittent fasting in Polish vs Czech Wikipedia over the last two years.
2. Analyze astronomy interest in Ukrainian Wikipedia and provide a confidence assessment.
3. Compare English-learning interest across several Wikipedia language editions and produce a short research-oriented report.

Verify that the agent:

- understands the request;
- resolves the correct articles;
- retrieves the correct data;
- calls deterministic analysis code;
- produces correct calculations;
- generates charts;
- can generate the PDF report;
- provides a useful explanation;
- communicates limitations.

### Stage 12 — Cheap-model evaluation

Test the complete workflow using a cheap/fast model such as Claude Haiku 4.5 or an equivalent
model.

Evaluate:

- instruction following;
- correct tool selection;
- correct parameter selection;
- handling of ambiguity;
- avoidance of invented data;
- correct interpretation of structured results;
- token efficiency;
- failure handling.

Document the evaluation process and findings.

### Stage 13 — Edge cases and robustness

Test cases such as:

- article does not exist;
- incorrect article title;
- redirect;
- disambiguation page;
- language edition unavailable;
- API errors;
- timeout;
- incomplete data;
- zero views;
- extreme outliers;
- unusually large differences between language editions;
- short analysis periods;
- missing data points.

Fix issues found during these tests.

### Stage 14 — Final cleanup

Before considering the project complete:

- run all tests;
- run type checking;
- run build;
- review architecture;
- remove unnecessary dependencies;
- remove dead code;
- improve error messages;
- update README;
- document setup;
- document usage;
- document architecture;
- document testing;
- document AI-assisted development and how AI-generated output was validated.

The final repository should be understandable to another developer who has never seen the
project.

## 6. Very important development rules

These rules are mandatory.

**Do not blindly assume.** If anything is unclear, ambiguous, technically uncertain, or missing
from the requirements, ASK ME. You are explicitly allowed and encouraged to ask questions. Do
not make important architectural or product decisions based on assumptions when clarification
would be better.

**Do not hallucinate APIs.** If you are unsure how a library or API works:

- inspect its documentation;
- inspect the installed package/types;
- test it;
- or ask me.

Never invent API behavior.

**Keep the implementation incremental.** Do not implement multiple roadmap stages at once.
Complete exactly one stage, validate it, and STOP.

**Never silently rewrite working architecture.** If you discover that an earlier architectural
decision should change, explain:

1. what is wrong;
2. why it matters;
3. what you propose changing;
4. what impact the change will have.

Wait for my approval before making significant architectural changes.

**Tests are part of implementation.** Do not consider a stage complete merely because the code
compiles. Add appropriate tests and actually run them.

**Preserve context in the repository.** Maintain AGENTS.md throughout development. After each
completed stage, update it with:

- completed stages;
- current stage;
- important architectural decisions;
- known limitations;
- important implementation details;
- remaining work.

This file should allow a new Claude Code session to understand the current state of the project.

## 7. Session boundaries

This is extremely important.

After completing EACH roadmap stage:

1. implement the stage;
2. write/update tests;
3. run tests;
4. run type checking/build where relevant;
5. inspect the resulting implementation;
6. update AGENTS.md;
7. summarize exactly what changed;
8. list files changed;
9. list commands/tests executed and their results;
10. mention any known limitations;
11. STOP.

Do NOT automatically start the next stage.

Do NOT make a Git commit yourself.

I will manually review your changes and create the Git commit myself.

After stopping, wait for my next instruction.

I may start a completely new Claude Code session for the next stage. When a new session starts,
first read:

- AGENTS.md;
- README.md;
- relevant source files;
- relevant tests;
- Git status.

Then determine the current project state before doing anything.

## 8. Git

Never create commits unless I explicitly ask you to.

I want to review every completed stage myself and create the commit manually.

Do not reset, revert, or rewrite my Git history without explicit permission.

## 9. Quality over speed

Do not rush to produce code.

Prefer:

- simple architecture;
- deterministic behavior;
- strong typing;
- meaningful tests;
- clear error handling;
- reproducibility;
- maintainability.

Avoid:

- unnecessary abstractions;
- premature optimization;
- excessive dependencies;
- over-engineering;
- speculative features not required by the assignment.

## 10. First action

Before writing implementation code:

1. inspect the repository;
2. inspect any existing files;
3. analyze the assignment;
4. identify ambiguities or questions;
5. propose the implementation plan;
6. explain any important technical decisions.

If you have questions, ask them before implementation.

If everything is sufficiently clear, begin with Stage 1 only.

Remember:
One stage at a time. Test it. Update project context. Stop. Wait for my review and commit.
