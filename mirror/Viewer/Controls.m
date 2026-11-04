// Every control of a window, once: its name, its words, its symbol and its shortcut. The menus and the glass bar
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
    {"hud", "Show Performance", "gauge.with.dots.needle.67percent", 'p', kCmd | kOpt, "View"},
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
