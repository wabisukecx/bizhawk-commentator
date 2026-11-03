# ゲームパックの作成と導入

ゲームごとのROM識別・RAM読み取り・差分検出・実況ルール・名前表を、1個のZIPとして追加できます。本体のレジストリを編集する必要はありません。パックAPIの現行版は`2`です。本体には特定ゲームの内蔵アダプターや解析処理を持ちません。

`app/`は監視・生成・字幕・音声と共通の話し方、`lua/`は接続と汎用の読み取りを担当します。FE1の読み取り・定型実況文・文字表・戦闘や会話の解釈は、配布する`game-packs/fe1-jp-v1.zip`に含まれます。

## 導入・更新・削除

1. 入手したパックのZIPを、プロジェクト直下の`game-packs/`へ置きます。ZIP内の`pack.json`は最上位にある必要があります。
2. 見守りを停止し、字幕アプリと、このプロジェクトを使うMCPクライアントを終了します。共有サービスの終了まで最大15秒待ちます。
3. 字幕アプリまたはMCPクライアントを起動します。ZIPが検証され、実行用キャッシュとLuaの登録一覧が`runtime/game-packs/`に生成されます。
4. BizHawkをソケット指定で起動し、Luaブリッジを読み込みます。すでに起動している場合は、接続とLuaスクリプトを起動し直します。

インストール済みパックの確認:

```powershell
npm.cmd run game-pack -- list
```

更新時は古いZIPを新しいものへ置き換えて同じ手順で再起動します。削除時はZIPを取り除いて再起動します。キャッシュが残っていても登録は残りません。実行中の差し替えには対応していません。ZIPのファイル名は自由で、選択にはROMのシステムIDとSHA-1を使います。

パックはLua／JavaScriptのコードを含みます。特にJavaScriptはアプリと同じ権限で実行されるため、信頼できる配布元のパックを使ってください。ZIPのパス・サイズ・形式の検証は、コードの安全性を保証するものではありません。

## 新しいゲームの雛形

`tests/fixtures/game-pack/`は、HPとステージを扱う最小例です。アドレスとROMハッシュは架空で、市販ゲームの対応データではありません。FE用のユニット構造を使わず、専用の差分エンジンから実況までを実行できます。

```text
pack.json               ROM識別、エントリーポイント、API版
lua/profile.lua         RAMの読み取りと値の検証
lua/layout.lua          アドレス表
lua/observer.lua        変化をイベントにする処理
app/adapter.js          話題選択・表示・実況・ゲーム固有の注意
app/names.js            名前や翻訳の表
```

このフォルダを作業用にコピーし、ROMハッシュ、アドレス、検証条件、実況ルールを調べたゲームに合わせて変更します。ビルドは次の形式です。

```powershell
npm.cmd run game-pack -- build tests/fixtures/game-pack runtime/game-packs/example-hp-v1.zip
```

ZIPを手作業で作る場合も、`pack.json`を含むファイル群を最上位へ入れます。フォルダ自体を丸ごと包むと読み込めません。

## pack.json

```json
{
  "apiVersion": 2,
  "id": "example-hp-v1",
  "version": "1.0.0",
  "title": "HP example",
  "memoryDomain": "System Bus",
  "rom": {
    "system": "NES",
    "hashes": ["0000000000000000000000000000000000000000"]
  },
  "lua": "lua/profile.lua",
  "adapter": "app/adapter.js",
  "observation": {
    "kind": "example-hp-events-v1",
    "entry": "lua/observer.lua"
  }
}
```

- `id`: パック・Luaプロファイル・アダプターで一致させる識別子。小文字英字で始め、英小文字・数字・ハイフンで最大64文字。
- `version`: `1.0.0`形式のパックの版。更新時のキャッシュはZIP内容のSHA-256で分離されます。
- `rom`: BizHawkのシステムIDと、対象ROMの40桁SHA-1。別の版には、確認したハッシュを追加します。名前やワイルドカードでは照合しません。
- `memoryDomain`: `read(address)`が既定で参照するBizHawkのメモリドメイン。省略時は`System Bus`。必要なら読み取り時に別ドメインも指定できます。
- `lua`／`adapter`: ZIP内の相対パス。Luaは`.lua`、アダプターは`.js`または`.mjs`。
- `observation`: 差分スキーマとエンジンのLuaファイル。全パックで`kind`と`entry`が必要です。
- `files`: 任意のビルド対象一覧。例: `["app", "lua", "README.md"]`。指定すると、この一覧と`pack.json`だけがZIPに入り、`dev/`などの開発資料を除外できます。省略時はソースフォルダ全体を使います。

複数ZIP間でIDやROMの組み合わせが重なる場合、登録はエラーになります。観測エンジンの名前も他のパックと重複できません。

## Luaの読み取りと差分エンジン

プロファイルは次の形式のテーブルを返します。

```lua
local profile={id="example-hp-v1", observation_kind="example-hp-events-v1"}
function profile.read(read, reader)
    -- read(address)で指定ドメインの1バイトを読む。
    -- 値を検証し、無効な場面ではnilと理由を返す。
    return {profile_id=profile.id, hp=read(0x0100), max_hp=read(0x0101), stage=1}
end
return profile
```

`read(address, domain)`は指定ドメインの1バイトを返します。`reader`には同じ`read_u8`、`read_bytes(address, length, domain)`、`domains()`があります。バイト列とドメイン名は1始まりの配列です。画面タイルの取得など、機種・ゲーム固有のアドレスや解釈はパックが実装します。ROMの照合は`pack.json`を基準に本体が設定します。

パック側のLuaには、`read`コールバックと基本的なLua関数・文字列・テーブル・数値関数を渡します。`memory`・`joypad`・`comm`・`io`・`os`などは直接渡しません。`dofile`は同じパック内の補助ファイルだけを読み込めます。既存FEの文字表などもこの方式で同梱できます。

独自エンジンは`new(session)`で、次のメソッドを持つ観測オブジェクトを返します。

| メソッド・フィールド | 役割 |
|---|---|
| `sample(frame, hash, state)` | 今回と前回の有効な状態を比較してイベントを記録 |
| `reset(reason)` | ステート読み込みなどで比較元・イベントを破棄し、履歴区間を変更 |
| `get()` | `timeline_id`・`events`・取得済みフレーム、必要なら任意の`logs`を返す |
| `last_frame`・`hash` | ブリッジが観測の間隔とROM変更を確認する値 |

イベントには増加する`event_id`と`type`を付けます。`timeline_id`は巻き戻し・ROM変更・ステート読み込み・ゲーム内の大きな場面変更などで区切り、記録量を制限してください。状態が無効な区間をまたいで出来事を推測しないことが重要です。詳しい実装はサンプルの`lua/observer.lua`を参照してください。

`get().logs`は、スナップショットでは`game_logs`としてそのままアプリへ届きます。本体はログ名や中身を解釈しません。FEの戦闘構造、ページの重複、フェーズ表示などの検知・保持はFEの観測エンジンが担当します。ログは履歴区間のリセット時にクリアし、件数に上限を設けてください。

## アプリ側のアダプター

既存の`Watcher`をそのまま使います。モジュールの`default`として、次を持つオブジェクトを返します。

| 項目 | 役割 |
|---|---|
| `id`・`stateSchema` | パックIDと`observation.kind`に一致させる |
| `accepts(state)` | 状態の項目と範囲を検証 |
| `selectCandidate(pending, state, analysis)` | 新しいイベントから話題を選ぶ。なければ`null` |
| `fingerprint(state, event)` | 生成したコメントが古くなったかを確認する値 |
| `summarize(state)` | Claudeへ渡すゲーム状態 |
| `describe(state, language)` | 操作画面の状況ラベル |
| `instructions` | ゲーム固有の注意・解釈上の制約 |
| `playByPlay(events, state, options)` | 任意。ローカルで作る定型実況 |
| `normalize(snapshot, {language})` | 任意。名前の翻訳や選択対象などをパック側で整える |
| `localizeTone(key, language)` | 任意。共通の話し方にゲーム固有の定型文・能力名などを組み合わせる |
| `createRuntime()` | 任意。履歴区間ごとの、ゲーム固有の収集・解釈オブジェクトを作る |

`selectCandidate`は選んだ要素の`event`と`receivedAt`を保持し、`priority`・`category`・`context`などを加えて返します。静かなときは`null`を返します。生成間隔・利用上限・停止・古い応答の破棄は本体が担当します。

`createRuntime()`の戻り値は、必要な次のメソッドを実装します。本体はゲームのイベント名やログ構造を知りません。

| メソッド | 契約 |
|---|---|
| `observe(snapshot, events, {now, baseline})` | 今回の観測を受け取り、定型実況に加える派生イベントの配列を返す。`baseline`時は古い記録を再生しない |
| `candidate(state, {now})` | 会話や山場などの候補を返す。通常の`selectCandidate`より先に選ぶ。なければ`null` |
| `consume(candidate)` | 生成に渡した候補を処理済みにする |
| `quiet(state, now)` | ゲーム固有の理由で発言を控える間は`true` |
| `settled(state)` | 落ち着いたペースにする局面なら`true` |
| `context(state)` | モデル入力の`game_context`へ渡すゲーム固有の補足 |

ランタイムは起動時や履歴区間の変更時に作り直します。候補には必要に応じて`cooldownMs`（通常より短い間隔）、`urgent`（落ち着いた局面でも間隔を伸ばさない）、`skipFingerprint`（過去の確定イベント）、`allowRestatement`（台詞の翻訳など）を指定できます。FEのフェーズ推定・会話の収集・戦闘の向き・加入時の候補はFEパックの`app/runtime.js`が担当します。

Claudeの役割は、定型実況で伝える結果を言い直すことより、直近の流れへの補足です。モデルには`recent_flow.before`／`after`（比較元と現在の`summarize`結果）、`recent_changes`、`recent_narration`（直近2分に実際に出した定型実況を最大6件）を渡します。単なる称賛や撃破の言い直しだけの返答は、代表的な表現について本体でも抑制します。意味を追加できなければ`speak=false`を返す指示にしておきます。字幕に出さなくても生成要求は利用回数に数えます。

名前表などの補助モジュールは通常の相対`import`で同梱できます。公開ホストAPIは`import { localizedTone, phrase } from '#commentator/host'`で使えます。共通の口調・読み上げ設定と、任意のテンプレートを埋める関数を提供します。ゲーム固有の文面・能力名・翻訳表はパックへ入れます。ソースとZIPで同じimportが使え、本体の内部ファイルへの相対パスを書き換える必要はありません。`host.mjs`と`package.json`はZIPに含めません。

## 形式の制限と検証範囲

- ZIPは4 MiB以下、展開後は合計16 MiB以下、1ファイル2 MiB以下、ZIPエントリーは128件以下。
- ファイル形式は`.json`・`.js`・`.mjs`・`.lua`・`.md`・`.txt`。ROMや実行バイナリを含めません。
- 絶対パス・親ディレクトリ参照・Windows予約名・大文字小文字だけが異なる重複パスは拒否します。
- 外側からパックを置くだけで登録できますが、新しいゲームのRAM解析や実況ルールそのものは用意する必要があります。
- 既存FEのZIP化と、合成データのHPサンプルで読取→差分→実況を自動テストしています。別の市販ゲームの実機動作を確認したものではありません。

将来は単純なアドレス表や条件をJSONへ寄せられます。現在は複雑な戦闘・会話の解析や話題選択を維持できることを優先し、データとコードを同じZIPにまとめる方式です。
