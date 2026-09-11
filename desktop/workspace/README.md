# Carnival Desktop Workspace

This slice coordinates two ordinary Chrome windows:

- left: [Carnival PlayHouse](https://carnival-playhouse.vercel.app/)
- right: a normal Chrome context window, initially Google Calendar

The Chrome extension owns window/tab identity, repair, positioning, drawer
animation, saved bounds, and validated context navigation. A native messaging
host watches the global pointer and emits only fixed `summon` or `retract`
messages. It does not execute commands or contain Carnival business logic.

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
extension creates or restores PlayHouse on the left at 60% width and the normal
context window on the right at 40% width. Both windows move through the same
250 ms eased horizontal animation. User-resized split ratios are saved in
`chrome.storage.local`, normalized into left/right roles, and reused on the same
monitor. Closing either window is repaired by the next summon; repeated summons
do not create duplicate workspace windows.

On normal desktop widths, the open workspace reserves a 151 pixel activation
gutter to the right. Moving the pointer 150 pixels beyond the Context window's
right edge for 150 ms retracts both live windows off the monitor's left edge. On
an unusually narrow monitor, the gutter shrinks only enough to retain an 800
pixel workspace and the rightmost available pixel becomes the monitor-aware
fallback. The next hot-corner or toolbar activation reuses the same tabs,
browser history, and authentication.

The right window remains an ordinary Chrome window with its normal cookies,
authentication, tabs, Back, Forward, Refresh, and address bar. Internal extension
callers can send `{ type: "openCarnivalContext", url }`; only HTTP(S) destinations
are accepted. No PlayHouse bridge invokes that message in this foundation slice.

After updating the checked-out extension or native-host source, reload the
extension at `chrome://extensions` and rerun the platform installer before
manual verification.
