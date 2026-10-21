# One-case comparison: local form filling

**Date:** 2026-09-12 · **Model:** `github-copilot/gpt-6-astra`, thinking `medium` · **pi:** 0.85.0 · **Windows**, Node 24.13.0, Chromium 145.0.7632.6.

## Result

On this form, **pi-computer-use's persistent Python/Playwright interface had 69.4% lower median end-to-end latency (3.26× speedup)** than the unmodified published `@injaneity/pi-computer-use@0.5.1`. Both completed all three measured runs correctly.

| Metric (median of 3 runs) | New `pi-computer-use` | `@injaneity/pi-computer-use` |
|---|---:|---:|
| Correct, exactly-once submissions | **3/3** | **3/3** |
| End-to-end wall time | **19.89 s** | 64.93 s |
| Agent-start → agent-end time | **15.73 s** | 63.09 s |
| Start → server-validated submission | **16.36 s** | 29.84 s |
| Tool calls | **2** | 13 |
| Model turns | **3** | 14 |
| Total time inside tool calls | 5.21 s | **3.69 s** |
| Pi-reported total tokens, including cache categories | **4,358** | 43,374 |

**Important:** the new tool backend was not faster in aggregate execution time. The gain came primarily from needing fewer model/tool round trips and fewer observation/recovery steps. Token counts are provider-reported usage, not a bill; no GitHub Copilot dollar-savings claim is made.

### Every measured run

| Pair / execution order | New: wall time / calls | Baseline: wall time / calls |
|---|---:|---:|
| 1: new → baseline | 20.45 s / 2 | 42.03 s / 13 |
| 2: baseline → new | 19.89 s / 2 | 64.93 s / 12 |
| 3: new → baseline | 17.78 s / 2 | 85.32 s / 26 |

No run in the measured series was removed. Baseline run 3 included a failed CDP launch (`Managed browser launched without a CDP page context`), native-UI fallback with Windows foreground refusals, then a successful browser relaunch. Its recovery time is included. Baseline runs 1–2 also needed extra observation/expansion to verify the completion message; the traces contain `No current controlled window` errors during some post-action searches.

## Case and method

The local [form](benchmarks/form.html) asks for five text values—Ada Lovelace, `ada@example.test`, Analytical Engines, Research Engineer, and a workshop-agenda note—plus a workshop-updates checkbox and **Register**. There are no external requests or real messages. An independent loopback server checks all six values and records each submission; success requires one correct submission, not merely the model saying “done.” The agents also observed the visible **Registration complete** result.

[The runner](benchmarks/run.mjs) launched six **separate pi CLI processes**, sequentially and in alternating order. Each received identical task wording and a neutral system prompt, a new URL/profile, the same visible Chromium executable, model and thinking level. Discovered extensions, skills, context files and built-in filesystem/shell tools were disabled. The baseline's 11 tools, including action batching and `evaluate_browser`, stayed enabled. Neither agent was given a prewritten solution or permission to bypass the UI through backend HTTP calls.

The new extension consistently used one `exec_py` call to launch/inspect the form, then one to fill all fields, check the box, submit and return a final screenshot. The baseline also batched field edits, but needed more calls to discover refs, inspect the checkbox and verify the result.

Wall time includes CLI startup and supervisor/process exit. Agent time uses timestamped `agent_start`/`agent_end` events. Tool time sums `tool_execution_start`→`tool_execution_end` intervals. Browser executables were identical, **but viewport, screenshot and observation policies remained each extension's defaults**; this is a practical interface comparison, not an isolated library microbenchmark.

## Validation and limits

- **20 automated tests passed**, plus TypeScript typechecking. Tests include persistence, serialization, exceptions, output/image limits, failsafe, focus refusal, cancellation, timeout, Windows orphan cleanup and actual Playwright interaction.
- **PyAutoGUI smoke test passed separately:** real keyboard entry, checkbox, submission, screenshot-coordinate check and Playwright verification. [Result](benchmarks/results/desktop-smoke.json): 2.64 s for the scripted action/verification segment. This was **not LLM-driven and is not included in the comparison table**. Earlier attempts encountered denied native focus; the final implementation verifies focus and refuses to type if Windows denies it.
- This is **one simple case, three runs per extension**, with no statistical-significance or general desktop-performance claim. Model/network variability, caches, different observation policies and baseline recovery affect the results. Structured tools can outperform this design on other tasks; the baseline also provides checks that unrestricted code execution does not.
- Initial development pilots are retained under `benchmarks/results/pilot*` and excluded from the explicitly named measured series. They exposed runner mistakes (unbundled pi entry point and missing `--` before the prompt), then produced a working pair before measurement.
- Windows Chromium can reparent itself during de-elevation, escaping ordinary descendant cleanup. Some benchmark browsers remained open after CLI exit; [explicit URL-scoped cleanup](benchmarks/cleanup.mjs) closed six completed benchmark browser trees afterward. That manual cleanup is **not** included in the latency table. See [cleanup record](benchmarks/results/cleanup.json).
- The extension executes Python with full user permissions. **It is not a security sandbox.** Use a disposable desktop/VM for untrusted sites or tasks.

## Evidence and reproduction

- [Original final screenshot returned by the new extension](benchmarks/results/measured/completed-form.png)
- [All measured summaries and exact submissions](benchmarks/results/measured/summary.json)
- [Computed statistics](benchmarks/results/measured/statistics.json)
- [Versions and source/artifact hashes](benchmarks/results/measured/metadata.json)
- Per-run `invocation.json`, `events.jsonl`, `stderr.log`, `summary.json` under `benchmarks/results/measured/<run-id>/`. Raw traces are retained locally but Git-ignored because they include images and model output.
- [Setup/reproduction instructions](README.md#reproduce-the-comparison), including the pinned npm baseline.
- [OpenAI guide](https://developers.openai.com/api/docs/guides/tools-computer-use) and [sample app](https://github.com/openai/openai-cua-sample-app); exact provenance in [THIRD_PARTY.md](THIRD_PARTY.md).
