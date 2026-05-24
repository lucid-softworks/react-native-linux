#pragma once

#include <memory>

#include "RNLinuxHost.h"

typedef struct _GtkApplication GtkApplication;
typedef struct _GtkApplicationWindow GtkApplicationWindow;
typedef struct _GtkWidget GtkWidget;

namespace rnlinux {

// RNLinuxApplication ties a GTK4 GtkApplication to an RNLinuxHost. The
// template's main.cpp constructs one and calls run().
//
// On `activate`, we:
//   1. Create the application window.
//   2. Construct an RNLinuxHost and a LinuxMountingManager.
//   3. Start the host, request a surface, and attach it to the root widget.
//   4. Show the window and enter the GTK main loop.
class RNLinuxApplication {
 public:
  explicit RNLinuxApplication(RNLinuxHost::Config config);
  ~RNLinuxApplication();

  // Runs the GTK main loop. Returns the process exit code.
  int run(int argc, char** argv);

  // PIMPL — Impl is forward-declared in the public section so other
  // anonymous-namespace helpers in RNLinuxApplication.cpp (e.g. GLib
  // signal trampolines that take a void* user-data pointer) can name
  // the type. The full definition is .cpp-private; consumers can't do
  // anything with the type beyond what we expose here.
  struct Impl;

 private:
  std::unique_ptr<Impl> impl_;

  static void onActivate(GtkApplication* app, void* userData);
  static void onShutdown(GtkApplication* app, void* userData);
};

}  // namespace rnlinux
