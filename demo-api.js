/**
 * Demo-Modus fuer die GitHub-Pages-Fassung (Datei wird NICHT geladen, wenn kein
 * Backend fehlt -- siehe unten).
 *
 * Hintergrund: GitHub Pages liefert nur statische Dateien und fuehrt kein PHP aus.
 * Die Datei haengt sich deshalb vor dem eigentlichen fetch() ein: Antwortet die
 * echte API nicht mit JSON (weil PHP nicht laeuft), liefert der Demo-Modus die
 * Beispieldaten aus data/db.json und legt Buchungen im localStorage ab.
 *
 * Auf einem PHP-Webspace (Apache + PHP 8 mit pdo_sqlite) greift der Demo-Modus
 * NIE - dort antwortet die echte API mit JSON und wird unveraendert durchgereicht.
 *
 * Lizenz: GNU AGPLv3 (cstrsk.de)
 */
(function () {
  'use strict';

  var DB_URL = './data/db.json';
  var LS_BUCHUNGEN = 'wabe_demo_bookings';
  var LS_NUTZER = 'wabe_demo_user';
  var dbVersprechen = null;

  function db() {
    if (!dbVersprechen) {
      dbVersprechen = fetch(DB_URL).then(function (r) { return r.json(); }).catch(function () {
        return { resources: [], users: [], bookings: [], blocks: [], waitlist: [], settings: {} };
      });
    }
    return dbVersprechen;
  }

  function json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function text(inhalt, typ) {
    return new Response(inhalt, { status: 200, headers: { 'Content-Type': typ || 'text/plain; charset=utf-8' } });
  }

  function eigeneBuchungen() {
    try { return JSON.parse(localStorage.getItem(LS_BUCHUNGEN) || '[]'); } catch (e) { return []; }
  }
  function speichereBuchungen(liste) { localStorage.setItem(LS_BUCHUNGEN, JSON.stringify(liste)); }
  function angemeldet() {
    try { return JSON.parse(localStorage.getItem(LS_NUTZER) || 'null'); } catch (e) { return null; }
  }
  function anmelden(nutzer) {
    localStorage.setItem(LS_NUTZER, JSON.stringify(nutzer));
    State_benachrichtigen();
  }
  function abmelden() { localStorage.removeItem(LS_NUTZER); State_benachrichtigen(); }

  // ---- Sichtbarer Hinweis, damit die Demo nicht fuer produktiv gehalten wird ----
  function hinweisSetzen() {
    if (document.getElementById('demo-hinweis')) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', hinweisSetzen); return; }
    var balken = document.createElement('div');
    balken.id = 'demo-hinweis';
    balken.setAttribute('role', 'status');
    balken.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#1A73E8;color:#fff;' +
      'font:600 12px/1.45 system-ui,sans-serif;padding:7px 12px;text-align:center;box-shadow:0 -2px 8px rgba(0,0,0,.25)';
    balken.innerHTML = 'Demo-Modus (GitHub Pages, kein PHP): Anmeldung und Buchungen laufen in diesem Browser, ' +
      'Daten aus <code>data/db.json</code>. Fuer den vollen Betrieb auf PHP-Webspace installieren &mdash; siehe README.';
    document.body.appendChild(balken);
    document.body.style.paddingBottom = '42px';
  }
  function State_benachrichtigen() { /* Platzhalter: die App rendert selbst neu */ }

  // ---- Endpunkt-Antworten -----------------------------------------------------
  function behandleAuth(url, optionen, d) {
    var aktion = (url.match(/action=([a-z_]+)/) || [])[1] || 'me';
    var koerper = {};
    try { koerper = JSON.parse((optionen && optionen.body) || '{}'); } catch (e) {}

    if (aktion === 'me') {
      var u = angemeldet();
      return json({ success: true, user: u, csrf_token: 'demo-csrf-token' });
    }
    if (aktion === 'logout') { abmelden(); return json({ success: true }); }
    if (aktion === 'login') {
      var email = (koerper.email || '').toLowerCase().trim();
      var treffer = (d.users || []).filter(function (x) { return (x.email || '').toLowerCase() === email; })[0];
      if (!treffer && email) {
        // Anmeldung im Demo-Modus: unbekannte Adresse wird als Gaestekonto gefuehrt
        treffer = { id: 'demo-' + email, email: email, name: email.split('@')[0], role: 'user', credits: 100,
                    company: 'Demo', consent_privacy: 1, consent_terms: 1 };
      }
      if (!treffer) return json({ success: false, error: 'Bitte E-Mail angeben.' }, 400);
      var nutzer = { id: treffer.id, email: treffer.email, name: treffer.name, role: treffer.role,
                     credits: treffer.credits, company: treffer.company, phone: treffer.phone || '' };
      anmelden(nutzer);
      return json({ success: true, user: nutzer, csrf_token: 'demo-csrf-token' });
    }
    if (aktion === 'register') {
      var neu = { id: 'demo-' + Date.now(), email: koerper.email || 'demo@beispiel.de',
                  name: koerper.name || 'Demo-Nutzer', role: 'user', credits: 100,
                  company: koerper.company || 'Demo', phone: koerper.phone || '' };
      anmelden(neu);
      return json({ success: true, user: neu, csrf_token: 'demo-csrf-token' });
    }
    if (aktion === 'sso_login' || aktion === 'ldap_login') {
      return json({ success: false, error: 'Im Demo-Modus nicht verfuegbar (kein Server).' }, 400);
    }
    return json({ success: true });
  }

  function behandleBuchungen(url, optionen, d) {
    var methode = ((optionen && optionen.method) || 'GET').toUpperCase();
    var aktion = (url.match(/action=([a-z_]+)/) || [])[1] || '';
    var alle = /all=1/.test(url);
    var nutzer = angemeldet();
    var vorhandene = eigeneBuchungen();
    var bestand = (d.bookings || []).slice();

    if (methode === 'GET') {
      if (alle && nutzer && (nutzer.role === 'admin' || nutzer.role === 'staff')) {
        return json({ success: true, bookings: bestand.concat(vorhandene) });
      }
      if (!nutzer) return json({ success: true, bookings: [] });
      var meine = vorhandene.filter(function (b) { return b.user_id === nutzer.id; });
      // Beispieldaten des Demo-Nutzers mitanzeigen, damit die Ansicht nicht leer wirkt
      if (nutzer.email === 'nutzer@beispiel.de') {
        meine = meine.concat(bestand.filter(function (b) { return b.user_id === 'usr-demo-01'; }));
      }
      return json({ success: true, bookings: meine });
    }
    if (methode === 'POST' || methode === 'DELETE') {
      var koerper = {};
      try { koerper = JSON.parse((optionen && optionen.body) || '{}'); } catch (e) {}
      if (aktion === 'cancel') {
        var id = koerper.id || koerper.booking_id || '';
        var rest = vorhandene.filter(function (b) { return b.id !== id; });
        speichereBuchungen(rest);
        return json({ success: true, message: 'Buchung storniert (Demo).' });
      }
      if (aktion === 'checkin') {
        return json({ success: true, message: 'Check-in verbucht (Demo).' });
      }
      if (!nutzer) return json({ success: false, error: 'Bitte anmelden.' }, 401);
      var res = (d.resources || []).filter(function (r) { return r.id === koerper.resource_id; })[0] || {};
      var buchung = {
        id: 'demo-b-' + Date.now(),
        user_id: nutzer.id, user_name: nutzer.name,
        resource_id: koerper.resource_id, resource_title: res.title || 'Ressource',
        type_id: res.type_id || '', start_time: koerper.start_time, end_time: koerper.end_time,
        attendees: koerper.attendees || 1, guest_name: koerper.guest_name || '', guest_email: koerper.guest_email || '',
        status: res.requires_approval ? 'pending' : 'confirmed',
        total_price: koerper.total_price || 0, check_in_code: 'DEMO-' + Math.floor(Math.random() * 90000 + 10000),
        created_at: new Date().toISOString()
      };
      vorhandene.push(buchung);
      speichereBuchungen(vorhandene);
      return json({ success: true, booking: buchung, message: 'Buchung angelegt (Demo).' });
    }
    return json({ success: true });
  }

  function behandleAdmin(url, optionen, d) {
    var tab = (url.match(/tab=([a-z]+)/) || [])[1] || 'dashboard';
    var alle = (d.bookings || []).concat(eigeneBuchungen());
    if (tab === 'users') {
      return json({ success: true, users: (d.users || []).map(function (u) {
        return { id: u.id, email: u.email, name: u.name, role: u.role, credits: u.credits, company: u.company, is_active: 1 };
      }) });
    }
    if (tab === 'bookings') return json({ success: true, bookings: alle });
    if (tab === 'blocks') return json({ success: true, blocks: d.blocks || [] });
    if (tab === 'settings') {
      return json({ success: true, settings: d.settings || {} });
    }
    return json({ success: true, stats: {
      bookings_total: alle.length,
      bookings_pending: alle.filter(function (b) { return b.status === 'pending'; }).length,
      users_total: (d.users || []).length,
      resources_total: (d.resources || []).length,
      revenue_total: alle.reduce(function (s, b) { return s + (Number(b.total_price) || 0); }, 0)
    } });
  }

  function behandleCsv(d) {
    var kopf = ['id', 'ressource', 'beginn', 'ende', 'status', 'preis'];
    var zeilen = [kopf.join(';')].concat((d.bookings || []).concat(eigeneBuchungen()).map(function (b) {
      return [b.id, (b.resource_title || '').replace(/;/g, ','), b.start_time, b.end_time, b.status, b.total_price].join(';');
    }));
    return text('\ufeff' + zeilen.join('\r\n'), 'text/csv; charset=utf-8');
  }

  function behandleUser(url) {
    var aktion = (url.match(/action=([a-z_]+)/) || [])[1] || '';
    if (aktion === 'export_data') {
      return text(JSON.stringify({ hinweis: 'Demo-Export (kein Server)', nutzer: angemeldet() }, null, 2), 'application/json');
    }
    if (aktion === 'delete_account') { abmelden(); return json({ success: true, message: 'Konto im Demo-Modus entfernt.' }); }
    return json({ success: true });
  }

  function demoAntwort(url, optionen) {
    // Erst hier ist klar, dass wirklich der Demo-Modus einspringt
    hinweisSetzen();
    return db().then(function (d) {
      if (/auth\.php/.test(url)) return behandleAuth(url, optionen, d);
      if (/settings\.php/.test(url)) return json({ success: true, settings: d.settings || {} });
      if (/resources\.php/.test(url)) {
        var id = (url.match(/id=([a-z0-9-]+)/) || [])[1];
        var liste = d.resources || [];
        if (id) {
          var einer = liste.filter(function (r) { return r.id === id; })[0];
          return einer ? json({ success: true, resource: einer }) : json({ success: false, error: 'Nicht gefunden.' }, 404);
        }
        return json({ success: true, count: liste.length, resources: liste });
      }
      if (/bookings\.php/.test(url)) return behandleBuchungen(url, optionen, d);
      if (/admin\.php/.test(url)) return behandleAdmin(url, optionen, d);
      if (/waitlist\.php/.test(url)) return json({ success: true, waitlist: d.waitlist || [], message: 'Warteliste (Demo).' });
      if (/export\.php/.test(url)) return behandleCsv(d);
      if (/user\.php/.test(url)) return behandleUser(url);
      if (/invoice\.php/.test(url)) {
        return text('<div style="font:14px system-ui;padding:24px"><h1>Rechnung (Demo)</h1>' +
          '<p>Im Demo-Modus wird keine Rechnung erzeugt. Auf einem PHP-Webspace liefert ' +
          '<code>api/invoice.php</code> die § 14 UStG-konforme Rechnung.</p></div>', 'text/html; charset=utf-8');
      }
      if (/qrcode\.php/.test(url)) {
        var daten = (url.match(/data=([^&]+)/) || [])[1] || 'demo';
        return text('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">' +
          '<rect width="160" height="160" fill="#fff"/><rect x="8" y="8" width="144" height="144" fill="none" stroke="#1A73E8" stroke-width="3"/>' +
          '<text x="80" y="76" text-anchor="middle" font-family="system-ui" font-size="11" fill="#1A73E8">QR im Demo-Modus</text>' +
          '<text x="80" y="94" text-anchor="middle" font-family="monospace" font-size="9" fill="#334155">' +
          decodeURIComponent(daten).slice(0, 18) + '</text></svg>', 'image/svg+xml; charset=utf-8');
      }
      return json({ success: true, demo: true });
    });
  }

  // ---- Einhaken in fetch -------------------------------------------------------
  // Der echte Server wird nur EINMAL befragt, danach ist die Faehigkeit bekannt:
  // Kann er kein PHP (GitHub Pages), gehen auch POST/DELETE direkt in die Demo -
  // sonst wuerde der Host einen 501/405 ins Netz-Log schreiben.
  var echterFetch = window.fetch.bind(window);
  var serverKannPhp = null;   // null = noch unbekannt

  function pruefeServer(url, eingabe, optionen) {
    return echterFetch(eingabe, optionen).then(function (antwort) {
      var typ = (antwort.headers.get('content-type') || '').toLowerCase();
      return { antwort: antwort, echt: antwort.ok && typ.indexOf('json') !== -1 };
    }).catch(function () { return { antwort: null, echt: false }; });
  }

  window.fetch = function (eingabe, optionen) {
    var url = typeof eingabe === 'string' ? eingabe : (eingabe && eingabe.url) || '';
    if (!/(^|\/)api\/[a-z_]+\.php/.test(url)) return echterFetch(eingabe, optionen);
    var methode = ((optionen && optionen.method) || (typeof eingabe === 'object' && eingabe.method) || 'GET').toUpperCase();

    if (serverKannPhp === false) return demoAntwort(url, optionen);          // bekannt: kein PHP
    if (serverKannPhp === true) return echterFetch(eingabe, optionen);       // bekannt: echtes Backend

    return pruefeServer(url, eingabe, optionen).then(function (ergebnis) {
      serverKannPhp = ergebnis.echt;
      if (ergebnis.echt) return ergebnis.antwort;
      return demoAntwort(url, optionen);
    });
  };

  // Der Hinweis wird bewusst NICHT beim Laden gesetzt, sondern erst, wenn der
  // Demo-Modus tatsaechlich eine Antwort liefert (siehe demoAntwort()). Sonst
  // erschiene der Banner auch auf einem PHP-Webspace, wo er nicht hingehoert.
})();
