// Test the distributed ZIP, without requiring the private development sources.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareGamePacks } from '../../src/game-packs.js';

const pack = (await prepareGamePacks()).find(pack => pack.id === 'fe1-jp-v1');
if (!pack) throw new Error('Tests require the distributed game-packs/fe1-jp-v1.zip');
const moduleAt = name => import(pathToFileURL(path.join(pack.directory, 'app', name)).href);

export const { fe1, distance, selectCandidate, fingerprint, compactState, gameInstructions, reviewComment,
  scene, dialogue, mentionedUnits, mergePages, dialogueContext, selectedUnit, recruitHighlight,
  orientBattle, battleHighlight, isSettled } = await moduleAt('fe1.js');
export const { playByPlay, analyzeBattle } = await moduleAt('fe1-play.js');
export const { playerNames, enemyNames, unitName, battleName } = await moduleAt('fe1-names.js');
export const { OFFICIAL, CLASSES, romanize, englishName, englishClass, localizeSnapshot } = await moduleAt('fe1-i18n.js');
export const { tones, english, localizedTone } = await moduleAt('tone.js');
export const luaPath = name => path.join(pack.directory, 'lua', name).replaceAll('\\', '/');
