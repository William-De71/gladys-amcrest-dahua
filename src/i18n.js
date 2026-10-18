// -----------------------------------------------------------------------------
// Texts the code writes at runtime, in English, French, German and Spanish
// (English fallback): connection status, results of the configuration and
// scene actions, widget contents and toasts. The manifest carries its own
// labels; feature names stay English (Gladys translates its categories and the
// user renames devices freely).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const TEXTS = {
  // connection status (Configuration screen)
  statusNoPassword: {
    en: 'Enter the password of your cameras, save, then open Discover and run a scan.',
    fr: 'Saisissez le mot de passe de vos caméras, enregistrez, puis ouvrez Découverte et lancez un scan.',
    de: 'Geben Sie das Passwort Ihrer Kameras ein, speichern Sie und starten Sie dann unter „Entdecken“ eine Suche.',
    es: 'Introduzca la contraseña de sus cámaras, guarde y luego abra Descubrir y lance una búsqueda.',
  },
  statusNoDevice: {
    en: 'Ready. Open Discover and run a scan to add your cameras.',
    fr: 'Prêt. Ouvrez Découverte et lancez un scan pour ajouter vos caméras.',
    de: 'Bereit. Öffnen Sie „Entdecken“ und starten Sie eine Suche, um Ihre Kameras hinzuzufügen.',
    es: 'Listo. Abra Descubrir y lance una búsqueda para añadir sus cámaras.',
  },
  statusConnected: {
    en: 'Connected: {online} of {total} device(s) send their events.',
    fr: 'Connecté : {online} appareil(s) sur {total} envoient leurs événements.',
    de: 'Verbunden: {online} von {total} Gerät(en) senden ihre Ereignisse.',
    es: 'Conectado: {online} de {total} dispositivo(s) envían sus eventos.',
  },
  statusPartial: {
    en: '{offline} of {total} device(s) unreachable: {names}.',
    fr: '{offline} appareil(s) sur {total} injoignable(s) : {names}.',
    de: '{offline} von {total} Gerät(en) nicht erreichbar: {names}.',
    es: '{offline} de {total} dispositivo(s) inaccesible(s): {names}.',
  },
  statusAuth: {
    en: 'Password refused by {names}. Fix it, then click "Test the connection" (the camera locks the account after 5 failures).',
    fr: 'Mot de passe refusé par {names}. Corrigez-le puis cliquez sur « Tester la connexion » (la caméra bloque le compte après 5 échecs).',
    de: 'Passwort von {names} abgelehnt. Korrigieren Sie es und klicken Sie dann auf „Verbindung testen“ (die Kamera sperrt das Konto nach 5 Fehlversuchen).',
    es: 'Contraseña rechazada por {names}. Corríjala y pulse «Probar la conexión» (la cámara bloquea la cuenta tras 5 fallos).',
  },

  // test_connection / refresh_images
  testNothing: {
    en: 'No device found: none answered the network search and no address is filled in. Check that the cameras are on the same network as Gladys, or enter their addresses.',
    fr: 'Aucun appareil trouvé : aucun n’a répondu à la recherche réseau et aucune adresse n’est renseignée. Vérifiez que les caméras sont sur le même réseau que Gladys, ou saisissez leurs adresses.',
    de: 'Kein Gerät gefunden: Keines hat auf die Netzwerksuche geantwortet und keine Adresse ist eingetragen. Prüfen Sie, ob die Kameras im selben Netzwerk wie Gladys sind, oder geben Sie ihre Adressen ein.',
    es: 'Ningún dispositivo encontrado: ninguno respondió a la búsqueda en red y no hay direcciones. Compruebe que las cámaras están en la misma red que Gladys o introduzca sus direcciones.',
  },
  testHostOk: {
    en: '✓ {address}: {model} "{name}", {channels} camera(s){extras}',
    fr: '✓ {address} : {model} « {name} », {channels} caméra(s){extras}',
    de: '✓ {address}: {model} „{name}“, {channels} Kamera(s){extras}',
    es: '✓ {address}: {model} «{name}», {channels} cámara(s){extras}',
  },
  testHostAuth: {
    en: '✗ {address}: password refused for user "{user}".',
    fr: '✗ {address} : mot de passe refusé pour l’utilisateur « {user} ».',
    de: '✗ {address}: Passwort für Benutzer „{user}“ abgelehnt.',
    es: '✗ {address}: contraseña rechazada para el usuario «{user}».',
  },
  testHostPaused: {
    en: '✗ {address}: password refused a moment ago; waiting a few minutes so the camera does not lock the account.',
    fr: '✗ {address} : mot de passe refusé il y a peu ; attente de quelques minutes pour que la caméra ne bloque pas le compte.',
    de: '✗ {address}: Passwort vor Kurzem abgelehnt; einige Minuten Wartezeit, damit die Kamera das Konto nicht sperrt.',
    es: '✗ {address}: contraseña rechazada hace poco; se esperan unos minutos para que la cámara no bloquee la cuenta.',
  },
  testHostUnreachable: {
    en: '✗ {address}: no answer ({reason}). Check the address and that HTTP is enabled on the camera.',
    fr: '✗ {address} : pas de réponse ({reason}). Vérifiez l’adresse et que HTTP est activé sur la caméra.',
    de: '✗ {address}: keine Antwort ({reason}). Prüfen Sie die Adresse und ob HTTP an der Kamera aktiviert ist.',
    es: '✗ {address}: sin respuesta ({reason}). Compruebe la dirección y que HTTP está activado en la cámara.',
  },
  testHostError: {
    en: '✗ {address}: {reason}',
    fr: '✗ {address} : {reason}',
    de: '✗ {address}: {reason}',
    es: '✗ {address}: {reason}',
  },
  testInvalid: {
    en: 'Unreadable address(es) ignored: {list}.',
    fr: 'Adresse(s) illisible(s) ignorée(s) : {list}.',
    de: 'Unlesbare Adresse(n) ignoriert: {list}.',
    es: 'Dirección(es) ilegible(s) ignorada(s): {list}.',
  },
  extraPtz: { en: ', PTZ', fr: ', PTZ', de: ', PTZ', es: ', PTZ' },
  extraSmart: {
    en: ', person/vehicle detection',
    fr: ', détection personne/véhicule',
    de: ', Personen-/Fahrzeugerkennung',
    es: ', detección de personas/vehículos',
  },
  extraIvs: { en: ', IVS rules', fr: ', règles IVS', de: ', IVS-Regeln', es: ', reglas IVS' },
  extraDoorbell: { en: ', doorbell', fr: ', sonnette', de: ', Türklingel', es: ', timbre' },
  extraPrivacy: {
    en: ', privacy mode',
    fr: ', mode privé',
    de: ', Privatmodus',
    es: ', modo privado',
  },
  refreshDone: {
    en: '{ok} image(s) refreshed, {failed} failed.',
    fr: '{ok} image(s) rafraîchie(s), {failed} en échec.',
    de: '{ok} Bild(er) aktualisiert, {failed} fehlgeschlagen.',
    es: '{ok} imagen(es) actualizada(s), {failed} con error.',
  },
  noDevice: {
    en: 'No camera created yet: run a scan in Discover first.',
    fr: 'Aucune caméra créée pour l’instant : lancez d’abord un scan dans Découverte.',
    de: 'Noch keine Kamera angelegt: Starten Sie zuerst eine Suche unter „Entdecken“.',
    es: 'Aún no hay ninguna cámara creada: lance primero una búsqueda en Descubrir.',
  },

  // scene actions
  unknownCamera: {
    en: 'This camera is not one of this integration.',
    fr: 'Cette caméra n’appartient pas à cette intégration.',
    de: 'Diese Kamera gehört nicht zu dieser Integration.',
    es: 'Esta cámara no pertenece a esta integración.',
  },
  notDoorbell: {
    en: 'This device is not a doorbell.',
    fr: 'Cet appareil n’est pas une sonnette.',
    de: 'Dieses Gerät ist keine Türklingel.',
    es: 'Este dispositivo no es un timbre.',
  },

  // kinds (widgets)
  kind_motion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  kind_person: { en: 'Person', fr: 'Personne', de: 'Person', es: 'Persona' },
  kind_vehicle: { en: 'Vehicle', fr: 'Véhicule', de: 'Fahrzeug', es: 'Vehículo' },
  kind_tripwire: {
    en: 'Tripwire',
    fr: 'Franchissement',
    de: 'Linie überquert',
    es: 'Cruce de línea',
  },
  kind_intrusion: { en: 'Intrusion', fr: 'Intrusion', de: 'Eindringen', es: 'Intrusión' },
  kind_audio: { en: 'Sound', fr: 'Son', de: 'Geräusch', es: 'Sonido' },
  kind_tamper: { en: 'Tampering', fr: 'Sabotage', de: 'Sabotage', es: 'Sabotaje' },
  kind_doorbell: { en: 'Doorbell', fr: 'Sonnette', de: 'Türklingel', es: 'Timbre' },

  // widget: cameras
  tileOnline: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  tileDetections: {
    en: 'Detections 24 h',
    fr: 'Détections 24 h',
    de: 'Erkennungen 24 h',
    es: 'Detecciones 24 h',
  },
  cameraOnline: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  cameraOffline: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  cameraWaiting: { en: 'Connecting…', fr: 'Connexion…', de: 'Verbinden…', es: 'Conectando…' },
  cameraLast: { en: '{kind} {ago}', fr: '{kind} {ago}', de: '{kind} {ago}', es: '{kind} {ago}' },
  moreCameras: {
    en: '… and {count} more camera(s)',
    fr: '… et {count} caméra(s) de plus',
    de: '… und {count} weitere Kamera(s)',
    es: '… y {count} cámara(s) más',
  },
  buttonRefresh: {
    en: 'Refresh images',
    fr: 'Rafraîchir images',
    de: 'Bilder erneuern',
    es: 'Refrescar imágenes',
  },
  noCameraWidget: {
    en: 'No camera yet: add them from Discover in the integration settings.',
    fr: 'Aucune caméra pour l’instant : ajoutez-les depuis Découverte dans les réglages de l’intégration.',
    de: 'Noch keine Kamera: Fügen Sie sie über „Entdecken“ in den Einstellungen der Integration hinzu.',
    es: 'Aún no hay cámaras: añádalas desde Descubrir en los ajustes de la integración.',
  },

  // widget: detections
  detectionsCaption: {
    en: '{count} detection(s) in 24 h',
    fr: '{count} détection(s) en 24 h',
    de: '{count} Erkennung(en) in 24 h',
    es: '{count} detección(es) en 24 h',
  },
  noDetection: {
    en: 'No detection since the integration started.',
    fr: 'Aucune détection depuis le démarrage de l’intégration.',
    de: 'Keine Erkennung seit dem Start der Integration.',
    es: 'Ninguna detección desde el inicio de la integración.',
  },
  detailRule: {
    en: 'Rule: {rule}',
    fr: 'Règle : {rule}',
    de: 'Regel: {rule}',
    es: 'Regla: {rule}',
  },
  detailObject: {
    en: 'Object: {object}',
    fr: 'Objet : {object}',
    de: 'Objekt: {object}',
    es: 'Objeto: {object}',
  },

  // widget: storage
  unitGigabytes: { en: 'GB', fr: 'Go', de: 'GB', es: 'GB' },
  storageUsed: { en: 'Used', fr: 'Utilisé', de: 'Belegt', es: 'Usado' },
  storageFree: { en: 'Free', fr: 'Libre', de: 'Frei', es: 'Libre' },
  storageTotal: { en: 'Capacity', fr: 'Capacité', de: 'Kapazität', es: 'Capacidad' },
  storageDisks: { en: 'Disks', fr: 'Disques', de: 'Datenträger', es: 'Discos' },
  storageState: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  storageHealthy: { en: 'Healthy', fr: 'Sain', de: 'In Ordnung', es: 'Correcto' },
  storageFaulty: {
    en: '{count} faulty',
    fr: '{count} en défaut',
    de: '{count} fehlerhaft',
    es: '{count} con fallo',
  },
  storageNone: {
    en: 'No SD card or disk in this device.',
    fr: 'Aucune carte SD ni disque dans cet appareil.',
    de: 'Keine SD-Karte und keine Festplatte in diesem Gerät.',
    es: 'No hay tarjeta SD ni disco en este dispositivo.',
  },
  storageUnreachable: {
    en: 'Storage unreadable: {reason}',
    fr: 'Stockage illisible : {reason}',
    de: 'Speicher nicht lesbar: {reason}',
    es: 'Almacenamiento ilegible: {reason}',
  },
  storageChoose: {
    en: 'Choose a camera in the widget settings.',
    fr: 'Choisissez une caméra dans les réglages du widget.',
    de: 'Wählen Sie in den Widget-Einstellungen eine Kamera.',
    es: 'Elija una cámara en los ajustes del widget.',
  },

  // relative times
  ago_now: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  ago_minutes: { en: '{n} min ago', fr: 'il y a {n} min', de: 'vor {n} Min.', es: 'hace {n} min' },
  ago_hours: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  ago_days: { en: '{n} d ago', fr: 'il y a {n} j', de: 'vor {n} T.', es: 'hace {n} d' },
};

/**
 * A text in one language, `{name}` placeholders replaced.
 * @param {string} key - The TEXTS key.
 * @param {string} language - `en`, `fr`, `de` or `es`.
 * @param {object} [values] - The substitutions.
 * @returns {string} The text.
 * @example
 * t('refreshDone', 'fr', { ok: 2, failed: 0 });
 */
export function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const text = entry[language] ?? entry.en;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined || values[name] === null ? match : String(values[name]),
  );
}

/**
 * A text built per language, cut at `max` characters.
 * @param {Function} build - `(language) => string`.
 * @param {number} [max] - The limit (toasts and statuses: 200).
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 * @example
 * each((language) => t('noDevice', language));
 */
export function each(build, max = 200) {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const text = build(language);
      return [language, text.length > max ? `${text.slice(0, max - 1)}…` : text];
    }),
  );
}

/**
 * A key in every language.
 * @param {string} key - The TEXTS key.
 * @param {object} [values] - The substitutions.
 * @param {number} [max] - The limit.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 * @example
 * all('noDevice');
 */
export function all(key, values = {}, max = 200) {
  return each((language) => t(key, language, values), max);
}

/**
 * "5 min ago" for an instant.
 * @param {number} instant - The instant, in ms.
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The relative time.
 * @example
 * ago(Date.now() - 300000, Date.now(), 'fr'); // 'il y a 5 min'
 */
export function ago(instant, now, language) {
  const minutes = Math.max(0, Math.floor((now - instant) / 60000));
  if (minutes < 1) {
    return t('ago_now', language);
  }
  if (minutes < 120) {
    return t('ago_minutes', language, { n: minutes });
  }
  if (minutes < 48 * 60) {
    return t('ago_hours', language, { n: Math.floor(minutes / 60) });
  }
  return t('ago_days', language, { n: Math.floor(minutes / 1440) });
}
