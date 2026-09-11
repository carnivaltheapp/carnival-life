import AppKit
import Foundation

private let cornerTolerance: CGFloat = 2
private let dwellSeconds = 0.2
private let outputLock = NSLock()

private final class HostState {
    private let lock = NSLock()
    private var closed = false

    func close() {
        lock.lock()
        closed = true
        lock.unlock()
    }

    func isClosed() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return closed
    }
}

private let hostState = HostState()

private struct WorkArea {
    let height: Int
    let left: Int
    let top: Int
    let width: Int
}

private func sendSummon(monitorId: String, workArea: WorkArea) {
    let message: [String: Any] = [
        "type": "summon",
        "monitorId": monitorId,
        "workArea": [
            "left": workArea.left,
            "top": workArea.top,
            "width": workArea.width,
            "height": workArea.height,
        ],
    ]
    guard let payload = try? JSONSerialization.data(withJSONObject: message) else { return }
    var length = UInt32(payload.count).littleEndian
    let prefix = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
    outputLock.lock()
    FileHandle.standardOutput.write(prefix)
    FileHandle.standardOutput.write(payload)
    outputLock.unlock()
}

private func monitorIdentifier(_ screen: NSScreen) -> String {
    let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    return "macos-\(number?.stringValue ?? "unknown")"
}

private func chromeWorkArea(for screen: NSScreen) -> WorkArea {
    let primaryTop = NSScreen.screens.first?.frame.maxY ?? screen.frame.maxY
    let visible = screen.visibleFrame
    return WorkArea(
        height: Int(visible.height.rounded()),
        left: Int(visible.minX.rounded()),
        top: Int((primaryTop - visible.maxY).rounded()),
        width: Int(visible.width.rounded())
    )
}

DispatchQueue.global(qos: .utility).async {
    let input = FileHandle.standardInput
    while true {
        let prefix = input.readData(ofLength: 4)
        if prefix.count != 4 { break }
        var encodedLength: UInt32 = 0
        _ = withUnsafeMutableBytes(of: &encodedLength) { prefix.copyBytes(to: $0) }
        let length = UInt32(littleEndian: encodedLength)
        if length > 4096 { break }
        let payload = input.readData(ofLength: Int(length))
        if payload.count != Int(length) { break }
        // Input is intentionally ignored. This host emits only hot-corner summons.
    }
    hostState.close()
}

var enteredAt: Date?
var sentForCurrentEntry = false
while !hostState.isClosed() {
    autoreleasepool {
        let pointer = NSEvent.mouseLocation
        guard let screen = NSScreen.screens.first(where: { NSMouseInRect(pointer, $0.frame, false) }) else {
            enteredAt = nil
            sentForCurrentEntry = false
            return
        }
        let inCorner = pointer.x <= screen.frame.minX + cornerTolerance &&
            pointer.y >= screen.frame.maxY - cornerTolerance
        if !inCorner {
            enteredAt = nil
            sentForCurrentEntry = false
        } else if !sentForCurrentEntry {
            if enteredAt == nil { enteredAt = Date() }
            if Date().timeIntervalSince(enteredAt!) >= dwellSeconds {
                sendSummon(
                    monitorId: monitorIdentifier(screen),
                    workArea: chromeWorkArea(for: screen)
                )
                sentForCurrentEntry = true
            }
        }
    }
    Thread.sleep(forTimeInterval: 0.025)
}
