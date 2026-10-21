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
| GSE tiller handle | [`gse/`](https://salgadonick.github.io/Trax_Apps/gse/) | `Single-Motor-Motherboard` → `GSE_logicBoard/TillerHandle_Code/clients/web` | GSE tugs with the Trax tiller-handle logic board. The same app recognises every Trax unit from its `ID` line and loads the matching dashboard, so it is the one to install for any machine until a machine ships with its own. |

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
triple-press the tiller power button: the status light blinks slowly for
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
