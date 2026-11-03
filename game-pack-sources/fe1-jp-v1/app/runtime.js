// FE1's interpretation of phases, conversations, battle records and recruitment.
// The host only feeds snapshots/events and consumes generic candidates and narration events.
export class Fe1Runtime {
  constructor(adapter) {
    this.adapter = adapter;
    this.phaseCursor = null; this.phaseMarks = []; this.dialogueCursor = null; this.battleCursor = null;
    this.dlg = null; this.dialogueReady = null; this.handledDialogue = new Map(); this.highlightReady = null;
    this.peakEnemies = 0;
  }
  phaseAt(frame) {
    let phase = null;
    for (const mark of this.phaseMarks) if (mark.frame <= frame) phase = mark.phase;
    return phase ?? this.phaseMarks.at(-1)?.phase ?? null;
  }
  rows(snapshot, name) {
    const log = snapshot.game_logs?.[name] ?? snapshot[`${name}_log`];
    // Older bridges encode an empty Lua list as {}.
    return Array.isArray(log) ? log : log && typeof log === 'object' && !Object.keys(log).length ? [] : null;
  }
  observe(snapshot, events, { now, baseline }) {
    const state = snapshot.game_state;
    this.peakEnemies = Math.max(this.peakEnemies, state.units.filter(unit => unit.side === 'enemy' && unit.hp > 0).length);
    const phaseLog = this.rows(snapshot, 'phase'), battleLog = this.rows(snapshot, 'battle'), dialogueLog = this.rows(snapshot, 'dialogue');
    if (baseline) {
      this.phaseCursor = phaseLog ? Math.max(0, ...phaseLog.map(entry => entry.id)) : null;
      this.battleCursor = battleLog ? Math.max(0, ...battleLog.map(entry => entry.id)) : null;
      this.dialogueCursor = dialogueLog ? Math.max(0, ...dialogueLog.map(entry => entry.id)) : null;
      return [];
    }
    if (phaseLog) {
      const latest = Math.max(0, ...phaseLog.map(entry => entry.id));
      if (this.phaseCursor === null || latest < this.phaseCursor) this.phaseCursor = latest;
      for (const entry of phaseLog.filter(item => item.id > this.phaseCursor)) this.phaseMarks.push({ frame: entry.frame, phase: entry.phase, source: 'banner' });
      this.phaseCursor = latest;
      this.phaseMarks.sort((a, b) => a.frame - b.frame);
    }
    for (const event of events) {
      const frame = event.after_frame ?? 0, last = this.phaseMarks.at(-1)?.phase ?? null;
      let phase = null;
      if (event.type === 'turn_changed' || event.type === 'chapter_changed') phase = 'player';
      else if (event.type === 'position_changed' && event.side === 'enemy') phase = 'enemy';
      else if (event.type === 'position_changed' && event.side === 'player' && last === null) phase = 'player';
      if (phase && phase !== last) this.phaseMarks.push({ frame, phase });
    }
    this.phaseMarks.sort((a, b) => a.frame - b.frame); this.phaseMarks = this.phaseMarks.slice(-32);
    this.trackDialogue(snapshot, dialogueLog, now);
    const derived = [];
    if (battleLog) {
      const latest = Math.max(0, ...battleLog.map(entry => entry.id));
      if (this.battleCursor === null || latest < this.battleCursor) this.battleCursor = latest;
      for (const logged of battleLog.filter(item => item.id > this.battleCursor)) {
        const entry = this.adapter.orientBattle(logged, state, this.phaseAt(logged.frame ?? Infinity));
        derived.push({ ...entry, type: 'battle', event_id: 1_000_000 + entry.id });
        const highlight = this.adapter.battleHighlight(entry, state);
        if (highlight) this.highlightReady = { ...highlight, receivedAt: now };
      }
      this.battleCursor = latest;
    }
    const joined = events.find(event => event.type === 'unit_joined');
    const recruit = joined && this.adapter.recruitHighlight(joined, state);
    if (recruit && !this.highlightReady) this.highlightReady = { ...recruit, receivedAt: now };
    return derived;
  }
  dialogueHandled(text) {
    for (const key of this.handledDialogue.keys()) if (key.startsWith(text)) return true;
    return false;
  }
  trackDialogue(snapshot, log, now) {
    for (const [page, at] of this.handledDialogue) if (now - at >= 600000) this.handledDialogue.delete(page);
    let pages = [];
    if (log) {
      const latest = Math.max(0, ...log.map(entry => entry.id));
      if (this.dialogueCursor === null || latest < this.dialogueCursor) this.dialogueCursor = latest;
      pages = log.filter(entry => entry.id > this.dialogueCursor).map(entry => entry.text); this.dialogueCursor = latest;
    }
    const found = this.adapter.dialogue(snapshot.game_state);
    if (!log && found) pages = [found.text];
    let changed = false;
    for (const text of pages) {
      if (this.dialogueHandled(text)) continue;
      const dlg = this.dlg ??= { pages: [], misses: 0, since: now, changedAt: now }, last = dlg.pages.at(-1);
      if (text === last) continue;
      dlg.changedAt = now; changed = true;
      if (last && (text.startsWith(last) || last.startsWith(text))) dlg.pages[dlg.pages.length - 1] = text.length >= last.length ? text : last;
      else dlg.pages.push(text);
    }
    const dlg = this.dlg;
    if (!dlg) return;
    if (found && !this.dialogueHandled(found.text) || changed) dlg.misses = 0; else dlg.misses++;
    if (dlg.pages.length >= 4 || now - dlg.changedAt >= 6000 || dlg.misses >= 2) {
      this.dlg = null;
      for (const page of dlg.pages) this.handledDialogue.set(page, now);
      if (dlg.pages.length) this.dialogueReady = { pages: dlg.pages, receivedAt: now };
    }
  }
  quiet(state, now) {
    const scene = this.adapter.scene(state);
    if (scene !== 'menu') this.menuSince = null; else this.menuSince ??= now;
    return scene === 'battle' || Boolean(this.dlg) && now - this.dlg.since < 180000 || scene === 'menu' && now - this.menuSince < 180000;
  }
  settled(state) { return this.adapter.isSettled(state, { peakEnemies: this.peakEnemies }); }
  candidate(state, { now }) {
    if (this.dialogueReady && now - this.dialogueReady.receivedAt > 120000) this.dialogueReady = null;
    if (this.highlightReady && now - this.highlightReady.receivedAt > 20000) this.highlightReady = null;
    if (this.dialogueReady) return { event: { type: 'dialogue' }, priority: 6, category: 'dialogue', intensity: 'normal',
      receivedAt: this.dialogueReady.receivedAt, topicKey: `dialogue:${this.dialogueReady.pages.join('|').length}`,
      context: this.adapter.dialogueContext(this.dialogueReady.pages, state), allowRestatement: true, cooldownMs: 10000, urgent: true };
    if (this.highlightReady) return { event: { type: 'battle_highlight' }, priority: 7, category: 'highlight', intensity: 'high', speechIntensity: 'normal',
      receivedAt: this.highlightReady.receivedAt, topicKey: this.highlightReady.key, context: this.highlightReady.context, skipFingerprint: true, urgent: true };
    return null;
  }
  consume(candidate) {
    if (candidate.category === 'dialogue') this.dialogueReady = null;
    else this.highlightReady = null;
  }
  context(state) { return { phase: this.phaseAt(Infinity), selected_unit: state.selected_unit ?? null }; }
}
