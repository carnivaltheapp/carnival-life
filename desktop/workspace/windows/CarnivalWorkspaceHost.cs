using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class CarnivalWorkspaceHost
{
    private const string HostMarker = "DRAWER-HOST-3";
    private const int AnimationFramesPerSecond = 60;
    private const int HotCornerMaximumOffsetPixels = 4;
    private const int DwellMilliseconds = 200;
    private const int RetractDwellMilliseconds = 150;
    private const int MonitorDefaultToNearest = 2;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpNoOwnerZOrder = 0x0200;
    private const uint SwpNoZOrder = 0x0004;
    private static readonly object OutputLock = new object();
    private static readonly object PipeLock = new object();
    private static readonly object StateLock = new object();
    private static readonly object SummonLock = new object();
    private static readonly string PipeName = "CarnivalDesktopWorkspace-" + SafePipeSuffix();
    private static NamedPipeServerStream chromePipe;
    private static bool drawerOpen;
    private static int contextRight;
    private static int configuredMonitorRight;
    private static int configuredMonitorTop;
    private static int configuredMonitorBottom;
    private static string pendingSummon;
    private static DateTime pendingSummonSentAt;
    private static int pendingSummonRetries;

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

    private sealed class WindowBounds
    {
        public int Height;
        public int Left;
        public int Top;
        public int Width;
    }

    private sealed class ChromeWindow
    {
        public IntPtr Handle;
        public Rect Rect;
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern IntPtr BeginDeferWindowPos(int windowCount);

    [DllImport("user32.dll")]
    private static extern IntPtr DeferWindowPos(IntPtr positionInfo, IntPtr window, IntPtr insertAfter,
        int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern bool EndDeferWindowPos(IntPtr positionInfo);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(Point point, int flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    private static void Main(string[] args)
    {
        if (HasArgument(args, "--resident")) RunResident();
        else RunNativeMessagingBridge();
    }

    private static bool HasArgument(string[] args, string expected)
    {
        foreach (var argument in args)
        {
            if (string.Equals(argument, expected, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static string SafePipeSuffix()
    {
        return Regex.Replace(Environment.UserName, "[^A-Za-z0-9_.-]", "_");
    }

    private static void RunResident()
    {
        bool created;
        using (var mutex = new Mutex(true, "Local\\CarnivalDesktopWorkspace-" + SafePipeSuffix(), out created))
        {
            if (!created)
            {
                WriteDiagnostic("duplicate resident rejected");
                return;
            }
            WriteDiagnostic("resident started");
            new Thread(RunPipeServer) { IsBackground = true }.Start();
            MonitorGlobalPointer();
            GC.KeepAlive(mutex);
        }
    }

    private static void RunNativeMessagingBridge()
    {
        var pipe = ConnectToResident();
        if (pipe == null)
        {
            WriteDiagnostic("native bridge could not connect to resident");
            return;
        }
        using (pipe)
        using (var chromeInput = Console.OpenStandardInput())
        using (var chromeOutput = Console.OpenStandardOutput())
        {
            SendNative(chromeOutput, "{\"type\":\"hostReady\",\"version\":\"" + HostMarker + "\",\"nativeWindowAnimation\":true}");
            new Thread(delegate()
            {
                ForwardPipeToChrome(pipe, chromeOutput);
                WriteDiagnostic("bridge output ended; reconnect required");
                Environment.Exit(0);
            }) { IsBackground = true }.Start();
            ForwardChromeToPipe(chromeInput, pipe);
        }
    }

    private static NamedPipeClientStream ConnectToResident()
    {
        for (var attempt = 0; attempt < 2; attempt += 1)
        {
            var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            try
            {
                pipe.Connect(attempt == 0 ? 250 : 5000);
                return pipe;
            }
            catch
            {
                pipe.Dispose();
                if (attempt == 0) StartResidentProcess();
            }
        }
        return null;
    }

    private static void StartResidentProcess()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                Arguments = "--resident",
                CreateNoWindow = true,
                FileName = Process.GetCurrentProcess().MainModule.FileName,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
            });
            Thread.Sleep(150);
        }
        catch (Exception error)
        {
            WriteDiagnostic("resident start failed: " + error.GetType().Name);
        }
    }

    private static void RunPipeServer()
    {
        while (true)
        {
            using (var pipe = new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous
            ))
            {
                try
                {
                    pipe.WaitForConnection();
                    lock (PipeLock) { chromePipe = pipe; }
                    TrySendPendingSummon();
                    string message;
                    while ((message = ReadFramedMessage(pipe)) != null) HandleChromeMessage(message);
                }
                catch (IOException) { }
                finally
                {
                    lock (PipeLock)
                    {
                        if (ReferenceEquals(chromePipe, pipe)) chromePipe = null;
                    }
                }
            }
        }
    }

    private static void ForwardChromeToPipe(Stream chromeInput, Stream pipe)
    {
        string message;
        while ((message = ReadFramedMessage(chromeInput)) != null)
        {
            if (!WriteFramedMessage(pipe, message)) return;
        }
    }

    private static void ForwardPipeToChrome(Stream pipe, Stream chromeOutput)
    {
        string message;
        while ((message = ReadFramedMessage(pipe)) != null)
        {
            var summon = Regex.IsMatch(message, "\\\"type\\\"\\s*:\\s*\\\"summon\\\"");
            if (summon) WriteDiagnostic("bridge forwarding summon to Chrome");
            var written = SendNative(chromeOutput, message);
            if (summon) WriteDiagnostic(written ? "bridge summon frame written" : "bridge summon frame write failed");
            if (!written) return;
        }
    }

    private static string ReadFramedMessage(Stream stream)
    {
        var lengthBytes = new byte[4];
        if (!ReadExactly(stream, lengthBytes, 4)) return null;
        var length = BitConverter.ToInt32(lengthBytes, 0);
        if (length < 0 || length > 16384) return null;
        var payload = new byte[length];
        return ReadExactly(stream, payload, length) ? Encoding.UTF8.GetString(payload) : null;
    }

    private static bool ReadExactly(Stream stream, byte[] buffer, int count)
    {
        try
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
        catch (IOException) { return false; }
    }

    private static bool WriteFramedMessage(Stream stream, string json)
    {
        try
        {
            var payload = Encoding.UTF8.GetBytes(json);
            var length = BitConverter.GetBytes(payload.Length);
            lock (stream)
            {
                stream.Write(length, 0, length.Length);
                stream.Write(payload, 0, payload.Length);
                stream.Flush();
            }
            return true;
        }
        catch (IOException) { return false; }
    }

    private static void MonitorGlobalPointer()
    {
        Stopwatch summonDwell = null;
        Stopwatch retractDwell = null;
        var summonedForCurrentEntry = false;
        var retractCandidateActive = false;
        var firstPointerSampleLogged = false;
        WriteDiagnostic("resident pointer monitor started");
        try
        {
            while (true)
            {
                Point pointer;
                if (!GetCursorPos(out pointer)) { Thread.Sleep(25); continue; }
                var monitor = MonitorFromPoint(pointer, MonitorDefaultToNearest);
                var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
                if (!GetMonitorInfo(monitor, ref info)) { Thread.Sleep(25); continue; }
                if (!firstPointerSampleLogged)
                {
                    WriteDiagnostic(string.Format(CultureInfo.InvariantCulture,
                        "resident pointer first sample x={0} y={1} monitorLeft={2} monitorTop={3}",
                        pointer.X, pointer.Y, info.Monitor.Left, info.Monitor.Top));
                    firstPointerSampleLogged = true;
                }

                var relativeX = pointer.X - info.Monitor.Left;
                var relativeY = pointer.Y - info.Monitor.Top;
                var inCorner = relativeX >= 0 && relativeX <= HotCornerMaximumOffsetPixels &&
                               relativeY >= 0 && relativeY <= HotCornerMaximumOffsetPixels;
                if (!inCorner)
                {
                    if (summonDwell != null && !summonedForCurrentEntry)
                        WriteDiagnostic("hot corner candidate cancelled");
                    summonDwell = null;
                    summonedForCurrentEntry = false;
                }
                else if (!summonedForCurrentEntry)
                {
                    if (summonDwell == null)
                    {
                        summonDwell = Stopwatch.StartNew();
                        WriteDiagnostic(string.Format(CultureInfo.InvariantCulture,
                            "hot corner candidate entered x={0} y={1}", pointer.X, pointer.Y));
                    }
                    if (summonDwell.ElapsedMilliseconds >= DwellMilliseconds)
                    {
                        var connected = SendSummon(monitor, info.Work);
                        WriteDiagnostic(connected
                            ? "hot corner activated; bridge connected"
                            : "hot corner activated; no bridge available");
                        summonedForCurrentEntry = true;
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
                var inRetractZone = open && pointer.X >= retractThreshold &&
                                    pointer.Y >= monitorTop && pointer.Y < monitorBottom;
                if (!inRetractZone)
                {
                    if (retractCandidateActive) WriteDiagnostic("retract zone candidate cancelled");
                    retractDwell = null;
                    retractCandidateActive = false;
                }
                else
                {
                    if (retractDwell == null)
                    {
                        retractDwell = Stopwatch.StartNew();
                        retractCandidateActive = true;
                        WriteDiagnostic("retract zone candidate entered");
                    }
                    if (retractDwell.ElapsedMilliseconds >= RetractDwellMilliseconds)
                    {
                        lock (StateLock) { drawerOpen = false; }
                        var connected = SendToChrome("{\"type\":\"retract\"}");
                        WriteDiagnostic(connected
                            ? "retract activated; bridge connected"
                            : "retract activated; no bridge available");
                        retractDwell = null;
                        retractCandidateActive = false;
                    }
                }
                CheckPendingSummonAcknowledgement();
                Thread.Sleep(16);
            }
        }
        finally
        {
            WriteDiagnostic("resident pointer monitor stopped");
        }
    }

    private static bool SendSummon(IntPtr monitor, Rect work)
    {
        var json = string.Format(CultureInfo.InvariantCulture,
            "{{\"type\":\"summon\",\"monitorId\":\"windows-{0}\",\"workArea\":{{\"left\":{1},\"top\":{2},\"width\":{3},\"height\":{4}}}}}",
            monitor.ToInt64().ToString(CultureInfo.InvariantCulture), work.Left, work.Top,
            work.Right - work.Left, work.Bottom - work.Top);
        lock (SummonLock)
        {
            pendingSummon = json;
            pendingSummonRetries = 0;
            pendingSummonSentAt = DateTime.MinValue;
        }
        return TrySendPendingSummon();
    }

    private static bool TrySendPendingSummon()
    {
        string json;
        lock (SummonLock) { json = pendingSummon; }
        if (json == null || !SendToChrome(json)) return false;
        lock (SummonLock)
        {
            if (pendingSummon == json) pendingSummonSentAt = DateTime.UtcNow;
        }
        return true;
    }

    private static void CheckPendingSummonAcknowledgement()
    {
        var recycle = false;
        lock (SummonLock)
        {
            if (pendingSummon == null || pendingSummonSentAt == DateTime.MinValue ||
                (DateTime.UtcNow - pendingSummonSentAt).TotalMilliseconds < 750) return;
            if (pendingSummonRetries >= 1)
            {
                WriteDiagnostic("summon delivery failed after one reconnect retry");
                pendingSummon = null;
                pendingSummonSentAt = DateTime.MinValue;
                return;
            }
            pendingSummonRetries += 1;
            pendingSummonSentAt = DateTime.MinValue;
            recycle = true;
        }
        if (!recycle) return;
        WriteDiagnostic("summon acknowledgement timed out; recycling bridge");
        lock (PipeLock)
        {
            if (chromePipe != null)
            {
                chromePipe.Dispose();
                chromePipe = null;
            }
        }
    }

    private static bool SendToChrome(string json)
    {
        lock (PipeLock)
        {
            return chromePipe != null && chromePipe.IsConnected && WriteFramedMessage(chromePipe, json);
        }
    }

    private static void HandleChromeMessage(string json)
    {
        if (Regex.IsMatch(json, "\\\"type\\\"\\s*:\\s*\\\"workspaceState\\\""))
        {
            ApplyWorkspaceState(json);
        }
        else if (Regex.IsMatch(json, "\\\"type\\\"\\s*:\\s*\\\"animateWindows\\\""))
        {
            WriteDiagnostic("native animation requested");
            ApplyAnimationRequest(json);
        }
        else if (Regex.IsMatch(json, "\\\"type\\\"\\s*:\\s*\\\"summonAccepted\\\""))
        {
            lock (SummonLock)
            {
                pendingSummon = null;
                pendingSummonRetries = 0;
                pendingSummonSentAt = DateTime.MinValue;
            }
            WriteDiagnostic("Chrome accepted native summon");
        }
    }

    private static void ApplyWorkspaceState(string json)
    {
        if (Regex.IsMatch(json, "\\\"state\\\"\\s*:\\s*\\\"retracted\\\""))
        {
            lock (StateLock) { drawerOpen = false; }
            WriteDiagnostic("workspace state received: retracted");
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
        WriteDiagnostic(string.Format(CultureInfo.InvariantCulture,
            "workspace state received: open contextRight={0} monitorRight={1}",
            parsedContextRight, parsedMonitorRight));
    }

    private static void ApplyAnimationRequest(string json)
    {
        var requestId = 0;
        var durationMs = 0;
        var playhouseFrom = ReadBounds(json, "playhouseFrom");
        var playhouseTo = ReadBounds(json, "playhouseTo");
        var contextFrom = ReadBounds(json, "contextFrom");
        var contextTo = ReadBounds(json, "contextTo");
        var valid = TryReadInteger(json, "requestId", out requestId) &&
                    TryReadInteger(json, "durationMs", out durationMs) && durationMs >= 50 && durationMs <= 1000 &&
                    ValidBounds(playhouseFrom) && ValidBounds(playhouseTo) &&
                    ValidBounds(contextFrom) && ValidBounds(contextTo);
        var easeIn = Regex.IsMatch(json, "\\\"easing\\\"\\s*:\\s*\\\"in\\\"");
        WriteDiagnostic(easeIn ? "retract animation started" : "opening animation started");
        var success = valid && AnimateChromeWindows(playhouseFrom, playhouseTo, contextFrom, contextTo,
            durationMs, easeIn);
        WriteDiagnostic(string.Format(CultureInfo.InvariantCulture, "{0} animation {1}",
            easeIn ? "retract" : "opening", success ? "complete" : "failed"));
        SendToChrome(string.Format(CultureInfo.InvariantCulture,
            "{{\"type\":\"animationComplete\",\"requestId\":{0},\"ok\":{1}}}",
            requestId, success ? "true" : "false"));
    }

    private static WindowBounds ReadBounds(string json, string prefix)
    {
        int left;
        int top;
        int width;
        int height;
        if (!TryReadInteger(json, prefix + "Left", out left) || !TryReadInteger(json, prefix + "Top", out top) ||
            !TryReadInteger(json, prefix + "Width", out width) || !TryReadInteger(json, prefix + "Height", out height)) return null;
        return new WindowBounds { Height = height, Left = left, Top = top, Width = width };
    }

    private static bool ValidBounds(WindowBounds bounds)
    {
        return bounds != null && bounds.Left >= -100000 && bounds.Left <= 100000 &&
               bounds.Top >= -100000 && bounds.Top <= 100000 && bounds.Width >= 200 && bounds.Width <= 10000 &&
               bounds.Height >= 200 && bounds.Height <= 10000;
    }

    private static bool AnimateChromeWindows(WindowBounds playhouseFrom, WindowBounds playhouseTo,
        WindowBounds contextFrom, WindowBounds contextTo, int durationMs, bool easeIn)
    {
        var windows = EnumerateChromeWindows();
        var playhouse = ClosestWindow(windows, playhouseFrom, IntPtr.Zero);
        var context = ClosestWindow(windows, contextFrom, playhouse);
        if (playhouse == IntPtr.Zero || context == IntPtr.Zero || !IsWindow(playhouse) || !IsWindow(context))
        {
            WriteDiagnostic("native animation could not map both Chrome HWNDs");
            return false;
        }
        var frameCount = Math.Max(2, (int)Math.Round(durationMs * AnimationFramesPerSecond / 1000.0));
        var stopwatch = Stopwatch.StartNew();
        for (var frame = 1; frame <= frameCount; frame += 1)
        {
            var progress = frame / (double)frameCount;
            var eased = easeIn ? progress * progress * progress : 1.0 - Math.Pow(1.0 - progress, 3.0);
            if (!MovePair(playhouse, Interpolate(playhouseFrom, playhouseTo, eased),
                context, Interpolate(contextFrom, contextTo, eased))) return false;
            var wait = (frame * durationMs / frameCount) - (int)stopwatch.ElapsedMilliseconds;
            if (wait > 0) Thread.Sleep(wait);
        }
        return true;
    }

    private static WindowBounds Interpolate(WindowBounds from, WindowBounds to, double progress)
    {
        return new WindowBounds
        {
            Height = (int)Math.Round(from.Height + ((to.Height - from.Height) * progress)),
            Left = (int)Math.Round(from.Left + ((to.Left - from.Left) * progress)),
            Top = (int)Math.Round(from.Top + ((to.Top - from.Top) * progress)),
            Width = (int)Math.Round(from.Width + ((to.Width - from.Width) * progress)),
        };
    }

    private static bool MovePair(IntPtr first, WindowBounds firstBounds, IntPtr second, WindowBounds secondBounds)
    {
        var deferred = BeginDeferWindowPos(2);
        if (deferred == IntPtr.Zero) return false;
        const uint flags = SwpNoActivate | SwpNoOwnerZOrder | SwpNoZOrder;
        deferred = DeferWindowPos(deferred, first, IntPtr.Zero, firstBounds.Left, firstBounds.Top,
            firstBounds.Width, firstBounds.Height, flags);
        if (deferred == IntPtr.Zero) return false;
        deferred = DeferWindowPos(deferred, second, IntPtr.Zero, secondBounds.Left, secondBounds.Top,
            secondBounds.Width, secondBounds.Height, flags);
        return deferred != IntPtr.Zero && EndDeferWindowPos(deferred);
    }

    private static List<ChromeWindow> EnumerateChromeWindows()
    {
        var windows = new List<ChromeWindow>();
        EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            if (!IsWindowVisible(window)) return true;
            var className = new StringBuilder(128);
            GetClassName(window, className, className.Capacity);
            if (!className.ToString().StartsWith("Chrome_WidgetWin_", StringComparison.Ordinal)) return true;
            Rect rect;
            if (GetWindowRect(window, out rect)) windows.Add(new ChromeWindow { Handle = window, Rect = rect });
            return true;
        }, IntPtr.Zero);
        return windows;
    }

    private static IntPtr ClosestWindow(List<ChromeWindow> windows, WindowBounds expected, IntPtr excluded)
    {
        long bestScore = long.MaxValue;
        var best = IntPtr.Zero;
        foreach (var candidate in windows)
        {
            if (candidate.Handle == excluded) continue;
            var width = candidate.Rect.Right - candidate.Rect.Left;
            var height = candidate.Rect.Bottom - candidate.Rect.Top;
            var score = Math.Abs((long)candidate.Rect.Left - expected.Left) +
                        Math.Abs((long)candidate.Rect.Top - expected.Top) +
                        Math.Abs((long)width - expected.Width) + Math.Abs((long)height - expected.Height);
            if (score < bestScore) { bestScore = score; best = candidate.Handle; }
        }
        return bestScore <= 400 ? best : IntPtr.Zero;
    }

    private static bool TryReadInteger(string json, string property, out int value)
    {
        value = 0;
        var match = Regex.Match(json, "\\\"" + Regex.Escape(property) + "\\\"\\s*:\\s*(-?\\d+)");
        return match.Success && int.TryParse(match.Groups[1].Value, NumberStyles.Integer,
            CultureInfo.InvariantCulture, out value);
    }

    private static bool SendNative(Stream chromeOutput, string json)
    {
        lock (OutputLock) { return WriteFramedMessage(chromeOutput, json); }
    }

    private static void WriteDiagnostic(string detail)
    {
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Carnival", "DesktopWorkspace");
            Directory.CreateDirectory(directory);
            File.AppendAllText(Path.Combine(directory, "CarnivalWorkspaceHost.log"),
                string.Format(CultureInfo.InvariantCulture,
                    "{0:u} Carnival native host: {1}; {2}; pid {3}{4}", DateTime.UtcNow, HostMarker, detail,
                    Process.GetCurrentProcess().Id, Environment.NewLine));
        }
        catch { }
    }
}
