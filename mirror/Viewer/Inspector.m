// The pane beside the device: the stream's numbers, what an agent has called, and the device's apps. The numbers
// come from this process; the rest from the parent, by messages.
#import "Window.h"

enum { kActivityRows = 200, kHistory = 60, kPaneStats = 0, kPaneActivity = 1, kPaneApps = 2 };

/// One line of a list.
@interface MVRow : NSObject
@property(nonatomic, copy) NSString *title;
@property(nonatomic, copy) NSString *detail;
@property(nonatomic, copy, nullable) NSString *symbol;
@property(nonatomic, nullable) NSColor *tint;
@property(nonatomic, copy, nullable) NSString *key;
@end

@implementation MVRow
@end

/// Rows of a title and a line beneath, with a symbol: the Activity pane's and the Apps pane's.
@interface MVList : NSScrollView <NSTableViewDataSource, NSTableViewDelegate>
@property(nonatomic, copy) NSArray<MVRow *> *rows;
@property(nonatomic, copy, nullable) void (^onSelect)(MVRow *_Nullable row);
@property(nonatomic, readonly, nullable) MVRow *selected;
- (void)scrollToEnd;
@end

@implementation MVList {
  NSTableView *_table;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _rows = @[];
    _table = [NSTableView new];
    _table.style = NSTableViewStyleInset;
    _table.rowHeight = 38;
    _table.headerView = nil;
    _table.backgroundColor = NSColor.clearColor;
    _table.intercellSpacing = NSMakeSize(0, 2);
    [_table addTableColumn:[[NSTableColumn alloc] initWithIdentifier:@"row"]];
    _table.columnAutoresizingStyle = NSTableViewUniformColumnAutoresizingStyle;
    _table.dataSource = self;
    _table.delegate = self;
    self.documentView = _table;
    self.hasVerticalScroller = YES;
    self.autohidesScrollers = YES;
    self.drawsBackground = NO;
  }
  return self;
}

- (void)setRows:(NSArray<MVRow *> *)rows {
  _rows = [rows copy];
  [_table reloadData];
}

- (void)scrollToEnd {
  if (_rows.count) [_table scrollRowToVisible:_rows.count - 1];
}

- (nullable MVRow *)selected {
  return _table.selectedRow >= 0 && (NSUInteger)_table.selectedRow < _rows.count ? _rows[_table.selectedRow] : nil;
}

- (NSInteger)numberOfRowsInTableView:(NSTableView *)table {
  return _rows.count;
}

- (void)tableViewSelectionDidChange:(NSNotification *)notification {
  if (self.onSelect) self.onSelect(self.selected);
}

- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)at {
  MVRow *row = _rows[at];
  NSTableCellView *cell = [NSTableCellView new];
  NSImageView *icon = [NSImageView new];
  icon.image = row.symbol ? [NSImage imageWithSystemSymbolName:row.symbol accessibilityDescription:nil] : nil;
  icon.contentTintColor = row.tint ?: NSColor.secondaryLabelColor;
  NSTextField *title = [NSTextField labelWithString:row.title];
  title.font = [NSFont systemFontOfSize:12 weight:NSFontWeightMedium];
  title.lineBreakMode = NSLineBreakByTruncatingTail;
  NSTextField *detail = [NSTextField labelWithString:row.detail];
  detail.font = [NSFont systemFontOfSize:10.5];
  detail.textColor = NSColor.secondaryLabelColor;
  detail.lineBreakMode = NSLineBreakByTruncatingMiddle;
  NSStackView *lines = [NSStackView stackViewWithViews:@[title, detail]];
  lines.orientation = NSUserInterfaceLayoutOrientationVertical;
  lines.alignment = NSLayoutAttributeLeading;
  lines.spacing = 1;
  [lines setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSStackView *stack = [NSStackView stackViewWithViews:@[icon, lines]];
  stack.spacing = 8;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [cell addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [icon.widthAnchor constraintEqualToConstant:18],
    [stack.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:4],
    [stack.trailingAnchor constraintLessThanOrEqualToAnchor:cell.trailingAnchor constant:-4],
    [stack.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
  ]];
  return cell;
}

@end

/// A line of the last minute's frames, and nothing else: its height is what the eye reads.
@interface MVSpark : NSView
- (void)add:(double)value;
@end

@implementation MVSpark {
  double _values[kHistory];
  int _count;
}

- (void)add:(double)value {
  memmove(_values, _values + 1, sizeof(double) * (kHistory - 1));
  _values[kHistory - 1] = value;
  if (_count < kHistory) _count++;
  self.needsDisplay = YES;
}

- (void)drawRect:(NSRect)dirty {
  double top = 60;
  for (int i = 0; i < kHistory; i++) top = MAX(top, _values[i]);
  NSBezierPath *line = [NSBezierPath bezierPath];
  double step = self.bounds.size.width / (kHistory - 1), height = self.bounds.size.height - 3;
  for (int i = kHistory - _count; i < kHistory; i++) {
    NSPoint p = NSMakePoint(i * step, 1.5 + _values[i] / top * height);
    if (line.isEmpty) [line moveToPoint:p];
    else [line lineToPoint:p];
  }
  [[NSColor.controlAccentColor colorWithAlphaComponent:0.9] setStroke];
  line.lineWidth = 1.5;
  line.lineJoinStyle = NSLineJoinStyleRound;
  [line stroke];
}

@end

static NSTextField *caption(NSString *text) {
  NSTextField *field = [NSTextField labelWithString:text];
  field.font = [NSFont systemFontOfSize:11];
  field.textColor = NSColor.secondaryLabelColor;
  return field;
}

static NSTextField *value(void) {
  NSTextField *field = [NSTextField labelWithString:@"–"];
  field.font = [NSFont monospacedDigitSystemFontOfSize:11 weight:NSFontWeightMedium];
  field.alignment = NSTextAlignmentRight;
  field.lineBreakMode = NSLineBreakByTruncatingMiddle;
  return field;
}

static NSString *ms(id v) {
  return [v respondsToSelector:@selector(doubleValue)] && [v doubleValue] > 0 ? [NSString stringWithFormat:@"%.1f ms", [v doubleValue]] : @"–";
}

@implementation MVInspector {
  NSSegmentedControl *_tabs;
  NSView *_panes[3];
  NSTextField *_fps;
  MVSpark *_spark;
  NSDictionary<NSString *, NSTextField *> *_values;
  MVList *_activity, *_apps;
  NSMutableArray<MVRow *> *_calls;
  NSArray<NSDictionary *> *_appList;
  NSSearchField *_filter;
  NSTextField *_appsNote;
  NSButton *_launch, *_quit, *_remove;
  BOOL _asked;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.material = NSVisualEffectMaterialSidebar;
    self.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    self.state = NSVisualEffectStateFollowsWindowActiveState;
    _calls = [NSMutableArray array];
    NSBox *edge = [NSBox new];
    edge.boxType = NSBoxSeparator;
    edge.frame = NSMakeRect(0, 0, 1, 1);
    edge.autoresizingMask = NSViewHeightSizable | NSViewMaxXMargin;
    [self addSubview:edge];
    _tabs = [NSSegmentedControl segmentedControlWithLabels:@[@"Stats", @"Activity", @"Apps"] trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(tabChosen:)];
    _tabs.selectedSegment = kPaneStats;
    _tabs.segmentDistribution = NSSegmentDistributionFillEqually;
    _tabs.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:_tabs];
    _panes[kPaneStats] = [self statsPane];
    _panes[kPaneActivity] = [self activityPane];
    _panes[kPaneApps] = [self appsPane];
    NSMutableArray *rules = [NSMutableArray arrayWithArray:@[
      [_tabs.topAnchor constraintEqualToAnchor:self.safeAreaLayoutGuide.topAnchor constant:10],
      [_tabs.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:12],
      [_tabs.trailingAnchor constraintEqualToAnchor:self.trailingAnchor constant:-12],
    ]];
    for (int i = 0; i < 3; i++) {
      NSView *pane = _panes[i];
      pane.translatesAutoresizingMaskIntoConstraints = NO;
      pane.hidden = i != kPaneStats;
      [self addSubview:pane];
      [rules addObjectsFromArray:@[
        [pane.topAnchor constraintEqualToAnchor:_tabs.bottomAnchor constant:12],
        [pane.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:12],
        [pane.trailingAnchor constraintEqualToAnchor:self.trailingAnchor constant:-12],
        [pane.bottomAnchor constraintEqualToAnchor:self.bottomAnchor constant:-12],
      ]];
    }
    [NSLayoutConstraint activateConstraints:rules];
  }
  return self;
}

- (NSView *)statsPane {
  _fps = [NSTextField labelWithString:@"–"];
  _fps.font = [NSFont monospacedDigitSystemFontOfSize:34 weight:NSFontWeightSemibold];
  NSTextField *unit = caption(@"frames shown a second");
  _spark = [MVSpark new];
  _spark.translatesAutoresizingMaskIntoConstraints = NO;
  [_spark.heightAnchor constraintEqualToConstant:44].active = YES;
  NSMutableDictionary *values = [NSMutableDictionary dictionary];
  NSMutableArray *rows = [NSMutableArray array];
  for (NSArray *row in @[@[@"source", @"Source"], @[@"mode", @"Mode"], @[@"size", @"Picture"], @[@"mbps", @"Bit rate"], @[@"capture", @"Capture to arrival"], @[@"decode", @"Decode, p95"], @[@"dropped", @"Dropped"], @[@"cpu", @"Viewer CPU"], @[@"rss", @"Viewer memory"]]) {
    values[row[0]] = value();
    [rows addObject:@[caption(row[1]), values[row[0]]]];
  }
  _values = values;
  NSGridView *grid = [NSGridView gridViewWithViews:rows];
  grid.rowSpacing = 7;
  grid.columnSpacing = 8;
  [grid columnAtIndex:1].xPlacement = NSGridCellPlacementTrailing;
  NSStackView *stack = [NSStackView stackViewWithViews:@[_fps, unit, _spark, grid]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 4;
  [stack setCustomSpacing:14 afterView:_spark];
  [_spark.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  [grid.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSView *pane = [NSView new];
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [pane addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.topAnchor constraintEqualToAnchor:pane.topAnchor constant:6],
    [stack.leadingAnchor constraintEqualToAnchor:pane.leadingAnchor constant:4],
    [stack.trailingAnchor constraintEqualToAnchor:pane.trailingAnchor constant:-4],
  ]];
  return pane;
}

- (NSView *)activityPane {
  _activity = [MVList new];
  return _activity;
}

- (NSView *)appsPane {
  _filter = [NSSearchField new];
  _filter.placeholderString = @"Filter";
  _filter.target = self;
  _filter.action = @selector(filterChanged:);
  _filter.accessibilityLabel = @"Filter apps";
  _apps = [MVList new];
  __weak MVInspector *weak = self;
  _apps.onSelect = ^(MVRow *row) {
    [weak enableAppButtons:row != nil];
  };
  _appsNote = caption(@"");
  _appsNote.lineBreakMode = NSLineBreakByWordWrapping;
  _appsNote.maximumNumberOfLines = 3;
  _launch = [NSButton buttonWithTitle:@"Launch" target:self action:@selector(launchApp:)];
  _quit = [NSButton buttonWithTitle:@"Quit" target:self action:@selector(quitApp:)];
  _remove = [NSButton buttonWithTitle:@"Remove…" target:self action:@selector(removeApp:)];
  NSStackView *buttons = [NSStackView stackViewWithViews:@[_launch, _quit, _remove]];
  buttons.distribution = NSStackViewDistributionFillEqually;
  [self enableAppButtons:NO];
  NSStackView *stack = [NSStackView stackViewWithViews:@[_filter, _apps, _appsNote, buttons]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeWidth;
  stack.spacing = 8;
  return stack;
}

- (void)enableAppButtons:(BOOL)on {
  _launch.enabled = _quit.enabled = _remove.enabled = on;
}

- (void)tabChosen:(NSSegmentedControl *)sender {
  [self showPane:sender.selectedSegment];
}

- (void)showPane:(NSInteger)pane {
  _tabs.selectedSegment = pane;
  for (int i = 0; i < 3; i++) _panes[i].hidden = i != pane;
  if (pane == kPaneApps && !_asked) {
    _asked = YES;
    MVEmit(@{@"op": @"app", @"action": @"list"});
  }
}

- (void)showStats:(NSDictionary *)s {
  double shown = [s[@"shown"] doubleValue];
  _fps.stringValue = [NSString stringWithFormat:@"%.0f", shown];
  [_spark add:shown];
  _values[@"source"].stringValue = [s[@"source"] length] ? s[@"source"] : @"–";
  _values[@"mode"].stringValue = [s[@"mode"] length] ? s[@"mode"] : @"–";
  _values[@"size"].stringValue = [NSString stringWithFormat:@"%@ × %@", s[@"w"], s[@"h"]];
  _values[@"mbps"].stringValue = [NSString stringWithFormat:@"%.1f Mbit/s", [s[@"mbps"] doubleValue]];
  _values[@"capture"].stringValue = ms(s[@"captureP50"]);
  _values[@"decode"].stringValue = ms(s[@"decodeP95"]);
  _values[@"dropped"].stringValue = [NSString stringWithFormat:@"%@", s[@"dropped"] ?: @0];
  _values[@"cpu"].stringValue = [NSString stringWithFormat:@"%.1f %%", [s[@"cpu"] doubleValue]];
  _values[@"rss"].stringValue = [NSString stringWithFormat:@"%.0f MB", [s[@"rssMb"] doubleValue]];
}

- (void)addActivity:(NSDictionary *)call {
  MVRow *row = [MVRow new];
  BOOL ok = [call[@"ok"] boolValue];
  row.title = call[@"tool"] ?: @"";
  row.detail = [NSString stringWithFormat:@"%@  ·  %@ ms%@", call[@"time"] ?: @"", call[@"ms"] ?: @0, [call[@"args"] length] ? [@"  ·  " stringByAppendingString:call[@"args"]] : @""];
  row.symbol = ok ? @"checkmark.circle" : @"xmark.octagon";
  row.tint = ok ? NSColor.systemGreenColor : NSColor.systemRedColor;
  [_calls addObject:row];
  if (_calls.count > kActivityRows) [_calls removeObjectAtIndex:0];
  _activity.rows = _calls;
  [_activity scrollToEnd];
}

- (void)showApps:(NSDictionary *)message {
  _appList = [message[@"apps"] isKindOfClass:NSArray.class] ? message[@"apps"] : @[];
  _appsNote.stringValue = message[@"note"] ?: @"";
  [self filterChanged:nil];
}

- (void)filterChanged:(id)sender {
  NSString *needle = _filter.stringValue.lowercaseString;
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  for (NSDictionary *app in _appList) {
    NSString *name = app[@"name"] ?: app[@"id"];
    if (needle.length && ![name.lowercaseString containsString:needle] && ![[app[@"id"] lowercaseString] containsString:needle]) continue;
    MVRow *row = [MVRow new];
    row.title = name;
    row.detail = app[@"version"] ? [NSString stringWithFormat:@"%@  ·  %@", app[@"id"], app[@"version"]] : app[@"id"];
    row.symbol = @"app.dashed";
    row.key = app[@"id"];
    [rows addObject:row];
  }
  _apps.rows = rows;
  [self enableAppButtons:NO];
}

- (void)launchApp:(id)sender {
  MVEmit(@{@"op": @"app", @"action": @"launch", @"id": _apps.selected.key ?: @""});
}

- (void)quitApp:(id)sender {
  MVEmit(@{@"op": @"app", @"action": @"quit", @"id": _apps.selected.key ?: @""});
}

/// As a sheet, never modal over the whole app: a person may be using something else, and this must not take it.
- (void)removeApp:(id)sender {
  MVRow *row = _apps.selected;
  if (!row || !self.window) return;
  NSAlert *alert = [NSAlert new];
  alert.messageText = [NSString stringWithFormat:@"Remove %@?", row.title];
  alert.informativeText = @"The app and everything it keeps on this device go with it. This cannot be undone.";
  alert.alertStyle = NSAlertStyleWarning;
  [alert addButtonWithTitle:@"Remove"].hasDestructiveAction = YES;
  [alert addButtonWithTitle:@"Cancel"];
  NSString *key = row.key;
  [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse answer) {
    if (answer == NSAlertFirstButtonReturn) MVEmit(@{@"op": @"app", @"action": @"remove", @"id": key ?: @""});
  }];
}

@end
