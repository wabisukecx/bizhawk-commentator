# Changelog

## Unreleased

- Strengthen Japanese/English phrase tests to detect missing or extra placeholders.
- Add coverage summaries and JSON output for recorded-session validation.
- Prepare public documentation and exclude local analysis material from distribution.

## 0.13.0

- Make FE1 a standalone source/ZIP pack. Move its memory and text readers, names, English mappings, narration phrases, runtime interpretation and development tools under `game-pack-sources/fe1-jp-v1/`; keep `game-packs/` for runtime ZIPs. ZIP-only installations do not require the source folder.
- Remove built-in game registration and all FE-specific phase, conversation, battle-log and recruitment handling from the host watcher and Lua bridge. No ZIP means no automatic FE interpretation.
- Introduce pack API 2 with pack-owned observation engines/logs, runtime hooks, snapshot normalization and narration phrases; provide a public `#commentator/host` API.
- Replace the FE-specific export command with generic `build`/`build-all`. Source packs build during installation and tests, but normal startup reads only ZIPs.
- Update the shared service/Lua interface to 0.4.0. API 1 packs require migration and rebuilding.

## 0.12.3

- Separate fixed play-by-play from model analysis: Claude comments on the recent flow of losses and positioning, and stays silent when it can only repeat results or add generic praise.
- Supply before/after summaries and recently delivered narration to the model, and offer local narration before starting a generation. Keep the selected speaking style.
- Add conservative Japanese/English filters for result-only reactions and generic praise; dialogue explanations retain their own role.

## 0.12.2

- Resolve enemy names in battle records as well as map units. Local narration and Claude highlights use the PID name tables even with older Lua logs or after the defeated enemy leaves the roster, in Japanese and English. Unknown IDs still fall back to their class.

## 0.12.1

- Reuse protocol-compatible 0.2.2 shared services after updating, rather than refusing to start the app while MCP clients keep an older service alive. Prepare game-pack registrations in the connecting client as well.

## 0.12.0

- Load game-specific Lua readers, JavaScript commentary adapters, names and optional observation engines from ZIP packs in `game-packs/`, without editing the built-in registries.
- Add a versioned pack manifest, exact ROM matching, per-pack memory domains, bounded ZIP extraction and conflict checks. Pack JavaScript is trusted local code.
- Export the existing FE1 implementation as one ZIP; include a synthetic HP/stage example with its own observation schema.
- Add build/export/list commands and pack authoring documentation. Restart the app/MCP service and Lua bridge after changing packs.
- Update the shared service and Lua bridge interface to 0.3.0.

## 0.11.0

- Japanese and English commentary with four speaking styles.
- Local narration for battles, healing, level-ups, enemy approaches and recruitment in the supported FE1 ROM.
- Claude commentary for selected game changes and dialogue.
- Browser subtitles, speech synthesis and a subtitle overlay.
- Read-only MCP tools for session information, screenshots and recent observations.
- Shared local connection for the app and multiple MCP clients.
