[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Sid
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Sid -notmatch '^S-1-5-21-(?:[0-9]+-){3}[0-9]+$') {
  throw 'Temporary account SID is invalid.'
}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'LSA account-right cleanup requires an administrator token.'
}

if ($null -eq ('DuskStudioLsaAccountRights' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class DuskStudioLsaAccountRights
{
    private const uint PolicyLookupNames = 0x00000800;
    private const int ErrorFileNotFound = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaObjectAttributes
    {
        public uint Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaOpenPolicy(
        IntPtr systemName,
        ref LsaObjectAttributes objectAttributes,
        uint desiredAccess,
        out IntPtr policyHandle
    );

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaRemoveAccountRights(
        IntPtr policyHandle,
        IntPtr accountSid,
        [MarshalAs(UnmanagedType.U1)] bool allRights,
        IntPtr userRights,
        uint countOfRights
    );

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaEnumerateAccountRights(
        IntPtr policyHandle,
        IntPtr accountSid,
        out IntPtr userRights,
        out uint countOfRights
    );

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaNtStatusToWinError(uint status);

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaFreeMemory(IntPtr buffer);

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaClose(IntPtr policyHandle);

    private static void ThrowStatus(string operation, uint status)
    {
        int error = unchecked((int)LsaNtStatusToWinError(status));
        throw new Win32Exception(error, operation + " failed.");
    }

    public static void RemoveAllAndVerify(string sidText)
    {
        var sid = new SecurityIdentifier(sidText);
        var sidBytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(sidBytes, 0);
        var sidPin = GCHandle.Alloc(sidBytes, GCHandleType.Pinned);
        IntPtr policy = IntPtr.Zero;
        try
        {
            var attributes = new LsaObjectAttributes();
            uint status = LsaOpenPolicy(
                IntPtr.Zero,
                ref attributes,
                PolicyLookupNames,
                out policy
            );
            if (status != 0)
            {
                ThrowStatus("LsaOpenPolicy", status);
            }

            status = LsaRemoveAccountRights(
                policy,
                sidPin.AddrOfPinnedObject(),
                true,
                IntPtr.Zero,
                0
            );
            int removeError = unchecked((int)LsaNtStatusToWinError(status));
            if (status != 0 && removeError != ErrorFileNotFound)
            {
                ThrowStatus("LsaRemoveAccountRights", status);
            }

            IntPtr rights = IntPtr.Zero;
            uint rightsCount = 0;
            status = LsaEnumerateAccountRights(
                policy,
                sidPin.AddrOfPinnedObject(),
                out rights,
                out rightsCount
            );
            if (status == 0)
            {
                if (rights != IntPtr.Zero)
                {
                    LsaFreeMemory(rights);
                }
                throw new InvalidOperationException(
                    "The temporary SID retained an LSA account-right record."
                );
            }
            int enumerateError = unchecked((int)LsaNtStatusToWinError(status));
            if (enumerateError != ErrorFileNotFound)
            {
                ThrowStatus("LsaEnumerateAccountRights", status);
            }
        }
        finally
        {
            if (policy != IntPtr.Zero)
            {
                LsaClose(policy);
            }
            if (sidPin.IsAllocated)
            {
                sidPin.Free();
            }
        }
    }
}
'@
}

[DuskStudioLsaAccountRights]::RemoveAllAndVerify($Sid)
Write-Output 'Temporary SID LSA account rights are absent.'
