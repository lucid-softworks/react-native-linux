'use strict';

// A small FlatList with single-axis windowing — only items in the
// visible viewport (plus a one-screen buffer) are committed into the
// React tree. The native ScrollView still owns scroll geometry: we
// keep two spacer Views inside the content container so its size
// matches the full list, then we render just the slice that overlaps
// the viewport.
//
// This is the difference, on our software-paint VM, between paying
// per-frame paint cost for all 80 items vs ~14 — measured at 9 FPS
// → 37 FPS when we artificially shortened the data array.
//
// Supported props:
//   data: readonly T[]
//   renderItem: ({item, index}) => ReactNode
//   keyExtractor?: (item, index) => string
//   ItemSeparatorComponent?: ReactComponent
//   ListHeaderComponent?: ReactComponent | ReactNode
//   ListFooterComponent?: ReactComponent | ReactNode
//   ListEmptyComponent?: ReactComponent | ReactNode
//   horizontal?: boolean
//   contentContainerStyle, style — pass-through to ScrollView
//   numColumns?: number — basic row grouping (windowing disabled here)
//   extraData? — forces re-render when its identity changes
//   estimatedItemSize?: number — px estimate, default 50
//
// Missing for now: variable-height measurement, onEndReached,
// onScrollToIndexFailed, refreshControl, viewability tracking.

const React = require('react');
const {ScrollView, View} = require('./components');

function defaultKey(_, index) {
  return String(index);
}

function FlatList(props) {
  const {
    data,
    renderItem,
    keyExtractor = defaultKey,
    ItemSeparatorComponent,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    horizontal,
    contentContainerStyle,
    numColumns,
    style,
    estimatedItemSize = 50,
    onScroll,
    ...rest
  } = props;

  const items = data || [];

  // Track scroll offset + viewport extent on the cross-content axis.
  // We only setState on values that actually shift the window of
  // rendered items, so most onScroll fires are no-ops (rapid setState
  // here would defeat the entire point of virtualization).
  const [scrollOffset, setScrollOffset] = React.useState(0);
  const [viewportSize, setViewportSize] = React.useState(600);

  const handleScroll = React.useCallback(
    e => {
      const ne = e && e.nativeEvent;
      if (!ne) return;
      const offset = horizontal ? ne.contentOffset.x : ne.contentOffset.y;
      const size = horizontal ? ne.layoutMeasurement.width : ne.layoutMeasurement.height;
      // Quantize to estimatedItemSize so a per-pixel scroll doesn't
      // force a render — we only need to re-render when the visible
      // window actually shifts by an item.
      const q = Math.floor(offset / estimatedItemSize) * estimatedItemSize;
      setScrollOffset(prev => (prev === q ? prev : q));
      if (size && Math.abs(size - viewportSize) > 1) {
        setViewportSize(size);
      }
      if (typeof onScroll === 'function') onScroll(e);
    },
    [horizontal, estimatedItemSize, onScroll, viewportSize],
  );

  function renderEnd(component) {
    if (component == null) return null;
    if (React.isValidElement(component)) return component;
    if (typeof component === 'function') return React.createElement(component);
    return null;
  }

  let content;
  let leadingSpacer = null;
  let trailingSpacer = null;
  if (items.length === 0) {
    content = renderEnd(ListEmptyComponent);
  } else if (numColumns && numColumns > 1) {
    // Windowing disabled for multi-column layouts — the item-size
    // estimate gets ambiguous and most multi-column lists are short.
    const rows = [];
    for (let i = 0; i < items.length; i += numColumns) {
      const slice = items.slice(i, i + numColumns);
      rows.push(
        React.createElement(
          View,
          {key: 'row-' + i, style: {flexDirection: 'row'}},
          slice.map((item, j) =>
            React.createElement(
              View,
              {key: keyExtractor(item, i + j), style: {flex: 1}},
              renderItem({item, index: i + j}),
            ),
          ),
        ),
      );
    }
    content = rows;
  } else {
    // Compute the visible window with one screen of overscan on each
    // side so items just past the edge are already mounted before
    // they scroll into view.
    const overscan = viewportSize;
    const startPx = Math.max(0, scrollOffset - overscan);
    const endPx = scrollOffset + viewportSize + overscan;
    const startIdx = Math.max(0, Math.floor(startPx / estimatedItemSize));
    const endIdx = Math.min(items.length, Math.ceil(endPx / estimatedItemSize));
    const before = startIdx * estimatedItemSize;
    const after = (items.length - endIdx) * estimatedItemSize;

    const spacerStyle = sz => (horizontal ? {width: sz} : {height: sz});
    if (before > 0) {
      leadingSpacer = React.createElement(View, {
        key: 'rnl-flatlist-leading-spacer',
        style: spacerStyle(before),
      });
    }
    if (after > 0) {
      trailingSpacer = React.createElement(View, {
        key: 'rnl-flatlist-trailing-spacer',
        style: spacerStyle(after),
      });
    }

    content = [];
    for (let index = startIdx; index < endIdx; index++) {
      const item = items[index];
      content.push(
        React.createElement(
          React.Fragment,
          {key: keyExtractor(item, index)},
          renderItem({item, index}),
        ),
      );
      if (ItemSeparatorComponent && index < items.length - 1) {
        content.push(React.createElement(ItemSeparatorComponent, {key: 'sep-' + index}));
      }
    }
  }

  return React.createElement(
    ScrollView,
    {style, horizontal, onScroll: handleScroll, ...rest},
    React.createElement(
      View,
      {style: [{flexDirection: horizontal ? 'row' : 'column'}, contentContainerStyle]},
      renderEnd(ListHeaderComponent),
      leadingSpacer,
      content,
      trailingSpacer,
      renderEnd(ListFooterComponent),
    ),
  );
}

module.exports = {FlatList};
