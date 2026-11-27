# hf-game-studio

[한국어](README.md) · [日本語](README.ja.md)

**A skill for making games with an AI coding tool.** The model of the tool you are using (Claude Code, Codex, Antigravity or Gemini CLI) is the lead: it does the design and the code itself and calls other AI models only for what they do best.

| Work | Done by |
|---|---|
| Design, code, numbers, checking | The lead (your tool's model) |
| Story, dialogue | Gemini (Argon; written by the lead when on a Google-family lead) |
| Images, sound effects | [asset-pipeline](https://github.com/prentice7725/asset-pipeline) (ComfyUI and others) |
| Code review | A model from another vendor (Codex by default; Claude under a Codex lead) |

The other models can't edit files. They only return results. Images and sounds are kept only after a person has seen or heard them.

## Why

When you hand a game to an AI, two things often go wrong.

1. **You can't trust "done".** So every task first defines **checks a machine runs**, and the task is finished only when they pass.
2. **You find out it isn't fun only after building it.** So before building anything big, a **small experiment** asks whether this choice actually changes the outcome (v3, being trialled).

## Install

You need Node.js 24 or later, Git and one tool to act as the lead (Claude Code, Codex, Antigravity or Gemini CLI). Install the other models only if you use them (`codex`, `claude`, `agy`, asset-pipeline).

For writing, you can call Vertex AI directly without `agy` (`--writer vertex`). Point `GOOGLE_APPLICATION_CREDENTIALS` to your service account key JSON; see "글쓰기를 Vertex AI로 직접" in [SKILL.md](SKILL.md) (Korean).

```bash
git clone https://github.com/prentice7725/hf-game-studio.git ~/.claude/skills/hf-game-studio
```

Set up a game repository:

```bash
node ~/.claude/skills/hf-game-studio/scripts/setup.mjs <game repo>
```

This adds design document templates (`design/`), check tools (`tools/hfgs/`) and helper skills (`.claude/skills/gs-*` by default, depending on `--host`). Existing files are not overwritten.

- Add `--phaser` for a web prototype (Phaser 4)
- Add `--godot` for the main game in Godot 4.7

### With a tool other than Claude Code

Clone the skill into that tool's skill folder and set `HFGS_HOST` so the scripts know who the lead is (Claude Code is detected automatically).

| Lead | Clone into | Environment | Setup |
|---|---|---|---|
| Codex | `~/.codex/skills/hf-game-studio` | `HFGS_HOST=codex` | `setup.mjs <game repo> --host=codex` |
| Antigravity | `~/.gemini/config/skills/hf-game-studio` | `HFGS_HOST=agy`, `HFGS_HOST_MODEL=<model ID>` | `setup.mjs <game repo> --host=agy` |
| Gemini CLI | `~/.gemini/skills/hf-game-studio` | `HFGS_HOST=gemini` | `setup.mjs <game repo> --host=gemini` |

The reviewer and the writer depend on the lead. With Codex as the lead, Claude reviews. With Antigravity or Gemini CLI as the lead, the lead writes the text itself. When `HFGS_HOST_MODEL` is set, `task.mjs start` rejects models below the host's frontier tier (Claude Opus, Codex Sol, or Gemini Neon). See "호스트" in [SKILL.md](SKILL.md) (Korean). Only the Claude Code lead has been run in real sessions.

## How to use

Open your lead tool (Claude Code or another) in the game repository and ask in plain words, for example:

- "Make the first mercenary entry in the data"
- "Prototype the contract board screen"
- "Generate three portrait candidates for the hero"

The lead follows these steps on its own:

```text
define the task → confirm the checks fail first → build → confirm the checks pass → another model reviews → (images and sound) a person approves
```

### Experiments (v3, being trialled)

| Skill | What it does |
|---|---|
| `/gs-inspect` | Compares the design documents with the code and lists gaps and the next questions to test |
| `/gs-research` | Looks up, with sources, how similar games solved the problem |
| `/gs-experiment` | Turns one question into an experiment card: hypothesis, what would prove it wrong, and measures, all written before building |

Experiments start with the cheapest step. If a simulation answers the question, no screen is built.

```text
simulation → web prototype → Godot game
```

## Enforced rules

- **Checks must fail first.** A check that already passes before any change proves nothing, so `task.mjs start` rejects it.
- **The check criteria can't be changed.** Editing schemas, asset specs or the glossary during a task fails `task.mjs verify`.
- **Editing files outside the declared scope fails `task.mjs verify`.**
- **Reviewers don't get the author's explanation.** They judge from the changed code and the check results only.
- **An experiment's threshold is written before building and is not changed after seeing the result.**

## Further reading

The detailed documents are in Korean.

- [docs/reference.md](docs/reference.md): file layout, task file fields, task kinds, asset and Godot procedures, caveats
- [SKILL.md](SKILL.md): the procedure the lead follows
- [docs/design/game-studio-v2.md](docs/design/game-studio-v2.md), [game-studio-v3.md](docs/design/game-studio-v3.md): design background and field notes

## Tests

```bash
npm test
```

## License

MIT. Sources of borrowed parts are listed in [NOTICE.md](NOTICE.md).
