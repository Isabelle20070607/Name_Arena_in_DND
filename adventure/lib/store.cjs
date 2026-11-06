'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { AppError } = require('./errors.cjs');
const { RULES_VERSION } = require('./rules.cjs');

class Store {
  constructor(filename) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('This save database is newer than this application.');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id), request_id TEXT NOT NULL,
        action TEXT NOT NULL, kind TEXT NOT NULL, base_revision INTEGER NOT NULL,
        status TEXT NOT NULL, prepared TEXT NOT NULL, PRIMARY KEY(campaign_id, request_id));
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_turn ON requests(campaign_id) WHERE status='prepared';
      CREATE TABLE IF NOT EXISTS turns (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id), turn INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(campaign_id, turn));
      CREATE TABLE IF NOT EXISTS facts (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id), turn INTEGER NOT NULL,
        text TEXT NOT NULL, UNIQUE(campaign_id, text));
      PRAGMA user_version=1;
    `);
    if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  create(state) {
    this.db.prepare('INSERT INTO campaigns VALUES (?, ?, ?, ?)').run(state.id, JSON.stringify(state), state.revision, state.updatedAt);
  }
  get(id) {
    const row = this.db.prepare('SELECT payload FROM campaigns WHERE id=?').get(id);
    if (!row) throw new AppError(404, 'NOT_FOUND', '没有找到这份战役存档。');
    const state = JSON.parse(row.payload);
    if (state.schemaVersion !== 1 || state.rulesVersion !== RULES_VERSION) {
      throw new AppError(409, 'SAVE_VERSION', '存档规则版本不兼容，请使用对应版本代码。');
    }
    return state;
  }
  list() {
    return this.db.prepare('SELECT payload FROM campaigns ORDER BY updated_at DESC').all().map(row => {
      const s = JSON.parse(row.payload);
      return { id: s.id, title: s.title, name: s.character.name, revision: s.revision,
        updatedAt: s.updatedAt, status: s.status, mode: s.dmMode };
    });
  }
  request(id, requestId) {
    const row = this.db.prepare('SELECT * FROM requests WHERE campaign_id=? AND request_id=?').get(id, requestId);
    return row ? { ...row, prepared: JSON.parse(row.prepared) } : null;
  }
  pending(id) {
    const row = this.db.prepare("SELECT request_id, action, kind, base_revision FROM requests WHERE campaign_id=? AND status='prepared'").get(id);
    return row ? { requestId: row.request_id, action: row.action, kind: row.kind, expectedRevision: row.base_revision } : null;
  }
  prepare(id, requestId, action, kind, baseRevision, prepared) {
    this.transaction(() => {
      if (this.get(id).revision !== baseRevision) throw new AppError(409, 'STALE_REVISION', '存档已更新，请重新载入。');
      if (this.pending(id)) throw new AppError(409, 'PENDING_TURN', '请先重试或取消尚未完成的回合。');
      this.db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, requestId, action, kind, baseRevision, 'prepared', JSON.stringify(prepared));
    });
  }
  commit(id, requestId, state, turn, facts) {
    this.transaction(() => {
      const request = this.request(id, requestId);
      if (!request || request.status !== 'prepared' || this.get(id).revision !== request.base_revision) {
        throw new AppError(409, 'STALE_REVISION', '存档已更新，请重新载入。');
      }
      this.db.prepare('UPDATE campaigns SET payload=?, revision=?, updated_at=? WHERE id=?').run(
        JSON.stringify(state), state.revision, state.updatedAt, id);
      this.db.prepare('INSERT INTO turns VALUES (?, ?, ?)').run(id, state.revision, JSON.stringify(turn));
      for (const fact of facts) this.db.prepare('INSERT OR IGNORE INTO facts VALUES (?, ?, ?)').run(id, state.revision, fact);
      this.db.prepare("UPDATE requests SET status='done', prepared='{}' WHERE campaign_id=? AND request_id=?").run(id, requestId);
    });
  }
  cancel(id, requestId) {
    // No main state was committed. Keep a tombstone so a delayed request cannot replay a cancelled ID.
    const row = this.request(id, requestId);
    if (!row || row.status !== 'prepared') throw new AppError(409, 'NO_PENDING_TURN', '没有可取消的待完成回合。');
    this.db.prepare("UPDATE requests SET status='cancelled', prepared='{}' WHERE campaign_id=? AND request_id=?").run(id, requestId);
  }
  turns(id, before = Number.MAX_SAFE_INTEGER, limit = 50) {
    return this.db.prepare('SELECT payload FROM turns WHERE campaign_id=? AND turn<? ORDER BY turn DESC LIMIT ?')
      .all(id, before, limit).map(row => JSON.parse(row.payload)).reverse();
  }
  allTurns(id) {
    return this.db.prepare('SELECT payload FROM turns WHERE campaign_id=? ORDER BY turn').all(id).map(row => JSON.parse(row.payload));
  }
  facts(id) { return this.db.prepare('SELECT turn, text FROM facts WHERE campaign_id=? ORDER BY turn, rowid').all(id); }
  close() { this.db.close(); }
}
module.exports = { Store };
