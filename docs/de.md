# Amcrest / Dahua

## Überblick

Diese Integration bringt Kameras, Türklingeln und Rekorder mit **Dahua-Firmware** in Gladys: Dahua, Amcrest, Lorex, Imou, EmpireTech und die vielen umbenannten Modelle mit derselben Weboberfläche. Alles läuft **in Ihrem lokalen Netzwerk**: kein Cloud-Konto, keine Daten verlassen Ihr Zuhause.

Jede Kamera wird ein Gladys-Gerät (ein Rekorder liefert ein Gerät pro aufgezeichneter Kamera):

| Funktion           | Wann                                    | Gladys-Typ                  |
| ------------------ | --------------------------------------- | --------------------------- |
| Bild               | immer                                   | `camera` / `image`          |
| Live-Ansicht       | immer (RTSP, Haupt- oder Substream)     | Kamera-Widget               |
| Bewegung           | immer                                   | `motion-sensor` / `binary`  |
| Person, Fahrzeug   | intelligente Bewegungserkennung (SMD)   | `motion-sensor` / `binary`  |
| Linienüberquerung  | eine IVS-Regel „Linienüberquerung“      | `motion-sensor` / `binary`  |
| Eindringen         | eine IVS-Regel „Eindringen“             | `motion-sensor` / `binary`  |
| Türklingel         | VTO, Amcrest AD110 / AD410, Imou DB61i… | `doorbell` / `ring`         |
| Bewegungserkennung | die Kamera kann sie schalten            | `switch` / `binary`         |
| Kamera aktiviert   | Privatmodus (Amcrest, Imou)             | `camera` / `enabled`        |
| Bewegen, Position  | PTZ-Kameras                             | `camera` / `move`, `preset` |

Erkennungen kommen **sofort**: Die Integration hält den Ereignisstrom jedes Geräts offen, wie es die offiziellen Apps tun.

**Transport**: nur lokal. Die Kameras werden über ihre HTTP-API (`/cgi-bin`) und RTSP erreicht; nichts läuft über die Cloud des Herstellers, und der Katalog zeigt das Abzeichen „lokal“.

## Voraussetzungen

- Gladys **5.1.0** oder neuer (Dashboard-Widgets, Szenenauslöser und -aktionen).
- Eine Kamera, eine Türklingel oder ein Rekorder mit Dahua-Firmware, von Gladys aus erreichbar, mit aktiviertem **HTTP** (Standard) und aktiviertem **RTSP** für die Live-Ansicht.
- Das Konto, das Sie in der Weboberfläche verwenden (bei den meisten Installationen `admin`).
- Für Personen- und Fahrzeugerkennung: eine Kamera mit **intelligenter Bewegungserkennung (SMD)** oder **IVS**-Regeln, aktiviert in ihrer Weboberfläche (Ereignis → Smart Motion Detection oder Ereignis → IVS).

## Konfiguration

1. Installieren Sie die Integration aus dem Store.
2. Geben Sie **Benutzername** und **Passwort** Ihrer Kameras ein und speichern Sie.
3. Öffnen Sie den Reiter **Entdecken** und starten Sie eine Suche: Die Geräte Ihres Netzwerks antworten von selbst (DHIP-Erkennung, das Protokoll des Dahua ConfigTool). Fügen Sie die gewünschten Kameras hinzu.
4. Klicken Sie auf **Verbindung testen**, um für jedes Gerät Modell, Kameras und deren Fähigkeiten zu sehen.

| Feld                     | Standard | Zweck                                                                                               |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------- |
| Benutzername             | `admin`  | Das Konto der Weboberfläche                                                                         |
| Passwort                 | —        | Sein Passwort. Fünf falsche Passwörter sperren das Konto 30 Minuten lang auf der Kamera             |
| Bildaktualisierung       | 60       | Alle N Sekunden ein neues Dashboard-Bild (10 bis 3600, 0 = nur auf Anfrage und bei Erkennungen)     |
| Bild bei jeder Erkennung | ja       | Ein Bild, wenn eine Bewegung, eine Person, ein Fahrzeug oder ein Klingeln beginnt                   |
| Stream der Live-Ansicht  | Haupt    | Hauptstream (volle Auflösung) oder Substream (leichter)                                             |
| Geräteadressen           | —        | Für ein Gerät, das die Suche nicht findet: `192.168.1.108, 192.168.1.20:8080, https://192.168.1.30` |
| Konten pro Gerät         | —        | Für ein Gerät mit anderem Konto: `adresse\|benutzer\|passwort`, durch Kommas getrennt               |

Ein Rekorder (NVR, DVR, XVR) liefert ein Gerät pro darauf aktivierter Kamera; Türklingeln und Kameras je ein Gerät.

## Verwendung

### Dashboard

Fügen Sie eine **Kamera**-Box für Bild und Live-Ansicht sowie die Widgets der Integration hinzu:

![Die Widgets Kameras, Erkennungen und Aufnahmespeicher (generierte Illustration, kein Screenshot)](https://raw.githubusercontent.com/William-De71/gladys-amcrest-dahua/main/docs/assets/widgets.de.png)

- **Kameras**: wie viele Kameras ihre Ereignisse senden, die Erkennungen der letzten 24 Stunden, Zustand und letzte Erkennung jeder Kamera sowie eine Schaltfläche, um alle Bilder zu erneuern.
- **Erkennungen**: die letzten Erkennungen, die neueste zuerst, mit dem Bild aus diesem Moment (alle Kameras oder eine).
- **Aufnahmespeicher**: die SD-Karte oder die Festplatten einer Kamera oder eines Rekorders: belegt, frei, Kapazität, Zustand.

### Szenen

Auslöser:

- **Erkennung**: Bewegung, Person, Fahrzeug, Linie überquert, Eindringen, Geräusch, Sabotage oder Türklingel gedrückt, gefiltert nach Kamera und Art. Variablen: Name der Kamera, Art, Name der IVS-Regel, Objekttyp.
- **Alarm**: Video verloren, Alarmeingang, Speicherfehler, Speicher fast voll, kein Speicher.
- **Kamera nicht erreichbar** und **Kamera wieder da**.

Aktionen:

- **Bild aufnehmen**: ein frisches Bild, bereit für die folgende Aktion „Kamerabild senden“.
- **Aufnahmemodus**: immer aufnehmen, dem Zeitplan der Kamera folgen oder nicht aufnehmen.
- **Tür öffnen**: das Schloss an einer Dahua-Türstation (VTO).
- **Neu starten**.

Beispiele:

- Wenn die Türklingel gedrückt wird → ein Bild der Haustür aufnehmen → an die Familie senden und das Licht im Flur einschalten.
- Wenn nachts eine Person im Garten erkannt wird und niemand zu Hause ist → die Gartenbeleuchtung einschalten und das Bild senden.
- Wenn die letzte Person das Haus verlässt → Aufnahmemodus „immer aufnehmen“; wenn jemand ankommt → „Zeitplan der Kamera“.

## Fehlerbehebung

- **„Passwort abgelehnt“**: Prüfen Sie das Konto in der Weboberfläche der Kamera. Nach einer Ablehnung wartet die Integration zehn Minuten, bevor sie erneut fragt (die Kamera sperrt das Konto nach fünf Fehlversuchen für 30 Minuten); korrigieren Sie das Passwort und klicken Sie dann auf **Verbindung testen**.
- **Ein Gerät wird von der Suche nicht gefunden**: Die Erkennung nutzt einen UDP-Broadcast auf Port 37810, der weder VLANs noch manche WLAN-Isolierungen überquert. Tragen Sie seine Adresse unter **Geräteadressen** ein.
- **Keine Antwort von einer Adresse**: HTTP ist vielleicht deaktiviert oder auf einem anderen Port (Netzwerk → Port in der Weboberfläche); fügen Sie `:port` hinzu, oder `https://`, wenn nur HTTPS aktiviert ist.
- **Keine Live-Ansicht**: RTSP muss aktiviert sein (Netzwerk → Port → RTSP, standardmäßig Port 554); starten Sie nach einer Änderung des Streams oder des Passworts erneut eine Suche, damit die Adresse der Live-Ansicht aktualisiert wird.
- **Kein Personen- oder Fahrzeugsensor**: Aktivieren Sie die intelligente Bewegungserkennung oder eine IVS-Regel in der Kamera und starten Sie dann erneut eine Suche (eine Funktion wird nur durch eine Suche hinzugefügt).
- **Klingeln wird nicht erkannt**: Manche VTO-Firmwares senden das Klingeln nur über ihr eigenes DHIP-Protokoll, nicht über HTTP; bitte öffnen Sie ein Issue mit Modell und Firmware.
- Protokolle: der Reiter **Überwachung** der Integration. Melden Sie Probleme auf GitHub mit den Versionen von Gladys und der Integration, Modell und Firmware des Geräts und dem Ergebnis von **Verbindung testen**.
