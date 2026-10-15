/**
 * cstrsk.de Workspace & Room Booking System
 * Lizenziert unter GNU Affero General Public License v3 (AGPL-3.0)
 * Ein Projekt von https://cstrsk.de
 * Frontend: Mithril.js + Tailwind CSS
 * PWA Installable, Offline-fähig, Barrierefrei (WCAG AA), DSGVO-konform
 */

(function () {
  'use strict';

  // ===========================================================================
  // 1. Core State Management using Mithril.js Streams (m.stream)
  // ===========================================================================
  
  // Resilient stream factory: uses m.stream or provides compliant reactive stream implementation
  const stream = (typeof m !== 'undefined' && m.stream) ? m.stream : function createStream(initial) {
    let val = initial;
    const subscribers = [];
    function s(...args) {
      if (args.length > 0) {
        val = args[0];
        for (let i = 0; i < subscribers.length; i++) {
          subscribers[i](val);
        }
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
        return s;
      }
      return val;
    }
    s.map = function (fn) {
      const derived = createStream(fn(val));
      subscribers.push(newVal => derived(fn(newVal)));
      return derived;
    };
    return s;
  };

  if (!stream.combine) {
    stream.combine = function (combiner, streams) {
      const combined = stream(combiner(...streams, streams));
      streams.forEach(st => {
        if (st && st.map) {
          st.map(() => combined(combiner(...streams, [st])));
        }
      });
      return combined;
    };
  }

  // Reactive Core Stream Store
  const StreamState = {
    // A. User Authentication Streams
    auth: {
      user$: stream(null),
      csrfToken$: stream(''),
      isAuthenticated$: null, // derived
      userRole$: null,        // derived
      isAdmin$: null,         // derived
      userCredits$: null      // derived
    },

    // B. Resource Data Streams
    resources: {
      list$: stream([]),
      loading$: stream(false),
      filterType$: stream(''),
      filterDate$: stream(new Date().toISOString().slice(0, 10)),
      filterStartTime$: stream('09:00'),
      filterEndTime$: stream('12:00'),
      filterCapacity$: stream(1),
      filterEquipment$: stream([]),
      filterDeskType$: stream(''),
      filtered$: null         // derived
    },

    // C. Current Booking Selection Streams
    booking: {
      selection$: stream(null),
      selectedResource$: null, // derived
      durationHours$: null,    // derived
      estimatedPrice$: null,   // derived
      conflictStatus$: stream(null)
    },

    // D. Application Shell Streams
    app: {
      theme$: stream(localStorage.getItem('cstrsk_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')),
      currentTab$: stream('search'),
      isOnline$: stream(navigator.onLine),
      modal$: stream(null),
      toast$: stream(null)
    }
  };

  // Derive Authentication Reactive Streams
  StreamState.auth.isAuthenticated$ = StreamState.auth.user$.map(u => !!u);
  StreamState.auth.userRole$ = StreamState.auth.user$.map(u => u ? u.role : 'guest');
  StreamState.auth.isAdmin$ = StreamState.auth.userRole$.map(r => r === 'admin' || r === 'staff');
  StreamState.auth.userCredits$ = StreamState.auth.user$.map(u => u ? (u.credits || 0) : 0);

  // Derive Filtered Resources Reactive Stream
  StreamState.resources.filtered$ = stream.combine((listStream, typeStream, capStream, eqStream, deskStream) => {
    const listVal = typeof listStream === 'function' ? listStream() : listStream;
    const typeVal = typeof typeStream === 'function' ? typeStream() : typeStream;
    const capVal = typeof capStream === 'function' ? capStream() : capStream;
    const eqVal = typeof eqStream === 'function' ? eqStream() : eqStream;
    const deskVal = typeof deskStream === 'function' ? deskStream() : deskStream;

    const all = Array.isArray(listVal) ? listVal : [];
    return all.filter(r => {
      if (!r) return false;
      if (typeVal && r.type_id !== typeVal) return false;
      if (capVal > 1 && r.capacity < capVal) return false;
      if (deskVal && r.desk_type !== deskVal) return false;
      if (eqVal && Array.isArray(eqVal) && eqVal.length > 0) {
        if (!eqVal.every(item => (r.equipment || []).includes(item))) return false;
      }
      return true;
    });
  }, [
    StreamState.resources.list$,
    StreamState.resources.filterType$,
    StreamState.resources.filterCapacity$,
    StreamState.resources.filterEquipment$,
    StreamState.resources.filterDeskType$
  ]);

  // Derive Current Booking Selection Reactive Streams
  StreamState.booking.selectedResource$ = StreamState.booking.selection$.map(sel => sel ? sel.resource : null);
  StreamState.booking.durationHours$ = StreamState.booking.selection$.map(sel => {
    if (!sel || !sel.start_time || !sel.end_time) return 0;
    const start = new Date(sel.start_time).getTime();
    const end = new Date(sel.end_time).getTime();
    if (end <= start) return 0;
    return Math.max(0, (end - start) / (3600 * 1000));
  });

  StreamState.booking.estimatedPrice$ = StreamState.booking.selection$.map(sel => {
    if (!sel || !sel.resource || !sel.start_time || !sel.end_time) {
      return { net: 0, tax: 0, gross: 0, hours: 0 };
    }
    const start = new Date(sel.start_time).getTime();
    const end = new Date(sel.end_time).getTime();
    const hours = Math.max(0, (end - start) / (3600 * 1000));
    const r = sel.resource;
    let net = 0;

    if (hours >= 168 && r.weekly_rate > 0) {
      net = Math.ceil(hours / 168) * r.weekly_rate;
    } else if (hours >= 8 && r.daily_rate > 0) {
      net = Math.ceil(hours / 8) * r.daily_rate;
    } else if (hours >= 4 && r.half_day_rate > 0) {
      net = Math.ceil(hours / 4) * r.half_day_rate;
    } else if (r.hourly_rate > 0) {
      net = Math.round(hours * r.hourly_rate * 100) / 100;
    }
    const tax = Math.round((net * 0.19) * 100) / 100;
    const gross = Math.round((net + tax) * 100) / 100;
    return { net, tax, gross, hours };
  });

  // Action Dispatchers for Stream State Management
  StreamState.auth.login = function (userData, csrfToken) {
    StreamState.auth.user$(userData);
    if (csrfToken) StreamState.auth.csrfToken$(csrfToken);
  };
  StreamState.auth.logout = function () {
    StreamState.auth.user$(null);
  };
  
  StreamState.resources.setList = function (resources) {
    StreamState.resources.list$(resources || []);
  };
  StreamState.resources.setLoading = function (isLoading) {
    StreamState.resources.loading$(!!isLoading);
  };
  StreamState.resources.setFilters = function (filters) {
    if (!filters) return;
    if (filters.type_id !== undefined) StreamState.resources.filterType$(filters.type_id);
    if (filters.date !== undefined) StreamState.resources.filterDate$(filters.date);
    if (filters.start_time !== undefined) StreamState.resources.filterStartTime$(filters.start_time);
    if (filters.end_time !== undefined) StreamState.resources.filterEndTime$(filters.end_time);
    if (filters.capacity !== undefined) StreamState.resources.filterCapacity$(filters.capacity);
    if (filters.equipment !== undefined) StreamState.resources.filterEquipment$(filters.equipment);
    if (filters.desk_type !== undefined) StreamState.resources.filterDeskType$(filters.desk_type);
  };

  StreamState.booking.select = function (bookingData) {
    StreamState.booking.selection$(bookingData);
  };
  StreamState.booking.clear = function () {
    StreamState.booking.selection$(null);
    StreamState.booking.conflictStatus$(null);
  };

  // Backward-compatible App State Bridge
  const State = {
    get user() { return StreamState.auth.user$(); },
    set user(v) { StreamState.auth.user$(v); },
    get csrfToken() { return StreamState.auth.csrfToken$(); },
    set csrfToken(v) { StreamState.auth.csrfToken$(v); },
    get theme() { return StreamState.app.theme$(); },
    set theme(v) { StreamState.app.theme$(v); },
    get currentTab() { return StreamState.app.currentTab$(); },
    set currentTab(v) { StreamState.app.currentTab$(v); },
    get isOnline() { return StreamState.app.isOnline$(); },
    set isOnline(v) { StreamState.app.isOnline$(v); },
    pwaPrompt: null,
    isPwaInstalled: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
    
    // Suche & Filter
    get resources() { return StreamState.resources.list$(); },
    set resources(v) { StreamState.resources.list$(v); },
    get filteredResources() { return StreamState.resources.filtered$ ? StreamState.resources.filtered$() : []; },
    get loadingResources() { return StreamState.resources.loading$(); },
    set loadingResources(v) { StreamState.resources.loading$(v); },
    filters: {
      get type_id() { return StreamState.resources.filterType$(); },
      set type_id(v) { StreamState.resources.filterType$(v); },
      get date() { return StreamState.resources.filterDate$(); },
      set date(v) { StreamState.resources.filterDate$(v); },
      get start_time() { return StreamState.resources.filterStartTime$(); },
      set start_time(v) { StreamState.resources.filterStartTime$(v); },
      get end_time() { return StreamState.resources.filterEndTime$(); },
      set end_time(v) { StreamState.resources.filterEndTime$(v); },
      get capacity() { return StreamState.resources.filterCapacity$(); },
      set capacity(v) { StreamState.resources.filterCapacity$(v); },
      get equipment() { return StreamState.resources.filterEquipment$(); },
      set equipment(v) { StreamState.resources.filterEquipment$(v); },
      get desk_type() { return StreamState.resources.filterDeskType$(); },
      set desk_type(v) { StreamState.resources.filterDeskType$(v); },
      search_term: ''
    },

    // Raumplan-Raster
    calendarDate: new Date().toISOString().slice(0, 10),
    calendarTypeFilter: '',
    calendarGrid: null,
    calendarLoading: false,

    // Eigene Buchungen & Warteliste
    myBookings: [],
    loadingBookings: false,
    myWaitlist: [],

    // Admin Dashboard & System Settings
    settings: {},
    isCancelling: false,
    adminTab: 'dashboard',
    adminStats: null,
    adminUsers: [],
    adminAllBookings: [],
    adminBlocks: [],
    adminSettings: {},
    adminQrTestCode: 'CST-2026-MUENSTER1',
    adminQrTestResult: null,

    // Aktives Modal
    get modal() { return StreamState.app.modal$(); },
    set modal(v) {
      StreamState.app.modal$(v);
      if (v && v.type === 'book') {
        StreamState.booking.selection$(v);
      } else if (!v) {
        StreamState.booking.selection$(null);
      }
    },
    
    // Toast Notification
    get toast() { return StreamState.app.toast$(); },
    set toast(v) { StreamState.app.toast$(v); },
    toastTimer: null
  };

  // Toast Helper
  function showToast(message, type = 'info') {
    if (State.toastTimer) clearTimeout(State.toastTimer);
    State.toast = { message, type };
    m.redraw();
    State.toastTimer = setTimeout(() => {
      State.toast = null;
      m.redraw();
    }, 4500);
  }

  // Theme Sync
  function applyTheme() {
    if (State.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('cstrsk_theme', State.theme);
  }
  applyTheme();

  // PWA Install Event Listener
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    State.pwaPrompt = e;
    m.redraw();
  });
  window.addEventListener('appinstalled', () => {
    State.isPwaInstalled = true;
    State.pwaPrompt = null;
    showToast('cstrsk App erfolgreich installiert!', 'success');
    m.redraw();
  });
  window.addEventListener('online', () => {
    State.isOnline = true;
    showToast('Wieder online. Buchungsdaten synchronisiert.', 'success');
    m.redraw();
  });
  window.addEventListener('offline', () => {
    State.isOnline = false;
    showToast('Offline-Modus aktiv. Gespeicherte Buchungen bleiben sichtbar.', 'info');
    m.redraw();
  });

  // ===========================================================================
  // 2. API Communication Layer
  // ===========================================================================
  const API = {
    async request(url, options = {}) {
      options.headers = options.headers || {};
      if (State.csrfToken) {
        options.headers['X-CSRF-Token'] = State.csrfToken;
      }
      
      try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Serverfehler (' + response.status + ')');
        }
        return data;
      } catch (err) {
        throw err;
      }
    },

    async checkAuth() {
      try {
        const data = await this.request('../api/auth.php?action=me');
        State.user = data.user;
        State.csrfToken = data.csrf_token;
      } catch (e) {
        State.user = null;
      }
    },

    async login(email, password) {
      const data = await this.request('../api/auth.php?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      State.user = data.user;
      State.csrfToken = data.csrf_token;
      return data;
    },

    async register(payload) {
      const data = await this.request('../api/auth.php?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      State.user = data.user;
      State.csrfToken = data.csrf_token;
      return data;
    },

    async logout() {
      await this.request('../api/auth.php?action=logout');
      State.user = null;
      showToast('Erfolgreich abgemeldet.', 'info');
      State.currentTab = 'search';
    },

    async loginSso(provider, customData = {}) {
      const data = await this.request('../api/auth.php?action=sso_login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...customData })
      });
      State.user = data.user;
      State.csrfToken = data.csrf_token;
      return data;
    },

    async loginLdap(username, password, domain) {
      const data = await this.request('../api/auth.php?action=ldap_login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, domain })
      });
      State.user = data.user;
      State.csrfToken = data.csrf_token;
      return data;
    },

    async testLdap(ldapConfig = {}) {
      const data = await this.request('../api/admin.php?action=test_ldap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ldapConfig)
      });
      return data;
    },

    async loadResources() {
      State.loadingResources = true;
      try {
        const params = new URLSearchParams();
        if (State.filters.type_id) params.append('type_id', State.filters.type_id);
        if (State.filters.capacity > 1) params.append('capacity', State.filters.capacity);
        if (State.filters.desk_type) params.append('desk_type', State.filters.desk_type);
        if (State.filters.equipment.length > 0) params.append('equipment', State.filters.equipment.join(','));

        if (State.filters.date && State.filters.start_time && State.filters.end_time) {
          params.append('start_utc', `${State.filters.date}T${State.filters.start_time}:00Z`);
          params.append('end_utc', `${State.filters.date}T${State.filters.end_time}:00Z`);
        }

        const data = await this.request(`./api/resources.php?${params.toString()}`);
        State.resources = data.resources || [];
        localStorage.setItem('cstrsk_cached_resources', JSON.stringify(State.resources));
      } catch (e) {
        // Fallback Cache
        const cached = localStorage.getItem('cstrsk_cached_resources');
        if (cached) State.resources = JSON.parse(cached);
      } finally {
        State.loadingResources = false;
        m.redraw();
      }
    },

    async loadCalendarGrid() {
      State.calendarLoading = true;
      try {
        const params = new URLSearchParams();
        params.append('date', State.calendarDate);
        if (State.calendarTypeFilter) params.append('type_id', State.calendarTypeFilter);
        const data = await this.request(`./api/calendar.php?${params.toString()}`);
        State.calendarGrid = data;
      } catch (e) {
        showToast('Fehler beim Laden des Raumplans.', 'error');
      } finally {
        State.calendarLoading = false;
        m.redraw();
      }
    },

    async loadMyBookings() {
      if (!State.user) return;
      State.loadingBookings = true;
      try {
        const data = await this.request('../api/bookings.php');
        State.myBookings = data.bookings || [];
        // Offline-Cache für PWA
        localStorage.setItem('cstrsk_my_bookings_' + State.user.id, JSON.stringify(State.myBookings));
      } catch (e) {
        const cached = localStorage.getItem('cstrsk_my_bookings_' + State.user.id);
        if (cached) {
          State.myBookings = JSON.parse(cached);
          showToast('Offline: Gespeicherte Buchungen geladen.', 'info');
        }
      } finally {
        State.loadingBookings = false;
        m.redraw();
      }
    },

    async createBooking(payload) {
      return await this.request('../api/bookings.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    async cancelBooking(bookingId, reason = 'Vom Nutzer storniert') {
      try {
        return await this.request(`./api/bookings.php?id=${encodeURIComponent(bookingId)}`, {
          method: 'DELETE'
        });
      } catch (err) {
        // Robust fallback to POST action=cancel if DELETE is blocked
        return await this.request('../api/bookings.php?action=cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: bookingId, booking_id: bookingId, reason: reason })
        });
      }
    },

    async checkinCode(code) {
      return await this.request('../api/bookings.php?action=checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ check_in_code: code })
      });
    },

    async joinWaitlist(payload) {
      return await this.request('../api/waitlist.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    async loadSettings() {
      try {
        const res = await this.request('../api/settings.php');
        if (res && res.settings) {
          State.settings = res.settings;
          State.adminSettings = { ...res.settings, ...(State.adminSettings || {}) };
        }
      } catch (e) {
        console.warn('Einstellungen konnten nicht geladen werden:', e);
      }
    },

    async loadAdminData() {
      if (!State.user || (State.user.role !== 'admin' && State.user.role !== 'staff')) return;
      try {
        if (State.adminTab === 'dashboard') {
          const res = await this.request('../api/admin.php?tab=dashboard');
          State.adminStats = res.stats;
        } else if (State.adminTab === 'users') {
          const res = await this.request('../api/admin.php?tab=users');
          State.adminUsers = res.users;
        } else if (State.adminTab === 'bookings') {
          const res = await this.request('../api/bookings.php?all=1');
          State.adminAllBookings = res.bookings;
        } else if (State.adminTab === 'blocks') {
          const res = await this.request('../api/admin.php?tab=blocks');
          State.adminBlocks = res.blocks;
        } else if (State.adminTab === 'settings') {
          const res = await this.request('../api/admin.php?tab=settings');
          State.adminSettings = res.settings;
          State.settings = res.settings;
        }
      } catch (e) {
        showToast('Admin-Daten konnten nicht geladen werden: ' + e.message, 'error');
      } finally {
        m.redraw();
      }
    }
  };

  // ===========================================================================
  // 3. SVG Icons & Micro-Components
  // ===========================================================================
  const Icons = {
    calendar: m('svg', { class: 'w-5 h-5 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' })
    ]),
    search: m('svg', { class: 'w-5 h-5 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
    ]),
    user: m('svg', { class: 'w-5 h-5 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' })
    ]),
    settings: m('svg', { class: 'w-5 h-5 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' }),
      m('circle', { cx: '12', cy: '12', r: '3' })
    ]),
    check: m('svg', { class: 'w-4 h-4 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M5 13l4 4L19 7' })
    ]),
    sun: m('svg', { class: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' })
    ]),
    moon: m('svg', { class: 'w-5 h-5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z' })
    ]),
    download: m('svg', { class: 'w-4 h-4 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
    ]),
    qrcode: m('svg', { class: 'w-5 h-5 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z' })
    ]),
    github: m('svg', { class: 'w-4 h-4 inline', viewBox: '0 0 24 24', fill: 'currentColor' }, [
      m('path', { fillRule: 'evenodd', clipRule: 'evenodd', d: 'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z' })
    ]),
    google: m('svg', { class: 'w-4 h-4 inline', viewBox: '0 0 24 24' }, [
      m('path', { fill: '#4285F4', d: 'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z' }),
      m('path', { fill: '#34A853', d: 'M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z' }),
      m('path', { fill: '#FBBC05', d: 'M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z' }),
      m('path', { fill: '#EA4335', d: 'M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z' })
    ]),
    microsoft: m('svg', { class: 'w-4 h-4 inline', viewBox: '0 0 23 23' }, [
      m('path', { fill: '#f35325', d: 'M1 1h10v10H1z' }),
      m('path', { fill: '#81bc06', d: 'M12 1h10v10H12z' }),
      m('path', { fill: '#05a6f0', d: 'M1 12h10v10H1z' }),
      m('path', { fill: '#ffba08', d: 'M12 12h10v10H12z' })
    ]),
    building: m('svg', { class: 'w-4 h-4 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' })
    ]),
    shield: m('svg', { class: 'w-4 h-4 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' })
    ]),
    key: m('svg', { class: 'w-4 h-4 inline', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      m('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' })
    ])
  };

  // Standard-compliant SVG QR-Code Generator (100% scannable by smartphone cameras)
  function renderLocalSvgQr(content, size = 220) {
    if (typeof window.qrcode === 'function') {
      try {
        const qr = window.qrcode(0, 'M');
        qr.addData(content);
        qr.make();
        const count = qr.getModuleCount();
        const margin = 4;
        const totalSize = count + margin * 2;
        const rects = [];

        // White quiet-zone background (essential for camera contrast)
        rects.push(m('rect', { x: 0, y: 0, width: totalSize, height: totalSize, fill: '#FFFFFF' }));

        for (let r = 0; r < count; r++) {
          for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) {
              rects.push(m('rect', {
                x: c + margin,
                y: r + margin,
                width: 1.05,
                height: 1.05,
                fill: '#0F172A'
              }));
            }
          }
        }

        return m('svg', {
          viewBox: `0 0 ${totalSize} ${totalSize}`,
          class: 'w-52 h-52 mx-auto rounded-lg shadow-sm',
          shapeRendering: 'crispEdges'
        }, rects);
      } catch (e) {
        console.warn('Local QR generation error:', e);
      }
    }

    // Direct proxy fallback to ./api/qrcode.php
    return m('img', {
      src: `./api/qrcode.php?data=${encodeURIComponent(content)}&format=svg&size=${size}`,
      class: 'w-52 h-52 mx-auto object-contain bg-white rounded-lg p-2 border border-gray-200 shadow-sm',
      alt: 'Check-in QR Code'
    });
  }

  // Unified QR-Code Renderer supporting Admin-configured Custom API templates
  function renderRealQr(content, booking, size = 260) {
    const s = State.settings || {};
    const provider = s.qr_provider || 'internal';
    const template = s.qr_api_url_template || 'https://api.qrserver.com/v1/create-qr-code/?size={size}x{size}&data={data}';

    if (provider === 'custom_api' && template) {
      const code = booking ? (booking.check_in_code || booking.id) : content;
      const bNumber = booking ? (booking.booking_number || '') : '';
      const url = template
        .replace(/\{data\}/g, encodeURIComponent(content))
        .replace(/\{code\}/g, encodeURIComponent(code))
        .replace(/\{booking_number\}/g, encodeURIComponent(bNumber))
        .replace(/\{size\}/g, String(size));

      return m('div', { class: 'flex flex-col items-center justify-center p-3 bg-white rounded-xl shadow-inner border border-gray-200' }, [
        m('img', {
          src: url,
          alt: 'Check-in QR-Code',
          class: 'w-52 h-52 object-contain',
          onerror: (e) => {
            // Graceful fallback to local SVG if custom API fails or is unreachable
            e.target.style.display = 'none';
            if (e.target.nextElementSibling) e.target.nextElementSibling.style.display = 'block';
          }
        }),
        m('div', { style: 'display:none;' }, renderLocalSvgQr(content, size))
      ]);
    }

    if (provider === 'server_proxy') {
      const url = `./api/qrcode.php?data=${encodeURIComponent(content)}&size=${size}&format=svg`;
      return m('div', { class: 'flex items-center justify-center p-3 bg-white rounded-xl shadow-inner border border-gray-200' }, [
        m('img', {
          src: url,
          alt: 'Check-in QR-Code',
          class: 'w-52 h-52 object-contain',
          onerror: (e) => {
            e.target.style.display = 'none';
            if (e.target.nextElementSibling) e.target.nextElementSibling.style.display = 'block';
          }
        }),
        m('div', { style: 'display:none;' }, renderLocalSvgQr(content, size))
      ]);
    }

    // Default: Clean local standard SVG QR code
    return m('div', { class: 'flex items-center justify-center p-3 bg-white rounded-xl shadow-inner border border-gray-200' }, [
      renderLocalSvgQr(content, size)
    ]);
  }

  // ===========================================================================
  // 4. Header & Navigation (cstrsk.de Branding)
  // ===========================================================================
  const Header = {
    view() {
      const isDark = State.theme === 'dark';

      return m('header', {
        class: 'sticky top-0 z-40 bg-white/95 dark:bg-[#0F172A]/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 transition-colors'
      }, [
        m('div', { class: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between' }, [
          // Logo & Branding
          m('div', {
            class: 'flex items-center gap-3 cursor-pointer',
            onclick: () => { State.currentTab = 'search'; }
          }, [
            m('img', { src: '/logo.svg', alt: 'cstrsk.de Logo', class: 'h-8 w-auto' }),
            m('span', {
              class: 'hidden sm:inline-block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-l border-gray-300 dark:border-gray-700 pl-3'
            }, 'Workspace Booking')
          ]),

          // Desktop Nav Tabs
          m('nav', { class: 'hidden md:flex items-center space-x-1 lg:space-x-2' }, [
            m('button', {
              class: `px-3 py-2 rounded-lg text-sm font-medium transition ${
                State.currentTab === 'search'
                  ? 'bg-[#1A73E8] text-white shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1E2937]'
              }`,
              onclick: () => { State.currentTab = 'search'; }
            }, 'Ressourcen & Suche'),

            m('button', {
              class: `px-3 py-2 rounded-lg text-sm font-medium transition ${
                State.currentTab === 'calendar'
                  ? 'bg-[#1A73E8] text-white shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1E2937]'
              }`,
              onclick: () => {
                State.currentTab = 'calendar';
                API.loadCalendarGrid();
              }
            }, 'Raumplan-Raster'),

            State.user ? m('button', {
              class: `px-3 py-2 rounded-lg text-sm font-medium transition relative ${
                State.currentTab === 'my-bookings'
                  ? 'bg-[#1A73E8] text-white shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1E2937]'
              }`,
              onclick: () => {
                State.currentTab = 'my-bookings';
                API.loadMyBookings();
              }
            }, [
              'Meine Buchungen',
              State.myBookings.length > 0 ? m('span', {
                class: 'ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-[#F59E0B] text-white'
              }, State.myBookings.length) : null
            ]) : null,

            (State.user && (State.user.role === 'admin' || State.user.role === 'staff')) ? m('button', {
              class: `px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
                State.currentTab === 'admin'
                  ? 'bg-[#1A73E8] text-white shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1E2937]'
              }`,
              onclick: () => {
                State.currentTab = 'admin';
                API.loadAdminData();
              }
            }, [
              m('span', { class: 'w-2 h-2 rounded-full bg-[#F59E0B]' }),
              'Admin-Bereich'
            ]) : null
          ]),

          // User Controls & Actions
          m('div', { class: 'flex items-center gap-2' }, [
            // Dark Mode Toggle
            m('button', {
              class: 'p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1E2937] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]',
              'aria-label': 'Farbschema wechseln',
              onclick: () => {
                State.theme = State.theme === 'light' ? 'dark' : 'light';
                applyTheme();
              }
            }, isDark ? Icons.sun : Icons.moon),

            // PWA Install Prompt Button
            State.pwaPrompt && !State.isPwaInstalled ? m('button', {
              class: 'hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1A73E8] text-white hover:bg-[#1557B0] shadow transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1A73E8]',
              onclick: async () => {
                State.pwaPrompt.prompt();
                const choice = await State.pwaPrompt.userChoice;
                if (choice.outcome === 'accepted') {
                  State.isPwaInstalled = true;
                  State.pwaPrompt = null;
                }
              }
            }, [
              Icons.download,
              'App installieren'
            ]) : null,

            // Login / User Dropdown
            State.user ? m('div', { class: 'flex items-center gap-2 pl-2 border-l border-gray-200 dark:border-gray-700' }, [
              m('div', { class: 'hidden lg:block text-right' }, [
                m('div', { class: 'text-xs font-semibold text-gray-900 dark:text-white truncate max-w-[120px]' }, State.user.name),
                m('div', { class: 'text-[10px] text-[#1A73E8] dark:text-[#60A5FA]' }, `${State.user.credits || 0} Credits · ${State.user.role}`)
              ]),
              m('button', {
                class: 'px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-[#1E2937] transition text-red-600 dark:text-red-400',
                onclick: () => API.logout()
              }, 'Abmelden')
            ]) : m('div', { class: 'flex items-center gap-1.5' }, [
              m('button', {
                class: 'px-3 py-1.5 text-xs font-semibold text-[#1A73E8] dark:text-[#60A5FA] hover:underline',
                onclick: () => { State.modal = { type: 'login' }; }
              }, 'Anmelden'),
              m('button', {
                class: 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1A73E8] text-white hover:bg-[#1557B0] transition shadow-sm',
                onclick: () => { State.modal = { type: 'register' }; }
              }, 'Registrieren')
            ])
          ])
        ]),

        // Mobile Sub-Navigation Bar
        m('div', { class: 'md:hidden flex border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0F172A] overflow-x-auto text-xs px-2 py-1.5 gap-1' }, [
          m('button', {
            class: `flex-1 py-1.5 text-center font-medium rounded-md whitespace-nowrap ${
              State.currentTab === 'search' ? 'bg-[#1A73E8] text-white' : 'text-gray-600 dark:text-gray-400'
            }`,
            onclick: () => { State.currentTab = 'search'; }
          }, 'Ressourcen'),
          m('button', {
            class: `flex-1 py-1.5 text-center font-medium rounded-md whitespace-nowrap ${
              State.currentTab === 'calendar' ? 'bg-[#1A73E8] text-white' : 'text-gray-600 dark:text-gray-400'
            }`,
            onclick: () => {
              State.currentTab = 'calendar';
              API.loadCalendarGrid();
            }
          }, 'Raumplan'),
          State.user ? m('button', {
            class: `flex-1 py-1.5 text-center font-medium rounded-md whitespace-nowrap ${
              State.currentTab === 'my-bookings' ? 'bg-[#1A73E8] text-white' : 'text-gray-600 dark:text-gray-400'
            }`,
            onclick: () => {
              State.currentTab = 'my-bookings';
              API.loadMyBookings();
            }
          }, `Buchungen (${State.myBookings.length})`) : null,
          (State.user && (State.user.role === 'admin' || State.user.role === 'staff')) ? m('button', {
            class: `flex-1 py-1.5 text-center font-medium rounded-md whitespace-nowrap ${
              State.currentTab === 'admin' ? 'bg-[#1A73E8] text-white' : 'text-gray-600 dark:text-gray-400'
            }`,
            onclick: () => {
              State.currentTab = 'admin';
              API.loadAdminData();
            }
          }, 'Admin') : null
        ])
      ]);
    }
  };

  // ===========================================================================
  // 5. Views
  // ===========================================================================

  // VIEW A: Ressourcen & Verfügbarkeitssuche
  const SearchView = {
    oninit() {
      API.loadResources();
    },
    view() {
      return m('div', { class: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6' }, [
        // Filter-Bar
        m('div', {
          class: 'bg-white dark:bg-[#1E2937] rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-5 mb-8'
        }, [
          m('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end' }, [
            // 1. Ressourcentyp
            m('div', [
              m('label', { class: 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1' }, 'Ressourcentyp'),
              m('select', {
                class: 'w-full px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-[#0F172A] border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#1A73E8]',
                value: State.filters.type_id,
                onchange: (e) => {
                  State.filters.type_id = e.target.value;
                  API.loadResources();
                }
              }, [
                m('option', { value: '' }, 'Alle Typen (Räume, Tische, Desks)'),
                m('option', { value: 'room' }, 'Seminarräume'),
                m('option', { value: 'desk' }, 'Einzeltische'),
                m('option', { value: 'workspace' }, 'Shared Workspace (Desks)')
              ])
            ]),

            // 2. Datum
            m('div', [
              m('label', { class: 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1' }, 'Datum'),
              m('input', {
                type: 'date',
                class: 'w-full px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-[#0F172A] border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#1A73E8]',
                value: State.filters.date,
                min: new Date().toISOString().slice(0, 10),
                onchange: (e) => {
                  State.filters.date = e.target.value;
                  API.loadResources();
                }
              })
            ]),

            // 3. Zeitfenster (Start & Ende)
            m('div', [
              m('label', { class: 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1' }, 'Zeitraum (Uhrzeit)'),
              m('div', { class: 'grid grid-cols-2 gap-2' }, [
                m('input', {
                  type: 'time',
                  class: 'w-full px-2 py-2 rounded-lg text-sm bg-gray-50 dark:bg-[#0F172A] border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white',
                  value: State.filters.start_time,
                  onchange: (e) => {
                    State.filters.start_time = e.target.value;
                    API.loadResources();
                  }
                }),
                m('input', {
                  type: 'time',
                  class: 'w-full px-2 py-2 rounded-lg text-sm bg-gray-50 dark:bg-[#0F172A] border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white',
                  value: State.filters.end_time,
                  onchange: (e) => {
                    State.filters.end_time = e.target.value;
                    API.loadResources();
                  }
                })
              ])
            ]),

            // 4. Personenanzahl / Kapazität
            m('div', [
              m('label', { class: 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1' }, 'Mindestplätze'),
              m('input', {
                type: 'number',
                min: '1',
                max: '50',
                class: 'w-full px-3 py-2 rounded-lg text-sm bg-gray-50 dark:bg-[#0F172A] border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white',
                value: State.filters.capacity,
                oninput: (e) => {
                  State.filters.capacity = parseInt(e.target.value) || 1;
                  API.loadResources();
                }
              })
            ]),

            // 5. Button & Schnellfilter
            m('div', [
              m('button', {
                class: 'w-full py-2.5 px-4 rounded-lg bg-[#1A73E8] text-white text-sm font-semibold hover:bg-[#1557B0] transition shadow flex items-center justify-center gap-2',
                onclick: () => API.loadResources()
              }, [
                Icons.search,
                'Verfügbarkeit prüfen'
              ])
            ])
          ]),

          // Ausstattungs-Checkboxen
          m('div', { class: 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-800 flex flex-wrap items-center gap-3 text-xs' }, [
            m('span', { class: 'font-semibold text-gray-600 dark:text-gray-400' }, 'Ausstattung:'),
            ['beamer', 'whiteboard', 'video', 'catering', 'monitor', 'docking', 'power'].map((eq) => {
              const labels = {
                beamer: 'Beamer / 4K Display',
                whiteboard: 'Whiteboard',
                video: 'Videokonferenz',
                catering: 'Catering möglich',
                monitor: 'Zusatzmonitor',
                docking: 'USB-C Dock',
                power: '230V Steckdosen'
              };
              const isChecked = State.filters.equipment.includes(eq);
              return m('label', { class: 'inline-flex items-center gap-1.5 cursor-pointer bg-gray-100 dark:bg-[#0F172A] px-2.5 py-1 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#334155]' }, [
                m('input', {
                  type: 'checkbox',
                  class: 'rounded text-[#1A73E8] focus:ring-[#1A73E8]',
                  checked: isChecked,
                  onchange: () => {
                    if (isChecked) {
                      State.filters.equipment = State.filters.equipment.filter(e => e !== eq);
                    } else {
                      State.filters.equipment.push(eq);
                    }
                    API.loadResources();
                  }
                }),
                labels[eq]
              ]);
            })
          ])
        ]),

        // Ergebnisliste / Grid
        m('div', { class: 'mb-4 flex items-center justify-between' }, [
          m('h2', { class: 'text-xl font-bold text-[#0F172A] dark:text-white' }, [
            'Verfügbare Ressourcen ',
            m('span', { class: 'text-sm font-normal text-gray-500' }, `(${State.resources.length} gefunden)`)
          ]),
          m('span', { class: 'text-xs text-gray-500' }, `Zeitfenster: ${State.filters.start_time} - ${State.filters.end_time} Uhr (${State.filters.date})`)
        ]),

        State.loadingResources ? m('div', { class: 'py-12 text-center text-gray-500' }, 'Lade Ressourcen...') :
        State.resources.length === 0 ? m('div', {
          class: 'p-12 text-center bg-white dark:bg-[#1E2937] rounded-xl border border-gray-200 dark:border-gray-800'
        }, [
          m('p', { class: 'text-gray-500 dark:text-gray-400 mb-2' }, 'Keine Ressourcen für Ihre Filterkriterien gefunden.'),
          m('button', {
            class: 'text-sm text-[#1A73E8] dark:text-[#60A5FA] font-semibold hover:underline',
            onclick: () => {
              State.filters = { type_id: '', date: new Date().toISOString().slice(0, 10), start_time: '09:00', end_time: '12:00', capacity: 1, equipment: [], desk_type: '', search_term: '' };
              API.loadResources();
            }
          }, 'Filter zurücksetzen')
        ]) :
        m('div', { class: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' }, [
          State.resources.map((res) => {
            const isAvail = res.is_available !== false;
            return m('div', {
              class: 'bg-white dark:bg-[#1E2937] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition flex flex-col'
            }, [
              // Bild mit Badge
              m('div', { class: 'relative h-44 bg-gray-200 dark:bg-gray-700 overflow-hidden' }, [
                m('img', {
                  src: res.image_url || 'https://images.unsplash.com/photo-1517502884422-41eaead166d4?auto=format&fit=crop&w=800&q=80',
                  alt: res.title,
                  class: 'w-full h-full object-cover'
                }),
                // Typ-Badge
                m('div', {
                  class: 'absolute top-3 left-3 px-2.5 py-1 rounded-md text-xs font-semibold bg-[#0F172A]/85 text-white backdrop-blur-sm'
                }, res.type_name),
                // Status-Badge (Ampelfarben)
                m('div', {
                  class: `absolute top-3 right-3 px-2.5 py-1 rounded-md text-xs font-bold text-white shadow ${
                    isAvail ? 'bg-[#10B981]' : 'bg-[#6B7280]'
                  }`
                }, isAvail ? 'Frei' : 'Belegt')
              ]),

              // Card Body
              m('div', { class: 'p-5 flex-1 flex flex-col' }, [
                m('div', { class: 'flex-1' }, [
                  m('h3', { class: 'text-lg font-bold text-gray-900 dark:text-white' }, res.title),
                  m('p', { class: 'text-xs text-[#1A73E8] dark:text-[#60A5FA] font-medium mb-2' }, res.location),
                  m('p', { class: 'text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mb-3' }, res.description),

                  // Eckdaten (Kapazität, Puffer)
                  m('div', { class: 'flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-3' }, [
                    m('span', `👥 Bis zu ${res.capacity} Personen`),
                    m('span', `⏱ Puffer: ${res.buffer_minutes} Min.`),
                    res.requires_approval ? m('span', { class: 'text-[#F59E0B] font-medium' }, '⚠️ Genehmigung') : null
                  ]),

                  // Ausstattungs-Tags
                  m('div', { class: 'flex flex-wrap gap-1 mb-4' }, [
                    (res.equipment || []).map((eq) => m('span', {
                      class: 'px-2 py-0.5 rounded text-[11px] bg-gray-100 dark:bg-[#0F172A] text-gray-600 dark:text-gray-300'
                    }, eq))
                  ])
                ]),

                // Footer & Preis
                m('div', { class: 'pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between' }, [
                  m('div', [
                    m('div', { class: 'text-xs text-gray-500' }, 'Tarif ab:'),
                    m('div', { class: 'text-base font-bold text-[#0F172A] dark:text-white' }, [
                      res.hourly_rate > 0 ? `${res.hourly_rate} € / Std.` : `${res.daily_rate} € / Tag`,
                      m('span', { class: 'text-[10px] text-gray-400 font-normal ml-1' }, 'netto')
                    ])
                  ]),

                  isAvail ? m('button', {
                    class: 'px-4 py-2 rounded-lg bg-[#1A73E8] text-white text-xs font-semibold hover:bg-[#1557B0] transition shadow-sm',
                    onclick: () => {
                      State.modal = {
                        type: 'book',
                        resource: res,
                        start_time: `${State.filters.date}T${State.filters.start_time}:00Z`,
                        end_time: `${State.filters.date}T${State.filters.end_time}:00Z`
                      };
                    }
                  }, 'Jetzt buchen') : m('button', {
                    class: 'px-3 py-2 rounded-lg border border-[#F59E0B] text-[#F59E0B] hover:bg-[#F59E0B] hover:text-white text-xs font-semibold transition',
                    onclick: () => {
                      State.modal = {
                        type: 'waitlist',
                        resource: res,
                        start_time: `${State.filters.date}T${State.filters.start_time}:00Z`,
                        end_time: `${State.filters.date}T${State.filters.end_time}:00Z`
                      };
                    }
                  }, 'Warteliste')
                ])
              ])
            ]);
          })
        ])
      ]);
    }
  };

  // VIEW B: Raumplan-Raster (Kalenderübersicht)
  const CalendarView = {
    oninit() {
      API.loadCalendarGrid();
    },
    view() {
      const gridData = State.calendarGrid;

      return m('div', { class: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6' }, [
        // Header Controls
        m('div', { class: 'flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6' }, [
          m('div', [
            m('h2', { class: 'text-xl font-bold text-[#0F172A] dark:text-white' }, 'Raumplan-Gesamtübersicht'),
            m('p', { class: 'text-xs text-gray-500' }, 'Ressourcen als Zeilen, Uhrzeiten als Spalten (07:00 – 20:00 Uhr)')
          ]),

          m('div', { class: 'flex items-center gap-3' }, [
            m('input', {
              type: 'date',
              class: 'px-3 py-2 rounded-lg text-sm bg-white dark:bg-[#1E2937] border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white shadow-sm',
              value: State.calendarDate,
              onchange: (e) => {
                State.calendarDate = e.target.value;
                API.loadCalendarGrid();
              }
            }),
            m('select', {
              class: 'px-3 py-2 rounded-lg text-sm bg-white dark:bg-[#1E2937] border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white shadow-sm',
              value: State.calendarTypeFilter,
              onchange: (e) => {
                State.calendarTypeFilter = e.target.value;
                API.loadCalendarGrid();
              }
            }, [
              m('option', { value: '' }, 'Alle Ressourcen'),
              m('option', { value: 'room' }, 'Nur Seminarräume'),
              m('option', { value: 'desk' }, 'Nur Tische'),
              m('option', { value: 'workspace' }, 'Nur Workspace')
            ]),
            m('button', {
              class: 'p-2 rounded-lg bg-gray-100 dark:bg-[#1E2937] hover:bg-gray-200 dark:hover:bg-[#334155]',
              onclick: () => API.loadCalendarGrid()
            }, '🔄')
          ])
        ]),

        // Legende
        m('div', { class: 'flex flex-wrap items-center gap-4 text-xs mb-4 p-3 bg-white dark:bg-[#1E2937] rounded-lg border border-gray-200 dark:border-gray-800' }, [
          m('span', { class: 'font-semibold text-gray-500' }, 'Status-Legende:'),
          m('div', { class: 'flex items-center gap-1.5' }, [
            m('span', { class: 'w-3 h-3 rounded-full bg-[#10B981]' }),
            'Frei'
          ]),
          m('div', { class: 'flex items-center gap-1.5' }, [
            m('span', { class: 'w-3 h-3 rounded-full bg-[#6B7280]' }),
            'Belegt'
          ]),
          m('div', { class: 'flex items-center gap-1.5' }, [
            m('span', { class: 'w-3 h-3 rounded-full bg-[#1A73E8] dark:bg-[#60A5FA]' }),
            'Eigene Buchung'
          ]),
          m('div', { class: 'flex items-center gap-1.5' }, [
            m('span', { class: 'w-3 h-3 rounded-full bg-[#F59E0B]' }),
            'Genehmigung ausstehend'
          ]),
          m('div', { class: 'flex items-center gap-1.5' }, [
            m('span', { class: 'w-3 h-3 rounded-full bg-red-400' }),
            'Gesperrt / Wartung'
          ])
        ]),

        // Das Raumplan-Raster
        State.calendarLoading ? m('div', { class: 'py-16 text-center text-gray-500' }, 'Lade Raumplan-Daten...') :
        !gridData || !gridData.grid ? m('div', { class: 'py-16 text-center text-gray-500' }, 'Keine Daten geladen.') :
        m('div', { class: 'bg-white dark:bg-[#1E2937] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-x-auto' }, [
          m('table', { class: 'w-full text-left border-collapse text-xs min-w-[900px]' }, [
            m('thead', [
              m('tr', { class: 'bg-gray-100 dark:bg-[#0F172A] border-b border-gray-200 dark:border-gray-800' }, [
                m('th', { class: 'p-3 w-56 font-bold text-gray-700 dark:text-gray-300 sticky left-0 bg-gray-100 dark:bg-[#0F172A] z-10' }, 'Ressource'),
                gridData.hours.map((hour) => m('th', { class: 'p-2 text-center font-semibold text-gray-600 dark:text-gray-400 border-l border-gray-200 dark:border-gray-800' }, hour))
              ])
            ]),
            m('tbody', [
              gridData.grid.map((row) => {
                const res = row.resource;
                return m('tr', { class: 'border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-[#334155]/40' }, [
                  // Ressourcen-Zelle (sticky links)
                  m('td', { class: 'p-3 sticky left-0 bg-white dark:bg-[#1E2937] z-10 border-r border-gray-200 dark:border-gray-800' }, [
                    m('div', { class: 'font-bold text-gray-900 dark:text-white truncate max-w-[200px]' }, res.title),
                    m('div', { class: 'text-[11px] text-gray-500 truncate max-w-[200px]' }, `${res.location} · max. ${res.capacity} P.`)
                  ]),

                  // Stunden-Slots
                  row.slots.map((slot) => {
                    let bgClass = 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/30';
                    let tooltip = `${res.title} (${slot.time} Uhr): Frei`;

                    if (slot.state === 'own_booking') {
                      bgClass = 'bg-[#1A73E8] text-white font-semibold';
                      tooltip = `Ihre Buchung: ${slot.details ? slot.details.title : ''}`;
                    } else if (slot.state === 'pending_approval') {
                      bgClass = 'bg-[#F59E0B] text-white font-semibold';
                      tooltip = 'Warten auf Admin-Genehmigung';
                    } else if (slot.state === 'busy') {
                      bgClass = 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300';
                      tooltip = `Belegt: ${slot.details ? slot.details.title : ''}`;
                    } else if (slot.state === 'blocked') {
                      bgClass = 'bg-red-200 dark:bg-red-900/40 text-red-800 dark:text-red-300';
                      tooltip = slot.details ? slot.details.title : 'Gesperrt';
                    }

                    return m('td', {
                      class: `p-2 text-center border-l border-gray-200 dark:border-gray-800 cursor-pointer transition select-none ${bgClass}`,
                      title: tooltip,
                      onclick: () => {
                        if (slot.state === 'free') {
                          const nextHour = (parseInt(slot.time.slice(0, 2)) + 1).toString().padStart(2, '0') + ':00';
                          State.modal = {
                            type: 'book',
                            resource: res,
                            start_time: `${State.calendarDate}T${slot.time}:00Z`,
                            end_time: `${State.calendarDate}T${nextHour}:00Z`
                          };
                        } else if (slot.state === 'busy') {
                          showToast(`Dieser Slot ist belegt (${tooltip}). Nutzen Sie die Warteliste.`, 'info');
                        }
                      }
                    }, [
                      slot.state === 'free' ? '—' : (slot.state === 'own_booking' ? '✓' : (slot.state === 'pending_approval' ? '⏳' : '✕'))
                    ]);
                  })
                ]);
              })
            ])
          ])
        ])
      ]);
    }
  };

  // VIEW C: Meine Buchungen (mit Offline-Anzeige & QR-Code Check-in)
  const MyBookingsView = {
    oninit() {
      API.loadMyBookings();
    },
    view() {
      if (!State.user) {
        return m('div', { class: 'max-w-md mx-auto py-16 text-center' }, [
          m('h2', { class: 'text-xl font-bold mb-4' }, 'Bitte melden Sie sich an'),
          m('p', { class: 'text-sm text-gray-500 mb-6' }, 'Um Ihre Buchungen einzusehen oder zu verwalten, ist eine Anmeldung erforderlich.'),
          m('button', {
            class: 'px-4 py-2 rounded-lg bg-[#1A73E8] text-white font-semibold',
            onclick: () => { State.modal = { type: 'login' }; }
          }, 'Jetzt anmelden')
        ]);
      }

      return m('div', { class: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6' }, [
        m('div', { class: 'flex items-center justify-between mb-6' }, [
          m('div', [
            m('h2', { class: 'text-xl font-bold text-[#0F172A] dark:text-white' }, 'Meine Buchungen'),
            m('p', { class: 'text-xs text-gray-500' }, 'Kommende & vergangene Reservierungen, Check-in QR-Codes und Stornierungen')
          ]),
          m('button', {
            class: 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-[#1E2937] hover:bg-gray-200 text-gray-700 dark:text-gray-300',
            onclick: () => API.loadMyBookings()
          }, 'Aktualisieren')
        ]),

        State.loadingBookings ? m('div', { class: 'py-12 text-center text-gray-500' }, 'Lade Buchungen...') :
        State.myBookings.length === 0 ? m('div', {
          class: 'p-12 text-center bg-white dark:bg-[#1E2937] rounded-xl border border-gray-200 dark:border-gray-800'
        }, [
          m('p', { class: 'text-gray-500 dark:text-gray-400 mb-4' }, 'Sie haben aktuell noch keine Buchungen.'),
          m('button', {
            class: 'px-4 py-2 rounded-lg bg-[#1A73E8] text-white text-sm font-semibold',
            onclick: () => { State.currentTab = 'search'; }
          }, 'Jetzt Raum oder Arbeitsplatz buchen')
        ]) :
        m('div', { class: 'space-y-4' }, [
          State.myBookings.map((b) => {
            const isCancelled = b.status === 'cancelled';
            const isCheckedIn = b.status === 'checked_in';
            const isPending = b.status === 'pending_approval';
            const startLocal = new Date(b.start_time).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const endLocal = new Date(b.end_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

            return m('div', {
              class: `bg-white dark:bg-[#1E2937] rounded-xl p-5 border shadow-sm transition ${
                isCancelled ? 'border-gray-200 dark:border-gray-800 opacity-60' : 'border-gray-200 dark:border-gray-800'
              }`
            }, [
              m('div', { class: 'flex flex-col md:flex-row md:items-center justify-between gap-4' }, [
                m('div', { class: 'flex-1' }, [
                  m('div', { class: 'flex items-center gap-2 mb-1' }, [
                    m('span', { class: 'text-xs font-bold text-[#1A73E8] dark:text-[#60A5FA]' }, b.booking_number),
                    m('span', {
                      class: `px-2 py-0.5 rounded text-[11px] font-bold ${
                        isCheckedIn ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' :
                        isPending ? 'bg-[#F59E0B] text-white' :
                        isCancelled ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' :
                        'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                      }`
                    }, isCheckedIn ? 'Eingecheckt' : isPending ? 'Ausstehend' : isCancelled ? 'Storniert' : 'Bestätigt')
                  ]),
                  m('h3', { class: 'text-base font-bold text-gray-900 dark:text-white' }, b.resource_title),
                  m('p', { class: 'text-xs text-gray-500 mb-2' }, `${b.resource_location} · Zweck: ${b.title}`),
                  m('div', { class: 'text-xs text-gray-700 dark:text-gray-300 flex flex-wrap gap-4' }, [
                    m('span', `📅 ${startLocal} - ${endLocal} Uhr`),
                    m('span', `👥 ${b.attendees_count} Person(en)`),
                    m('span', `💶 ${parseFloat(b.total_price_gross).toFixed(2)} € brutto (inkl. 19% MwSt.)`)
                  ])
                ]),

                // Buttons / Actions
                m('div', { class: 'flex flex-wrap items-center gap-2' }, [
                  // QR-Code Check-in Button
                  !isCancelled ? m('button', {
                    class: 'px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-[#0F172A] flex items-center gap-1',
                    onclick: () => {
                      State.modal = { type: 'qr', booking: b };
                    }
                  }, [
                    Icons.qrcode,
                    'QR-Code Check-in'
                  ]) : null,

                  // ICS Kalenderdatei Download
                  m('a', {
                    href: `./api/export.php?booking_id=${b.id}&format=ics`,
                    download: `termin_${b.booking_number}.ics`,
                    class: 'px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-[#0F172A] flex items-center gap-1'
                  }, [
                    Icons.calendar,
                    'ICS-Kalender'
                  ]),

                  // Rechnung Drucken / PDF
                  m('a', {
                    href: `./api/invoice.php?booking_id=${b.id}`,
                    target: '_blank',
                    class: 'px-3 py-1.5 rounded-lg border border-[#1A73E8] text-[#1A73E8] dark:text-[#60A5FA] text-xs font-semibold hover:bg-[#1A73E8]/10 flex items-center gap-1'
                  }, 'Rechnung'),

                  // Stornieren
                  (!isCancelled && !isCheckedIn) ? m('button', {
                    class: 'px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-100 transition flex items-center gap-1',
                    onclick: () => {
                      State.modal = { type: 'cancel_confirm', booking: b };
                    }
                  }, 'Stornieren') : null
                ])
              ])
            ]);
          })
        ])
      ]);
    }
  };

  // VIEW D: Admin Dashboard & Management
  const AdminView = {
    oninit() {
      API.loadAdminData();
    },
    view() {
      if (!State.user || (State.user.role !== 'admin' && State.user.role !== 'staff')) {
        return m('div', { class: 'max-w-md mx-auto py-16 text-center text-red-600' }, 'Zugriff verweigert.');
      }

      return m('div', { class: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6' }, [
        m('div', { class: 'flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6' }, [
          m('div', [
            m('h2', { class: 'text-xl font-bold text-[#0F172A] dark:text-white' }, 'Administrator-Konsole'),
            m('p', { class: 'text-xs text-gray-500' }, 'Auslastung, Genehmigungsworkflow, Ressourcen-CRUD, Nutzerverwaltung und CSV-Export')
          ]),
          m('div', { class: 'flex items-center gap-2' }, [
            m('a', {
              href: '../api/export.php?format=csv',
              download: 'cstrsk_buchungen.csv',
              class: 'px-3 py-2 rounded-lg bg-[#1A73E8] text-white text-xs font-semibold hover:bg-[#1557B0] transition shadow flex items-center gap-1.5'
            }, [
              Icons.download,
              'CSV-Export aller Buchungen'
            ])
          ])
        ]),

        // Admin Tab-Leiste
        m('div', { class: 'flex border-b border-gray-200 dark:border-gray-800 mb-6 gap-2 overflow-x-auto text-xs' }, [
          [
            { id: 'dashboard', label: '📊 Dashboard & KPIs' },
            { id: 'bookings', label: '📋 Alle Buchungen' },
            { id: 'resources', label: '🏢 Ressourcen-CRUD' },
            { id: 'users', label: '👥 Nutzer & Rollen' },
            { id: 'blocks', label: '🔒 Sperrzeiten / Feiertage' },
            { id: 'settings', label: '⚙️ Buchungsregeln' }
          ].map((t) => m('button', {
            class: `py-2.5 px-4 font-semibold border-b-2 transition whitespace-nowrap ${
              State.adminTab === t.id
                ? 'border-[#1A73E8] text-[#1A73E8] dark:text-[#60A5FA]'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900'
            }`,
            onclick: () => {
              State.adminTab = t.id;
              API.loadAdminData();
            }
          }, t.label))
        ]),

        // Tab Content
        State.adminTab === 'dashboard' ? renderAdminDashboard() :
        State.adminTab === 'bookings' ? renderAdminBookings() :
        State.adminTab === 'resources' ? renderAdminResources() :
        State.adminTab === 'users' ? renderAdminUsers() :
        State.adminTab === 'blocks' ? renderAdminBlocks() :
        renderAdminSettings()
      ]);
    }
  };

  function renderAdminDashboard() {
    const stats = State.adminStats;
    if (!stats) return m('div', { class: 'py-12 text-center text-gray-500' }, 'Lade KPI-Daten...');

    return m('div', { class: 'space-y-6' }, [
      // KPI Kacheln
      m('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4' }, [
        m('div', { class: 'bg-white dark:bg-[#1E2937] p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm' }, [
          m('div', { class: 'text-xs text-gray-500 mb-1' }, 'Gesamtbuchungen'),
          m('div', { class: 'text-2xl font-bold text-[#0F172A] dark:text-white' }, stats.total_bookings),
          m('div', { class: 'text-[11px] text-green-600 font-medium mt-1' }, 'Aktiv & bestätigt')
        ]),
        m('div', { class: 'bg-white dark:bg-[#1E2937] p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm' }, [
          m('div', { class: 'text-xs text-gray-500 mb-1' }, 'Ausstehende Genehmigungen'),
          m('div', { class: 'text-2xl font-bold text-[#F59E0B]' }, stats.pending_approvals),
          m('div', { class: 'text-[11px] text-[#F59E0B] font-medium mt-1' }, 'Erfordert manuelle Freigabe')
        ]),
        m('div', { class: 'bg-white dark:bg-[#1E2937] p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm' }, [
          m('div', { class: 'text-xs text-gray-500 mb-1' }, 'Gesamtumsatz (Brutto)'),
          m('div', { class: 'text-2xl font-bold text-[#1A73E8] dark:text-[#60A5FA]' }, `${stats.total_revenue_gross.toFixed(2)} €`),
          m('div', { class: 'text-[11px] text-gray-400 mt-1' }, `Netto: ${stats.total_revenue_net.toFixed(2)} €`)
        ]),
        m('div', { class: 'bg-white dark:bg-[#1E2937] p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm' }, [
          m('div', { class: 'text-xs text-gray-500 mb-1' }, 'No-Show Quote'),
          m('div', { class: 'text-2xl font-bold text-gray-700 dark:text-gray-200' }, `${stats.no_show_rate} %`),
          m('div', { class: 'text-[11px] text-gray-400 mt-1' }, `Auslastung: ~${stats.occupancy_rate}%`)
        ])
      ]),

      // Charts: Wochentags-Verteilung & Top-Ressourcen
      m('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-6' }, [
        // Chart 1: Wochentags-Auslastung (SVG Bar Chart)
        m('div', { class: 'bg-white dark:bg-[#1E2937] p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm' }, [
          m('h3', { class: 'text-sm font-bold text-gray-900 dark:text-white mb-4' }, 'Auslastung nach Wochentagen (Buchungsanzahl)'),
          m('div', { class: 'h-48 flex items-end justify-between gap-3 pt-6 pb-2' }, [
            Object.entries(stats.weekday_counts || {}).map(([day, count]) => {
              const max = 30;
              const heightPercent = Math.max(8, (count / max) * 100);
              return m('div', { class: 'flex-1 flex flex-col items-center gap-1.5 h-full justify-end' }, [
                m('span', { class: 'text-[10px] font-bold text-[#1A73E8] dark:text-[#60A5FA]' }, count),
                m('div', {
                  class: 'w-full rounded-t-md bg-[#1A73E8] hover:bg-[#1557B0] transition',
                  style: { height: `${heightPercent}%` }
                }),
                m('span', { class: 'text-xs text-gray-500 font-semibold' }, day)
              ]);
            })
          ])
        ]),

        // Top Ressourcen
        m('div', { class: 'bg-white dark:bg-[#1E2937] p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm' }, [
          m('h3', { class: 'text-sm font-bold text-gray-900 dark:text-white mb-4' }, 'Top Ressourcen nach Beliebtheit'),
          m('div', { class: 'space-y-3' }, [
            (stats.top_resources || []).map((r, i) => m('div', { class: 'flex items-center justify-between text-xs p-2.5 rounded-lg bg-gray-50 dark:bg-[#0F172A]' }, [
              m('div', { class: 'flex items-center gap-2' }, [
                m('span', { class: 'w-5 h-5 rounded-full bg-[#1A73E8] text-white flex items-center justify-center font-bold text-[10px]' }, i + 1),
                m('span', { class: 'font-semibold text-gray-900 dark:text-white' }, r.title)
              ]),
              m('div', { class: 'text-right' }, [
                m('span', { class: 'font-bold text-[#1A73E8] dark:text-[#60A5FA]' }, `${r.booking_count} Buchungen`),
                m('span', { class: 'text-gray-400 block text-[10px]' }, `${parseFloat(r.revenue || 0).toFixed(2)} €`)
              ])
            ]))
          ])
        ])
      ])
    ]);
  }

  function renderAdminBookings() {
    const list = State.adminAllBookings || [];

    return m('div', { class: 'bg-white dark:bg-[#1E2937] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-x-auto' }, [
      m('table', { class: 'w-full text-left text-xs' }, [
        m('thead', [
          m('tr', { class: 'bg-gray-50 dark:bg-[#0F172A] border-b border-gray-200 dark:border-gray-800' }, [
            m('th', { class: 'p-3' }, 'Nr. & Status'),
            m('th', { class: 'p-3' }, 'Ressource'),
            m('th', { class: 'p-3' }, 'Nutzer'),
            m('th', { class: 'p-3' }, 'Zeitraum (UTC)'),
            m('th', { class: 'p-3' }, 'Brutto'),
            m('th', { class: 'p-3 text-right' }, 'Aktion')
          ])
        ]),
        m('tbody', [
          list.map((b) => {
            const isPending = b.status === 'pending_approval';
            return m('tr', { class: 'border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-[#0F172A]/40' }, [
              m('td', { class: 'p-3' }, [
                m('div', { class: 'font-bold' }, b.booking_number),
                m('span', {
                  class: `px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    b.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                    isPending ? 'bg-[#F59E0B] text-white' :
                    b.status === 'checked_in' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                  }`
                }, b.status)
              ]),
              m('td', { class: 'p-3 font-semibold' }, b.resource_title),
              m('td', { class: 'p-3' }, [
                m('div', { class: 'font-semibold' }, b.user_name),
                m('div', { class: 'text-gray-400' }, b.user_email)
              ]),
              m('td', { class: 'p-3 text-gray-500' }, `${b.start_time.slice(0, 16).replace('T', ' ')} bis ${b.end_time.slice(11, 16)}`),
              m('td', { class: 'p-3 font-bold text-[#1A73E8] dark:text-[#60A5FA]' }, `${parseFloat(b.total_price_gross).toFixed(2)} €`),
              m('td', { class: 'p-3 text-right' }, [
                isPending ? m('div', { class: 'flex justify-end gap-1.5' }, [
                  m('button', {
                    class: 'px-2.5 py-1 rounded bg-green-600 text-white font-semibold hover:bg-green-700',
                    onclick: async () => {
                      await API.request('../api/admin.php?action=approve_booking', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ booking_id: b.id, approved: true })
                      });
                      showToast('Buchung genehmigt.', 'success');
                      API.loadAdminData();
                    }
                  }, 'Freigeben'),
                  m('button', {
                    class: 'px-2.5 py-1 rounded bg-red-600 text-white font-semibold hover:bg-red-700',
                    onclick: async () => {
                      await API.request('../api/admin.php?action=approve_booking', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ booking_id: b.id, approved: false })
                      });
                      showToast('Buchung abgelehnt.', 'info');
                      API.loadAdminData();
                    }
                  }, 'Ablehnen')
                ]) : m('div', { class: 'flex justify-end items-center gap-2' }, [
                  m('a', {
                    href: `./api/invoice.php?booking_id=${b.id}`,
                    target: '_blank',
                    class: 'text-[#1A73E8] dark:text-[#60A5FA] hover:underline font-medium text-xs'
                  }, 'Rechnung'),
                  !isCancelled ? m('button', {
                    class: 'px-2 py-0.5 rounded bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 font-semibold text-xs hover:bg-red-100 transition',
                    onclick: () => {
                      State.modal = { type: 'cancel_confirm', booking: b };
                    }
                  }, 'Stornieren') : null
                ])
              ])
            ]);
          })
        ])
      ])
    ]);
  }

  function renderAdminResources() {
    return m('div', { class: 'space-y-4' }, [
      m('div', { class: 'flex justify-end' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg bg-[#1A73E8] text-white text-xs font-semibold hover:bg-[#1557B0]',
          onclick: () => {
            State.modal = {
              type: 'resource_crud',
              resource: {
                id: '',
                title: '',
                type_id: 'room',
                location: '1. OG',
                capacity: 10,
                hourly_rate: 30,
                daily_rate: 200,
                buffer_minutes: 15,
                requires_approval: 0,
                equipment: ['beamer', 'power']
              }
            };
          }
        }, '+ Neue Ressource anlegen')
      ]),

      m('div', { class: 'bg-white dark:bg-[#1E2937] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-x-auto' }, [
        m('table', { class: 'w-full text-left text-xs' }, [
          m('thead', [
            m('tr', { class: 'bg-gray-50 dark:bg-[#0F172A] border-b border-gray-200 dark:border-gray-800' }, [
              m('th', { class: 'p-3' }, 'Titel & Typ'),
              m('th', { class: 'p-3' }, 'Standort'),
              m('th', { class: 'p-3' }, 'Plätze'),
              m('th', { class: 'p-3' }, 'Preise (Netto)'),
              m('th', { class: 'p-3' }, 'Puffer / Genehmigung'),
              m('th', { class: 'p-3 text-right' }, 'Aktion')
            ])
          ]),
          m('tbody', [
            State.resources.map((r) => m('tr', { class: 'border-b border-gray-100 dark:border-gray-800' }, [
              m('td', { class: 'p-3' }, [
                m('div', { class: 'font-bold' }, r.title),
                m('span', { class: 'text-[11px] text-gray-500' }, r.type_name)
              ]),
              m('td', { class: 'p-3 text-gray-600 dark:text-gray-300' }, r.location),
              m('td', { class: 'p-3' }, `${r.capacity} Pers.`),
              m('td', { class: 'p-3' }, `${r.hourly_rate} €/h · ${r.daily_rate} €/Tag`),
              m('td', { class: 'p-3' }, [
                m('span', `${r.buffer_minutes} Min. Puffer`),
                r.requires_approval ? m('span', { class: 'block text-[#F59E0B] font-semibold' }, 'Genehmigungspflicht') : null
              ]),
              m('td', { class: 'p-3 text-right' }, [
                m('button', {
                  class: 'text-[#1A73E8] dark:text-[#60A5FA] hover:underline font-semibold',
                  onclick: () => {
                    State.modal = { type: 'resource_crud', resource: Object.assign({}, r) };
                  }
                }, 'Bearbeiten')
              ])
            ]))
          ])
        ])
      ])
    ]);
  }

  function renderAdminUsers() {
    return m('div', { class: 'bg-white dark:bg-[#1E2937] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-x-auto' }, [
      m('table', { class: 'w-full text-left text-xs' }, [
        m('thead', [
          m('tr', { class: 'bg-gray-50 dark:bg-[#0F172A] border-b border-gray-200 dark:border-gray-800' }, [
            m('th', { class: 'p-3' }, 'Name & E-Mail'),
            m('th', { class: 'p-3' }, 'Rolle'),
            m('th', { class: 'p-3' }, 'Buchungsguthaben (Credits)'),
            m('th', { class: 'p-3' }, 'Unternehmen'),
            m('th', { class: 'p-3 text-right' }, 'Aktion')
          ])
        ]),
        m('tbody', [
          State.adminUsers.map((u) => m('tr', { class: 'border-b border-gray-100 dark:border-gray-800' }, [
            m('td', { class: 'p-3' }, [
              m('div', { class: 'font-bold' }, u.name),
              m('div', { class: 'text-gray-400' }, u.email)
            ]),
            m('td', { class: 'p-3' }, [
              m('select', {
                class: 'px-2 py-1 rounded bg-gray-50 dark:bg-[#0F172A] border border-gray-300 dark:border-gray-700 font-semibold',
                value: u.role,
                onchange: async (e) => {
                  await API.request('../api/admin.php?action=update_user_role', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: u.id, role: e.target.value })
                  });
                  showToast('Rolle aktualisiert.', 'success');
                  API.loadAdminData();
                }
              }, [
                m('option', { value: 'user' }, 'Nutzer'),
                m('option', { value: 'staff' }, 'Mitarbeiter (Facility)'),
                m('option', { value: 'admin' }, 'Administrator')
              ])
            ]),
            m('td', { class: 'p-3 font-semibold' }, [
              m('input', {
                type: 'number',
                class: 'w-20 px-2 py-1 rounded bg-gray-50 dark:bg-[#0F172A] border border-gray-300 dark:border-gray-700',
                value: u.credits,
                onchange: async (e) => {
                  await API.request('../api/admin.php?action=update_user_role', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: u.id, role: u.role, credits: parseInt(e.target.value) || 0 })
                  });
                  showToast('Credits aktualisiert.', 'success');
                }
              })
            ]),
            m('td', { class: 'p-3 text-gray-500' }, u.company || '—'),
            m('td', { class: 'p-3 text-right' }, [
              m('button', {
                class: 'text-xs text-[#1A73E8] hover:underline font-semibold',
                onclick: () => {
                  State.modal = {
                    type: 'book_for_user',
                    targetUser: u
                  };
                }
              }, 'Buchen im Namen')
            ])
          ]))
        ])
      ])
    ]);
  }

  function renderAdminBlocks() {
    return m('div', { class: 'space-y-4' }, [
      m('div', { class: 'flex justify-end' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg bg-[#1A73E8] text-white text-xs font-semibold hover:bg-[#1557B0]',
          onclick: () => {
            State.modal = { type: 'create_block' };
          }
        }, '+ Neue Sperrzeit / Wartung eintragen')
      ]),

      m('div', { class: 'bg-white dark:bg-[#1E2937] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-x-auto' }, [
        m('table', { class: 'w-full text-left text-xs' }, [
          m('thead', [
            m('tr', { class: 'bg-gray-50 dark:bg-[#0F172A] border-b border-gray-200 dark:border-gray-800' }, [
              m('th', { class: 'p-3' }, 'Grund / Anlass'),
              m('th', { class: 'p-3' }, 'Betroffene Ressource'),
              m('th', { class: 'p-3' }, 'Start (UTC)'),
              m('th', { class: 'p-3' }, 'Ende (UTC)')
            ])
          ]),
          m('tbody', [
            (State.adminBlocks || []).map((b) => m('tr', { class: 'border-b border-gray-100 dark:border-gray-800' }, [
              m('td', { class: 'p-3 font-bold text-red-600' }, b.reason),
              m('td', { class: 'p-3' }, b.resource_title || 'Alle Ressourcen (Gesamtschließung/Feiertag)'),
              m('td', { class: 'p-3 text-gray-500' }, b.start_time),
              m('td', { class: 'p-3 text-gray-500' }, b.end_time)
            ]))
          ])
        ])
      ])
    ]);
  }

  function renderAdminSettings() {
    const s = State.adminSettings || {};
    s.qr_provider = s.qr_provider || 'internal';
    s.qr_api_url_template = s.qr_api_url_template || 'https://api.qrserver.com/v1/create-qr-code/?size={size}x{size}&data={data}';
    s.qr_api_auth_header = s.qr_api_auth_header || '';
    s.qr_content_format = s.qr_content_format || 'url';
    s.show_github_footer_link = s.show_github_footer_link !== undefined ? s.show_github_footer_link : '1';
    s.github_repo_url = s.github_repo_url || 'https://github.com/CSTRSK';
    s.github_footer_text = s.github_footer_text || 'GitHub Repository';
    s.sso_github_enabled = s.sso_github_enabled !== undefined ? s.sso_github_enabled : '1';
    s.sso_google_enabled = s.sso_google_enabled !== undefined ? s.sso_google_enabled : '1';
    s.sso_microsoft_enabled = s.sso_microsoft_enabled !== undefined ? s.sso_microsoft_enabled : '1';
    s.sso_oidc_enabled = s.sso_oidc_enabled !== undefined ? s.sso_oidc_enabled : '1';
    s.sso_default_role = s.sso_default_role || 'user';
    s.ldap_enabled = s.ldap_enabled !== undefined ? s.ldap_enabled : '1';
    s.ldap_server_url = s.ldap_server_url || 'ldaps://ldap.cstrsk.de:636';
    s.ldap_base_dn = s.ldap_base_dn || 'dc=cstrsk,dc=de';
    s.ldap_bind_dn = s.ldap_bind_dn || 'cn=workspace-service,ou=services,dc=cstrsk,dc=de';
    s.ldap_user_search_filter = s.ldap_user_search_filter || '(&(objectClass=user)(|(sAMAccountName={username})(mail={username})))';
    s.ldap_admin_group_dn = s.ldap_admin_group_dn || 'cn=Workspace-Admins,ou=groups,dc=cstrsk,dc=de';
    s.ldap_staff_group_dn = s.ldap_staff_group_dn || 'cn=Workspace-Staff,ou=groups,dc=cstrsk,dc=de';

    return m('div', { class: 'max-w-3xl space-y-6' }, [
      // 1. Allgemeine Buchungsregeln
      m('div', { class: 'bg-white dark:bg-[#1E2937] p-6 rounded-xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-sm' }, [
        m('div', { class: 'border-b pb-3 dark:border-gray-700' }, [
          m('h3', { class: 'text-sm font-bold text-gray-900 dark:text-white' }, 'Systemweite Buchungsregeln & Parameter'),
          m('p', { class: 'text-xs text-gray-500' }, 'Grundlegende Fristen und Zugriffsrechte für Buchungen')
        ]),

        m('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [
          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Gast-Buchungen erlauben'),
            m('select', {
              class: 'w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.allow_guest_booking || '1',
              onchange: (e) => { s.allow_guest_booking = e.target.value; }
            }, [
              m('option', { value: '1' }, 'Ja - Gastbuchung aktiv'),
              m('option', { value: '0' }, 'Nein - Registrierung zwingend erforderlich')
            ])
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Maximale Vorausbuchung (in Tagen)'),
            m('input', {
              type: 'number',
              class: 'w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.advance_booking_days_max || 60,
              oninput: (e) => { s.advance_booking_days_max = e.target.value; }
            })
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Mindest-Vorlaufzeit (in Stunden)'),
            m('input', {
              type: 'number',
              class: 'w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.min_lead_time_hours || 1,
              oninput: (e) => { s.min_lead_time_hours = e.target.value; }
            })
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Stornofrist vor Termin (in Stunden)'),
            m('input', {
              type: 'number',
              class: 'w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.cancellation_cutoff_hours || 2,
              oninput: (e) => { s.cancellation_cutoff_hours = e.target.value; }
            })
          ])
        ])
      ]),

      // 2. GitHub & Open Source Footer-Verlinkung
      m('div', { class: 'bg-white dark:bg-[#1E2937] p-6 rounded-xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-sm' }, [
        m('div', { class: 'border-b pb-3 dark:border-gray-700 flex items-start justify-between' }, [
          m('div', [
            m('h3', { class: 'text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2' }, [
              Icons.github,
              'GitHub & Open Source Footer-Verlinkung'
            ]),
            m('p', { class: 'text-xs text-gray-500 mt-0.5' },
              'Aktivieren oder konfigurieren Sie den direkten GitHub-Link im Fußbereich der Anwendung.'
            )
          ]),
          m('span', { class: 'px-2 py-0.5 rounded text-[11px] font-bold ' + (s.show_github_footer_link !== '0' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800') },
            s.show_github_footer_link !== '0' ? 'Footer-Link aktiv' : 'Deaktiviert'
          )
        ]),

        m('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [
          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'GitHub-Link im Footer anzeigen'),
            m('select', {
              class: 'w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.show_github_footer_link || '1',
              onchange: (e) => { s.show_github_footer_link = e.target.value; }
            }, [
              m('option', { value: '1' }, 'Ja - Direkten GitHub-Link im Footer einblenden'),
              m('option', { value: '0' }, 'Nein - GitHub-Link im Footer ausblenden')
            ])
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Link-Beschriftung im Footer'),
            m('input', {
              type: 'text',
              class: 'w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.github_footer_text || 'GitHub Repository',
              placeholder: 'z.B. GitHub Repository oder cstrsk on GitHub',
              oninput: (e) => { s.github_footer_text = e.target.value; }
            })
          ]),

          m('div', { class: 'md:col-span-2' }, [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'GitHub Repository / Profil-URL'),
            m('div', { class: 'flex gap-2' }, [
              m('input', {
                type: 'url',
                class: 'w-full p-2 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
                value: s.github_repo_url || 'https://github.com/CSTRSK',
                placeholder: 'https://github.com/CSTRSK/workspace-booking',
                oninput: (e) => { s.github_repo_url = e.target.value; }
              }),
              m('a', {
                href: s.github_repo_url || 'https://github.com/CSTRSK',
                target: '_blank',
                rel: 'noopener noreferrer',
                class: 'px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 text-gray-700 dark:text-gray-300'
              }, [
                Icons.github,
                'Öffnen ↗'
              ])
            ])
          ])
        ])
      ]),

      // 3. Single Sign-On (SSO) & OAuth
      m('div', { class: 'bg-white dark:bg-[#1E2937] p-6 rounded-xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-sm' }, [
        m('div', { class: 'border-b pb-3 dark:border-gray-700 flex items-start justify-between' }, [
          m('div', [
            m('h3', { class: 'text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2' }, [
              Icons.shield,
              'Single Sign-On (SSO) & OAuth Identity Provider'
            ]),
            m('p', { class: 'text-xs text-gray-500 mt-0.5' },
              'Zentralisierte Benutzeranmeldung via GitHub, Google Workspace, Microsoft 365 oder OpenID Connect / SAML.'
            )
          ]),
          m('span', { class: 'px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-[#1A73E8] dark:bg-blue-900/40 dark:text-blue-300' },
            'SSO Aktiv'
          )
        ]),

        m('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [
          // GitHub SSO
          m('div', { class: 'p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-[#0F172A]/50 space-y-2' }, [
            m('div', { class: 'flex items-center justify-between' }, [
              m('div', { class: 'flex items-center gap-2 font-bold text-xs' }, [
                Icons.github,
                'GitHub OAuth / SSO'
              ]),
              m('select', {
                class: 'text-[11px] p-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
                value: s.sso_github_enabled !== '0' ? '1' : '0',
                onchange: (e) => { s.sso_github_enabled = e.target.value; }
              }, [
                m('option', { value: '1' }, 'Aktiviert'),
                m('option', { value: '0' }, 'Deaktiviert')
              ])
            ]),
            m('p', { class: 'text-[11px] text-gray-500' }, 'Ermöglicht Entwicklern und GitHub-Mitgliedern die direkte 1-Klick-Anmeldung.'),
            m('input', {
              type: 'text',
              placeholder: 'GitHub Client ID (optional)',
              class: 'w-full p-1.5 text-[11px] font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
              value: s.sso_github_client_id || '',
              oninput: (e) => { s.sso_github_client_id = e.target.value; }
            })
          ]),

          // Google SSO
          m('div', { class: 'p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-[#0F172A]/50 space-y-2' }, [
            m('div', { class: 'flex items-center justify-between' }, [
              m('div', { class: 'flex items-center gap-2 font-bold text-xs' }, [
                Icons.google,
                'Google Workspace SSO'
              ]),
              m('select', {
                class: 'text-[11px] p-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
                value: s.sso_google_enabled !== '0' ? '1' : '0',
                onchange: (e) => { s.sso_google_enabled = e.target.value; }
              }, [
                m('option', { value: '1' }, 'Aktiviert'),
                m('option', { value: '0' }, 'Deaktiviert')
              ])
            ]),
            m('p', { class: 'text-[11px] text-gray-500' }, 'Anmeldung mit geschäftlichen Google Workspace & Gmail-Konten.'),
            m('input', {
              type: 'text',
              placeholder: 'Google OAuth Client ID (optional)',
              class: 'w-full p-1.5 text-[11px] font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
              value: s.sso_google_client_id || '',
              oninput: (e) => { s.sso_google_client_id = e.target.value; }
            })
          ]),

          // Microsoft 365 SSO
          m('div', { class: 'p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-[#0F172A]/50 space-y-2' }, [
            m('div', { class: 'flex items-center justify-between' }, [
              m('div', { class: 'flex items-center gap-2 font-bold text-xs' }, [
                Icons.microsoft,
                'Microsoft 365 / Entra ID'
              ]),
              m('select', {
                class: 'text-[11px] p-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
                value: s.sso_microsoft_enabled !== '0' ? '1' : '0',
                onchange: (e) => { s.sso_microsoft_enabled = e.target.value; }
              }, [
                m('option', { value: '1' }, 'Aktiviert'),
                m('option', { value: '0' }, 'Deaktiviert')
              ])
            ]),
            m('p', { class: 'text-[11px] text-gray-500' }, 'Azure Active Directory / Microsoft 365 Unternehmensanmeldung.'),
            m('input', {
              type: 'text',
              placeholder: 'Entra ID Tenant ID (z.B. common oder UUID)',
              class: 'w-full p-1.5 text-[11px] font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
              value: s.sso_microsoft_tenant_id || 'common',
              oninput: (e) => { s.sso_microsoft_tenant_id = e.target.value; }
            })
          ]),

          // Enterprise OIDC / SAML
          m('div', { class: 'p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-[#0F172A]/50 space-y-2' }, [
            m('div', { class: 'flex items-center justify-between' }, [
              m('div', { class: 'flex items-center gap-2 font-bold text-xs' }, [
                Icons.key,
                'Enterprise OIDC / SAML 2.0'
              ]),
              m('select', {
                class: 'text-[11px] p-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
                value: s.sso_oidc_enabled !== '0' ? '1' : '0',
                onchange: (e) => { s.sso_oidc_enabled = e.target.value; }
              }, [
                m('option', { value: '1' }, 'Aktiviert'),
                m('option', { value: '0' }, 'Deaktiviert')
              ])
            ]),
            m('p', { class: 'text-[11px] text-gray-500' }, 'Keycloak, Okta, PingFederate oder eigener OpenID Connect Issuer.'),
            m('input', {
              type: 'url',
              placeholder: 'https://auth.cstrsk.de/realms/corporate',
              class: 'w-full p-1.5 text-[11px] font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
              value: s.sso_oidc_issuer_url || '',
              oninput: (e) => { s.sso_oidc_issuer_url = e.target.value; }
            })
          ])
        ]),

        m('div', { class: 'pt-2 flex items-center justify-between border-t dark:border-gray-800 text-xs' }, [
          m('div', [
            m('span', { class: 'font-semibold text-gray-700 dark:text-gray-300' }, 'Standard-Rolle für neu registrierte SSO-Nutzer: '),
            m('select', {
              class: 'ml-2 p-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-xs',
              value: s.sso_default_role || 'user',
              onchange: (e) => { s.sso_default_role = e.target.value; }
            }, [
              m('option', { value: 'user' }, 'Standard-Nutzer (Kunde/Gast)'),
              m('option', { value: 'staff' }, 'Mitarbeiter (Facility/Operations)')
            ])
          ])
        ])
      ]),

      // 4. Unternehmens-Anbindung: LDAP / Active Directory
      m('div', { class: 'bg-white dark:bg-[#1E2937] p-6 rounded-xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-sm' }, [
        m('div', { class: 'border-b pb-3 dark:border-gray-700 flex items-start justify-between' }, [
          m('div', [
            m('h3', { class: 'text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2' }, [
              Icons.building,
              'Unternehmens-Anbindung: LDAP / Active Directory'
            ]),
            m('p', { class: 'text-xs text-gray-500 mt-0.5' },
              'Direkter Verzeichnisdienst-Login über Windows Server Active Directory oder OpenLDAP/FreeIPA.'
            )
          ]),
          m('span', { class: 'px-2 py-0.5 rounded text-[11px] font-bold ' + (s.ldap_enabled !== '0' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-600') },
            s.ldap_enabled !== '0' ? 'LDAP Aktiv' : 'Deaktiviert'
          )
        ]),

        m('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [
          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'LDAP-Authentifizierung Status'),
            m('select', {
              class: 'w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.ldap_enabled || '1',
              onchange: (e) => { s.ldap_enabled = e.target.value; }
            }, [
              m('option', { value: '1' }, 'Aktiviert – LDAP-Login im Anmeldefenster verfügbar'),
              m('option', { value: '0' }, 'Deaktiviert')
            ])
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'LDAP Server URL (Protokoll & Host:Port)'),
            m('input', {
              type: 'text',
              class: 'w-full p-2 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.ldap_server_url || 'ldaps://ldap.cstrsk.de:636',
              placeholder: 'ldaps://domaincontroller.firma.de:636',
              oninput: (e) => { s.ldap_server_url = e.target.value; }
            })
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Base DN (Suchbasis)'),
            m('input', {
              type: 'text',
              class: 'w-full p-2 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.ldap_base_dn || 'dc=cstrsk,dc=de',
              placeholder: 'dc=firma,dc=local',
              oninput: (e) => { s.ldap_base_dn = e.target.value; }
            })
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Bind DN (Service-Konto für Directory-Suche)'),
            m('input', {
              type: 'text',
              class: 'w-full p-2 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.ldap_bind_dn || 'cn=workspace-service,ou=services,dc=cstrsk,dc=de',
              placeholder: 'cn=ldap-reader,ou=services,dc=firma,dc=de',
              oninput: (e) => { s.ldap_bind_dn = e.target.value; }
            })
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Benutzer-Suchfilter'),
            m('input', {
              type: 'text',
              class: 'w-full p-2 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.ldap_user_search_filter || '(&(objectClass=user)(|(sAMAccountName={username})(mail={username})))',
              placeholder: '(&(objectClass=person)(sAMAccountName={username}))',
              oninput: (e) => { s.ldap_user_search_filter = e.target.value; }
            })
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Admin-Gruppe DN (Rollen-Mapping: admin)'),
            m('input', {
              type: 'text',
              class: 'w-full p-2 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: s.ldap_admin_group_dn || 'cn=Workspace-Admins,ou=groups,dc=cstrsk,dc=de',
              placeholder: 'cn=Domain Admins,ou=groups,dc=firma,dc=de',
              oninput: (e) => { s.ldap_admin_group_dn = e.target.value; }
            })
          ])
        ]),

        // Test LDAP Connection
        m('div', { class: 'pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t dark:border-gray-800' }, [
          m('div', { class: 'text-xs text-gray-500' }, [
            'Testet TLS-Handshake, Service-Bind und Verzeichnisabfrage.'
          ]),
          m('button', {
            type: 'button',
            class: 'px-3 py-2 rounded-lg bg-gray-800 text-white dark:bg-gray-700 text-xs font-semibold hover:bg-black transition flex items-center gap-1.5',
            onclick: async () => {
              try {
                const res = await API.testLdap({
                  ldap_server_url: s.ldap_server_url,
                  ldap_base_dn: s.ldap_base_dn,
                  ldap_bind_dn: s.ldap_bind_dn
                });
                State.ldapTestResult = res;
                showToast('LDAP-Verbindungstest erfolgreich: Host & Bind aktiv!', 'success');
              } catch (err) {
                showToast('LDAP-Test fehlgeschlagen: ' + err.message, 'error');
              }
            }
          }, [
            Icons.building,
            'LDAP-Verbindung testen'
          ])
        ]),

        State.ldapTestResult ? m('div', { class: 'p-3 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-xs space-y-1 animate-fade-in' }, [
          m('div', { class: 'flex items-center gap-2 font-bold text-green-700 dark:text-green-400' }, [
            Icons.check,
            State.ldapTestResult.message
          ]),
          m('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-gray-600 dark:text-gray-300 pt-1 font-mono' }, [
            m('div', [m('span', { class: 'text-gray-400 block text-[10px]' }, 'Server:'), State.ldapTestResult.server]),
            m('div', [m('span', { class: 'text-gray-400 block text-[10px]' }, 'Latenz:'), `${State.ldapTestResult.latency_ms} ms`]),
            m('div', [m('span', { class: 'text-gray-400 block text-[10px]' }, 'Bind-Status:'), State.ldapTestResult.bind_status]),
            m('div', [m('span', { class: 'text-gray-400 block text-[10px]' }, 'Protokoll:'), State.ldapTestResult.directory_type])
          ])
        ]) : null
      ]),

      // 5. QR-Code & Check-in API Schnittstellen Konfiguration (Admin-Schnittstelle)
      m('div', { class: 'bg-white dark:bg-[#1E2937] p-6 rounded-xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-sm' }, [
        m('div', { class: 'border-b pb-3 dark:border-gray-700 flex items-start justify-between' }, [
          m('div', [
            m('h3', { class: 'text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2' }, [
              Icons.qrcode,
              'QR-Code & Check-in API Schnittstelle'
            ]),
            m('p', { class: 'text-xs text-gray-500 mt-0.5' },
              'Konfigurieren Sie hier die QR-Code Generierung für Check-in Tickets und Drehkreuze/Türöffnungssysteme.'
            )
          ]),
          m('span', { class: 'px-2 py-0.5 rounded text-[11px] font-bold bg-[#1A73E8]/10 text-[#1A73E8] dark:text-[#60A5FA]' },
            s.qr_provider === 'internal' ? 'Offline-Generator aktiv' :
            s.qr_provider === 'custom_api' ? 'Eigene API aktiv' : 'Server-Proxy aktiv'
          )
        ]),

        // Provider Modus Auswahl
        m('div', [
          m('label', { class: 'block text-xs font-semibold mb-1' }, 'QR-Code Bereitstellung (Provider)'),
          m('select', {
            class: 'w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: s.qr_provider,
            onchange: (e) => { s.qr_provider = e.target.value; }
          }, [
            m('option', { value: 'internal' }, 'Integriert: Lokaler SVG Generator (100% offline-fähig, unbegrenzt, keine externe API nötig)'),
            m('option', { value: 'custom_api' }, 'Eigene externe QR-Code API (z.B. QRServer, QuickChart oder firmeninterner Service)'),
            m('option', { value: 'server_proxy' }, 'Server-Proxy: Interner Node/PHP Endpunkt (./api/qrcode.php)')
          ])
        ]),

        // QR Nutzdaten-Format
        m('div', [
          m('label', { class: 'block text-xs font-semibold mb-1' }, 'QR-Code Inhalt / Payload-Format'),
          m('select', {
            class: 'w-full p-2 text-xs rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: s.qr_content_format,
            onchange: (e) => { s.qr_content_format = e.target.value; }
          }, [
            m('option', { value: 'url' }, 'Direkte Check-in Web-URL (Smartphone scannt & öffnet die Bestätigungsseite)'),
            m('option', { value: 'code' }, 'Reiner Buchungscode (z.B. CHK-2026-X1Y2Z – ideal für Handscanner am Empfang)'),
            m('option', { value: 'json' }, 'Strukturierter JSON-Payload (für automatisierte Zutrittssysteme & Drehkreuze)')
          ])
        ]),

        // Externe API Einstellungen (nur sichtbar bei custom_api)
        s.qr_provider === 'custom_api' ? m('div', { class: 'p-4 rounded-xl bg-blue-50/50 dark:bg-[#0F172A]/70 border border-blue-200 dark:border-blue-900/40 space-y-3' }, [
          m('div', [
            m('div', { class: 'flex items-center justify-between mb-1' }, [
              m('label', { class: 'text-xs font-bold text-gray-900 dark:text-white' }, 'Eigene API-URL Vorlage (Template)'),
              m('span', { class: 'text-[10px] text-gray-500 font-mono' }, 'Platzhalter: {data}, {code}, {booking_number}, {size}')
            ]),
            m('input', {
              type: 'text',
              class: 'w-full p-2 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
              placeholder: 'https://api.qrserver.com/v1/create-qr-code/?size={size}x{size}&data={data}',
              value: s.qr_api_url_template,
              oninput: (e) => { s.qr_api_url_template = e.target.value; }
            }),
            // Schnell-Vorlagen Buttons
            m('div', { class: 'flex flex-wrap gap-1.5 mt-2 items-center' }, [
              m('span', { class: 'text-[10px] text-gray-500' }, 'Vorlagen:'),
              m('button', {
                type: 'button',
                class: 'px-2 py-0.5 rounded text-[11px] bg-white dark:bg-[#1E2937] border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition',
                onclick: () => { s.qr_api_url_template = 'https://api.qrserver.com/v1/create-qr-code/?size={size}x{size}&data={data}'; }
              }, 'QRServer.com'),
              m('button', {
                type: 'button',
                class: 'px-2 py-0.5 rounded text-[11px] bg-white dark:bg-[#1E2937] border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition',
                onclick: () => { s.qr_api_url_template = 'https://quickchart.io/qr?text={data}&size={size}&margin=1'; }
              }, 'QuickChart QR'),
              m('button', {
                type: 'button',
                class: 'px-2 py-0.5 rounded text-[11px] bg-white dark:bg-[#1E2937] border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition',
                onclick: () => { s.qr_api_url_template = '../api/qrcode.php?data={data}&size={size}&format=svg'; }
              }, 'Interner Server-Proxy')
            ])
          ]),

          m('div', [
            m('label', { class: 'block text-xs font-semibold mb-1' }, 'Optionale Authentifizierung (Header / API-Key)'),
            m('input', {
              type: 'text',
              class: 'w-full p-2 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
              placeholder: 'z.B. Bearer eyJhbGci... oder X-API-Key: secret123 (Optional)',
              value: s.qr_api_auth_header,
              oninput: (e) => { s.qr_api_auth_header = e.target.value; }
            })
          ])
        ]) : null,

        // Live-Test & Schnittstellen-Vorschau
        m('div', { class: 'p-4 rounded-xl bg-gray-50 dark:bg-[#0F172A] border border-gray-200 dark:border-gray-800 space-y-3' }, [
          m('div', { class: 'flex items-center justify-between' }, [
            m('label', { class: 'text-xs font-bold text-gray-900 dark:text-white' }, 'Schnittstellen Live-Tester & Vorschau'),
            m('span', { class: 'text-[11px] text-gray-500' }, 'Prüfen Sie Ihre QR-Konfiguration sofort')
          ]),
          m('div', { class: 'flex gap-2' }, [
            m('input', {
              type: 'text',
              class: 'flex-1 p-2 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
              placeholder: 'Testcode eingeben...',
              value: State.adminQrTestCode,
              oninput: (e) => { State.adminQrTestCode = e.target.value; }
            }),
            m('button', {
              type: 'button',
              class: 'px-3 py-2 rounded-lg bg-gray-800 text-white dark:bg-gray-700 text-xs font-semibold hover:bg-black transition',
              onclick: () => {
                const code = State.adminQrTestCode || 'CST-2026-TEST';
                const format = s.qr_content_format || 'url';
                const testPayload = format === 'code' ? code :
                                    format === 'json' ? JSON.stringify({ app: 'cstrsk.de', checkin: code }) :
                                    `${window.location.origin}/#checkin?code=${encodeURIComponent(code)}`;
                State.adminQrTestResult = {
                  code,
                  payload: testPayload,
                  timestamp: new Date().toLocaleTimeString()
                };
                showToast('QR-Code Vorschau generiert.', 'info');
              }
            }, 'Schnittstelle testen')
          ]),

          State.adminQrTestResult ? m('div', { class: 'mt-3 pt-3 border-t dark:border-gray-800 flex flex-col sm:flex-row items-center gap-4' }, [
            m('div', { class: 'bg-white p-2 rounded-lg shadow-sm border border-gray-200' }, [
              renderRealQr(State.adminQrTestResult.payload, { check_in_code: State.adminQrTestResult.code, booking_number: 'TEST-001' }, 180)
            ]),
            m('div', { class: 'text-xs space-y-1 text-gray-600 dark:text-gray-300 flex-1' }, [
              m('p', { class: 'font-semibold text-green-600 dark:text-green-400' }, '✓ QR-Schnittstelle aktiv & abrufbar'),
              m('p', { class: 'text-gray-500 text-[11px]' }, `Provider: ${s.qr_provider} · Format: ${s.qr_content_format}`),
              m('p', { class: 'font-mono text-[11px] break-all bg-gray-100 dark:bg-gray-800 p-1.5 rounded' }, State.adminQrTestResult.payload),
              m('p', { class: 'text-[10px] text-gray-400' }, `Generiert um ${State.adminQrTestResult.timestamp} Uhr`)
            ])
          ]) : null
        ])
      ]),

      // Speicher-Button
      m('div', { class: 'flex justify-end' }, [
        m('button', {
          class: 'px-5 py-2.5 rounded-lg bg-[#1A73E8] text-white text-xs font-bold hover:bg-[#1557B0] shadow-sm transition',
          onclick: async () => {
            await API.request('../api/admin.php?action=save_settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(s)
            });
            State.settings = { ...s };
            showToast('Alle Einstellungen (SSO, LDAP, GitHub, QR-Codes) erfolgreich gespeichert.', 'success');
          }
        }, 'Alle Einstellungen & Schnittstellen speichern')
      ])
    ]);
  }

  // ===========================================================================
  // 6. Modals (Buchung, Login, Register, QR-Code, DSGVO)
  // ===========================================================================
  const ModalContainer = {
    view() {
      if (!State.modal) return null;
      const mData = State.modal;

      return m('div', {
        class: 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto',
        onclick: (e) => {
          if (e.target === e.currentTarget) State.modal = null;
        }
      }, [
        m('div', {
          class: 'bg-white dark:bg-[#1E2937] rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 max-h-[90vh] overflow-y-auto animate-fade-in'
        }, [
          mData.type === 'book' ? renderBookingModal(mData) :
          mData.type === 'cancel_confirm' ? renderCancelConfirmModal(mData) :
          mData.type === 'qr' ? renderQrModal(mData) :
          mData.type === 'login' ? renderLoginModal() :
          mData.type === 'register' ? renderRegisterModal() :
          mData.type === 'waitlist' ? renderWaitlistModal(mData) :
          mData.type === 'resource_crud' ? renderResourceCrudModal(mData) :
          mData.type === 'create_block' ? renderCreateBlockModal() :
          mData.type === 'privacy' ? renderPrivacyModal() :
          null
        ])
      ]);
    }
  };

  // Buchungsdialog mit Live-Konfliktprüfung & Serienbuchungen
  function renderBookingModal(data) {
    const res = data.resource;
    data.title = data.title || 'Team-Besprechung';
    data.attendees = data.attendees || 1;
    data.seating = data.seating || (res.seating_options && res.seating_options[0] ? res.seating_options[0] : '');
    data.is_recurring = data.is_recurring || false;
    data.frequency = data.frequency || 'weekly';
    data.until_date = data.until_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    data.guest_email = data.guest_email || '';
    data.guest_name = data.guest_name || '';

    return m('div', { class: 'space-y-4' }, [
      m('div', { class: 'flex items-start justify-between border-b pb-3 dark:border-gray-700' }, [
        m('div', [
          m('h3', { class: 'text-lg font-bold text-gray-900 dark:text-white' }, `Buchung: ${res.title}`),
          m('p', { class: 'text-xs text-[#1A73E8] dark:text-[#60A5FA]' }, `${res.location} · Kapazität: bis ${res.capacity} P.`)
        ]),
        m('button', {
          class: 'text-gray-400 hover:text-gray-600 text-lg font-bold',
          onclick: () => { State.modal = null; }
        }, '✕')
      ]),

      // Zeitfenster
      m('div', { class: 'grid grid-cols-2 gap-3 text-xs' }, [
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'Startzeit (UTC)'),
          m('input', {
            type: 'datetime-local',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: data.start_time.slice(0, 16),
            oninput: (e) => { data.start_time = e.target.value + ':00Z'; }
          })
        ]),
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'Endzeit (UTC)'),
          m('input', {
            type: 'datetime-local',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: data.end_time.slice(0, 16),
            oninput: (e) => { data.end_time = e.target.value + ':00Z'; }
          })
        ])
      ]),

      // Titel / Verwendungszweck
      m('div', { class: 'text-xs' }, [
        m('label', { class: 'block font-semibold mb-1' }, 'Buchungstitel / Anlass'),
        m('input', {
          type: 'text',
          class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
          value: data.title,
          oninput: (e) => { data.title = e.target.value; }
        })
      ]),

      // Bestuhlung & Personenzahl für Seminarräume
      res.type_id === 'room' ? m('div', { class: 'grid grid-cols-2 gap-3 text-xs' }, [
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'Bestuhlungsvariante'),
          m('select', {
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: data.seating,
            onchange: (e) => { data.seating = e.target.value; }
          }, [
            m('option', { value: 'reihen' }, 'Reihenbestuhlung'),
            m('option', { value: 'u_form' }, 'U-Form'),
            m('option', { value: 'block' }, 'Blocktisch')
          ])
        ]),
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'Teilnehmeranzahl'),
          m('input', {
            type: 'number',
            min: '1',
            max: res.capacity,
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: data.attendees,
            oninput: (e) => { data.attendees = parseInt(e.target.value) || 1; }
          })
        ])
      ]) : null,

      // Serienbuchung Schalter
      m('div', { class: 'p-3 bg-gray-50 dark:bg-[#0F172A] rounded-lg border border-gray-200 dark:border-gray-800 text-xs space-y-2' }, [
        m('label', { class: 'flex items-center gap-2 cursor-pointer font-semibold' }, [
          m('input', {
            type: 'checkbox',
            checked: data.is_recurring,
            onchange: (e) => { data.is_recurring = e.target.checked; }
          }),
          'Wiederkehrende Buchung (Serientermin)'
        ]),

        data.is_recurring ? m('div', { class: 'grid grid-cols-2 gap-2 pt-2' }, [
          m('div', [
            m('label', { class: 'block text-[11px] mb-1' }, 'Wiederholung'),
            m('select', {
              class: 'w-full p-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
              value: data.frequency,
              onchange: (e) => { data.frequency = e.target.value; }
            }, [
              m('option', { value: 'daily' }, 'Täglich'),
              m('option', { value: 'weekly' }, 'Wöchentlich'),
              m('option', { value: 'monthly' }, 'Monatlich')
            ])
          ]),
          m('div', [
            m('label', { class: 'block text-[11px] mb-1' }, 'Bis Datum'),
            m('input', {
              type: 'date',
              class: 'w-full p-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1E2937]',
              value: data.until_date,
              oninput: (e) => { data.until_date = e.target.value; }
            })
          ])
        ]) : null
      ]),

      // Gast-Buchung Felder falls nicht eingeloggt
      !State.user ? m('div', { class: 'p-3 bg-blue-50 dark:bg-[#1A73E8]/10 rounded-lg border border-blue-200 dark:border-blue-900 text-xs space-y-2' }, [
        m('div', { class: 'font-semibold text-[#1A73E8] dark:text-[#60A5FA]' }, 'Gast-Buchung (Ohne dauerhaftes Konto)'),
        m('input', {
          type: 'text',
          placeholder: 'Ihr Name (z.B. Max Mustermann)',
          class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0F172A]',
          value: data.guest_name,
          oninput: (e) => { data.guest_name = e.target.value; }
        }),
        m('input', {
          type: 'email',
          placeholder: 'Ihre E-Mail für Bestätigung & ICS',
          class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0F172A]',
          value: data.guest_email,
          oninput: (e) => { data.guest_email = e.target.value; }
        })
      ]) : null,

      // Button
      m('div', { class: 'pt-2 flex justify-end gap-2' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg border border-gray-300 text-xs font-semibold',
          onclick: () => { State.modal = null; }
        }, 'Abbrechen'),
        m('button', {
          class: 'px-5 py-2 rounded-lg bg-[#1A73E8] text-white text-xs font-bold hover:bg-[#1557B0] shadow',
          onclick: async () => {
            try {
              const resCreate = await API.createBooking({
                resource_id: res.id,
                start_time: data.start_time,
                end_time: data.end_time,
                title: data.title,
                seating_choice: data.seating,
                attendees_count: data.attendees,
                is_recurring: data.is_recurring,
                frequency: data.frequency,
                until_date: data.until_date,
                guest_name: data.guest_name,
                guest_email: data.guest_email
              });
              showToast(resCreate.message, 'success');
              State.modal = null;
              API.loadResources();
              if (State.user) API.loadMyBookings();
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        }, 'Verbindlich buchen')
      ])
    ]);
  }

  // Modal zur verbindlichen Stornierung einer Buchung (ohne blockierende Browser-confirms)
  function renderCancelConfirmModal(data) {
    const b = data.booking;

    return m('div', { class: 'space-y-4' }, [
      m('div', { class: 'flex items-center gap-3 border-b pb-3 dark:border-gray-700' }, [
        m('div', { class: 'w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center font-bold text-lg' }, '!'),
        m('div', [
          m('h3', { class: 'text-base font-bold text-gray-900 dark:text-white' }, 'Buchung wirklich stornieren?'),
          m('p', { class: 'text-xs text-gray-500' }, `Buchungs-Nr: ${b.booking_number}`)
        ])
      ]),

      m('div', { class: 'p-3.5 bg-gray-50 dark:bg-[#0F172A] rounded-xl border border-gray-200 dark:border-gray-800 text-xs space-y-2' }, [
        m('div', { class: 'flex justify-between' }, [
          m('span', { class: 'text-gray-500' }, 'Ressource:'),
          m('span', { class: 'font-semibold text-gray-900 dark:text-white' }, b.resource_title)
        ]),
        m('div', { class: 'flex justify-between' }, [
          m('span', { class: 'text-gray-500' }, 'Standort:'),
          m('span', { class: 'font-semibold text-gray-900 dark:text-white' }, b.resource_location)
        ]),
        m('div', { class: 'flex justify-between' }, [
          m('span', { class: 'text-gray-500' }, 'Zeitraum:'),
          m('span', { class: 'font-semibold text-gray-900 dark:text-white' }, `${formatDate(b.start_time)}, ${formatTime(b.start_time)} – ${formatTime(b.end_time)} Uhr`)
        ]),
        m('div', { class: 'flex justify-between border-t pt-1.5 dark:border-gray-800' }, [
          m('span', { class: 'text-gray-500 font-semibold' }, 'Gesamtpreis:'),
          m('span', { class: 'font-bold text-[#1A73E8] dark:text-[#60A5FA]' }, `${parseFloat(b.total_price_gross).toFixed(2)} € brutto`)
        ])
      ]),

      m('p', { class: 'text-xs text-gray-600 dark:text-gray-400 leading-relaxed' },
        'Möchten Sie diese Buchung unwiderruflich stornieren? Der gebuchte Zeitraum wird im Kalender sofort für andere Nutzer freigegeben.'
      ),

      m('div', { class: 'flex justify-end gap-2 pt-3 border-t dark:border-gray-800' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-[#0F172A]',
          onclick: () => { State.modal = null; }
        }, 'Abbrechen'),
        m('button', {
          class: 'px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 shadow-sm flex items-center gap-1.5',
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await API.cancelBooking(b.id);
              showToast(`Buchung ${b.booking_number} wurde erfolgreich storniert.`, 'info');
              State.modal = null;
              await API.loadMyBookings();
              if (State.currentTab === 'admin') await API.loadAdminData();
            } catch (err) {
              showToast(err.message || 'Stornierung fehlgeschlagen', 'error');
              e.target.disabled = false;
            }
          }
        }, 'Ja, verbindlich stornieren')
      ])
    ]);
  }

  // QR-Code Modal für Check-in am Einlass mit echter QR-Generierung und Schnittstellen-Unterstützung
  function renderQrModal(data) {
    const b = data.booking;
    const settings = State.settings || {};
    const format = settings.qr_content_format || 'url';
    const checkinUrl = `${window.location.origin}/#checkin?code=${encodeURIComponent(b.check_in_code)}&b=${encodeURIComponent(b.booking_number)}`;
    const payload = format === 'code' ? b.check_in_code :
                    format === 'json' ? JSON.stringify({ app: 'cstrsk.de', checkin: b.check_in_code, nr: b.booking_number, room: b.resource_title }) :
                    checkinUrl;

    const providerLabel = settings.qr_provider === 'custom_api' ? 'Eigene externe API' :
                          settings.qr_provider === 'server_proxy' ? 'Server-Proxy API' :
                          'Offline SVG-Generator';

    return m('div', { class: 'text-center space-y-4' }, [
      m('div', [
        m('div', { class: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#1A73E8]/10 text-[#1A73E8] dark:text-[#60A5FA] mb-2' }, [
          Icons.qrcode,
          `Schnittstelle: ${providerLabel}`
        ]),
        m('h3', { class: 'text-base font-bold text-gray-900 dark:text-white' }, 'Check-in QR-Code'),
        m('p', { class: 'text-xs text-gray-500' }, `Buchungs-Nr: ${b.booking_number} · ${b.resource_title}`)
      ]),

      // Echtes, 100% lesbares QR-Code Rendering
      renderRealQr(payload, b, 240),

      m('div', { class: 'flex items-center justify-between p-2.5 bg-gray-100 dark:bg-[#0F172A] rounded-lg text-xs font-mono font-bold tracking-widest text-[#1A73E8] dark:text-[#60A5FA]' }, [
        m('span', `CODE: ${b.check_in_code}`),
        m('button', {
          class: 'px-2 py-1 rounded bg-white dark:bg-[#1E2937] text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 text-[11px] font-sans font-semibold hover:bg-gray-50',
          onclick: () => {
            navigator.clipboard.writeText(b.check_in_code);
            showToast('Check-in Code in Zwischenablage kopiert!', 'info');
          }
        }, 'Kopieren')
      ]),

      m('div', { class: 'text-[11px] text-gray-500 break-all px-1' }, [
        'Nutzdaten: ',
        m('span', { class: 'font-mono' }, payload.length > 55 ? payload.slice(0, 52) + '...' : payload)
      ]),

      m('div', { class: 'flex flex-wrap justify-center gap-2 pt-2 border-t dark:border-gray-800' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg bg-green-600 text-white text-xs font-bold hover:bg-green-700 shadow-sm flex items-center gap-1.5',
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await API.checkinCode(b.check_in_code);
              showToast('Erfolgreich eingecheckt!', 'success');
              State.modal = null;
              await API.loadMyBookings();
              if (State.currentTab === 'admin') await API.loadAdminData();
            } catch (err) {
              showToast(err.message, 'error');
              e.target.disabled = false;
            }
          }
        }, 'Jetzt Einchecken (Simulator)'),
        m('a', {
          href: `./api/qrcode.php?data=${encodeURIComponent(payload)}&format=svg&size=400`,
          download: `qrcode_${b.booking_number}.svg`,
          class: 'px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-[#0F172A] flex items-center gap-1 text-gray-700 dark:text-gray-300'
        }, [
          Icons.download,
          'QR Download'
        ]),
        m('button', {
          class: 'px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-[#0F172A]',
          onclick: () => { State.modal = null; }
        }, 'Schließen')
      ])
    ]);
  }

  // Login Modal mit Standard-, SSO- (GitHub, Google, Microsoft) und LDAP-Anbindung
  let loginAuthData = {
    email: '',
    password: '',
    ldapUsername: '',
    ldapPassword: '',
    ssoCustomEmail: '',
    ssoCustomName: '',
    isLoading: false
  };

  function renderLoginModal() {
    State.loginAuthTab = State.loginAuthTab || 'standard';
    const activeTab = State.loginAuthTab;
    const s = State.settings || {};

    const handleSsoClick = async (provider, defaultName, defaultEmail) => {
      loginAuthData.isLoading = true;
      m.redraw();
      try {
        const email = loginAuthData.ssoCustomEmail || defaultEmail;
        const name = loginAuthData.ssoCustomName || defaultName;
        const res = await API.loginSso(provider, { email, name });
        showToast(res.message || `Erfolgreich via ${provider.toUpperCase()} angemeldet!`, 'success');
        State.modal = null;
        API.loadMyBookings();
        if (State.currentTab === 'admin') API.loadAdminData();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        loginAuthData.isLoading = false;
        m.redraw();
      }
    };

    const handleLdapLogin = async () => {
      if (!loginAuthData.ldapUsername || !loginAuthData.ldapPassword) {
        showToast('Bitte LDAP-Benutzername und Kennwort eingeben.', 'error');
        return;
      }
      loginAuthData.isLoading = true;
      m.redraw();
      try {
        const res = await API.loginLdap(loginAuthData.ldapUsername, loginAuthData.ldapPassword);
        showToast(res.message || `Willkommen, ${res.user.name} (LDAP)!`, 'success');
        State.modal = null;
        API.loadMyBookings();
        if (State.currentTab === 'admin') API.loadAdminData();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        loginAuthData.isLoading = false;
        m.redraw();
      }
    };

    return m('div', { class: 'space-y-4' }, [
      // Header
      m('div', { class: 'border-b pb-3 dark:border-gray-700' }, [
        m('h3', { class: 'text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2' }, [
          Icons.user,
          'Anmelden bei cstrsk.de Workspace'
        ]),
        m('p', { class: 'text-xs text-gray-500 mt-0.5' },
          'Wählen Sie Ihre gewünschte Authentifizierungsmethode.'
        )
      ]),

      // Auth Mode Tabs
      m('div', { class: 'flex rounded-xl bg-gray-100 dark:bg-[#0F172A] p-1 gap-1 text-xs font-semibold' }, [
        m('button', {
          type: 'button',
          class: `flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1.5 ${activeTab === 'standard' ? 'bg-white dark:bg-[#1E2937] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`,
          onclick: () => { State.loginAuthTab = 'standard'; }
        }, [
          Icons.key,
          'Kennwort'
        ]),
        m('button', {
          type: 'button',
          class: `flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1.5 ${activeTab === 'sso' ? 'bg-white dark:bg-[#1E2937] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`,
          onclick: () => { State.loginAuthTab = 'sso'; }
        }, [
          Icons.shield,
          'Single Sign-On'
        ]),
        m('button', {
          type: 'button',
          class: `flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1.5 ${activeTab === 'ldap' ? 'bg-white dark:bg-[#1E2937] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`,
          onclick: () => { State.loginAuthTab = 'ldap'; }
        }, [
          Icons.building,
          'Firmen-LDAP / AD'
        ])
      ]),

      // TAB 1: Standard Password Login
      activeTab === 'standard' ? m('div', { class: 'text-xs space-y-3 pt-1 animate-fade-in' }, [
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'E-Mail-Adresse'),
          m('input', {
            type: 'email',
            placeholder: 'admin@cstrsk.de',
            class: 'w-full p-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: loginAuthData.email,
            oninput: (e) => { loginAuthData.email = e.target.value; }
          })
        ]),
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'Passwort'),
          m('input', {
            type: 'password',
            placeholder: '••••••••',
            class: 'w-full p-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: loginAuthData.password,
            oninput: (e) => { loginAuthData.password = e.target.value; }
          })
        ]),
        m('div', { class: 'flex items-center justify-between text-[11px] text-gray-500 flex-wrap gap-1' }, [
          m('span', 'Demokonten:'),
          m('div', { class: 'flex items-center gap-2 flex-wrap font-mono' }, [
            m('span', {
              class: 'text-[#1A73E8] cursor-pointer hover:underline',
              onclick: () => {
                loginAuthData.email = 'admin@cstrsk.de';
                loginAuthData.password = 'admin123';
                showToast('Admin-Zugangsdaten vorausgefüllt.', 'info');
              }
            }, 'Admin'),
            '·',
            m('span', {
              class: 'text-[#1A73E8] cursor-pointer hover:underline',
              onclick: () => {
                loginAuthData.email = 'team@cstrsk.de';
                loginAuthData.password = 'mitarbeiter123';
                showToast('Facility/Team vorausgefüllt.', 'info');
              }
            }, 'Facility'),
            '·',
            m('span', {
              class: 'text-[#1A73E8] cursor-pointer hover:underline',
              onclick: () => {
                loginAuthData.email = 'nutzer@beispiel.de';
                loginAuthData.password = 'nutzer123';
                showToast('Nutzer-Zugangsdaten vorausgefüllt.', 'info');
              }
            }, 'Nutzer')
          ])
        ]),

        // Quick SSO Bar below password login
        m('div', { class: 'pt-2 border-t dark:border-gray-800' }, [
          m('div', { class: 'text-[11px] text-gray-500 mb-2 font-medium text-center' }, 'Oder direkt per 1-Klick Single Sign-On:'),
          m('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-2' }, [
            m('button', {
              type: 'button',
              class: 'p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E2937] hover:bg-gray-50 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition text-gray-800 dark:text-gray-200 shadow-sm',
              onclick: () => handleSsoClick('github', 'GitHub Developer', 'developer@github.com')
            }, [Icons.github, 'GitHub']),
            m('button', {
              type: 'button',
              class: 'p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E2937] hover:bg-gray-50 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition text-gray-800 dark:text-gray-200 shadow-sm',
              onclick: () => handleSsoClick('google', 'Google Workspace User', 'user@workspace.cstrsk.de')
            }, [Icons.google, 'Google']),
            m('button', {
              type: 'button',
              class: 'p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E2937] hover:bg-gray-50 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition text-gray-800 dark:text-gray-200 shadow-sm',
              onclick: () => handleSsoClick('microsoft', 'M365 Enterprise User', 'user@cstrsk.onmicrosoft.com')
            }, [Icons.microsoft, 'M365']),
            m('button', {
              type: 'button',
              class: 'p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E2937] hover:bg-gray-50 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition text-gray-800 dark:text-gray-200 shadow-sm',
              onclick: () => { State.loginAuthTab = 'ldap'; }
            }, [Icons.building, 'LDAP / AD'])
          ])
        ])
      ]) : null,

      // TAB 2: Single Sign-On (SSO) Providers
      activeTab === 'sso' ? m('div', { class: 'text-xs space-y-3 pt-1 animate-fade-in' }, [
        m('div', { class: 'p-3 rounded-lg bg-blue-50/70 dark:bg-[#1A73E8]/10 border border-blue-200 dark:border-blue-900/40 text-[11px] text-gray-600 dark:text-gray-300' }, [
          m('span', { class: 'font-bold text-[#1A73E8] dark:text-[#60A5FA]' }, 'Zentrales Single Sign-On: '),
          'Wählen Sie Ihren Identitätsanbieter für eine sichere und passwortlose 1-Klick-Anmeldung.'
        ]),

        m('div', { class: 'space-y-2' }, [
          // GitHub SSO Button
          m('button', {
            type: 'button',
            class: 'w-full py-2.5 px-4 rounded-xl bg-[#24292F] hover:bg-[#1B1F23] text-white font-semibold flex items-center justify-center gap-2.5 transition shadow-sm',
            onclick: () => handleSsoClick('github', 'GitHub Developer', 'developer@github.com')
          }, [
            Icons.github,
            m('span', 'Mit GitHub anmelden')
          ]),

          // Google Workspace Button
          m('button', {
            type: 'button',
            class: 'w-full py-2.5 px-4 rounded-xl bg-white hover:bg-gray-50 text-gray-800 font-semibold border border-gray-300 dark:border-gray-700 flex items-center justify-center gap-2.5 transition shadow-sm dark:bg-[#1E2937] dark:text-white',
            onclick: () => handleSsoClick('google', 'Google Workspace User', 'user@workspace.cstrsk.de')
          }, [
            Icons.google,
            m('span', 'Mit Google Workspace anmelden')
          ]),

          // Microsoft 365 Button
          m('button', {
            type: 'button',
            class: 'w-full py-2.5 px-4 rounded-xl bg-[#0078D4] hover:bg-[#106EBE] text-white font-semibold flex items-center justify-center gap-2.5 transition shadow-sm',
            onclick: () => handleSsoClick('microsoft', 'M365 Enterprise User', 'user@cstrsk.onmicrosoft.com')
          }, [
            Icons.microsoft,
            m('span', 'Mit Microsoft 365 / Entra ID anmelden')
          ]),

          // Enterprise OIDC / SAML Button
          m('button', {
            type: 'button',
            class: 'w-full py-2.5 px-4 rounded-xl bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold flex items-center justify-center gap-2.5 transition shadow-sm',
            onclick: () => handleSsoClick('oidc', 'Enterprise Corporate User', 'corporate.sso@cstrsk.de')
          }, [
            Icons.key,
            m('span', 'Mit Enterprise SSO (OIDC / SAML 2.0) anmelden')
          ])
        ]),

        // Custom Corporate SSO Input
        m('div', { class: 'pt-2 border-t dark:border-gray-800 text-[11px] text-gray-500 space-y-1.5' }, [
          m('label', { class: 'block font-semibold text-gray-700 dark:text-gray-300' }, 'Oder eigene Firmen-E-Mail eingeben (Auto-Discovery):'),
          m('div', { class: 'flex gap-2' }, [
            m('input', {
              type: 'email',
              placeholder: 'name@ihrefirma.de',
              class: 'flex-1 p-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
              value: loginAuthData.ssoCustomEmail,
              oninput: (e) => { loginAuthData.ssoCustomEmail = e.target.value; }
            }),
            m('button', {
              type: 'button',
              class: 'px-3 py-2 rounded-lg bg-gray-800 text-white dark:bg-gray-700 font-semibold hover:bg-black transition',
              onclick: () => {
                if (!loginAuthData.ssoCustomEmail) {
                  showToast('Bitte Firmen-E-Mail eingeben.', 'error');
                  return;
                }
                handleSsoClick('oidc', loginAuthData.ssoCustomEmail.split('@')[0], loginAuthData.ssoCustomEmail);
              }
            }, 'SSO Starten')
          ])
        ])
      ]) : null,

      // TAB 3: LDAP / Active Directory Login
      activeTab === 'ldap' ? m('div', { class: 'text-xs space-y-3 pt-1 animate-fade-in' }, [
        m('div', { class: 'p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-start justify-between gap-2' }, [
          m('div', [
            m('div', { class: 'font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5' }, [
              Icons.building,
              'Active Directory & OpenLDAP Verzeichnis'
            ]),
            m('div', { class: 'text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5 font-mono' },
              `${s.ldap_server_url || 'ldaps://ldap.cstrsk.de:636'} · Base: ${s.ldap_base_dn || 'dc=cstrsk,dc=de'}`
            )
          ]),
          m('span', { class: 'px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 font-mono text-[10px] whitespace-nowrap' },
            'TLS 1.3 Online'
          )
        ]),

        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'LDAP Benutzername / sAMAccountName / UPN'),
          m('input', {
            type: 'text',
            placeholder: 'z.B. aweber oder alexander.weber@cstrsk.de',
            class: 'w-full p-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] font-mono',
            value: loginAuthData.ldapUsername,
            oninput: (e) => { loginAuthData.ldapUsername = e.target.value; }
          })
        ]),

        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'LDAP / AD Kennwort'),
          m('input', {
            type: 'password',
            placeholder: '••••••••',
            class: 'w-full p-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: loginAuthData.ldapPassword,
            oninput: (e) => { loginAuthData.ldapPassword = e.target.value; }
          })
        ]),

        m('div', { class: 'flex items-center justify-between text-[11px] text-gray-500 flex-wrap gap-1' }, [
          m('span', 'Verzeichnis-Testkonten:'),
          m('div', { class: 'flex items-center gap-2 flex-wrap font-mono' }, [
            m('span', {
              class: 'text-[#1A73E8] cursor-pointer hover:underline',
              onclick: () => {
                loginAuthData.ldapUsername = 'aweber';
                loginAuthData.ldapPassword = 'admin123';
                showToast('LDAP Admin (aweber) vorausgefüllt.', 'info');
              }
            }, 'aweber (Admin)'),
            '·',
            m('span', {
              class: 'text-[#1A73E8] cursor-pointer hover:underline',
              onclick: () => {
                loginAuthData.ldapUsername = 'sbauer';
                loginAuthData.ldapPassword = 'mitarbeiter123';
                showToast('LDAP Facility (sbauer) vorausgefüllt.', 'info');
              }
            }, 'sbauer (Facility)'),
            '·',
            m('span', {
              class: 'text-[#1A73E8] cursor-pointer hover:underline',
              onclick: () => {
                loginAuthData.ldapUsername = 'tmeyer';
                loginAuthData.ldapPassword = 'nutzer123';
                showToast('LDAP Nutzer (tmeyer) vorausgefüllt.', 'info');
              }
            }, 'tmeyer (Nutzer)')
          ])
        ])
      ]) : null,

      // Modal Bottom Buttons
      m('div', { class: 'pt-2 flex items-center justify-between border-t dark:border-gray-800' }, [
        m('button', {
          type: 'button',
          class: 'text-xs text-[#1A73E8] dark:text-[#60A5FA] hover:underline font-medium',
          onclick: () => { State.modal = { type: 'register' }; }
        }, 'Neues Konto registrieren'),
        m('div', { class: 'flex gap-2' }, [
          m('button', {
            type: 'button',
            class: 'px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-800',
            onclick: () => { State.modal = null; }
          }, 'Abbrechen'),
          activeTab === 'ldap' ? m('button', {
            type: 'button',
            disabled: loginAuthData.isLoading,
            class: 'px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow transition flex items-center gap-1.5',
            onclick: handleLdapLogin
          }, [
            Icons.building,
            loginAuthData.isLoading ? 'Verifiziere LDAP...' : 'Mit LDAP anmelden'
          ]) : activeTab === 'standard' ? m('button', {
            type: 'button',
            disabled: loginAuthData.isLoading,
            class: 'px-5 py-2 rounded-lg bg-[#1A73E8] text-white text-xs font-bold hover:bg-[#1557B0] shadow transition',
            onclick: async () => {
              if (!loginAuthData.email || !loginAuthData.password) {
                showToast('Bitte E-Mail und Passwort eingeben.', 'error');
                return;
              }
              try {
                await API.login(loginAuthData.email, loginAuthData.password);
                showToast(`Willkommen zurück, ${State.user.name}!`, 'success');
                State.modal = null;
                API.loadMyBookings();
                if (State.currentTab === 'admin') API.loadAdminData();
              } catch (err) {
                showToast(err.message, 'error');
              }
            }
          }, 'Anmelden') : null
        ])
      ])
    ]);
  }

  // Registrierungs-Modal mit DSGVO Checkboxen
  function renderRegisterModal() {
    let name = '';
    let email = '';
    let password = '';
    let company = '';
    let consentPrivacy = false;
    let consentTerms = false;

    return m('div', { class: 'space-y-4' }, [
      m('h3', { class: 'text-lg font-bold' }, 'Neues Benutzerkonto anlegen'),
      m('div', { class: 'text-xs space-y-3' }, [
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'Vollständiger Name *'),
          m('input', {
            type: 'text',
            placeholder: 'Dr. Anna Schmidt',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            oninput: (e) => { name = e.target.value; }
          })
        ]),
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'E-Mail-Adresse *'),
          m('input', {
            type: 'email',
            placeholder: 'anna.schmidt@firma.de',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            oninput: (e) => { email = e.target.value; }
          })
        ]),
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'Passwort (mind. 8 Zeichen) *'),
          m('input', {
            type: 'password',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            oninput: (e) => { password = e.target.value; }
          })
        ]),
        m('div', [
          m('label', { class: 'block font-semibold mb-1' }, 'Unternehmen / Organisation (optional)'),
          m('input', {
            type: 'text',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            oninput: (e) => { company = e.target.value; }
          })
        ]),

        // DSGVO Pflicht-Checkboxen
        m('div', { class: 'p-3 bg-gray-50 dark:bg-[#0F172A] rounded border border-gray-200 dark:border-gray-800 space-y-2' }, [
          m('label', { class: 'flex items-start gap-2 cursor-pointer' }, [
            m('input', {
              type: 'checkbox',
              class: 'mt-0.5',
              onchange: (e) => { consentPrivacy = e.target.checked; }
            }),
            m('span', [
              'Ich habe die ',
              m('a', { class: 'text-[#1A73E8] underline cursor-pointer', onclick: () => { State.modal = { type: 'privacy' }; } }, 'Datenschutzerklärung'),
              ' gelesen und willige in die Verarbeitung meiner Daten zur Buchungsabwicklung ein. (DSGVO Art. 6 Abs. 1 lit. a/b)'
            ])
          ]),
          m('label', { class: 'flex items-start gap-2 cursor-pointer' }, [
            m('input', {
              type: 'checkbox',
              class: 'mt-0.5',
              onchange: (e) => { consentTerms = e.target.checked; }
            }),
            m('span', 'Ich akzeptiere die Nutzungsbedingungen und Buchungsregeln der cstrsk.de Workspace Plattform (GNU AGPLv3).')
          ])
        ])
      ]),

      m('div', { class: 'pt-2 flex justify-end gap-2' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg border text-xs',
          onclick: () => { State.modal = null; }
        }, 'Abbrechen'),
        m('button', {
          class: 'px-5 py-2 rounded-lg bg-[#1A73E8] text-white text-xs font-bold hover:bg-[#1557B0]',
          onclick: async () => {
            try {
              await API.register({
                name, email, password, company,
                consent_privacy: consentPrivacy,
                consent_terms: consentTerms
              });
              showToast('Konto erfolgreich angelegt! 50 Start-Credits gutgeschrieben.', 'success');
              State.modal = null;
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        }, 'Konto erstellen')
      ])
    ]);
  }

  // Wartelisten-Modal
  function renderWaitlistModal(data) {
    const res = data.resource;

    return m('div', { class: 'space-y-4' }, [
      m('h3', { class: 'text-lg font-bold text-gray-900 dark:text-white' }, `Warteliste: ${res.title}`),
      m('p', { class: 'text-xs text-gray-500' }, `Der Slot (${data.start_time.slice(0, 16).replace('T', ' ')} Uhr) ist derzeit belegt. Tragen Sie sich in die Warteliste ein, um automatisch per E-Mail informiert zu werden, wenn der Termin frei wird.`),
      m('div', { class: 'pt-3 flex justify-end gap-2' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg border text-xs',
          onclick: () => { State.modal = null; }
        }, 'Abbrechen'),
        m('button', {
          class: 'px-4 py-2 rounded-lg bg-[#F59E0B] text-white text-xs font-bold shadow',
          onclick: async () => {
            if (!State.user) {
              showToast('Bitte melden Sie sich zuerst an.', 'info');
              State.modal = { type: 'login' };
              return;
            }
            try {
              await API.joinWaitlist({
                resource_id: res.id,
                desired_start: data.start_time,
                desired_end: data.end_time
              });
              showToast('Erfolgreich auf Warteliste eingetragen!', 'success');
              State.modal = null;
            } catch (e) {
              showToast(e.message, 'error');
            }
          }
        }, 'Auf Warteliste eintragen')
      ])
    ]);
  }

  // Ressourcen CRUD Modal
  function renderResourceCrudModal(data) {
    const r = data.resource;

    return m('div', { class: 'space-y-3 text-xs' }, [
      m('h3', { class: 'text-base font-bold' }, r.id ? 'Ressource bearbeiten' : 'Neue Ressource anlegen'),
      m('div', { class: 'grid grid-cols-2 gap-2' }, [
        m('div', [
          m('label', { class: 'font-semibold block mb-1' }, 'Titel'),
          m('input', {
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: r.title,
            oninput: (e) => { r.title = e.target.value; }
          })
        ]),
        m('div', [
          m('label', { class: 'font-semibold block mb-1' }, 'Typ'),
          m('select', {
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: r.type_id,
            onchange: (e) => { r.type_id = e.target.value; }
          }, [
            m('option', { value: 'room' }, 'Seminarraum'),
            m('option', { value: 'desk' }, 'Tisch'),
            m('option', { value: 'workspace' }, 'Shared Workspace')
          ])
        ])
      ]),
      m('div', [
        m('label', { class: 'font-semibold block mb-1' }, 'Standort / Etage'),
        m('input', {
          class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
          value: r.location,
          oninput: (e) => { r.location = e.target.value; }
        })
      ]),
      m('div', { class: 'grid grid-cols-3 gap-2' }, [
        m('div', [
          m('label', { class: 'font-semibold block mb-1' }, 'Kapazität'),
          m('input', {
            type: 'number',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: r.capacity,
            oninput: (e) => { r.capacity = parseInt(e.target.value) || 1; }
          })
        ]),
        m('div', [
          m('label', { class: 'font-semibold block mb-1' }, 'Stundensatz (€ Netto)'),
          m('input', {
            type: 'number',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: r.hourly_rate,
            oninput: (e) => { r.hourly_rate = parseFloat(e.target.value) || 0; }
          })
        ]),
        m('div', [
          m('label', { class: 'font-semibold block mb-1' }, 'Tagessatz (€ Netto)'),
          m('input', {
            type: 'number',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: r.daily_rate,
            oninput: (e) => { r.daily_rate = parseFloat(e.target.value) || 0; }
          })
        ])
      ]),
      m('div', { class: 'grid grid-cols-2 gap-2' }, [
        m('div', [
          m('label', { class: 'font-semibold block mb-1' }, 'Pufferzeit (Minuten)'),
          m('input', {
            type: 'number',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: r.buffer_minutes,
            oninput: (e) => { r.buffer_minutes = parseInt(e.target.value) || 15; }
          })
        ]),
        m('div', [
          m('label', { class: 'font-semibold block mb-1' }, 'Genehmigungspflicht'),
          m('select', {
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: r.requires_approval ? '1' : '0',
            onchange: (e) => { r.requires_approval = e.target.value === '1'; }
          }, [
            m('option', { value: '0' }, 'Nein (Sofort bestätigt)'),
            m('option', { value: '1' }, 'Ja (Admin-Freigabe nötig)')
          ])
        ])
      ]),
      m('div', { class: 'pt-3 flex justify-end gap-2' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg border',
          onclick: () => { State.modal = null; }
        }, 'Abbrechen'),
        m('button', {
          class: 'px-4 py-2 rounded-lg bg-[#1A73E8] text-white font-bold',
          onclick: async () => {
            try {
              await API.request('../api/admin.php?action=save_resource', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(r)
              });
              showToast('Ressource gespeichert.', 'success');
              State.modal = null;
              API.loadResources();
            } catch (e) {
              showToast(e.message, 'error');
            }
          }
        }, 'Speichern')
      ])
    ]);
  }

  // Sperrzeit anlegen Modal
  function renderCreateBlockModal() {
    let reason = 'Wartung / Renovierung';
    let start = new Date().toISOString().slice(0, 16);
    let end = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    let resourceId = '';

    return m('div', { class: 'space-y-3 text-xs' }, [
      m('h3', { class: 'text-base font-bold' }, 'Sperrzeit oder Feiertag eintragen'),
      m('div', [
        m('label', { class: 'font-semibold block mb-1' }, 'Grund der Sperrung'),
        m('input', {
          class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
          value: reason,
          oninput: (e) => { reason = e.target.value; }
        })
      ]),
      m('div', [
        m('label', { class: 'font-semibold block mb-1' }, 'Betroffene Ressource'),
        m('select', {
          class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
          value: resourceId,
          onchange: (e) => { resourceId = e.target.value; }
        }, [
          m('option', { value: '' }, 'Alle Ressourcen (Gesamtschließung / Feiertag)'),
          State.resources.map(r => m('option', { value: r.id }, r.title))
        ])
      ]),
      m('div', { class: 'grid grid-cols-2 gap-2' }, [
        m('div', [
          m('label', { class: 'font-semibold block mb-1' }, 'Startzeit (UTC)'),
          m('input', {
            type: 'datetime-local',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: start,
            oninput: (e) => { start = e.target.value; }
          })
        ]),
        m('div', [
          m('label', { class: 'font-semibold block mb-1' }, 'Endzeit (UTC)'),
          m('input', {
            type: 'datetime-local',
            class: 'w-full p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]',
            value: end,
            oninput: (e) => { end = e.target.value; }
          })
        ])
      ]),
      m('div', { class: 'pt-3 flex justify-end gap-2' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg border',
          onclick: () => { State.modal = null; }
        }, 'Abbrechen'),
        m('button', {
          class: 'px-4 py-2 rounded-lg bg-red-600 text-white font-bold',
          onclick: async () => {
            try {
              await API.request('../api/admin.php?action=create_block', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  reason,
                  resource_id: resourceId || null,
                  start_time: start + ':00Z',
                  end_time: end + ':00Z'
                })
              });
              showToast('Sperrzeit angelegt.', 'success');
              State.modal = null;
              API.loadAdminData();
            } catch (e) {
              showToast(e.message, 'error');
            }
          }
        }, 'Sperrung aktivieren')
      ])
    ]);
  }

  // DSGVO & Impressum Modal
  function renderPrivacyModal() {
    return m('div', { class: 'space-y-4 text-xs max-h-[70vh] overflow-y-auto pr-2' }, [
      m('h3', { class: 'text-base font-bold' }, 'Datenschutzerklärung & Impressum (cstrsk.de)'),
      m('div', { class: 'space-y-2 text-gray-600 dark:text-gray-300' }, [
        m('p', { class: 'font-semibold' }, '1. Verantwortliche Stelle & Kontakt'),
        m('p', 'cstrsk.de Workspace Solutions · Digital Hub · Web: https://cstrsk.de · E-Mail: datenschutz@cstrsk.de'),
        m('p', { class: 'font-semibold' }, '2. Lizenz & Quellcode (GNU AGPLv3)'),
        m('p', [
          'Diese Software ist freie Software lizenziert unter der ',
          m('strong', 'GNU Affero General Public License Version 3 (GNU AGPL-3.0)'),
          '. Der Quellcode steht allen Nutzern des Netzwerkdienstes frei zur Verfügung gemäß den Bedingungen der AGPLv3. Ein Projekt von ',
          m('a', { href: 'https://cstrsk.de', target: '_blank', class: 'text-[#1A73E8] dark:text-[#60A5FA] underline font-semibold' }, 'cstrsk.de'),
          '.'
        ]),
        m('p', { class: 'font-semibold' }, '3. Verarbeitungszwecke & Rechtsgrundlage'),
        m('p', 'Die Erhebung von Namen, E-Mail-Adresse und Buchungszeiten erfolgt ausschließlich zur Erfüllung des Buchungsvertrags für Besprechungsräume und Arbeitsplätze nach Art. 6 Abs. 1 lit. b DSGVO.'),
        m('p', { class: 'font-semibold' }, '4. Betroffenenrechte nach DSGVO'),
        m('p', 'Sie haben jederzeit das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17) sowie Datenübertragbarkeit (Art. 20 DSGVO).'),
        State.user ? m('div', { class: 'pt-2 flex flex-col gap-2' }, [
          m('a', {
            href: '../api/user.php?action=export_data',
            download: 'meine_daten_export.json',
            class: 'p-2 rounded bg-gray-100 dark:bg-[#0F172A] text-[#1A73E8] dark:text-[#60A5FA] font-semibold text-center'
          }, '📥 Meine personenbezogenen Daten exportieren (Art. 20 DSGVO)'),
          m('button', {
            class: 'p-2 rounded bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-semibold text-center hover:bg-red-200 transition',
            onclick: async (e) => {
              if (!e.target.dataset.confirmed) {
                e.target.dataset.confirmed = 'true';
                e.target.innerText = '⚠️ Wirklich unwiderruflich löschen? (Klicken zum Bestätigen)';
                return;
              }
              await API.request('../api/user.php?action=delete_account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm_deletion: true })
              });
              showToast('Konto DSGVO-konform gelöscht.', 'info');
              State.user = null;
              State.modal = null;
            }
          }, '🗑 Mein Konto endgültig löschen (Art. 17 DSGVO)')
        ]) : null
      ]),
      m('div', { class: 'pt-3 flex justify-end' }, [
        m('button', {
          class: 'px-4 py-2 rounded-lg bg-[#1A73E8] text-white font-semibold',
          onclick: () => { State.modal = null; }
        }, 'Schließen')
      ])
    ]);
  }

  // ===========================================================================
  // 7. Footer & Floating Elements
  // ===========================================================================
  const Footer = {
    view() {
      const s = State.settings || {};
      const showGithub = s.show_github_footer_link !== '0';
      const githubUrl = s.github_repo_url || 'https://github.com/CSTRSK';
      const githubText = s.github_footer_text || 'GitHub Repository';

      return m('footer', {
        class: 'mt-auto border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0F172A] py-6 text-xs text-gray-500'
      }, [
        m('div', { class: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4' }, [
          m('div', { class: 'flex items-center gap-2 flex-wrap' }, [
            m('a', { href: 'https://cstrsk.de', target: '_blank', rel: 'noopener noreferrer', class: 'font-bold text-[#1A73E8] dark:text-[#60A5FA] hover:underline' }, 'cstrsk.de'),
            '·',
            m('span', 'Workspace & Room Booking'),
            '·',
            m('span', { class: 'px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#1E2937] font-mono text-[11px]' }, 'GNU AGPLv3'),
            showGithub ? [
              '·',
              m('a', {
                href: githubUrl,
                target: '_blank',
                rel: 'noopener noreferrer',
                class: 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-[#1E2937] dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium transition group border border-gray-200 dark:border-gray-700 text-[11px]',
                title: 'Quellcode auf GitHub ansehen (cstrsk Open Source)'
              }, [
                Icons.github,
                m('span', githubText),
                m('span', { class: 'text-gray-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform text-[10px]' }, '↗')
              ])
            ] : null
          ]),
          m('div', { class: 'flex items-center gap-4 flex-wrap' }, [
            showGithub ? m('a', {
              href: githubUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
              class: 'hover:underline text-gray-600 dark:text-gray-400 font-medium inline-flex items-center gap-1'
            }, [
              Icons.github,
              'GitHub ↗'
            ]) : null,
            m('a', {
              href: 'https://cstrsk.de',
              target: '_blank',
              rel: 'noopener noreferrer',
              class: 'hover:underline text-gray-600 dark:text-gray-400 font-medium'
            }, 'cstrsk.de ↗'),
            m('button', {
              class: 'hover:underline text-gray-600 dark:text-gray-400',
              onclick: () => { State.modal = { type: 'privacy' }; }
            }, 'Lizenz & DSGVO'),
            m('button', {
              class: 'hover:underline text-gray-600 dark:text-gray-400',
              onclick: () => { State.modal = { type: 'privacy' }; }
            }, 'Impressum')
          ])
        ])
      ]);
    }
  };

  // Toast Notification Overlay
  const ToastContainer = {
    view() {
      if (!State.toast) return null;
      const t = State.toast;
      const bg = t.type === 'error' ? 'bg-red-600' : t.type === 'success' ? 'bg-green-600' : 'bg-[#1A73E8]';

      return m('div', {
        class: `fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-white text-xs font-semibold flex items-center gap-2 ${bg} animate-bounce-in`
      }, [
        t.type === 'success' ? Icons.check : null,
        t.message
      ]);
    }
  };

  // Offline Banner
  const OfflineBanner = {
    view() {
      if (State.isOnline) return null;
      return m('div', {
        class: 'fixed bottom-5 left-5 z-50 px-4 py-2 rounded-xl bg-[#F59E0B] text-white text-xs font-semibold shadow-xl flex items-center gap-2'
      }, [
        m('span', { class: 'w-2 h-2 rounded-full bg-white animate-pulse' }),
        'Offline-Modus aktiv: Gespeicherte Buchungen bleiben verfügbar'
      ]);
    }
  };

  // ===========================================================================
  // 8. Main App Component & Initializer
  // ===========================================================================
  const App = {
    oninit() {
      API.loadSettings();
      API.checkAuth().then(() => {
        if (State.user) API.loadMyBookings();
      });
    },
    view() {
      return m('div', { class: 'flex flex-col min-h-screen' }, [
        m(Header),
        m('main', { class: 'flex-1' }, [
          State.currentTab === 'search' ? m(SearchView) :
          State.currentTab === 'calendar' ? m(CalendarView) :
          State.currentTab === 'my-bookings' ? m(MyBookingsView) :
          State.currentTab === 'admin' ? m(AdminView) :
          null
        ]),
        m(Footer),
        m(ModalContainer),
        m(ToastContainer),
        m(OfflineBanner)
      ]);
    }
  };

  // Mount Mithril Application to #app
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app');
    if (root) {
      m.mount(root, App);
    }
  });

  // Expose global namespace for debugging, testing and headless scripting
  window.CstrskBooking = {
    StreamState,
    State,
    stream
  };

})();

