import { SharedClient } from '../src/shared-client.js';
import { t, setLanguage, normalizeLanguage, languages } from './i18n.js';
import { checkAuthentication, generateComment } from './claude.js';
import { frequencies } from './policy.js';
import { getGameAdapter } from './games/registry.js';
import { buildCommentaryInstructions } from './prompts.js';
import { getModel, models, normalizeModel } from './models.js';
import { defaultTone, getTone, localizedTone, reviewTone, tones } from './tones.js';

export class Watcher {
  constructor({ port = 8766, bridge, generate = generateComment, authenticate = checkAuthentication, clock = Date.now, includedOnlyConfirmed = false, model = 'sonnet', tone = defaultTone, language = 'ja', resolveGame = getGameAdapter } = {}) {
    this.bridge = bridge ?? new SharedClient(port);
    this.generate = generate; this.authenticate = authenticate; this.clock = clock;
    getModel(model); this.model = normalizeModel(model); this.resolveGame = resolveGame;
    getTone(tone); this.tone = tone; this.language = normalizeLanguage(language); setLanguage(this.language); this.lastPlay = -Infinity; this.playTopics = []; this.playSeq = 0;
    this.running = false; this.pending = []; this.calls = []; this.history = [];
    this.frequency = 'balanced'; this.lastCall = -Infinity; this.lastMove = -Infinity;
    this.includedOnlyConfirmed = includedOnlyConfirmed === true;
    this.message = t('idle');
    this.listeners = new Set(); this.revision = 0;
    this.resetAnalysis();
  }
  resetAnalysis() { this.phaseCursor = null; this.phaseMarks = []; this.dlg = null; this.dialogueReady = null; this.handledDialogue = new Map(); this.dialogueCursor = null; this.battleCursor = null; this.highlightReady = null; this.peakEnemies = 0; this.playQueue = []; this.window = []; this.changes = []; this.topics = []; this.reference = null; }
  toneData() { return localizedTone(this.tone, this.language); }
  setLanguage(language) {
    if (this.running) throw new Error(t('cannotChangeWhileRunning'));
    this.language = normalizeLanguage(language); setLanguage(this.language);
    if (!this.latest) this.message = t('idle');
    this.publish();
  }
  publicState() {
    const now = this.clock();
    return { appId: 'bizhawk-commentator', appVersion: '0.12.2', model: this.model, language: this.language, languages: Object.entries(languages).map(([key, value]) => ({ key, label: value.label })),
      tone: this.tone, tones: Object.keys(tones).map(key => { const data = localizedTone(key, this.language); return { key, label: data.label, summary: data.summary }; }),
      speech: { rate: tones[this.tone].rate, pitch: tones[this.tone].pitch, lang: this.language === 'en' ? 'en-US' : 'ja-JP' }, models: Object.entries(models).map(([key, value]) => ({ key, label: value.label })), includedOnlyConfirmed: this.includedOnlyConfirmed, running: this.running, busy: Boolean(this.active), message: this.message, connected: this.connected ?? false,
      plan: this.plan ?? null, frequency: this.frequency, callsThisHour: this.calls.filter(time => now - time < 3600000).length,
      hourlyLimit: frequencies[this.frequency].hourlyLimit, history: this.history.slice(-30),
      subtitle: this.subtitle && this.subtitle.expiresAt > now ? this.subtitle : null,
      game: this.adapter && this.latest?.game_state ? { title: this.language === 'en' ? this.adapter.titleEn ?? this.adapter.title : this.adapter.title, label: this.adapter.describe(this.latest.game_state, this.language) } : null };
  }
  // Peak enemy count is tracked per timeline so "few remain" is relative to the battle's start.
  trackPeak(state) {
    this.peakEnemies = Math.max(this.peakEnemies, this.adapter?.enemyCount?.(state) ?? 0);
  }
  // Stay quiet during battle animations and menus. A menu that never closes is ignored after 3 minutes,
  // so a misjudged hint cannot silence commentary for good.
  quiet() {
    const scene = this.adapter?.scene?.(this.latest?.game_state) ?? 'map';
    const now = this.clock();
    if (scene !== 'menu') this.menuSince = null;
    else this.menuSince ??= now;
    const talking = Boolean(this.dlg) && now - this.dlg.since < 180000; // let the conversation finish before chatting
    return scene === 'battle' || talking || scene === 'menu' && now - this.menuSince < 180000;
  }
  // Dialogue pages are collected while a speech window shows and explained once the text has stopped
  // changing (or after four pages). The game leaves a closed window's tiles in the nametable, so
  // "window gone" cannot be relied on; handled pages are ignored for ten minutes so stale tiles
  // neither re-trigger nor keep the commentator quiet.
  // Whose phase it is, inferred from what moves: enemies move only in their own phase, and a new turn starts
  // with the player's phase. The fight data always lists our unit first, whoever attacked, so this decides
  // who is described as the attacker. Unknown until something moves or a turn starts.
  // The turn banner the game shows is the reliable signal; the Lua bridge logs each appearance with its frame.
  trackPhaseBanners(snapshot) {
    const log = snapshot.phase_log;
    if (!Array.isArray(log)) return;
    const latest = Math.max(0, ...log.map(entry => entry.id));
    if (this.phaseCursor === null || latest < this.phaseCursor) this.phaseCursor = latest;
    for (const entry of log.filter(item => item.id > this.phaseCursor)) this.phaseMarks.push({ frame: entry.frame, phase: entry.phase, source: 'banner' });
    this.phaseCursor = latest;
    this.phaseMarks.sort((a, b) => a.frame - b.frame);
  }
  trackPhase(events) {
    for (const event of events) {
      const frame = event.after_frame ?? 0;
      const last = this.phaseMarks.at(-1)?.phase ?? null;
      let phase = null;
      if (event.type === 'turn_changed' || event.type === 'chapter_changed') phase = 'player';
      else if (event.type === 'position_changed' && event.side === 'enemy') phase = 'enemy';
      else if (event.type === 'position_changed' && event.side === 'player' && last === null) phase = 'player';
      if (phase && phase !== last) this.phaseMarks.push({ frame, phase });
    }
    this.phaseMarks.sort((a, b) => a.frame - b.frame);
    this.phaseMarks = this.phaseMarks.slice(-32);
  }
  phaseAt(frame) {
    let phase = null;
    for (const mark of this.phaseMarks) if (mark.frame <= frame) phase = mark.phase;
    return phase ?? this.phaseMarks.at(-1)?.phase ?? null;
  }
  // Fights the emulator logged since the last poll become narration events (a fight can be over inside one poll).
  trackBattles(snapshot, now) {
    const log = snapshot.battle_log;
    if (!Array.isArray(log)) return;
    const latest = Math.max(0, ...log.map(entry => entry.id));
    if (this.battleCursor === null || latest < this.battleCursor) this.battleCursor = latest;
    for (const logged of log.filter(item => item.id > this.battleCursor)) {
      const entry = this.adapter?.orientBattle?.(logged, snapshot.game_state, this.phaseAt(logged.frame ?? Infinity)) ?? logged;
      this.playQueue.push({ event: { ...entry, type: 'battle', event_id: 1_000_000 + entry.id }, receivedAt: now });
      const highlight = this.adapter?.battleHighlight?.(entry, snapshot.game_state);
      if (highlight) this.highlightReady = { ...highlight, receivedAt: now };
    }
    this.battleCursor = latest;
    this.playQueue = this.playQueue.slice(-64);
  }
  // A page, or the start of one still being typed, that was already explained.
  dialogueHandled(text) {
    for (const key of this.handledDialogue.keys()) if (key.startsWith(text)) return true;
    return false;
  }
  trackDialogue(snapshot, now) {
    for (const [page, at] of this.handledDialogue) if (now - at >= 600000) this.handledDialogue.delete(page);
    const log = snapshot.dialogue_log;
    // Pages the emulator saw since the last poll (a page can be shown for under a second); fall back to
    // the page visible right now for bridges that predate the log.
    let pages;
    if (Array.isArray(log)) {
      const latest = Math.max(0, ...log.map(entry => entry.id));
      if (this.dialogueCursor === null || latest < this.dialogueCursor) this.dialogueCursor = latest; // never replay old history
      pages = log.filter(entry => entry.id > this.dialogueCursor).map(entry => entry.text);
      this.dialogueCursor = latest;
    } else pages = [];
    const found = this.adapter?.dialogue?.(snapshot.game_state);
    if (!Array.isArray(log) && found) pages = [found.text];
    let changed = false;
    for (const text of pages) {
      if (this.dialogueHandled(text)) continue;
      const dlg = this.dlg ??= { pages: [], misses: 0, since: now, changedAt: now };
      const last = dlg.pages.at(-1);
      if (text === last) continue;
      dlg.changedAt = now; changed = true;
      // A page that only grows (or shrinks) is a redraw in progress, not a new page.
      if (last && (text.startsWith(last) || last.startsWith(text))) dlg.pages[dlg.pages.length - 1] = text.length >= last.length ? text : last;
      else dlg.pages.push(text);
    }
    const dlg = this.dlg;
    if (!dlg) return;
    const visible = found && !this.dialogueHandled(found.text);
    if (visible || changed) dlg.misses = 0;
    else dlg.misses++;
    if (dlg.pages.length >= 4 || now - dlg.changedAt >= 6000 || dlg.misses >= 2) this.finishDialogue(now);
  }
  finishDialogue(now) {
    const pages = this.dlg?.pages ?? [];
    this.dlg = null;
    for (const page of pages) this.handledDialogue.set(page, now);
    if (pages.length) this.dialogueReady = { pages, receivedAt: now };
  }
  settled() { return Boolean(this.adapter?.isSettled?.(this.latest?.game_state, { peakEnemies: this.peakEnemies })); }
  publish() { for (const listener of this.listeners) listener(this.publicState()); }
  async connect() { await this.bridge.start(); }
  async start(frequency = this.frequency, { includedOnlyConfirmed = false, model = this.model, tone = this.tone, language = this.language } = {}) {
    if (typeof frequency !== 'string' || !Object.hasOwn(frequencies, frequency)) throw new Error(t('badFrequency'));
    if (this.running) return;
    getModel(model); getTone(tone); if (language !== this.language) this.setLanguage(language);
    if (!includedOnlyConfirmed && !this.includedOnlyConfirmed) throw new Error(t('confirmUsage'));
    const auth = await this.authenticate();
    this.includedOnlyConfirmed = true;
    this.plan = auth.plan; this.frequency = frequency; this.model = normalizeModel(model); this.tone = tone;
    this.running = true; this.revision++; this.timeline = null; this.cursor = 0; this.pending = [];
    this.resetAnalysis();
    this.message = t('watching'); this.publish();
  }
  stop(message = t('stopped')) {
    this.running = false; this.revision++; this.pending = []; this.active?.controller.abort();
    this.subtitle = null; this.message = message; this.publish();
  }
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const status = await this.bridge.call('get_session_info');
      this.connected = Boolean(status.bridge_ready);
      if (!this.connected) {
        if (this.latest) { this.revision++; this.active?.controller.abort(); this.pending = []; this.timeline = null; }
        this.latest = null; if (this.running) this.message = t('waitingBizHawk'); this.publish(); return;
      }
      if (!this.running) { this.publish(); return; }
      const result = await this.bridge.call('get_game_state');
      this.accept(result.metadata);
      this.publish();
      void this.maybeGenerate();
      this.maybePlay();
    } catch {
      this.connected = false; this.latest = null;
      if (this.running) this.stop(t('disconnectedStop'));
      else { this.message = t('checkBizHawk'); this.publish(); }
    } finally { this.polling = false; }
  }
  accept(snapshot) {
    // In English the names and classes are converted once here; every later step then works with display names.
    if (this.language === 'en') snapshot = this.resolveGame(snapshot.game_state)?.localize?.(snapshot) ?? snapshot;
    this.latest = snapshot;
    const observed = snapshot.recent_observations;
    this.adapter = this.resolveGame(snapshot.game_state);
    if (snapshot.game_state && this.adapter?.selectedUnit) snapshot.game_state.selected_unit = this.adapter.selectedUnit(snapshot.game_state);
    if (!snapshot.game_state || !observed || !Array.isArray(observed.events)) {
      this.pending = []; this.timeline = null; this.resetAnalysis(); this.active?.controller.abort();
      this.message = t('waitingMap'); return;
    }
    if (!this.adapter) {
      this.pending = []; this.timeline = null; this.active?.controller.abort();
      this.resetAnalysis();
      this.message = t('unsupportedGame'); return;
    }
    if (this.timeline !== observed.timeline_id) {
      const hadTimeline = Boolean(this.timeline);
      this.revision++; this.active?.controller.abort(); this.pending = [];
      this.resetAnalysis();
      this.window.push({ state: structuredClone(snapshot.game_state), at: this.clock(), cursor: Math.max(0, ...observed.events.map(event => event.event_id)) });
      this.timeline = observed.timeline_id;
      this.cursor = Math.max(0, ...observed.events.map(event => event.event_id));
      if (hadTimeline) this.pending = (this.adapter.baselineEvents?.(observed) ?? []).map(event => ({ event, receivedAt: this.clock() }));
      this.playQueue = [...this.pending];
      this.trackPeak(snapshot.game_state);
      // Start collecting dialogue from here; pages seen before this point are history.
      this.phaseCursor = Array.isArray(snapshot.phase_log) ? Math.max(0, ...snapshot.phase_log.map(entry => entry.id)) : null;
      this.battleCursor = Array.isArray(snapshot.battle_log) ? Math.max(0, ...snapshot.battle_log.map(entry => entry.id)) : null;
      this.dialogueCursor = Array.isArray(snapshot.dialogue_log) ? Math.max(0, ...snapshot.dialogue_log.map(entry => entry.id)) : null;
      this.message = t('waitingChange'); return;
    }
    this.trackPeak(snapshot.game_state);
    const now = this.clock();
    const fresh = observed.events.filter(event => event.event_id > this.cursor);
    this.trackPhaseBanners(snapshot);
    this.trackPhase(fresh);
    this.trackDialogue(snapshot, now);
    this.trackBattles(snapshot, now);
    if (fresh.length) {
      this.cursor = Math.max(...fresh.map(event => event.event_id));
      this.pending.push(...fresh.map(event => ({ event, receivedAt: now })));
      this.changes.push(...fresh.map(event => ({ event, receivedAt: now })));
      this.playQueue.push(...fresh.map(event => ({ event, receivedAt: now }))); this.playQueue = this.playQueue.slice(-64);
      // A recruit also earns one spoken reaction (a fight highlight already waiting is kept).
      const joined = fresh.find(event => event.type === 'unit_joined');
      const recruit = joined && this.adapter.recruitHighlight?.(joined, snapshot.game_state);
      if (recruit && !this.highlightReady) this.highlightReady = { ...recruit, receivedAt: now };
    }
    this.changes = this.changes.filter(item => now - item.receivedAt <= 120000).slice(-256);
    this.window = this.window.filter(item => now - item.at <= 120000).slice(-59);
    this.window.push({ state: structuredClone(snapshot.game_state), at: now, cursor: this.cursor });
    this.topics = this.topics.filter(item => now - item.at <= 120000).slice(-64);
    this.pending = this.pending.filter(item => now - item.receivedAt <= 90000).slice(-128);
  }
  async maybeGenerate() {
    if (!this.running || this.active || !this.latest?.game_state || !this.adapter || this.quiet()) return;
    const now = this.clock(), limits = frequencies[this.frequency];
    this.calls = this.calls.filter(time => now - time < 3600000);
    const adapter = this.adapter, settled = this.settled();
    const reference = this.reference && now - this.reference.at <= 120000 ? this.reference : this.window[0];
    const rollingChanges = this.changes.filter(item => item.event.event_id > (reference?.cursor ?? 0));
    if (this.dialogueReady && now - this.dialogueReady.receivedAt > 120000) this.dialogueReady = null;
    const talk = this.dialogueReady && adapter.dialogueContext
      ? { event: { type: 'dialogue' }, priority: 6, category: 'dialogue', intensity: 'normal', receivedAt: this.dialogueReady.receivedAt,
          topicKey: `dialogue:${this.dialogueReady.pages.join('|').length}`, context: adapter.dialogueContext(this.dialogueReady.pages, this.latest.game_state), pages: this.dialogueReady.pages } : null;
    if (this.highlightReady && now - this.highlightReady.receivedAt > 20000) this.highlightReady = null;
    const highlight = !talk && this.highlightReady
      ? { event: { type: 'battle_highlight' }, priority: 7, category: 'highlight', intensity: 'high', speechIntensity: 'normal', receivedAt: this.highlightReady.receivedAt,
          topicKey: this.highlightReady.key, context: this.highlightReady.context } : null;
    const candidate = talk ?? highlight ?? adapter.selectCandidate(this.pending, this.latest.game_state, {
      before: reference?.state, changes: rollingChanges, recentTopics: this.topics, now });
    if (!candidate || now - this.lastCall < (talk ? Math.min(limits.cooldownMs, 10000) : limits.cooldownMs * (settled && !highlight ? 2 : 1)) || candidate.priority === 1 && now - this.lastMove < limits.moveMs) return;
    if (now - candidate.receivedAt < 2000) return; // group bursts of movement/combat updates
    if (this.calls.length >= limits.hourlyLimit) { this.stop(t('hourlyLimit')); return; }
    const intensity = settled || talk ? 'normal' : candidate.intensity ?? 'normal';
    const revision = this.revision, timeline = this.timeline;
    const snapshot = this.latest, state = snapshot.game_state;
    const sourceCursor = this.cursor;
    const expected = adapter.fingerprint(state, candidate.event);
    const selectedEvents = this.pending.filter(item => item.receivedAt <= now).map(item => item.event);
    if (talk) this.dialogueReady = null; else if (highlight) this.highlightReady = null; else this.pending = [];
    const controller = new AbortController();
    this.active = { controller }; this.calls.push(now); this.lastCall = now;
    if (candidate.topicKey) this.topics.push({ key: candidate.topicKey, at: now });
    if (candidate.category === 'movement') this.lastMove = now;
    this.message = t('thinking'); this.publish();
    try {
      const result = await this.generate({ trigger: candidate.event, context: candidate.context,
        intensity, settled, tone: this.toneData().label, language: this.language, selected_unit: state.selected_unit ?? null, phase: this.phaseAt(Infinity),
        recent_changes: (rollingChanges.length ? rollingChanges.map(item => item.event) : selectedEvents).slice(-32), game: adapter.summarize(state),
        already_said: this.history.slice(-4).map(item => item.text) }, { signal: controller.signal, model: this.model, instructions: buildCommentaryInstructions(adapter.instructions, { tone: this.toneData(), intensity, settled, language: this.language }) });
      if (!this.running || controller.signal.aborted || revision !== this.revision || timeline !== this.timeline) return;
      if (this.clock() - now > 30000 || !this.latest?.game_state || !highlight && expected !== adapter.fingerprint(this.latest.game_state, candidate.event)) {
        this.message = t('staleReply'); return;
      }
      if (result.speak && result.comment && (adapter.reviewComment?.(result.comment, candidate, state) ?? true) && reviewTone(result.comment, this.tone, this.language) && !this.history.slice(-3).some(item => item.text === result.comment)) {
        const item = { id: `${now}-${this.calls.length}`, text: result.comment, at: this.clock(), model: this.model, kind: 'comment', intensity: candidate.speechIntensity ?? intensity, tone: this.tone, resolvedModels: result.resolvedModels ?? [] };
        this.history.push(item); this.history = this.history.slice(-100);
        this.reference = { state: structuredClone(state), cursor: sourceCursor, at: now };
        this.subtitle = { ...item, expiresAt: this.clock() + Math.max(10000, Math.min(20000, item.text.length * 220)) };
      }
      this.message = t('quietWhileIdle');
    } catch (error) {
      if (!controller.signal.aborted && this.running) this.stop(error.message);
    } finally { this.active = null; this.publish(); }
  }
  // Fixed-wording narration from the latest differences. No model call and no hourly quota use.
  maybePlay() {
    if (!this.running || this.active || !this.latest?.game_state || !this.adapter?.playByPlay || this.quiet()) return;
    const now = this.clock(), limits = frequencies[this.frequency];
    this.playQueue = this.playQueue.filter(item => now - item.receivedAt <= 30000);
    const settled = this.settled();
    if (!this.playQueue.length || now - this.lastPlay < limits.playMs * (settled ? 2 : 1) || now - this.lastCall < 6000) return;
    const events = this.playQueue.map(item => item.event);
    this.playQueue = [];
    this.playTopics = this.playTopics.filter(item => now - item.at < 30000);
    const recent = this.history.slice(-3).map(item => item.text);
    const fresh = this.adapter.playByPlay(events, this.latest.game_state, { tone: this.toneData(), settled })
      .filter(candidate => !this.playTopics.some(item => item.key === candidate.topicKey) && !recent.includes(candidate.text));
    const line = fresh[0];
    if (!line) return;
    // Speech is infrequent, so a second notable change in the same window rides along.
    const extra = fresh.find(candidate => candidate !== line && candidate.priority >= 3 && candidate.topicKey !== line.topicKey);
    this.lastPlay = now;
    for (const used of extra ? [line, extra] : [line]) this.playTopics.push({ key: used.topicKey, at: now });
    const item = { id: `${now}-p${++this.playSeq}`, text: extra ? line.text + this.toneData().joiner + extra.text : line.text, at: now, model: null, kind: 'play', intensity: 'normal', tone: this.tone, resolvedModels: [] };
    this.history.push(item); this.history = this.history.slice(-100);
    this.subtitle = { ...item, expiresAt: now + Math.max(5000, Math.min(16000, item.text.length * 250)) };
    this.publish();
  }
  async close() { this.stop(); this.bridge.close(); }
}
