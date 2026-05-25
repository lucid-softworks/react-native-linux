'use strict';

// A small FlatList compatible with the most common subset of RN's
// API. Built on top of our ScrollView — no windowing / virtualization
// yet (the real VirtualizedList does cellRecycling + measurement
// caching, which we don't need for the demo scale). For apps with
// thousands of rows we'd port the real Lists/* tree; this stays
// useful up to ~hundreds of rows.
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
//   numColumns?: number — basic row grouping
//   extraData? — forces re-render when its identity changes
//
// Missing for now: onEndReached, getItemLayout-based optimization,
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
    ...rest
  } = props;

  const items = data || [];

  function renderEnd(component) {
    if (component == null) return null;
    if (React.isValidElement(component)) return component;
    if (typeof component === 'function') return React.createElement(component);
    return null;
  }

  let content;
  if (items.length === 0) {
    content = renderEnd(ListEmptyComponent);
  } else if (numColumns && numColumns > 1) {
    // Group N at a time into a horizontal row View. Each row is a
    // flexDirection:row View; total list stacks them vertically.
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
            )),
        ),
      );
    }
    content = rows;
  } else {
    content = [];
    items.forEach((item, index) => {
      content.push(
        React.createElement(
          React.Fragment,
          {key: keyExtractor(item, index)},
          renderItem({item, index}),
        ),
      );
      if (ItemSeparatorComponent && index < items.length - 1) {
        content.push(
          React.createElement(ItemSeparatorComponent, {key: 'sep-' + index}),
        );
      }
    });
  }

  return React.createElement(
    ScrollView,
    {style, horizontal, ...rest},
    React.createElement(
      View,
      {style: [
        {flexDirection: horizontal ? 'row' : 'column'},
        contentContainerStyle,
      ]},
      renderEnd(ListHeaderComponent),
      content,
      renderEnd(ListFooterComponent),
    ),
  );
}

module.exports = {FlatList};
