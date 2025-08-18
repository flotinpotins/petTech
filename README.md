# Desktop Pet Step 1 (Electron + Rive)

Transparent, always-on-top Electron window playing a Rive state machine with pointer enter/leave/click interactions and drag-to-move.

## Requirements

- Node >= 18
- Windows 10+

## Install & Run

```bash
npm i
npm run dev
```

The app opens a 360x360 transparent, frameless, always-on-top window.

## Configuration

Copy `.env.example` to `.env` and optionally set an absolute path to a `.riv` file. If omitted, the app loads `assets/pet.riv`.

```
PET_RIV_PATH=F:\\rviepet\\assets\\pet.riv
```

Security rules for reading `.riv`:
- Only `.riv` extension
- Path must be in the whitelist: the `assets/` folder or the directory of `PET_RIV_PATH`

## Rive Wiring

- State Machine: `State Machine 1`
- Inputs:
  - `chick-awake` (trigger): pointer enter
  - `chick-sleep` (trigger): pointer leave (150ms grace, ignored while dragging)
  - `clik` (trigger): left-click

If inputs or state machine are missing, the app logs warnings and continues.

## Interactions

- Pointer enter -> awake
- Pointer leave -> sleep (150ms grace; ignored during drag)
- Left click -> clik
- Drag anywhere on the canvas to move the window (throttled, pointer capture)

## Notes

- High DPI: the canvas auto-resizes to devicePixelRatio and listens for DPI changes
- Clean up: the Rive instance is cleaned up on window close


## Step 2: Chat Popover (Comfly Chat streaming)

Env keys (see `.env.example`):

```
CHAT_API_BASE=https://ai.comfly.chat
CHAT_API_KEY=sk-9Syi1Zv9NCI8o5ry9110F8379c424fAa8514F55b628e7907 
CHAT_API_MODEL=gpt-4o-mini
CHAT_MAX_TURNS=50
PERSONA_CUSTOM_FILE=./persona/custom.txt
PERSONA_GREETING_FILE=./persona/greeting.txt
```

IPC contracts:
- `chat:openPopover` open/anchor the chat popover near the pet window
- `chat:send` send a user message
- `chat:delta` stream deltas to the chat window
- `pet:actions` optional actions mapping to Rive triggers

UI variables used by chat window:
- `--bg`, `--fg`, `--bubble-user`, `--bubble-bot` (dark theme)


