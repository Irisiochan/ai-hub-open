/**
 * Token round2 mainline 4 gates (撤闸必红):
 * C1 scene-craft switch + per-turn fail-open scene gate
 * Temporal rules: API unconditional; CLI only when replay/history present
 *
 * Reverting the round2 demotion / conditional temporal injection must turn this red.
 * Scene phrases come from sceneCraftContent.ts so the gate is tested against whatever
 * lexicon that module ships.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageRepo } from '../src/messages/messageRepo.js';
import { PromptComposer, type PromptContext } from '../src/prompt/promptComposer.js';
import { openDb } from '../src/platform/db.js';
import {
  buildSessionPreamble,
  countEngineeringSignals,
  isCraftScene,
  sceneCraftBlock,
  shouldInjectSceneCraft,
  TEMPORAL_CONTEXT_RULES,
} from '../src/memory/inject.js';
import { SCENE_CRAFT_MARK, SCENE_RE, SCENE_SAMPLES } from '../src/memory/sceneCraftContent.js';
import { estimateTokens } from '../src/prompt/tokenEstimate.js';
import type { ContactRow } from '../src/platform/db.js';

const TEMPORAL_MARK = '# 时间语义（网关强制）';
const craftRe = new RegExp(SCENE_CRAFT_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const vault = {
  async call(name: string): Promise<string> {
    if (name === 'get_core_context' || name === 'get_context') {
      return '---\ntype: memory\n---\n# compact facts\n- identity.name: User';
    }
    if (name === 'search_vault') return '没有找到相关内容。';
    throw new Error(`unexpected ${name}`);
  },
} as any;

// --- fixture sanity: the samples must keep the shape the gates below rely on ---
assert.ok(SCENE_RE.test(SCENE_SAMPLES.hard), 'hard sample must hit the scene lexicon');
assert.equal(countEngineeringSignals(SCENE_SAMPLES.hard), 0, 'hard sample carries no eng signal');
assert.ok(SCENE_RE.test(SCENE_SAMPLES.short), 'short sample must hit the scene lexicon');
assert.ok(SCENE_RE.test(SCENE_SAMPLES.mixedUncertain), 'mixed sample must hit the scene lexicon');

// --- pure helpers: detector fail-open contract ---
assert.equal(isCraftScene(''), true, 'empty → fail-open inject');
assert.equal(isCraftScene(null), true, 'null → fail-open inject');
assert.equal(isCraftScene(SCENE_SAMPLES.hard), true, 'scene text → inject');
assert.equal(isCraftScene('npm run build && git commit -m fix'), false, 'pure engineering multi-signal → skip');
assert.equal(
  isCraftScene(SCENE_SAMPLES.mixedUncertain),
  true,
  'mixed uncertain with scene cue → inject'
);
// Multi-signal gate: a single engineering hit must NOT skip (comment contract 多个工程信号).
// 撤闸必红: if MIN_ENGINEERING_SIGNALS_TO_SKIP is lowered to 1 / single RE.test restored,
// the soft-scene + sparse eng cases below flip to false and this smoke fails.
assert.equal(countEngineeringSignals('帮看一下这个 commit'), 1, 'single eng token counts as 1');
assert.equal(isCraftScene('帮看一下这个 commit'), true, 'single eng signal → fail-open inject');
assert.equal(
  countEngineeringSignals('npm run build && git commit -m fix'),
  3,
  'npm+git+commit are three independent signals'
);
assert.equal(
  shouldInjectSceneCraft('off', SCENE_SAMPLES.hard),
  false,
  'off never injects'
);
assert.equal(shouldInjectSceneCraft('always', 'npm run build'), true, 'always always injects');
// pure multi-signal engineering still skips under the per-turn mode
assert.equal(
  shouldInjectSceneCraft('scene', 'npm run build && git commit -m fix'),
  false,
  'per-turn mode + multi-signal engineering skips'
);
// single eng signal alone must not skip (fail-open)
assert.equal(
  shouldInjectSceneCraft('scene', 'npm run build'),
  true,
  'per-turn mode + single eng signal fails open (inject)'
);
assert.equal(shouldInjectSceneCraft('scene', SCENE_SAMPLES.short), true, 'per-turn mode + scene injects');
assert.equal(shouldInjectSceneCraft('scene', ''), true, 'per-turn mode + empty fail-open');
assert.equal(shouldInjectSceneCraft(undefined, ''), true, 'default per-turn mode fail-open');

// --- C1 false-negative class from real review: scene + sparse eng words still inject ---
// Hard-marker scene + one eng token (should already inject via SCENE_RE).
const hardSceneSparseEng = SCENE_SAMPLES.hardSparseEng;
assert.equal(
  countEngineeringSignals(hardSceneSparseEng),
  1,
  'hard-scene fixture has only one eng signal'
);
assert.ok(SCENE_RE.test(hardSceneSparseEng), 'hard-scene fixture must hit the scene lexicon');
assert.equal(
  isCraftScene(hardSceneSparseEng),
  true,
  'hard scene + single eng word → inject'
);
assert.equal(
  shouldInjectSceneCraft('scene', hardSceneSparseEng),
  true,
  'shouldInject hard scene + sparse eng → inject'
);

// Soft scene text WITHOUT hard SCENE_RE hits + single eng word.
// This is the exact false-negative class: loose single-signal skip misclassifies as engineering.
// 撤闸必红: restoring PURE_ENGINEERING_RE.test / single-signal skip makes these assert red.
const softSceneSparseEngCases = SCENE_SAMPLES.softSparseEng;
assert.ok(softSceneSparseEngCases.length >= 3, 'keep at least three soft-scene fixtures');
for (const sample of softSceneSparseEngCases) {
  assert.ok(
    countEngineeringSignals(sample) === 1,
    `soft-scene fixture must be single-signal for 撤闸必红: ${sample}`
  );
  assert.ok(!SCENE_RE.test(sample), `soft-scene fixture must not hit the lexicon: ${sample}`);
  assert.equal(
    isCraftScene(sample),
    true,
    `soft scene + sparse eng must inject (false-neg guard): ${sample}`
  );
  assert.equal(
    shouldInjectSceneCraft('scene', sample),
    true,
    `shouldInject soft scene + sparse eng: ${sample}`
  );
}

// --- C1 preamble: always in session; per-turn/off out of session ---
const alwaysPreamble = await buildSessionPreamble(
  vault,
  { id: 'partner', name: 'Partner', backend: 'api' },
  'compact',
  { sceneCraft: 'always' }
);
assert.match(alwaysPreamble, craftRe, 'always → session preamble has scene craft');
assert.equal(alwaysPreamble.split(SCENE_CRAFT_MARK).length - 1, 1, 'always scene craft once');

const perTurnPreamble = await buildSessionPreamble(
  vault,
  { id: 'partner', name: 'Partner', backend: 'api' },
  'compact',
  { sceneCraft: 'scene' }
);
assert.doesNotMatch(
  perTurnPreamble,
  craftRe,
  'per-turn mode → not in static session preamble (per-turn path)'
);

const offPreamble = await buildSessionPreamble(
  vault,
  { id: 'bot', name: 'Bot', backend: 'api' },
  'compact',
  { sceneCraft: 'off' }
);
assert.doesNotMatch(offPreamble, craftRe, 'off → no scene craft in preamble');

// default option (omit) = per-turn demotion
const defaultPreamble = await buildSessionPreamble(
  vault,
  { id: 'x', name: 'X', backend: 'api' },
  'compact'
);
assert.doesNotMatch(defaultPreamble, craftRe, 'default mode demotes scene craft out of preamble');

// --- compose path with real DB ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-round2-'));
const dbPath = path.join(dir, 'hub.db');
const db = openDb(dbPath);
const messages = new MessageRepo(db);
const composer = new PromptComposer(vault, messages, null);

function insertContact(id: string, backend: string, config: Record<string, unknown>): ContactRow {
  db.prepare(
    `INSERT INTO contacts (id, name, backend, kind, config) VALUES (?, ?, ?, 'dm', ?)`
  ).run(id, id, backend, JSON.stringify(config));
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactRow;
}

function ctxFor(agent: ContactRow, isRoom = false): PromptContext {
  return {
    agent,
    convo: agent,
    isRoom,
    memory: {
      mcpUrl: null,
      repoPath: null,
      injectOnSpawn: true,
      searchPerTurn: false,
      capture: false,
      maxTurnChars: 800,
      sessionMaxAgeHours: 12,
    },
    userName: 'User',
    nameOf: (s) => s,
    log: () => {},
  };
}

try {
  const always = insertContact('always-c', 'api', { sceneCraft: 'always', memoryPreambleMode: 'compact' });
  const perTurn = insertContact('scene-c', 'api', { sceneCraft: 'scene', memoryPreambleMode: 'compact' });
  const off = insertContact('off-c', 'api', { sceneCraft: 'off', memoryPreambleMode: 'compact' });
  const fresh = insertContact('fresh-c', 'claude-cli', { sceneCraft: 'off' });
  const hist = insertContact('hist-c', 'claude-cli', { sceneCraft: 'off' });

  // C1 always: present in composeStart preamble
  const alwaysStart = await composer.composeStart(ctxFor(always), 'resume-token');
  assert.match(alwaysStart.preamble, craftRe, 'compose always still has scene craft');

  // C1 off: absent in start and turn
  const offStart = await composer.composeStart(ctxFor(off), 'resume-token');
  assert.doesNotMatch(offStart.preamble, craftRe, 'compose off has no scene craft in start');
  const apiFreshStart = await composer.composeStart(ctxFor(off), null);
  assert.match(
    apiFreshStart.preamble,
    new RegExp(TEMPORAL_MARK),
    'fresh API session unconditionally carries temporal rules'
  );
  assert.match(
    apiFreshStart.preamble,
    /生成回复时引用“昨天、刚才、今晚、最近”等相对指示语，只能相对所引消息的绝对时间锚点使用，禁止把它顺延到当前轮时间。/,
    'API temporal rules constrain relative wording in generated replies'
  );
  const offTurn = await composer.composeTurn(ctxFor(off), '你好', SCENE_SAMPLES.hard, new Set());
  assert.doesNotMatch(offTurn, craftRe, 'compose off has no scene craft on a scene turn');

  // C1 per-turn: absent in start; present on scene turn; absent on pure engineering turn
  const perTurnStart = await composer.composeStart(ctxFor(perTurn), 'resume-token');
  assert.doesNotMatch(
    perTurnStart.preamble,
    craftRe,
    'compose per-turn mode has no scene craft in static start'
  );
  const sceneTurn = await composer.composeTurn(
    ctxFor(perTurn),
    '用户正文',
    SCENE_SAMPLES.hard,
    new Set()
  );
  assert.match(sceneTurn, craftRe, 'scene turn injects scene craft');
  assert.equal(
    sceneTurn.split(SCENE_CRAFT_MARK).length - 1,
    1,
    'scene turn craft once'
  );
  const engTurn = await composer.composeTurn(
    ctxFor(perTurn),
    '用户正文',
    'npm run build --prefix server 挂了，帮看 commit',
    new Set()
  );
  assert.doesNotMatch(engTurn, craftRe, 'pure multi-signal engineering turn skips scene craft');
  // single eng signal alone must not skip on compose path either
  const singleEngTurn = await composer.composeTurn(
    ctxFor(perTurn),
    '用户正文',
    '帮看一下这个 commit',
    new Set()
  );
  assert.match(singleEngTurn, craftRe, 'single eng signal compose turn fail-open injects');
  // fail-open: empty / short non-engineering uncertain text still injects
  const uncertainTurn = await composer.composeTurn(ctxFor(perTurn), '嗯', '嗯', new Set());
  assert.match(uncertainTurn, craftRe, 'uncertain short text fail-open injects');

  // compose path: hard scene + sparse eng still injects
  const hardMixedTurn = await composer.composeTurn(
    ctxFor(perTurn),
    '用户正文',
    hardSceneSparseEng,
    new Set()
  );
  assert.match(hardMixedTurn, craftRe, 'compose hard scene + sparse eng injects');

  // compose path: soft scene + single eng (false-neg class) still injects — 撤闸必红
  for (const sample of softSceneSparseEngCases) {
    const mixedTurn = await composer.composeTurn(ctxFor(perTurn), '用户正文', sample, new Set());
    assert.match(
      mixedTurn,
      craftRe,
      `compose soft scene + sparse eng injects: ${sample}`
    );
  }

  // --- C2 temporal: omit on pure new session; present with history/replay/resume ---
  const freshStart = await composer.composeStart(ctxFor(fresh), null);
  assert.doesNotMatch(
    freshStart.preamble,
    new RegExp(TEMPORAL_MARK),
    'pure new session without history omits temporal rules'
  );
  assert.doesNotMatch(
    freshStart.preamble,
    /# 对话存档回放/,
    'fixture sanity: fresh has no replay'
  );

  // resume implies continuing session → temporal required even without local replay block
  const resumed = await composer.composeStart(ctxFor(fresh), 'resume-token');
  assert.match(
    resumed.preamble,
    new RegExp(TEMPORAL_MARK),
    'resumeToken requires temporal co-presence'
  );

  // seed history → CLI bridge injects replay → temporal co-present
  db.prepare(
    `INSERT INTO messages (contact_id, sender, role, kind, content, status, created_at)
     VALUES ('hist-c', 'user', 'user', 'text', '上周聊过的旧话题', 'done', '2026-08-01 01:00:00')`
  ).run();
  db.prepare(
    `INSERT INTO messages (contact_id, sender, role, kind, content, status, created_at)
     VALUES ('hist-c', 'hist-c', 'assistant', 'text', '旧回复', 'done', '2026-08-01 01:01:00')`
  ).run();
  const histStart = await composer.composeStart(ctxFor(hist), null);
  assert.match(histStart.preamble, /# 对话存档回放/, 'history must produce replay for CLI');
  assert.match(
    histStart.preamble,
    new RegExp(TEMPORAL_MARK),
    'replay present → temporal rules co-present'
  );
  assert.ok(
    histStart.preamble.indexOf(TEMPORAL_MARK) < histStart.preamble.indexOf('# 对话存档回放'),
    'temporal rules must sit with/before replay block'
  );

  // token comparison receipt numbers (per-contact preamble delta for default demotion)
  const craftTokens = estimateTokens(sceneCraftBlock());
  const temporalTokens = estimateTokens(TEMPORAL_CONTEXT_RULES);
  const beforeAlwaysTokens = estimateTokens(alwaysPreamble);
  const afterPerTurnTokens = estimateTokens(perTurnPreamble);
  const report = {
    ok: true,
    sceneCraftTokens: craftTokens,
    temporalTokens,
    preambleTokens: {
      craftAlways: beforeAlwaysTokens,
      craftPerTurnDefault: afterPerTurnTokens,
      savedByDemotingCraftFromPreamble: beforeAlwaysTokens - afterPerTurnTokens,
    },
    gates: {
      c1_always_injects: true,
      c1_off_skips: true,
      c1_scene_turn_injects: true,
      c1_engineering_multi_signal_skips: true,
      c1_single_eng_signal_fail_open: true,
      c1_soft_scene_sparse_eng_injects: true,
      c1_fail_open: true,
      c2_fresh_omits_temporal: true,
      c2_api_fresh_has_temporal: true,
      c2_generation_relative_terms_anchored: true,
      c2_resume_has_temporal: true,
      c2_replay_has_temporal: true,
    },
    fixture: 'smoke-token-round2-gates alwaysPreamble vs perTurnPreamble (vault mock compact facts)',
  };
  console.log(JSON.stringify(report, null, 2));
  console.log('token round2 gates smoke: ok');
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
