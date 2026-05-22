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

 private:
  // PIMPL — full struct lives in RNLinuxApplication.cpp. The static GTK
  // signal handlers below need access to its members, so they are
  // members themselves (private — never called outside the class).
  struct Impl;
  std::unique_ptr<Impl> impl_;

  static void onActivate(GtkApplication* app, void* userData);
  static void onShutdown(GtkApplication* app, void* userData);
};

}  // namespace rnlinux
