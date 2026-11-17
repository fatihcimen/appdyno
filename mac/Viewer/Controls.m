// Every control of a window, once: its name, its words, its symbol and its shortcut. The menus and the glass bar
// are both made from this table, so that a control cannot be in one and missing from the other.
#import "Settings.h"
#import "Words.h"

static const NSEventModifierFlags kCmd = NSEventModifierFlagCommand, kShift = NSEventModifierFlagShift, kOpt = NSEventModifierFlagOption, kCtl = NSEventModifierFlagControl;

typedef struct {
  const char *name, *title, *symbol;
  unichar key;
  NSEventModifierFlags mods;
  const char *menu;
} MVControlRow;

static const MVControlRow kControls[] = {
    {"screenshot", "Save Screenshot", "camera", 's', kCmd, "Capture"},
    {"copy", "Copy Screen", "doc.on.doc", 'c', kCmd | kShift, "Capture"},
    {"record", "Record Screen", "record.circle", 'r', kCmd | kOpt, "Capture"},
    {"recordFlow", "Record Flow", "hand.tap", 't', kCmd | kOpt, "Capture"},
    {"openLink", "Open Link…", "link", 'o', kCmd, "File"},
    {"push", "Send Push…", "bell.badge", 'p', kCmd | kShift, "File"},
    {"find", "Find in Requests", "magnifyingglass", 'f', kCmd, "Edit"},
    {"zoomFit", "Zoom to Fit", "arrow.up.left.and.down.right.magnifyingglass", '9', kCmd, "View"},
    {"zoomActual", "Actual Size", "1.magnifyingglass", '0', kCmd, "View"},
    {"zoomIn", "Zoom In", "plus.magnifyingglass", '=', kCmd, "View"},
    {"zoomOut", "Zoom Out", "minus.magnifyingglass", '-', kCmd, "View"},
    {"frame", "Show Device Frame", "iphone", 'f', kCmd | kOpt, "View"},
    {"inspector", "Show Inspector", "sidebar.trailing", 'i', kCmd | kOpt, "View"},
    {"hud", "Show Performance", "gauge.with.dots.needle.67percent", 'p', kCmd | kOpt, "View"},
    {"measureLaunch", "Measure Launch", "timer", 0, 0, "View"},
    {"measureScroll", "Measure Scroll", "scroll", 0, 0, "View"},
    {"dashboard", "Open Dashboard", "chart.line.uptrend.xyaxis", 0, 0, "View"},
    {"journey", "Measure Journey…", "point.topleft.down.to.point.bottomright.curvepath", 0, 0, "View"},
    {"both", "Touches Go to Both", "link", 0, 0, "None"},
    {"more", "More Controls", "ellipsis", 0, 0, "None"},
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
    {"shake", "Shake", "iphone.radiowaves.left.and.right", 'z', kCmd | kCtl, "Device"},
};

static const MVControlRow *rowNamed(NSString *name) {
  for (size_t i = 0; i < sizeof kControls / sizeof kControls[0]; i++)
    if ([name isEqual:@(kControls[i].name)]) return &kControls[i];
  return NULL;
}

NSString *MVControlTitle(NSString *name) {
  const MVControlRow *row = rowNamed(name);
  return row ? MVWord(@(row->title)) : name;
}

NSString *MVControlSymbol(NSString *name) {
  const MVControlRow *row = rowNamed(name);
  return row ? @(row->symbol) : @"questionmark";
}

NSImage *MVControlImage(NSString *name) {
  const MVControlRow *row = rowNamed(name);
  return row ? [NSImage imageWithSystemSymbolName:@(row->symbol) accessibilityDescription:MVWord(@(row->title))] : nil;
}

static NSMenuItem *itemFor(const MVControlRow *row) {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:MVWord(@(row->title)) action:@selector(control:) keyEquivalent:row->key ? [NSString stringWithCharacters:&row->key length:1] : @""];
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
  NSMenuItem *item = [bar addItemWithTitle:MVWord(title) action:NULL keyEquivalent:@""];
  menu.title = MVWord(title);
  item.submenu = menu;
  return item;
}

static NSMenuItem *add(NSMenu *menu, NSString *title, SEL action, NSString *key, NSEventModifierFlags mods) {
  NSMenuItem *item = [menu addItemWithTitle:MVWord(title) action:action keyEquivalent:key];
  item.keyEquivalentModifierMask = mods;
  return item;
}

/// As every Mac app's: About with the version and how it is updated, a look for a release, Settings, then the system's own.
static NSMenu *appMenu(void) {
  NSMenu *menu = [NSMenu new];
  MVAppItems *own = MVAppItems.shared;
  add(menu, @"About Appdyno", @selector(about:), @"", 0).target = own;
  [menu addItem:NSMenuItem.separatorItem];
  add(menu, @"Check for Updates…", @selector(checkForUpdates:), @"", 0).target = own;
  add(menu, @"Settings…", @selector(settings:), @",", kCmd).target = own;
  [menu addItem:NSMenuItem.separatorItem];
  NSMenu *services = [[NSMenu alloc] initWithTitle:MVWord(@"Services")];
  add(menu, @"Services", NULL, @"", 0).submenu = services;
  NSApp.servicesMenu = services;
  [menu addItem:NSMenuItem.separatorItem];
  add(menu, @"Hide Appdyno", @selector(hide:), @"h", kCmd);
  add(menu, @"Hide Others", @selector(hideOtherApplications:), @"h", kCmd | kOpt);
  add(menu, @"Show All", @selector(unhideAllApplications:), @"", 0);
  [menu addItem:NSMenuItem.separatorItem];
  add(menu, @"Quit Appdyno", @selector(terminate:), @"q", kCmd);
  return menu;
}

/// The system's own, to whatever has the keyboard: a field's words, or the device, which takes a paste as typing. Then
/// what a window's own table puts here.
static NSMenu *editMenu(void) {
  NSMenu *menu = [NSMenu new];
  add(menu, @"Undo", NSSelectorFromString(@"undo:"), @"z", kCmd);
  add(menu, @"Redo", NSSelectorFromString(@"redo:"), @"z", kCmd | kShift);
  [menu addItem:NSMenuItem.separatorItem];
  add(menu, @"Cut", @selector(cut:), @"x", kCmd);
  add(menu, @"Copy", @selector(copy:), @"c", kCmd);
  add(menu, @"Paste", @selector(paste:), @"v", kCmd);
  add(menu, @"Select All", @selector(selectAll:), @"a", kCmd);
  [menu addItem:NSMenuItem.separatorItem];
  for (NSMenuItem *item in MVControlMenu(@"Edit", nil).itemArray) [menu addItem:[item copy]];
  return menu;
}

static NSMenu *windowMenu(void) {
  NSMenu *menu = [NSMenu new];
  add(menu, @"Minimize", @selector(performMiniaturize:), @"m", kCmd);
  add(menu, @"Zoom", @selector(performZoom:), @"", 0);
  [menu addItem:NSMenuItem.separatorItem];
  add(menu, @"Bring All to Front", @selector(arrangeInFront:), @"", 0);
  NSApp.windowsMenu = menu;
  return menu;
}

/// Where to read more, on the project's own pages, and how to say what went wrong.
static NSMenu *helpMenu(BOOL hub) {
  NSMenu *menu = [NSMenu new];
  MVAppItems *own = MVAppItems.shared;
  // the hub's Help is a place of its own, a key away
  if (hub) add(menu, @"Appdyno Help", NSSelectorFromString(@"openHelp:"), @"?", kCmd);
  if (hub) add(menu, @"Welcome", NSSelectorFromString(@"openWelcome:"), @"", 0);
  add(menu, @"Documentation", @selector(openDocs:), @"", 0).target = own;
  add(menu, @"Tools Reference", @selector(openTools:), @"", 0).target = own;
  add(menu, @"Report an Issue…", @selector(reportIssue:), @"", 0).target = own;
  NSApp.helpMenu = menu;
  return menu;
}

/// What a device does, then what is taken of its screen: the same items in a window of its own and in the hub's.
void MVFillDeviceMenu(NSMenu *menu, NSArray<NSString *> *_Nullable names) {
  for (NSMenuItem *item in MVControlMenu(@"Device", names).itemArray) [menu addItem:item];
  [menu addItem:NSMenuItem.separatorItem];
  for (NSMenuItem *item in MVControlMenu(@"Capture", nil).itemArray) [menu addItem:item];
}

static NSMenu *closing(NSMenu *file) {
  [file addItem:NSMenuItem.separatorItem];
  add(file, @"Close Window", @selector(performClose:), @"w", kCmd);
  return file;
}

NSMenu *MVMainMenu(NSArray<NSString *> *_Nullable names) {
  NSMenu *bar = [NSMenu new];
  menuOf(bar, @"Appdyno", appMenu());
  menuOf(bar, @"File", closing(MVControlMenu(@"File", nil)));
  menuOf(bar, @"Edit", editMenu());
  menuOf(bar, @"View", MVControlMenu(@"View", nil));
  NSMenu *device = [NSMenu new];
  MVFillDeviceMenu(device, names);
  menuOf(bar, @"Device", device);
  menuOf(bar, @"Window", windowMenu());
  menuOf(bar, @"Help", helpMenu(NO));
  return bar;
}

/// The hub's: what it makes and opens, then the device chosen's own items, which go to it, and its sidebar.
NSMenu *MVHubMenu(id<NSMenuDelegate> devices) {
  NSMenu *bar = [NSMenu new];
  menuOf(bar, @"Appdyno", appMenu());
  NSMenu *file = [NSMenu new];
  // to the first that answers, which is the hub, as its window's delegate
  add(file, @"New Simulator…", NSSelectorFromString(@"newSimulator:"), @"n", kCmd);
  add(file, @"New Emulator…", NSSelectorFromString(@"newEmulator:"), @"n", kCmd | kOpt);
  add(file, @"Connect a Phone…", NSSelectorFromString(@"connectPhone:"), @"", 0);
  [file addItem:NSMenuItem.separatorItem];
  add(file, @"Open in New Window", NSSelectorFromString(@"openWindow:"), @"n", kCmd | kShift);
  add(file, @"Open Report…", NSSelectorFromString(@"openReport:"), @"o", kCmd | kShift);
  [file addItem:NSMenuItem.separatorItem];
  for (NSMenuItem *item in MVControlMenu(@"File", nil).itemArray) [file addItem:item];
  menuOf(bar, @"File", closing(file));
  menuOf(bar, @"Edit", editMenu());
  NSMenu *view = MVControlMenu(@"View", nil);
  [view addItem:NSMenuItem.separatorItem];
  add(view, @"Show Sidebar", @selector(toggleSidebar:), @"s", kCmd | kCtl);
  menuOf(bar, @"View", view);
  // the device chosen's, read as it opens
  NSMenu *device = [NSMenu new];
  device.delegate = devices;
  menuOf(bar, @"Device", device);
  menuOf(bar, @"Window", windowMenu());
  menuOf(bar, @"Help", helpMenu(YES));
  return bar;
}
