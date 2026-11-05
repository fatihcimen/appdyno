// A device's controls as the system's own toolbar: window dragging, overflow and its glass come with it. Each item is a
// button of the table, in a group by what it is for, and the window's title and subtitle say which device and how it is.
#import "Window.h"

/// A click on a window not in use is the click a person meant: a window opens in front with no keyboard, and without
/// this its first click on any control only made the window the one in use, with nothing to show for it.
@interface MVBarButton : NSButton
@end

@implementation MVBarButton
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}
@end

@implementation MVToolbar {
  NSArray<NSArray<NSString *> *> *_groups;
  id _target;
  SEL _action;
  NSMutableDictionary<NSString *, NSButton *> *_buttons;
}

- (instancetype)initWithGroups:(NSArray<NSArray<NSString *> *> *)groups target:(id)target action:(SEL)action {
  if ((self = [super init])) {
    _groups = groups;
    _target = target;
    _action = action;
    _buttons = [NSMutableDictionary dictionary];
  }
  return self;
}

- (NSToolbar *)toolbar {
  NSToolbar *bar = [[NSToolbar alloc] initWithIdentifier:@"device"];
  bar.delegate = self;
  bar.displayMode = NSToolbarDisplayModeIconOnly;
  return bar;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  NSMutableArray *names = [NSMutableArray arrayWithObjects:NSToolbarSidebarTrackingSeparatorItemIdentifier, NSToolbarFlexibleSpaceItemIdentifier, nil];
  for (NSUInteger i = 0; i < _groups.count; i++) [names addObject:[NSString stringWithFormat:@"group%lu", (unsigned long)i]];
  return names;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return [self toolbarDefaultItemIdentifiers:toolbar];
}

- (NSToolbarItem *)itemNamed:(NSString *)name {
  NSImageSymbolConfiguration *quiet = [NSImageSymbolConfiguration configurationWithPointSize:14 weight:NSFontWeightRegular];
  NSButton *button = [MVBarButton buttonWithImage:[MVControlImage(name) imageWithSymbolConfiguration:quiet] target:_target action:_action];
  button.bezelStyle = NSBezelStyleToolbar;
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

- (nullable NSToolbarItem *)toolbar:(NSToolbar *)toolbar itemForItemIdentifier:(NSToolbarItemIdentifier)name willBeInsertedIntoToolbar:(BOOL)flag {
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
