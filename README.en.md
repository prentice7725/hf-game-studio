# hf-game-studio

[한국어](README.md) · [日本語](README.ja.md)

**A skill for making games with Claude Code.** Claude does the design and the code itself and calls other AI models only for what they do best.

| Work | Done by |
|---|---|
| Design, code, numbers, checking | Claude |
| Story, dialogue | Gemini (Argon) |
| Images, sound effects | [asset-pipeline](https://github.com/prentice7725/asset-pipeline) (ComfyUI and others) |
| Code review | A model from another vendor (Codex by default) |

The other models can't edit files. They only return results. Images and sounds are kept only after a person has seen or heard them.

## Why

When you hand a game to an AI, two things often go wrong.

1. **You can't trust "done".** So every task first defines **checks a machine runs**, and the task is finished only when they pass.
2. **You find out it isn't fun only after building it.** So before building anything big, a **small experiment** asks whether this choice actually changes the outcome (v3, being trialled).

## Install

You need Node.js 24 or later, Git and Claude Code. Install the other models only if you use them (`codex`, `agy`, asset-pipeline).

```bash
git clone https://github.com/prentice7725/hf-game-studio.git ~/.claude/skills/hf-game-studio
```

Set up a game repository:

```bash
node ~/.claude/skills/hf-game-studio/scripts/setup.mjs <game repo>
```

This adds design document templates (`design/`), check tools (`tools/hfgs/`) and helper skills (`.claude/skills/gs-*`). Existing files are not overwritten.

- Add `--phaser` for a web prototype (Phaser 4)
- Add `--godot` for the main game in Godot 4.7

## How to use

Open Claude Code in the game repository and ask in plain words, for example:

- "Make the first mercenary entry in the data"
- "Prototype the contract board screen"
- "Generate three portrait candidates for the hero"

Claude follows these steps on its own:

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

## Rules it enforces

- **Checks must fail first.** A check that already passes before any change proves nothing, so it is rejected.
- **The check criteria can't be changed.** Editing schemas, asset specs or the glossary during a task makes it fail.
- **Editing files outside the declared scope makes the task fail.**
- **Reviewers don't get the author's explanation.** They judge from the changed code and the check results only.
- **An experiment's threshold is written before building and is not changed after seeing the result.**

## Further reading

The detailed documents are in Korean.

- [docs/reference.md](docs/reference.md): file layout, task file fields, task kinds, asset and Godot procedures, caveats
- [SKILL.md](SKILL.md): the procedure Claude follows
- [docs/design/game-studio-v2.md](docs/design/game-studio-v2.md), [game-studio-v3.md](docs/design/game-studio-v3.md): design background and field notes

## Tests

```bash
npm test
```

## License

MIT. Sources of borrowed parts are listed in [NOTICE.md](NOTICE.md).
