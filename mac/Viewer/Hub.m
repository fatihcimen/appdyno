// The hub: every device this Mac can reach in a sidebar, and the one chosen, live, in its room. A stage stands there by
// the same code as in a window of its own; what a person asks goes to the parent as a message.
#import "HubParts.h"
#import "Window.h"
#import "Words.h"

static const NSSize kOpens = {1240, 820};
// under the first a window gives up its Inspector, and under the second its sidebar
static const double kInspectorFrom = 1100, kSidebarFrom = 860;
static const double kContentLeast = 520;
static const double kWordsWide = 320;
static const double kSidebar = 260;
// a window's three buttons stand above the sidebar's first line
static const double kBelowLights = 46;
static const double kNoteGap = 10;

static NSString *stateWords(NSDictionary *device) {
  if ([device[@"mirrored"] boolValue]) return @"Window open";
  return [device[@"state"] isEqual:@"running"] ? @"Running" : @"Shut down";
}

@implementation MVPlace
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
  // a device's stage comes a moment after the sentence that speaks of it
  if (self.note && subview != self.note) [self addSubview:self.note positioned:NSWindowAbove relativeTo:nil];
}

- (void)willRemoveSubview:(NSView *)subview {
  self.needsLayout = YES;
}

- (NSInteger)sideOf:(NSView *)stage {
  NSArray<NSView *> *stages = self.stages;
  return stages.count > 1 ? (NSInteger)MIN([stages indexOfObject:stage], 1) : -1;
}

- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  [self.backdrop repaint];
}

- (void)layout {
  [super layout];
  NSArray<NSView *> *stages = self.stages;
  // what the room says of itself stands only while nothing else does
  for (NSView *view in self.subviews)
    view.hidden = self.place ? view != self.place : view != self.note && ![stages containsObject:view] && stages.count > 0;
  // the room runs on under the sidebar and the Inspector, and the end stages take that too, for their backdrops
  NSEdgeInsets under = self.safeAreaInsets;
  double all = self.bounds.size.width, wide = (all - under.left - under.right) / MAX(stages.count, 1);
  self.place.frame = NSMakeRect(under.left, 0, all - under.left - under.right, self.bounds.size.height);
  // a band of its own: what is said never lies on the device
  NSSize note = self.note.fittingSize;
  double band = self.note ? under.top + note.height + 2 * kNoteGap : 0;
  self.note.frame = NSMakeRect(under.left + (all - under.left - under.right - note.width) / 2, self.bounds.size.height - under.top - note.height - kNoteGap, note.width, note.height);
  [stages enumerateObjectsUsingBlock:^(NSView *stage, NSUInteger i, BOOL *stop) {
    double left = i == 0 ? 0 : under.left + i * wide, right = i + 1 == stages.count ? all : under.left + (i + 1) * wide;
    stage.frame = NSMakeRect(left, 0, right - left, self.bounds.size.height - band);
  }];
}
@end

@implementation MVHub

- (instancetype)initWithShow:(MVShow)how poses:(BOOL)poses {
  if ((self = [super init])) {
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
    _window = [[MVOffscreenWindow alloc] initWithContentRect:NSMakeRect(120, 120, kOpens.width, kOpens.height) styleMask:style backing:NSBackingStoreBuffered defer:NO];
    _window.title = @"Devices";
    _window.releasedWhenClosed = NO;
    _window.delegate = self;
    _window.poses = poses;
    _window.titlebarAppearsTransparent = YES;
    _window.titleVisibility = NSWindowTitleHidden;
    _window.contentMinSize = NSMakeSize(kContentLeast, 520);
    _window.offscreen = how == MVShowBehind;
    if (how != MVShowBehind) _window.frameAutosaveName = @"hub";
    NSViewController *side = [NSViewController new];
    side.view = [self sidebarView];
    NSViewController *main = [NSViewController new];
    main.view = [self roomView];
    MVInspectorSlot *slot = [MVInspectorSlot new];
    ((MVRoomView *)_room).slot = slot;
    NSSplitViewController *split = [NSSplitViewController new];
    NSSplitViewItem *sidebar = [NSSplitViewItem sidebarWithViewController:side];
    _sidebarItem = sidebar;
    sidebar.minimumThickness = kSidebar;
    sidebar.maximumThickness = kSidebar + 80;
    [split addSplitViewItem:sidebar];
    NSSplitViewItem *content = [NSSplitViewItem splitViewItemWithViewController:main];
    // the device's room runs on under the sidebar, whose glass needs something to bend
    if ([content respondsToSelector:NSSelectorFromString(@"setAutomaticallyAdjustsSafeAreaInsets:")]) [content setValue:@YES forKey:@"automaticallyAdjustsSafeAreaInsets"];
    content.minimumThickness = kContentLeast;
    [split addSplitViewItem:content];
    [split addSplitViewItem:slot.item];
    _window.contentViewController = split;
    [_window setContentSize:kOpens];
    _bare = [[MVToolbar alloc] initWithGroups:@[] target:self action:@selector(barClicked:)];
    MVRoomView *room = (MVRoomView *)_room;
    room.bare = _bare.toolbar;
    __weak MVHub *weak = self;
    room.rowOf = ^(NSString *serial) {
      return [weak rowFor:serial];
    };
    _window.toolbar = room.bare;
    _window.toolbarStyle = NSWindowToolbarStyleUnified;
    [self addOwnPlaces];
    // AppKit's choice is the first field, a caret blinking in Search on a window that has nothing for it yet
    _window.initialFirstResponder = _list.documentView;
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
  _search.placeholderString = MVWord(@"Search");
  _search.delegate = self;
  _new = [MVBarButton buttonWithImage:[NSImage new] target:self action:@selector(askNew:)];
  _new.bordered = NO;
  _new.identifier = @"new";
  _new.toolTip = MVWord(@"New simulator or emulator");
  _new.accessibilityLabel = _new.toolTip;
  MVInk *plus = [[MVInk alloc] initWithSymbol:@"plus" color:MVInkColor() size:16];
  plus.frame = NSMakeRect(0, 0, 24, 24);
  plus.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [_new addSubview:plus];
  [_new.widthAnchor constraintEqualToConstant:24].active = YES;
  [_new.heightAnchor constraintEqualToConstant:24].active = YES;
  _list = [[MVList alloc] initWithFrame:NSZeroRect];
  [_list useSidebarStyle];
  __weak MVHub *weak = self;
  _list.onSelect = ^(MVRow *row) {
    [weak chose:row];
  };
  NSMenu *rowMenu = [[NSMenu alloc] initWithTitle:@"Device"];
  [rowMenu addItemWithTitle:MVWord(@"Show Beside This One") action:@selector(besideClicked:) keyEquivalent:@""].target = self;
  [rowMenu addItemWithTitle:MVWord(@"Open in New Window") action:@selector(openClicked:) keyEquivalent:@""].target = self;
  [rowMenu addItemWithTitle:MVWord(@"Shut Down") action:@selector(shutDownClicked:) keyEquivalent:@""].target = self;
  _list.rowMenu = rowMenu;
  NSStackView *top = [NSStackView stackViewWithViews:@[_search, _new]];
  top.spacing = 6;
  for (NSView *part in @[top, _list]) {
    part.translatesAutoresizingMaskIntoConstraints = NO;
    [view addSubview:part];
  }
  [NSLayoutConstraint activateConstraints:@[
    [top.topAnchor constraintEqualToAnchor:view.topAnchor
                                  constant:kBelowLights],
    [top.leadingAnchor constraintEqualToAnchor:view.leadingAnchor
                                      constant:12],
    [top.trailingAnchor constraintEqualToAnchor:view.trailingAnchor
                                       constant:-10],
    [_list.topAnchor constraintEqualToAnchor:top.bottomAnchor
                                    constant:8],
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
  ((MVRoomView *)_room).backdrop = [[MVBackdrop alloc] initInView:_room window:_window];
  _name = MVText(@"", MVStyleTitle);
  _about = MVWrappedText(@"", MVStyleBody);
  _about.alignment = NSTextAlignmentCenter;
  _about.preferredMaxLayoutWidth = kWordsWide;
  _start = MVPlacePrimary(@"Start", @"start", self, @selector(togglePower:));
  _start.keyEquivalent = @"\r";
  _again = MVPlacePrimary(@"Try Again", @"tryAgain", self, @selector(tryAgain:));
  _again.hidden = YES;
  _mark = [[MVInk alloc] initWithSymbol:@"iphone" color:MVQuietColor() size:32];
  _column = [NSStackView stackViewWithViews:@[_mark, _name, _about, _start, _again]];
  _column.orientation = NSUserInterfaceLayoutOrientationVertical;
  _column.spacing = 6;
  [_column setCustomSpacing:12 afterView:_mark];
  [_column setCustomSpacing:16 afterView:_about];
  _column.translatesAutoresizingMaskIntoConstraints = NO;
  [_room addSubview:_column];
  [NSLayoutConstraint activateConstraints:@[
    [_column.centerXAnchor constraintEqualToAnchor:_room.safeAreaLayoutGuide.centerXAnchor],
    [_column.centerYAnchor constraintEqualToAnchor:_room.safeAreaLayoutGuide.centerYAnchor],
  ]];
  return _room;
}

- (void)askNew:(NSButton *)sender {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"New"];
  [menu addItemWithTitle:MVWord(@"New Simulator…") action:@selector(newSimulator:) keyEquivalent:@""].target = self;
  [menu addItemWithTitle:MVWord(@"New Emulator…") action:@selector(newEmulator:) keyEquivalent:@""].target = self;
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
  // a phone that left stays what is chosen: it says so where it stood, and comes back by itself
  BOOL left = !kept && [_shown[@"kind"] isEqual:@"phone"];
  // a place a person chose stays chosen while the list changes behind it; one that came by itself gives way
  if (!left && (!_placeShown || (_placeByItself && (kept ?: first)))) [self showDevice:kept ?: first];
  _left = left ? _shown : nil;
  _connect.hasDevice = _devices.count > 0;
  [self listDevices];
  [self sayWhatMoved];
  [self openWaiting];
  [self offerConnect];
}

- (void)chose:(nullable MVRow *)row {
  _opening = nil;
  _placeByItself = NO;
  [self leaveNote];
  if ([row.key hasPrefix:MVPlaceKey]) return [self choosePlace:_places[[row.key substringFromIndex:MVPlaceKey.length].integerValue]];
  if ([row.key isEqual:MVFoldKey]) {
    _unfolded = !_unfolded;
    return [self listDevices];
  }
  if ([self deviceKeyed:row.key][@"need"] && [[self deviceKeyed:row.key][@"kind"] isEqual:@"phone"]) return [self choosePlace:_connectPlace];
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
  [self leavePlaceFor:device];
  _shown = device;
  if (device) _lastDevice = device;
  [_list selectKey:device[@"id"]];
  BOOL running = [device[@"state"] isEqual:@"running"], elsewhere = [device[@"mirrored"] boolValue];
  [self tellChosen:running && !elsewhere ? device[@"serial"] ?: device[@"id"] : nil];
  _again.hidden = YES;
  [_mark paint:device ? MVDeviceSymbol(device) : @"iphone.gen3" color:MVQuietColor()];
  _name.stringValue = device ? MVNamedParts(device[@"name"] ?: @"")[0] : @"";
  _about.stringValue = device ? (elsewhere ? @"In a window of its own" : stateWords(device)) : @"";
  _start.title = MVWord(elsewhere ? @"Close That Window" : @"Start");
  if (device) [_bare setName:MVDeviceRow(device).title about:MVDeviceRow(device).detail];
  else [_bare setName:@"appdyno" about:nil];
  _start.hidden = !device || (running && !elsewhere) || [device[@"kind"] isEqual:@"phone"];
}

- (void)togglePower:(id)sender {
  if (!_shown) return;
  if ([_shown[@"mirrored"] boolValue]) return MVEmit(@{@"op": @"hub", @"action": @"close", @"serial": _shown[@"serial"] ?: _shown[@"id"]});
  MVEmit(@{@"op": @"hub", @"action": [_shown[@"state"] isEqual:@"running"] ? @"stop" : @"start", @"id": _shown[@"id"]});
}

/// With no device standing the bar has one control left to answer for.
- (void)barClicked:(NSButton *)sender {
  NSSplitViewItem *item = ((MVRoomView *)_room).slot.item;
  if ([sender.identifier isEqual:@"inspector"]) (MVMoves() ? item.animator : item).collapsed = !item.collapsed;
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
  if (message[@"clickOn"]) return [self pokeClick:message[@"clickOn"]];
  if (message[@"clickRow"]) return [self pokeRow:message[@"clickRow"]];
  if (message[@"board"]) return [self pokeBoard];
  if (message[@"ask"]) return [self ask:message[@"ask"]];
  if (message[@"fill"]) return [_tools chooseApp:message[@"fill"] folder:message[@"folder"] ?: @""];
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

- (void)showStatus:(NSDictionary *)message {
  BOOL stuck = [message[@"state"] isEqual:@"waiting"] || [message[@"state"] isEqual:@"stopped"];
  if ([message[@"title"] length]) _name.stringValue = message[@"title"];
  _about.stringValue = message[@"fix"] ?: @"";
  [_mark paint:MVNeedSymbol(message[@"need"]) color:stuck ? MVOrange() : MVQuietColor()];
  _held = message[@"stage"];
  _again.hidden = !stuck;
  _start.hidden = YES;
}

- (void)tryAgain:(id)sender {
  if (_held) MVEmit(@{@"op": @"control", @"name": @"reconnect", @"stage": _held});
}

- (BOOL)snapshot:(NSString *)file {
  return MVWriteWindow(_window.attachedSheet ?: _window, file);
}

- (void)windowDidResize:(NSNotification *)notification {
  double wide = _window.frame.size.width;
  // a place keeps the Inspector shut, whatever the width says
  if (!_placeShown) [((MVRoomView *)_room).slot fitWindow:wide least:kInspectorFrom];
  MVGiveWay(_sidebarItem, wide < kSidebarFrom, &_sidebarGaveWay);
}

- (NSArray<NSDictionary *> *)parts {
  return MVWindowParts(_window.attachedSheet ?: _window);
}

- (void)windowWillClose:(NSNotification *)notification {
  MVEmit(@{@"op": @"closed"});
  exit(0);
}

@end
