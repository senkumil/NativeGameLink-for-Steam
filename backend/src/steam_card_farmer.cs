using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace SteamCardFarmer
{
    public class Program
    {
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
        static extern bool SetDllDirectoryA(string lpPathName);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
        static extern IntPtr LoadLibraryA(string lpLibFileName);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool FreeLibrary(IntPtr hModule);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
        static extern IntPtr GetProcAddress(IntPtr hModule, string lpProcName);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate IntPtr CreateInterfaceFn(string version, ref int returnCode);

        [StructLayout(LayoutKind.Sequential, Pack = 8)]
        struct CallbackMsg
        {
            public int m_hSteamUser;
            public int m_iCallback;
            public IntPtr m_pubParam;
            public int m_cubParam;
        }

        [DllImport("steamclient64.dll", EntryPoint = "Steam_BGetCallback", CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)]
        static extern bool Steam_BGetCallback64(int hPipe, ref CallbackMsg pCallbackMsg);

        [DllImport("steamclient64.dll", EntryPoint = "Steam_FreeLastCallback", CallingConvention = CallingConvention.Cdecl)]
        static extern void Steam_FreeLastCallback64(int hPipe);

        [DllImport("steamclient.dll", EntryPoint = "Steam_BGetCallback", CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)]
        static extern bool Steam_BGetCallback32(int hPipe, ref CallbackMsg pCallbackMsg);

        [DllImport("steamclient.dll", EntryPoint = "Steam_FreeLastCallback", CallingConvention = CallingConvention.Cdecl)]
        static extern void Steam_FreeLastCallback32(int hPipe);

        static bool Steam_BGetCallback(int hPipe, ref CallbackMsg pCallbackMsg)
        {
            return IntPtr.Size == 8 ? Steam_BGetCallback64(hPipe, ref pCallbackMsg) : Steam_BGetCallback32(hPipe, ref pCallbackMsg);
        }

        static void Steam_FreeLastCallback(int hPipe)
        {
            if (IntPtr.Size == 8) Steam_FreeLastCallback64(hPipe);
            else Steam_FreeLastCallback32(hPipe);
        }

        static T GetDelegate<T>(IntPtr iface, int slot) where T : class
        {
            if (iface == IntPtr.Zero) return null;
            IntPtr vtable = Marshal.ReadIntPtr(iface);
            IntPtr methodPtr = Marshal.ReadIntPtr(vtable, slot * IntPtr.Size);
            return Marshal.GetDelegateForFunctionPointer(methodPtr, typeof(T)) as T;
        }

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate int CreateSteamPipeFn(IntPtr thisPtr);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate bool ReleaseSteamPipeFn(IntPtr thisPtr, int hPipe);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate int ConnectToGlobalUserFn(IntPtr thisPtr, int hPipe);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate void ReleaseUserFn(IntPtr thisPtr, int hPipe, int hUser);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate IntPtr GetISteamUserStatsFn(IntPtr thisPtr, int hUser, int hPipe, [MarshalAs(UnmanagedType.LPStr)] string version);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        delegate bool RequestCurrentStatsFn(IntPtr thisPtr);

        const string DefaultEventName = "NativeGameLink_Steam_CardFarmer_StopEvent";

        static bool ShouldStop(string controlFile)
        {
            if (String.IsNullOrEmpty(controlFile)) return false;
            try { return !File.Exists(controlFile) || File.ReadAllText(controlFile) != "run"; }
            catch { return true; }
        }

        static void ReleaseSteamSession(IntPtr steamClient, ref int pipe, ref int user,
            ReleaseUserFn releaseUser, ReleaseSteamPipeFn releaseSteamPipe)
        {
            int ownedPipe = pipe;
            int ownedUser = user;
            pipe = 0;
            user = 0;
            try
            {
                if (ownedUser != 0 && ownedPipe != 0 && releaseUser != null)
                    releaseUser(steamClient, ownedPipe, ownedUser);
            }
            finally
            {
                if (ownedPipe != 0 && releaseSteamPipe != null)
                    releaseSteamPipe(steamClient, ownedPipe);
            }
        }

        public static void Main(string[] args)
        {
            if (args.Length == 0) return;

            string command = args[0].ToLowerInvariant();
            string eventName = args.Length >= 3 ? args[2] : DefaultEventName;
            string controlFile = args.Length >= 4 ? args[3] : null;

            if (command == "stop")
            {
                // Persist stop before looking for the event: the run process
                // may not have reached event/mutex creation yet.
                if (!String.IsNullOrEmpty(controlFile))
                {
                    try { File.WriteAllText(controlFile, "stop"); }
                    catch { Environment.ExitCode = 1; return; }
                }
                try
                {
                    using (var stopEvent = EventWaitHandle.OpenExisting(eventName))
                    {
                        stopEvent.Set();
                    }
                    // Wait for the old owner to finish before a replacement run
                    // can observe its still-signaled manual-reset event.
                    using (var owner = Mutex.OpenExisting(eventName + "_Owner"))
                    {
                        bool acquired = false;
                        try { acquired = owner.WaitOne(4000); }
                        catch (AbandonedMutexException) { acquired = true; }
                        if (acquired) owner.ReleaseMutex();
                        else Environment.ExitCode = 1;
                    }
                }
                catch {}
                return;
            }

            if (command != "run" && command != "idle") return;

            ulong appId = 0;
            if (args.Length < 2 || !ulong.TryParse(args[1], out appId) || appId == 0) return;
            if (ShouldStop(controlFile)) return;

            EventWaitHandle exitHandle = null;
            Mutex sessionOwner = null;
            bool ownsSession = false;
            IntPtr hModule = IntPtr.Zero;
            IntPtr steamClient = IntPtr.Zero;
            int pipe = 0;
            int user = 0;
            ReleaseSteamPipeFn releaseSteamPipe = null;
            ReleaseUserFn releaseUser = null;
            try
            {
                sessionOwner = new Mutex(false, eventName + "_Owner");
                try { ownsSession = sessionOwner.WaitOne(0); }
                catch (AbandonedMutexException) { ownsSession = true; }
                if (!ownsSession) return;
                if (ShouldStop(controlFile)) return;
                exitHandle = new EventWaitHandle(false, EventResetMode.ManualReset, eventName);
                exitHandle.Reset();

                Environment.SetEnvironmentVariable("SteamAppId", appId.ToString());
                Environment.SetEnvironmentVariable("SteamGameId", appId.ToString());

                string steamPath = Environment.GetEnvironmentVariable("SteamPath");
                if (string.IsNullOrEmpty(steamPath) || !Directory.Exists(steamPath))
                {
                    steamPath = @"C:\Program Files (x86)\Steam";
                }
                SetDllDirectoryA(steamPath);
                string dllName = IntPtr.Size == 8 ? "steamclient64.dll" : "steamclient.dll";
                string dllPath = Path.Combine(steamPath, dllName);

                hModule = LoadLibraryA(dllPath);
                if (hModule == IntPtr.Zero) return;

                IntPtr proc = GetProcAddress(hModule, "CreateInterface");
                if (proc == IntPtr.Zero) return;

                int retCode = 0;
                var createInterface = (CreateInterfaceFn)Marshal.GetDelegateForFunctionPointer(proc, typeof(CreateInterfaceFn));
                steamClient = createInterface("SteamClient020", ref retCode);
                if (steamClient == IntPtr.Zero) return;

                var createSteamPipe = GetDelegate<CreateSteamPipeFn>(steamClient, 0);
                releaseSteamPipe = GetDelegate<ReleaseSteamPipeFn>(steamClient, 1);
                var connectToGlobalUser = GetDelegate<ConnectToGlobalUserFn>(steamClient, 2);
                releaseUser = GetDelegate<ReleaseUserFn>(steamClient, 4);
                var getUserStats = GetDelegate<GetISteamUserStatsFn>(steamClient, 13);

                pipe = createSteamPipe(steamClient);
                if (pipe == 0) return;

                user = connectToGlobalUser(steamClient, pipe);
                if (user == 0)
                {
                    return;
                }

                IntPtr userStats = getUserStats(steamClient, user, pipe, "STEAMUSERSTATS_INTERFACE_VERSION012");
                if (userStats != IntPtr.Zero)
                {
                    var reqCurrentStats = GetDelegate<RequestCurrentStatsFn>(userStats, 0);
                    if (reqCurrentStats != null) reqCurrentStats(userStats);
                }

                // Main idling loop: keep pipe active and pump callbacks until stop signal
                while (!ShouldStop(controlFile) && !exitHandle.WaitOne(1000))
                {
                    CallbackMsg msg = new CallbackMsg();
                    while (Steam_BGetCallback(pipe, ref msg))
                    {
                        Steam_FreeLastCallback(pipe);
                    }
                }

            }
            catch
            {
                Environment.ExitCode = 1;
            }
            finally
            {
                try
                {
                    ReleaseSteamSession(steamClient, ref pipe, ref user, releaseUser, releaseSteamPipe);
                }
                finally
                {
                    try { if (hModule != IntPtr.Zero) FreeLibrary(hModule); }
                    finally
                    {
                        if (exitHandle != null) exitHandle.Dispose();
                        if (sessionOwner != null)
                        {
                            if (ownsSession) sessionOwner.ReleaseMutex();
                            sessionOwner.Dispose();
                        }
                        if (ownsSession && !String.IsNullOrEmpty(controlFile))
                        {
                            try { File.Delete(controlFile); } catch {}
                        }
                    }
                }
            }
        }
    }
}
