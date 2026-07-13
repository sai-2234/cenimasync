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
    addDoc, query, where, orderBy, limit, startAfter, onSnapshot,
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
    messagesMap: new Map(),   // msgId -> message data, for the currently open chat only
    msgEls: new Map(),        // msgId -> rendered DOM node, kept in sync with messagesMap
    oldestMsgDoc: null,       // Firestore doc snapshot cursor for lazy-loading older messages
    hasMoreOlder: true,
    loadingOlder: false,
    replyTo: null,            // { id, senderName, text } — message currently being replied to
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
    unreadCounts: new Map(),  // chatId -> last unread count (client-side estimate)

    peerRowUnsubs: new Map(), // peerId -> unsub, keeps sidebar avatars/online-dots live
    chatMeta: {},             // { tulipBackground, themeId } for the currently open chat
    searchOpen: false,
    searchTerm: '',
    avatarUploading: false
};

const MSG_PAGE_SIZE = 30; // messages fetched per page (live window + each lazy-load batch)

// Per-conversation themes. Selection is stored on chats/{chatId}.themeId and
// applied via a data-theme attribute, so every rule that already references
// the CSS custom properties below (gradient, glow, card colors…) re-themes
// itself automatically — no per-theme rule duplication needed.
const CHAT_THEMES = [
    { id: 'default',   name: 'Default',            preview: 'linear-gradient(135deg,#2DD4FF,#5AB8FF,#7B61FF)' },
    { id: 'sunset',    name: 'Sunset Glow',         preview: 'linear-gradient(135deg,#FF9966,#FF5E8E,#C86DD7)' },
    { id: 'midnight',  name: 'Midnight Minimalist', preview: 'linear-gradient(135deg,#3A4A5C,#232E3A)' },
    { id: 'cyberpunk', name: 'Cyberpunk Neon',      preview: 'linear-gradient(135deg,#FF2ECC,#7B2FFF,#00F0FF)' }
];

// GIPHY — grab a free key at https://developers.giphy.com/dashboard/ (takes ~2
// minutes) and drop it in here. The shared public "beta" key is heavily
// rate-limited across every app using it, so it WILL start failing under any
// real traffic — don't ship with it.
const GIPHY_API_KEY = 'YOUR_GIPHY_API_KEY';

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
            
            // 1. Authenticate the user first so they pass Firestore security rules
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(cred.user, { displayName });

            // 2. Now check if the username is taken
            const q = query(collection(db, 'users'), where('usernameLower', '==', username), limit(1));
            const existing = await getDocs(q);
            if (!existing.empty) {
                // Delete the auth user if the username is already taken so they can try again
                await cred.user.delete();
                throw new Error('That username is already taken.');
            }

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
    state.chatsUnsub = onSnapshot(q, snap => {
        const list = [];
        snap.forEach(d => list.push({ id:d.id, ...d.data() }));
        list.sort((a,b) => {
            const ta = a.lastMessageAt?.toMillis?.() ?? 0;
            const tb = b.lastMessageAt?.toMillis?.() ?? 0;
            return tb - ta;
        });
        state.chats = list;
        // Preserve whatever the user was searching for — a listener firing
        // (e.g. from a typing update) should never reset an active filter.
        renderChatList($('#chat-search')?.value || '');
    }, err => console.error('chats subscribe error', err));
}

let chatListRenderToken = 0;
function renderChatList(filterText = ''){
    const listEl = $('#chat-list');
    const emptyEl = $('#chat-list-empty');
    const f = filterText.trim().toLowerCase();
    const items = state.chats;
    const myToken = ++chatListRenderToken;

    if (items.length === 0){
        listEl.replaceChildren(emptyEl);
        return;
    }

    // Fetch every peer profile up front. The DOM is not touched until all
    // lookups have resolved — this is what prevents the sidebar from
    // blanking out while profile data is still in flight.
    Promise.all(items.map(async chat => {
        const peerId = chat.members?.find(u => u !== state.user.uid);
        if (!peerId) return null;
        const peer = await getUserProfile(peerId);
        if (!peer) return null;
        return { chat, peer, peerId };
    })).then(resolved => {
        // A newer render was requested while this one was in flight — drop it.
        if (myToken !== chatListRenderToken) return;

        const frag = document.createDocumentFragment();
        let rendered = 0;
        for (const entry of resolved){
            if (!entry) continue;
            const { chat, peer } = entry;
            const displayName = peer.displayName || peer.username || 'Unknown';
            if (f && !displayName.toLowerCase().includes(f) && !(peer.username||'').includes(f)) continue;
            frag.appendChild(buildChatRow(entry));
            rendered++;
        }

        if (rendered === 0){
            if (f){
                const empty = document.createElement('div');
                empty.className = 'empty-state small';
                empty.innerHTML = `<p class="empty-sub">No conversations match "${escapeHTML(filterText)}"</p>`;
                frag.appendChild(empty);
            } else {
                frag.appendChild(emptyEl);
            }
        }

        // Single DOM write — old content is replaced in one operation,
        // so there is never a moment where the list is empty on screen.
        listEl.replaceChildren(frag);
    });
}

function buildChatRow({ chat, peer, peerId }){
    ensurePeerRowListener(peerId);

    const displayName = peer.displayName || peer.username || 'Unknown';
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
    return row;
}

// One lightweight doc listener per peer shown in the sidebar. When that
// user's profile changes (new photo, online status), the matching row(s)
// are patched in place — no full sidebar re-render needed.
function ensurePeerRowListener(peerId){
    if (state.peerRowUnsubs.has(peerId)) return;
    const unsub = onSnapshot(doc(db, 'users', peerId), s => {
        if (!s.exists()) return;
        const data = s.data();
        userCache.set(peerId, data);
        patchSidebarPeer(peerId, data);
    }, () => {});
    state.peerRowUnsubs.set(peerId, unsub);
}
function patchSidebarPeer(peerId, peer){
    document.querySelectorAll(`.chat-item[data-peer-id="${CSS.escape(peerId)}"]`).forEach(row => {
        const avatarWrap = row.querySelector('.avatar-online');
        if (avatarWrap) avatarWrap.classList.toggle('offline', !peer.online);
        const avatar = row.querySelector('.avatar');
        if (avatar) paintAvatar(avatar, peer);
        const nameEl = row.querySelector('.chat-item-name');
        if (nameEl) nameEl.textContent = peer.displayName || peer.username || 'Unknown';
    });
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

    // Reset per-chat message state. This is the ONE deliberate full clear —
    // it only happens when switching conversations, never on a live update.
    state.messagesMap.clear();
    state.msgEls.clear();
    state.oldestMsgDoc = null;
    state.hasMoreOlder = true;
    state.loadingOlder = false;
    cancelReply();
    closeChatSearch();
    $('#messages').innerHTML = '';
    state.chatMeta = {};
    applyChatAppearance(state.chatMeta);

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
            paintAvatar($('#peer-avatar'), state.currentPeer);
        }
    });

    if (state.typingUnsub) state.typingUnsub();
    state.typingUnsub = onSnapshot(doc(db, 'chats', chatId), s => {
        const data = s.data() || {};
        const typingUid = data.typing;
        const typingAt  = data.typingAt?.toMillis?.() ?? 0;
        const fresh = (Date.now() - typingAt) < 4000;
        $('#typing-indicator').classList.toggle('hidden', !(fresh && typingUid && typingUid !== state.user.uid));

        // Same doc also carries the per-conversation appearance settings —
        // reusing this listener (rather than opening a second one on the
        // same document) keeps it live/synced for both participants for free.
        state.chatMeta = { tulipBackground: !!data.tulipBackground, themeId: data.themeId || 'default' };
        applyChatAppearance(state.chatMeta);
    });

    if (state.messagesUnsub) state.messagesUnsub();
    // Live window: only the newest MSG_PAGE_SIZE messages are kept "live".
    // Older history is fetched on demand via loadOlderMessages() (see below),
    // so the DOM never has to hold hundreds of messages just to stay in sync.
    let isFirstSnapshot = true;
    const mq = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('createdAt', 'desc'),
        limit(MSG_PAGE_SIZE)
    );
    state.messagesUnsub = onSnapshot(mq, snap => {
        // The pagination cursor is captured once, from the very first
        // snapshot. It must NOT be recomputed on later live updates, or
        // messages between the old and new cursor would silently be skipped
        // when the user scrolls up to load older history.
        if (isFirstSnapshot){
            isFirstSnapshot = false;
            if (snap.docs.length){
                state.oldestMsgDoc = snap.docs[snap.docs.length - 1];
                state.hasMoreOlder = snap.docs.length === MSG_PAGE_SIZE;
            } else {
                state.hasMoreOlder = false;
            }
        }
        applyLiveSnapshot(snap);
        markSeen(chatId).catch(()=>{});
    }, err => console.error('messages subscribe error', err));

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
   14b. Chat appearance — Tulip background + per-chat themes
   (chats/{chatId}.tulipBackground, chats/{chatId}.themeId — both
   synced live for both participants via the listener above)
   ================================================================ */
function applyChatAppearance({ tulipBackground, themeId }){
    $('#messages').classList.toggle('tulip-bg', !!tulipBackground);
    $('#chat-active').dataset.theme = themeId || 'default';
    syncChatSettingsUI();
}
function syncChatSettingsUI(){
    const sw = $('#tulip-toggle-switch');
    if (sw) sw.classList.toggle('on', !!state.chatMeta.tulipBackground);
    $$('.theme-swatch', $('#theme-grid')).forEach(el => {
        el.classList.toggle('selected', el.dataset.themeId === (state.chatMeta.themeId || 'default'));
    });
}
function buildThemeGrid(){
    const grid = $('#theme-grid');
    if (!grid || grid.childElementCount) return; // build once
    CHAT_THEMES.forEach(theme => {
        const btn = document.createElement('button');
        btn.className = 'theme-swatch';
        btn.dataset.themeId = theme.id;
        btn.innerHTML = `
            <span class="theme-swatch-preview" style="background:${theme.preview}"></span>
            <span class="theme-swatch-name">${escapeHTML(theme.name)}</span>
        `;
        btn.addEventListener('click', () => {
            if (!state.currentChatId) return;
            updateDoc(doc(db, 'chats', state.currentChatId), { themeId: theme.id }).catch(() => {
                toast('Could not update theme', 'error');
            });
        });
        grid.appendChild(btn);
    });
}
$('#btn-chat-settings')?.addEventListener('click', () => {
    if (!state.currentChatId) return;
    buildThemeGrid();
    syncChatSettingsUI();
    openModal('modal-chat-settings');
});
$('#toggle-tulip-bg')?.addEventListener('click', () => {
    if (!state.currentChatId) return;
    updateDoc(doc(db, 'chats', state.currentChatId), {
        tulipBackground: !state.chatMeta.tulipBackground
    }).catch(() => toast('Could not update background', 'error'));
});

/* ================================================================
   15. Render messages (incremental — no full-container rebuilds)
   ================================================================ */
// applyLiveSnapshot: consumes docChanges() from the live listener instead of
// re-rendering everything on every update. This is what stops the whole
// thread from flashing/fluctuating on every send/receive.
//
// Note on 'removed' changes: this app never hard-deletes a message doc
// (delete-for-everyone just sets deletedForAll:true, a field update). So a
// 'removed' docChange here only ever means the message fell out of the top-N
// live window because a newer message pushed it out — it's still valid
// history and must stay on screen, so those events are intentionally ignored.
function applyLiveSnapshot(snap){
    const container = $('#messages');
    const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 140;
    let sawAdded = false;

    snap.docChanges().forEach(change => {
        if (change.type === 'removed') return;
        const m = { id: change.doc.id, ...change.doc.data() };
        upsertMessageDOM(m);
        if (change.type === 'added') sawAdded = true;
    });

    updateDayDividersAndGrouping();

    if (state.searchOpen && state.searchTerm) applyMessageHighlights();

    if (sawAdded && wasNearBottom){
        requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    }
}

// Creates or updates a single message bubble in place. Only ever touches
// the one DOM node for this message — never the rest of the thread.
function upsertMessageDOM(m){
    const container = $('#messages');

    if (m.deletedFor && m.deletedFor.includes(state.user.uid)){
        removeMessageDOM(m.id);
        state.messagesMap.delete(m.id);
        return;
    }
    state.messagesMap.set(m.id, m);

    const createdMillis = m.createdAt?.toMillis ? m.createdAt.toMillis() : Date.now();
    let el = state.msgEls.get(m.id);
    const isNew = !el;
    const isMe = m.senderId === state.user.uid;

    if (isNew){
        el = document.createElement('div');
        el.dataset.msgId = m.id;
        state.msgEls.set(m.id, el);
        container.insertBefore(el, findInsertionPoint(container, createdMillis));
    }
    el.dataset.createdAt = createdMillis;
    el.className = 'msg ' + (isMe ? 'me' : 'them'); // .grouped is re-applied by updateDayDividersAndGrouping()

    renderMessageContent(el, m, isMe);

    // Interaction listeners are attached once, at creation — attaching them
    // again on every update (e.g. a seen-status change) would stack up
    // duplicate handlers on the same persistent node.
    if (isNew){
        if (isMe){
            el.addEventListener('contextmenu', e => openCtxMenu(e, state.messagesMap.get(m.id)));
            el.addEventListener('dblclick',    e => openCtxMenu(e, state.messagesMap.get(m.id)));
        } else {
            el.addEventListener('contextmenu', e => openCtxMenu(e, state.messagesMap.get(m.id), true));
        }
    }
}

function renderMessageContent(el, m, isMe){
    if (m.deletedForAll){
        el.innerHTML = `<span class="msg-deleted">🚫 This message was deleted</span>`;
        return;
    }
    let body = '';
    if (m.replyToId){
        body += `<div class="msg-reply-quote" data-reply-jump="${escapeHTML(m.replyToId)}">
            <span class="msg-reply-quote-name">${escapeHTML(m.replyToSenderName || '')}</span>
            <span class="msg-reply-quote-text">${escapeHTML((m.replyToText || '').slice(0, 140))}</span>
        </div>`;
    }
    if (m.type === 'image' && m.mediaURL){
        body += `<div class="msg-media"><img src="${m.mediaURL}" alt="image"/></div>`;
    } else if (m.type === 'gif' && m.content){
        body += `<div class="msg-media"><img src="${m.content}" alt="gif" loading="lazy"/></div>`;
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
    if (m.text) body += `<span class="msg-text">${linkify(escapeHTML(m.text))}</span>`;
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
}

// Finds the message node a new bubble should be inserted before, keeping the
// thread in chronological order regardless of the order events arrive in.
function findInsertionPoint(container, createdMillis){
    for (const node of container.children){
        if (!node.classList.contains('msg')) continue;
        if (Number(node.dataset.createdAt) > createdMillis) return node;
    }
    return null; // insertBefore(null) appends at the end
}

function removeMessageDOM(id){
    const el = state.msgEls.get(id);
    if (el) el.remove();
    state.msgEls.delete(id);
}

// Re-derives day dividers and "grouped" (consecutive same-sender) styling
// from the current DOM order. Only touches divider nodes and a class toggle
// — never recreates a message bubble, so nothing re-animates or flashes.
function updateDayDividersAndGrouping(){
    const container = $('#messages');
    container.querySelectorAll('.msg-divider').forEach(d => d.remove());

    let lastDay = '';
    let lastSenderId = null;
    Array.from(container.children).forEach(node => {
        if (!node.classList.contains('msg')) return;
        const m = state.messagesMap.get(node.dataset.msgId);
        if (!m) return;
        const day = fmtDay(m.createdAt);
        if (day !== lastDay){
            const div = document.createElement('div');
            div.className = 'msg-divider';
            div.textContent = day || '';
            container.insertBefore(div, node);
            lastDay = day;
            lastSenderId = null;
        }
        node.classList.toggle('grouped', lastSenderId === m.senderId);
        lastSenderId = m.senderId;
    });
}
function otherMember(){ return state.currentPeer?.uid; }

/* ================================================================
   15b. Lazy-load older messages (infinite scroll upward)
   ================================================================ */
async function loadOlderMessages(){
    if (!state.currentChatId || state.loadingOlder || !state.hasMoreOlder || !state.oldestMsgDoc) return;
    state.loadingOlder = true;
    showOlderLoadingSpinner(true);
    const container = $('#messages');
    try{
        const q = query(
            collection(db, 'chats', state.currentChatId, 'messages'),
            orderBy('createdAt', 'desc'),
            startAfter(state.oldestMsgDoc),
            limit(MSG_PAGE_SIZE)
        );
        const snap = await getDocs(q);

        // Measure once, right before mutating the DOM, so the scroll-offset
        // correction below accounts for both the spinner coming out and the
        // older batch going in — the user's view never visibly jumps.
        const prevScrollHeight = container.scrollHeight;
        const prevScrollTop = container.scrollTop;
        showOlderLoadingSpinner(false);

        if (snap.empty){
            state.hasMoreOlder = false;
            return;
        }
        snap.docs.forEach(d => upsertMessageDOM({ id: d.id, ...d.data() }));
        state.oldestMsgDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < MSG_PAGE_SIZE) state.hasMoreOlder = false;
        updateDayDividersAndGrouping();
        if (state.searchOpen && state.searchTerm) applyMessageHighlights();

        requestAnimationFrame(() => {
            container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
        });
    } catch(ex){
        console.error(ex);
        toast('Could not load older messages', 'error');
    } finally {
        state.loadingOlder = false;
        showOlderLoadingSpinner(false);
    }
}
function showOlderLoadingSpinner(show){
    const container = $('#messages');
    let el = container.querySelector('.messages-loading-older');
    if (show){
        if (!el){
            el = document.createElement('div');
            el.className = 'messages-loading-older';
            el.innerHTML = '<span class="spinner"></span>';
            container.insertBefore(el, container.firstChild);
        }
    } else if (el){
        el.remove();
    }
}
$('#messages').addEventListener('scroll', () => {
    if (!state.currentChatId) return;
    if ($('#messages').scrollTop < 100) loadOlderMessages();
});

/* ================================================================
   15c. Swipe-to-reply (touch + mouse, delegated on the message list)
   ================================================================ */
function initSwipeToReply(){
    const container = $('#messages');
    const THRESHOLD = 60;   // px of leftward drag needed to trigger a reply
    const MAX_DRAG   = 80;
    let activeEl = null, activeMsgId = null;
    let startX = 0, startY = 0, dx = 0, decided = false, isHorizontal = false;
    let swipeIconEl = null;

    function getSwipeIcon(){
        if (!swipeIconEl){
            swipeIconEl = document.createElement('div');
            swipeIconEl.className = 'swipe-reply-icon';
            swipeIconEl.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><use href="#i-reply"/></svg>';
            document.body.appendChild(swipeIconEl);
        }
        return swipeIconEl;
    }
    function positionIcon(){
        if (!activeEl) return;
        const icon = getSwipeIcon();
        const rect = activeEl.getBoundingClientRect();
        icon.style.left = rect.left + 'px';
        icon.style.top  = (rect.top + rect.height / 2) + 'px';
        icon.style.opacity = Math.min(1, Math.abs(dx) / THRESHOLD);
    }
    function reset(){
        if (activeEl){
            activeEl.style.transition = '';
            activeEl.style.transform  = '';
            activeEl.classList.remove('swiping-reply');
        }
        if (swipeIconEl) swipeIconEl.style.opacity = 0;
        activeEl = null; activeMsgId = null; decided = false; isHorizontal = false; dx = 0;
    }
    function onDown(x, y, target){
        const el = target.closest?.('.msg[data-msg-id]');
        if (!el || !container.contains(el)) return;
        activeEl = el;
        activeMsgId = el.dataset.msgId;
        startX = x; startY = y; dx = 0; decided = false; isHorizontal = false;
        activeEl.style.transition = 'none';
    }
    function onMove(x, y){
        if (!activeEl) return;
        const rawDx = x - startX, rawDy = y - startY;
        if (!decided){
            if (Math.abs(rawDx) < 8 && Math.abs(rawDy) < 8) return;
            decided = true;
            isHorizontal = Math.abs(rawDx) > Math.abs(rawDy);
            if (!isHorizontal){ reset(); return; }
        }
        if (!isHorizontal) return;
        dx = Math.min(0, Math.max(rawDx, -MAX_DRAG)); // left-swipe only, clamped
        activeEl.style.transform = `translateX(${dx}px)`;
        activeEl.classList.toggle('swiping-reply', dx < -20);
        positionIcon();
    }
    function onUp(){
        if (!activeEl) return;
        const triggered = decided && isHorizontal && dx <= -THRESHOLD;
        const msg = triggered ? state.messagesMap.get(activeMsgId) : null;
        reset();
        if (msg) startReply(msg);
    }

    container.addEventListener('touchstart', e => { const t = e.touches[0]; onDown(t.clientX, t.clientY, e.target); }, { passive:true });
    container.addEventListener('touchmove',  e => { const t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive:true });
    container.addEventListener('touchend', onUp);

    container.addEventListener('mousedown', e => onDown(e.clientX, e.clientY, e.target));
    container.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onUp);

    // Tap a quoted snippet to jump to the original message, if it's loaded.
    container.addEventListener('click', e => {
        const quote = e.target.closest('.msg-reply-quote[data-reply-jump]');
        if (!quote) return;
        const target = state.msgEls.get(quote.dataset.replyJump);
        if (target){
            target.scrollIntoView({ behavior:'smooth', block:'center' });
            target.classList.add('flash-highlight');
            setTimeout(() => target.classList.remove('flash-highlight'), 900);
        } else {
            toast('Original message not loaded — scroll up to find it');
        }
    });
}
initSwipeToReply();

/* ================================================================
   15d. In-conversation search (client-side, over currently-rendered messages)
   ================================================================ */
let chatSearchDebounce;
function openChatSearch(){
    if (!state.currentChatId) return;
    state.searchOpen = true;
    $('#chat-search-bar').classList.remove('hidden');
    $('#chat-search-input').value = state.searchTerm || '';
    setTimeout(() => $('#chat-search-input').focus(), 50);
}
function closeChatSearch(){
    state.searchOpen = false;
    state.searchTerm = '';
    $('#chat-search-bar')?.classList.add('hidden');
    if ($('#chat-search-input')) $('#chat-search-input').value = '';
    clearMessageHighlights();
}
$('#btn-chat-search')?.addEventListener('click', () => {
    state.searchOpen ? closeChatSearch() : openChatSearch();
});
$('#btn-chat-search-close')?.addEventListener('click', closeChatSearch);
$('#chat-search-input')?.addEventListener('input', e => {
    clearTimeout(chatSearchDebounce);
    const term = e.target.value;
    chatSearchDebounce = setTimeout(() => {
        state.searchTerm = term.trim();
        applyMessageHighlights();
    }, 150);
});

function clearMessageHighlights(){
    $('#messages').querySelectorAll('.msg-text mark.search-hit').forEach(mark => {
        mark.replaceWith(document.createTextNode(mark.textContent));
    });
    $('#messages').querySelectorAll('.msg-text').forEach(el => el.normalize());
    $('#chat-search-count').textContent = '';
}
// Re-applies the current search term over every rendered .msg-text node.
// Called after typing, and after any live/pagination DOM update so newly
// arrived or newly-loaded messages stay in sync with an active search.
function applyMessageHighlights(){
    clearMessageHighlights();
    const term = state.searchTerm;
    if (!term) return;

    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    let total = 0;
    let firstMatchEl = null;

    $('#messages').querySelectorAll('.msg-text').forEach(span => {
        const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        let n;
        while ((n = walker.nextNode())) textNodes.push(n);

        textNodes.forEach(node => {
            if (!re.test(node.nodeValue)) { re.lastIndex = 0; return; }
            re.lastIndex = 0;
            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            let match;
            while ((match = re.exec(node.nodeValue))){
                if (match.index > lastIndex) frag.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex, match.index)));
                const mark = document.createElement('mark');
                mark.className = 'search-hit';
                mark.textContent = match[0];
                frag.appendChild(mark);
                total++;
                if (!firstMatchEl) firstMatchEl = mark;
                lastIndex = match.index + match[0].length;
                if (match[0].length === 0) re.lastIndex++; // avoid infinite loop on empty matches
            }
            if (lastIndex < node.nodeValue.length) frag.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex)));
            node.parentNode.replaceChild(frag, node);
        });
    });

    $('#chat-search-count').textContent = total ? `${total} match${total === 1 ? '' : 'es'}` : 'No matches';
    if (firstMatchEl){
        firstMatchEl.classList.add('current');
        firstMatchEl.scrollIntoView({ behavior:'smooth', block:'center' });
    }
}

function startReply(m){
    if (!m || m.deletedForAll) return;
    const senderName = m.senderId === state.user.uid
        ? 'You'
        : (state.currentPeer?.displayName || state.currentPeer?.username || 'them');
    const previewText = m.text
        || (m.type === 'image' ? '📷 Photo'
        : m.type === 'video' ? '🎬 Video'
        : m.type === 'audio' ? '🎙️ Voice note'
        : m.type === 'file'  ? ('📎 ' + (m.fileName || 'File'))
        : '');
    state.replyTo = { id: m.id, senderName, text: previewText };
    showReplyPreview();
    composerInput.focus();
}
function cancelReply(){
    state.replyTo = null;
    hideReplyPreview();
}
function showReplyPreview(){
    if (!state.replyTo) return;
    $('#reply-preview-name').textContent = state.replyTo.senderName;
    $('#reply-preview-text').textContent = state.replyTo.text;
    $('#reply-preview').classList.remove('hidden');
}
function hideReplyPreview(){
    $('#reply-preview')?.classList.add('hidden');
}
$('#reply-preview-close')?.addEventListener('click', cancelReply);
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

    const replyTo = state.replyTo;
    cancelReply();

    try{
        const payload = {
            senderId: state.user.uid,
            text,
            type: 'text',
            createdAt: serverTimestamp(),
            seenBy: [state.user.uid],
            edited: false
        };
        if (replyTo){
            payload.replyToId = replyTo.id;
            payload.replyToSenderName = replyTo.senderName;
            payload.replyToText = replyTo.text;
        }
        await addDoc(collection(db, 'chats', state.currentChatId, 'messages'), payload);
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
        if (replyTo){ state.replyTo = replyTo; showReplyPreview(); }
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
            b.style.display = (act === 'copy' || act === 'delete-me' || act === 'reply') ? '' : 'none';
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
        if (action === 'reply'){
            startReply(m);
        } else if (action === 'copy'){
            await navigator.clipboard.writeText(m.text || '');
            toast('Copied to clipboard', 'success');
        } else if (action === 'edit'){
            cancelReply();
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
   19b. GIPHY — trending/search popover + send-as-message
   ================================================================ */
const gifPopover = $('#gif-popover');
const gifGrid = $('#gif-grid');
let gifSearchDebounce;
let gifRequestToken = 0; // guards against a slow, superseded fetch overwriting a newer one

async function giphyFetch(url){
    const myToken = ++gifRequestToken;
    gifGrid.innerHTML = '<div class="empty-state small"><p class="empty-sub">Loading…</p></div>';
    try{
        const res = await fetch(url);
        const json = await res.json();
        if (myToken !== gifRequestToken) return; // a newer request already landed
        renderGifGrid(json.data || []);
    } catch(ex){
        console.error(ex);
        if (myToken !== gifRequestToken) return;
        gifGrid.innerHTML = '<div class="empty-state small"><p class="empty-sub">Could not load GIFs. Check your GIPHY API key.</p></div>';
    }
}
function fetchTrendingGifs(){
    giphyFetch(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=g`);
}
function searchGifs(term){
    if (!term){ fetchTrendingGifs(); return; }
    giphyFetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(term)}&limit=24&rating=g`);
}
function renderGifGrid(items){
    if (!items.length){
        gifGrid.innerHTML = '<div class="empty-state small"><p class="empty-sub">No GIFs found.</p></div>';
        return;
    }
    const frag = document.createDocumentFragment();
    items.forEach(g => {
        const previewUrl = g.images?.fixed_width_small?.url || g.images?.original?.url;
        const sendUrl    = g.images?.fixed_width?.url || g.images?.original?.url;
        if (!previewUrl || !sendUrl) return;
        const img = document.createElement('img');
        img.src = previewUrl;
        img.loading = 'lazy';
        img.alt = g.title || 'GIF';
        img.addEventListener('click', () => {
            closeGifPopover();
            sendGif(sendUrl);
        });
        frag.appendChild(img);
    });
    gifGrid.replaceChildren(frag);
}
function openGifPopover(){
    gifPopover.classList.remove('hidden');
    fetchTrendingGifs();
    setTimeout(() => $('#gif-search-input').focus(), 50);
}
function closeGifPopover(){
    gifPopover.classList.add('hidden');
    $('#gif-search-input').value = '';
}
$('#btn-gif').addEventListener('click', () => {
    gifPopover.classList.contains('hidden') ? openGifPopover() : closeGifPopover();
});
$('#gif-search-input').addEventListener('input', e => {
    clearTimeout(gifSearchDebounce);
    const term = e.target.value.trim();
    gifSearchDebounce = setTimeout(() => searchGifs(term), 350);
});
document.addEventListener('click', e => {
    if (gifPopover.classList.contains('hidden')) return;
    if (gifPopover.contains(e.target) || e.target.closest('#btn-gif')) return;
    closeGifPopover();
});

async function sendGif(url){
    if (!state.currentChatId) return;
    try{
        await addDoc(collection(db, 'chats', state.currentChatId, 'messages'), {
            senderId: state.user.uid,
            type: 'gif',
            content: url,
            text: '',
            createdAt: serverTimestamp(),
            seenBy: [state.user.uid]
        });
        await updateDoc(doc(db, 'chats', state.currentChatId), {
            lastMessage: '🎬 GIF',
            lastMessageAt: serverTimestamp(),
            lastSender: state.user.uid,
            typing: null
        });
    } catch(ex){
        console.error(ex);
        toast('Could not send GIF', 'error');
    }
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
    $('#btn-avatar-upload')?.classList.remove('hidden');

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
    $('#btn-avatar-upload')?.classList.add('hidden');
    $('#form-profile').style.display = 'none';
    openModal('modal-profile');
}

/* ================================================================
   22b. Profile picture upload (Firebase Storage → users/{uid}.photoURL)
   ================================================================ */
$('#btn-avatar-upload')?.addEventListener('click', () => $('#avatar-file-input').click());
$('#avatar-file-input')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !state.user) return;

    if (!file.type.startsWith('image/')){
        toast('Please choose an image file', 'error');
        return;
    }
    if (file.size > 8 * 1024 * 1024){
        toast('Image is too large (max 8MB)', 'error');
        return;
    }

    const wrap = $('#avatar-edit-wrap');
    wrap.classList.add('uploading');
    state.avatarUploading = true;
    try{
        const path = `avatars/${state.user.uid}/${Date.now()}_${file.name.replace(/[^\w.\-]/g,'_')}`;
        const sref = storageRef(storage, path);
        const task = uploadBytesResumable(sref, file, { contentType: file.type });
        await new Promise((resolve, reject) => task.on('state_changed', null, reject, resolve));
        const url = await getDownloadURL(task.snapshot.ref);

        await updateDoc(doc(db, 'users', state.user.uid), { photoURL: url });

        // Reflect the change everywhere it's currently visible, instantly —
        // peers see it live via their own peerUnsub/sidebar-row listeners.
        state.profile = { ...state.profile, photoURL: url };
        userCache.set(state.user.uid, state.profile);
        paintAvatar($('#profile-avatar'), state.profile);
        paintAvatar($('#settings-avatar'), state.profile);
        toast('Profile photo updated', 'success');
    } catch(ex){
        console.error(ex);
        toast('Photo upload failed', 'error');
    } finally {
        state.avatarUploading = false;
        wrap.classList.remove('uploading');
    }
});

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
    state.peerRowUnsubs.forEach(fn => { try { fn && fn(); } catch{} });
    state.peerRowUnsubs.clear();
    state.chatsUnsub = state.messagesUnsub = state.peerUnsub = state.typingUnsub = null;
    state.currentChatId = null;
    state.currentPeer = null;
    state.messagesMap.clear();
    state.msgEls.clear();
    state.oldestMsgDoc = null;
    state.hasMoreOlder = true;
    state.chatMeta = {};
    closeChatSearch();
    cancelReply();
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
