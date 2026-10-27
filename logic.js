/*
 * PVP Tournier — pure game logic (no DOM, no network).
 * Works in the browser (window.PVPLogic) and in Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PVPLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const MAX_BAN_PER_PLAYER = 3;
  const FORMATS = [2, 3, 5];
  const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

  const KITS = [
    { id: 'sword', name: 'Sword', tag: 'Blade only · No pots', color: '#b7c6d8' },
    { id: 'axe', name: 'Axe', tag: 'Axes · Fast trades', color: '#71bfdd' },
    { id: 'diapot', name: 'Diamond Pot', tag: 'Diamond · Potions', color: '#8fd8ec' },
    { id: 'nethpot', name: 'Netherite Pot', tag: 'Netherite · Potions', color: '#d98a6a' },
    { id: 'diasmp', name: 'Diamond SMP', tag: 'Diamond gear · SMP rules', color: '#7cc8d8', mono: true },
    { id: 'cart', name: 'Cart PvP', tag: 'Minecart · Rail fights', color: '#cbb079', art: 'Cart', mono: true },
    { id: 'mace', name: 'Mace', tag: 'Wind charge · Smash', color: '#b9c3d6' },
    { id: 'spearmace', name: 'Spear Mace', tag: 'Spear · Mace', color: '#aab3e8' },
    { id: 'uhc', name: 'UHC', tag: 'Golden apples · No regen', color: '#d76f5c' },
    { id: 'smp', name: 'SMP', tag: 'Full gear · Everything', color: '#8fa06a' },
    { id: 'vanilla', name: 'Vanilla', tag: 'Default gear · Pure skill', color: '#c0bdf7' }
  ];

  const KIT_MAP = new Map(KITS.map(function (k) { return [k.id, k]; }));

  function fail(error, extra) {
    return Object.assign({ ok: false, error: error }, extra || {});
  }

  function otherRole(role) {
    return role === 'p1' ? 'p2' : 'p1';
  }

  function picksFor(format) {
    return format * 2 - 1;
  }

  function requiredKits(rules) {
    return picksFor(rules.format) + rules.banCount * 2;
  }

  function maxBansFor(poolSize, format) {
    const picks = picksFor(Number(format));
    const size = Number(poolSize);
    if (!Number.isFinite(picks) || !Number.isFinite(size)) return 0;
    return Math.max(0, Math.min(MAX_BAN_PER_PLAYER, Math.floor((size - picks) / 2)));
  }

  function validateUsername(name) {
    const clean = String(name == null ? '' : name).trim();
    if (clean.length < 3) return 'Username must be at least 3 characters.';
    if (clean.length > 16) return 'Username must be 16 characters or fewer.';
    if (!USERNAME_RE.test(clean)) return 'Only letters, numbers and underscores are allowed.';
    return null;
  }

  function peerIdFor(name) {
    return 'pvpt-v1-' + String(name).trim().toLowerCase();
  }

  function validateRules(input) {
    if (!input || typeof input !== 'object') return fail('No rules were provided.');

    const format = Number(input.format);
    if (FORMATS.indexOf(format) === -1) return fail('Unsupported round format.');

    const banCount = Number(input.banCount);
    if (!Number.isInteger(banCount) || banCount < 0 || banCount > MAX_BAN_PER_PLAYER) {
      return fail('Ban count must be between 0 and ' + MAX_BAN_PER_PLAYER + '.');
    }

    const rawPool = Array.isArray(input.pool) ? input.pool : [];
    const pool = [];
    rawPool.forEach(function (id) {
      if (KIT_MAP.has(id) && pool.indexOf(id) === -1) pool.push(id);
    });

    const picks = picksFor(format);
    const needed = picks + banCount * 2;

    if (pool.length < needed) {
      return fail(
        'This setup needs ' + needed + ' modes in the pool (' + picks + ' picks + ' +
          banCount * 2 + ' bans), but only ' + pool.length + ' are selected.',
        { needed: needed, picks: picks, pool: pool }
      );
    }

    return { ok: true, needed: needed, picks: picks, pool: pool };
  }

  function normalizeRules(input) {
    const check = validateRules(input);
    if (!check.ok) return check;

    return {
      ok: true,
      needed: check.needed,
      picks: check.picks,
      rules: {
        pool: check.pool.slice(),
        format: Number(input.format),
        banCount: Number(input.banCount),
        order: input.order === 'snake' ? 'snake' : 'alternate',
        firstBan: input.firstBan === 'p2' ? 'p2' : 'p1',
        firstPick: input.firstPick === 'p2' ? 'p2' : 'p1'
      }
    };
  }

  function buildSteps(rules) {
    const steps = [];
    let banOwner = rules.firstBan === 'p2' ? 'p2' : 'p1';

    for (let i = 0; i < rules.banCount * 2; i += 1) {
      steps.push({ kind: 'ban', owner: banOwner });
      banOwner = otherRole(banOwner);
    }

    const picks = picksFor(rules.format);
    let pickOwner = rules.firstPick === 'p2' ? 'p2' : 'p1';

    for (let i = 0; i < picks; i += 1) {
      steps.push({ kind: 'pick', owner: pickOwner });
      if (rules.order === 'snake') {
        if (i % 2 === 0) pickOwner = otherRole(pickOwner);
      } else {
        pickOwner = otherRole(pickOwner);
      }
    }

    return steps;
  }

  function cloneGame(game) {
    return JSON.parse(JSON.stringify(game));
  }

  function createGame(options) {
    const normal = normalizeRules(options.rules);
    if (!normal.ok) throw new Error(normal.error);

    const steps = buildSteps(normal.rules).map(function (step, index) {
      return { index: index, kind: step.kind, owner: step.owner, kit: null };
    });

    return {
      v: VERSION,
      id: String(options.id || ''),
      createdAt: options.now || Date.now(),
      updatedAt: Date.now(),
      rules: normal.rules,
      players: {
        p1: { username: String(options.players.p1) },
        p2: { username: String(options.players.p2) }
      },
      steps: steps,
      phase: 'draft',
      round: 0,
      scores: { p1: 0, p2: 0 },
      votes: { p1: null, p2: null },
      history: [],
      winner: null
    };
  }

  function activeStepIndex(game) {
    if (!game || !Array.isArray(game.steps)) return -1;
    for (let i = 0; i < game.steps.length; i += 1) {
      if (!game.steps[i].kit) return i;
    }
    return -1;
  }

  function pickedSteps(game) {
    if (!game || !Array.isArray(game.steps)) return [];
    return game.steps.filter(function (step) { return step.kind === 'pick'; });
  }

  function pickedKits(game) {
    return pickedSteps(game).map(function (step) { return step.kit; });
  }

  function currentKit(game) {
    if (!game) return null;
    const picks = pickedKits(game);
    return picks[game.round] || null;
  }

  function usedKits(game) {
    if (!game || !Array.isArray(game.steps)) return [];
    return game.steps
      .filter(function (step) { return !!step.kit; })
      .map(function (step) { return step.kit; });
  }

  function remainingKits(game) {
    const used = usedKits(game);
    return game.rules.pool.filter(function (id) { return used.indexOf(id) === -1; });
  }

  function winsNeeded(game) {
    return game.rules.format;
  }

  function applyPick(game, role, stepIndex, kitId) {
    if (!game) return fail('No active match.');
    if (game.phase !== 'draft') return fail('The draft is already finished.');
    if (role !== 'p1' && role !== 'p2') return fail('Unknown player.');

    const index = Number(stepIndex);
    if (!Number.isInteger(index) || index < 0 || index >= game.steps.length) {
      return fail('That slot does not exist.');
    }

    const active = activeStepIndex(game);
    if (active !== index) return fail('That slot is not active yet.');

    const step = game.steps[index];
    if (step.kit) return fail('That slot is already locked.');
    if (step.owner !== role) return fail("It is not your turn.");

    const id = String(kitId);
    if (game.rules.pool.indexOf(id) === -1) return fail('That gamemode is not in the pool.');
    if (usedKits(game).indexOf(id) !== -1) return fail('That gamemode is already taken.');

    const next = cloneGame(game);
    next.steps[index].kit = id;
    next.updatedAt = Date.now();

    if (activeStepIndex(next) === -1) next.phase = 'match';

    return {
      ok: true,
      game: next,
      event: {
        type: 'pick',
        role: role,
        stepIndex: index,
        kitId: id,
        kind: step.kind,
        phase: next.phase
      }
    };
  }

  function applyVote(game, role, winnerRole) {
    if (!game) return fail('No active match.');
    if (game.phase !== 'match') return fail('The match is not in the round phase.');
    if (role !== 'p1' && role !== 'p2') return fail('Unknown player.');
    if (winnerRole !== 'p1' && winnerRole !== 'p2') return fail('Pick a valid winner.');

    const next = cloneGame(game);
    next.votes[role] = winnerRole;
    next.updatedAt = Date.now();

    const event = { type: 'vote', role: role, winner: winnerRole, round: next.round };

    if (next.votes.p1 && next.votes.p2) {
      if (next.votes.p1 === next.votes.p2) {
        const winner = next.votes.p1;
        const kitId = pickedKits(next)[next.round] || null;

        next.scores[winner] += 1;
        next.votes = { p1: null, p2: null };
        next.history.push({
          round: next.round,
          kit: kitId,
          winner: winner,
          scores: { p1: next.scores.p1, p2: next.scores.p2 }
        });

        event.type = 'round';
        event.winner = winner;
        event.kitId = kitId;
        event.scores = { p1: next.scores.p1, p2: next.scores.p2 };

        if (next.scores[winner] >= next.rules.format) {
          next.phase = 'victory';
          next.winner = winner;
          event.matchOver = true;
        } else {
          next.round += 1;
          event.nextRound = next.round;
        }
      } else {
        next.votes = { p1: null, p2: null };
        event.type = 'conflict';
      }
    }

    return { ok: true, game: next, event: event };
  }

  function applyAction(game, role, action) {
    if (!action || typeof action !== 'object') return fail('Malformed action.');
    if (action.type === 'pick') {
      return applyPick(game, role, action.stepIndex, action.kitId);
    }
    if (action.type === 'vote') {
      return applyVote(game, role, action.winner);
    }
    return fail('Unknown action.');
  }

  function isValidGame(game) {
    return !!(
      game &&
      game.v === VERSION &&
      Array.isArray(game.steps) &&
      game.players &&
      game.players.p1 &&
      game.players.p2 &&
      game.scores &&
      ['draft', 'match', 'victory'].indexOf(game.phase) !== -1
    );
  }

  return {
    VERSION: VERSION,
    MAX_BAN_PER_PLAYER: MAX_BAN_PER_PLAYER,
    FORMATS: FORMATS,
    USERNAME_RE: USERNAME_RE,
    KITS: KITS,
    KIT_MAP: KIT_MAP,
    validateUsername: validateUsername,
    peerIdFor: peerIdFor,
    validateRules: validateRules,
    normalizeRules: normalizeRules,
    requiredKits: requiredKits,
    maxBansFor: maxBansFor,
    picksFor: picksFor,
    buildSteps: buildSteps,
    createGame: createGame,
    activeStepIndex: activeStepIndex,
    pickedSteps: pickedSteps,
    pickedKits: pickedKits,
    currentKit: currentKit,
    usedKits: usedKits,
    remainingKits: remainingKits,
    winsNeeded: winsNeeded,
    applyPick: applyPick,
    applyVote: applyVote,
    applyAction: applyAction,
    isValidGame: isValidGame,
    otherRole: otherRole
  };
});
