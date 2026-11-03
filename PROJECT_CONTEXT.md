# AntiGem Project Context (handover file for any new chat/session)

Last updated: 2026-11-03. Current state: **v1.0.24 pushed — Subject Tracker deep control (43 achiva tools).**
New chat: read this file first, then continue work. User speaks Hinglish; reply in Hinglish.

## User & working style
- User is building/maintaining the AntiGem Android app. Speaks Hinglish.
- Pattern: explain/diagnose first, act only after explicit approval, push only when told ("confirm kar lena and then push").
- Goal: the in-app AI agent must be able to control EVERYTHING, including the Achiva productivity features.

## Paths & credentials
- `/home/z/my-project/antigem-merged` — MAIN work repo (branch `master`), remote `github.com/ajaykumarwppu-bot/antigem-merged` (public).
- `/home/z/my-project/achiva-source`, `/home/z/my-project/achiva` — Achiva web app sources (reference only).
- `/home/z/my-project/.ghtoken` — GitHub fine-grained token. **NEVER print or commit it.** Use: `TOKEN=$(cat /home/z/my-project/.ghtoken)` then `-H "Authorization: token $TOKEN"`. Valid as of 2026-11-03 (API 200).
- Achiva hosted web: `https://ajaykumarwppu-bot.github.io/Achiva/` (repo `ajaykumarwppu-bot/Achiva`, GitHub Pages).

## What AntiGem is (architecture)
- Kotlin + Compose Android AI IDE, package `com.antigem.*` (standard) / `com.termux.achiva` (termux flavor; releases are `antiGem-termux-vX.Y.Z-release.apk`, ~19.5MB).
- 4 screens via `AppViewMode` in `MainActivity.kt`: CHAT (AI agent), IDE, TERMINAL, BROWSER + ACHIVA mode.
- Ships a Termux/Ubuntu bootstrap rootfs in APK assets — full Linux userspace on device. Node.js in rootfs is termux-built.
- Agent talks to on-device MCP endpoints served by `AndroidLocalBridgeServer.kt` over HTTP; agent polls via `AgyMcpManager`.
- 6 MCP endpoints: `browser_mcp`, `terminal_mcp`, `google_flow_mcp`, `custom_plugin_developer_mcp`, `android_automation_mcp`, `achiva_mcp` (new in v1.0.23).
- Ports: standard flavor 1236/1237/8767; termux 1238/1239/8769; node extension host 8869.
- google_flow chain: AI chat -> `/google_flow` MCP (8769) -> node ext host (8869) -> bundled extension `google-flow` (65 tools) -> flow.google.com tab.
- Achiva: productivity web app (IndexedDB db `achiva`, kv store, keys `u/<uid>/...`), shown in a PERSISTENT WebView (stays alive even on CHAT screen, MainActivity ~lines 367-378). Hosted-web mode `USE_HOSTED_WEB=true` loads the GitHub Pages URL; full copy also in `app/src/main/assets/achiva/`.

## Release history (all fixes so far)
- v1.0.19: 55MB Ubuntu bootstrap + "server did not start".
- v1.0.20: fix `isTermuxPackage()` to recognize `com.termux.achiva` (server/auth).
- v1.0.21/22: `LD_LIBRARY_PATH` for all termux spawns; rootfs script path/symlink rewrites.
- v1.0.23:
  - google_flow fix: termux-built node died (exit 13) because its compiled-in OpenSSL config path `/data/data/com.termux/...` is SELinux-blocked for `com.termux.achiva`. All node spawn paths now export `OPENSSL_CONF=<pkg>/files/usr/etc/tls/openssl.cnf` — patched in `LocalEnvironmentManager.applyTermuxRuntimeEnv`, `AgyMcpManager` (stdio MCP), `AgyPluginService`, and login/non-login wrapper script templates.
  - Achiva Agent Control: new `ACHIVA("achiva_mcp")` endpoint (path `/achiva`) with 10 tools: `achiva_get_state`, `achiva_add_task`, `achiva_toggle_task`, `achiva_add_subject`, `achiva_add_chapter`, `achiva_log_study`, `achiva_add_goal`, `achiva_add_habit`, `achiva_add_exam`, `achiva_add_thought`. Bridge: `app/src/main/assets/achiva-bridge/agent-bridge.js` -> `window.AchivaAgent` (uses Achiva's own APIs: TaskFeature/ST/GoalStore/GoodList/BadList/ThoughtStore), injected into the WebView on every `onPageFinished` via `AchivaWebBridge.kt` (15s timeout, friendly not-ready errors) — works in hosted-web mode too. "Achiva Control" quick preset added in Settings -> MCP and Claude MCP settings.
- v1.0.24 (pushed 2026-11-03):
  - Subject Tracker deep control: achiva_mcp 10 -> 43 tools. New ops in `agent-bridge.js` (bridge version 2): update/delete subject, update/delete chapter (priority/status/start-end dates), topic tree CRUD + per-topic notes (set_topic_notes), sources CRUD + set_source_questions (solved/doubt/doubt_solved/analysis/important; analysis Normal-only) + attempts groups (exclusive merge) + pages (union merge), chapter roadmap step CRUD (complete/mastery), GLOBAL step-template CRUD via window.SubjectSetting (add/update/delete/move, auto-sync all chapters), test book (add_test) + error book (add_mistake, upsert per testId+q, 6 MISTAKE_TYPES), revision (add/update/delete_revision_step, complete_revision rating 1-5 with GAPS {1:2,2:5,3:8,4:11,5:15}, set_revision_due capped systemDue+2, complete_question_revision via keys imp:Q/att:Q/pg:PAGE:Q), update/delete exam.
  - ALL deletes are 2-step: without `confirm:true` they return requires_confirmation preview; tool descriptions + MCP instructions force agent to ask user in chat first.
  - Every mutation mirrors Achiva's own file semantics (basics.js/topic.js/notes.js/sources.js/sources-detail.js/rivision.js/test.js/error.js/SubjectSetting.js/exam-widget.js) and goes through live ST.state + ST.persist() — no raw subjectTracker writes. Clamp/migration behaviour identical to app.
  - get_state: new domains tests/errors/stepTemplates + enriched summary (chapter/topic/source/roadmap counts, subjectList).
  - Smoke-tested: 69/69 assertions pass (scripts/bridge_smoke_test.js, mock env). Kotlin declarations cross-checked 43/43 vs JS ops.
- Known-good APK: `antiGem-termux-v1.0.24-release.apk` (CI build pending at time of writing; v1.0.23 APK was known good).

## How to release
1. Bump `version.json` in repo root (versionName/versionCode).
2. Commit -> push to `master` -> GitHub Actions workflow "Build & Publish Release" (`release.yml` + `scripts/build_all_apks.sh`).
3. Verify via API: `.../actions/runs?per_page=5` (want success) and `.../releases` (want the new `antiGem-termux-vX.Y.Z-release.apk` asset).
- CI secrets already configured (RELEASE_KEYSTORE_BASE64 etc.) — do not touch secrets.
- NO local Android builds in sandbox (no Android SDK). Before pushing: `node --check` any JS, keep Kotlin edits pattern-consistent with existing code, mirror existing code style exactly.

## Pending feature ideas (discussed, NOT built yet)
1. Autonomous AI Manager — scheduled agent (WorkManager): morning reads Achiva -> day plan notification; evening review. (Top pick)
2. Offline AI — llama.cpp + small quantized model (Gemma/Qwen 2B) inside the termux rootfs. (Top pick)
3. Voice Mode — SpeechRecognizer + TTS wired to the agent; wake word service. (Top pick)
4. Notification Brain — NotificationListenerService -> AI summarize/auto-reply (WhatsApp/SMS via android_automation).
5. Auto-Research Agent — browser_mcp search/download -> notes into Achiva (thoughts/exams).
6. Screen AI — screenshot + OCR -> ask AI about current screen.
7. Flashcard/Quiz Factory — Achiva notes -> spaced-repetition quiz.
8. Cloud Backup — Achiva JSON export to Google Drive via google_flow.
9. Multi-device sync — QR / export-import of Achiva data.
10. Fun: AI wallpaper generator, home-screen Achiva widget, quick-settings tile for agent.

## Debugging tips
- CI status: `curl -s -H "Authorization: token $TOKEN" https://api.github.com/repos/ajaykumarwppu-bot/antigem-merged/actions/runs?per_page=5`
- Releases: `.../releases?per_page=3`
- In-app agent's past wrong claims (do not trust blindly): "DOM storage disabled" (false), "port 8865" (actual 8869), eruda CSP noise is harmless.
- Achiva data must be changed via its own JS APIs (agent-bridge.js), never raw IndexedDB/JSON writes (cache divergence risk).

## Note for AI agents reading this file from the repo
- This repo is PUBLIC: never store tokens/secrets in it. The GitHub token lives in the agent sandbox at /home/z/my-project/.ghtoken; if that file is missing, ask the user to provide it in chat (they already have it, no need to regenerate).
- Clone: https://github.com/ajaykumarwppu-bot/antigem-merged (branch master).
- After reading this file, run: git log --oneline -10 && git status, to confirm local state.
