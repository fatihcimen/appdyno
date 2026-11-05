// The hub: every device this Mac can reach, in a sidebar, each with its state. It holds no stream and no device:
// what a person asks goes to its parent as a message, and a window it opens is a viewer of its own, in a process of
// its own, so that a crash costs one window and closing the hub costs none.
#import "Window.h"

static const NSSize kOpens = {820, 560};
static const double kSidebar = 250;
// a device with no picture yet is drawn at a shape of its kind
static const CGSize kPhoneShape = {1206, 2622}, kTabletShape = {1668, 2420};
static const double kPreviewHeight = 300;

static NSColor *stateColor(NSDictionary *device) {
  if ([device[@"mirrored"] boolValue]) return NSColor.systemGreenColor;
  return [device[@"state"] isEqual:@"running"] ? NSColor.systemBlueColor : NSColor.tertiaryLabelColor;
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

/// The sheet that makes a new simulator or emulator, from what the parent says can be made.
@interface MVNewDevice : NSObject
- (void)askIn:(NSWindow *)window kind:(NSString *)kind choices:(NSDictionary *)choices;
- (void)create:(nullable id)sender;
- (void)setName:(NSString *)name;
@end

@implementation MVNewDevice {
  NSPanel *_sheet;
  NSTextField *_name;
  NSPopUpButton *_model, *_os;
  NSArray<NSDictionary *> *_models, *_systems;
  NSString *_kind;
  __weak NSWindow *_owner;
}

static NSPopUpButton *popUp(NSArray<NSDictionary *> *rows) {
  NSPopUpButton *button = [NSPopUpButton new];
  for (NSDictionary *row in rows) [button addItemWithTitle:row[@"name"]];
  return button;
}

- (void)askIn:(NSWindow *)window kind:(NSString *)kind choices:(NSDictionary *)choices {
  _kind = kind;
  _owner = window;
  _models = choices[@"models"] ?: @[];
  _systems = choices[@"systems"] ?: @[];
  _name = [NSTextField textFieldWithString:@""];
  _name.placeholderString = [kind isEqual:@"simulator"] ? @"The model's name" : @"appdyno_emulator";
  _model = popUp(_models);
  _os = popUp(_systems);
  // the newest comes last, and is the one a newest model runs on
  [_os selectItemAtIndex:_systems.count - 1];
  NSTextField *(^caption)(NSString *) = ^(NSString *text) {
    return [NSTextField labelWithString:text];
  };
  NSGridView *grid = [NSGridView gridViewWithViews:@[@[caption(@"Name"), _name], @[caption(@"Model"), _model], @[caption([kind isEqual:@"simulator"] ? @"iOS" : @"Android"), _os]]];
  grid.rowSpacing = 10;
  [grid columnAtIndex:0].xPlacement = NSGridCellPlacementTrailing;
  NSButton *cancel = [NSButton buttonWithTitle:@"Cancel" target:self action:@selector(cancel:)];
  cancel.keyEquivalent = @"\e";
  NSButton *create = [NSButton buttonWithTitle:@"Create" target:self action:@selector(create:)];
  create.keyEquivalent = @"\r";
  NSStackView *buttons = [NSStackView stackViewWithViews:@[cancel, create]];
  NSTextField *title = [NSTextField labelWithString:[kind isEqual:@"simulator"] ? @"New Simulator" : @"New Emulator"];
  title.font = [NSFont systemFontOfSize:15 weight:NSFontWeightSemibold];
  NSStackView *stack = [NSStackView stackViewWithViews:@[title, grid, buttons]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 16;
  stack.edgeInsets = NSEdgeInsetsMake(20, 20, 20, 20);
  [buttons.trailingAnchor constraintEqualToAnchor:grid.trailingAnchor].active = YES;
  [_name.widthAnchor constraintEqualToConstant:260].active = YES;
  _sheet = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 380, 220) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  _sheet.contentView = stack;
  [window beginSheet:_sheet completionHandler:nil];
}

- (void)setName:(NSString *)name {
  _name.stringValue = name;
}

- (void)cancel:(id)sender {
  [_owner endSheet:_sheet];
}

- (void)create:(id)sender {
  if (_model.indexOfSelectedItem < 0 || _os.indexOfSelectedItem < 0) return;
  MVEmit(@{@"op": @"hub", @"action": @"new", @"kind": _kind, @"name": _name.stringValue, @"model": _models[_model.indexOfSelectedItem][@"id"], @"system": _systems[_os.indexOfSelectedItem][@"id"]});
  [_owner endSheet:_sheet];
}

@end

@implementation MVHub {
  MVOffscreenWindow *_window;
  MVList *_list;
  NSDictionary *_shown;
  NSArray<NSDictionary *> *_devices;
  NSDictionary *_choices;
  NSView *_detail;
  MVFrameView *_frame;
  MVView *_screen;
  NSTextField *_name, *_about, *_empty;
  NSButton *_open, *_power;
  NSStackView *_column;
  MVNewDevice *_asking;
}

- (instancetype)initWithShow:(MVShow)how poses:(BOOL)poses {
  if ((self = [super init])) {
    _window = [[MVOffscreenWindow alloc] initWithContentRect:NSMakeRect(120, 120, kOpens.width, kOpens.height) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView backing:NSBackingStoreBuffered defer:NO];
    _window.title = @"Devices";
    _window.releasedWhenClosed = NO;
    _window.delegate = self;
    _window.poses = poses;
    _window.contentMinSize = NSMakeSize(640, 420);
    if (how != MVShowBehind) _window.frameAutosaveName = @"hub";
    _list = [[MVList alloc] initWithFrame:NSZeroRect];
    [_list useSidebarStyle];
    __weak MVHub *weak = self;
    _list.onSelect = ^(MVRow *row) {
      [weak choose:row.key];
    };
    NSViewController *side = [NSViewController new];
    side.view = _list;
    _detail = [self detailView];
    NSViewController *main = [NSViewController new];
    main.view = _detail;
    NSSplitViewController *split = [NSSplitViewController new];
    NSSplitViewItem *sidebar = [NSSplitViewItem sidebarWithViewController:side];
    sidebar.minimumThickness = kSidebar;
    sidebar.maximumThickness = kSidebar + 80;
    [split addSplitViewItem:sidebar];
    [split addSplitViewItem:[NSSplitViewItem contentListWithViewController:main]];
    _window.contentViewController = split;
    [_window setContentSize:kOpens];
    NSToolbar *toolbar = [[NSToolbar alloc] initWithIdentifier:@"hub"];
    toolbar.delegate = self;
    toolbar.displayMode = NSToolbarDisplayModeIconOnly;
    _window.toolbar = toolbar;
    _window.toolbarStyle = NSWindowToolbarStyleUnified;
    MVPresent(_window, how);
  }
  return self;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  return @[NSToolbarFlexibleSpaceItemIdentifier, @"new"];
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return [self toolbarDefaultItemIdentifiers:toolbar];
}

- (nullable NSToolbarItem *)toolbar:(NSToolbar *)toolbar itemForItemIdentifier:(NSToolbarItemIdentifier)name willBeInsertedIntoToolbar:(BOOL)flag {
  NSMenuToolbarItem *item = [[NSMenuToolbarItem alloc] initWithItemIdentifier:name];
  item.label = @"New Device";
  item.toolTip = @"New simulator or emulator";
  item.image = [NSImage imageWithSystemSymbolName:@"plus" accessibilityDescription:@"New simulator or emulator"];
  item.showsIndicator = NO;
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"New"];
  [menu addItemWithTitle:@"New Simulator…" action:@selector(newSimulator:) keyEquivalent:@""].target = self;
  [menu addItemWithTitle:@"New Emulator…" action:@selector(newEmulator:) keyEquivalent:@""].target = self;
  item.menu = menu;
  return item;
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

- (NSView *)detailView {
  NSView *view = [NSView new];
  _frame = [[MVFrameView alloc] initWithFrame:NSZeroRect];
  _screen = [[MVView alloc] initWithFrame:NSZeroRect];
  _screen.wantsLayer = YES;
  _screen.layer.backgroundColor = NSColor.blackColor.CGColor;
  _frame.screen = _screen;
  _frame.showsFrame = YES;
  [view addSubview:_frame];
  [_frame addSubview:_screen];
  _name = label(20, NSFontWeightSemibold, NSColor.labelColor);
  _about = label(12, NSFontWeightRegular, NSColor.secondaryLabelColor);
  _open = [NSButton buttonWithTitle:@"Open Window" target:self action:@selector(openWindow:)];
  _open.controlSize = NSControlSizeLarge;
  _open.keyEquivalent = @"\r";
  _power = [NSButton buttonWithTitle:@"Start" target:self action:@selector(togglePower:)];
  _power.controlSize = NSControlSizeLarge;
  NSStackView *buttons = [NSStackView stackViewWithViews:@[_open, _power]];
  _column = [NSStackView stackViewWithViews:@[_name, _about, buttons]];
  _column.orientation = NSUserInterfaceLayoutOrientationVertical;
  _column.spacing = 6;
  [_column setCustomSpacing:18 afterView:_about];
  _column.translatesAutoresizingMaskIntoConstraints = NO;
  _empty = label(13, NSFontWeightRegular, NSColor.secondaryLabelColor);
  _empty.stringValue = @"No device yet. Connect one, or make one with +.";
  _empty.translatesAutoresizingMaskIntoConstraints = NO;
  [view addSubview:_column];
  [view addSubview:_empty];
  [NSLayoutConstraint activateConstraints:@[
    [_column.centerXAnchor constraintEqualToAnchor:view.centerXAnchor],
    [_column.bottomAnchor constraintEqualToAnchor:view.bottomAnchor constant:-32],
    [_empty.centerXAnchor constraintEqualToAnchor:view.centerXAnchor],
    [_empty.centerYAnchor constraintEqualToAnchor:view.centerYAnchor],
  ]];
  return view;
}

- (void)show:(NSDictionary *)message {
  _devices = [message[@"devices"] isKindOfClass:NSArray.class] ? message[@"devices"] : @[];
  if (message[@"choices"]) _choices = message[@"choices"];
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  for (NSArray<NSString *> *section in @[@[@"phone", @"Phones"], @[@"simulator", @"Simulators"], @[@"emulator", @"Emulators"]]) {
    BOOL headed = NO;
    for (NSDictionary *device in _devices) {
      if (![device[@"kind"] isEqual:section[0]]) continue;
      if (!headed) [rows addObject:[MVRow headerNamed:section[1]]];
      headed = YES;
      MVRow *row = [MVRow new];
      row.title = device[@"name"] ?: @"";
      row.detail = [NSString stringWithFormat:@"%@%@", stateWords(device), [device[@"detail"] length] ? [@"  ·  " stringByAppendingString:device[@"detail"]] : @""];
      row.symbol = symbolOf(device);
      row.tint = stateColor(device);
      row.key = device[@"id"];
      [rows addObject:row];
    }
  }
  _list.rows = rows;
  NSString *keep = _shown[@"id"];
  NSDictionary *first = nil;
  for (NSDictionary *device in _devices) {
    if ([device[@"id"] isEqual:keep]) first = device;
  }
  [self showDevice:first ?: _devices.firstObject];
}

- (void)choose:(nullable NSString *)key {
  for (NSDictionary *device in _devices)
    if ([device[@"id"] isEqual:key]) [self showDevice:device];
}

- (void)showDevice:(nullable NSDictionary *)device {
  _shown = device;
  _column.hidden = _frame.hidden = !device;
  _empty.hidden = device != nil;
  if (!device) return;
  BOOL tablet = [device[@"model"] hasPrefix:@"iPad"];
  CGSize shape = tablet ? kTabletShape : kPhoneShape;
  _frame.spec = MVFrameSpecOf(device[@"model"], device[@"platform"], device[@"color"], shape);
  double scale = kPreviewHeight / shape.height;
  CGSize screen = CGSizeMake(shape.width * scale, shape.height * scale);
  CGSize body = [_frame bodyFor:screen turns:0];
  NSSize room = _detail.bounds.size;
  [_frame layOutScreen:screen in:NSMakeRect(round((room.width - body.width) / 2), room.height - body.height - 56, body.width, body.height) turns:0];
  BOOL mirrored = [device[@"mirrored"] boolValue], running = [device[@"state"] isEqual:@"running"];
  _name.stringValue = device[@"name"] ?: @"";
  _about.stringValue = [@[stateWords(device), device[@"detail"] ?: @""] componentsJoinedByString:@"  ·  "];
  _open.title = mirrored ? @"Close Window" : @"Open Window";
  _open.enabled = running;
  _power.title = running ? @"Stop" : @"Start";
  // a phone is a person's to turn off
  _power.hidden = [device[@"kind"] isEqual:@"phone"];
}

- (void)windowDidResize:(NSNotification *)notification {
  [self showDevice:_shown];
}

- (void)openWindow:(id)sender {
  if (!_shown) return;
  MVEmit(@{@"op": @"hub", @"action": [_shown[@"mirrored"] boolValue] ? @"close" : @"open", @"id": _shown[@"id"], @"serial": _shown[@"serial"] ?: _shown[@"id"]});
}

- (void)togglePower:(id)sender {
  if (!_shown) return;
  MVEmit(@{@"op": @"hub", @"action": [_shown[@"state"] isEqual:@"running"] ? @"stop" : @"start", @"id": _shown[@"id"]});
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
}

- (void)sayNote:(NSString *)note {
  _about.stringValue = note;
}

- (BOOL)snapshot:(NSString *)file {
  return MVWriteWindow(_window, file);
}

- (void)windowWillClose:(NSNotification *)notification {
  MVEmit(@{@"op": @"closed"});
  exit(0);
}

@end
