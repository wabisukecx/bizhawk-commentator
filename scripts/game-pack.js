import path from 'node:path';
import { buildGamePack, exportFe1Pack, prepareGamePacks } from '../src/game-packs.js';

const [command, source, output] = process.argv.slice(2);
try {
  if (command === 'build' && source) {
    console.log(await buildGamePack(path.resolve(source), path.resolve(output ?? 'runtime/game-packs/game.zip')));
  } else if (command === 'export-fe1') {
    console.log(await exportFe1Pack(path.resolve(source ?? 'runtime/game-packs/fe1-jp-v1.zip')));
  } else if (command === 'list' && !source) {
    const packs = await prepareGamePacks();
    console.log(JSON.stringify(packs.map(({ id, version, title, rom, observation }) => ({ id, version, title, rom, observation })), null, 2));
  } else throw new Error('Usage: node scripts/game-pack.js build <folder> [output.zip] | export-fe1 [output.zip] | list');
} catch (error) { console.error(error.message); process.exitCode = 1; }
