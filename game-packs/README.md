# Game packs

Place trusted game-pack `.zip` files directly in this folder, then restart the app/MCP service and BizHawk's Lua bridge. The distributed `fe1-jp-v1.zip` is included in Git; other locally installed ZIPs are ignored.

This folder is for runtime ZIPs. No source folder is required to run an installed pack.

Development sources live separately in `../game-pack-sources/`. Run `npm.cmd run game-pack -- build-all` to build those sources into ZIPs here. Installation and tests also build sources when available; a ZIP-only installation skips this step.

The app loads only ZIPs; there is no built-in FE fallback when its ZIP is removed.

Pack format, building, updating and examples: [ゲームパックの作成と導入](../docs/game-packs.ja.md).
