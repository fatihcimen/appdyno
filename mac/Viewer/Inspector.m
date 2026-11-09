// The pane beside the device: the stream's numbers, what an agent has called, the device's apps, the app's log, its requests
// and what an audit finds, and a link or a push to send. The numbers come from this process; the rest from the parent, by
// messages.
#import "Place.h"
#import "Window.h"
#import "Words.h"

// ten symbols share the Inspector's width, as the system's own Inspectors set them out: a row of their own, edge to edge
static const double kUsualRate = 60, kSparkHeight = 56, kTabHigh = 26, kTabRound = 6, kTabsInset = 10, kInset = 16;

/// The panes in the order their symbols stand, by the index `showPane:` takes.
static const struct {
  const char *identifier, *title, *symbol;
} kTabs[MVPanes] = {
    {"tabPerformance", "Performance", "gauge.with.dots.needle.67percent"},
    {"tabFlows", "Flows", "point.topleft.down.to.point.bottomright.curvepath"},
    {"tabApps", "Apps", "square.grid.2x2"},
    {"tabActivity", "Activity", "clock.arrow.circlepath"},
    {"tabLogs", "Logs", "text.alignleft"},
    {"tabNetwork", "Network", "network"},
    {"tabAccessibility", "Accessibility", "accessibility"},
    {"tabDevice", "Device", "slider.horizontal.3"},
    {"tabLinks", "Links", "link"},
    {"tabPush", "Push", "bell.badge"},
};

static NSTextField *caption(NSString *text) {
  return MVText(text, MVStyleSub);
}

static NSTextField *value(void) {
  NSTextField *field = MVText(@"–", MVStyleSub);
  field.font = [NSFont monospacedDigitSystemFontOfSize:11 weight:NSFontWeightMedium];
  field.textColor = MVInkColor();
  field.alignment = NSTextAlignmentRight;
  field.lineBreakMode = NSLineBreakByTruncatingMiddle;
  return field;
}

static NSString *ms(id v) {
  return [v respondsToSelector:@selector(doubleValue)] && [v doubleValue] > 0 ? [NSString stringWithFormat:@"%.1f ms", [v doubleValue]] : @"–";
}

@implementation MVInspector {
  NSArray<NSButton *> *_tabs;
  NSTextField *_paneName;
  NSView *_panes[MVPanes];
  NSTextField *_fps, *_fpsNote;
  NSMutableDictionary<NSString *, NSTextField *> *_tiles;
  double _lastRate;
  MVSpark *_spark;
  NSDictionary<NSString *, NSTextField *> *_values;
  MVActivityPane *_activity;
  MVList *_apps;
  NSView *_noApps;
  NSArray<NSDictionary *> *_appList;
  NSSearchField *_filter;
  NSTextField *_appsNote;
  NSButton *_launch, *_quit, *_remove;
  BOOL _asked;
  BOOL _open;
}

- (nullable NSString *)stage {
  return self.of.stage;
}

- (instancetype)initWithFrame:(NSRect)frame target:(id)target {
  if ((self = [super initWithFrame:frame])) {
    NSMutableArray *tabs = [NSMutableArray array];
    for (NSInteger i = 0; i < MVPanes; i++) {
      NSButton *tab = [MVBarButton buttonWithImage:[NSImage new] target:self action:@selector(tabChosen:)];
      tab.bordered = NO;
      tab.wantsLayer = YES;
      tab.layer.cornerRadius = kTabRound;
      tab.layer.cornerCurve = kCACornerCurveContinuous;
      tab.tag = i;
      tab.identifier = @(kTabs[i].identifier);
      tab.toolTip = MVWord(@(kTabs[i].title));
      tab.accessibilityLabel = tab.toolTip;
      [tab.heightAnchor constraintEqualToConstant:kTabHigh].active = YES;
      [tabs addObject:tab];
    }
    _tabs = tabs;
    NSStackView *row = [NSStackView stackViewWithViews:tabs];
    row.distribution = NSStackViewDistributionFillEqually;
    row.spacing = 2;
    NSView *rule = MVSeparator();
    _paneName = MVText(@"", MVStyleTitle);
    for (NSView *part in @[row, rule, _paneName]) {
      part.translatesAutoresizingMaskIntoConstraints = NO;
      [self addSubview:part];
    }
    NSView *head = _paneName;
    _numbers = [self statsPane];
    _panes[MVPaneActivity] = [self activityPane];
    _panes[MVPaneApps] = [self appsPane];
    _links = [MVLinkPane new];
    _panes[MVPaneLinks] = _links;
    _push = [MVPushPane new];
    _panes[MVPanePush] = _push;
    _logs = [MVLogPane new];
    _panes[MVPaneLogs] = _logs;
    _network = [MVNetworkPane new];
    _panes[MVPaneNetwork] = _network;
    _audit = [MVAuditPane new];
    _panes[MVPaneAccessibility] = _audit;
    _perf = [[MVPerfPane alloc] initWithFrame:NSZeroRect target:target];
    _panes[MVPanePerf] = _perf;
    _flow = [[MVFlowPane alloc] initWithFrame:NSZeroRect target:target];
    _panes[MVPaneFlow] = _flow;
    _device = [MVDevicePane new];
    _panes[MVPaneDevice] = _device;
    NSMutableArray *rules = [NSMutableArray arrayWithArray:@[
      [row.topAnchor constraintEqualToAnchor:self.topAnchor
                                    constant:8],
      [row.leadingAnchor constraintEqualToAnchor:self.leadingAnchor
                                        constant:kTabsInset],
      [row.trailingAnchor constraintEqualToAnchor:self.trailingAnchor
                                         constant:-kTabsInset],
      [rule.topAnchor constraintEqualToAnchor:row.bottomAnchor
                                     constant:8],
      [rule.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [rule.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
      [head.topAnchor constraintEqualToAnchor:rule.bottomAnchor
                                     constant:12],
      [head.leadingAnchor constraintEqualToAnchor:self.leadingAnchor
                                         constant:kInset],
      [head.trailingAnchor constraintEqualToAnchor:self.trailingAnchor
                                          constant:-kInset],
    ]];
    for (int i = 0; i < MVPanes; i++) {
      NSView *pane = _panes[i];
      pane.translatesAutoresizingMaskIntoConstraints = NO;
      pane.hidden = i != MVPanePerf;
      [self addSubview:pane];
      [rules addObjectsFromArray:@[
        [pane.topAnchor constraintEqualToAnchor:head.bottomAnchor
                                       constant:12],
        [pane.leadingAnchor constraintEqualToAnchor:self.leadingAnchor
                                           constant:kInset],
        [pane.trailingAnchor constraintEqualToAnchor:self.trailingAnchor
                                            constant:-kInset],
        [pane.bottomAnchor constraintEqualToAnchor:self.bottomAnchor
                                          constant:-kInset],
      ]];
    }
    [NSLayoutConstraint activateConstraints:rules];
    [self showPane:MVPanePerf];
  }
  return self;
}

/// One figure of the three a person came for.
- (NSView *)tile:(NSString *)name value:(NSString *)key {
  NSTextField *number = value();
  number.font = MVRoundedFont(22, NSFontWeightSemibold);
  number.alignment = NSTextAlignmentLeft;
  _tiles[key] = number;
  NSStackView *stack = [NSStackView stackViewWithViews:@[number, caption(name)]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 1;
  return stack;
}

/// Rows of a name and a value under a heading, each value kept by its key. A kind of number that comes later, such
/// as the device's own CPU and memory, is one more of these.
- (NSView *)group:(NSString *)title rows:(NSArray<NSArray<NSString *> *> *)rows into:(NSMutableDictionary *)values {
  NSTextField *heading = MVPaneHeading(title);
  NSMutableArray *cells = [NSMutableArray array];
  for (NSArray<NSString *> *row in rows) {
    values[row[0]] = value();
    [cells addObject:@[caption(row[1]), values[row[0]]]];
  }
  NSGridView *grid = [NSGridView gridViewWithViews:cells];
  grid.rowSpacing = 6;
  grid.columnSpacing = 8;
  [grid columnAtIndex:1].xPlacement = NSGridCellPlacementTrailing;
  NSBox *rule = [NSBox new];
  rule.boxType = NSBoxSeparator;
  NSStackView *stack = [NSStackView stackViewWithViews:@[rule, heading, grid]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 7;
  [rule.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  [grid.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  return stack;
}

- (NSView *)statsPane {
  _fps = [NSTextField labelWithString:@"\u2013"];
  _fps.font = MVRoundedFont(44, NSFontWeightBold);
  _fpsNote = caption(@"waiting for a picture");
  _spark = [MVSpark new];
  _spark.hidden = YES;
  _spark.usual = kUsualRate;
  _spark.translatesAutoresizingMaskIntoConstraints = NO;
  [_spark.heightAnchor constraintEqualToConstant:kSparkHeight].active = YES;
  _tiles = [NSMutableDictionary dictionary];
  NSStackView *tiles = [NSStackView stackViewWithViews:@[[self tile:@"frames" value:@"frames"], [self tile:@"dropped" value:@"dropped"], [self tile:@"latency" value:@"latency"]]];
  tiles.distribution = NSStackViewDistributionFillEqually;
  NSMutableDictionary *values = [NSMutableDictionary dictionary];
  NSView *stream = [self group:@"Stream" rows:@[@[@"source", @"Source"], @[@"mode", @"Mode"], @[@"size", @"Picture"], @[@"mbps", @"Bit rate"], @[@"decode", @"Decode, p95"]] into:values];
  NSView *viewer = [self group:@"Viewer" rows:@[@[@"cpu", @"CPU"], @[@"rss", @"Memory"]] into:values];
  _values = values;
  NSStackView *stack = [NSStackView stackViewWithViews:@[_fps, _fpsNote, _spark, tiles, stream, viewer]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 4;
  [stack setCustomSpacing:12 afterView:_fpsNote];
  [stack setCustomSpacing:12 afterView:_spark];
  [stack setCustomSpacing:16 afterView:tiles];
  [stack setCustomSpacing:14 afterView:stream];
  for (NSView *wide in @[_spark, tiles, stream, viewer]) [wide.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSView *pane = [NSView new];
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [pane addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.topAnchor constraintEqualToAnchor:pane.topAnchor
                                    constant:6],
    [stack.leadingAnchor constraintEqualToAnchor:pane.leadingAnchor
                                        constant:4],
    [stack.trailingAnchor constraintEqualToAnchor:pane.trailingAnchor
                                         constant:-4],
  ]];
  return pane;
}

- (NSView *)activityPane {
  _activity = [MVActivityPane new];
  return _activity;
}

- (NSView *)appsPane {
  _filter = [NSSearchField new];
  _filter.placeholderString = MVWord(@"Filter");
  _filter.target = self;
  _filter.action = @selector(filterChanged:);
  _filter.accessibilityLabel = MVWord(@"Filter apps");
  _apps = [MVList new];
  _noApps = MVEmptyCard(@"square.grid.2x2", @"No apps of your own on this device yet.");
  __weak MVInspector *weak = self;
  _apps.onSelect = ^(MVRow *row) {
    [weak enableAppButtons:row != nil];
  };
  _appsNote = caption(@"");
  _appsNote.lineBreakMode = NSLineBreakByWordWrapping;
  _appsNote.maximumNumberOfLines = 3;
  _launch = MVPlaceButton(@"Launch", @"appLaunch", self, @selector(launchApp:));
  _quit = MVPlaceButton(@"Quit", @"appQuit", self, @selector(quitApp:));
  _remove = MVPlaceButton(@"Remove…", @"appRemove", self, @selector(removeApp:));
  NSStackView *buttons = [NSStackView stackViewWithViews:@[_launch, _quit, _remove]];
  buttons.distribution = NSStackViewDistributionFillEqually;
  [self enableAppButtons:NO];
  NSView *gap = [NSView new];
  [gap setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
  NSStackView *stack = [NSStackView stackViewWithViews:@[_filter, _noApps, _apps, gap, _appsNote, buttons]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeWidth;
  stack.spacing = 8;
  return stack;
}

- (void)enableAppButtons:(BOOL)on {
  _launch.enabled = _quit.enabled = _remove.enabled = on;
}

- (id<MVAsks>)answering:(NSString *)name {
  if ([name isEqual:@"device"]) return _device;
  if ([name isEqual:@"network"]) return _network;
  return [name isEqual:@"push"] ? _push : _links;
}

- (BOOL)open {
  return _open;
}

- (void)setOpen:(BOOL)open {
  _open = open;
  [self watchPanes];
}

/// What reads the device runs while its pane shows, and stops when it hides.
- (void)watchPanes {
  _logs.watching = _open && _chosen == MVPaneLogs;
  _network.watching = _open && _chosen == MVPaneNetwork;
  _audit.watching = _open && _chosen == MVPaneAccessibility;
}

- (BOOL)readings {
  return _chosen == MVPanePerf;
}

- (BOOL)flowing {
  return _chosen == MVPaneFlow;
}

- (void)tabChosen:(NSButton *)sender {
  [self showPane:sender.tag];
}

- (void)showPane:(NSInteger)pane {
  for (NSButton *tab in _tabs) {
    BOOL chosen = tab.tag == pane;
    tab.layer.backgroundColor = chosen ? [MVAccent() colorWithAlphaComponent:0.22].CGColor : NSColor.clearColor.CGColor;
    tab.image = MVSymbol(@(kTabs[tab.tag].symbol), chosen ? MVAccent() : MVQuietColor(), 13, chosen ? NSFontWeightSemibold : NSFontWeightRegular);
    tab.accessibilityValue = chosen ? MVWord(@"selected") : nil;
  }
  _paneName.stringValue = MVWord(@(kTabs[pane].title));
  for (int i = 0; i < MVPanes; i++) _panes[i].hidden = i != pane;
  _chosen = pane;
  [self watchPanes];
  if (self.onPane) self.onPane();
  if (pane == MVPaneLinks || pane == MVPanePush || pane == MVPaneDevice) [(id<MVSendPane>)_panes[pane] ask];
  if (pane == MVPaneApps && !_asked) {
    _asked = YES;
    MVEmitFrom(self, @{@"op": @"app", @"action": @"list"});
  }
}

- (void)showStats:(NSDictionary *)s {
  double shown = [s[@"shown"] doubleValue];
  [_spark pass];
  [_spark add:shown];
  // a still screen is a good state, and sends nothing to count
  if (shown > 0) _lastRate = shown;
  _fps.stringValue = shown > 0 ? [NSString stringWithFormat:@"%.0f", shown] : @"Still";
  _fpsNote.stringValue = shown > 0 ? @"frames a second" : _lastRate > 0 ? [NSString stringWithFormat:@"last moved at %.0f frames a second", _lastRate]
                                                                        : @"nothing has moved yet";
  _tiles[@"frames"].stringValue = [NSString stringWithFormat:@"%.0f", shown];
  _tiles[@"dropped"].stringValue = [NSString stringWithFormat:@"%@", s[@"dropped"] ?: @0];
  _tiles[@"latency"].stringValue = ms(s[@"captureP50"]);
  _values[@"source"].stringValue = [s[@"source"] length] ? s[@"source"] : @"\u2013";
  _values[@"mode"].stringValue = [s[@"mode"] length] ? s[@"mode"] : @"\u2013";
  _values[@"size"].stringValue = [NSString stringWithFormat:@"%@ \u00D7 %@", s[@"w"], s[@"h"]];
  _values[@"mbps"].stringValue = [NSString stringWithFormat:@"%.1f Mbit/s", [s[@"mbps"] doubleValue]];
  _values[@"decode"].stringValue = ms(s[@"decodeP95"]);
  _values[@"cpu"].stringValue = [NSString stringWithFormat:@"%.1f %%", [s[@"cpu"] doubleValue]];
  _values[@"rss"].stringValue = [NSString stringWithFormat:@"%.0f MB", [s[@"rssMb"] doubleValue]];
}

- (void)addActivity:(NSDictionary *)call {
  [_activity add:call];
}

- (void)showApps:(NSDictionary *)message {
  _appList = [message[@"apps"] isKindOfClass:NSArray.class] ? message[@"apps"] : @[];
  _appsNote.stringValue = message[@"note"] ?: @"";
  [self filterChanged:nil];
}

- (void)filterChanged:(id)sender {
  NSString *needle = _filter.stringValue;
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  for (NSDictionary *app in _appList) {
    NSString *name = app[@"name"] ?: app[@"id"];
    if (needle.length && ![name localizedStandardContainsString:needle] && ![app[@"id"] localizedStandardContainsString:needle]) continue;
    MVRow *row = [MVRow new];
    row.title = name;
    row.detail = app[@"version"] ? [NSString stringWithFormat:@"%@  ·  %@", app[@"id"], app[@"version"]] : app[@"id"];
    row.symbol = @"app.dashed";
    row.tile = MVHueTile((NSInteger)(name.hash % 6));
    row.key = app[@"id"];
    [rows addObject:row];
  }
  _apps.rows = rows;
  _apps.hidden = rows.count == 0;
  _noApps.hidden = rows.count > 0;
  [self enableAppButtons:NO];
}

- (void)pokeApp:(NSString *)app {
  _filter.stringValue = app;
  [self filterChanged:nil];
  [self.window layoutIfNeeded];
  [self.window displayIfNeeded];
  BOOL found = _apps.rows.count > 0 && self.window;
  if (found) MVRealClick(self.window, [_apps pointOfRow:0]);
  MVEmitFrom(self, @{@"op": @"clicked", @"name": app, @"found": @(found)});
}

- (void)launchApp:(id)sender {
  MVEmitFrom(self, @{@"op": @"app", @"action": @"launch", @"id": _apps.selected.key ?: @""});
}

- (void)quitApp:(id)sender {
  MVEmitFrom(self, @{@"op": @"app", @"action": @"quit", @"id": _apps.selected.key ?: @""});
}

/// As a sheet, never modal over the whole app: a person may be using something else, and this must not take it.
- (void)removeApp:(id)sender {
  MVRow *row = _apps.selected;
  if (!row || !self.window) return;
  NSAlert *alert = [NSAlert new];
  alert.messageText = MVWord([NSString stringWithFormat:@"Remove %@?", row.title]);
  alert.informativeText = MVWord(@"The app and everything it keeps on this device go with it. This cannot be undone.");
  alert.alertStyle = NSAlertStyleWarning;
  NSButton *remove = [alert addButtonWithTitle:MVWord(@"Remove")];
  remove.hasDestructiveAction = YES;
  // by name, as a person's own run and a test press them
  remove.identifier = @"appRemoveConfirm";
  [alert addButtonWithTitle:MVWord(@"Cancel")].identifier = @"appRemoveCancel";
  NSString *key = row.key;
  [alert beginSheetModalForWindow:self.window
                completionHandler:^(NSModalResponse answer) {
                  if (answer == NSAlertFirstButtonReturn) MVEmitFrom(self, @{@"op": @"app", @"action": @"remove", @"id": key ?: @""});
                }];
}

@end
