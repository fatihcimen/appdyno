// A device's controls as the system's own toolbar: window dragging, overflow and its glass come with it. Each item is a
// button of the table, in a group by what it is for, and the window's title and subtitle say which device and how it is.
#import "Window.h"

static const double kSymbolSize = 14;

@implementation MVToolbar {
  NSArray<NSArray<NSString *> *> *_groups;
  id _target;
  SEL _action;
  NSMutableDictionary<NSString *, NSButton *> *_buttons;
  NSMutableDictionary<NSString *, MVInk *> *_inks;
  NSTextField *_name, *_about;
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
  return bar;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  NSMutableArray *names = [NSMutableArray arrayWithObjects:NSToolbarSidebarTrackingSeparatorItemIdentifier, @"title", NSToolbarFlexibleSpaceItemIdentifier, @"status", NSToolbarFlexibleSpaceItemIdentifier, nil];
  for (NSUInteger i = 0; i < _groups.count; i++) [names addObject:[NSString stringWithFormat:@"group%lu", (unsigned long)i]];
  [names addObjectsFromArray:@[NSToolbarInspectorTrackingSeparatorItemIdentifier, NSToolbarFlexibleSpaceItemIdentifier, @"inspector"]];
  return names;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return [self toolbarDefaultItemIdentifiers:toolbar];
}

- (NSToolbarItem *)itemNamed:(NSString *)name {
  NSButton *button = [MVBarButton buttonWithImage:[NSImage new] target:_target action:_action];
  button.bezelStyle = NSBezelStyleToolbar;
  MVInk *ink = [[MVInk alloc] initWithSymbol:MVControlSymbol(name) color:NSColor.labelColor size:kSymbolSize];
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
  [button.widthAnchor constraintEqualToConstant:34].active = YES;
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

- (void)paint:(NSString *)name symbol:(NSString *)symbol color:(NSColor *)color {
  [_inks[name] paint:symbol color:color];
}

- (nullable NSToolbarItem *)toolbar:(NSToolbar *)toolbar itemForItemIdentifier:(NSToolbarItemIdentifier)name willBeInsertedIntoToolbar:(BOOL)flag {
  if ([name isEqual:@"title"]) return [self titleItem];
  if ([name isEqual:@"status"]) return [self statusItem];
  if ([name isEqual:@"inspector"]) return [self itemNamed:name];
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
