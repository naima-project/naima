---
title: On Windows, naima update, a tool's install and the launcher's restore unpack with Git Bash's GNU tar as with Windows' own tar
kind: fix
affects:
  - usage
---

On Windows, when the tar first on the path is Git Bash's GNU tar, `naima update` no longer fails with "Cannot connect to C: resolve failed": GNU tar
read the drive letter of the archive's path as the name of a remote host. Naima now runs tar from the archive's folder and names the archive by its file
name alone, a form both GNU tar and Windows' bsdtar take as a local file. Installing a tool from a tar.gz, zip or deb, and the PowerShell launcher's
restore of a missing program, unpack the same way.
