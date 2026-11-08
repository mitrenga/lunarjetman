# images/

**Prázdné až na tenhle soubor.** Ikony aplikace, favicon a poster patří do
**M7** a vyrábějí se nástroji ze svision, ne ručně:

- `app/svision/tools/make-app-icons` — `app-icon.svg` → PNG sady
  (192, 256, 512, 1024, 1980)
- `app/svision/tools/make-favicon` — `favicon.ico`

Předlohou má být **grafika z originálu** (`data/sprites.json` — Jetman,
vozidlo), ne obrázek staný odjinud. `poster.png` a `cover.png` odkazuje
`index.php` a `aboutPage.php`.

★ Ikony jiné hry sem **nekopírovat**. `favicon.ico` v kořeni je zatím převzatý
z jetpacu jako výplň a v M7 se přepíše.
