# tibetan-siddham-mobile — チベット文字 梵字・モバイル

[English](./README.md) ｜ [繁體中文](./README.zh-Hant.md) ｜ [日本語](./README.ja.md)

**ASCII / IAST のローマ字転写**を入力と同時に**チベット文字の梵字（Tibetan-script Sanskrit）**と**ラテン翻字**へ変換する、モバイル優先の WebApp です。
**入力欄はキーボードのすぐ上、出力はその上**——入力しながら結果が見え、スクロールは要りません。

[tibetan-siddham](https://github.com/scottgfhong310/tibetan-siddham) のモバイル版です。変換コアは同じ（同プロジェクトのチベット文字規則表を、腐敗防止層 `TibetanSiddhamConverter` 経由で使用）で、レイアウトと機能をスマートフォン向けに選び直しました。形は [bonji-mobile](https://github.com/scottgfhong310/bonji-mobile) に倣っています。
本アプリは **nodeapp WebApp ファミリー**の一員です。共通規約は <https://github.com/scottgfhong310/nodeapp-webapp-family>。

## 機能

- **1 画面・ページはスクロールしない**：チベット文字とラテン翻字が**左右に並び（幅 2:1）**、それぞれが個別にスクロールします。文字は下寄せで入力行に接し、末尾に入力している間は最新の文字まで自動でスクロールします。
- **出力はチベット文字とラテン翻字のみ**：悉曇は出力しません。チベット文字での梵字の組み方は悉曇の組み方と一対一に対応しないため、並べるとかえって紛らわしくなります。悉曇は [bonji-mobile](https://github.com/scottgfhong310/bonji-mobile) をご利用ください。
- **キーボードに追従**：キーボードが開くと画面がその上端まで縮み（iOS は `visualViewport`、Android は `interactive-widget=resizes-content`）、ヘッダーは自動で畳まれて出力に高さを譲ります。
- **記号列（母音 → 子音 → 下接子音 → 母音記号 → 句読点）**：入力欄の右のボタンで 5 組（計 108 キー）を順に切り替えます。キーには**チベット文字の字形**と記法が表示され、ワンタップで挿入でき、キーボードは閉じません。キーの内容は tibetan-siddham の入力補助パネルと同じデータです。
  子音キーは a を含みます（`ka`）。母音を付けるときは下接子音の組を使ってください（`k`＋`i`＝ཀི）。
- **約物**：スペースを無視する設定では、スペース 2 回で区切り点 `་`（tsheg）、スペース 3 回で全角スペース 1 つ。`|`＝`།`、`||`＝`༎`、`~`＝`𑗁`、`~~`＝`༄`。約物の方針の全体は tibetan-siddham の DESIGN §5 にあります。
- **オプション**（右上の `tune`）：入力方式（ISO 15919 / Kyoto-Harvard）、ラテン翻字（ISO 15919 / IAST）、スペースとハイフンを無視。
- **記録・JSON 出力**（右上の `{}`）：現在の入力に**タイトル**を付けて 1 件として記録し、記録全体を JSON として出力（コピーまたはダウンロード）できます。**タイトルは空欄でも重複しても構いません**——1 つの真言を数段に分けて同じタイトルで記録すると、出力の `part` が何段目かを示します。入力中はチベット文字欄の下の追加ボタンで記録でき、キーボードは閉じません。各記録には編集ボタン（✎）があり、タイトル・種別・記法・出典・参考・オプションをその場で変更できます。タイトル欄の下に**種別**欄（タグのように複数可——「、」またはカンマで区切ります。使った種別はボタンに並び、押すと追加、もう一度押すと外れます）と**出典・参考**欄（経典番号・ページ・URL など、複数行可）があり、追加する記録に引き継がれるので、1 つの真言を数段に分けて記録しても入力は一度で済みます。記録はブラウザーに保存されます（バックアップではありません）。Claude Artifacts 版では artifact のデータベースに保存され、閉じても端末を替えても残ります。
- 各出力にコピーボタン、例のチップ、入力とオプションの下書き保存（ブラウザー内のみ）。
- **Noto Serif Tibetan** と **Noto Sans Siddham** を同梱（いずれも SIL OFL。後者はチベット文字欄で借用する `𑗁` のためだけ）。3 言語 UI（`zh-Hant` / `en` / `ja`）、ライト / ダークテーマ。
- **バックエンドなし**：サーバーは静的ファイルを配信するだけです。[Claude Artifacts 版](https://claude.ai/artifact/9jxT8XXBY9wF2wyt67qXv7)（private）もあります。

tibetan-siddham との違い（悉曇出力・コードポイント欄・入力補助パネル・対照表ページ・サーバー保存のエクスポートは無し）とその理由は [`DESIGN.md`](./DESIGN.md) §5 を参照してください。

## 実行

```bash
npm install
npm start                 # → http://localhost:3000/apps/tibetan-siddham-mobile/
npm run verify            # 契約チェック
```

## 記法（抜粋）

| 入力 | チベット文字 | ラテン |
|---|---|---|
| `o;m` | ཨོཾ | oṃ |
| `o;m  aa.h  huu~m` | ཨོཾ་ཨཱཿ་ཧཱུྃ | oṃ āḥ hūm̐ |
| `siddha;m` | སིདྡྷཾ | siddhaṃ |
| `hrii.h` | ཧྲཱིཿ | hrīḥ |
| `na ma.h |` | ནམཿ། | na maḥ | |

対照の全体は tibetan-siddham の文字対照表を参照してください。

## JSON 出力の構造

```jsonc
{
  "app": "tibetan-siddham-mobile",
  "exportedAt": "2026-10-12T03:14:54.598Z",   // コピー／ダウンロードした瞬間
  "count": 2,
  "records": [
    {
      "seq": 1,                // 記録全体での順番
      "part": 1,               // 同じタイトルの中で何段目か
      "title": "百字真言",      // 空文字列でも重複しても可
      "type": ["真言", "種子字"],   // 種別：文字列の配列（複数可・自由記述）。なければ []
      "source": "大正蔵 T20 No.1050",   // この記録の出典・参考（複数行の自由記述。未入力なら空文字列）
      "options": { "inputMethod": "ISO15919", "transliteration": "IAST", "ignoreSpacesAndHyphens": true },
      "input": "o;m  aa.h  huu~m",             // 入力そのまま
      "output": {              // 出力時に計算。変換できないときは null で、"error" が付きます
        "tibetan": "ཨོཾ་ཨཱཿ་ཧཱུྃ",
        "latin": "oṃ āḥ hūm̐",
        "codepoints": "U+0F68 U+0F7C U+0F7E U+0F0B …"   // チベット文字欄のコードポイント
      },
      "savedAt": "2026-10-12T03:14:54.598Z"    // この記録を保存（または置き換え・編集）した時刻
    },
    { "seq": 2, "part": 2, "title": "百字真言", "…": "…" }
  ]
}
```

tibetan-siddham のエクスポートファイルとの違い：1 ファイルが**記録全体**（1 件ではない）、`output` に **`siddham` が無い**、`sourceFile` が無い。

## ライセンス

[MIT](LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310)。tibetan-siddham の変換コア（MIT、同作者）、**bonji-input** エンジン（MIT、© 2021 Ryusei Yamaguchi）、**Noto Serif Tibetan** と **Noto Sans Siddham**（SIL OFL 1.1、`fonts/*-OFL.txt` を参照）を同梱しています。
