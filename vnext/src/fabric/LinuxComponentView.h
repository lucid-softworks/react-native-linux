#pragma once

#include <cstdint>
#include <memory>

typedef struct _GtkWidget GtkWidget;

namespace facebook::react {
class EventEmitter;
class Props;
class State;
struct LayoutMetrics;
}  // namespace facebook::react

namespace rnlinux {

using Tag = int32_t;

// Base class for any Linux-side Fabric component view. Holds an owning
// reference to a GtkWidget* and exposes the four lifecycle hooks the
// LinuxMountingManager calls.
//
// Concrete subclasses (ViewComponentView, ParagraphComponentView, ...) live in
// vnext/src/views/.
class LinuxComponentView {
 public:
  explicit LinuxComponentView(Tag tag) : tag_(tag) {}
  virtual ~LinuxComponentView();

  Tag tag() const { return tag_; }
  GtkWidget* widget() const { return widget_; }

  virtual void updateProps(
      facebook::react::Props const& oldProps,
      facebook::react::Props const& newProps) = 0;
  virtual void updateState(facebook::react::State const& state) {}
  virtual void updateLayoutMetrics(
      facebook::react::LayoutMetrics const& metrics);
  virtual void updateEventEmitter(
      std::shared_ptr<facebook::react::EventEmitter const> ee) {
    eventEmitter_ = std::move(ee);
  }

  // Mount the child *into* this view at `index`. The parent owns positioning;
  // for our GtkFixed-backed View this is a gtk_fixed_put with absolute coords.
  virtual void mountChild(LinuxComponentView& child, int index);
  virtual void unmountChild(LinuxComponentView& child, int index);

 protected:
  Tag tag_;
  GtkWidget* widget_ = nullptr;  // Owned by GTK; set by subclass constructor.
  std::shared_ptr<facebook::react::EventEmitter const> eventEmitter_;

  // Cached layout from the last updateLayoutMetrics call (logical px).
  float layoutX_ = 0;
  float layoutY_ = 0;
  float layoutWidth_ = 0;
  float layoutHeight_ = 0;
};

}  // namespace rnlinux
