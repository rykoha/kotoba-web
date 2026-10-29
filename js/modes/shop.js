// Shopkeeper (ShopkeeperView.swift): listen to orders, count out the right number with the right counter, answer politely.
// At N4 (js/levels.js) more goods and counters (杯, 冊, 台, 足) come in, customers speak keigo, and the shopkeeper
// answers a customer's request with the shop's own polite and humble forms (かしこまりました, 少々 お待ちください…).
import { store } from '../store.js';
import { speaker } from '../audio.js';
import { CUSTOMERS, COUNTERS, SHOP_GREETINGS, SHOP_THANKS, SHOP_GREETINGS_N4, SHOP_THANKS_N4, SHOP_GREETINGS_N3, SHOP_THANKS_N3 } from '../data.js';
import { esc, pick, shuffle, delegate } from '../ui.js';
import * as fx from '../fx.js';
import { content, pickMixed, levelOf, levelBar, APP_LEVELS } from '../levels.js';

export function mount(el, ctx) {
  const GOAL = 3;
  // The shelf: the unlocked levels' goods.
  const SHOP_STOCK = content('shop');
  let customer = CUSTOMERS.worker;
  let item = SHOP_STOCK[0];
  let keigo = null;       // N4: { m (the moment), opts (shuffled) }
  let lines = null;       // greetings or thanks on screen, shuffled (N4 and N3 lines, N5 indexes)
  // N4 and N3 customers both get the polite shop: greetings, keigo moments and thanks (N3 ones more formal).
  const n4 = () => levelOf(customer) !== 'N5';
  const GREETS = () => (levelOf(customer) === 'N3' ? SHOP_GREETINGS_N3 : SHOP_GREETINGS_N4);
  const THANKS = () => (levelOf(customer) === 'N3' ? SHOP_THANKS_N3 : SHOP_THANKS_N4);
  const rank = (x) => APP_LEVELS.indexOf(levelOf(x));
  let count = 1;
  let step = 'greet';
  let basket = [];
  let showText = false;
  let feedback = null;
  let served = 0;
  let perfect = 0;
  let mistakes = 0;
  let orderTimer;

  // A course unit can limit orders to its counters (ctx.counters); the shelf and scoring stay the same.
  const orderStock = ctx.counters?.length ? SHOP_STOCK.filter((s) => ctx.counters.includes(s.counter)) : SHOP_STOCK;
  // A customer orders goods of their level or below: an N5 customer N5 goods, an N4 or N3 customer mostly their
  // own level's (about 70%) and the rest from below.
  const stockFor = (c) => {
    const list = orderStock.filter((x) => rank(x) <= rank(c));
    return list.length ? list : orderStock;
  };
  const say = (it, n) => COUNTERS[it.counter].say[n - 1];
  const orderText = () => customer.order(item, say(item, count));
  const sayOrder = () => speaker.speak(orderText(), { mps: 4, voice: customer.voice });

  function render() {
    el.innerHTML = `
      <div class="stack">
        ${ctx.counters?.length ? '' : levelBar('shop')}
        <p class="strong mono" lang="ja">お店 · ${served} served · ${perfect} perfect</p>
        <div class="panel customer">
          <span class="cust-emoji">${customer.emoji}</span>
          <div class="grow">
            <p class="small dim">${esc(customer.label)}</p>
            ${step === 'greet' ? '<p class="lead">(walks in)</p>' : `
              <p class="lead strong" lang="ja">${showText || step === 'done' ? esc(orderText()) : '🔊 Listen to the order'}</p>
              <div class="row-gap">
                <button class="linkbtn" data-act="hear">Hear again</button>
                <button class="linkbtn" data-act="text">${showText ? 'Hide text' : 'Show text'}</button>
              </div>`}
          </div>
        </div>
        ${feedback ? `<p class="${feedback.startsWith('✓') ? 'good-c' : 'miss-c'}" lang="ja">${esc(feedback)}</p>` : ''}
        ${body()}
      </div>`;
  }

  function body() {
    if (step === 'greet') {
      if (n4()) {
        return `<p class="small strong dim">A customer walks in. Greet them the way a shop does, politely.</p>
          ${lines.map((g) => `<button class="btn left" data-act="greet4" data-i="${GREETS().indexOf(g)}" lang="ja">${esc(g.jp)}</button>`).join('')}`;
      }
      return `<p class="small strong dim">A customer walks in. What do you say?</p>
        ${lines.map((i) => `<button class="btn left" data-act="greet" data-i="${i}" lang="ja">${esc(SHOP_GREETINGS[i])}</button>`).join('')}`;
    }
    if (step === 'keigo') {
      const m = keigo.m;
      return `<div class="panel stack-sm">
          <p class="lead strong" lang="ja">${esc(m.line.jp)}</p>
          <p class="small dim">${esc(m.line.en)}</p>
          <button class="linkbtn" data-act="hearkeigo">🔊 Hear again</button>
        </div>
        <p class="small strong dim">${esc(m.ask)}</p>
        ${keigo.opts.map((o) => `<button class="btn left" data-act="keigo" data-i="${m.options.indexOf(o)}" lang="ja">${esc(o.jp)}</button>`).join('')}`;
    }
    if (step === 'fill') {
      return `<p class="small strong dim">Put the order on the counter, then hand it over.</p>
        <div class="shop-grid">${SHOP_STOCK.map((s, i) => `
          <button class="panel shop-item" data-act="add" data-i="${i}"><span class="shop-emoji">${s.emoji}</span><span class="small strong" lang="ja">${esc(s.name)}</span></button>`).join('')}
        </div>
        <div class="panel counter-row"><span class="counter-items">${basket.length ? basket.map((b) => b.emoji).join(' ') : '<span class="dim">Counter is empty</span>'}</span>
          ${basket.length ? '<button class="linkbtn" data-act="clear">Clear</button>' : ''}</div>
        <button class="btn primary wide" data-act="hand" ${basket.length ? '' : 'disabled'}>✋ Hand it over</button>`;
    }
    if (step === 'reply' && n4()) {
      return `<p class="small strong dim">They're leaving. Thank them the way a shop does.</p>
        ${lines.map((t) => `<button class="btn left" data-act="reply4" data-i="${THANKS().indexOf(t)}" lang="ja">${esc(t.jp)}</button>`).join('')}`;
    }
    if (step === 'reply') {
      return `<p class="small strong dim">They're leaving. What does a shopkeeper say?</p>
        ${lines.map((i) => `<button class="btn left" data-act="reply" data-i="${i}" lang="ja">${esc(SHOP_THANKS[i])}</button>`).join('')}`;
    }
    const c = COUNTERS[item.counter];
    return `<div class="panel stack-sm">
        <p class="strong" lang="ja">${item.emoji} ${esc(item.name)} (${esc(item.en)}) × ${count} = ${esc(say(item, count))}</p>
        <p class="small dim">${esc(c.explanation)}</p>
        <p class="small dim">${esc(customer.styleNote)}</p>
      </div>
      <button class="btn primary wide" data-act="nextc">🧑 Next customer</button>`;
  }

  function greet(i) {
    const g = SHOP_GREETINGS[i];
    if (i === 0) {
      feedback = '✓ いらっしゃいませ is what every shop says to welcome customers.';
      if (!mistakes) store.log(true);
      store.grade({ skill: 'grammar', id: 'shop:greet', ok: true, firstTry: !mistakes });
      speaker.speak(g, { mps: 4.5, voice: 1 });
      step = 'fill';
      clearTimeout(orderTimer);
      orderTimer = setTimeout(sayOrder, 1400);
    } else {
      if (!mistakes) store.log(false);
      store.grade({ skill: 'grammar', id: 'shop:greet', ok: false, firstTry: !mistakes });
      mistakes++;
      feedback = `That's not a shop greeting. ${i === 1 ? 'おかえりなさい is "welcome home".' : 'いただきます is said before eating.'} Try again.`;
    }
    render();
    if (i === 0) fx.hit(); else fx.miss();
  }

  function handOver() {
    const right = basket.length === count && basket.every((b) => b === item);
    if (right) {
      feedback = `✓ Right: ${say(item, count)} ${item.name}.`;
      store.log(true);
      store.grade({ skill: 'counters', id: `${item.counter}:${count}`, ok: true, firstTry: !mistakes });
      if (!showText) store.grade({ skill: 'listening', id: `order:${item.name}`, ok: true, firstTry: !mistakes });
      step = 'reply';
      // N4: before they go, a request that needs the shop's polite words.
      const moments = content('keigo').filter((x) => rank(x) <= rank(customer));
      if (n4() && moments.length) {
        const m = pickMixed(moments);
        keigo = { m, opts: shuffle(m.options) };
        step = 'keigo';
        setTimeout(() => speaker.speak(m.line.jp, { mps: 4, voice: m.who }), 900);
      } else lines = n4() ? shuffle(THANKS()) : shuffle(SHOP_THANKS.map((_, i) => i));
    } else {
      store.log(false);
      store.grade({ skill: 'counters', id: `${item.counter}:${count}`, ok: false, firstTry: !mistakes });
      if (!showText) store.grade({ skill: 'listening', id: `order:${item.name}`, ok: false, firstTry: !mistakes });
      mistakes++;
      feedback = `Hmm, they wanted ${item.name} × ${count} (${say(item, count)}). Listen again and fix the counter.`;
      basket = [];
      showText = true;
    }
    render();
    if (right) fx.hit(); else fx.miss();
  }

  function reply(i) {
    const t = SHOP_THANKS[i];
    if (i === 0) {
      feedback = '✓ ありがとうございました: the polite past-tense thanks shops use as customers leave.';
      speaker.speak(t, { mps: 4.5, voice: 1 });
      store.log(true);
      store.grade({ skill: 'grammar', id: 'shop:thanks', ok: true, firstTry: !mistakes });
      served++;
      if (mistakes === 0) perfect++;
      step = 'done';
      if (ctx.today) {
        ctx.today.report(`${Math.min(served, GOAL)}/${GOAL}`);
        if (served >= GOAL) ctx.today.done();
      }
    } else {
      store.log(false);
      store.grade({ skill: 'grammar', id: 'shop:thanks', ok: false, firstTry: !mistakes });
      mistakes++;
      feedback = i === 1
        ? 'じゃあね is a casual "see ya". Too casual for a shopkeeper with any customer.'
        : 'どういたしまして means "you\'re welcome". Here the shop should be thanking them.';
    }
    render();
    if (i === 0) fx.hit({ big: true }); else fx.miss();
  }

  /** N4: the shopkeeper's polite answer to a customer's request. */
  function answerKeigo(i) {
    const m = keigo.m;
    const ok = i === 0;
    if (!mistakes || ok) store.log(ok);
    store.grade({ skill: 'grammar', id: 'keigo:' + m.id, ok, firstTry: !mistakes });
    if (ok) {
      feedback = '✓ ' + m.why;
      speaker.speak(m.options[0].jp, { mps: 4.5, voice: 1 });
      step = 'reply';
      lines = shuffle(THANKS());
    } else {
      mistakes++;
      feedback = `Not quite: ${m.options[i].jp} doesn't fit here. ${m.why}`;
    }
    render();
    if (ok) fx.hit(); else fx.miss();
  }

  /** N4 greeting and thanks: the first in the data is the right one. */
  function lineN4(kind, i) {
    const list = kind === 'greet' ? GREETS() : THANKS();
    const ok = i === 0;
    if (!mistakes || ok) store.log(ok);
    store.grade({ skill: 'grammar', id: kind === 'greet' ? 'shop:greet4' : 'shop:thanks4', ok, firstTry: !mistakes });
    if (!ok) {
      mistakes++;
      feedback = `${list[i].jp}: ${list[i].en}. Not what a shop says here. Try again.`;
      render();
      fx.miss();
      return;
    }
    feedback = `✓ ${list[0].jp}: ${list[0].en}`;
    speaker.speak(list[0].jp, { mps: 4.5, voice: 1 });
    if (kind === 'greet') {
      step = 'fill';
      clearTimeout(orderTimer);
      orderTimer = setTimeout(sayOrder, 1400);
    } else {
      served++;
      if (mistakes === 0) perfect++;
      step = 'done';
      if (ctx.today) {
        ctx.today.report(`${Math.min(served, GOAL)}/${GOAL}`);
        if (served >= GOAL) ctx.today.done();
      }
    }
    render();
    fx.hit(kind === 'greet' ? undefined : { big: true });
  }

  function nextCustomer() {
    // About 70% of customers from the newest unlocked level (js/levels.js).
    customer = CUSTOMERS[pickMixed(content('customers')).key];
    item = pickMixed(stockFor(customer));
    keigo = null;
    // The choices on screen, shuffled: N4 and N3 lines, or N5 indexes (the right one is first in the data).
    lines = n4() ? shuffle(GREETS()) : shuffle(SHOP_GREETINGS.map((_, i) => i));
    count = 1 + Math.floor(Math.random() * 5);
    basket = [];
    feedback = null;
    mistakes = 0;
    // Start with text visible for the first few customers, then switch to listening only.
    showText = served < 3;
    step = 'greet';
    render();
  }

  const off = delegate(el, {
    hear: sayOrder,
    text: () => { showText = !showText; render(); },
    greet: (b) => greet(+b.dataset.i),
    greet4: (b) => lineN4('greet', +b.dataset.i),
    reply4: (b) => lineN4('thanks', +b.dataset.i),
    keigo: (b) => answerKeigo(+b.dataset.i),
    hearkeigo: () => keigo && speaker.speak(keigo.m.line.jp, { mps: 4, voice: keigo.m.who }),
    add: (b) => { if (basket.length < 5) { basket.push(SHOP_STOCK[+b.dataset.i]); render(); } },
    clear: () => { basket = []; render(); },
    hand: handOver,
    reply: (b) => reply(+b.dataset.i),
    nextc: nextCustomer,
  });

  store.markSession();
  if (ctx.today) ctx.today.report(`0/${GOAL}`);
  nextCustomer();
  return () => { off(); clearTimeout(orderTimer); speaker.stop(); };
}
