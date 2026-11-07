// A device's controls as the system's own toolbar: window dragging, overflow and its glass come with it. Each item is a
// button of the table, in a group by what it is for, and the window's title and subtitle say which device and how it is.
#import "Window.h"

// narrow enough that what the capsule says while a measure runs folds no control away at the window's opening size
static const double kSymbolSize = 14, kButtonWide = 28, kTitleWidest = 150;

@implementation MVToolbar {
  NSArray<NSArray<NSString *> *> *_groups;
  id _target;
  SEL _action;
  NSMutableDictionary<NSString *, NSButton *> *_buttons;
  NSMutableDictionary<NSString *, MVInk *> *_inks;
  NSTextField *_name, *_about;
  __weak NSToolbar *_made;
  BOOL _switchHidden;
}

- (instancetype)initWithGroups:(NSArray<NSArray<NSString *> *> *)groups target:(id)target action:(SEL)action {
  if ((self = [super init])) {
    _groups = groups;
    _target = target;
    _action = action;
    _buttons = [NSMutableDictionary dictionary];
    _inks = [NSMutableDictionary dictionary];
    _capsule = [MVCapsule new];
    _capsule.target = target;
    _capsule.action = action;
    _buttons[@"status"] = _capsule;
  }
  return self;
}

- (NSToolbar *)toolbar {
  NSToolbar *bar = [[NSToolbar alloc] initWithIdentifier:@"device"];
  bar.delegate = self;
  bar.displayMode = NSToolbarDisplayModeIconOnly;
  bar.centeredItemIdentifiers = [NSSet setWithObject:@"status"];
  _made = bar;
  return bar;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  NSMutableArray *names = [NSMutableArray arrayWithObjects:NSToolbarSidebarTrackingSeparatorItemIdentifier, @"title", NSToolbarFlexibleSpaceItemIdentifier, nil];
  // with no device there is nothing to say, and an empty capsule is a pill of glass holding nothing
  if (_groups.count) [names addObjectsFromArray:@[@"status", NSToolbarFlexibleSpaceItemIdentifier]];
  for (NSUInteger i = 0; i < _groups.count; i++) [names addObject:[NSString stringWithFormat:@"group%lu", (unsigned long)i]];
  if (@available(macOS 14, *)) [names addObject:NSToolbarInspectorTrackingSeparatorItemIdentifier];
  [names addObjectsFromArray:@[NSToolbarFlexibleSpaceItemIdentifier, @"inspector"]];
  return names;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return [self toolbarDefaultItemIdentifiers:toolbar];
}

- (NSToolbarItem *)itemNamed:(NSString *)name {
  NSButton *button = [MVBarButton buttonWithImage:[NSImage new] target:_target action:_action];
  button.bezelStyle = NSBezelStyleToolbar;
  MVInk *ink = [[MVInk alloc] initWithSymbol:MVControlSymbol(name) color:MVInkColor() size:kSymbolSize];
  ink.translatesAutoresizingMaskIntoConstraints = NO;
  [button addSubview:ink];
  [NSLayoutConstraint activateConstraints:@[
    [ink.leadingAnchor constraintEqualToAnchor:button.leadingAnchor],
    [ink.trailingAnchor constraintEqualToAnchor:button.trailingAnchor],
    [ink.topAnchor constraintEqualToAnchor:button.topAnchor],
    [ink.bottomAnchor constraintEqualToAnchor:button.bottomAnchor],
  ]];
  _inks[name] = ink;
  button.identifier = name;
  button.toolTip = MVControlTitle(name);
  button.accessibilityLabel = MVControlTitle(name);
  [button.widthAnchor constraintEqualToConstant:kButtonWide].active = YES;
  [button.heightAnchor constraintEqualToConstant:30].active = YES;
  _buttons[name] = button;
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:name];
  item.view = button;
  item.bordered = YES;
  item.label = MVControlTitle(name);
  item.toolTip = MVControlTitle(name);
  return item;
}

- (NSToolbarItem *)titleItem {
  _name = MVText(@"", MVStyleStrong);
  _about = MVText(@"", MVStyleSub);
  NSStackView *lines = [NSStackView stackViewWithViews:@[_name, _about]];
  lines.orientation = NSUserInterfaceLayoutOrientationVertical;
  lines.alignment = NSLayoutAttributeLeading;
  lines.spacing = 0;
  [lines.widthAnchor constraintLessThanOrEqualToConstant:kTitleWidest].active = YES;
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:@"title"];
  item.view = lines;
  item.bordered = NO;
  item.visibilityPriority = NSToolbarItemVisibilityPriorityHigh;
  return item;
}

- (NSToolbarItem *)statusItem {
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:@"status"];
  item.view = _capsule;
  item.bordered = YES;
  item.visibilityPriority = NSToolbarItemVisibilityPriorityHigh;
  return item;
}

- (void)setName:(NSString *)name about:(nullable NSString *)about {
  _name.stringValue = name;
  _about.stringValue = about ?: @"";
  _about.hidden = !about.length;
}

/// A place has no use for the Inspector's switch. Before macOS 15 an item cannot hide, and it opens a pane that says so.
- (void)hideInspectorSwitch:(BOOL)hidden {
  _switchHidden = hidden;
  // the bar it stands on, which need not be the window's yet: a device's bar comes down a moment after its place is chosen
  for (NSToolbarItem *item in _made.items)
    if ([item.itemIdentifier isEqual:@"inspector"] && [item respondsToSelector:@selector(setHidden:)]) [item setValue:@(hidden) forKey:@"hidden"];
}

- (void)paint:(NSString *)name symbol:(NSString *)symbol color:(NSColor *)color {
  [_inks[name] paint:symbol color:color];
}

- (nullable NSToolbarItem *)toolbar:(NSToolbar *)toolbar itemForItemIdentifier:(NSToolbarItemIdentifier)name willBeInsertedIntoToolbar:(BOOL)flag {
  if ([name isEqual:@"title"]) return [self titleItem];
  if ([name isEqual:@"status"]) return [self statusItem];
  if ([name isEqual:@"inspector"]) {
    NSToolbarItem *item = [self itemNamed:name];
    if (_switchHidden && [item respondsToSelector:@selector(setHidden:)]) [item setValue:@YES forKey:@"hidden"];
    return item;
  }
  if (![name hasPrefix:@"group"]) return nil;
  NSArray<NSString *> *names = _groups[[name substringFromIndex:5].integerValue];
  NSMutableArray *items = [NSMutableArray array];
  for (NSString *control in names) [items addObject:[self itemNamed:control]];
  NSToolbarItemGroup *group = [[NSToolbarItemGroup alloc] initWithItemIdentifier:name];
  group.subitems = items;
  return group;
}

- (nullable NSButton *)buttonNamed:(NSString *)name {
  return _buttons[name];
}

@end
