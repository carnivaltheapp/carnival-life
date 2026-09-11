using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class CarnivalWorkspaceHost
{
    private const int CornerTolerancePixels = 2;
    private const int DwellMilliseconds = 200;
    private const int MonitorDefaultToNearest = 2;
    private static readonly object OutputLock = new object();
    private static volatile bool inputClosed;

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
        var inputThread = new Thread(DrainChromeInput) { IsBackground = true };
        inputThread.Start();

        Stopwatch dwell = null;
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

            Thread.Sleep(25);
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
                // Input is intentionally ignored. This host emits only hot-corner summons.
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
