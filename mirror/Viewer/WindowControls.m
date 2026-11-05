// A window's bar and what its controls do.
#import "WindowParts.h"

@implementation MVWindow (Controls)

/// What is always there, and the rest a click away: a window is for its device, not its controls.
- (void)addControls {
  NSMutableArray *device = [NSMutableArray array];
  for (NSString *name in @[@"back", @"home", @"appSwitch", @"lock"])
    if ([_view.controls containsObject:name]) [device addObject:name];
  NSArray *groups = @[device, @[@"screenshot", @"record", @"recordFlow"], _hosted ? @[@"more"] : @[@"hud", @"more"]];
  if (_look[@"pair"]) groups = [@[@[@"both"]] arrayByAddingObjectsFromArray:groups];
  _bar = [[MVToolbar alloc] initWithGroups:groups target:self action:@selector(control:)];
  [self useToolbar];
  // it has nothing to say until there are two windows
  [_bar buttonNamed:@"both"].enabled = NO;
}

/// The bar is the system's, one to a window: of two devices in a room, the one last touched has it.
- (void)useToolbar {
  if (!_toolbar) _toolbar = _bar.toolbar;
  [self holdInspector];
  if (_window.toolbar == _toolbar) return;
  _window.toolbar = _toolbar;
  _window.toolbarStyle = NSWindowToolbarStyleUnified;
  _window.titleVisibility = NSWindowTitleHidden;
  NSDictionary *row = _room.rowOf ? _room.rowOf(_root.stage ?: @"") : nil;
  _line.about = row[@"about"] ?: _look[@"frame"][@"model"];
  _line.link = row[@"link"];
  [self showState];
}

- (void)showMore:(NSView *)anchor {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"More"];
  NSArray<NSString *> *shown = @[@"back", @"home", @"appSwitch", @"lock"];
  for (NSMenuItem *item in [_view deviceMenu].itemArray)
    if (![shown containsObject:item.representedObject]) [menu addItem:[item copy]];
  [menu addItem:NSMenuItem.separatorItem];
  if (_hosted) {
    NSMenuItem *alone = [menu addItemWithTitle:@"Open in New Window" action:@selector(control:) keyEquivalent:@""];
    alone.target = self;
    alone.representedObject = @"newWindow";
  }
  for (NSMenuItem *item in MVControlMenu(@"View", nil).itemArray)
    if (![item.representedObject isEqual:@"inspector"]) [menu addItem:[item copy]];
  [menu popUpMenuPositioningItem:nil atLocation:NSMakePoint(0, anchor.bounds.size.height + 6) inView:anchor];
}

- (void)control:(id)sender {
  // a menu's item by what it holds, a bar's button by its identifier: a button answers `representedObject` too, with nil
  if (!MVShortcutMayAct(NSApp.currentEvent, _window)) return;
  NSString *name = [sender isKindOfClass:NSMenuItem.class] ? [sender representedObject] : [sender identifier];
  if ([name isEqual:@"more"]) return [self showMore:sender];
  if ([name isEqual:@"status"]) return [self showNumbers:sender];
  [self perform:name];
}

/// What is underneath the capsule's words: the stream, and what it costs this Mac.
- (void)showNumbers:(NSView *)anchor {
  if (!_numbers) {
    NSViewController *holder = [NSViewController new];
    holder.view = _inspector.numbers;
    holder.preferredContentSize = NSMakeSize(MVInspectorWidth - 40, 240);
    _numbers = [NSPopover new];
    _numbers.behavior = NSPopoverBehaviorTransient;
    _numbers.contentViewController = holder;
  }
  if (_numbers.shown) return [_numbers close];
  [_numbers showRelativeToRect:anchor.bounds ofView:anchor preferredEdge:NSRectEdgeMaxY];
}

- (void)perform:(NSString *)name {
  if ([name isEqual:@"newWindow"]) return MVEmit(@{@"op": @"hub", @"action": @"open", @"serial": _root.stage ?: @""});
  if ([name isEqual:@"zoomIn"] || [name isEqual:@"zoomOut"]) return [self setZoom:MVZoomStep(_zoom, [name isEqual:@"zoomIn"])];
  if ([name isEqual:@"zoomFit"]) return [self setZoom:[self fitZoom]];
  if ([name isEqual:@"zoomActual"]) return [self setZoom:MIN(_picture.width, _picture.height) > 0 ? _frame.spec.points / MIN(_picture.width, _picture.height) : 1];
  if ([name isEqual:@"frame"]) return [self setFrameShown:!_frame.showsFrame];
  if ([name isEqual:@"inspector"]) return [self toggleInspector];
  if ([name isEqual:@"hud"]) return [self toggleHud];
  if ([@[@"screenshot", @"copy", @"record", @"recordFlow", @"reconnect", @"measureLaunch", @"measureScroll", @"dashboard"] containsObject:name]) return MVEmitFrom(_view, @{@"op": @"control", @"name": name});
  if ([name isEqual:@"paste"]) return [_view paste:self];
  if ([name isEqual:@"both"]) return MVEmitFrom(_view, @{@"op": @"control", @"name": name});
  if ([name isEqual:@"journey"]) return [self askJourney];
  [_view pressButton:name];
}

- (BOOL)validateUserInterfaceItem:(id<NSValidatedUserInterfaceItem>)item {
  if (item.action != @selector(control:)) return YES;
  id object = [(id)item respondsToSelector:@selector(representedObject)] ? [(id)item representedObject] : nil;
  if ([object isEqual:@"frame"]) [(NSMenuItem *)item setState:_frame.showsFrame ? NSControlStateValueOn : NSControlStateValueOff];
  if ([object isEqual:@"inspector"]) [(NSMenuItem *)item setState:self.inspecting ? NSControlStateValueOn : NSControlStateValueOff];
  return YES;
}

@end
