[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Sid,

  [Parameter(Mandatory = $true)]
  [ValidateSet('GrantBatchLogon', 'RemoveAll')]
  [string] $Action
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Sid -notmatch '^S-1-5-21-(?:[0-9]+-){3}[0-9]+$') {
  throw 'Temporary account SID is invalid.'
}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'LSA account-right management requires an administrator token.'
}

if ($null -eq ('DuskStudioLsaAccountRights' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class DuskStudioLsaAccountRights
{
    private const uint PolicyCreateAccount = 0x00000010;
    private const uint PolicyLookupNames = 0x00000800;
    private const int ErrorFileNotFound = 2;
    private const string BatchLogonRight = "SeBatchLogonRight";

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

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaUnicodeString
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaOpenPolicy(
        IntPtr systemName,
        ref LsaObjectAttributes objectAttributes,
        uint desiredAccess,
        out IntPtr policyHandle
    );

    [DllImport("advapi32.dll", PreserveSig = true)]
    private static extern uint LsaAddAccountRights(
        IntPtr policyHandle,
        IntPtr accountSid,
        ref LsaUnicodeString userRights,
        uint countOfRights
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

    private static IntPtr OpenPolicy(uint desiredAccess)
    {
        var attributes = new LsaObjectAttributes();
        IntPtr policy;
        uint status = LsaOpenPolicy(
            IntPtr.Zero,
            ref attributes,
            desiredAccess,
            out policy
        );
        if (status != 0)
        {
            ThrowStatus("LsaOpenPolicy", status);
        }
        return policy;
    }

    private static string[] EnumerateRights(IntPtr policy, IntPtr accountSid)
    {
        IntPtr rights = IntPtr.Zero;
        uint rightsCount = 0;
        uint status = LsaEnumerateAccountRights(
            policy,
            accountSid,
            out rights,
            out rightsCount
        );
        if (status != 0)
        {
            int error = unchecked((int)LsaNtStatusToWinError(status));
            if (error == ErrorFileNotFound)
            {
                return Array.Empty<string>();
            }
            ThrowStatus("LsaEnumerateAccountRights", status);
        }

        try
        {
            var result = new string[rightsCount];
            int structureSize = Marshal.SizeOf(typeof(LsaUnicodeString));
            for (uint index = 0; index < rightsCount; index++)
            {
                IntPtr itemPointer = IntPtr.Add(
                    rights,
                    checked((int)index * structureSize)
                );
                var item = (LsaUnicodeString)Marshal.PtrToStructure(
                    itemPointer,
                    typeof(LsaUnicodeString)
                );
                result[index] = item.Buffer == IntPtr.Zero
                    ? String.Empty
                    : Marshal.PtrToStringUni(item.Buffer, item.Length / 2);
            }
            return result;
        }
        finally
        {
            if (rights != IntPtr.Zero)
            {
                LsaFreeMemory(rights);
            }
        }
    }

    public static void GrantBatchAndVerify(string sidText)
    {
        var sid = new SecurityIdentifier(sidText);
        var sidBytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(sidBytes, 0);
        var sidPin = GCHandle.Alloc(sidBytes, GCHandleType.Pinned);
        IntPtr policy = IntPtr.Zero;
        IntPtr rightBuffer = IntPtr.Zero;
        try
        {
            policy = OpenPolicy(PolicyLookupNames | PolicyCreateAccount);
            rightBuffer = Marshal.StringToHGlobalUni(BatchLogonRight);
            int rightBytes = checked(BatchLogonRight.Length * sizeof(char));
            var right = new LsaUnicodeString
            {
                Length = checked((ushort)rightBytes),
                MaximumLength = checked((ushort)(rightBytes + sizeof(char))),
                Buffer = rightBuffer
            };
            uint status = LsaAddAccountRights(
                policy,
                sidPin.AddrOfPinnedObject(),
                ref right,
                1
            );
            if (status != 0)
            {
                ThrowStatus("LsaAddAccountRights", status);
            }

            string[] rights = EnumerateRights(policy, sidPin.AddrOfPinnedObject());
            if (rights.Length != 1 ||
                !String.Equals(rights[0], BatchLogonRight, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "The temporary SID did not retain exactly the required batch-logon right."
                );
            }
        }
        finally
        {
            if (rightBuffer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(rightBuffer);
            }
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

    public static void RemoveAllAndVerify(string sidText)
    {
        var sid = new SecurityIdentifier(sidText);
        var sidBytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(sidBytes, 0);
        var sidPin = GCHandle.Alloc(sidBytes, GCHandleType.Pinned);
        IntPtr policy = IntPtr.Zero;
        try
        {
            policy = OpenPolicy(PolicyLookupNames);
            uint status = LsaRemoveAccountRights(
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

switch ($Action) {
  'GrantBatchLogon' {
    [DuskStudioLsaAccountRights]::GrantBatchAndVerify($Sid)
    Write-Output 'Temporary SID has exactly the required batch-logon right.'
  }
  'RemoveAll' {
    [DuskStudioLsaAccountRights]::RemoveAllAndVerify($Sid)
    Write-Output 'Temporary SID LSA account rights are absent.'
  }
}
