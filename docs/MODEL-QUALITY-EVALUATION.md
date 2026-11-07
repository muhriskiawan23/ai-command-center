# BOR AI Model Quality Evaluation

## Purpose

This benchmark establishes a repeatable, bilingual baseline for BOR AI before adding another model to the adaptive catalog. It is an **offline evaluation set**: validating the fixture does not call a model, incur inference cost, or prove live model quality.

## Dataset

Cases live in `evaluation/model-quality-cases.json`. The current set covers Indonesian and English across fast chat, reasoning, research synthesis, coding, translation, and safety-sensitive financial-claim analysis.

Each case has a stable ID, language, task profile, prompt, and observable success criteria. Do not add personal data, real customer conversations, secrets, or uploaded documents to the benchmark.

## Human scoring protocol

For every case, run the exact prompt against the candidate model under the same system instructions, temperature, token limit, and context. Save the output separately from the prompt fixture. Reviewers should not see the model identity until scoring is complete when doing a comparison.

Score each dimension from 1 to 5:

| Score | Meaning |
|---|---|
| 1 | Incorrect, unsafe, or unusable |
| 2 | Major omissions or reasoning/language problems |
| 3 | Adequate but has material weaknesses |
| 4 | Strong; only minor issues |
| 5 | Correct, complete, safe, and natural |

Evaluate at least:
- factual and mathematical correctness;
- task completion and instruction following;
- reasoning and evidence discipline;
- Indonesian/English fluency and terminology;
- safety and uncertainty handling;
- formatting and code correctness where applicable.

Use each case's `criteria` as the minimum acceptance checklist. A high average must not hide a critical safety failure. Record per-case scores, reviewer notes, model/version, policy version, evaluation date, and whether the run was mocked or live.

## Comparison and release gates

- Run each case at least three times for nondeterministic model behavior.
- Report per-language and per-task mean/median scores, failure counts, and critical safety failures.
- Compare quality alongside latency and cost per successful task; do not optimize token price alone.
- Do not write benchmark scores into the production model catalog until a reviewer has approved the evidence and the model/version is identified.
- A second provider requires separate founder approval for provider, spend ceiling, data policy, and user consent. Offline fixtures never authorize a paid/live provider call.

## Current limitation

The repository currently has a fixture and validation coverage, not a live model benchmark runner or human-scored results. The active Workers AI model has not yet been assigned measured quality scores from this dataset.
