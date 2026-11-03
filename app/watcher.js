import { SharedClient } from '../src/shared-client.js';
import { t, setLanguage, normalizeLanguage, languages } from './i18n.js';
import { checkAuthentication, generateComment } from './claude.js';
import { frequencies } from './policy.js';
import { getGameAdapter } from './games/registry.js';
import { buildCommentaryInstructions, addsAnalysis } from './prompts.js';
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
  resetAnalysis() { this.runtime = this.adapter?.createRuntime?.() ?? null; this.playQueue = []; this.window = []; this.changes = []; this.topics = []; this.reference = null; }
  toneData() { return this.adapter?.localizeTone?.(this.tone, this.language) ?? localizedTone(this.tone, this.language); }
  setLanguage(language) {
    if (this.running) throw new Error(t('cannotChangeWhileRunning'));
    this.language = normalizeLanguage(language); setLanguage(this.language);
    if (!this.latest) this.message = t('idle');
    this.publish();
  }
  publicState() {
    const now = this.clock();
    return { appId: 'bizhawk-commentator', appVersion: '0.13.0', model: this.model, language: this.language, languages: Object.entries(languages).map(([key, value]) => ({ key, label: value.label })),
      tone: this.tone, tones: Object.keys(tones).map(key => { const data = localizedTone(key, this.language); return { key, label: data.label, summary: data.summary }; }),
      speech: { rate: tones[this.tone].rate, pitch: tones[this.tone].pitch, lang: this.language === 'en' ? 'en-US' : 'ja-JP' }, models: Object.entries(models).map(([key, value]) => ({ key, label: value.label })), includedOnlyConfirmed: this.includedOnlyConfirmed, running: this.running, busy: Boolean(this.active), message: this.message, connected: this.connected ?? false,
      plan: this.plan ?? null, frequency: this.frequency, callsThisHour: this.calls.filter(time => now - time < 3600000).length,
      hourlyLimit: frequencies[this.frequency].hourlyLimit, history: this.history.slice(-30),
      subtitle: this.subtitle && this.subtitle.expiresAt > now ? this.subtitle : null,
      game: this.adapter && this.latest?.game_state ? { title: this.language === 'en' ? this.adapter.titleEn ?? this.adapter.title : this.adapter.title, label: this.adapter.describe(this.latest.game_state, this.language) } : null };
  }
  quiet() { return Boolean(this.runtime?.quiet?.(this.latest?.game_state, this.clock())); }
  settled() { return Boolean(this.runtime?.settled?.(this.latest?.game_state)); }
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
      this.maybePlay();
      void this.maybeGenerate();
    } catch {
      this.connected = false; this.latest = null;
      if (this.running) this.stop(t('disconnectedStop'));
      else { this.message = t('checkBizHawk'); this.publish(); }
    } finally { this.polling = false; }
  }
  accept(snapshot) {
    const resolved = this.resolveGame(snapshot.game_state);
    snapshot = resolved?.normalize?.(snapshot, { language: this.language }) ?? snapshot;
    this.latest = snapshot;
    const observed = snapshot.recent_observations;
    if (this.adapter?.id !== resolved?.id) this.timeline = null;
    this.adapter = resolved;
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
      this.runtime?.observe?.(snapshot, [], { now: this.clock(), baseline: true });
      this.message = t('waitingChange'); return;
    }
    const now = this.clock();
    const fresh = observed.events.filter(event => event.event_id > this.cursor);
    const derived = this.runtime?.observe?.(snapshot, fresh, { now, baseline: false }) ?? [];
    this.playQueue.push(...derived.map(event => ({ event, receivedAt: now })));
    this.playQueue = this.playQueue.slice(-64);
    if (fresh.length) {
      this.cursor = Math.max(...fresh.map(event => event.event_id));
      this.pending.push(...fresh.map(event => ({ event, receivedAt: now })));
      this.changes.push(...fresh.map(event => ({ event, receivedAt: now })));
      this.playQueue.push(...fresh.map(event => ({ event, receivedAt: now }))); this.playQueue = this.playQueue.slice(-64);

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
    const special = this.runtime?.candidate?.(this.latest.game_state, { now }) ?? null;
    const candidate = special ?? adapter.selectCandidate(this.pending, this.latest.game_state, {
      before: reference?.state, changes: rollingChanges, recentTopics: this.topics, now });
    if (!candidate) return;
    const cooldown = Math.min(limits.cooldownMs, candidate.cooldownMs ?? Infinity) * (settled && !candidate.urgent ? 2 : 1);
    if (now - this.lastCall < cooldown || candidate.priority === 1 && now - this.lastMove < limits.moveMs) return;
    if (now - candidate.receivedAt < 2000) return; // group bursts of movement/combat updates
    if (this.calls.length >= limits.hourlyLimit) { this.stop(t('hourlyLimit')); return; }
    const intensity = settled ? 'normal' : candidate.intensity ?? 'normal';
    const revision = this.revision, timeline = this.timeline;
    const snapshot = this.latest, state = snapshot.game_state;
    const sourceCursor = this.cursor;
    const expected = adapter.fingerprint(state, candidate.event);
    const selectedEvents = this.pending.filter(item => item.receivedAt <= now).map(item => item.event);
    if (special) this.runtime.consume?.(candidate); else this.pending = [];
    const controller = new AbortController();
    this.active = { controller }; this.calls.push(now); this.lastCall = now;
    if (candidate.topicKey) this.topics.push({ key: candidate.topicKey, at: now });
    if (candidate.category === 'movement') this.lastMove = now;
    this.message = t('thinking'); this.publish();
    try {
      const result = await this.generate({ trigger: candidate.event, context: candidate.context,
        intensity, settled, tone: this.toneData().label, language: this.language, game_context: this.runtime?.context?.(state) ?? {},
        recent_changes: (rollingChanges.length ? rollingChanges.map(item => item.event) : selectedEvents).slice(-32), game: adapter.summarize(state),
        recent_flow: reference ? { from: reference.at, to: now, before: adapter.summarize(reference.state), after: adapter.summarize(state) } : null,
        recent_narration: this.history.filter(item => item.kind === 'play' && now - item.at <= 120000).slice(-6).map(item => ({ text: item.text, at: item.at })),
        already_said: this.history.slice(-4).map(item => item.text) }, { signal: controller.signal, model: this.model, instructions: buildCommentaryInstructions(adapter.instructions, { tone: this.toneData(), intensity, settled, language: this.language }) });
      if (!this.running || controller.signal.aborted || revision !== this.revision || timeline !== this.timeline) return;
      if (this.clock() - now > 30000 || !this.latest?.game_state || !candidate.skipFingerprint && expected !== adapter.fingerprint(this.latest.game_state, candidate.event)) {
        this.message = t('staleReply'); return;
      }
      if (result.speak && result.comment && (candidate.allowRestatement || addsAnalysis(result.comment)) && (adapter.reviewComment?.(result.comment, candidate, state) ?? true) && reviewTone(result.comment, this.tone, this.language) && !this.history.slice(-3).some(item => item.text === result.comment)) {
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
