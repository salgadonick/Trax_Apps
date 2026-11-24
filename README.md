# Trax Apps

Published web apps for Trax machines, served by GitHub Pages at
**https://salgadonick.github.io/Trax_Apps/**. Each app is a plain static
site that talks to its machine over Bluetooth Low Energy from the browser
(Web Bluetooth). Nothing here needs a server or an account.

This repo is a **published copy**. The source of truth for each app is the
machine's firmware repository, which carries the matching protocol and
publishes here with a script. Do not edit the app folders in this repo.

| App | URL | Source | Machines |
|---|---|---|---|
| Trax machine app | [`gse/`](https://salgadonick.github.io/Trax_Apps/gse/) | `Single-Motor-Motherboard` → `GSE_logicBoard/TillerHandle_Code/clients/web` | GSE tugs with the Trax tiller-handle logic board, and X2 dual-motor machines with the X2 logic board. The app recognises the unit from its `ID` line and loads the matching dashboard, so it is the one to install for any machine until a machine ships with its own. |

The folder is named `gse/` because the GSE tug was the first machine; the URL
stays the same so installed home-screen apps keep working.

| Machine | Dashboard | Firmware and protocol |
|---|---|---|
| GSE tug (product 1) | status, battery, phone control of the tiller handle | `Single-Motor-Motherboard` → `GSE_logicBoard/TillerHandle_Code` |
| X2 dual-motor (product 2) | who is driving, both tracks, wheel speed and drive assist, battery, phone control in RC-car or tank style | `Remote-Controllers` → `Dual-Motor/code/ESP32-C6` (`x2_receive`, `docs/X2_PROTOCOL.md`) |

## Opening an app

The app needs a browser with Web Bluetooth. It must be served over HTTPS,
which is why it lives here and not on a laptop.

- **Android:** Chrome. Open the URL, tap **Bluetooth**, pick the unit.
- **iPhone / iPad:** Safari has no Web Bluetooth. Install
  [Bluefy](https://apps.apple.com/app/id1492822055) (free), open the URL in
  it. The first time, allow Bluefy to use Bluetooth when iOS asks.
- **Windows / macOS / Linux desktop:** Chrome or Edge.

**Home screen:** in Chrome, menu → *Add to Home screen* / *Install app*. In
Bluefy, share → *Add to Home Screen*. The app then opens full-screen with the
Trax icon and works offline once loaded.

## Pairing a unit

Control functions are only accepted from a paired phone. On the machine,
triple-press the unit's power button (on a GSE tug it is on the tiller
handle): the status light blinks slowly for
60 seconds. In the app, request control; accept the pairing prompt the
phone shows; request again. The pairing is remembered on both sides.

If the unit has been told to forget its phones (`BONDS,CLR` on the bench),
it also changes its Bluetooth address, so the phone sees it as a new device
and pairs again inside the window. The old entry in the phone's Bluetooth
list is a harmless ghost and can be removed.

## Publishing (maintainers)

From the firmware repo, after committing changes under `clients/web`:

```
powershell -ExecutionPolicy Bypass -File tools\publish_web.ps1
```

The script clones or updates this repo, replaces the app folder, copies the
landing page and this README from `tools/trax_apps/`, commits with the
firmware commit hash, and pushes `main`. Pages rebuilds within a minute.
`-EnablePages` turns Pages on for a freshly created repo.
