import path from 'node:path';
import { buildGamePack, buildSourcePacks, prepareGamePacks } from '../src/game-packs.js';

const [command, source, output] = process.argv.slice(2);
try {
  if (command === 'build' && source) {
    console.log(await buildGamePack(path.resolve(source), path.resolve(output ?? 'runtime/game-packs/game.zip')));
  } else if (command === 'build-all' && !source) {
    for (const filename of await buildSourcePacks()) console.log(filename);
  } else if (command === 'list' && !source) {
    const packs = await prepareGamePacks();
    console.log(JSON.stringify(packs.map(({ id, version, title, rom, observation }) => ({ id, version, title, rom, observation })), null, 2));
  } else throw new Error('Usage: node scripts/game-pack.js build <folder> [output.zip] | build-all | list');
} catch (error) { console.error(error.message); process.exitCode = 1; }
