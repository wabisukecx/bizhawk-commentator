# Game pack development sources

This folder is for editing, testing and building game packs. It is not needed to run an installed ZIP.

- `fe1-jp-v1/`: FE1 memory/text readers, names, narration, runtime interpretation and development tools.
- Build all source packs: `npm.cmd run game-pack -- build-all`.
- Output: `game-packs/<pack-id>.zip`.

The runtime does not load this folder. ZIP-only distributions can omit it; installation skips source builds when it is absent. Development tests require the sources.
