import { el, actionButton } from './venue.js';

/**
 * The casino floor games: blackjack, roulette and video poker.
 *
 * Every game takes real money out of the wallet and can pay it back: blackjack
 * pays 1:1 (3:2 on a natural), roulette pays even money, dozens pay 2:1 and the
 * single zero takes everything, and poker pays a Jacks-or-Better table.
 */

const SUITS = [
  { key: 'S', symbol: '♠', red: false },
  { key: 'H', symbol: '♥', red: true },
  { key: 'D', symbol: '♦', red: true },
  { key: 'C', symbol: '♣', red: false },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CHIPS = [10, 25, 50, 100];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const ROULETTE_BETS = [
  { id: 'red', label: 'Red', pay: 1 },
  { id: 'black', label: 'Black', pay: 1 },
  { id: 'odd', label: 'Odd', pay: 1 },
  { id: 'even', label: 'Even', pay: 1 },
  { id: 'low', label: '1 – 18', pay: 1 },
  { id: 'high', label: '19 – 36', pay: 1 },
  { id: 'dozen1', label: '1st 12', pay: 2 },
  { id: 'dozen2', label: '2nd 12', pay: 2 },
  { id: 'dozen3', label: '3rd 12', pay: 2 },
];

const POKER_PAYS = {
  royal: { pay: 250, name: 'Royal flush' },
  straightFlush: { pay: 50, name: 'Straight flush' },
  four: { pay: 25, name: 'Four of a kind' },
  fullHouse: { pay: 9, name: 'Full house' },
  flush: { pay: 6, name: 'Flush' },
  straight: { pay: 4, name: 'Straight' },
  three: { pay: 3, name: 'Three of a kind' },
  twoPair: { pay: 2, name: 'Two pair' },
  jacks: { pay: 1, name: 'Jacks or better' },
  none: { pay: 0, name: 'Nothing' },
};

function newDeck() {
  const deck = [];
  for (const suit of SUITS) {
    RANKS.forEach((rank, index) => deck.push({ rank, value: index + 1, suit }));
  }
  return deck;
}

function shuffled(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') {
      total += 10;
    } else {
      total += card.value;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function pokerRank(cards) {
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const values = groups.map((group) => group[1]);
  const flush = cards.every((card) => card.suit.key === cards[0].suit.key);

  const high = cards.map((card) => (card.rank === 'A' ? 14 : card.value));
  const distinct = [...new Set(high)].sort((a, b) => a - b);
  let straight = distinct.length === 5 && distinct[4] - distinct[0] === 4;
  if (!straight && distinct.includes(14)) {
    const low = distinct.map((value) => (value === 14 ? 1 : value));
    straight = new Set(low).size === 5 && Math.max(...low) - Math.min(...low) === 4;
  }
  const royal = straight && flush && distinct.includes(14) && distinct.includes(13);

  if (royal) return 'royal';
  if (straight && flush) return 'straightFlush';
  if (values[0] === 4) return 'four';
  if (values[0] === 3 && values[1] === 2) return 'fullHouse';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (values[0] === 3) return 'three';
  if (values[0] === 2 && values[1] === 2) return 'twoPair';
  if (values[0] === 2 && ['J', 'Q', 'K', 'A'].includes(groups[0][0])) return 'jacks';
  return 'none';
}

function cardNode(card, { hidden = false, held = false, onClick = null } = {}) {
  if (hidden) return el('div', 'card back');
  const node = el('div', `card${card.suit.red ? ' red' : ''}${held ? ' held' : ''}`);
  node.appendChild(el('span', 'card-rank', card.rank));
  node.appendChild(el('span', 'card-suit', card.suit.symbol));
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export class CasinoGames {
  constructor(game, audio, panel) {
    this.game = game;
    this.audio = audio;
    this.panel = panel;
    this.chip = 25;
    this.kind = null;
    this.deck = shuffled(newDeck());
    this.blackjack = null;
    this.poker = null;
    this.roulette = null;
    this.timer = 0;
  }

  open(kind) {
    this.kind = kind;
    this.panel.show(
      { blackjack: 'Blackjack', roulette: 'Roulette', poker: 'Video poker' }[kind] || 'Casino',
      `Balance $${Math.floor(this.game.money)} · <kbd>E</kbd> or <kbd>Esc</kbd> to leave the table`
    );
    this.panel.onClose = () => this.reset();

    if (kind === 'blackjack') {
      this.blackjack = { player: [], dealer: [], wager: 0, phase: 'bet', message: '', result: '' };
    } else if (kind === 'poker') {
      this.poker = { hand: [], held: [false, false, false, false, false], wager: 0, phase: 'bet', message: '', result: '' };
    } else {
      this.roulette = { number: null, bet: 'red', wager: 0, phase: 'bet', message: '', result: '' };
    }
    this.render();
  }

  reset() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.kind = null;
    this.blackjack = null;
    this.poker = null;
    this.roulette = null;
  }

  draw() {
    if (this.deck.length < 15) this.deck = shuffled(newDeck());
    return this.deck.pop();
  }

  render() {
    if (this.kind === 'blackjack') this.renderBlackjack();
    else if (this.kind === 'roulette') this.renderRoulette();
    else if (this.kind === 'poker') this.renderPoker();
  }

  chipRow(busy = false) {
    const row = el('div', 'venue-row');
    row.appendChild(el('span', 'venue-label', 'Chip'));
    for (const chip of CHIPS) {
      row.appendChild(
        actionButton(`$${chip}`, () => {
          this.chip = chip;
          this.render();
        }, {
          className: `venue-chip${chip === this.chip ? ' active' : ''}`,
          disabled: busy,
        })
      );
    }
    return row;
  }

  // --- blackjack ------------------------------------------------------------
  renderBlackjack() {
    const state = this.blackjack;
    const body = this.panel.clear();

    const line = el('div', 'venue-stat');
    line.append(el('span', '', 'Wager'), el('span', '', `$${state.wager}`));
    body.appendChild(line);

    body.appendChild(el('p', 'venue-label', `Dealer${state.phase === 'player' ? '' : ` · ${handValue(state.dealer)}`}`));
    const dealerRow = el('div', 'venue-cards');
    state.dealer.forEach((card, index) => {
      dealerRow.appendChild(cardNode(card, { hidden: state.phase === 'player' && index === 1 }));
    });
    body.appendChild(dealerRow);

    body.appendChild(el('p', 'venue-label', `You · ${state.player.length ? handValue(state.player) : '—'}`));
    const playerRow = el('div', 'venue-cards');
    state.player.forEach((card) => playerRow.appendChild(cardNode(card)));
    body.appendChild(playerRow);

    if (state.message) body.appendChild(el('p', `venue-result ${state.result}`, state.message));

    const actions = el('div', 'venue-row');
    if (state.phase === 'player') {
      actions.appendChild(actionButton('Hit', () => this.blackjackHit(), { className: 'venue-button' }));
      actions.appendChild(actionButton('Stand', () => this.blackjackStand(), { className: 'venue-button' }));
    } else {
      actions.appendChild(
        actionButton(
          state.phase === 'bet' ? `Deal · $${this.chip}` : `Deal again · $${this.chip}`,
          () => this.blackjackDeal(),
          { className: 'venue-button' }
        )
      );
    }
    body.appendChild(actions);
    body.appendChild(this.chipRow(state.phase === 'player'));
  }

  blackjackDeal() {
    if (!this.game.spend(this.chip, 'blackjack')) return;
    const state = this.blackjack;
    state.wager = this.chip;
    state.player = [this.draw(), this.draw()];
    state.dealer = [this.draw(), this.draw()];
    state.phase = 'player';
    state.message = 'Your move.';
    state.result = '';
    this.audio?.burst({ freq: 300, type: 'triangle', duration: 0.08, gain: 0.12 });
    if (handValue(state.player) === 21) {
      this.blackjackResolve();
      return;
    }
    this.renderBlackjack();
  }

  blackjackHit() {
    const state = this.blackjack;
    state.player.push(this.draw());
    const total = handValue(state.player);
    if (total > 21) {
      state.phase = 'done';
      state.result = 'bad';
      state.message = `Bust with ${total} — the house keeps $${state.wager}.`;
      this.renderBlackjack();
      return;
    }
    if (total === 21) {
      this.blackjackResolve();
      return;
    }
    this.renderBlackjack();
  }

  blackjackStand() {
    this.blackjackResolve();
  }

  blackjackResolve() {
    const state = this.blackjack;
    while (handValue(state.dealer) < 17) state.dealer.push(this.draw());
    const player = handValue(state.player);
    const dealer = handValue(state.dealer);
    const natural = player === 21 && state.player.length === 2;
    state.phase = 'done';

    if (player > 21) {
      state.result = 'bad';
      state.message = `Bust with ${player} — the house keeps $${state.wager}.`;
    } else if (dealer > 21 || player > dealer) {
      const payout = natural ? Math.round(state.wager * 2.5) : state.wager * 2;
      this.game.money += payout;
      state.result = 'good';
      state.message = natural
        ? `Blackjack! Dealer ${dealer} — paid $${payout}.`
        : `You ${player} beat the dealer's ${dealer} — paid $${payout}.`;
      this.game.notify(`Blackjack paid $${payout}`, 'good');
    } else if (player === dealer) {
      this.game.money += state.wager;
      state.result = '';
      state.message = `Push on ${player} — bet returned.`;
    } else {
      state.result = 'bad';
      state.message = `Dealer ${dealer} beats your ${player} — the house keeps $${state.wager}.`;
    }
    this.renderBlackjack();
  }

  // --- roulette -------------------------------------------------------------
  renderRoulette() {
    const state = this.roulette;
    const body = this.panel.clear();

    const wheel = el('div', 'roulette-wheel');
    wheel.appendChild(
      el(
        'span',
        `roulette-number${
          state.number === null ? ' idle' : state.number === 0 ? ' zero' : RED_NUMBERS.has(state.number) ? ' red' : ' black'
        }`,
        state.number === null ? '—' : String(state.number)
      )
    );
    body.appendChild(wheel);

    body.appendChild(el('p', 'venue-label', 'Place your bet'));
    const options = el('div', 'venue-row');
    for (const bet of ROULETTE_BETS) {
      options.appendChild(
        actionButton(bet.label, () => {
          state.bet = bet.id;
          this.renderRoulette();
        }, {
          className: `venue-chip${state.bet === bet.id ? ' active' : ''}`,
          disabled: state.phase === 'spinning',
        })
      );
    }
    body.appendChild(options);

    const bet = ROULETTE_BETS.find((entry) => entry.id === state.bet);
    const actions = el('div', 'venue-row');
    actions.appendChild(
      actionButton(
        `Spin $${this.chip} on ${bet.label} · pays ${bet.pay}:1`,
        () => this.rouletteSpin(),
        { className: 'venue-button', disabled: state.phase === 'spinning' }
      )
    );
    body.appendChild(actions);
    if (state.message) body.appendChild(el('p', `venue-result ${state.result}`, state.message));
    body.appendChild(this.chipRow(state.phase === 'spinning'));
  }

  rouletteSpin() {
    const state = this.roulette;
    if (state.phase === 'spinning') return;
    if (!this.game.spend(this.chip, 'roulette')) return;
    state.wager = this.chip;
    state.phase = 'spinning';
    state.result = '';
    state.message = 'No more bets…';
    this.renderRoulette();

    let ticks = 0;
    const tick = () => {
      if (!this.panel.open || this.kind !== 'roulette') return;
      ticks += 1;
      state.number = Math.floor(Math.random() * 37);
      this.renderRoulette();
      if (ticks < 12) {
        this.timer = setTimeout(tick, 60 + ticks * 18);
        return;
      }
      this.rouletteResolve();
    };
    this.timer = setTimeout(tick, 80);
  }

  rouletteResolve() {
    const state = this.roulette;
    const number = Math.floor(Math.random() * 37);
    state.number = number;
    state.phase = 'bet';
    const bet = ROULETTE_BETS.find((entry) => entry.id === state.bet);
    const color = number === 0 ? 'green' : RED_NUMBERS.has(number) ? 'red' : 'black';

    let won = false;
    if (number !== 0) {
      if (bet.id === 'red') won = color === 'red';
      else if (bet.id === 'black') won = color === 'black';
      else if (bet.id === 'odd') won = number % 2 === 1;
      else if (bet.id === 'even') won = number % 2 === 0;
      else if (bet.id === 'low') won = number <= 18;
      else if (bet.id === 'high') won = number >= 19;
      else if (bet.id === 'dozen1') won = number <= 12;
      else if (bet.id === 'dozen2') won = number >= 13 && number <= 24;
      else if (bet.id === 'dozen3') won = number >= 25;
    }

    if (won) {
      const payout = state.wager * (bet.pay + 1);
      this.game.money += payout;
      state.result = 'good';
      state.message = `${number} ${color} — ${bet.label} pays $${payout}.`;
      this.game.notify(`Roulette paid $${payout}`, 'good');
    } else {
      state.result = 'bad';
      state.message = `${number} ${color} — the house keeps $${state.wager}.`;
    }
    this.renderRoulette();
  }

  // --- video poker ----------------------------------------------------------
  renderPoker() {
    const state = this.poker;
    const body = this.panel.clear();

    const line = el('div', 'venue-stat');
    line.append(el('span', '', 'Wager'), el('span', '', `$${state.wager}`));
    body.appendChild(line);

    const hand = el('div', 'venue-cards');
    state.hand.forEach((card, index) => {
      hand.appendChild(
        cardNode(card, {
          held: state.held[index],
          onClick: state.phase === 'draw'
            ? () => {
                state.held[index] = !state.held[index];
                this.renderPoker();
              }
            : null,
        })
      );
    });
    body.appendChild(hand);
    body.appendChild(
      el(
        'p',
        'venue-label',
        state.phase === 'draw' ? 'Click a card to hold it, then draw.' : 'Jacks or better pays 1:1.'
      )
    );

    if (state.message) body.appendChild(el('p', `venue-result ${state.result}`, state.message));

    const actions = el('div', 'venue-row');
    if (state.phase === 'draw') {
      actions.appendChild(actionButton('Draw', () => this.pokerDraw(), { className: 'venue-button' }));
    } else {
      actions.appendChild(
        actionButton(`Deal · $${this.chip}`, () => this.pokerDeal(), { className: 'venue-button' })
      );
    }
    body.appendChild(actions);
    body.appendChild(this.chipRow(state.phase === 'draw'));
  }

  pokerDeal() {
    if (!this.game.spend(this.chip, 'poker')) return;
    const state = this.poker;
    state.wager = this.chip;
    state.hand = [this.draw(), this.draw(), this.draw(), this.draw(), this.draw()];
    state.held = [false, false, false, false, false];
    state.phase = 'draw';
    state.message = '';
    state.result = '';
    this.renderPoker();
  }

  pokerDraw() {
    const state = this.poker;
    state.hand = state.hand.map((card, index) => (state.held[index] ? card : this.draw()));
    state.held = [false, false, false, false, false];
    state.phase = 'done';
    const rank = pokerRank(state.hand);
    const { pay, name } = POKER_PAYS[rank];
    if (pay > 0) {
      const payout = pay * state.wager;
      this.game.money += payout;
      state.result = 'good';
      state.message = `${name} — paid $${payout}.`;
      this.game.notify(`Poker paid $${payout}`, 'good');
    } else {
      state.result = 'bad';
      state.message = 'No pair of jacks — the house keeps the bet.';
    }
    this.renderPoker();
  }
}
