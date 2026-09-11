# Carnival Desktop Workspace

This slice coordinates two ordinary Chrome windows:

- left: [Carnival PlayHouse](https://carnival-playhouse.vercel.app/)
- right: a normal Chrome context window, initially Google Calendar

The Chrome extension owns window/tab identity, repair, positioning, saved bounds,
and validated context navigation. A native messaging host only watches the global
top-left hot corner and emits a fixed `summon` message after a 200 ms dwell. It
does not execute commands or contain Carnival business logic.

## One-time Chrome setup

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `extensions/chrome` in this repository.
4. Copy the 32-character extension ID Chrome displays.

Clicking the extension toolbar action is a non-global fallback that summons the
same workspace and is useful before installing the native host.

## Windows host

From PowerShell in the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File desktop/workspace/windows/install.ps1 `
  -ExtensionId <extension-id>
```

The installer compiles the small C# host into the current user's Local AppData,
writes a Chrome native-host manifest, and registers it under HKCU. Administrator
access is not required. Restart Chrome after installation.

## macOS host

Xcode Command Line Tools (for `swiftc`) are required. From the repository root:

```bash
chmod +x desktop/workspace/macos/install.sh
./desktop/workspace/macos/install.sh <extension-id>
```

The installer compiles the Swift/AppKit host into the current user's Application
Support directory and writes Chrome's per-user native-host manifest. Restart
Chrome after installation.

## Behavior and verification

Move the pointer into the extreme top-left corner of any monitor and hold it
there for 200 ms. The companion reports that monitor's usable work area. The
extension creates or restores PlayHouse at 40% width and the normal context
window at 60% width. User-resized bounds are saved in `chrome.storage.local` and
reused on the same monitor. Closing either window is repaired by the next summon;
repeated summons do not create duplicate workspace windows.

The right window remains an ordinary Chrome window with its normal cookies,
authentication, tabs, Back, Forward, Refresh, and address bar. Internal extension
callers can send `{ type: "openCarnivalContext", url }`; only HTTP(S) destinations
are accepted. No PlayHouse bridge invokes that message in this foundation slice.

Literal drawer animation and auto-hide are intentionally deferred. Instant
restore/positioning is more reliable across Windows and macOS window managers.
