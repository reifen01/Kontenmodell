# Kontenmodell

Kleiner Rechner für ein Mehrkontenmodell: Das monatliche Nettoeinkommen wird auf
Konten ("Buckets") aufgeteilt, die Fixkosten werden aus einer eigenen Liste
automatisch auf Monatswerte umgerechnet.

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
  ]
}
```

Die Kontofarben referenzieren CSS-Variablen (`--c-risiko`, `--c-fix`,
`--c-lifestyle`, `--c-urlaub`, `--c-invest`, `--c-steuer`), die in
`styles.css` definiert sind. Dort lässt sich auch die Farbgebung anpassen;
Hell- und Dunkelmodus folgen den Systemeinstellungen.

## Dateien

- `index.html` – Aufbau und Zeilen-Templates
- `styles.css` – Layout, Farbschema, mobile Ansicht
- `app.js` – Zustand, Berechnung, Rendering, Import/Export
