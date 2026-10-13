# tibetan-siddham-mobile — Tibetan Sanskrit Mobile

[English](./README.md) ｜ [繁體中文](./README.zh-Hant.md) ｜ [日本語](./README.ja.md)

A mobile-first web app that converts **ASCII / IAST romanization** into **Tibetan-script Sanskrit** and a **Latin transliteration** as you type.
**The input sits on the keyboard and the output sits above it** — you see the result while typing, without scrolling.

It is the mobile edition of [tibetan-siddham](https://github.com/scottgfhong310/tibetan-siddham): same conversion core (that project's Tibetan rule table, used through the `TibetanSiddhamConverter` anti-corruption layer), with layout and features re-chosen for a phone, following the form of [bonji-mobile](https://github.com/scottgfhong310/bonji-mobile).
Part of the **nodeapp WebApp family**; shared guidelines live at <https://github.com/scottgfhong310/nodeapp-webapp-family>.

## Features

- **One screen, no page scroll**: Tibetan and transliteration sit **side by side (2:1)**, each scrolling on its own, with text bottom-aligned against the input row; while you type forward both scroll to the newest text.
- **Tibetan and Latin only**: there is no Siddhaṁ output — the way Sanskrit is stacked in Tibetan script does not map one-to-one onto Siddhaṁ, so showing both side by side confuses more than it helps. For Siddhaṁ use [bonji-mobile](https://github.com/scottgfhong310/bonji-mobile).
- **Follows the keyboard**: when the keyboard opens the app shrinks to its top edge (`visualViewport` on iOS, `interactive-widget=resizes-content` on Android) and the header collapses to give the height to the output.
- **Key row (vowels → consonants → subjoined → vowel signs → punctuation)**: a button at the right of the input cycles through five sets, 108 keys in all. Each key shows the **Tibetan glyph** with its notation underneath and inserts in one tap without closing the keyboard. The keys come from the same data as tibetan-siddham's input-assist panel.
  Consonant keys carry an inherent a (`ka`); to attach a vowel use the subjoined set (`k` + `i` = ཀི).
- **Punctuation**: when ignoring spaces, two spaces give the separator dot `་` (tsheg); three spaces give one full-width space; `|` = `།`, `||` = `༎`, `~` = `𑗁`, `~~` = `༄`. The full punctuation policy is in tibetan-siddham's DESIGN §5.
- **Options** (`tune`, top right): input method (ISO 15919 / Kyoto-Harvard), transliteration (ISO 15919 / IAST), ignore spaces & hyphens.
- **Records · JSON output** (`{}`, top right): save the current input with a **title** as a record, then output the whole list as JSON (copy or download). **Titles may be empty and may repeat** — record one mantra in several parts under the same title, and `part` in the output tells them apart. While typing, the add button under the Tibetan column records a part without closing the keyboard. Each record has three buttons — edit (✎), read in large type (👁, the full text at twice the size) and delete. Edit lets you change its title, type, notation, source / reference and options in place. Below the title there are a **type** field (one or more, like tags — separate with 、 or a comma; types you have used show up as chips: tap to add, tap again to remove) and a **source / reference** field (text number, page, URL…; may span lines): both are carried into every record you add, so one mantra recorded in several parts needs them only once. The list lives in your browser (not a backup); the Claude Artifacts edition keeps it in the artifact's database, so it survives closing and switching devices.
- Copy buttons per output; example chips; input and options are kept as a draft (in your browser only).
- Bundled **Noto Serif Tibetan** and **Noto Sans Siddham** (both SIL OFL; the latter only for the `𑗁` sign borrowed in the Tibetan column); three UI languages (`zh-Hant` / `en` / `ja`); light / dark themes.
- **No backend**: the server only serves static files. There is also a [Claude Artifacts edition](https://claude.ai/artifact/9jxT8XXBY9wF2wyt67qXv7) (private).

What it leaves out compared with tibetan-siddham (Siddhaṁ output, the code-point column, the input-assist panel, the chart page, server-side export files), and why, is in [`DESIGN.md`](./DESIGN.md) §5.

## Run

```bash
npm install
npm start                 # → http://localhost:3000/apps/tibetan-siddham-mobile/
npm run verify            # contract checks
```

## Notation (excerpt)

| Input | Tibetan | Latin |
|---|---|---|
| `o;m` | ཨོཾ | oṃ |
| `o;m  aa.h  huu~m` | ཨོཾ་ཨཱཿ་ཧཱུྃ | oṃ āḥ hūm̐ |
| `siddha;m` | སིདྡྷཾ | siddhaṃ |
| `hrii.h` | ཧྲཱིཿ | hrīḥ |
| `na ma.h |` | ནམཿ། | na maḥ | |

See tibetan-siddham's character chart for the full table.

## JSON output

```jsonc
{
  "app": "tibetan-siddham-mobile",
  "exportedAt": "2026-10-12T03:14:54.598Z",   // the moment you copied / downloaded
  "count": 2,
  "records": [
    {
      "seq": 1,                // position in the whole list
      "part": 1,               // position among records with the same title
      "title": "Hundred-Syllable Mantra",      // may be empty, may repeat
      "type": ["真言", "種子字"],   // types: array of strings, one or more (free text: 真言 mantra / 種子字 seed syllable / …); [] when none
      "source": "Taishō T20 No. 1050",         // where this record comes from (free text, may span lines; empty string when not given)
      "options": { "inputMethod": "ISO15919", "transliteration": "IAST", "ignoreSpacesAndHyphens": true },
      "input": "o;m  aa.h  huu~m",             // verbatim
      "output": {              // computed at output time; null plus an "error" when it cannot be converted
        "tibetan": "ཨོཾ་ཨཱཿ་ཧཱུྃ",
        "latin": "oṃ āḥ hūm̐",
        "codepoints": "U+0F68 U+0F7C U+0F7E U+0F0B …"   // code points of the Tibetan column
      },
      "savedAt": "2026-10-12T03:14:54.598Z"    // when this record was saved (or last edited)
    },
    { "seq": 2, "part": 2, "title": "Hundred-Syllable Mantra", "…": "…" }
  ]
}
```

Differences from tibetan-siddham's export file: one file is the **whole list** (not one record); `output` has **no `siddham`**; there is no `sourceFile`.

## License

[MIT](LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310). Bundles the conversion core of tibetan-siddham (MIT, same author), the **bonji-input** engine (MIT, © 2021 Ryusei Yamaguchi), and **Noto Serif Tibetan** and **Noto Sans Siddham** (SIL OFL 1.1, see `fonts/*-OFL.txt`).
