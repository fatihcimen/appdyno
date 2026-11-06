// The system's Inspector: one to a window, edge to edge, holding the panes of the device that has the toolbar. A window
// of its own opens with it closed; the hub's stands open, with a word in it while no device does.
#import "WindowParts.h"

void MVGiveWay(NSSplitViewItem *item, BOOL narrow, BOOL *gaveWay) {
  if (narrow && !item.collapsed) {
    *gaveWay = YES;
    item.collapsed = YES;
  } else if (!narrow && *gaveWay) {
    *gaveWay = NO;
    item.collapsed = NO;
  }
}

@implementation MVInspectorSlot {
  NSViewController *_holder;
  NSTextField *_empty;
  void (^_onMove)(void);
  BOOL _gaveWay;
}

- (instancetype)init {
  if ((self = [super init])) {
    _holder = [NSViewController new];
    _holder.view = [NSView new];
    _item = [NSSplitViewItem inspectorWithViewController:_holder];
    _item.minimumThickness = MVInspectorWidth;
    _item.maximumThickness = MVInspectorWidth;
    _item.canCollapse = YES;
    [_item addObserver:self forKeyPath:@"collapsed" options:0 context:NULL];
    _empty = MVPaneNote(@"Choose a running device to see its numbers.");
    _empty.alignment = NSTextAlignmentCenter;
    _empty.translatesAutoresizingMaskIntoConstraints = NO;
    [_holder.view addSubview:_empty];
    [NSLayoutConstraint activateConstraints:@[
      [_empty.centerXAnchor constraintEqualToAnchor:_holder.view.centerXAnchor],
      [_empty.centerYAnchor constraintEqualToAnchor:_holder.view.centerYAnchor],
      [_empty.widthAnchor constraintLessThanOrEqualToConstant:MVInspectorWidth - 48],
    ]];
  }
  return self;
}

- (void)dealloc {
  [_item removeObserver:self forKeyPath:@"collapsed"];
}

- (void)observeValueForKeyPath:(NSString *)path ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if (_onMove) _onMove();
}

- (void)fitWindow:(double)wide least:(double)least {
  MVGiveWay(_item, wide < least, &_gaveWay);
}

- (void)hold:(nullable NSView *)pane onMove:(nullable void (^)(void))onMove {
  [_pane removeFromSuperview];
  _pane = pane;
  void (^before)(void) = _onMove;
  _onMove = onMove;
  _empty.hidden = pane != nil;
  if (pane) {
    NSView *view = _holder.view;
    pane.translatesAutoresizingMaskIntoConstraints = NO;
    [view addSubview:pane];
    [NSLayoutConstraint activateConstraints:@[
      [pane.topAnchor constraintEqualToAnchor:view.safeAreaLayoutGuide.topAnchor],
      [pane.bottomAnchor constraintEqualToAnchor:view.bottomAnchor],
      [pane.leadingAnchor constraintEqualToAnchor:view.leadingAnchor],
      [pane.trailingAnchor constraintEqualToAnchor:view.trailingAnchor],
    ]];
  }
  if (before) before();
  if (onMove) onMove();
}

@end

@implementation MVWindow (Inspector)

/// A window of its own: the device, and the Inspector beside it, closed until asked for.
- (void)splitAround:(NSView *)root {
  _slot = [MVInspectorSlot new];
  _slot.item.collapsed = YES;
  NSViewController *main = [NSViewController new];
  main.view = root;
  NSSplitViewController *split = [NSSplitViewController new];
  NSSplitViewItem *content = [NSSplitViewItem splitViewItemWithViewController:main];
  // the device's ground runs on under the Inspector, whose glass shows it, as in the hub
  if ([content respondsToSelector:NSSelectorFromString(@"setAutomaticallyAdjustsSafeAreaInsets:")]) [content setValue:@YES forKey:@"automaticallyAdjustsSafeAreaInsets"];
  [split addSplitViewItem:content];
  [split addSplitViewItem:_slot.item];
  _window.contentViewController = split;
  // running on under the Inspector, the stage's frame stays as it is while the Inspector moves: only its insets change, and the
  // picture must leave them, as nothing may stand over it. The insets follow the split a turn later
  __weak MVWindow *weak = self;
  [NSNotificationCenter.defaultCenter addObserverForName:NSSplitViewDidResizeSubviewsNotification object:split.splitView queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [weak layoutPicture];
    });
  }];
}

/// What is read for the Inspector runs while it shows: the slot says when that changed, for this device or by the window's size.
- (void)holdInspector {
  if (_slot.pane == _inspector) return;
  __weak MVWindow *weak = self;
  [_slot hold:_inspector onMove:^{
    [weak watchReadings];
    [weak watchElements];
  }];
}

- (void)letGoOfInspector {
  if (_slot.pane == _inspector) [_slot hold:nil onMove:nil];
}

- (NSRect)deviceInWindow {
  return [_frame convertRect:_frame.bounds toView:nil];
}

- (NSRect)inspectorInWindow {
  return [_inspector convertRect:_inspector.bounds toView:nil];
}

- (void)openInspector:(BOOL)open {
  [self holdInspector];
  BOOL animated = _hosted && MVMoves();
  (animated ? _slot.item.animator : _slot.item).collapsed = !open;
}

@end
