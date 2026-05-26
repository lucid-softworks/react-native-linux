'use strict';

// A lightweight Modal that renders as an absolutely-positioned
// overlay inside the same window. RN's stock Modal pops up a native
// OS-level dialog on iOS/Android; on Linux we'd want a separate
// GtkWindow to match, but for the MVP an in-window overlay covers
// the typical sheet / drawer / confirmation-dialog use cases without
// any extra C++.
//
// Supported props (subset of RN's Modal):
//   visible:        boolean (default false). Renders nothing when off.
//   onRequestClose: () => void — fired by Escape and the optional
//                   backdrop tap.
//   transparent:    boolean — when false (default), the backdrop is
//                   opaque. When true, the backdrop alpha is 0 and
//                   only the modal's own content has style.
//   animationType:  ignored for now (would need Animated wired up).
//   onShow:         fires once after mount.
//   children:       ReactNode

const React = require('react');
const {View, Pressable} = require('./components');

function Modal(props) {
  const {visible = false, transparent = false, children, onRequestClose, onShow} = props;

  // RN's Modal returns null when invisible. The Effect on `visible`
  // toggling fires onShow when going visible.
  React.useEffect(() => {
    if (visible && typeof onShow === 'function') onShow();
  }, [visible]);

  if (!visible) return null;

  const backdrop = transparent ? 'rgba(0,0,0,0)' : 'rgba(15,23,42,0.5)';

  return React.createElement(
    View,
    {
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: backdrop,
        // alignItems/justifyContent default to center so a child
        // panel with its own width/height auto-centers, mirroring
        // how RN's Modal commonly sandwiches a `<View>` panel.
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    // Tap-on-backdrop closes — same as RN's Modal default.
    typeof onRequestClose === 'function'
      ? React.createElement(Pressable, {
          style: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
          onPress: onRequestClose,
        })
      : null,
    children,
  );
}

module.exports = {Modal};
