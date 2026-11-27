# hf-game-studio

[한국어](README.md) · [English](README.en.md)

**AI コーディングツールでゲームを作るためのスキルです。** いま使っているツール(Claude Code、Codex、Antigravity、Gemini CLI)のモデルがリードになり、企画とコードを自分で担当し、ほかの AI は得意な仕事にだけ呼びます。

| 仕事 | 担当 |
|---|---|
| 企画、コード、数値、検収 | リード(使っているツールのモデル) |
| シナリオ、セリフ | Gemini (Argon。Google 系リードなら自分で執筆) |
| 画像、効果音 | [asset-pipeline](https://github.com/prentice7725/asset-pipeline)(ComfyUI など) |
| コードレビュー | 別の会社のモデル(既定は Codex。Codex リードなら Claude) |

ほかの AI はファイルを書き換えられず、結果を返すだけです。画像と音は、人が見て聞いてから採用します。

## なぜ使うのか

AI にゲームを任せると、よく二つのことが崩れます。

1. **「できました」が信用できません。** そこで作業ごとに**機械が実行するチェック**を先に決め、それが通って初めて完了とみなします。
2. **作ってから面白くないと気づきます。** そこで大きなものを作る前に、**小さな実験**で「この選択は本当に結果を変えるのか」を確かめます(v3、試行中)。

## インストール

必要なもの: Node.js 24 以上、Git、リードにするツール 1 つ(Claude Code、Codex、Antigravity、Gemini CLI)。ほかの AI は使うものだけ入れれば十分です(`codex`、`claude`、`agy`、asset-pipeline)。

文章執筆は `agy` を通さず Vertex AI を直接呼ぶこともできます(`--writer vertex`)。サービスアカウントキー JSON を `GOOGLE_APPLICATION_CREDENTIALS` で指定してください。詳しくは [SKILL.md](SKILL.md) の「글쓰기를 Vertex AI로 직접」(韓国語)にあります。

```bash
git clone https://github.com/prentice7725/hf-game-studio.git ~/.claude/skills/hf-game-studio
```

ゲームのリポジトリに入れる:

```bash
node ~/.claude/skills/hf-game-studio/scripts/setup.mjs <ゲームのリポジトリ>
```

設計ドキュメントのひな形(`design/`)、チェックツール(`tools/hfgs/`)、補助スキル(既定は `.claude/skills/gs-*`、`--host` により変化)が入ります。既存のファイルは上書きしません。

- Web プロトタイプ(Phaser 4)も入れるなら `--phaser`
- Godot 4.7 の本編も入れるなら `--godot`

### Claude Code 以外のツールで使う

スキルをそのツールのスキルフォルダに置き、`HFGS_HOST` でリードが誰かを伝えます(Claude Code は自動で判別します)。

| リード | スキルの置き場所 | 環境変数 | セットアップ |
|---|---|---|---|
| Codex | `~/.codex/skills/hf-game-studio` | `HFGS_HOST=codex` | `setup.mjs <ゲームのリポジトリ> --host=codex` |
| Antigravity | `~/.gemini/config/skills/hf-game-studio` | `HFGS_HOST=agy`、`HFGS_HOST_MODEL=<モデル ID>` | `setup.mjs <ゲームのリポジトリ> --host=agy` |
| Gemini CLI | `~/.gemini/skills/hf-game-studio` | `HFGS_HOST=gemini` | `setup.mjs <ゲームのリポジトリ> --host=gemini` |

リードによってレビュアーと文章の担当が変わります。Codex がリードなら Claude がレビューし、Antigravity や Gemini CLI がリードなら文章はリードが自分で書きます。`HFGS_HOST_MODEL` を指定すると、ホストごとの最上位モデル(Claude Opus・Codex Sol・Gemini Neon 以上)未満は `task.mjs start` が拒否します。詳しくは [SKILL.md](SKILL.md) の「호스트」(韓国語)にあります。実際のセッションで動かしたのは Claude Code リードだけです。

## 使い方

ゲームのリポジトリでリードのツール(Claude Code など)を開き、言葉で頼むだけです。例:

- 「傭兵データの最初の項目を作って」
- 「依頼掲示板の画面をプロトタイプで作って」
- 「主人公の肖像画の候補を3枚出して」

リードは次の順序を自分で踏みます。

```text
作業の定義 → チェックがまず失敗することを確認 → 実装 → チェックが通ることを確認 → 別の AI がレビュー →(画像・音は)人が承認
```

### 実験(v3、試行中)

| スキル | すること |
|---|---|
| `/gs-inspect` | 設計ドキュメントとコードを突き合わせ、食い違いと次に確かめる問いを出す |
| `/gs-research` | 似たゲームがその問題をどう解いたかを出典付きで調べる |
| `/gs-experiment` | 一つの問いを実験カードにする: 仮説、間違いとみなす条件、測定を作る前に書く |

実験は安いものから行います。シミュレーションで答えが出れば画面は作りません。

```text
シミュレーション → Web プロトタイプ → Godot 本編
```

## 強制されるルール

- **チェックはまず失敗しなければなりません。** 手を入れる前から通るチェックは何も確かめないため、`task.mjs start` が受け付けません。
- **チェックの基準は変えられません。** 作業中にスキーマ、アセット規格、用語集を変えると `task.mjs verify` が失敗します。
- **決めた範囲の外のファイルを変えると `task.mjs verify` が失敗します。**
- **レビュアーは作者の説明を受け取りません。** 変わったコードとチェック結果だけで判定します。
- **実験のしきい値は作る前に書き、結果を見てから変えません。**

## さらに読む

詳しいドキュメントは韓国語です。

- [docs/reference.md](docs/reference.md): ファイル構成、作業ファイルの項目、作業の種類、アセット・Godot の手順、注意点
- [SKILL.md](SKILL.md): リードが従う手順
- [docs/design/game-studio-v2.md](docs/design/game-studio-v2.md)、[game-studio-v3.md](docs/design/game-studio-v3.md): 設計の背景と実測の記録

## テスト

```bash
npm test
```

## ライセンス

MIT。取り込んだ部分の出典は [NOTICE.md](NOTICE.md) にあります。
