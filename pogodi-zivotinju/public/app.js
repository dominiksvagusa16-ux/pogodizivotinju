(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const socket = typeof io === 'function' ? io() : null;
  let catalog = [];
  let mode = 'create';
  let activeCode = null;
  let activeToken = null;
  let displayName = null;
  let state = null;
  let lastMessageKeys = '';
  let toastTimer;

  const normalize = (text) => String(text || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('hr').trim();

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
  }

  function inviteUrl(code) {
    return `${location.origin}${location.pathname}?soba=${encodeURIComponent(code)}`;
  }

  function remember(code, token, name) {
    activeCode = code;
    activeToken = token;
    displayName = name;
    sessionStorage.setItem(`divlja_igra_${code}`, JSON.stringify({ token, name }));
    try { localStorage.setItem('divlja_igra_name', name); } catch (_) { /* private mode */ }
    history.replaceState({}, '', `?soba=${encodeURIComponent(code)}`);
  }

  function clearRoom() {
    if (activeCode) sessionStorage.removeItem(`divlja_igra_${activeCode}`);
    activeCode = null;
    activeToken = null;
    state = null;
    lastMessageKeys = '';
    history.replaceState({}, '', location.pathname);
    $('landing').hidden = false;
    $('game').hidden = true;
    setMode('create');
  }

  function setMode(next) {
    mode = next;
    const create = mode === 'create';
    $('tab-create').classList.toggle('active', create);
    $('tab-join').classList.toggle('active', !create);
    $('tab-create').setAttribute('aria-selected', String(create));
    $('tab-join').setAttribute('aria-selected', String(!create));
    $('join-field').hidden = create;
    $('join-code').required = !create;
    $('entry-submit-label').textContent = create ? 'Napravi sobu' : 'Pridruži se sobi';
  }

  function send(eventName, payload, onSuccess, onFailure) {
    if (!socket || !socket.connected) {
      toast('Nema veze sa serverom. Provjeri internet i pokušaj ponovno.');
      if (onFailure) onFailure();
      return;
    }
    socket.timeout(8000).emit(eventName, payload, (error, response) => {
      if (error || !response || !response.ok) {
        toast(error || !response ? 'Server ne odgovara. Pokušaj ponovno.' : (response.error || 'Nešto je pošlo po zlu.'));
        if (onFailure) onFailure();
        return;
      }
      if (onSuccess) onSuccess(response);
    });
  }

  function showGame() {
    const firstOpen = $('game').hidden;
    $('landing').hidden = true;
    $('game').hidden = false;
    if (firstOpen) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function makePicker(inputId, resultsId, onChoice) {
    const input = $(inputId);
    const results = $(resultsId);
    let chosen = null;
    let shown = [];

    function select(animal, keepOpen = false) {
      chosen = animal;
      input.value = animal ? animal.name : '';
      results.hidden = !keepOpen;
      input.setAttribute('aria-expanded', String(keepOpen));
      onChoice(chosen);
    }

    function hide() {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }

    function renderOptions() {
      const query = normalize(input.value);
      shown = catalog.filter((animal) => !query || normalize(animal.name).includes(query) || normalize(animal.id).includes(query)).slice(0, 8);
      results.replaceChildren();
      if (!shown.length) {
        const empty = document.createElement('div');
        empty.className = 'picker-none';
        empty.textContent = 'Nema te životinje u bazi. Pokušaj s drugom.';
        results.append(empty);
      }
      for (const animal of shown) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'picker-option';
        button.setAttribute('role', 'option');
        const em = document.createElement('span');
        em.className = 'option-emoji';
        em.textContent = animal.emoji;
        const content = document.createElement('span');
        content.className = 'option-text';
        const name = document.createElement('strong');
        name.textContent = animal.name;
        const group = document.createElement('small');
        group.textContent = animal.group;
        content.append(name, group);
        button.append(em, content);
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', () => { select(animal); input.focus(); });
        results.append(button);
      }
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('focus', renderOptions);
    input.addEventListener('input', () => {
      chosen = catalog.find((a) => normalize(a.name) === normalize(input.value) || normalize(a.id) === normalize(input.value)) || null;
      onChoice(chosen);
      renderOptions();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
      if (e.key === 'Enter' && !results.hidden && shown.length) {
        e.preventDefault();
        select(shown[0]);
      }
    });
    document.addEventListener('click', (e) => {
      if (e.target !== input && !results.contains(e.target)) hide();
    });
    return {
      get value() { return chosen; },
      reset() { chosen = null; input.value = ''; hide(); onChoice(null); }
    };
  }

  const choosePicker = makePicker('choose-search', 'choose-results', (a) => { $('choose-submit').disabled = !a; });
  const guessPicker = makePicker('guess-search', 'guess-results', (a) => {
    $('guess-submit').disabled = !a || !state || state.phase !== 'playing' || state.players.some((p) => !p.connected);
  });

  function addTextNode(parent, tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function renderPlayers(room) {
    const box = $('players');
    box.replaceChildren();
    for (let index = 0; index < 2; index++) {
      const player = room.players[index];
      const card = document.createElement('div');
      card.className = `player-card${player && !player.connected ? ' offline' : ''}`;
      const head = addTextNode(card, 'div', 'player-head', '');
      addTextNode(head, 'div', 'player-avatar', index === 0 ? '🦊' : '🐼');
      addTextNode(head, 'span', 'player-score', player ? `${player.score} 🏆` : '—');
      addTextNode(card, 'div', 'player-name', player ? `${player.name}${player.id === room.me.id ? ' (ti)' : ''}` : 'Čekamo...');
      let status = 'Slobodno mjesto';
      if (player) status = !player.connected ? '○ Nije online' : player.picked ? '✓ Odabrano' : '● Online';
      addTextNode(card, 'div', 'player-status', status);
      box.append(card);
    }
    const other = room.players.find((p) => p.id !== room.me.id);
    $('players-caption').textContent = !other
      ? 'Pošalji link drugoj osobi da vam se pridruži.'
      : !other.connected ? 'Druga osoba je offline. Čekamo povratak...'
      : room.phase === 'finished' ? 'Runda je završena. Spremni za revanš?'
      : room.phase === 'playing' ? 'Oboje ste izabrali. Pogađanje traje!'
      : 'Odaberite svoje životinje da igra počne.';
  }

  function renderFacts(animal) {
    $('choose-section').hidden = Boolean(animal);
    $('facts-section').hidden = !animal;
    if (!animal) return;
    $('animal-emoji').textContent = animal.emoji;
    $('animal-name').textContent = animal.name;
    $('animal-group').textContent = animal.group;
    $('fact-habitat').textContent = animal.habitat;
    $('fact-diet').textContent = animal.diet;
    const facts = $('fact-list');
    facts.replaceChildren();
    for (const fact of animal.facts) addTextNode(facts, 'li', '', fact);
  }

  function renderMessages(room) {
    const messages = room.messages || [];
    const key = messages.map((m) => m.id).join(';');
    if (lastMessageKeys === key) return;
    lastMessageKeys = key;
    const body = $('chat-messages');
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 100;
    body.replaceChildren();
    if (!messages.length) {
      const empty = addTextNode(body, 'div', 'empty-chat', '');
      addTextNode(empty, 'span', '', '💬');
      addTextNode(empty, 'strong', '', 'Ovdje počinje vaša priča.');
      addTextNode(empty, 'p', '', 'Pošaljite prvo pitanje!');
    }
    for (const message of messages) {
      if (message.kind === 'system') {
        addTextNode(body, 'div', 'system-message', message.text);
      } else if (message.kind === 'chat') {
        const mine = message.playerId === room.me.id;
        const item = addTextNode(body, 'div', `chat-item${mine ? ' mine' : ''}`, '');
        addTextNode(item, 'div', 'chat-meta', mine ? 'TI' : message.sender);
        addTextNode(item, 'div', 'chat-bubble', message.text);
      } else {
        addTextNode(body, 'div', `special-message${message.kind === 'win' ? ' win' : ''}`, message.text);
      }
    }
    if (atBottom) requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  }

  function renderState(newState) {
    const previous = state;
    state = newState;
    showGame();
    $('room-code').textContent = state.code;
    $('round-label').textContent = `RUNDA ${String(state.round).padStart(2, '0')}`;
    const other = state.players.find((p) => p.id !== state.me.id);
    const active = state.phase === 'playing';
    $('phase-pill').textContent = state.phase === 'choosing' ? 'PRIPREMA' : active ? 'U TIJEKU' : 'GOTOVO';
    $('phase-pill').className = `phase-pill ${state.phase}`;
    if (state.phase === 'choosing') {
      $('phase-explainer').textContent = !other ? 'Čekamo drugog igrača. Pošalji link!' : state.me.animal ? 'Tvoja tajna je sigurna. Čekamo drugu osobu.' : 'Odaberi svoju tajnu životinju.';
    } else if (state.phase === 'playing') {
      $('phase-explainer').textContent = other?.connected ? 'Pitaj, odgovaraj i probaj pogoditi prvi!' : 'Druga osoba se trenutno ponovno spaja.';
    } else $('phase-explainer').textContent = 'Runda gotova! Vrijeme je za revanš.';
    if (previous && previous.round !== state.round) {
      choosePicker.reset();
      guessPicker.reset();
    }
    renderPlayers(state);
    renderFacts(state.me.animal);
    renderMessages(state);
    $('guess-area').hidden = !active;
    $('guess-submit').disabled = !guessPicker.value || !active || !other?.connected;
    $('winner-panel').hidden = state.phase !== 'finished';
    if (state.phase === 'finished') {
      const winner = state.players.find((p) => p.id === state.winnerId);
      $('winner-title').textContent = winner?.id === state.me.id ? 'Bravo, pogodio/la si! 🏆' : `${winner?.name || 'Druga osoba'} je pobijedio/la!`;
      const otherName = other?.revealedAnimal || '?';
      $('winner-description').textContent = `Tvoja životinja: ${state.me.animal?.name || '?'} · Partnerova životinja: ${otherName}. Rezultat se čuva dok ste u istoj sobi.`;
    }
  }

  async function loadAnimals() {
    try {
      const response = await fetch('/api/animals');
      if (!response.ok) throw new Error('API error');
      catalog = await response.json();
      document.querySelector('.entry-bottom').innerHTML = `<span class="entry-check">✓</span> Besplatno <span>·</span> ${catalog.length} životinje <span>·</span> Igra uživo`;
    } catch (_) { toast('Nije moguće učitati životinje. Osvježi stranicu.'); }
  }

  function sendChat(text) {
    const cleaned = text.trim();
    if (!cleaned) return;
    send('message:send', { text: cleaned }, () => { $('chat-input').value = ''; });
  }

  $('tab-create').addEventListener('click', () => setMode('create'));
  $('tab-join').addEventListener('click', () => setMode('join'));
  $('entry-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('nickname').value.trim();
    if (name.length < 2) return toast('Upiši ime od najmanje dva znaka.');
    const button = $('entry-submit');
    button.disabled = true;
    if (mode === 'create') {
      send('room:create', { name }, (res) => { remember(res.code, res.token, name); showGame(); button.disabled = false; }, () => { button.disabled = false; });
    } else {
      const code = $('join-code').value.trim().toUpperCase();
      if (code.length !== 6) { button.disabled = false; return toast('Kod sobe ima 6 znakova.'); }
      const old = (() => { try { return JSON.parse(sessionStorage.getItem(`divlja_igra_${code}`)); } catch (_) { return null; } })();
      send('room:join', { code, name, token: old?.token }, (res) => { remember(res.code, res.token, name); showGame(); button.disabled = false; }, () => { button.disabled = false; });
    }
    setTimeout(() => { button.disabled = false; }, 9000);
  });
  $('choose-submit').addEventListener('click', () => {
    if (!choosePicker.value) return toast('Prvo odaberi životinju s popisa.');
    send('player:choose', { animalId: choosePicker.value.id }, () => { choosePicker.reset(); });
  });
  $('guess-submit').addEventListener('click', () => {
    if (!guessPicker.value) return toast('Odaberi životinju s popisa.');
    send('guess:submit', { animalId: guessPicker.value.id }, (res) => {
      guessPicker.reset();
      if (!res.correct) toast('Nije točno, pokušaj ponovno! 🕵️');
    });
  });
  $('chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('chat-input').value;
    sendChat(text);
  });
  document.querySelectorAll('#question-chips button').forEach((button) => button.addEventListener('click', () => sendChat(button.dataset.text)));
  $('play-again').addEventListener('click', () => send('round:restart', {}, () => {}));
  $('copy-link').addEventListener('click', async () => {
    if (!activeCode) return;
    const url = inviteUrl(activeCode);
    try {
      await navigator.clipboard.writeText(url);
      toast('Pozivni link kopiran! Pošalji ga svojoj curi. 💚');
    } catch (_) {
      window.prompt('Kopiraj ovaj link:', url);
    }
  });
  $('leave-room').addEventListener('click', () => {
    if (!confirm('Želiš napustiti sobu? Za povratak će trebati novi poziv.')) return;
    send('room:leave', {}, () => { clearRoom(); toast('Napustio/la si sobu.'); });
  });

  const fromUrl = new URLSearchParams(location.search).get('soba');
  if (fromUrl && /^[A-Z2-9]{6}$/i.test(fromUrl)) {
    const code = fromUrl.toUpperCase();
    $('join-code').value = code;
    setMode('join');
    try {
      const saved = JSON.parse(sessionStorage.getItem(`divlja_igra_${code}`));
      if (saved?.token && saved?.name) {
        activeCode = code;
        activeToken = saved.token;
        displayName = saved.name;
      }
    } catch (_) { /* new guest */ }
  }
  try { $('nickname').value = displayName || localStorage.getItem('divlja_igra_name') || ''; } catch (_) { /* private mode */ }

  if (socket) {
    socket.on('connect', () => {
      if (activeCode && activeToken && displayName) {
        send('room:join', { code: activeCode, name: displayName, token: activeToken }, () => {});
      }
    });
    socket.on('room:state', renderState);
    socket.on('room:replaced', () => { clearRoom(); toast('Soba je otvorena u drugoj kartici preglednika.'); });
    socket.on('disconnect', () => { if (activeCode) toast('Veza je prekinuta. Pokušavam se ponovno povezati...'); });
  } else {
    toast('Server igre nije pokrenut. Za online igru pokreni Node.js aplikaciju.');
  }
  loadAnimals();
})();
