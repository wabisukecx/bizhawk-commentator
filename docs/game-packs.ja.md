# ゲームパックの作成と導入

ゲームごとのROM識別・RAM読み取り・差分検出・実況ルール・名前表を、1個のZIPとして追加できます。本体のレジストリを編集する必要はありません。パックAPIの現行版は`1`です。

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

## 既存FE対応を1個のZIPにする

```powershell
npm.cmd run game-pack -- export-fe1
```

`runtime/game-packs/fe1-jp-v1.zip`に書き出します。Luaのプロファイルと文字表、アプリの解析・実況ロジック、人物名・英語名の表を含みます。ROM画像は含みません。出力先を指定する場合:

```powershell
npm.cmd run game-pack -- export-fe1 game-packs/fe1-jp-v1.zip
```

FEは従来どおり本体内蔵でも動作します。同じIDのパックを追加すると、パック版が内蔵版に代わります。パックを外すと内蔵版に戻ります。既存実装をZIPへまとめる書き出し機能なので、ゲーム固有のコードをすべて宣言的なデータに変換するものではありません。

## 新しいゲームの雛形

`examples/game-pack/`は、HPとステージを扱う最小例です。アドレスとROMハッシュは架空で、市販ゲームの対応データではありません。FE用のユニット構造を使わず、専用の差分エンジンから実況までを実行できます。

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
npm.cmd run game-pack -- build examples/game-pack runtime/game-packs/example-hp-v1.zip
```

ZIPを手作業で作る場合も、`pack.json`を含むファイル群を最上位へ入れます。フォルダ自体を丸ごと包むと読み込めません。

## pack.json

```json
{
  "apiVersion": 1,
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
- `memoryDomain`: `read(address)`が参照するBizHawkのメモリドメイン。省略時は`System Bus`。パックごとに1ドメインを指定します。
- `lua`／`adapter`: ZIP内の相対パス。Luaは`.lua`、アダプターは`.js`または`.mjs`。
- `observation`: 差分スキーマ。既存の`tactical-map-v1`を使う場合は`entry`を省略できます。独自の状態形式ではエンジンのLuaファイルを指定します。

複数ZIP間でIDやROMの組み合わせが重なる場合、登録はエラーになります。独自エンジンの名前も他のパックと重複できません。パックと内蔵プロファイルが同じROMに一致する場合はパックを優先します。内蔵と同じIDを使う場合、そのパックのROM一覧がそのIDの対応範囲となります。

## Luaの読み取りと差分エンジン

プロファイルは次の形式のテーブルを返します。

```lua
local profile={id="example-hp-v1", observation_kind="example-hp-events-v1"}
function profile.read(read, read_nametable)
    -- read(address)で指定ドメインの1バイトを読む。
    -- 値を検証し、無効な場面ではnilと理由を返す。
    return {profile_id=profile.id, hp=read(0x0100), max_hp=read(0x0101), stage=1}
end
return profile
```

`read_nametable`は既存FE向けの画面タイル取得です。汎用の画像認識や、全機種共通の画面タイルAPIではありません。ROMの照合は`pack.json`を基準に本体が設定します。

パック側のLuaには、`read`コールバックと基本的なLua関数・文字列・テーブル・数値関数を渡します。`memory`・`joypad`・`comm`・`io`・`os`などは直接渡しません。`dofile`は同じパック内の補助ファイルだけを読み込めます。既存FEの文字表などもこの方式で同梱できます。

独自エンジンは`new(session)`で、次のメソッドを持つ観測オブジェクトを返します。

| メソッド・フィールド | 役割 |
|---|---|
| `sample(frame, hash, state)` | 今回と前回の有効な状態を比較してイベントを記録 |
| `reset(reason)` | ステート読み込みなどで比較元・イベントを破棄し、履歴区間を変更 |
| `get()` | `timeline_id`・`events`・取得済みフレームなどを返す |
| `last_frame`・`hash` | ブリッジが観測の間隔とROM変更を確認する値 |

イベントには増加する`event_id`と`type`を付けます。`timeline_id`は巻き戻し・ROM変更・ステート読み込み・ゲーム内の大きな場面変更などで区切り、記録量を制限してください。状態が無効な区間をまたいで出来事を推測しないことが重要です。詳しい実装はサンプルの`lua/observer.lua`を参照してください。

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

`selectCandidate`は選んだ要素の`event`と`receivedAt`を保持し、`priority`・`category`・`context`などを加えて返します。静かなときは`null`を返します。生成間隔・利用上限・停止・古い応答の破棄は本体が担当します。

名前表などの補助モジュールは通常の相対`import`で同梱できます。共通の翻訳関数`t`と定型文関数`phrase`が必要なら、キャッシュ最上位に本体が生成する`host.mjs`から読み込めます。`app/adapter.js`なら`import { t, phrase } from '../host.mjs'`です。`host.mjs`と`package.json`はZIPに含めません。本体の他の内部ファイルへ直接依存すると、更新時の互換性を保ちにくくなります。

## 形式の制限と検証範囲

- ZIPは4 MiB以下、展開後は合計16 MiB以下、1ファイル2 MiB以下、ZIPエントリーは128件以下。
- ファイル形式は`.json`・`.js`・`.mjs`・`.lua`・`.md`・`.txt`。ROMや実行バイナリを含めません。
- 絶対パス・親ディレクトリ参照・Windows予約名・大文字小文字だけが異なる重複パスは拒否します。
- 外側からパックを置くだけで登録できますが、新しいゲームのRAM解析や実況ルールそのものは用意する必要があります。
- 既存FEのZIP化と、合成データのHPサンプルで読取→差分→実況を自動テストしています。別の市販ゲームの実機動作を確認したものではありません。

将来は単純なアドレス表や条件をJSONへ寄せられます。現在は複雑な戦闘・会話の解析や話題選択を維持できることを優先し、データとコードを同じZIPにまとめる方式です。
