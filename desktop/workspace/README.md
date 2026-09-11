# Carnival Desktop Workspace

This slice coordinates two ordinary Chrome windows:

- left: [Carnival PlayHouse](https://carnival-playhouse.vercel.app/)
- right: a normal Chrome context window, initially Google Calendar

The Chrome extension owns window/tab identity, repair, saved bounds, and
validated context navigation. The resident Windows companion watches the global
pointer and animates the two physical Chrome windows through bounded Win32
positioning requests; its native-messaging bridge contains no Carnival business
logic.

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
stops an older installed companion if necessary, replaces its binary, writes a
Chrome native-host manifest, registers it under HKCU, configures the resident
companion in the current user's `Run` key, and starts it. It prints the installed
path and native-host marker (`DRAWER-HOST-3`). Administrator access is not
required. Restart Chrome after installation. Git updates do not update the
installed native executable automatically, so rerun this command after native
host source changes.

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

Move the pointer into the 5-by-5 pixel area at the top-left of any monitor and
hold it there for 200 ms. The resident companion polls the global Windows cursor
even when Chrome is not focused, then reports that monitor's usable work area
through the connected native-messaging bridge. If the bridge is unavailable,
the resident companion retains one summon for up to 15 seconds and opens a
normal-profile Chrome window to wake the extension; the pending summon executes
once the bridge reconnects. The extension creates or restores PlayHouse on the
left at 60% width and the normal
context window on the right at 40% width. On Windows, the resident companion
maps the two Chrome HWNDs from their extension-supplied starting rectangles and
moves them together with Win32 deferred window positioning through the same
250 ms eased animation. User-resized split ratios are saved in
`chrome.storage.local`, normalized into left/right roles, and reused on the same
monitor. Closing either or both windows is repaired by the next summon; their
saved visible geometry and last Context URL survive stale window IDs. Repeated
summons do not create duplicate workspace windows or repeated Chrome launches.

On normal desktop widths, the open workspace reserves a 101 pixel activation
gutter to the right. Moving the pointer 100 pixels beyond the Context window's
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
manual verification. The extension service-worker console confirms the current
Windows companion with `Carnival native host: DRAWER-HOST-3`; startup is also
recorded without credentials in
`%LOCALAPPDATA%\Carnival\DesktopWorkspace\CarnivalWorkspaceHost.log`. The log
records pointer-monitor startup, hot-corner entry/cancellation/activation,
bridge availability, and retract-zone activation without logging pointer motion
continuously.
