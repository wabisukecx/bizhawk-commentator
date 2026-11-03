# Third-party material

## mcp-bizhawk

- Author: dmang-dev
- Repository: https://github.com/dmang-dev/mcp-bizhawk
- Reference commit: bb37b608afdad7093e7609ab05c2ad0eb86d3dff
- License: MIT; reproduced in `LICENSE.upstream`.
- Copied file: `lua/json.lua`, unchanged.
- The READY / RESULT polling arrangement informed this implementation. The transport here uses byte-length frames directly, and the Lua handler exposes only observation methods.

## Reference material

The factual FE1 memory layout was researched using StanHash/fe1 at commit `9b2fd3a03347818a60afaf913f94c36de0d953ba` (https://github.com/StanHash/fe1), particularly `include/sram.asm`, `include/structs/unit.asm`, `code/home/unit.asm` and `code/home/map.asm`. The RAM reader is independently written; no assembly source or ROM image from that repository is bundled.

## Runtime dependency

`@modelcontextprotocol/sdk` is the official MCP TypeScript SDK (MIT). Its notices are included in the installed package. The exact installed dependency tree is recorded in `package-lock.json`.

`fflate` (MIT) reads and creates game-pack ZIP archives. Its license and notices are included in the installed package.

## Development dependency

`fengari` (MIT) executes the Lua script against simulated emulator APIs during automated tests. It is not used by the running MCP server.

No emulator binaries, firmware, or commercial game ROM images are included in the source package. BizHawk and game ROMs must be supplied separately.
