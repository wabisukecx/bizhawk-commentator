import { readFile, writeFile, readdir, mkdir, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const slug = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_ZIP = 4 * 1024 * 1024, MAX_FILE = 2 * 1024 * 1024, MAX_TOTAL = 16 * 1024 * 1024;

function entryPath(value) {
  if (typeof value !== 'string' || value.length > 160 || value.includes('\\') || value.startsWith('/')) throw new Error('Invalid pack entry path');
  const parts = value.split('/');
  if (parts.some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || ['.', '..'].includes(part) || part.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Invalid pack entry path: ${value}`);
  if (!/\.(json|m?js|lua|md|txt)$/i.test(value) || ['host.mjs', 'package.json'].includes(value.toLowerCase())) throw new Error(`Unsupported or reserved pack entry: ${value}`);
  return value;
}

export function readGamePack(bytes) {
  if (bytes.length > MAX_ZIP) throw new Error('Game pack ZIP exceeds 4 MiB');
  let total = 0, count = 0;
  const seen = new Set();
  const files = unzipSync(bytes, { filter(file) {
    if (++count > 128) throw new Error('Too many entries in game pack');
    // Directory entries contain no content and are never written to disk directly.
    const name = file.name.endsWith('/') ? file.name.slice(0, -1) : file.name;
    if (file.name.endsWith('/')) {
      if (!name || name.split('/').some(part => !/^[a-zA-Z0-9_-]+$/.test(part))) throw new Error('Invalid pack directory');
      return false;
    }
    entryPath(name);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate pack entry: ${name}`);
    seen.add(key);
    total += file.originalSize;
    if (file.originalSize > MAX_FILE || total > MAX_TOTAL) throw new Error('Game pack expands beyond its size limit');
    return true;
  } });
  if (!files['pack.json']) throw new Error('Game pack requires pack.json at the ZIP root');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['pack.json']));
  if (manifest.apiVersion !== 2) throw new Error('Unsupported game pack API version; rebuild this pack for API 2');
  if (!slug.test(manifest.id) || typeof manifest.title !== 'string' || !manifest.title.trim() || manifest.title.length > 200 || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid game pack identity');
  if (typeof manifest.rom?.system !== 'string' || !/^[A-Za-z0-9 _-]{1,32}$/.test(manifest.rom.system) || !Array.isArray(manifest.rom.hashes) || !manifest.rom.hashes.length || manifest.rom.hashes.length > 32 || manifest.rom.hashes.some(hash => typeof hash !== 'string' || !/^[0-9a-f]{40}$/i.test(hash))) throw new Error('Game pack must identify its system and exact ROM SHA-1 hashes');
  if (manifest.memoryDomain !== undefined && (typeof manifest.memoryDomain !== 'string' || !manifest.memoryDomain.trim() || manifest.memoryDomain.length > 80)) throw new Error('Invalid game pack memory domain');
  if (!slug.test(manifest.observation?.kind)) throw new Error('Invalid game pack observation kind');
  const entries = [manifest.lua, manifest.adapter];
  if (!manifest.observation.entry) throw new Error('Every game pack requires its own observation engine entry');
  entries.push(manifest.observation.entry);
  for (const entry of entries) if (!files[entryPath(entry)]) throw new Error(`Missing game pack entry: ${entry}`);
  if (!manifest.lua.endsWith('.lua') || !/\.m?js$/.test(manifest.adapter) || manifest.observation.entry && !manifest.observation.entry.endsWith('.lua')) throw new Error('Incorrect game pack entry extension');
  // Decompressors must agree with the advertised lengths before files are installed.
  if (Object.values(files).some(file => file.length > MAX_FILE) || Object.values(files).reduce((n, file) => n + file.length, 0) > MAX_TOTAL) throw new Error('Game pack expands beyond its size limit');
  return { manifest, files, digest: createHash('sha256').update(bytes).digest('hex') };
}

function luaValue(value) {
  if (typeof value === 'string') return JSON.stringify(value.replaceAll('\\', '/'));
  if (Array.isArray(value)) return `{${value.map(luaValue).join(',')}}`;
  return `{${Object.entries(value).map(([key, item]) => `[${luaValue(key)}]=${luaValue(item)}`).join(',')}}`;
}

export async function prepareGamePacks({ directory = path.join(root, 'game-packs'), cacheDirectory = path.join(root, 'runtime/game-packs/cache'), indexFile = path.join(root, 'runtime/game-packs/index.lua') } = {}) {
  let names;
  try { names = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /\.zip$/i.test(entry.name)).map(entry => entry.name).sort(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
  const packs = [], ids = new Set(), roms = new Set(), engines = new Set();
  // Validate the whole set before installing or publishing a Lua index.
  for (const name of names) {
    const source = path.join(directory, name);
    if ((await lstat(source)).size > MAX_ZIP) throw new Error(`${name}: Game pack ZIP exceeds 4 MiB`);
    let pack;
    try { pack = readGamePack(await readFile(source)); }
    catch (error) { throw new Error(`${name}: ${error.message}`, { cause: error }); }
    const { manifest } = pack;
    if (ids.has(manifest.id)) throw new Error(`Duplicate game pack ID: ${manifest.id}`);
    ids.add(manifest.id);
    for (const hash of manifest.rom.hashes) {
      const key = `${manifest.rom.system}:${hash.toUpperCase()}`;
      if (roms.has(key)) throw new Error(`Conflicting game pack ROM: ${key}`);
      roms.add(key);
    }
    if (manifest.observation.entry) {
      if (engines.has(manifest.observation.kind)) throw new Error(`Duplicate custom observation engine: ${manifest.observation.kind}`);
      engines.add(manifest.observation.kind);
    }
    packs.push(pack);
  }
  const installed = [];
  for (const pack of packs) {
    const destination = path.join(cacheDirectory, pack.digest);
    await mkdir(cacheDirectory, { recursive: true });
    const staging = path.join(cacheDirectory, `.install-${randomUUID()}`);
    await mkdir(staging);
    try {
      for (const [name, content] of Object.entries(pack.files)) {
        const target = path.join(staging, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      await writeFile(path.join(staging, 'package.json'), JSON.stringify({ type: 'module', imports: { '#commentator/host': './host.mjs' } }) + '\n');
      await writeFile(path.join(staging, 'host.mjs'), `export * from ${JSON.stringify(new URL('../app/game-host.js', import.meta.url).href)};\n`);
      await writeFile(path.join(staging, '.pack-ready'), pack.digest);
      try { await rename(staging, destination); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
        // Windows reports EPERM when another app/MCP process has already installed this directory.
        // Accept only an atomically completed cache, never a partial install or a genuine permission error.
        let complete = false;
        try { complete = (await lstat(destination)).isDirectory() && await readFile(path.join(destination, '.pack-ready'), 'utf8') === pack.digest; }
        catch { /* retain the original rename failure */ }
        if (!complete) throw error;
      }
    } finally { await rm(staging, { recursive: true, force: true }); }
    installed.push({ ...pack.manifest, directory: destination, digest: pack.digest });
  }
  const definitions = installed.map(pack => ({ id: pack.id, system: pack.rom.system, hashes: pack.rom.hashes.map(hash => hash.toUpperCase()),
    root: pack.directory, profile: path.join(pack.directory, pack.lua), domain: pack.memoryDomain ?? 'System Bus', kind: pack.observation.kind,
    ...(pack.observation.entry ? { observer: path.join(pack.directory, pack.observation.entry) } : {}) }));
  await mkdir(path.dirname(indexFile), { recursive: true });
  const temporary = `${indexFile}.${randomUUID()}.tmp`;
  const indexContent = `-- Generated from installed game packs.\nreturn ${luaValue(definitions)}\n`;
  try {
    await writeFile(temporary, indexContent);
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, indexFile); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        // Windows can hold the old index briefly while another client or Lua reads it.
        // An identical completed publication is sufficient; otherwise retry the atomic replacement.
        try { if (await readFile(indexFile, 'utf8') === indexContent) break; } catch { /* retry below */ }
        if (attempt >= 39) throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  }
  finally { await rm(temporary, { force: true }); }
  return installed;
}

export async function loadGameAdapters(options) {
  const packs = await prepareGamePacks(options), adapters = [];
  for (const pack of packs) {
    const module = await import(pathToFileURL(path.join(pack.directory, pack.adapter)).href);
    const adapter = module.default;
    if (!adapter || adapter.id !== pack.id || adapter.stateSchema !== pack.observation.kind) throw new Error(`Adapter identity/schema does not match pack.json: ${pack.id}`);
    for (const method of ['accepts', 'selectCandidate', 'fingerprint', 'summarize', 'describe']) if (typeof adapter[method] !== 'function') throw new Error(`Game pack ${pack.id} is missing adapter.${method}`);
    for (const method of ['normalize', 'localizeTone', 'createRuntime']) if (adapter[method] !== undefined && typeof adapter[method] !== 'function') throw new Error(`Invalid optional adapter hook ${method} in ${pack.id}`);
    adapters.push(Object.freeze({ ...adapter, title: adapter.title ?? pack.title }));
  }
  return adapters;
}

export async function buildGamePack(directory, output) {
  const files = {};
  async function visit(folder, prefix = '') {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Game packs cannot contain symbolic links');
      if (entry.isDirectory()) await visit(path.join(folder, entry.name), name + '/');
      else {
        entryPath(name);
        if ((await lstat(path.join(folder, entry.name))).size > MAX_FILE) throw new Error('Game pack file exceeds 2 MiB');
        files[name] = new Uint8Array(await readFile(path.join(folder, entry.name)));
      }
    }
  }
  const manifestBytes = await readFile(path.join(directory, 'pack.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.files !== undefined) {
    if (!Array.isArray(manifest.files) || manifest.files.length > 64) throw new Error('Invalid pack source file list');
    files['pack.json'] = new Uint8Array(manifestBytes);
    for (const name of manifest.files) {
      if (typeof name !== 'string' || name.includes('\\') || name.split('/').some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || ['.', '..'].includes(part))) throw new Error('Invalid pack source path');
      const source = path.join(directory, name), info = await lstat(source);
      if (info.isSymbolicLink()) throw new Error('Game packs cannot contain symbolic links');
      if (info.isDirectory()) await visit(source, name + '/');
      else { entryPath(name); if (info.size > MAX_FILE) throw new Error('Game pack file exceeds 2 MiB'); files[name] = new Uint8Array(await readFile(source)); }
    }
  } else await visit(directory);
  // Stable source builds reuse the same cache; build time is not game-pack content.
  const zip = zipSync(files, { mtime: new Date(2000, 0, 1) });
  readGamePack(zip);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, zip);
  return output;
}

export async function buildSourcePacks(directory = path.join(root, 'game-pack-sources'), outputDirectory = path.join(root, 'game-packs')) {
  const outputs = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return outputs; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(directory, entry.name);
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(source, 'pack.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!slug.test(manifest.id)) throw new Error('Invalid pack source ID');
    outputs.push(await buildGamePack(source, path.join(outputDirectory, `${manifest.id}.zip`)));
  }
  return outputs;
}
