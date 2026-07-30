# Kontenmodell

Kleiner Rechner für ein Mehrkontenmodell: Das monatliche Nettoeinkommen wird auf
Konten ("Buckets") aufgeteilt, die Fixkosten werden aus einer eigenen Liste
automatisch auf Monatswerte umgerechnet. Ein zweiter Tab bildet die passende
Bitcoin-Wallet-Struktur unterhalb des Investmentkontos ab.

Reines HTML/CSS/JavaScript ohne Abhängigkeiten und ohne Build-Schritt.

## Start

`index.html` im Browser öffnen – entweder direkt per Doppelklick oder über einen
lokalen Server:

```bash
npx http-server . -p 8080   # danach http://localhost:8080
```

## Konten-Modi

| Modus             | Bedeutung                                                  |
| ----------------- | ---------------------------------------------------------- |
| **Prozent**       | Anteil vom Nettoeinkommen (z. B. 15 % für Investment)      |
| **Fester Betrag** | Feste Summe pro Monat, unabhängig vom Einkommen            |
| **Fixkosten**     | Summe aller Fixkosten-Positionen (monatlich normalisiert)  |
| **Rest**          | Was nach allen anderen Konten übrig bleibt                 |

Gibt es mehrere Rest-Konten, teilen sie sich den Überschuss zu gleichen Teilen.
Fordern die Konten mehr als das Einkommen hergibt, wird die Überziehung in der
Übersicht ausgewiesen.

## Fixkosten

Jede Position hat einen Betrag und einen Turnus (monatlich, quartalsweise,
halbjährlich, jährlich). Der Monatswert ergibt sich aus Betrag × Faktor
(1, ⅓, ⅙, 1⁄12) – eine Jahresprämie von 600 € zählt also mit 50 € pro Monat.

## Bitcoin-Tab

Zoomt in das Investmentkonto hinein und besteht aus zwei Teilen.

**Sparplan & UTXO-Größe.** Die monatliche Sparrate wird entweder aus einem Konto
des Privatmodells übernommen (Standard: Investment) oder manuell gesetzt. Aus
Intervall (täglich / wöchentlich / monatlich), Kurs und Ziel-UTXO ergibt sich,
wie groß ein einzelner Kauf ist und nach wie vielen Käufen bzw. Monaten die
Zielgröße erreicht ist – der Zeitpunkt, um die angesammelten UTXOs konsolidiert
auf die Passphrase-Wallet zu schicken. Unterhalb von 3 Mio. Satoshi pro UTXO
weist der Rechner darauf hin, dass das spätere Ausgeben teuer wird, weil sich die
Gebühr nach der Transaktionsgröße richtet und nicht nach dem Betrag.

**Wallet-Struktur.** Der Bestand wird auf die Wallets verteilt – Modi `percent`,
`fixed` und `rest` wie im Privatmodell:

| Wallet            | Zweck                                            |
| ----------------- | ------------------------------------------------ |
| Hot Wallet        | Alltag, kleine Beträge                           |
| Cold Wallet       | Hardware-Wallet, Ziel des Sparplans              |
| Cold + Passphrase | konsolidierte UTXOs, Langfristbestand            |
| Multisig          | optional, erst ab etwa 100.000 € Bestand         |

Der Kurs wird nicht abgerufen, sondern von Hand eingetragen – die Seite macht
keine Netzwerkanfragen.

## Hilfe-Tab

Der Tab „?" fasst das Modell nach dem Pareto-Prinzip zusammen: die sechs Punkte
mit dem größten Effekt, die drei Geldregeln (Lifestyle-Inflation, Planbarkeit
vermeintlicher Notfälle, Ordnung), eine Einrichtungs-Anleitung in vier Schritten,
die Bankwahl je Konto, der Bitcoin-Teil in drei Sätzen und der Abschnitt zu
Disziplin. Reiner Text, keine Eingaben.

## Backup mit PIN

Neben dem einfachen JSON-Export gibt es ein verschlüsseltes Backup:

- **Schlüsselableitung:** PBKDF2-SHA256, 200.000 Runden, fester App-Salt
- **Verschlüsselung:** AES-GCM-256, zufälliger 96-Bit-IV je Datei
- **PIN** (4+ Ziffern) oder **Passwort** (8+ Zeichen)

Die Datei heißt `Kontenmodell_JJJJMMTT_HHMM_ZONE_AES256.json` und sieht so aus:

```json
{
  "magic": "KM-BACKUP-1",
  "v": 1,
  "mode": "pin",
  "iv": "<base64>",
  "ciphertext": "<base64>",
  "lastModified": "2026-07-30T18:25:00.000Z",
  "summary": { "bucketCount": 7, "fixedCostCount": 6, "walletCount": 4 }
}
```

`summary` bleibt unverschlüsselt, enthält aber nur Anzahlen – nie Beträge.
So zeigt der Lade-Dialog Datum und Umfang an, bevor der PIN abgefragt wird.
Der PIN wird nirgends gespeichert: Geht er verloren, ist die Datei nicht mehr
lesbar. Der Lade-Dialog akzeptiert auch unverschlüsselte JSON-Exporte.

## Als App installieren

Die Seite ist eine PWA: `manifest.webmanifest`, Icons unter `icons/` und ein
Service Worker (`sw.js`), der den App-Shell cacht – nach dem ersten Aufruf läuft
alles offline. Auf Android und Desktop erscheint ein Installationshinweis
(`beforeinstallprompt`), der sich für sieben Tage wegklicken lässt; iOS zeigt
stattdessen die Anleitung über Teilen → „Zum Home-Bildschirm".

Dafür muss die Seite über HTTP(S) ausgeliefert werden – per `file://` gibt es
keinen Service Worker, die Seite funktioniert dann aber ganz normal.

## Daten

Der Zustand liegt in `localStorage` (Schlüssel `kontenmodell.v1`); es werden
keine Daten übertragen. Über die Buttons unten lässt sich der Stand als JSON
exportieren und wieder importieren:

```json
{
  "income": 3000,
  "buckets": [
    { "id": "pnm45j3", "name": "Risikorücklage", "note": "Notgroschen", "mode": "percent", "value": 10, "color": "var(--c-risiko)" }
  ],
  "fixedCosts": [
    { "id": "slbhko3", "name": "Miete / Wohnen", "amount": 900, "freq": "monthly" }
  ],
  "bitcoin": {
    "source": "qr0ws1l",
    "rate": 100,
    "interval": "monthly",
    "price": 100000,
    "targetSats": 5000000,
    "holdings": 10000,
    "wallets": [
      { "id": "w2coldx", "name": "Cold Wallet", "note": "Ziel des Sparplans", "mode": "percent", "value": 20, "color": "var(--c-cold)" }
    ]
  }
}
```

`source` ist die ID des Kontos, aus dem die Sparrate kommt, oder `"manual"`.
Ältere Exporte ohne `bitcoin`-Block lassen sich weiterhin importieren – dann
greifen die Standardwerte.

Die Kontofarben referenzieren CSS-Variablen (`--c-risiko`, `--c-fix`,
`--c-lifestyle`, `--c-urlaub`, `--c-invest`, `--c-steuer`, `--c-spende`), die in
`styles.css` definiert sind. Dort lässt sich auch die Farbgebung anpassen;
Hell- und Dunkelmodus folgen den Systemeinstellungen.

## Dateien

- `index.html` – Aufbau, Zeilen-Templates, Dialoge
- `styles.css` – Layout, Farbschema, mobile Ansicht
- `app.js` – Zustand, Berechnung, Rendering, Backup, Installation
- `sw.js`, `manifest.webmanifest`, `icons/` – PWA-Teil
- `build-single.mjs` → `dist/kontenmodell.html` – alles in einer Datei
