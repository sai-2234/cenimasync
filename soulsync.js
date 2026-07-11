// ============================================================
// SoulSync — Main Application Script (v2.0 redesign)
// ------------------------------------------------------------
// UI redesigned; Firebase logic UNCHANGED.
// ============================================================

import {
    auth, db, storage,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    signOut,
    updateProfile,
    collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    addDoc, query, where, orderBy, limit, onSnapshot,
    serverTimestamp, arrayUnion,
    storageRef, uploadBytesResumable, getDownloadURL
} from './firebase.js';

/* ================================================================
   0. Global state
   ================================================================ */
const state = {
    user: null,
    profile: null,
    chats: [],
    chatsUnsub: null,
    currentChatId: null,
    currentPeer: null,
    messagesUnsub: null,
    peerUnsub: null,
    typingUnsub: null,
    typingTimeout: null,
    lastTypingSent: 0,
    isRecording: false,
    mediaRecorder: null,
    recordChunks: [],
    recordStart: 0,
    recordTimer: null,
    recordCancel: false,
    recordStartX: 0,
    editingMsgId: null,
    ctxMsg: null,
    unreadCounts: new Map()   // chatId -> last unread count (client-side estimate)
};

const TAGLINES = [
    "Every conversation begins with a hello.",
    "Stay close, wherever life takes you.",
    "Private conversations. Beautifully designed.",
    "Made for meaningful conversations.",
    "Your conversations begin here.",
    "Some moments deserve a better place to live."
];

/* ================================================================
   1. Screen management
   ================================================================ */
const screens = {
    splash:   document.getElementById('splash-screen'),
    auth:     document.getElementById('auth-screen'),
    welcome:  document.getElementById('welcome-screen'),
    home:     document.getElementById('home-screen')
};
function showScreen(name){
    Object.entries(screens).forEach(([k, el])=>{
        if (k === name) el.classList.add('active');
        else el.classList.remove('active');
    });
    const canvas = document.getElementById('particle-canvas');
    if (name === 'home')          canvas.classList.add('off');
    else if (name === 'welcome')  { canvas.classList.remove('off'); canvas.classList.add('dim'); }
    else                          { canvas.classList.remove('off','dim'); }
}

/* ================================================================
   2. Particle system
   ================================================================ */
const Particles = (() => {
    const canvas = document.getElementById('particle-canvas');
    const ctx = canvas.getContext('2d', { alpha:true });
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles = [];
    let mouse = { x:-1000, y:-1000, active:false };
    let bursts = [];
    const BASE_COUNT = 70;

    function resize(){
        w = window.innerWidth; h = window.innerHeight;
        canvas.width  = w * dpr; canvas.height = h * dpr;
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function spawn(count){
        particles = [];
        for (let i = 0; i < count; i++) particles.push(makeParticle());
    }
    function makeParticle(x, y){
        return {
            x: x ?? Math.random()*w,
            y: y ?? Math.random()*h,
            r: Math.random()*1.6 + 0.5,
            vx: (Math.random()-0.5)*0.22,
            vy: (Math.random()-0.5)*0.22,
            a:  Math.random()*0.45 + 0.2,
            hue: 190 + Math.random()*30
        };
    }
    function burstAt(x, y, n = 22){
        for (let i = 0; i < n; i++){
            const angle = (Math.PI * 2) * (i / n) + Math.random()*0.4;
            const speed = Math.random()*3.5 + 1.4;
            bursts.push({
                x, y,
                vx: Math.cos(angle)*speed,
                vy: Math.sin(angle)*speed,
                r:  Math.random()*2.2 + 1.2,
                life: 1
            });
        }
    }
    function step(){
        ctx.clearRect(0, 0, w, h);
        for (const p of particles){
            if (mouse.active){
                const dx = mouse.x - p.x, dy = mouse.y - p.y;
                const d2 = dx*dx + dy*dy;
                if (d2 < 22000){ p.vx += dx * 0.00002; p.vy += dy * 0.00002; }
            }
            p.x += p.vx; p.y += p.vy;
            p.vx *= 0.985; p.vy *= 0.985;
            if (p.x < -10) p.x = w + 10;
            if (p.x > w + 10) p.x = -10;
            if (p.y < -10) p.y = h + 10;
            if (p.y > h + 10) p.y = -10;
            const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r*6);
            grd.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${p.a})`);
            grd.addColorStop(1, `hsla(${p.hue}, 100%, 70%, 0)`);
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r*6, 0, Math.PI*2);
            ctx.fill();
        }
        bursts = bursts.filter(b => b.life > 0);
        for (const b of bursts){
            b.x += b.vx; b.y += b.vy;
            b.vx *= 0.94; b.vy *= 0.94;
            b.life -= 0.016;
            const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r*9);
            grd.addColorStop(0, `hsla(195, 100%, 72%, ${Math.max(b.life, 0)})`);
            grd.addColorStop(1, `hsla(195, 100%, 72%, 0)`);
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r*9, 0, Math.PI*2);
            ctx.fill();
        }
        requestAnimationFrame(step);
    }
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
    window.addEventListener('mouseleave', () => { mouse.active = false; });
    window.addEventListener('touchstart', e => {
        for (const t of e.touches) burstAt(t.clientX, t.clientY);
    }, { passive:true });
    window.addEventListener('touchmove', e => {
        if (Math.random() < 0.15){
            const t = e.touches[0];
            if (t) burstAt(t.clientX, t.clientY, 6);
        }
    }, { passive:true });

    function swirlTo(x, y){
        for (const p of particles){
            const dx = x - p.x, dy = y - p.y;
            p.vx += dx * 0.002; p.vy += dy * 0.002;
        }
    }

    resize();
    spawn(BASE_COUNT);
    step();
    return { burstAt, swirlTo };
})();

/* ================================================================
   3. Ripple effect (attach to any .ripple element)
   ================================================================ */
function attachRipples(){
    document.addEventListener('pointerdown', (e) => {
        const el = e.target.closest('.ripple');
        if (!el || el.disabled) return;
        const rect = el.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const ink = document.createElement('span');
        ink.className = 'ripple-ink';
        ink.style.width = ink.style.height = size + 'px';
        ink.style.left = (e.clientX - rect.left - size/2) + 'px';
        ink.style.top  = (e.clientY - rect.top  - size/2) + 'px';
        el.appendChild(ink);
        setTimeout(() => ink.remove(), 620);
    }, { passive:true });
}

/* ================================================================
   4. Toast helper
   ================================================================ */
function toast(msg, type = ''){
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3900);
}

/* ================================================================
   5. Small DOM helpers
   ================================================================ */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function escapeHTML(str = ''){
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function initials(name = '?'){
    const parts = name.trim().split(/\s+/);
    const s = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
    return s.toUpperCase() || '?';
}
function paintAvatar(el, profile){
    if (!el) return;
    el.textContent = '';
    if (profile?.photoURL){
        el.style.backgroundImage = `url("${profile.photoURL}")`;
    } else {
        el.style.backgroundImage = '';
        el.textContent = initials(profile?.displayName || profile?.username || '?');
    }
}
function fmtTime(ts){
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    const diffDays = (now - d) / 86400000;
    if (diffDays < 7) return d.toLocaleDateString([], { weekday:'short' });
    return d.toLocaleDateString([], { month:'short', day:'numeric' });
}
function fmtDay(ts){
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month:'long', day:'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
function chatIdOf(a, b){ return [a, b].sort().join('__'); }

/* ================================================================
   6. Splash sequence
   ================================================================ */
function startSplash(){
    $('#splash-tagline').textContent = TAGLINES[Math.floor(Math.random()*TAGLINES.length)];
    setTimeout(() => {
        const logo = $('#splash-logo');
        const rect = logo.getBoundingClientRect();
        Particles.swirlTo(rect.left + rect.width/2, rect.top + rect.height/2);
        setTimeout(afterSplash, 700);
    }, 3000);
}
let splashDone = false;
let pendingAuthUser = undefined;
function afterSplash(){ splashDone = true; resolveInitialRoute(); }
function resolveInitialRoute(){
    if (!splashDone) return;
    if (pendingAuthUser === undefined) return;
    if (pendingAuthUser) showScreen('home');
    else showScreen('auth');
}

/* ================================================================
   7. Authentication UI
   ================================================================ */
function initAuthUI(){
    $$('[data-goto]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-goto');
            $$('.auth-card').forEach(c => c.classList.add('hidden'));
            $('#' + target).classList.remove('hidden');
            $$('[data-error]').forEach(el => el.textContent = '');
            $$('[data-success]').forEach(el => el.textContent = '');
        });
    });

    $('#form-login').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const err = e.target.querySelector('[data-error]');
        err.textContent = ''; btn.disabled = true;
        try{
            const data = new FormData(e.target);
            await signInWithEmailAndPassword(auth, data.get('email').trim(), data.get('password'));
        } catch(ex){ err.textContent = niceAuthError(ex); }
        finally { btn.disabled = false; }
    });

    $('#form-signup').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const err = e.target.querySelector('[data-error]');
        err.textContent = ''; btn.disabled = true;
        try{
            const data = new FormData(e.target);
            const displayName = data.get('displayName').trim();
            const username    = data.get('username').trim().toLowerCase();
            const email       = data.get('email').trim();
            const password    = data.get('password');

            if (!/^[a-zA-Z0-9_\.]{3,20}$/.test(username)){
                throw new Error('Username must be 3–20 characters (letters, numbers, underscore, dot).');
            }
            const q = query(collection(db, 'users'), where('usernameLower', '==', username), limit(1));
            const existing = await getDocs(q);
            if (!existing.empty) throw new Error('That username is already taken.');

            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(cred.user, { displayName });

            const profile = {
                uid: cred.user.uid,
                email,
                displayName,
                username,
                usernameLower: username,
                bio: '',
                photoURL: '',
                createdAt: serverTimestamp(),
                lastSeen: serverTimestamp(),
                online: true,
                firstLogin: true
            };
            await setDoc(doc(db, 'users', cred.user.uid), profile);
        } catch(ex){ err.textContent = niceAuthError(ex); }
        finally { btn.disabled = false; }
    });

    $('#form-forgot').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const err = e.target.querySelector('[data-error]');
        const ok  = e.target.querySelector('[data-success]');
        err.textContent = ''; ok.textContent = ''; btn.disabled = true;
        try{
            const data = new FormData(e.target);
            await sendPasswordResetEmail(auth, data.get('email').trim());
            ok.textContent = 'Recovery email sent. Check your inbox.';
        } catch(ex){ err.textContent = niceAuthError(ex); }
        finally { btn.disabled = false; }
    });
}
function niceAuthError(ex){
    const c = ex?.code || '';
    if (c.includes('user-not-found'))         return 'No account with that email.';
    if (c.includes('wrong-password'))         return 'Incorrect password.';
    if (c.includes('invalid-credential'))     return 'Invalid email or password.';
    if (c.includes('email-already-in-use'))   return 'That email is already registered.';
    if (c.includes('weak-password'))          return 'Password should be at least 6 characters.';
    if (c.includes('invalid-email'))          return 'Please enter a valid email.';
    if (c.includes('too-many-requests'))      return 'Too many attempts. Try again shortly.';
    if (c.includes('network-request-failed')) return 'Network error. Check your connection.';
    return ex?.message || 'Something went wrong.';
}

/* ================================================================
   8. Auth state observer
   ================================================================ */
onAuthStateChanged(auth, async (user) => {
    pendingAuthUser = user;
    if (!user){
        teardown();
        state.user = null; state.profile = null;
        if (splashDone) showScreen('auth'); else resolveInitialRoute();
        return;
    }
    state.user = user;
    try{
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()){
            state.profile = snap.data();
        } else {
            state.profile = {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName || 'SoulSync User',
                username: (user.email||'user').split('@')[0].toLowerCase(),
                usernameLower: (user.email||'user').split('@')[0].toLowerCase(),
                bio: '',
                photoURL: user.photoURL || '',
                createdAt: serverTimestamp(),
                firstLogin: true
            };
            await setDoc(doc(db, 'users', user.uid), state.profile);
        }
        updateDoc(doc(db, 'users', user.uid), {
            online: true, lastSeen: serverTimestamp()
        }).catch(()=>{});

        if (state.profile.firstLogin){
            await showWelcomeThenHome();
            updateDoc(doc(db, 'users', user.uid), { firstLogin:false }).catch(()=>{});
        } else {
            if (splashDone) enterHome();
            else resolveInitialRoute();
        }
    } catch(ex){
        console.error('Failed to load profile', ex);
        toast('Failed to load profile', 'error');
    }
});
window.addEventListener('beforeunload', () => {
    if (state.user){
        updateDoc(doc(db, 'users', state.user.uid), {
            online:false, lastSeen: serverTimestamp()
        }).catch(()=>{});
    }
});

/* ================================================================
   9. Welcome screen
   ================================================================ */
function showWelcomeThenHome(){
    return new Promise(resolve => {
        $('#welcome-hi').textContent  = `Welcome, ${state.profile.displayName}.`;
        $('#welcome-sub').textContent = 'Your conversations begin here.';
        showScreen('welcome');
        setTimeout(() => { enterHome(); resolve(); }, 2600);
    });
}

/* ================================================================
   10. Home screen
   ================================================================ */
function enterHome(){
    paintAvatar($('#sidebar-avatar') || document.createElement('div'), state.profile); // legacy safety
    // Settings identity card
    if ($('#settings-avatar')) paintAvatar($('#settings-avatar'), state.profile);
    if ($('#settings-name'))     $('#settings-name').textContent     = state.profile.displayName || '—';
    if ($('#settings-username')) $('#settings-username').textContent = '@' + (state.profile.username || '—');
    showScreen('home');
    subscribeChats();
}

/* ================================================================
   11. Floating bottom nav wiring
   ================================================================ */
function initFloatingNav(){
    const nav = $('#floating-nav');
    if (!nav) return;
    const indicator = nav.querySelector('.nav-indicator');
    const buttons = $$('.nav-btn', nav);

    function positionIndicator(btn){
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        indicator.style.width = rect.width + 'px';
        indicator.style.transform = `translateX(${rect.left - navRect.left - 8}px)`;
    }
    requestAnimationFrame(() => positionIndicator(nav.querySelector('.nav-btn.active')));
    window.addEventListener('resize', () => positionIndicator(nav.querySelector('.nav-btn.active')));

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.nav;
            buttons.forEach(b => b.classList.toggle('active', b === btn));
            positionIndicator(btn);
            if      (target === 'new')      $('#btn-new-chat').click();
            else if (target === 'profile')  renderProfileModal();
            else if (target === 'settings') openModal('modal-settings');
            else if (target === 'chats')    { $('#home-screen').classList.remove('chat-open'); }
            // Restore "chats" as active after opening a modal
            if (target !== 'chats'){
                setTimeout(() => {
                    const chatsBtn = nav.querySelector('[data-nav="chats"]');
                    buttons.forEach(b => b.classList.toggle('active', b === chatsBtn));
                    positionIndicator(chatsBtn);
                }, 250);
            }
        });
    });
}

/* ================================================================
   12. Chats subscription
   ================================================================ */
function subscribeChats(){
    if (state.chatsUnsub) state.chatsUnsub();
    const q = query(
        collection(db, 'chats'),
        where('members', 'array-contains', state.user.uid)
    );
    state.chatsUnsub = onSnapshot(q, async snap => {
        const list = [];
        snap.forEach(d => list.push({ id:d.id, ...d.data() }));
        list.sort((a,b) => {
            const ta = a.lastMessageAt?.toMillis?.() ?? 0;
            const tb = b.lastMessageAt?.toMillis?.() ?? 0;
            return tb - ta;
        });
        state.chats = list;
        renderChatList();
    }, err => console.error('chats subscribe error', err));
}

function renderChatList(filterText = ''){
    const listEl = $('#chat-list');
    const emptyEl = $('#chat-list-empty');
    const f = filterText.trim().toLowerCase();
    const items = state.chats;

    if (items.length === 0){
        listEl.innerHTML = '';
        listEl.appendChild(emptyEl);
        return;
    }
    listEl.innerHTML = '';
    let shown = 0;

    items.forEach(async chat => {
        const peerId = chat.members.find(u => u !== state.user.uid);
        if (!peerId) return;
        const peer = await getUserProfile(peerId);
        if (!peer) return;
        const displayName = peer.displayName || peer.username || 'Unknown';
        if (f && !displayName.toLowerCase().includes(f) && !(peer.username||'').includes(f)) return;

        const row = document.createElement('div');
        row.className = 'chat-item' + (chat.id === state.currentChatId ? ' active' : '');
        row.dataset.chatId = chat.id;
        row.dataset.peerId = peerId;

        const avatarWrap = document.createElement('div');
        avatarWrap.className = 'avatar-online' + (peer.online ? '' : ' offline');
        const avatar = document.createElement('div');
        avatar.className = 'avatar avatar--lg';
        paintAvatar(avatar, peer);
        avatarWrap.appendChild(avatar);

        const body = document.createElement('div');
        body.className = 'chat-item-body';

        const top = document.createElement('div');
        top.className = 'chat-item-top';
        top.innerHTML = `
            <span class="chat-item-name">${escapeHTML(displayName)}</span>
            <span class="chat-item-time">${chat.lastMessageAt ? fmtTime(chat.lastMessageAt) : ''}</span>
        `;

        const bottom = document.createElement('div');
        bottom.className = 'chat-item-bottom';

        const preview = document.createElement('div');
        preview.className = 'chat-item-preview';
        const previewPrefix = (chat.lastSender === state.user.uid && chat.lastMessage) ? 'You: ' : '';
        preview.textContent = chat.lastMessage ? (previewPrefix + chat.lastMessage) : `@${peer.username || 'user'} · Say hello 👋`;

        bottom.appendChild(preview);

        // Unread badge (unread = last message from peer and not seen by me)
        const unread = (chat.lastSender && chat.lastSender !== state.user.uid && chat.id !== state.currentChatId) ? 1 : 0;
        if (unread){
            const badge = document.createElement('span');
            badge.className = 'chat-item-unread';
            badge.textContent = '1';
            bottom.appendChild(badge);
        }

        body.appendChild(top);
        body.appendChild(bottom);
        row.appendChild(avatarWrap);
        row.appendChild(body);

        row.addEventListener('click', () => openChat(chat.id, peer));
        listEl.appendChild(row);
        shown++;
    });

    setTimeout(() => {
        if (!listEl.querySelector('.chat-item') && items.length > 0){
            // filter resulted in nothing — show a light empty
            listEl.innerHTML = '';
            const empty = document.createElement('div');
            empty.className = 'empty-state small';
            empty.innerHTML = `<p class="empty-sub">No conversations match "${escapeHTML(filterText)}"</p>`;
            listEl.appendChild(empty);
        } else if (!listEl.querySelector('.chat-item')){
            listEl.innerHTML = '';
            listEl.appendChild(emptyEl);
        }
    }, 400);
}

/* ================================================================
   13. User profile cache
   ================================================================ */
const userCache = new Map();
async function getUserProfile(uid){
    if (userCache.has(uid)) return userCache.get(uid);
    try{
        const snap = await getDoc(doc(db, 'users', uid));
        if (!snap.exists()) return null;
        const data = snap.data();
        userCache.set(uid, data);
        return data;
    } catch{ return null; }
}

/* ================================================================
   14. Open chat + realtime
   ================================================================ */
async function openChat(chatId, peer){
    state.currentChatId = chatId;
    state.currentPeer = peer;

    $('#chat-empty').classList.add('hidden');
    $('#chat-active').classList.remove('hidden');
    $('#home-screen').classList.add('chat-open');

    $('#peer-name').textContent = peer.displayName || peer.username || 'Chat';
    paintAvatar($('#peer-avatar'), peer);
    updatePeerStatus(peer);

    if (state.peerUnsub) state.peerUnsub();
    state.peerUnsub = onSnapshot(doc(db, 'users', peer.uid), s => {
        if (s.exists()){
            state.currentPeer = s.data();
            userCache.set(peer.uid, s.data());
            updatePeerStatus(state.currentPeer);
        }
    });

    if (state.typingUnsub) state.typingUnsub();
    state.typingUnsub = onSnapshot(doc(db, 'chats', chatId), s => {
        const data = s.data() || {};
        const typingUid = data.typing;
        const typingAt  = data.typingAt?.toMillis?.() ?? 0;
        const fresh = (Date.now() - typingAt) < 4000;
        $('#typing-indicator').classList.toggle('hidden', !(fresh && typingUid && typingUid !== state.user.uid));
    });

    if (state.messagesUnsub) state.messagesUnsub();
    const mq = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('createdAt', 'asc'),
        limit(200)
    );
    state.messagesUnsub = onSnapshot(mq, snap => {
        renderMessages(snap.docs.map(d => ({ id:d.id, ...d.data() })));
        markSeen(chatId).catch(()=>{});
    });

    $$('.chat-item').forEach(el => el.classList.toggle('active', el.dataset.chatId === chatId));
    $('#composer-input').focus();
}
function updatePeerStatus(peer){
    const wrap = $('#peer-avatar-wrap');
    if (wrap) wrap.classList.toggle('offline', !peer?.online);
    const el = $('#peer-status');
    if (peer?.online){
        el.textContent = 'Online';
        el.classList.add('online');
    } else {
        el.classList.remove('online');
        el.textContent = peer?.lastSeen ? ('Last seen ' + fmtTime(peer.lastSeen)) : 'Offline';
    }
}

/* ================================================================
   15. Render messages
   ================================================================ */
function renderMessages(msgs){
    const container = $('#messages');
    const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 140;
    container.innerHTML = '';

    let lastDay = '';
    let lastSenderId = null;
    msgs.forEach(m => {
        if (m.deletedFor && m.deletedFor.includes(state.user.uid)) return;

        const day = fmtDay(m.createdAt);
        if (day !== lastDay){
            const div = document.createElement('div');
            div.className = 'msg-divider';
            div.textContent = day || '';
            container.appendChild(div);
            lastDay = day;
            lastSenderId = null;
        }
        const isMe = m.senderId === state.user.uid;
        const el = document.createElement('div');
        el.className = 'msg ' + (isMe ? 'me' : 'them') + (lastSenderId === m.senderId ? ' grouped' : '');
        el.dataset.msgId = m.id;

        if (m.deletedForAll){
            el.innerHTML = `<span class="msg-deleted">🚫 This message was deleted</span>`;
        } else {
            let body = '';
            if (m.type === 'image' && m.mediaURL){
                body += `<div class="msg-media"><img src="${m.mediaURL}" alt="image"/></div>`;
            } else if (m.type === 'video' && m.mediaURL){
                body += `<div class="msg-media"><video src="${m.mediaURL}" controls></video></div>`;
            } else if (m.type === 'audio' && m.mediaURL){
                body += `<audio src="${m.mediaURL}" controls></audio>`;
            } else if (m.type === 'file' && m.mediaURL){
                body += `
                    <a class="msg-file" href="${m.mediaURL}" target="_blank" rel="noopener">
                        <span class="msg-file-icon">
                            <svg viewBox="0 0 24 24" width="20" height="20"><use href="#i-file"/></svg>
                        </span>
                        <div>
                            <div class="msg-file-name">${escapeHTML(m.fileName||'File')}</div>
                            <div class="msg-file-size">${formatBytes(m.fileSize||0)}</div>
                        </div>
                    </a>`;
            }
            if (m.text) body += `<span>${linkify(escapeHTML(m.text))}</span>`;
            if (m.uploading) body += `<span class="msg-upload-progress">Uploading… ${m.uploading|0}%</span>`;

            el.innerHTML = body || '<span class="msg-deleted">Empty message</span>';

            const meta = document.createElement('div');
            meta.className = 'msg-meta';
            const t = m.createdAt ? fmtTime(m.createdAt) : 'Sending…';
            let statusTxt = '';
            let statusClass = '';
            if (isMe && !m.uploading){
                if (m._pending) statusTxt = 'Sending…';
                else if (m.seenBy && m.seenBy.includes(otherMember(m))) { statusTxt = 'Seen'; statusClass = 'seen'; }
                else statusTxt = 'Arrived';
            }
            meta.innerHTML = `
                ${m.edited ? '<span class="msg-edited">Edited</span>' : ''}
                <span>${t}</span>
                ${statusTxt ? `<span class="msg-status ${statusClass}">· ${statusTxt}</span>` : ''}
            `;
            el.appendChild(meta);

            if (isMe){
                el.addEventListener('contextmenu', e => openCtxMenu(e, m));
                el.addEventListener('dblclick',    e => openCtxMenu(e, m));
            } else {
                el.addEventListener('contextmenu', e => openCtxMenu(e, m, true));
            }
        }
        container.appendChild(el);
        lastSenderId = m.senderId;
    });

    if (wasNearBottom){
        requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    }
}
function otherMember(){ return state.currentPeer?.uid; }
function formatBytes(n){
    if (!n) return '';
    const units = ['B','KB','MB','GB'];
    let i = 0;
    while (n >= 1024 && i < units.length-1){ n /= 1024; i++; }
    return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + units[i];
}
function linkify(text){
    return text.replace(/(https?:\/\/[^\s]+)/g, url =>
        `<a href="${url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">${url}</a>`
    );
}

/* ================================================================
   16. Sending messages
   ================================================================ */
const composerInput = $('#composer-input');
const sendBtn = $('#btn-send');

composerInput.addEventListener('input', () => {
    composerInput.style.height = 'auto';
    composerInput.style.height = Math.min(composerInput.scrollHeight, 120) + 'px';

    const has = composerInput.value.trim().length > 0;
    sendBtn.disabled = !has;

    if (state.currentChatId && has){
        const now = Date.now();
        if (now - state.lastTypingSent > 1500){
            state.lastTypingSent = now;
            updateDoc(doc(db, 'chats', state.currentChatId), {
                typing: state.user.uid,
                typingAt: serverTimestamp()
            }).catch(()=>{});
        }
    }
});
composerInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); handleSend(); }
});
sendBtn.addEventListener('click', handleSend);

async function handleSend(){
    const text = composerInput.value.trim();
    if (!text || !state.currentChatId) return;

    if (state.editingMsgId){
        try{
            await updateDoc(
                doc(db, 'chats', state.currentChatId, 'messages', state.editingMsgId),
                { text, edited:true, editedAt: serverTimestamp() }
            );
        } catch(ex){ toast('Failed to edit', 'error'); }
        state.editingMsgId = null;
        composerInput.value = '';
        composerInput.style.height = 'auto';
        sendBtn.disabled = true;
        return;
    }

    sendBtn.classList.remove('pop'); void sendBtn.offsetWidth; sendBtn.classList.add('pop');
    composerInput.value = '';
    composerInput.style.height = 'auto';
    sendBtn.disabled = true;

    try{
        await addDoc(collection(db, 'chats', state.currentChatId, 'messages'), {
            senderId: state.user.uid,
            text,
            type: 'text',
            createdAt: serverTimestamp(),
            seenBy: [state.user.uid],
            edited: false
        });
        await updateDoc(doc(db, 'chats', state.currentChatId), {
            lastMessage: text,
            lastMessageAt: serverTimestamp(),
            lastSender: state.user.uid,
            typing: null
        });
    } catch(ex){
        console.error(ex);
        toast('Message failed to send', 'error');
        composerInput.value = text;
    }
}

/* ================================================================
   17. Mark seen
   ================================================================ */
async function markSeen(chatId){
    if (!state.user) return;
    const q = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('createdAt', 'desc'),
        limit(20)
    );
    const snap = await getDocs(q);
    const batch = [];
    snap.forEach(d => {
        const m = d.data();
        if (m.senderId !== state.user.uid){
            if (!m.seenBy || !m.seenBy.includes(state.user.uid)){
                batch.push(updateDoc(d.ref, { seenBy: arrayUnion(state.user.uid) }));
            }
        }
    });
    await Promise.all(batch);
}

/* ================================================================
   18. Message context menu
   ================================================================ */
const ctxMenu = $('#msg-ctx-menu');
function openCtxMenu(e, m, peerMsg = false){
    e.preventDefault();
    state.ctxMsg = m;
    ctxMenu.querySelectorAll('button').forEach(b => {
        const act = b.dataset.action;
        if (peerMsg){
            b.style.display = (act === 'copy' || act === 'delete-me') ? '' : 'none';
        } else {
            b.style.display = '';
            if (act === 'edit' && m.type !== 'text') b.style.display = 'none';
        }
    });
    ctxMenu.classList.remove('hidden');
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 180);
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top  = y + 'px';
}
document.addEventListener('click', e => {
    if (!ctxMenu.contains(e.target)) ctxMenu.classList.add('hidden');
});
ctxMenu.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const m = state.ctxMsg;
    const action = btn.dataset.action;
    ctxMenu.classList.add('hidden');
    if (!m) return;
    const mRef = doc(db, 'chats', state.currentChatId, 'messages', m.id);
    try{
        if (action === 'copy'){
            await navigator.clipboard.writeText(m.text || '');
            toast('Copied to clipboard', 'success');
        } else if (action === 'edit'){
            state.editingMsgId = m.id;
            composerInput.value = m.text || '';
            composerInput.focus();
            composerInput.dispatchEvent(new Event('input'));
        } else if (action === 'delete-me'){
            await updateDoc(mRef, { deletedFor: arrayUnion(state.user.uid) });
        } else if (action === 'delete-all'){
            await updateDoc(mRef, { deletedForAll:true, text:'', mediaURL:'', fileName:'', deletedAt: serverTimestamp() });
        }
    } catch(ex){ toast('Action failed', 'error'); }
});

/* ================================================================
   19. Attachment uploads
   ================================================================ */
$('#btn-attach').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !state.currentChatId) return;
    await uploadAndSend(file);
});
async function uploadAndSend(file){
    if (!state.currentChatId) return;
    const type = file.type.startsWith('image/') ? 'image'
               : file.type.startsWith('video/') ? 'video'
               : file.type.startsWith('audio/') ? 'audio'
               : 'file';

    const mRef = await addDoc(collection(db, 'chats', state.currentChatId, 'messages'), {
        senderId: state.user.uid,
        type,
        text: '',
        fileName: file.name,
        fileSize: file.size,
        createdAt: serverTimestamp(),
        seenBy: [state.user.uid],
        uploading: 1
    });

    const path = `chats/${state.currentChatId}/${mRef.id}_${file.name.replace(/[^\w.\-]/g,'_')}`;
    const sref = storageRef(storage, path);
    const task = uploadBytesResumable(sref, file, { contentType:file.type });

    task.on('state_changed',
        snap => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            updateDoc(mRef, { uploading: pct }).catch(()=>{});
        },
        err => {
            console.error(err);
            toast('Upload failed', 'error');
            updateDoc(mRef, { deletedForAll:true, uploading:null }).catch(()=>{});
        },
        async () => {
            const url = await getDownloadURL(task.snapshot.ref);
            await updateDoc(mRef, { mediaURL:url, uploading:null });
            await updateDoc(doc(db, 'chats', state.currentChatId), {
                lastMessage: type === 'image' ? '📷 Photo'
                           : type === 'video' ? '🎬 Video'
                           : type === 'audio' ? '🎙️ Voice note'
                           : `📎 ${file.name}`,
                lastMessageAt: serverTimestamp(),
                lastSender: state.user.uid
            });
        }
    );
}

/* ================================================================
   20. Voice recording
   ================================================================ */
const micBtn = $('#btn-mic');
const recOverlay = $('#rec-overlay');
const recTimeEl  = $('#rec-time');

async function startRecording(clientX){
    if (state.isRecording) return;
    try{
        const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        state.mediaRecorder = new MediaRecorder(stream);
        state.recordChunks = [];
        state.mediaRecorder.ondataavailable = ev => { if (ev.data.size) state.recordChunks.push(ev.data); };
        state.mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            if (state.recordCancel){ state.recordCancel = false; return; }
            const blob = new Blob(state.recordChunks, { type:'audio/webm' });
            const file = new File([blob], `voice-${Date.now()}.webm`, { type:'audio/webm' });
            uploadAndSend(file);
        };
        state.mediaRecorder.start();
        state.isRecording = true;
        state.recordCancel = false;
        state.recordStart = Date.now();
        state.recordStartX = clientX;
        micBtn.classList.add('recording');
        recOverlay.classList.remove('hidden','cancelling');
        recTimeEl.textContent = '0:00';
        state.recordTimer = setInterval(() => {
            const s = Math.floor((Date.now() - state.recordStart)/1000);
            recTimeEl.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
        }, 250);
    } catch(ex){
        toast('Microphone permission needed', 'error');
    }
}
function stopRecording(cancel = false){
    if (!state.isRecording) return;
    state.recordCancel = cancel;
    state.isRecording = false;
    clearInterval(state.recordTimer);
    micBtn.classList.remove('recording');
    recOverlay.classList.add('hidden');
    recOverlay.classList.remove('cancelling');
    try{ state.mediaRecorder?.stop(); }catch{}
}
micBtn.addEventListener('mousedown', e => startRecording(e.clientX));
micBtn.addEventListener('mouseup',   () => stopRecording(false));
micBtn.addEventListener('mouseleave',() => { if (state.isRecording) stopRecording(false); });
micBtn.addEventListener('touchstart', e => { startRecording(e.touches[0].clientX); e.preventDefault(); }, { passive:false });
micBtn.addEventListener('touchmove',  e => {
    if (!state.isRecording) return;
    const dx = e.touches[0].clientX - state.recordStartX;
    recOverlay.classList.toggle('cancelling', dx < -80);
});
micBtn.addEventListener('touchend', e => {
    if (!state.isRecording) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - state.recordStartX;
    stopRecording(dx < -80);
});

/* ================================================================
   21. Modal helpers
   ================================================================ */
function openModal(id){ $('#' + id).classList.remove('hidden'); }
function closeModal(el){ el.classList.add('hidden'); }
$$('[data-close-modal]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.closest('.modal-backdrop')))
);
$$('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => { if (e.target === bd) closeModal(bd); });
});

/* ================================================================
   22. Sidebar bindings
   ================================================================ */
$('#btn-open-settings').addEventListener('click', () => {
    // refresh identity card
    if (state.profile){
        paintAvatar($('#settings-avatar'), state.profile);
        $('#settings-name').textContent     = state.profile.displayName || '—';
        $('#settings-username').textContent = '@' + (state.profile.username || '—');
    }
    openModal('modal-settings');
});
$('#btn-new-chat').addEventListener('click', openNewChat);
$('#btn-empty-new-chat')?.addEventListener('click', openNewChat);
function openNewChat(){
    $('#user-search').value = '';
    $('#user-results').innerHTML = `<div class="empty-state small">
        <svg viewBox="0 0 24 24" width="36" height="36" style="color:var(--accent);opacity:.6"><use href="#i-sparkle"/></svg>
        <p class="empty-sub" style="margin-top:8px">Search users by their @username.</p>
    </div>`;
    openModal('modal-newchat');
    setTimeout(() => $('#user-search').focus(), 220);
}
$('#chat-search').addEventListener('input', e => renderChatList(e.target.value));
$('#btn-back-list').addEventListener('click', () => $('#home-screen').classList.remove('chat-open'));
$('#chat-peer-btn').addEventListener('click', () => { if (state.currentPeer) renderPeerProfile(state.currentPeer); });
$('#btn-chat-info').addEventListener('click', () => { if (state.currentPeer) renderPeerProfile(state.currentPeer); });

// Settings actions
$('#settings-edit-profile').addEventListener('click', () => {
    closeModal($('#modal-settings'));
    setTimeout(() => renderProfileModal(true), 300);
});
$('#settings-privacy').addEventListener('click', () => {
    toast('Your messages are private and only visible to chat members.');
});
$('#settings-logout').addEventListener('click', async () => {
    closeModal($('#modal-settings'));
    try{
        await updateDoc(doc(db, 'users', state.user.uid), { online:false, lastSeen: serverTimestamp() });
    } catch{}
    await signOut(auth);
});

/* ================================================================
   23. Profile modal
   ================================================================ */
function renderProfileModal(editMode = false){
    const p = state.profile;
    paintAvatar($('#profile-avatar'), p);
    $('#profile-name').textContent     = p.displayName || '—';
    $('#profile-username').textContent = '@' + (p.username || '—');
    $('#profile-bio').textContent      = p.bio || 'No bio yet.';
    $('#profile-joined').textContent   = 'Joined ' + (p.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString([], { month:'long', year:'numeric' }) : '—');

    const form = $('#form-profile');
    form.style.display = '';
    form.displayName.value = p.displayName || '';
    form.username.value    = p.username || '';
    form.bio.value         = p.bio || '';
    form.querySelector('[data-error]').textContent = '';
    form.querySelector('[data-success]').textContent = '';

    openModal('modal-profile');
    if (editMode) setTimeout(() => form.displayName.focus(), 300);
}
function renderPeerProfile(peer){
    const p = peer;
    paintAvatar($('#profile-avatar'), p);
    $('#profile-name').textContent     = p.displayName || '—';
    $('#profile-username').textContent = '@' + (p.username || '—');
    $('#profile-bio').textContent      = p.bio || 'No bio yet.';
    $('#profile-joined').textContent   = 'Joined ' + (p.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString([], { month:'long', year:'numeric' }) : '—');
    $('#form-profile').style.display = 'none';
    openModal('modal-profile');
}
$('#form-profile').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const err = e.target.querySelector('[data-error]');
    const ok  = e.target.querySelector('[data-success]');
    err.textContent = ''; ok.textContent = '';
    btn.disabled = true;
    try{
        const data = new FormData(e.target);
        const displayName = data.get('displayName').trim();
        const username    = data.get('username').trim().toLowerCase();
        const bio         = (data.get('bio') || '').trim();

        if (!/^[a-zA-Z0-9_\.]{3,20}$/.test(username)){
            throw new Error('Username must be 3–20 characters (letters, numbers, underscore, dot).');
        }
        if (username !== state.profile.username){
            const q = query(collection(db, 'users'), where('usernameLower', '==', username), limit(1));
            const existing = await getDocs(q);
            if (!existing.empty) throw new Error('That username is already taken.');
        }
        await updateDoc(doc(db, 'users', state.user.uid), {
            displayName, username, usernameLower:username, bio
        });
        state.profile = { ...state.profile, displayName, username, usernameLower:username, bio };
        userCache.set(state.user.uid, state.profile);

        // Refresh all identity cards
        paintAvatar($('#settings-avatar'), state.profile);
        $('#settings-name').textContent     = displayName;
        $('#settings-username').textContent = '@' + username;
        $('#profile-name').textContent      = displayName;
        $('#profile-username').textContent  = '@' + username;
        $('#profile-bio').textContent       = bio || 'No bio yet.';
        ok.textContent = 'Saved.';
    } catch(ex){
        err.textContent = ex.message || 'Failed to update.';
    } finally {
        btn.disabled = false;
    }
});

/* ================================================================
   24. New chat: search users
   ================================================================ */
let userSearchDebounce;
$('#user-search').addEventListener('input', e => {
    clearTimeout(userSearchDebounce);
    const term = e.target.value.trim().toLowerCase().replace(/^@/, '');
    userSearchDebounce = setTimeout(() => searchUsers(term), 220);
});
async function searchUsers(term){
    const results = $('#user-results');
    if (!term){
        results.innerHTML = `<div class="empty-state small">
            <svg viewBox="0 0 24 24" width="36" height="36" style="color:var(--accent);opacity:.6"><use href="#i-sparkle"/></svg>
            <p class="empty-sub" style="margin-top:8px">Search users by their @username.</p>
        </div>`;
        return;
    }
    try{
        const q = query(
            collection(db, 'users'),
            where('usernameLower', '>=', term),
            where('usernameLower', '<=', term + '\uf8ff'),
            limit(20)
        );
        const snap = await getDocs(q);
        results.innerHTML = '';
        if (snap.empty){
            results.innerHTML = '<div class="empty-state small"><p class="empty-sub">No users found.</p></div>';
            return;
        }
        snap.forEach(d => {
            const u = d.data();
            if (u.uid === state.user.uid) return;
            const row = document.createElement('div');
            row.className = 'user-result';
            const av = document.createElement('div');
            av.className = 'avatar avatar--lg';
            paintAvatar(av, u);
            row.appendChild(av);
            const info = document.createElement('div');
            info.className = 'user-result-info';
            info.innerHTML = `
                <span class="user-result-name">${escapeHTML(u.displayName || '—')}</span>
                <span class="user-result-username">@${escapeHTML(u.username || '—')}</span>
            `;
            row.appendChild(info);
            row.addEventListener('click', () => startChatWith(u));
            results.appendChild(row);
        });
    } catch(ex){
        console.error(ex);
        results.innerHTML = '<div class="empty-state small"><p class="empty-sub">Search failed.</p></div>';
    }
}
async function startChatWith(peer){
    if (!peer?.uid) return;
    const cid = chatIdOf(state.user.uid, peer.uid);
    const ref = doc(db, 'chats', cid);
    try{
        const snap = await getDoc(ref);
        if (!snap.exists()){
            await setDoc(ref, {
                members: [state.user.uid, peer.uid],
                createdAt: serverTimestamp(),
                lastMessage: '',
                lastMessageAt: serverTimestamp()
            });
        }
        closeModal($('#modal-newchat'));
        openChat(cid, peer);
    } catch(ex){
        console.error(ex);
        toast('Could not start chat', 'error');
    }
}

/* ================================================================
   25. Teardown listeners on sign-out
   ================================================================ */
function teardown(){
    [state.chatsUnsub, state.messagesUnsub, state.peerUnsub, state.typingUnsub].forEach(fn => {
        try { fn && fn(); } catch{}
    });
    state.chatsUnsub = state.messagesUnsub = state.peerUnsub = state.typingUnsub = null;
    state.currentChatId = null;
    state.currentPeer = null;
    userCache.clear();
    $('#messages').innerHTML = '';
    $('#chat-list').innerHTML = '';
    $('#chat-active').classList.add('hidden');
    $('#chat-empty').classList.remove('hidden');
    $('#home-screen').classList.remove('chat-open');
}

/* ================================================================
   26. Init
   ================================================================ */
attachRipples();
initAuthUI();
initFloatingNav();
startSplash();
