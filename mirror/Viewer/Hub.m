// The hub: every device this Mac can reach in a sidebar, and the one chosen, live, in its room. A stage stands there by
// the same code as in a window of its own; what a person asks goes to the parent as a message.
#import "Window.h"

static const NSSize kOpens = {1240, 860};
static const double kSidebar = 260;
// a window's three buttons stand above the sidebar's first line
static const double kBelowLights = 46;
static NSString *const kFold = @"fold";

static NSColor *_Nullable stateColor(NSDictionary *device) {
  if ([device[@"mirrored"] boolValue]) return NSColor.systemBlueColor;
  return [device[@"state"] isEqual:@"running"] ? NSColor.systemGreenColor : nil;
}

static NSString *stateWords(NSDictionary *device) {
  if ([device[@"mirrored"] boolValue]) return @"Window open";
  return [device[@"state"] isEqual:@"running"] ? @"Running" : @"Shut down";
}

static NSString *symbolOf(NSDictionary *device) {
  if ([device[@"model"] hasPrefix:@"iPad"]) return @"ipad";
  return [device[@"platform"] isEqual:@"android"] ? @"candybarphone" : @"iphone";
}

static NSTextField *label(CGFloat size, NSFontWeight weight, NSColor *color) {
  NSTextField *field = [NSTextField labelWithString:@""];
  field.font = [NSFont systemFontOfSize:size weight:weight];
  field.textColor = color;
  field.alignment = NSTextAlignmentCenter;
  field.lineBreakMode = NSLineBreakByTruncatingTail;
  return field;
}

/// Where the chosen stand: one fills it, and two share it evenly.
@interface MVRoomView : NSView
@end

@implementation MVRoomView
- (NSArray<NSView *> *)stages {
  NSIndexSet *at = [self.subviews indexesOfObjectsPassingTest:^BOOL(NSView *view, NSUInteger i, BOOL *stop) {
    return [view isKindOfClass:MVRootView.class];
  }];
  return [self.subviews objectsAtIndexes:at];
}

- (void)didAddSubview:(NSView *)subview {
  self.needsLayout = YES;
}

- (void)willRemoveSubview:(NSView *)subview {
  self.needsLayout = YES;
}

- (void)layout {
  [super layout];
  NSArray<NSView *> *stages = self.stages;
  // the room runs on under the sidebar, and the first takes that too, for its backdrop
  double under = self.safeAreaInsets.left, wide = (self.bounds.size.width - under) / MAX(stages.count, 1);
  [stages enumerateObjectsUsingBlock:^(NSView *stage, NSUInteger i, BOOL *stop) {
    double left = i == 0 ? 0 : under + i * wide;
    stage.frame = NSMakeRect(left, 0, under + (i + 1) * wide - left, self.bounds.size.height);
  }];
}
@end

@implementation MVHub {
  MVOffscreenWindow *_window;
  MVList *_list;
  NSSearchField *_search;
  NSDictionary *_shown;
  NSArray<NSDictionary *> *_devices;
  NSDictionary *_choices;
  BOOL _unfolded;
  NSView *_room;
  NSTextField *_name, *_about;
  NSButton *_start, *_new;
  NSStackView *_column;
  NSString *_chosen;
  MVNewDevice *_asking;
}

- (instancetype)initWithShow:(MVShow)how poses:(BOOL)poses {
  if ((self = [super init])) {
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
    _window = [[MVOffscreenWindow alloc] initWithContentRect:NSMakeRect(120, 120, kOpens.width, kOpens.height) styleMask:style backing:NSBackingStoreBuffered defer:NO];
    _window.title = @"Devices";
    _window.releasedWhenClosed = NO;
    _window.delegate = self;
    _window.poses = poses;
    _window.titlebarAppearsTransparent = YES;
    _window.contentMinSize = NSMakeSize(760, 520);
    _window.offscreen = how == MVShowBehind;
    if (how != MVShowBehind) _window.frameAutosaveName = @"hub";
    NSViewController *side = [NSViewController new];
    side.view = [self sidebarView];
    NSViewController *main = [NSViewController new];
    main.view = [self roomView];
    NSSplitViewController *split = [NSSplitViewController new];
    NSSplitViewItem *sidebar = [NSSplitViewItem sidebarWithViewController:side];
    sidebar.minimumThickness = kSidebar;
    sidebar.maximumThickness = kSidebar + 80;
    [split addSplitViewItem:sidebar];
    NSSplitViewItem *content = [NSSplitViewItem splitViewItemWithViewController:main];
    // the device's room runs on under the sidebar, whose glass needs something to bend
    if ([content respondsToSelector:NSSelectorFromString(@"setAutomaticallyAdjustsSafeAreaInsets:")]) [content setValue:@YES forKey:@"automaticallyAdjustsSafeAreaInsets"];
    [split addSplitViewItem:content];
    _window.contentViewController = split;
    [_window setContentSize:kOpens];
    MVPresent(_window, how);
  }
  return self;
}

- (NSView *)room {
  return _room;
}

- (nullable NSString *)chosen {
  return _chosen;
}

- (NSView *)sidebarView {
  NSView *view = [NSView new];
  _search = [NSSearchField new];
  _search.placeholderString = @"Search";
  _search.delegate = self;
  _new = [NSButton buttonWithImage:[NSImage imageWithSystemSymbolName:@"plus" accessibilityDescription:@"New simulator or emulator"] target:self action:@selector(askNew:)];
  _new.bordered = NO;
  _new.toolTip = @"New simulator or emulator";
  _list = [[MVList alloc] initWithFrame:NSZeroRect];
  [_list useSidebarStyle];
  __weak MVHub *weak = self;
  _list.onSelect = ^(MVRow *row) {
    [weak chose:row];
  };
  NSMenu *rowMenu = [[NSMenu alloc] initWithTitle:@"Device"];
  [rowMenu addItemWithTitle:@"Show Beside This One" action:@selector(besideClicked:) keyEquivalent:@""].target = self;
  [rowMenu addItemWithTitle:@"Open in New Window" action:@selector(openClicked:) keyEquivalent:@""].target = self;
  [rowMenu addItemWithTitle:@"Shut Down" action:@selector(shutDownClicked:) keyEquivalent:@""].target = self;
  _list.rowMenu = rowMenu;
  NSStackView *top = [NSStackView stackViewWithViews:@[_search, _new]];
  top.spacing = 6;
  for (NSView *part in @[top, _list]) {
    part.translatesAutoresizingMaskIntoConstraints = NO;
    [view addSubview:part];
  }
  [NSLayoutConstraint activateConstraints:@[
    [top.topAnchor constraintEqualToAnchor:view.topAnchor constant:kBelowLights],
    [top.leadingAnchor constraintEqualToAnchor:view.leadingAnchor constant:12],
    [top.trailingAnchor constraintEqualToAnchor:view.trailingAnchor constant:-10],
    [_list.topAnchor constraintEqualToAnchor:top.bottomAnchor constant:8],
    [_list.leadingAnchor constraintEqualToAnchor:view.leadingAnchor],
    [_list.trailingAnchor constraintEqualToAnchor:view.trailingAnchor],
    [_list.bottomAnchor constraintEqualToAnchor:view.bottomAnchor],
  ]];
  return view;
}

/// Where the device chosen stands, and, where none can, what to do next.
- (NSView *)roomView {
  _room = [MVRoomView new];
  _room.wantsLayer = YES;
  _name = label(22, NSFontWeightSemibold, NSColor.labelColor);
  _about = label(13, NSFontWeightRegular, NSColor.secondaryLabelColor);
  _start = [NSButton buttonWithTitle:@"Start" target:self action:@selector(togglePower:)];
  _start.controlSize = NSControlSizeLarge;
  _start.keyEquivalent = @"\r";
  _column = [NSStackView stackViewWithViews:@[_name, _about, _start]];
  _column.orientation = NSUserInterfaceLayoutOrientationVertical;
  _column.spacing = 6;
  [_column setCustomSpacing:18 afterView:_about];
  _column.translatesAutoresizingMaskIntoConstraints = NO;
  [_room addSubview:_column];
  [NSLayoutConstraint activateConstraints:@[
    [_column.centerXAnchor constraintEqualToAnchor:_room.centerXAnchor],
    [_column.centerYAnchor constraintEqualToAnchor:_room.centerYAnchor],
  ]];
  return _room;
}

- (void)askNew:(NSButton *)sender {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"New"];
  [menu addItemWithTitle:@"New Simulator…" action:@selector(newSimulator:) keyEquivalent:@""].target = self;
  [menu addItemWithTitle:@"New Emulator…" action:@selector(newEmulator:) keyEquivalent:@""].target = self;
  [menu popUpMenuPositioningItem:nil atLocation:NSMakePoint(0, sender.bounds.size.height + 6) inView:sender];
}

- (void)ask:(NSString *)kind {
  NSDictionary *choices = _choices[kind];
  if (!choices) return;
  _asking = [MVNewDevice new];
  [_asking askIn:_window kind:kind choices:choices];
}

- (void)newSimulator:(id)sender {
  [self ask:@"simulator"];
}

- (void)newEmulator:(id)sender {
  [self ask:@"emulator"];
}

- (void)controlTextDidChange:(NSNotification *)notification {
  [self listDevices];
}

static BOOL matches(NSDictionary *device, NSString *words) {
  if (!words.length) return YES;
  NSString *all = [NSString stringWithFormat:@"%@ %@", device[@"name"] ?: @"", device[@"detail"] ?: @""];
  return [all rangeOfString:words options:NSCaseInsensitiveSearch].location != NSNotFound;
}

/// A simulator's name, and the system it holds, which it carries in brackets.
static NSArray<NSString *> *namedParts(NSString *name) {
  NSRange open = [name rangeOfString:@" (" options:NSBackwardsSearch];
  if (open.location == NSNotFound || ![name hasSuffix:@")"]) return @[name, @""];
  NSString *inside = [name substringWithRange:NSMakeRange(NSMaxRange(open), name.length - NSMaxRange(open) - 1)];
  BOOL system = [inside hasPrefix:@"iOS"] || [inside hasPrefix:@"Android"];
  return system ? @[[name substringToIndex:open.location], inside] : @[name, @""];
}

static MVRow *rowOf(NSDictionary *device) {
  MVRow *row = [MVRow new];
  NSArray<NSString *> *parts = namedParts(device[@"name"] ?: @"");
  row.title = parts[0];
  row.detail = [parts[1] length] && [device[@"detail"] length] ? [NSString stringWithFormat:@"%@  ·  %@", device[@"detail"], parts[1]] : [device[@"detail"] length] ? device[@"detail"] : parts[1];
  row.symbol = symbolOf(device);
  row.tint = NSColor.secondaryLabelColor;
  row.dot = stateColor(device);
  row.key = device[@"id"];
  return row;
}

/// Phones first, then what runs, and what is shut down folded away: a person's Mac may have a hundred of them.
- (void)listDevices {
  NSString *words = _search.stringValue;
  NSMutableArray<MVRow *> *phones = [NSMutableArray array], *running = [NSMutableArray array], *off = [NSMutableArray array];
  for (NSDictionary *device in _devices) {
    if (!matches(device, words)) continue;
    BOOL phone = [device[@"kind"] isEqual:@"phone"], up = [device[@"state"] isEqual:@"running"];
    [phone ? phones : up ? running : off addObject:rowOf(device)];
  }
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  if (phones.count) [rows addObject:[MVRow headerNamed:@"Phones"]];
  [rows addObjectsFromArray:phones];
  if (running.count) [rows addObject:[MVRow headerNamed:@"Running"]];
  [rows addObjectsFromArray:running];
  if (off.count) {
    BOOL open = _unfolded || words.length;
    MVRow *fold = [MVRow headerNamed:[NSString stringWithFormat:@"%@ Shut Down (%lu)", open ? @"▾" : @"▸", (unsigned long)off.count]];
    fold.key = kFold;
    [rows addObject:fold];
    if (open) [rows addObjectsFromArray:off];
  }
  _list.rows = rows;
  [_list selectKey:_shown[@"id"]];
}

- (void)show:(NSDictionary *)message {
  _devices = [message[@"devices"] isKindOfClass:NSArray.class] ? message[@"devices"] : @[];
  if (message[@"choices"]) _choices = message[@"choices"];
  NSDictionary *kept = nil, *first = nil;
  for (NSDictionary *device in _devices) {
    // a window that came back after a crash goes on with what stood in it
    if ([device[@"id"] isEqual:_shown[@"id"]] || (!_shown && [(device[@"serial"] ?: device[@"id"]) isEqual:message[@"showing"]])) kept = device;
    // a phone is a person's: it is touched only when they choose it
    if (!first && [device[@"state"] isEqual:@"running"] && ![device[@"kind"] isEqual:@"phone"]) first = device;
  }
  [self showDevice:kept ?: first];
  [self listDevices];
}

- (void)chose:(nullable MVRow *)row {
  if ([row.key isEqual:kFold]) {
    _unfolded = !_unfolded;
    return [self listDevices];
  }
  [self choose:row.key];
}

- (void)choose:(nullable NSString *)key {
  for (NSDictionary *device in _devices)
    if ([device[@"id"] isEqual:key]) [self showDevice:device];
}

/// The parent is told once, as it opens and closes a stream by this.
- (void)tellChosen:(nullable NSString *)serial {
  if (_chosen == serial || [_chosen isEqual:serial]) return;
  _chosen = serial;
  MVEmit(serial ? @{@"op": @"hub", @"action": @"select", @"serial": serial} : @{@"op": @"hub", @"action": @"select"});
}

- (void)showDevice:(nullable NSDictionary *)device {
  _shown = device;
  [_list selectKey:device[@"id"]];
  BOOL running = [device[@"state"] isEqual:@"running"], elsewhere = [device[@"mirrored"] boolValue];
  [self tellChosen:running && !elsewhere ? device[@"serial"] ?: device[@"id"] : nil];
  _name.stringValue = device ? namedParts(device[@"name"] ?: @"")[0] : _devices.count ? @"Choose a device" : @"No device yet";
  _about.stringValue = device ? (elsewhere ? @"In a window of its own" : stateWords(device)) : _devices.count ? @"A phone starts only when you choose it." : @"Connect a phone with its cable, or make a simulator with +.";
  _start.title = elsewhere ? @"Close That Window" : @"Start";
  _start.hidden = !device || (running && !elsewhere) || [device[@"kind"] isEqual:@"phone"];
}

- (void)togglePower:(id)sender {
  if (!_shown) return;
  if ([_shown[@"mirrored"] boolValue]) return MVEmit(@{@"op": @"hub", @"action": @"close", @"serial": _shown[@"serial"] ?: _shown[@"id"]});
  MVEmit(@{@"op": @"hub", @"action": [_shown[@"state"] isEqual:@"running"] ? @"stop" : @"start", @"id": _shown[@"id"]});
}

- (nullable NSDictionary *)deviceKeyed:(nullable NSString *)key {
  for (NSDictionary *device in _devices)
    if ([device[@"id"] isEqual:key]) return device;
  return nil;
}

/// The row a person's secondary click is on, beside the device shown.
- (void)besideClicked:(id)sender {
  [self pairWith:[self deviceKeyed:_list.clickedKey]];
}

/// A phone is a person's to turn off.
- (void)shutDownClicked:(id)sender {
  NSDictionary *device = [self deviceKeyed:_list.clickedKey];
  if (![device[@"kind"] isEqual:@"phone"] && [device[@"state"] isEqual:@"running"]) MVEmit(@{@"op": @"hub", @"action": @"stop", @"id": device[@"id"]});
}

- (void)openClicked:(id)sender {
  [self choose:_list.clickedKey];
  [self openWindow:sender];
}

- (void)openWindow:(id)sender {
  if (!_shown) return;
  MVEmit(@{@"op": @"hub", @"action": [_shown[@"mirrored"] boolValue] ? @"close" : @"open", @"id": _shown[@"id"], @"serial": _shown[@"serial"] ?: _shown[@"id"]});
}

/// What is up to stand beside the device shown.
- (NSArray<NSDictionary *> *)others {
  NSMutableArray *others = [NSMutableArray array];
  for (NSDictionary *device in _devices)
    if ([device[@"state"] isEqual:@"running"] && ![device[@"id"] isEqual:_shown[@"id"]]) [others addObject:device];
  return others;
}

- (void)pairWith:(nullable NSDictionary *)device {
  if (!_shown || !device) return;
  MVEmit(@{@"op": @"hub", @"action": @"pair", @"serial": _shown[@"serial"] ?: _shown[@"id"], @"with": device[@"serial"] ?: device[@"id"]});
}

- (void)poke:(NSDictionary *)message {
  if (message[@"ask"]) return [self ask:message[@"ask"]];
  if ([message[@"press"] isEqual:@"create"]) {
    [_asking setName:message[@"name"] ?: @""];
    return [_asking create:self];
  }
  [self choose:message[@"id"]];
  if ([message[@"press"] isEqual:@"window"]) [self openWindow:self];
  if ([message[@"press"] isEqual:@"power"]) [self togglePower:self];
  if ([message[@"press"] isEqual:@"beside"]) [self pairWith:[self others].firstObject];
}

- (void)sayNote:(NSString *)note {
  _about.stringValue = note;
}

- (BOOL)snapshot:(NSString *)file {
  return MVWriteWindow(_window.attachedSheet ?: _window, file);
}

- (void)windowWillClose:(NSNotification *)notification {
  MVEmit(@{@"op": @"closed"});
  exit(0);
}

@end
