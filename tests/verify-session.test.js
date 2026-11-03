import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze } from '../scripts/dev/verify-session.mjs';

const SRAM_START = 0x6A90;
const sramSize = 3584;

function sramWith(records, { chapter = 3, turn = 2 } = {}) {
  const sram = Buffer.alloc(sramSize);
  const put = (address, value) => { sram[address - SRAM_START] = value; };
  put(0x7674, chapter); put(0x7675, turn); put(0x7676, 20); put(0x7677, 31);
  records.forEach((record, slot) => {
    const base = SRAM_START + slot * 27;
    put(base, record.pid); put(base + 1, record.jid ?? 1); put(base + 2, record.level ?? 1);
    put(base + 3, record.hp ?? 18); put(base + 4, record.maxHp ?? 18);
    put(base + 0x10, record.y ?? 6); put(base + 0x11, record.x ?? 20 + slot); put(base + 0x12, record.flag ?? 0);
  });
  return sram;
}

function writeSession(pairs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-session-'));
  pairs.forEach(([seq, sram, frame = seq * 60]) => {
    fs.writeFileSync(path.join(dir, `snap_${String(seq).padStart(5, '0')}_${String(frame).padStart(7, '0')}.bin`), Buffer.alloc(4096));
    fs.writeFileSync(path.join(dir, `sram_${String(seq).padStart(5, '0')}_0000000.bin`), sram);
  });
  return dir;
}

test('a session without SRAM dumps is rejected with instructions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-session-'));
  fs.writeFileSync(path.join(dir, 'snap_00001_0000000.bin'), Buffer.alloc(4096));
  const report = analyze(dir);
  assert.equal(report.findings[0].level, 'error');
  assert.match(report.findings[0].message, /sram_\*\.bin/);
});

test('coverage lists decoded chapters and the raw player defeat transition with before/after evidence', t => {
  const unit = { pid: 2, jid: 3 }, lord = { pid: 1, jid: 21 };
  const dir = writeSession([
    [1, sramWith([unit, lord], { chapter: 25, turn: 2 })],
    [6, sramWith([{ ...unit, hp: 0, flag: 0xFF }, lord], { chapter: 25, turn: 2 })],
  ]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const report = analyze(dir);
  assert.equal(report.decoded, 2, 'a synthetic final chapter is readable; this is not real-game coverage');
  assert.deepEqual(report.coverage.decodedChapters, [25]);
  assert.equal(report.coverage.playerZeroHpSamples, 1);
  assert.deepEqual(report.coverage.playerDefeatTransitions, [{ from: 1, at: 6, from_frame: 60, frame: 360,
    chapter: 25, turn: 2, key: 'player:0', pid: 2, hp_from: 18, hp_to: 0, flag_from: 0, flag_to: 255 }]);
});

test('coverage does not infer player defeat across chapter changes, rewinds, invalid maps or unverified flags', t => {
  const unit = { pid: 2, jid: 3 }, dead = { ...unit, hp: 0, flag: 0xFF };
  const sample = (record, chapter = 2, turn = 3) => sramWith([record, { pid: 1, jid: 21 }], { chapter, turn });
  const cases = [
    [[1, sample(unit)], [6, sample(dead, 3)]],
    [[1, sample(unit), 1000], [6, sample(dead), 500]],
    [[1, sample(unit)], [6, sample(dead, 2, 1)]],
    [[1, sample(unit)], [6, sample(unit, 0)], [11, sample(dead)]],
    [[1, sample(unit)], [6, sample({ ...dead, flag: 0xF0 })]],
    [[1, sample(unit)], [6, sample({ ...dead, pid: 3 })]],
    [[1, sample({ ...unit, flag: 0xFF })], [6, sample(dead)]],
    [[1, sample(dead)], [6, sample(dead)]],
  ];
  for (const pairs of cases) {
    const dir = writeSession(pairs);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.deepEqual(analyze(dir).coverage.playerDefeatTransitions, [], JSON.stringify(pairs.map(([seq, , frame]) => ({ seq, frame }))));
  }
});

test('missing snapshot pairs and truncated dumps are errors, not successful coverage', t => {
  const unit = { pid: 2, jid: 3 }, lord = { pid: 1, jid: 21 };
  for (const damage of ['missing', 'snapshot', 'sram']) {
    const dir = writeSession([
      [1, sramWith([unit, lord])],
      [6, sramWith([unit, lord])],
      [11, sramWith([{ ...unit, hp: 0, flag: 0xFF }, lord])],
    ]);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const snapshot = path.join(dir, fs.readdirSync(dir).find(name => name.startsWith('snap_00006_')));
    if (damage === 'missing') fs.unlinkSync(snapshot);
    else if (damage === 'snapshot') fs.writeFileSync(snapshot, Buffer.alloc(10));
    else fs.writeFileSync(path.join(dir, 'sram_00006_0000000.bin'), Buffer.alloc(10));
    const report = analyze(dir);
    assert.equal(report.decoded, 2);
    assert.deepEqual(report.coverage.playerDefeatTransitions, [], 'do not infer defeat across a damaged capture');
    assert.equal(report.findings[0].level, 'error');
    assert.match(report.findings[0].message, damage === 'missing' ? /matching.*missing/ : /incomplete capture/);
  }
});

test('the verification CLI exports JSON including coverage and rejects a missing directory clearly', t => {
  const dir = writeSession([[1, sramWith([{ pid: 1, jid: 21 }])]]);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/dev/verify-session.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, dir, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).coverage.decodedChapters, [3]);
  const absent = spawnSync(process.execPath, [script, path.join(dir, 'missing'), '--json'], { encoding: 'utf8' });
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /ENOENT/);
  assert.equal(absent.stdout, '');
});

test('chapters, turns and roster changes (joined, excluded, replaced, hp zero) are reported from raw records', () => {
  const lord = { pid: 1, jid: 21 }, caeda = { pid: 2, jid: 3, hp: 16, maxHp: 16 }, jagen = { pid: 3, jid: 4, level: 2, hp: 20, maxHp: 20 };
  const dir = writeSession([
    [1, sramWith([lord, caeda], { chapter: 3, turn: 2 })],
    [6, sramWith([lord, { ...caeda, flag: 0xFF }, jagen], { chapter: 3, turn: 3 })],
    [11, sramWith([{ ...lord, hp: 0 }, { ...caeda, flag: 0 }], { chapter: 4, turn: 1 })],
  ]);
  const report = analyze(dir);
  assert.equal(report.samples, 3);
  assert.equal(report.decoded, 3);
  assert.deepEqual(report.chapters.map(c => c.chapter), [3, 4]);
  assert.deepEqual(report.chapters[0].map, { width: 32, height: 21 });
  const events = report.rosterEvents.map(e => `${e.at}:${e.event}:${e.key}`);
  assert.ok(events.includes('6:excluded:player:1'), 'a record flagged FF is reported as excluded');
  assert.ok(events.includes('6:record_added:player:2'), 'a new record appears');
  assert.ok(events.includes('11:included:player:1'), 'the flag clearing is reported');
  assert.ok(events.includes('11:hp_zero:player:0'));
  assert.ok(events.includes('11:record_removed:player:2'));
  assert.equal(report.findings.filter(f => f.level === 'error').length, 0);
  assert.equal(report.names['1'], 'マルス');
});

test('duplicate character IDs, unknown names and a turn that goes backwards are flagged', () => {
  const dir = writeSession([
    [1, sramWith([{ pid: 1, jid: 21 }, { pid: 1, jid: 21 }, { pid: 99, jid: 4 }], { chapter: 2, turn: 5 })],
    [6, sramWith([{ pid: 1, jid: 21 }], { chapter: 2, turn: 3 })],
  ]);
  const report = analyze(dir);
  const messages = report.findings.map(f => `${f.level}: ${f.message}`).join('\n');
  assert.match(messages, /error: .*duplicate player character IDs 1/);
  assert.match(messages, /warn: .*character ID 99 has no name/);
  assert.match(messages, /warn: .*turn went back from 5 to 3/);
});

test('excluded records are labelled defeated (0 HP) or left the side (HP kept); F0 stays unknown; the acted flag 0/1 is reported', t => {
  const grunt = { pid: 133, jid: 8 }, boss = { pid: 173, jid: 8, hp: 21, maxHp: 21 }, priest = { pid: 9, jid: 19 };
  const dir = writeSession([
    [1, sramWith([priest], { chapter: 2, turn: 3 })],
    [6, sramWith([{ ...priest, flag: 1 }], { chapter: 2, turn: 3 })],
    [11, sramWith([{ ...priest, flag: 0 }], { chapter: 2, turn: 4 })],
  ]);
  const enemyDir = writeSession([[1, withEnemies([grunt, boss], [0, 0])], [6, withEnemies([{ ...grunt, hp: 0 }, boss], [0xFF, 0xFF])]]);
  const events = analyze(dir).rosterEvents.map(e => `${e.at}:${e.event}`);
  assert.deepEqual(events, ['6:acted', '11:ready']);
  const report = analyze(enemyDir);
  const excluded = report.rosterEvents.filter(e => e.event === 'excluded').map(e => `${e.pid}:${e.meaning}`);
  assert.deepEqual(excluded, ['133:defeated', '173:left_side_with_hp']);
  assert.deepEqual(report.excludedAtEnd.map(e => e.meaning), ['defeated', 'left_side_with_hp']);
  const unknownDir = writeSession([[1, withEnemies([grunt], [0])], [6, withEnemies([{ ...grunt, hp: 0 }], [0xF0])]]);
  t.after(() => fs.rmSync(unknownDir, { recursive: true, force: true }));
  const unknown = analyze(unknownDir);
  assert.equal(unknown.rosterEvents.find(e => e.event === 'excluded').meaning, 'unknown_exclusion');
  assert.equal(unknown.excludedAtEnd[0].meaning, 'unknown_exclusion');
});

function withEnemies(records, flags) {
  const sram = sramWith([{ pid: 1, jid: 21 }], { chapter: 2, turn: 3 });
  records.forEach((record, slot) => {
    const base = 0x7078 + slot * 27 - SRAM_START;
    sram[base] = record.pid; sram[base + 1] = record.jid; sram[base + 2] = 1;
    sram[base + 3] = record.hp ?? 18; sram[base + 4] = record.maxHp ?? 18;
    sram[base + 0x10] = 5; sram[base + 0x11] = 10 + slot; sram[base + 0x12] = flags[slot];
  });
  return sram;
}

test('a recruit is linked: the enemy record that leaves matches the player record that appears', () => {
  const enemyRecord = (flag) => withEnemies([{ pid: 173, jid: 8, hp: 21, maxHp: 21 }], [flag]);
  const before = enemyRecord(0);
  const after = enemyRecord(0xFF);
  // The player record of the same unit (ID 15) appears in slot 1, with the enemy record's class, level, HP and position.
  const put = (sram, address, value) => { sram[address - SRAM_START] = value; };
  const slot = SRAM_START + 27;
  [[0, 15], [1, 8], [2, 1], [3, 21], [4, 21], [0x10, 5], [0x11, 10], [0x12, 0]].forEach(([offset, value]) => put(after, slot + offset, value));
  const report = analyze(writeSession([[1, before], [6, after]]));
  const recruited = report.rosterEvents.find(event => event.event === 'recruited');
  assert.deepEqual({ player: recruited.player_pid, enemy: recruited.enemy_pid }, { player: 15, enemy: 173 });
});
