# FE1 game pack

Game-specific code and data for Fire Emblem: Shadow Dragon and the Blade of Light (Japanese version).

- `app/`: commentary adapter, runtime interpretation, names, translations and narration phrases.
- `lua/`: memory reader, text decoding, map differences and short-lived observation logs.
- `dev/`: FE1-only recording and replay tools, excluded from the runtime ZIP.

Build from the project root: `npm.cmd run game-pack -- build-all`.

The host loads only the generated ZIP. Removing `game-packs/fe1-jp-v1.zip` removes this game's automatic commentary after restart; there is no built-in fallback.

No game ROM image is included. Memory layout reference: StanHash/fe1, commit `9b2fd3a03347818a60afaf913f94c36de0d953ba`, including `include/sram.asm`, `include/structs/unit.asm` and `code/home/unit.asm`.

For read-only recording, launch the emulator with `scripts/start-bizhawk.ps1 -LuaScript game-pack-sources/fe1-jp-v1/dev/bridge-with-probe.lua` and the usual emulator/ROM arguments. Replay a recorded session with `node game-pack-sources/fe1-jp-v1/dev/verify-session.mjs`. Recordings stay under the project's ignored `captures/scene-probe/` folder.
