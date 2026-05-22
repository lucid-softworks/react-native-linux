# Security policy

## Supported versions

react-native-linux is pre-1.0. We only support the current `main` branch and
the latest published `0.x` release. Older releases will not receive security
fixes.

## Reporting a vulnerability

Please do **not** open public GitHub issues for security problems.

Email the maintainers at **security@lucidsoft.works** with:

- A description of the vulnerability.
- Steps to reproduce or a proof-of-concept, if possible.
- The affected version(s) (commit SHA is ideal).

You should expect an initial acknowledgment within 72 hours. We aim to ship a
fix within 30 days of confirmation for high-severity issues, or coordinate a
longer timeline for lower-severity ones.

## Scope

In scope:

- The native runtime in `vnext/` (memory safety, untrusted-bundle handling,
  JS-to-native interface).
- The JS packages in `packages/*` (prototype pollution, supply-chain risks in
  declared dependencies).
- The CLI in `packages/@react-native-linux/cli` (command-injection in shelled
  subprocesses, template-copy traversal bugs).

Out of scope:

- Vulnerabilities in upstream React Native (report to
  https://github.com/facebook/react-native/security).
- Vulnerabilities in GTK4 or Hermes (report to those projects).
- Issues that require the attacker to already control the developer's machine.

## Disclosure

We follow coordinated disclosure: once a fix is released, we publish a GitHub
Security Advisory describing the issue and credit the reporter unless they ask
otherwise.
