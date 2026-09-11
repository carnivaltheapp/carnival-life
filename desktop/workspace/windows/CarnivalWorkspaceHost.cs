using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class CarnivalWorkspaceHost
{
    private const string HostMarker = "DRAWER-HOST-2";
    private const int CornerTolerancePixels = 2;
    private const int DwellMilliseconds = 200;
    private const int RetractDwellMilliseconds = 150;
    private const int MonitorDefaultToNearest = 2;
    private static readonly object OutputLock = new object();
    private static readonly object StateLock = new object();
    private static volatile bool inputClosed;
    private static bool drawerOpen;
    private static int contextRight;
    private static int configuredMonitorRight;
    private static int configuredMonitorTop;
    private static int configuredMonitorBottom;

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int Size;
        public Rect Monitor;
        public Rect Work;
        public int Flags;
    }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(Point point, int flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    private static void Main()
    {
        WriteStartupDiagnostic();
        SendNative("{\"type\":\"hostReady\",\"version\":\"" + HostMarker + "\"}");

        var inputThread = new Thread(DrainChromeInput) { IsBackground = true };
        inputThread.Start();

        Stopwatch dwell = null;
        Stopwatch retractDwell = null;
        var sentForCurrentEntry = false;
        while (!inputClosed)
        {
            Point pointer;
            if (!GetCursorPos(out pointer))
            {
                Thread.Sleep(50);
                continue;
            }

            var monitor = MonitorFromPoint(pointer, MonitorDefaultToNearest);
            var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (!GetMonitorInfo(monitor, ref info))
            {
                Thread.Sleep(50);
                continue;
            }

            var inCorner = pointer.X <= info.Monitor.Left + CornerTolerancePixels &&
                           pointer.Y <= info.Monitor.Top + CornerTolerancePixels;
            if (!inCorner)
            {
                dwell = null;
                sentForCurrentEntry = false;
            }
            else if (!sentForCurrentEntry)
            {
                if (dwell == null) dwell = Stopwatch.StartNew();
                if (dwell.ElapsedMilliseconds >= DwellMilliseconds)
                {
                    SendSummon(monitor, info.Work);
                    sentForCurrentEntry = true;
                }
            }

            bool open;
            int rightEdge;
            int monitorRight;
            int monitorTop;
            int monitorBottom;
            lock (StateLock)
            {
                open = drawerOpen;
                rightEdge = contextRight;
                monitorRight = configuredMonitorRight;
                monitorTop = configuredMonitorTop;
                monitorBottom = configuredMonitorBottom;
            }
            var retractThreshold = Math.Min(rightEdge + 150, monitorRight - 1);
            var beyondRightEdge = open && pointer.X >= retractThreshold &&
                                  pointer.Y >= monitorTop && pointer.Y < monitorBottom;
            if (!beyondRightEdge)
            {
                retractDwell = null;
            }
            else
            {
                if (retractDwell == null) retractDwell = Stopwatch.StartNew();
                if (retractDwell.ElapsedMilliseconds >= RetractDwellMilliseconds)
                {
                    lock (StateLock) { drawerOpen = false; }
                    SendNative("{\"type\":\"retract\"}");
                    retractDwell = null;
                }
            }

            Thread.Sleep(25);
        }
    }

    private static void WriteStartupDiagnostic()
    {
        try
        {
            var directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Carnival",
                "DesktopWorkspace"
            );
            Directory.CreateDirectory(directory);
            File.AppendAllText(
                Path.Combine(directory, "CarnivalWorkspaceHost.log"),
                string.Format(
                    CultureInfo.InvariantCulture,
                    "{0:u} Carnival native host: {1} (pid {2}){3}",
                    DateTime.UtcNow,
                    HostMarker,
                    Process.GetCurrentProcess().Id,
                    Environment.NewLine
                )
            );
        }
        catch
        {
            // Diagnostics must never prevent the native host from starting.
        }
    }

    private static void DrainChromeInput()
    {
        var input = Console.OpenStandardInput();
        var lengthBytes = new byte[4];
        try
        {
            while (ReadExactly(input, lengthBytes, 4))
            {
                var length = BitConverter.ToInt32(lengthBytes, 0);
                if (length < 0 || length > 4096) break;
                var payload = new byte[length];
                if (!ReadExactly(input, payload, length)) break;
                ApplyWorkspaceState(Encoding.UTF8.GetString(payload));
            }
        }
        finally
        {
            inputClosed = true;
        }
    }

    private static bool ReadExactly(Stream stream, byte[] buffer, int count)
    {
        var offset = 0;
        while (offset < count)
        {
            var read = stream.Read(buffer, offset, count - offset);
            if (read == 0) return false;
            offset += read;
        }
        return true;
    }

    private static void SendSummon(IntPtr monitor, Rect work)
    {
        var culture = CultureInfo.InvariantCulture;
        var json = string.Format(
            culture,
            "{{\"type\":\"summon\",\"monitorId\":\"windows-{0}\",\"workArea\":{{\"left\":{1},\"top\":{2},\"width\":{3},\"height\":{4}}}}}",
            monitor.ToInt64().ToString(culture),
            work.Left,
            work.Top,
            work.Right - work.Left,
            work.Bottom - work.Top
        );
        SendNative(json);
    }

    private static void ApplyWorkspaceState(string json)
    {
        if (!Regex.IsMatch(json, "\\\"type\\\"\\s*:\\s*\\\"workspaceState\\\"")) return;
        if (Regex.IsMatch(json, "\\\"state\\\"\\s*:\\s*\\\"retracted\\\""))
        {
            lock (StateLock) { drawerOpen = false; }
            return;
        }
        if (!Regex.IsMatch(json, "\\\"state\\\"\\s*:\\s*\\\"open\\\"")) return;
        int parsedContextRight;
        int parsedMonitorRight;
        int parsedMonitorTop;
        int parsedMonitorBottom;
        if (!TryReadInteger(json, "contextRight", out parsedContextRight) ||
            !TryReadInteger(json, "monitorRight", out parsedMonitorRight) ||
            !TryReadInteger(json, "monitorTop", out parsedMonitorTop) ||
            !TryReadInteger(json, "monitorBottom", out parsedMonitorBottom) ||
            parsedMonitorBottom <= parsedMonitorTop) return;
        lock (StateLock)
        {
            contextRight = parsedContextRight;
            configuredMonitorRight = parsedMonitorRight;
            configuredMonitorTop = parsedMonitorTop;
            configuredMonitorBottom = parsedMonitorBottom;
            drawerOpen = true;
        }
    }

    private static bool TryReadInteger(string json, string property, out int value)
    {
        value = 0;
        var match = Regex.Match(json, "\\\"" + Regex.Escape(property) + "\\\"\\s*:\\s*(-?\\d+)");
        return match.Success && int.TryParse(match.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
    }

    private static void SendNative(string json)
    {
        var payload = Encoding.UTF8.GetBytes(json);
        lock (OutputLock)
        {
            var output = Console.OpenStandardOutput();
            var length = BitConverter.GetBytes(payload.Length);
            output.Write(length, 0, length.Length);
            output.Write(payload, 0, payload.Length);
            output.Flush();
        }
    }
}
