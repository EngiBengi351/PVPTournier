/*
 * PVPtournament — pure game logic (no DOM, no network).
 * Works in the browser (window.PVPLogic) and in Node (module.exports).
 *
 * Match shape: a fixed pool of 7 kits. Each player bans 1 kit and picks 2
 * kits (2 bans + 4 picks = 6 kits). The single kit left over is the decider,
 * only played when the duel is tied after all four rounds.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PVPLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const POOL_SIZE = 7;
  const BANS_PER_PLAYER = 1;
  const PICKS_PER_PLAYER = 2;
  const TOTAL_PICKS = PICKS_PER_PLAYER * 2;
  const TOTAL_ROUNDS = TOTAL_PICKS;
  const DECIDER_ROUND = TOTAL_ROUNDS;
  const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

  const KITS = [
    { id: 'sword', name: 'Sword', tag: 'Blade only · No pots', color: '#b7c6d8' },
    { id: 'axe', name: 'Axe', tag: 'Axes · Fast trades', color: '#71bfdd' },
    { id: 'diapot', name: 'Diamond Pot', tag: 'Diamond · Potions', color: '#8fd8ec' },
    { id: 'nethpot', name: 'Netherite Pot', tag: 'Netherite · Potions', color: '#d98a6a' },
    { id: 'diasmp', name: 'Diamond SMP', tag: 'Diamond gear · SMP rules', color: '#32c9c9' },
    { id: 'cart', name: 'Cart PvP', tag: 'Minecart · Rail fights', color: '#c83d35', art: 'Cart' },
    { id: 'spearmace', name: 'Spear Mace', tag: 'Spear · Mace combo', color: '#b7a6b9' },
    { id: 'elytra-mace', name: 'Elytra Mace', tag: 'Elytra · Mace drops', color: '#a7b0bd', art: 'elytraMace' },
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

  function picksFor() {
    return TOTAL_PICKS;
  }

  function requiredKits() {
    return POOL_SIZE;
  }

  function maxBansFor() {
    return BANS_PER_PLAYER;
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
    if (!input || typeof input !== 'object') return fail('No kit pool was provided.');

    const rawPool = Array.isArray(input.pool) ? input.pool : [];
    const pool = [];
    rawPool.forEach(function (id) {
      if (KIT_MAP.has(id) && pool.indexOf(id) === -1) pool.push(id);
    });

    if (pool.length !== POOL_SIZE) {
      return fail(
        'The pool must hold exactly ' + POOL_SIZE + ' gamemodes (' + pool.length + ' selected).',
        { needed: POOL_SIZE, pool: pool }
      );
    }

    return { ok: true, needed: POOL_SIZE, picks: TOTAL_PICKS, pool: pool };
  }

  function normalizeRules(input) {
    const check = validateRules(input);
    if (!check.ok) return check;

    // One player starts and both bans and picks always alternate, so the
    // starter is the only draft choice that matters.
    const starter = input.firstPick === 'p2' || input.firstPick === 'p1'
      ? input.firstPick
      : (input.firstBan === 'p2' ? 'p2' : 'p1');

    return {
      ok: true,
      needed: check.needed,
      picks: check.picks,
      rules: {
        pool: check.pool.slice(),
        banCount: BANS_PER_PLAYER,
        order: 'alternate',
        firstBan: starter,
        firstPick: starter
      }
    };
  }

  function buildSteps(rules) {
    const starter = rules.firstPick === 'p2' ? 'p2' : 'p1';
    const steps = [];
    let owner = starter;

    for (let i = 0; i < BANS_PER_PLAYER * 2; i += 1) {
      steps.push({ kind: 'ban', owner: owner });
      owner = otherRole(owner);
    }

    owner = starter;

    for (let i = 0; i < TOTAL_PICKS; i += 1) {
      steps.push({ kind: 'pick', owner: owner });
      owner = otherRole(owner);
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
      decider: null,
      ready: { p1: false, p2: false },
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

  function isDeciderRound(game) {
    return !!game && game.round >= DECIDER_ROUND;
  }

  function kitForRound(game, round) {
    if (!game) return null;
    const index = Number(round);
    if (!Number.isInteger(index) || index < 0) return null;
    if (index >= DECIDER_ROUND) return game.decider || null;
    return pickedKits(game)[index] || null;
  }

  function currentKit(game) {
    if (!game) return null;
    return kitForRound(game, game.round);
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
    if (step.owner !== role) return fail('It is not your turn.');

    const id = String(kitId);
    if (game.rules.pool.indexOf(id) === -1) return fail('That gamemode is not in the pool.');
    if (usedKits(game).indexOf(id) !== -1) return fail('That gamemode is already taken.');

    const next = cloneGame(game);
    next.steps[index].kit = id;
    next.updatedAt = Date.now();

    if (activeStepIndex(next) === -1) {
      next.decider = remainingKits(next)[0] || null;
      next.ready = { p1: false, p2: false };
      next.phase = 'reveal';
    }

    return {
      ok: true,
      game: next,
      event: {
        type: 'pick',
        role: role,
        stepIndex: index,
        kitId: id,
        kind: step.kind,
        phase: next.phase,
        decider: next.decider
      }
    };
  }

  function applyReady(game, role) {
    if (!game) return fail('No active match.');
    if (game.phase !== 'reveal') return fail('The decider was not announced yet.');
    if (role !== 'p1' && role !== 'p2') return fail('Unknown player.');

    const next = cloneGame(game);
    next.ready[role] = true;
    next.updatedAt = Date.now();

    const both = next.ready.p1 && next.ready.p2;
    if (both) {
      next.phase = 'match';
      next.votes = { p1: null, p2: null };
      next.round = 0;
    }

    return {
      ok: true,
      game: next,
      event: {
        type: both ? 'round-start' : 'ready',
        role: role,
        round: next.round,
        decider: next.decider
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
        const deciderRound = next.round >= DECIDER_ROUND;
        const kitId = kitForRound(next, next.round);

        next.scores[winner] += 1;
        next.votes = { p1: null, p2: null };
        next.history.push({
          round: next.round,
          kit: kitId,
          decider: deciderRound,
          winner: winner,
          scores: { p1: next.scores.p1, p2: next.scores.p2 }
        });

        event.type = 'round';
        event.winner = winner;
        event.kitId = kitId;
        event.decider = deciderRound;
        event.scores = { p1: next.scores.p1, p2: next.scores.p2 };

        if (deciderRound) {
          next.phase = 'victory';
          next.winner = winner;
          event.matchOver = true;
        } else if (next.round === TOTAL_ROUNDS - 1) {
          if (next.scores.p1 === next.scores.p2) {
            next.round = DECIDER_ROUND;
            next.ready = { p1: false, p2: false };
            event.tiebreak = true;
            event.nextRound = next.round;
          } else {
            next.phase = 'victory';
            next.winner = next.scores.p1 > next.scores.p2 ? 'p1' : 'p2';
            event.matchOver = true;
          }
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
    if (action.type === 'ready') {
      return applyReady(game, role);
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
      ['draft', 'reveal', 'match', 'victory'].indexOf(game.phase) !== -1
    );
  }

  return {
    VERSION: VERSION,
    POOL_SIZE: POOL_SIZE,
    BANS_PER_PLAYER: BANS_PER_PLAYER,
    PICKS_PER_PLAYER: PICKS_PER_PLAYER,
    TOTAL_PICKS: TOTAL_PICKS,
    TOTAL_ROUNDS: TOTAL_ROUNDS,
    DECIDER_ROUND: DECIDER_ROUND,
    MAX_BAN_PER_PLAYER: BANS_PER_PLAYER,
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
    usedKits: usedKits,
    remainingKits: remainingKits,
    isDeciderRound: isDeciderRound,
    kitForRound: kitForRound,
    currentKit: currentKit,
    applyPick: applyPick,
    applyReady: applyReady,
    applyVote: applyVote,
    applyAction: applyAction,
    isValidGame: isValidGame,
    otherRole: otherRole
  };
});
