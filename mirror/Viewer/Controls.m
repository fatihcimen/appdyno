// Every control of a window, once: its name, its words, its symbol and its shortcut. The menus and the toolbar
// are both made from this table, so that a control cannot be in one and missing from the other.
#import "Window.h"

static const NSEventModifierFlags kCmd = NSEventModifierFlagCommand, kShift = NSEventModifierFlagShift, kOpt = NSEventModifierFlagOption, kCtl = NSEventModifierFlagControl;

typedef struct {
  const char *name, *title, *symbol;
  unichar key;
  NSEventModifierFlags mods;
  const char *menu;
} MVControlRow;

static const MVControlRow kControls[] = {
    {"screenshot", "Save Screenshot", "camera", 's', kCmd, "File"},
    {"copy", "Copy Screen", "doc.on.doc", 'c', kCmd, "File"},
    {"record", "Record Screen", "record.circle", 'r', kCmd | kOpt, "File"},
    {"paste", "Paste", "doc.on.clipboard", 'v', kCmd, "Edit"},
    {"zoomFit", "Zoom to Fit", "arrow.up.left.and.down.right.magnifyingglass", '9', kCmd, "View"},
    {"zoomActual", "Actual Size", "1.magnifyingglass", '0', kCmd, "View"},
    {"zoomIn", "Zoom In", "plus.magnifyingglass", '=', kCmd, "View"},
    {"zoomOut", "Zoom Out", "minus.magnifyingglass", '-', kCmd, "View"},
    {"frame", "Show Device Frame", "iphone", 'f', kCmd | kOpt, "View"},
    {"inspector", "Show Inspector", "sidebar.trailing", 'i', kCmd | kOpt, "View"},
    {"reconnect", "Reconnect", "arrow.clockwise", 'r', kCmd | kShift, "View"},
    {"back", "Back", "chevron.backward", '[', kCmd, "Device"},
    {"home", "Home", "house", 'h', kCmd | kShift, "Device"},
    {"appSwitch", "App Switcher", "square.stack", 'a', kCmd | kShift, "Device"},
    {"lock", "Lock", "lock", 'l', kCmd, "Device"},
    {"volumeUp", "Volume Up", "speaker.plus", NSUpArrowFunctionKey, kCmd, "Device"},
    {"volumeDown", "Volume Down", "speaker.minus", NSDownArrowFunctionKey, kCmd, "Device"},
    {"siri", "Siri", "mic", 'k', kCmd | kShift, "Device"},
    {"controlCenter", "Control Center", "switch.2", 'c', kCmd | kCtl, "Device"},
    {"quickSettings", "Quick Settings", "switch.2", 'c', kCmd | kCtl, "Device"},
    {"notifications", "Notifications", "bell", 'n', kCmd | kCtl, "Device"},
    {"spotlight", "Spotlight", "magnifyingglass", 'f', kCmd | kCtl, "Device"},
    {"rotateLeft", "Rotate Left", "rotate.left", NSLeftArrowFunctionKey, kCmd, "Device"},
    {"rotateRight", "Rotate Right", "rotate.right", NSRightArrowFunctionKey, kCmd, "Device"},
};

static const MVControlRow *rowNamed(NSString *name) {
  for (size_t i = 0; i < sizeof kControls / sizeof kControls[0]; i++)
    if ([name isEqual:@(kControls[i].name)]) return &kControls[i];
  return NULL;
}

NSString *MVControlTitle(NSString *name) {
  const MVControlRow *row = rowNamed(name);
  return row ? @(row->title) : name;
}

NSImage *MVControlImage(NSString *name) {
  const MVControlRow *row = rowNamed(name);
  return row ? [NSImage imageWithSystemSymbolName:@(row->symbol) accessibilityDescription:@(row->title)] : nil;
}

static NSMenuItem *itemFor(const MVControlRow *row) {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:@(row->title) action:@selector(control:) keyEquivalent:[NSString stringWithCharacters:&row->key length:1]];
  item.keyEquivalentModifierMask = row->mods;
  item.representedObject = @(row->name);
  return item;
}

NSMenu *MVControlMenu(NSString *title, NSArray<NSString *> *_Nullable names) {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
  for (size_t i = 0; i < sizeof kControls / sizeof kControls[0]; i++) {
    const MVControlRow *row = &kControls[i];
    if (![title isEqual:@(row->menu)] || (names && ![names containsObject:@(row->name)])) continue;
    [menu addItem:itemFor(row)];
  }
  return menu;
}

static NSMenuItem *menuOf(NSMenu *bar, NSString *title, NSMenu *menu) {
  NSMenuItem *item = [bar addItemWithTitle:title action:NULL keyEquivalent:@""];
  menu.title = title;
  item.submenu = menu;
  return item;
}

NSMenu *MVMainMenu(NSArray<NSString *> *_Nullable names) {
  NSMenu *bar = [NSMenu new];
  NSMenu *appMenu = [NSMenu new];
  [appMenu addItemWithTitle:@"Hide appdyno" action:@selector(hide:) keyEquivalent:@"h"];
  [appMenu addItem:NSMenuItem.separatorItem];
  [appMenu addItemWithTitle:@"Quit appdyno" action:@selector(terminate:) keyEquivalent:@"q"];
  menuOf(bar, @"appdyno", appMenu);
  NSMenu *file = MVControlMenu(@"File", nil);
  [file addItem:NSMenuItem.separatorItem];
  [file addItemWithTitle:@"Close" action:@selector(performClose:) keyEquivalent:@"w"];
  menuOf(bar, @"File", file);
  menuOf(bar, @"Edit", MVControlMenu(@"Edit", nil));
  menuOf(bar, @"View", MVControlMenu(@"View", nil));
  menuOf(bar, @"Device", MVControlMenu(@"Device", names));
  NSMenu *window = [NSMenu new];
  [window addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
  [window addItemWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""];
  menuOf(bar, @"Window", window);
  NSApp.windowsMenu = window;
  return bar;
}

// the order a toolbar has; a kind's own list says which of them it shows
static NSArray<NSString *> *toolbarOrder(void) {
  return @[@"back", @"home", @"appSwitch", NSToolbarSpaceItemIdentifier, @"lock", @"volumeUp", @"volumeDown", @"siri", @"controlCenter", @"quickSettings", NSToolbarFlexibleSpaceItemIdentifier, @"rotate", @"screenshot", @"record", @"zoom", @"inspector"];
}

@implementation MVToolbar {
  NSArray<NSString *> *_names;
  __weak id _target;
}

- (instancetype)initWithControls:(NSArray<NSString *> *)names target:(id)target {
  if ((self = [super init])) {
    _names = names;
    _target = target;
  }
  return self;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  NSMutableArray *shown = [NSMutableArray array];
  for (NSString *name in toolbarOrder())
    if ([name hasPrefix:@"NS"] || [@[@"rotate", @"zoom", @"inspector", @"screenshot", @"record"] containsObject:name] || [_names containsObject:name]) [shown addObject:name];
  return shown;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return [self toolbarDefaultItemIdentifiers:toolbar];
}

- (nullable NSToolbarItem *)toolbar:(NSToolbar *)toolbar itemForItemIdentifier:(NSToolbarItemIdentifier)name willBeInsertedIntoToolbar:(BOOL)flag {
  if ([name isEqual:@"zoom"]) return [self menuItem:name title:@"Zoom" symbol:@"plus.magnifyingglass" of:@[@"zoomFit", @"zoomActual", @"zoomIn", @"zoomOut"]];
  if ([name isEqual:@"rotate"]) return [self menuItem:name title:@"Rotate" symbol:@"rotate.right" of:@[@"rotateLeft", @"rotateRight"]];
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:name];
  item.label = MVControlTitle(name);
  item.paletteLabel = item.label;
  item.toolTip = item.label;
  item.image = MVControlImage(name);
  item.bordered = YES;
  item.target = _target;
  item.action = @selector(control:);
  return item;
}

- (NSToolbarItem *)menuItem:(NSString *)name title:(NSString *)title symbol:(NSString *)symbol of:(NSArray<NSString *> *)names {
  NSMenuToolbarItem *item = [[NSMenuToolbarItem alloc] initWithItemIdentifier:name];
  item.label = title;
  item.paletteLabel = title;
  item.toolTip = title;
  item.image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:title];
  item.showsIndicator = NO;
  NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
  for (NSString *entry in names) [menu addItem:itemFor(rowNamed(entry))];
  for (NSMenuItem *entry in menu.itemArray) entry.target = _target;
  item.menu = menu;
  return item;
}

@end
