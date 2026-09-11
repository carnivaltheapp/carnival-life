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
using Microsoft.Win32;

internal static class CarnivalWorkspaceHost
{
    private const string HostMarker = "DRAWER-HOST-6";
    private const int AnimationFramesPerSecond = 60;
    private const int HotCornerMaximumOffsetPixels = 4;
    private const int DwellMilliseconds = 200;
    private const int PendingSummonTimeoutMilliseconds = 15000;
    private const int RetractOffsetPixels = 100;
    private const int RetractDwellMilliseconds = 150;
    private const int ResizeEdgeTolerancePixels = 12;
    private const int MinimumPlayHouseWidth = 400;
    private const int MinimumContextWidth = 320;
    private const int VirtualKeyLeftButton = 0x01;
    private const string PlayHouseUrl = "https://carnival-playhouse.vercel.app/";
    private const int MonitorDefaultToNearest = 2;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpNoMove = 0x0002;
    private const uint SwpNoOwnerZOrder = 0x0200;
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoZOrder = 0x0004;
    private const int SwShow = 5;
    private static readonly object OutputLock = new object();
    private static readonly object PipeLock = new object();
    private static readonly object StateLock = new object();
    private static readonly object SummonLock = new object();
    private static readonly string PipeName = "CarnivalDesktopWorkspace-" + SafePipeSuffix();
    private static NamedPipeServerStream chromePipe;
    private static bool drawerOpen;
    private static PanelGeometryState panelGeometryState = PanelGeometryState.Idle;
    private static int? offsetPointX;
    private static int configuredMonitorRight;
    private static int configuredMonitorTop;
    private static int configuredMonitorBottom;
    private static IntPtr playhouseHandle;
    private static IntPtr contextHandle;
    private static PanelResizeSession panelResizeSession;
    private static string pendingSummon;
    private static DateTime pendingSummonQueuedAt;
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

    private enum PanelGeometryState
    {
        Idle,
        Resizing,
        ProgrammaticUpdate,
    }

    private sealed class PanelResizeSession
    {
        public IntPtr PlayhouseHandle;
        public IntPtr ContextHandle;
        public int PanelLeft;
        public int Top;
        public int Height;
        public int MonitorRight;
        public int StartPlayhouseWidth;
        public int StartContextWidth;
        public int StartTotalWidth;
        public double PlayhouseRatio;
        public double ContextRatio;
        public int MinimumPanelRight;
        public int MaximumPanelRight;
        public WindowBounds PlayhouseBounds;
        public WindowBounds ContextBounds;
    }

    private sealed class CoupledBounds
    {
        public WindowBounds Playhouse;
        public WindowBounds Context;
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attachThread, uint attachToThread, bool attach);

    [DllImport("user32.dll")]
    private static extern IntPtr BeginDeferWindowPos(int windowCount);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);

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
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr processId);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y,
        int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(Point point, int flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    private static void Main(string[] args)
    {
        if (HasArgument(args, "--self-test")) RunSelfTest();
        else if (HasArgument(args, "--resident")) RunResident();
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
        try
        {
            var pipe = ConnectToResident();
            if (pipe == null)
            {
                WriteDiagnostic("bridge exiting reason=resident unavailable");
                return;
            }
            using (pipe)
            using (var chromeInput = Console.OpenStandardInput())
            using (var chromeOutput = Console.OpenStandardOutput())
            {
                if (!SendNative(chromeOutput, "{\"type\":\"hostReady\",\"version\":\"" + HostMarker + "\",\"nativeWindowAnimation\":true}"))
                {
                    WriteDiagnostic("bridge exiting reason=hostReady stdout write failure");
                    return;
                }
                new Thread(delegate()
                {
                    var reason = ForwardPipeToChrome(pipe, chromeOutput);
                    WriteDiagnostic("bridge exiting reason=" + reason);
                    Environment.Exit(0);
                }) { IsBackground = true }.Start();
                WriteDiagnostic("bridge exiting reason=" + ForwardChromeToPipe(chromeInput, pipe));
            }
        }
        catch (Exception error)
        {
            WriteDiagnostic("bridge exiting reason=exception type=" + error.GetType().Name +
                " message=" + error.Message);
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
                    WriteDiagnostic("Carnival bridge connected");
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

    private static string ForwardChromeToPipe(Stream chromeInput, Stream pipe)
    {
        string message;
        string failure;
        while ((message = ReadFramedMessage(chromeInput, out failure)) != null)
        {
            if (!WriteFramedMessage(pipe, message)) return "resident pipe write failure";
        }
        return "Chrome stdin " + failure;
    }

    private static string ForwardPipeToChrome(Stream pipe, Stream chromeOutput)
    {
        string message;
        string failure;
        while ((message = ReadFramedMessage(pipe, out failure)) != null)
        {
            var summon = Regex.IsMatch(message, "\\\"type\\\"\\s*:\\s*\\\"summon\\\"");
            var retract = Regex.IsMatch(message, "\\\"type\\\"\\s*:\\s*\\\"retract\\\"");
            if (summon) WriteDiagnostic("bridge forwarding summon to Chrome");
            if (retract) WriteDiagnostic("bridge forwarding retract to Chrome");
            var written = SendNative(chromeOutput, message);
            if (summon) WriteDiagnostic(written ? "bridge summon frame written" : "bridge summon frame write failed");
            if (retract) WriteDiagnostic(written ? "bridge retract frame written" : "bridge retract frame write failed");
            if (!written) return "Chrome stdout write failure";
        }
        return "resident pipe " + failure;
    }

    private static string ReadFramedMessage(Stream stream)
    {
        string failure;
        return ReadFramedMessage(stream, out failure);
    }

    private static string ReadFramedMessage(Stream stream, out string failure)
    {
        failure = "EOF";
        try
        {
            var lengthBytes = new byte[4];
            if (!ReadExactly(stream, lengthBytes, 4)) return null;
            var length = BitConverter.ToInt32(lengthBytes, 0);
            if (length < 0 || length > 16384)
            {
                failure = "invalid frame length";
                return null;
            }
            var payload = new byte[length];
            if (!ReadExactly(stream, payload, length)) return null;
            failure = null;
            return Encoding.UTF8.GetString(payload);
        }
        catch (IOException error)
        {
            failure = "IOException: " + error.Message;
            return null;
        }
        catch (ObjectDisposedException error)
        {
            failure = "ObjectDisposedException: " + error.Message;
            return null;
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
        catch (ObjectDisposedException) { return false; }
    }

    private static void MonitorGlobalPointer()
    {
        Stopwatch summonDwell = null;
        Stopwatch retractDwell = null;
        var summonedForCurrentEntry = false;
        var retractCandidateActive = false;
        var firstPointerSampleLogged = false;
        var leftButtonWasDown = false;
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

                var leftButtonDown = (GetAsyncKeyState(VirtualKeyLeftButton) & 0x8000) != 0;
                AdvancePanelResize(pointer, leftButtonDown,
                    leftButtonDown && !leftButtonWasDown);
                leftButtonWasDown = leftButtonDown;

                bool open;
                int? currentOffsetPoint;
                PanelGeometryState geometryState;
                int monitorRight;
                int monitorTop;
                int monitorBottom;
                lock (StateLock)
                {
                    open = drawerOpen;
                    currentOffsetPoint = offsetPointX;
                    geometryState = panelGeometryState;
                    monitorRight = configuredMonitorRight;
                    monitorTop = configuredMonitorTop;
                    monitorBottom = configuredMonitorBottom;
                }
                var inRetractZone = ShouldEnterRetract(open, geometryState, currentOffsetPoint,
                    pointer.X, pointer.Y, monitorRight, monitorTop, monitorBottom);
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
            if (pendingSummon != null)
            {
                WriteDiagnostic("pending summon already stored; duplicate ignored");
                return false;
            }
            pendingSummon = json;
            pendingSummonQueuedAt = DateTime.UtcNow;
            pendingSummonRetries = 0;
            pendingSummonSentAt = DateTime.MinValue;
        }
        WriteDiagnostic("pending summon stored");
        var sent = TrySendPendingSummon();
        if (!sent) RequestChromeWake();
        return sent;
    }

    private static bool TrySendPendingSummon()
    {
        string json;
        lock (SummonLock) { json = pendingSummon; }
        if (json == null || !SendToChrome(json)) return false;
        WriteDiagnostic("executing pending summon");
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
            if (pendingSummon == null) return;
            if (pendingSummonSentAt == DateTime.MinValue)
            {
                if ((DateTime.UtcNow - pendingSummonQueuedAt).TotalMilliseconds <
                    PendingSummonTimeoutMilliseconds) return;
                WriteDiagnostic("pending summon timed out waiting for Carnival bridge");
                ClearPendingSummon();
                return;
            }
            if ((DateTime.UtcNow - pendingSummonSentAt).TotalMilliseconds < 750) return;
            if (pendingSummonRetries >= 1)
            {
                WriteDiagnostic("summon delivery failed after one reconnect retry");
                ClearPendingSummon();
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

    private static void ClearPendingSummon()
    {
        pendingSummon = null;
        pendingSummonQueuedAt = DateTime.MinValue;
        pendingSummonSentAt = DateTime.MinValue;
        pendingSummonRetries = 0;
    }

    private static void RequestChromeWake()
    {
        var chromeRunning = IsChromeRunning();
        WriteDiagnostic(chromeRunning
            ? "Chrome already running; bridge unavailable"
            : "Chrome not running; launching Chrome");
        var executable = FindChromeExecutable();
        if (executable == null)
        {
            WriteDiagnostic("Chrome launch failed: executable not found");
            return;
        }
        try
        {
            Process.Start(new ProcessStartInfo
            {
                Arguments = "--new-window \"" + PlayHouseUrl + "\"",
                FileName = executable,
                UseShellExecute = true,
            });
            WriteDiagnostic("Chrome launch requested; waiting for Carnival bridge");
        }
        catch (Exception error)
        {
            WriteDiagnostic("Chrome launch failed: " + error.GetType().Name);
        }
    }

    private static bool IsChromeRunning()
    {
        try { return Process.GetProcessesByName("chrome").Length > 0; }
        catch { return false; }
    }

    private static string FindChromeExecutable()
    {
        var registryPaths = new[]
        {
            @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
            @"HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
            @"HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
        };
        foreach (var registryPath in registryPaths)
        {
            try
            {
                var candidate = Registry.GetValue(registryPath, "", null) as string;
                if (!string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate)) return candidate;
            }
            catch { }
        }
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Google", "Chrome", "Application", "chrome.exe"),
        };
        foreach (var candidate in candidates)
            if (File.Exists(candidate)) return candidate;
        return null;
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
        else if (Regex.IsMatch(json, "\\\"type\\\"\\s*:\\s*\\\"activateWindows\\\""))
        {
            ApplyActivationRequest(json);
        }
        else if (Regex.IsMatch(json, "\\\"type\\\"\\s*:\\s*\\\"setWorkspaceBounds\\\""))
        {
            ApplyWorkspaceBoundsRequest(json);
        }
        else if (Regex.IsMatch(json, "\\\"type\\\"\\s*:\\s*\\\"summonAccepted\\\""))
        {
            lock (SummonLock)
            {
                ClearPendingSummon();
            }
            WriteDiagnostic("pending summon complete; Chrome accepted native summon");
        }
    }

    private static void ApplyWorkspaceState(string json)
    {
        if (Regex.IsMatch(json, "\\\"state\\\"\\s*:\\s*\\\"retracted\\\""))
        {
            lock (StateLock)
            {
                drawerOpen = false;
                panelResizeSession = null;
                panelGeometryState = PanelGeometryState.Idle;
                offsetPointX = null;
            }
            WriteDiagnostic("workspace state received: retracted");
            return;
        }
        if (!Regex.IsMatch(json, "\\\"state\\\"\\s*:\\s*\\\"open\\\"")) return;
        int parsedContextRight;
        int parsedMonitorRight;
        int parsedMonitorTop;
        int parsedMonitorBottom;
        var parsedPlayhouse = ReadBounds(json, "playhouse");
        var parsedContext = ReadBounds(json, "context");
        if (!TryReadInteger(json, "contextRight", out parsedContextRight) ||
            !TryReadInteger(json, "monitorRight", out parsedMonitorRight) ||
            !TryReadInteger(json, "monitorTop", out parsedMonitorTop) ||
            !TryReadInteger(json, "monitorBottom", out parsedMonitorBottom) ||
            parsedMonitorBottom <= parsedMonitorTop || !ValidBounds(parsedPlayhouse) ||
            !ValidBounds(parsedContext)) return;
        var windows = EnumerateChromeWindows();
        var mappedPlayhouse = ClosestWindow(windows, new[] { parsedPlayhouse }, IntPtr.Zero);
        var mappedContext = ClosestWindow(windows, new[] { parsedContext }, mappedPlayhouse);
        lock (StateLock)
        {
            if (panelGeometryState != PanelGeometryState.Idle) return;
            configuredMonitorRight = parsedMonitorRight;
            configuredMonitorTop = parsedMonitorTop;
            configuredMonitorBottom = parsedMonitorBottom;
            playhouseHandle = mappedPlayhouse;
            contextHandle = mappedContext;
            drawerOpen = true;
            offsetPointX = parsedContextRight + RetractOffsetPixels;
        }
        var retractThreshold = EffectiveRetractThreshold(parsedContextRight, parsedMonitorRight);
        WriteDiagnostic(string.Format(CultureInfo.InvariantCulture,
            "retract threshold contextRight={0} offset={1} threshold={2}",
            parsedContextRight, RetractOffsetPixels, retractThreshold));
        if (parsedContextRight + RetractOffsetPixels > parsedMonitorRight - 1)
            WriteDiagnostic("retract threshold clamped to reachable monitor edge");
    }

    private static void AdvancePanelResize(Point pointer, bool leftButtonDown, bool justPressed)
    {
        if (justPressed) TryStartPanelResize(pointer);
        PanelResizeSession session;
        PanelGeometryState state;
        lock (StateLock)
        {
            session = panelResizeSession;
            state = panelGeometryState;
        }
        if (session == null || (state != PanelGeometryState.Resizing &&
            state != PanelGeometryState.ProgrammaticUpdate)) return;
        if (!leftButtonDown)
        {
            ApplyPanelResize(session, pointer.X);
            FinishPanelResize(session);
            return;
        }
        ApplyPanelResize(session, pointer.X);
    }

    private static void TryStartPanelResize(Point pointer)
    {
        bool open;
        IntPtr playhouse;
        IntPtr context;
        int monitorRight;
        PanelGeometryState state;
        lock (StateLock)
        {
            open = drawerOpen;
            playhouse = playhouseHandle;
            context = contextHandle;
            monitorRight = configuredMonitorRight;
            state = panelGeometryState;
        }
        Rect playhouseRect;
        Rect contextRect;
        if (!open || state != PanelGeometryState.Idle || playhouse == IntPtr.Zero || context == IntPtr.Zero ||
            !IsWindow(playhouse) || !IsWindow(context) ||
            !GetWindowRect(playhouse, out playhouseRect) || !GetWindowRect(context, out contextRect) ||
            Math.Abs(pointer.X - contextRect.Right) > ResizeEdgeTolerancePixels ||
            pointer.Y < contextRect.Top || pointer.Y >= contextRect.Bottom ||
            !ConnectedRects(playhouseRect, contextRect)) return;
        var session = CreatePanelResizeSession(playhouse, context, playhouseRect, contextRect, monitorRight);
        if (session == null) return;
        lock (StateLock)
        {
            if (panelGeometryState != PanelGeometryState.Idle) return;
            panelResizeSession = session;
            panelGeometryState = PanelGeometryState.Resizing;
            offsetPointX = null;
        }
        SendToChrome("{\"type\":\"liveResizeStarted\"}");
        WriteDiagnostic(string.Format(CultureInfo.InvariantCulture,
            "panel resize started total={0} phRatio={1:F4} auxRatio={2:F4} minRight={3} maxRight={4}",
            session.StartTotalWidth, session.PlayhouseRatio, session.ContextRatio,
            session.MinimumPanelRight, session.MaximumPanelRight));
    }

    private static PanelResizeSession CreatePanelResizeSession(IntPtr playhouse, IntPtr context,
        Rect playhouseRect, Rect contextRect, int monitorRight)
    {
        var playhouseWidth = playhouseRect.Right - playhouseRect.Left;
        var contextWidth = contextRect.Right - contextRect.Left;
        var total = playhouseWidth + contextWidth;
        if (total <= 0 || playhouseWidth <= 0 || contextWidth <= 0) return null;
        var playhouseRatio = playhouseWidth / (double)total;
        var contextRatio = contextWidth / (double)total;
        var maximumPanelRight = monitorRight - RetractOffsetPixels;
        var minimumTotal = Math.Max(
            (int)Math.Ceiling(MinimumPlayHouseWidth / playhouseRatio),
            (int)Math.Ceiling(MinimumContextWidth / contextRatio));
        var minimumPanelRight = Math.Min(maximumPanelRight, playhouseRect.Left + minimumTotal);
        return new PanelResizeSession
        {
            ContextHandle = context,
            ContextRatio = contextRatio,
            Height = playhouseRect.Bottom - playhouseRect.Top,
            MaximumPanelRight = maximumPanelRight,
            MinimumPanelRight = minimumPanelRight,
            MonitorRight = monitorRight,
            PanelLeft = playhouseRect.Left,
            PlayhouseHandle = playhouse,
            PlayhouseRatio = playhouseRatio,
            StartContextWidth = contextWidth,
            StartPlayhouseWidth = playhouseWidth,
            StartTotalWidth = total,
            Top = playhouseRect.Top,
        };
    }

    private static void ApplyPanelResize(PanelResizeSession session, int draggedRight)
    {
        lock (StateLock)
        {
            if (!ReferenceEquals(panelResizeSession, session) ||
                panelGeometryState != PanelGeometryState.Resizing) return;
            panelGeometryState = PanelGeometryState.ProgrammaticUpdate;
        }
        var bounds = CalculatePanelBounds(session, draggedRight);
        var success = MovePair(session.PlayhouseHandle, bounds.Playhouse,
            session.ContextHandle, bounds.Context);
        lock (StateLock)
        {
            if (!ReferenceEquals(panelResizeSession, session)) return;
            if (success)
            {
                session.PlayhouseBounds = bounds.Playhouse;
                session.ContextBounds = bounds.Context;
            }
            panelGeometryState = PanelGeometryState.Resizing;
        }
    }

    private static CoupledBounds CalculatePanelBounds(PanelResizeSession session, int draggedRight)
    {
        var panelRight = Math.Max(session.MinimumPanelRight,
            Math.Min(draggedRight, session.MaximumPanelRight));
        var total = panelRight - session.PanelLeft;
        var playhouseWidth = (int)Math.Round(total * session.PlayhouseRatio,
            MidpointRounding.AwayFromZero);
        return new CoupledBounds
        {
            Playhouse = new WindowBounds
            {
                Height = session.Height,
                Left = session.PanelLeft,
                Top = session.Top,
                Width = playhouseWidth,
            },
            Context = new WindowBounds
            {
                Height = session.Height,
                Left = session.PanelLeft + playhouseWidth,
                Top = session.Top,
                Width = total - playhouseWidth,
            },
        };
    }

    private static int EffectiveRetractThreshold(int rightEdge, int monitorRight)
    {
        return Math.Min(rightEdge + RetractOffsetPixels, monitorRight - 1);
    }

    private static bool ShouldEnterRetract(bool open, PanelGeometryState state, int? currentOffsetPoint,
        int pointerX, int pointerY, int monitorRight, int monitorTop, int monitorBottom)
    {
        if (!currentOffsetPoint.HasValue) return false;
        var threshold = Math.Min(currentOffsetPoint.Value, monitorRight - 1);
        return open && state == PanelGeometryState.Idle && pointerX >= threshold &&
               pointerY >= monitorTop && pointerY < monitorBottom;
    }

    private static void FinishPanelResize(PanelResizeSession session)
    {
        var playhouseRect = new Rect();
        var contextRect = new Rect();
        var actualValid = GetWindowRect(session.PlayhouseHandle, out playhouseRect) &&
            GetWindowRect(session.ContextHandle, out contextRect) &&
            ConnectedRects(playhouseRect, contextRect);
        if (!actualValid && session.PlayhouseBounds != null && session.ContextBounds != null)
        {
            lock (StateLock) { panelGeometryState = PanelGeometryState.ProgrammaticUpdate; }
            MovePair(session.PlayhouseHandle, session.PlayhouseBounds,
                session.ContextHandle, session.ContextBounds);
            actualValid = GetWindowRect(session.PlayhouseHandle, out playhouseRect) &&
                GetWindowRect(session.ContextHandle, out contextRect) &&
                ConnectedRects(playhouseRect, contextRect);
        }
        var playhouseBounds = actualValid ? BoundsFromRect(playhouseRect) : null;
        var contextBounds = actualValid ? BoundsFromRect(contextRect) : null;
        lock (StateLock)
        {
            if (!ReferenceEquals(panelResizeSession, session)) return;
            panelResizeSession = null;
            panelGeometryState = PanelGeometryState.Idle;
            offsetPointX = actualValid
                ? contextBounds.Left + contextBounds.Width + RetractOffsetPixels
                : (int?)null;
        }
        if (!actualValid)
        {
            SendToChrome("{\"type\":\"liveResizeComplete\"}");
            WriteDiagnostic("panel resize ended without valid connected bounds");
            return;
        }
        SendToChrome(string.Format(CultureInfo.InvariantCulture,
            "{{\"type\":\"liveResizeComplete\",\"playhouse\":{{\"left\":{0},\"top\":{1},\"width\":{2},\"height\":{3}}}," +
            "\"context\":{{\"left\":{4},\"top\":{5},\"width\":{6},\"height\":{7}}}}}",
            playhouseBounds.Left, playhouseBounds.Top, playhouseBounds.Width,
            playhouseBounds.Height, contextBounds.Left, contextBounds.Top,
            contextBounds.Width, contextBounds.Height));
        WriteDiagnostic(string.Format(CultureInfo.InvariantCulture,
            "panel resize complete phWidth={0} auxWidth={1} offsetPoint={2}",
            playhouseBounds.Width, contextBounds.Width,
            contextBounds.Left + contextBounds.Width + RetractOffsetPixels));
    }

    private static bool ConnectedRects(Rect playhouse, Rect context)
    {
        return playhouse.Right == context.Left && playhouse.Top == context.Top &&
            playhouse.Bottom == context.Bottom;
    }

    private static WindowBounds BoundsFromRect(Rect rect)
    {
        return new WindowBounds
        {
            Height = rect.Bottom - rect.Top,
            Left = rect.Left,
            Top = rect.Top,
            Width = rect.Right - rect.Left,
        };
    }

    private static void ApplyAnimationRequest(string json)
    {
        var requestId = 0;
        var durationMs = 0;
        var playhouseCurrent = ReadBounds(json, "playhouseCurrent");
        var playhouseFrom = ReadBounds(json, "playhouseFrom");
        var playhouseTo = ReadBounds(json, "playhouseTo");
        var contextCurrent = ReadBounds(json, "contextCurrent");
        var contextFrom = ReadBounds(json, "contextFrom");
        var contextTo = ReadBounds(json, "contextTo");
        var valid = TryReadInteger(json, "requestId", out requestId) &&
                    TryReadInteger(json, "durationMs", out durationMs) && durationMs >= 50 && durationMs <= 1000 &&
                    ValidBounds(playhouseCurrent) && ValidBounds(contextCurrent) &&
                    ValidBounds(playhouseFrom) && ValidBounds(playhouseTo) &&
                    ValidBounds(contextFrom) && ValidBounds(contextTo);
        var easeIn = Regex.IsMatch(json, "\\\"easing\\\"\\s*:\\s*\\\"in\\\"");
        WriteDiagnostic(easeIn ? "retract animation started" : "opening animation started");
        bool geometryAvailable;
        lock (StateLock)
        {
            geometryAvailable = panelGeometryState == PanelGeometryState.Idle;
            if (geometryAvailable) panelGeometryState = PanelGeometryState.ProgrammaticUpdate;
        }
        var success = valid && geometryAvailable && AnimateChromeWindows(playhouseCurrent, playhouseFrom, playhouseTo,
            contextCurrent, contextFrom, contextTo, durationMs, easeIn);
        lock (StateLock)
        {
            if (geometryAvailable) panelGeometryState = PanelGeometryState.Idle;
        }
        WriteDiagnostic(string.Format(CultureInfo.InvariantCulture, "{0} animation {1}",
            easeIn ? "retract" : "opening", success ? "complete" : "failed"));
        SendToChrome(string.Format(CultureInfo.InvariantCulture,
            "{{\"type\":\"animationComplete\",\"requestId\":{0},\"ok\":{1}}}",
            requestId, success ? "true" : "false"));
    }

    private static void ApplyActivationRequest(string json)
    {
        var playhouseBounds = ReadBounds(json, "playhouse");
        var contextBounds = ReadBounds(json, "context");
        var success = ValidBounds(playhouseBounds) && ValidBounds(contextBounds) &&
            ActivateMappedChromeWindows(playhouseBounds, contextBounds);
        WriteDiagnostic("foreground activation " + (success ? "complete" : "failed"));
    }

    private static void ApplyWorkspaceBoundsRequest(string json)
    {
        var requestId = 0;
        var playhouseCurrent = ReadBounds(json, "playhouseCurrent");
        var playhouseTarget = ReadBounds(json, "playhouseTarget");
        var contextCurrent = ReadBounds(json, "contextCurrent");
        var contextTarget = ReadBounds(json, "contextTarget");
        var valid = TryReadInteger(json, "requestId", out requestId) &&
                    ValidBounds(playhouseCurrent) && ValidBounds(playhouseTarget) &&
                    ValidBounds(contextCurrent) && ValidBounds(contextTarget);
        bool geometryAvailable;
        lock (StateLock)
        {
            geometryAvailable = panelGeometryState == PanelGeometryState.Idle;
            if (geometryAvailable) panelGeometryState = PanelGeometryState.ProgrammaticUpdate;
        }
        valid = valid && geometryAvailable;
        var windows = valid ? EnumerateChromeWindows() : new List<ChromeWindow>();
        var playhouse = valid
            ? ClosestWindow(windows, new[] { playhouseCurrent, playhouseTarget }, IntPtr.Zero)
            : IntPtr.Zero;
        var context = valid
            ? ClosestWindow(windows, new[] { contextCurrent, contextTarget }, playhouse)
            : IntPtr.Zero;
        var success = playhouse != IntPtr.Zero && context != IntPtr.Zero &&
            MovePair(playhouse, playhouseTarget, context, contextTarget);
        lock (StateLock)
        {
            if (geometryAvailable) panelGeometryState = PanelGeometryState.Idle;
        }
        WriteDiagnostic("coupled workspace bounds " + (success ? "applied" : "failed"));
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

    private static bool AnimateChromeWindows(WindowBounds playhouseCurrent, WindowBounds playhouseFrom,
        WindowBounds playhouseTo, WindowBounds contextCurrent, WindowBounds contextFrom,
        WindowBounds contextTo, int durationMs, bool easeIn)
    {
        var windows = EnumerateChromeWindows();
        var playhouse = ClosestWindow(windows, new[] { playhouseCurrent, playhouseFrom, playhouseTo }, IntPtr.Zero);
        var context = ClosestWindow(windows, new[] { contextCurrent, contextFrom, contextTo }, playhouse);
        if (playhouse == IntPtr.Zero || context == IntPtr.Zero || !IsWindow(playhouse) || !IsWindow(context))
        {
            WriteDiagnostic("native animation could not map both Chrome HWNDs");
            return false;
        }
        if (!MovePair(playhouse, playhouseFrom, context, contextFrom)) return false;
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
        if (!easeIn && !ActivateWorkspace(playhouse, context))
            WriteDiagnostic("opening complete but foreground activation failed");
        return true;
    }

    private static bool ActivateMappedChromeWindows(WindowBounds playhouseBounds, WindowBounds contextBounds)
    {
        var windows = EnumerateChromeWindows();
        var playhouse = ClosestWindow(windows, new[] { playhouseBounds }, IntPtr.Zero);
        var context = ClosestWindow(windows, new[] { contextBounds }, playhouse);
        return playhouse != IntPtr.Zero && context != IntPtr.Zero && ActivateWorkspace(playhouse, context);
    }

    private static bool ActivateWorkspace(IntPtr playhouse, IntPtr context)
    {
        if (!IsWindow(playhouse) || !IsWindow(context)) return false;
        ShowWindowAsync(context, SwShow);
        ShowWindowAsync(playhouse, SwShow);
        var foreground = GetForegroundWindow();
        var foregroundThread = foreground == IntPtr.Zero
            ? 0
            : GetWindowThreadProcessId(foreground, IntPtr.Zero);
        var currentThread = GetCurrentThreadId();
        var attached = foregroundThread != 0 && foregroundThread != currentThread &&
            AttachThreadInput(currentThread, foregroundThread, true);
        try
        {
            BringWindowToTop(context);
            BringWindowToTop(playhouse);
            var adjacent = SetWindowPos(context, playhouse, 0, 0, 0, 0,
                SwpNoActivate | SwpNoMove | SwpNoOwnerZOrder | SwpNoSize);
            var activated = SetForegroundWindow(playhouse);
            return adjacent && (activated || GetForegroundWindow() == playhouse);
        }
        finally
        {
            if (attached) AttachThreadInput(currentThread, foregroundThread, false);
        }
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

    private static IntPtr ClosestWindow(List<ChromeWindow> windows, WindowBounds[] expectedBounds, IntPtr excluded)
    {
        long bestScore = long.MaxValue;
        var best = IntPtr.Zero;
        foreach (var candidate in windows)
        {
            if (candidate.Handle == excluded) continue;
            var width = candidate.Rect.Right - candidate.Rect.Left;
            var height = candidate.Rect.Bottom - candidate.Rect.Top;
            long score = long.MaxValue;
            foreach (var expected in expectedBounds)
            {
                score = Math.Min(score, Math.Abs((long)candidate.Rect.Left - expected.Left) +
                    Math.Abs((long)candidate.Rect.Top - expected.Top) +
                    Math.Abs((long)width - expected.Width) + Math.Abs((long)height - expected.Height));
            }
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

    private static void RunSelfTest()
    {
        var session = CreatePanelResizeSession(new IntPtr(1), new IntPtr(2),
            new Rect { Left = 0, Top = 0, Right = 900, Bottom = 900 },
            new Rect { Left = 900, Top = 0, Right = 1500, Bottom = 900 }, 2000);
        AssertSelfTest(session != null, "valid connected panel must start a resize session");
        AssertSelfTest(session.PanelLeft == 0 && session.StartPlayhouseWidth == 900 &&
            session.StartContextWidth == 600 && session.StartTotalWidth == 1500,
            "resize start must capture one complete geometry snapshot");
        AssertSelfTest(Math.Abs(session.PlayhouseRatio - 0.6) < 0.0001 &&
            Math.Abs(session.ContextRatio - 0.4) < 0.0001,
            "resize start must freeze both panel ratios");
        AssertSelfTest(session.MaximumPanelRight == 1900,
            "resize maximum must reserve the 100px retract offset");
        var expected = new[]
        {
            new[] { 1450, 870, 580 },
            new[] { 1400, 840, 560 },
            new[] { 1350, 810, 540 },
        };
        foreach (var frame in expected)
        {
            var bounds = CalculatePanelBounds(session, frame[0]);
            AssertSelfTest(bounds.Playhouse.Width == frame[1] && bounds.Context.Width == frame[2],
                "frozen ratio must hold through every live frame");
            AssertSelfTest(bounds.Playhouse.Left + bounds.Playhouse.Width == bounds.Context.Left,
                "live frame must not contain a PH/Aux gap");
            AssertSelfTest(bounds.Context.Left + bounds.Context.Width == frame[0],
                "Aux outer edge must track the dragged edge");
        }
        var capped = CalculatePanelBounds(session, 5000);
        AssertSelfTest(capped.Context.Left + capped.Context.Width == 1900,
            "drawer must stop 100px before monitor right");
        var minimum = CalculatePanelBounds(session, -5000);
        AssertSelfTest(minimum.Playhouse.Width >= MinimumPlayHouseWidth &&
            minimum.Context.Width >= MinimumContextWidth,
            "minimum clamp must keep both windows usable");
        AssertSelfTest(EffectiveRetractThreshold(1500, 2000) == 1600,
            "initial retract threshold must use current Aux edge");
        AssertSelfTest(EffectiveRetractThreshold(1650, 2000) == 1750,
            "expanded retract threshold must use live Aux edge");
        AssertSelfTest(!ShouldEnterRetract(true, PanelGeometryState.Idle, 1750,
            1600, 100, 2000, 0, 900),
            "stale retract threshold must be ignored after expansion");
        AssertSelfTest(!ShouldEnterRetract(true, PanelGeometryState.Resizing, null,
            1800, 100, 2000, 0, 900),
            "retract must be suppressed during live resize");
        AssertSelfTest(!ShouldEnterRetract(true, PanelGeometryState.ProgrammaticUpdate, 1750,
            1800, 100, 2000, 0, 900),
            "retract must be suppressed during owned bounds updates");
        AssertSelfTest(ShouldEnterRetract(true, PanelGeometryState.Idle, 1750,
            1800, 100, 2000, 0, 900),
            "retract must resume after live resize");
        Console.WriteLine("Carnival Windows live resize self-test passed.");
    }

    private static void AssertSelfTest(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
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
