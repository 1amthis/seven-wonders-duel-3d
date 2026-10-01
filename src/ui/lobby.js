// The online lobby: host a duel (get a code and a link), join one (type the code or follow the link), or pick up a duel
// that was interrupted by a reload. Each opens a modal and resolves once two browsers are connected, or with null.
import { $ } from './dialogs.js';
import { Room, describeError } from '../net/room.js';
import { parseCode, cleanName, PROTOCOL } from '../net/protocol.js';

const SITE_URL = 'https://1amthis.github.io/seven-wonders-duel-3d/'; // what an invite points to when the game was opened from a file

/** The link that opens the game straight into "join this room". */
export const inviteUrl = code => `${/^https?:$/.test(location.protocol) ? location.origin + location.pathname : SITE_URL}?join=${code}`;

/** The name typed in the menu. "You" is the default, which means "nobody has typed anything yet". */
export const playerName = prefs => (prefs.name === 'You' ? '' : cleanName(prefs.name, ''));

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* insecure context or denied */ }
  try {
    const t = $('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = 0; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}

const helloFor = name => () => ({ t: 'hello', v: PROTOCOL, name });

/**
 * @param join a room code taken from an invite link: opens straight on the "join" screen
 * @returns {Promise<null | {room, role:'host', hello:{name}} | {room, role:'guest', start}>}
 */
export function openLobby(dialogs, prefs, { join = null } = {}) {
  return new Promise(resolve => {
    const p = $('div', 'panel lobby');
    let room = null, done = false, m;
    const finish = res => {
      if (done) return; done = true;
      if (res) room.off(); else room?.close();
      dialogs._close(m); resolve(res);
    };
    m = dialogs._open(p, { esc: () => finish(null) });
    const screen = (title, ...nodes) => { p.innerHTML = ''; p.appendChild($('h2', '', title)); nodes.forEach(n => n && p.appendChild(n)); };
    const buttons = (...bs) => { const r = $('div', 'row'); r.append(...bs); return r; };
    const btn = (text, onclick, cls = '') => { const b = $('button', 'btn ' + cls, text); b.onclick = () => { dialogs.click(); onclick(b); }; return b; };
    const note = (html, cls = '') => $('p', 'lobby-note ' + cls, html);
    const back = () => btn('Back', () => finish(null), 'ghost');

    // the player's name, shared by every screen
    const nameField = () => {
      const input = $('input'); input.type = 'text'; input.maxLength = 14; input.placeholder = 'Your name'; input.value = playerName(prefs); input.autocomplete = 'nickname';
      const l = $('label', '', 'Your name'); l.htmlFor = input.id = 'lobby-name';
      const opts = $('div', 'opts'); opts.append(l, input);
      return { opts, input };
    };

    // ---------------------------------------------------------------- first screen: host or join
    function choose() {
      const nf = nameField();
      const host = btn('Host a duel', () => hostRoom(nf.input), 'big'), joinB = btn('Join a duel', () => joinRoom(''), 'ghost');
      const sync = () => { const ok = !!cleanName(nf.input.value, ''); host.disabled = joinB.disabled = !ok; prefs.name = cleanName(nf.input.value, '') || 'You'; };
      nf.input.oninput = sync; sync();
      screen('Play online', note('Play a friend on another computer, tablet or phone. No account needed: one of you hosts and shares a short code, the other joins with it.'), nf.opts, buttons(host, joinB, back()), $('div', 'fine', 'Your browsers connect directly to each other. A free public matchmaking service (PeerJS) only introduces them and never sees your moves.'));
      setTimeout(() => { if (!nf.input.value) nf.input.focus(); }, 50);
    }

    // ---------------------------------------------------------------- host
    async function hostRoom(nameInput) {
      prefs.name = cleanName(nameInput.value, '') || 'You';
      screen('Host a duel', note('Opening your room…', 'wait'));
      try { room = await Room.host(); } catch (e) { return problem(describeError(e), () => hostRoom(nameInput)); }
      if (done) { room.close(); return; }
      const url = inviteUrl(room.code);
      const code = $('div', 'code-big', room.code.split('').map(c => `<span>${c}</span>`).join(''));
      code.setAttribute('aria-label', 'Room code ' + room.code.split('').join(' '));
      const copy = (what, text) => btn('Copy ' + what, async b => { const ok = await copyText(text); b.textContent = ok ? 'Copied ✓' : 'Press Ctrl+C'; setTimeout(() => { b.textContent = 'Copy ' + what; }, 1800); }, 'ghost');
      const link = $('div', 'invite-link', url);
      const row = buttons(copy('link', url), copy('code', room.code));
      if (navigator.share) row.appendChild(btn('Share…', () => navigator.share({ title: 'Seven Wonders Duel 3D', text: `Duel me at Seven Wonders Duel! Room code: ${room.code}`, url }).catch(() => {}), 'ghost'));
      screen('Host a duel', note('Send this link to your friend, or give them the code:'), code, link, row, note('Waiting for your friend to join…', 'wait'), buttons(btn('Cancel', () => finish(null), 'ghost')));
      room.on('msg', msg => { if (msg.t === 'hello') finish({ room, role: 'host', hello: { name: cleanName(msg.name, 'Guest') } }); });
    }

    // ---------------------------------------------------------------- join
    function joinRoom(codeText, error = '') {
      const nf = nameField();
      const code = $('input'); code.type = 'text'; code.placeholder = 'K7QF2'; code.value = codeText; code.maxLength = 120; code.autocapitalize = 'characters'; code.spellcheck = false; code.className = 'code-input'; code.setAttribute('autocomplete', 'off');
      const cl = $('label', '', 'Room code'); cl.htmlFor = code.id = 'lobby-code';
      nf.opts.append(cl, code);
      const go = btn('Join', () => connect(), 'big');
      const sync = () => { go.disabled = !(cleanName(nf.input.value, '') && parseCode(code.value)); prefs.name = cleanName(nf.input.value, '') || 'You'; };
      nf.input.oninput = code.oninput = sync; sync();
      code.onkeydown = nf.input.onkeydown = e => { if (e.key === 'Enter' && !go.disabled) go.click(); };
      screen('Join a duel', note('Type the room code your friend gave you, or paste their link.'), nf.opts, error ? note(error, 'err') : null, buttons(go, btn('Back', () => { choose(); }, 'ghost')));
      setTimeout(() => (!nf.input.value ? nf.input : code).focus(), 50);

      async function connect() {
        const cc = parseCode(code.value), name = cleanName(nf.input.value, 'Guest');
        prefs.name = name;
        screen('Join a duel', note(`Connecting to room ${cc}…`, 'wait'), buttons(btn('Cancel', () => finish(null), 'ghost')));
        try { room = await Room.join(cc, { hello: helloFor(name) }); } catch (e) { room = null; return joinRoom(cc, describeError(e)); }
        if (done) { room.close(); return; }
        let timer = setTimeout(() => { room.close(); room = null; joinRoom(cc, 'The host did not start the duel. Ask them to try again.'); }, 15000);
        room.on('busy', () => { clearTimeout(timer); room.close(); room = null; joinRoom(cc, 'That duel already has two players.'); });
        room.on('msg', msg => { if (msg.t === 'start') { clearTimeout(timer); finish({ room, role: 'guest', start: msg }); } });
        screen('Join a duel', note('Connected! Waiting for the host to start…', 'wait'), buttons(btn('Cancel', () => { clearTimeout(timer); finish(null); }, 'ghost')));
      }
    }

    function problem(text, retry) {
      screen('Online duel', note(text, 'err'), buttons(btn('Try again', retry), back()));
    }

    if (join) joinRoom(join); else choose();
  });
}

/**
 * Reopen a duel saved by this tab (see Online.persist). Hosts take their room code back; guests dial it again, and keep
 * dialling while the host is away.
 * @returns {Promise<null | {room, role:'host'} | {room, role:'guest', start}>}
 */
export function resumeLobby(dialogs, prefs, saved) {
  return new Promise(resolve => {
    const p = $('div', 'panel lobby');
    let room = null, done = false, retry = null, m;
    const finish = res => {
      if (done) return; done = true; clearTimeout(retry);
      if (res) room?.off(); else room?.close();
      dialogs._close(m); resolve(res);
    };
    m = dialogs._open(p);
    const show = (text, cls, ...bs) => { p.innerHTML = ''; p.appendChild($('h2', '', 'Resuming your duel')); p.appendChild($('p', 'lobby-note ' + cls, text)); const r = $('div', 'row'); r.append(...bs); p.appendChild(r); };
    const forget = () => { const b = $('button', 'btn ghost', 'Forget this duel'); b.onclick = () => { dialogs.click(); finish(null); }; return b; };

    async function hostAgain() {
      show(`Reopening room ${saved.code}…`, 'wait', forget());
      try { room = await Room.host({ code: saved.code }); } catch (e) {
        if (done) return;
        const again = $('button', 'btn', 'Try again'); again.onclick = () => { dialogs.click(); hostAgain(); };
        return show(describeError(e), 'err', again, forget());
      }
      if (done) { room.close(); return; }
      finish({ room, role: 'host' });
    }
    async function guestAgain() {
      show(`Reconnecting to room ${saved.code}…`, 'wait', forget());
      try { room = await Room.join(saved.code, { hello: helloFor(cleanName(saved.name, 'Guest')) }); } catch {
        room = null;
        if (!done) { show(`Waiting for the host to come back to room ${saved.code}…`, 'wait', forget()); retry = setTimeout(guestAgain, 3000); }
        return;
      }
      if (done) { room.close(); return; }
      room.on('msg', msg => { if (msg.t === 'start') finish({ room, role: 'guest', start: msg }); });
      room.on('busy', () => { room.close(); room = null; show(`Waiting for the host to come back to room ${saved.code}…`, 'wait', forget()); retry = setTimeout(guestAgain, 3000); });
    }
    if (saved.role === 'host') hostAgain(); else guestAgain();
  });
}
