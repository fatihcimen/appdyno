// The window: the device on a backdrop drawn from its own picture, full bleed, with glass floating over it: its status,
// its controls and the Inspector. The picture's view is exactly the device's screen, so its maths never hear of a frame.
#import "Viewer.h"
#import "Window.h"

// a new window takes at most this much of the screen
static const double kFitScreen = 0.85;
// far from every screen a Mac can have
static const double kOffscreenAt = -30000;
static const double kMargin = 30, kTop = 60, kBottom = 22, kInspector = 300, kInset = 10;
static const double kClickSeconds = 0.08;
static const CGSize kSmallest = {380, 420};
// wide enough that a toolbar shows all it has; a person can go narrower, and it folds into its own menu
static const double kOpensWide = 640;
static NSString *const kFrameDefault = @"showsDeviceFrame";

MVShow MVShowOf(BOOL focus, BOOL behind) {
  if (behind) return MVShowBehind;
  return focus ? MVShowFocused : MVShowFront;
}

@implementation MVWindow {
  MVOffscreenWindow *_window;
  NSView *_stage;
  MVFrameView *_frame;
  MVView *_view;
  MVInspector *_inspector;
  NSView *_panel, *_bar;
  MVHud *_hud;
  BOOL _hudding, _reading;
  NSView *_root;
  MVBackdrop *_backdrop;
  MVStatusLine *_line;
  MVPictureLayers *_layers;
  CGSize _picture;
  double _zoom;
  int _turns;
  NSString *_name, *_kind;
  NSDictionary *_look;
  BOOL _inspecting;
}

- (instancetype)init {
  if ((self = [super init])) {
    NSRect frame = NSMakeRect(80, 80, 440, 760);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
    _window = [[MVOffscreenWindow alloc] initWithContentRect:frame styleMask:style backing:NSBackingStoreBuffered defer:NO];
    _window.releasedWhenClosed = NO;
    _window.delegate = self;
    _window.titlebarAppearsTransparent = YES;
    _window.titleVisibility = NSWindowTitleHidden;
    _window.contentMinSize = kSmallest;
    NSView *root = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
    root.wantsLayer = YES;
    _backdrop = [[MVBackdrop alloc] initInView:root window:_window];
    _root = root;
    _window.contentView = root;
    _stage = [[NSView alloc] initWithFrame:root.bounds];
    [root addSubview:_stage];
    _frame = [[MVFrameView alloc] initWithFrame:NSZeroRect];
    _view = [[MVView alloc] initWithFrame:NSZeroRect];
    _view.wantsLayer = YES;
    _view.layer.backgroundColor = NSColor.blackColor.CGColor;
    _frame.screen = _view;
    _frame.showsFrame = ![NSUserDefaults.standardUserDefaults objectForKey:kFrameDefault] || [NSUserDefaults.standardUserDefaults boolForKey:kFrameDefault];
    [_stage addSubview:_frame];
    [_frame addSubview:_view];
    _layers = [[MVPictureLayers alloc] initInView:_view];
    _overlay = [[MVOverlay alloc] initInView:_view];
    _line = [[MVStatusLine alloc] initWithFrame:NSZeroRect];
    _line.translatesAutoresizingMaskIntoConstraints = NO;
    NSView *padded = [NSView new];
    [padded addSubview:_line];
    NSView *pill = MVGlass(padded, 17, nil);
    [root addSubview:pill];
    [NSLayoutConstraint activateConstraints:@[
      [_line.leadingAnchor constraintEqualToAnchor:padded.leadingAnchor constant:14],
      [_line.trailingAnchor constraintEqualToAnchor:padded.trailingAnchor constant:-14],
      [_line.centerYAnchor constraintEqualToAnchor:padded.centerYAnchor],
      [padded.heightAnchor constraintEqualToConstant:34],
      [pill.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:84],
      [pill.topAnchor constraintEqualToAnchor:root.topAnchor constant:12],
      [pill.widthAnchor constraintLessThanOrEqualToConstant:230],
    ]];
    _inspector = [[MVInspector alloc] initWithFrame:NSZeroRect target:self];
    __weak MVWindow *weak = self;
    _inspector.onPane = ^{
      [weak watchReadings];
    };
    _hud = [[MVHud alloc] initWithFrame:NSZeroRect];
    _hud.hidden = YES;
    [root addSubview:_hud];
    _panel = MVGlass(_inspector, 22, nil);
    _panel.translatesAutoresizingMaskIntoConstraints = YES;
    _panel.hidden = YES;
    [root addSubview:_panel];
  }
  return self;
}

- (void)configure:(NSDictionary *)attach {
  _name = attach[@"title"] ?: @"appdyno";
  _window.title = _name;
  _look = [attach[@"look"] isKindOfClass:NSDictionary.class] ? attach[@"look"] : @{};
  _kind = attach[@"source"][@"kind"];
  _view.controls = _look[@"controls"] ?: @[@"home", @"lock", @"volumeUp", @"volumeDown"];
  if (!_bar) {
    [self addControls];
    NSApp.mainMenu = MVMainMenu(_view.controls);
  }
  _window.poses = self.poses;
  _view.inputOn = ![attach[@"input"] isEqual:@NO];
  // a click once given stands: a reconnect does not take it back
  if (![attach[@"input"] isEqual:@"click"]) _view.armed = YES;
  // a restarted viewer keeps the zoom it had; a phone's picture size comes with its first frame
  if ([attach[@"zoom"] doubleValue] > 0) _zoom = [attach[@"zoom"] doubleValue];
  _line.name = _look[@"name"] ?: _name;
  [_window makeFirstResponder:_view];
  [self show:MVShowOf([attach[@"focus"] boolValue], self.behind)];
}

/// What is always there, and the rest a click away: a window is for its device, not its controls.
- (void)addControls {
  NSMutableArray *device = [NSMutableArray array];
  for (NSString *name in @[@"back", @"home", @"appSwitch", @"lock"])
    if ([_view.controls containsObject:name]) [device addObject:name];
  _bar = MVGlassBar(@[device, @[@"screenshot", @"record"], @[@"hud", @"more", @"inspector"]], self, @selector(control:));
  [_root addSubview:_bar];
  [NSLayoutConstraint activateConstraints:@[
    [_bar.trailingAnchor constraintEqualToAnchor:_root.trailingAnchor constant:-12],
    [_bar.topAnchor constraintEqualToAnchor:_root.topAnchor constant:10],
  ]];
}

- (void)showMore:(NSView *)anchor {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"More"];
  NSArray<NSString *> *shown = @[@"back", @"home", @"appSwitch", @"lock"];
  for (NSMenuItem *item in [_view deviceMenu].itemArray)
    if (![shown containsObject:item.representedObject]) [menu addItem:[item copy]];
  [menu addItem:NSMenuItem.separatorItem];
  for (NSMenuItem *item in MVControlMenu(@"View", nil).itemArray)
    if (![item.representedObject isEqual:@"inspector"]) [menu addItem:[item copy]];
  [menu popUpMenuPositioningItem:nil atLocation:NSMakePoint(0, anchor.bounds.size.height + 6) inView:anchor];
}

/// Everything laid out once, from the window's size: the device takes the room there is.
- (void)layoutPicture {
  NSRect all = _window.contentView.bounds;
  double side = [self sideWidth];
  _stage.frame = NSMakeRect(0, 0, all.size.width - side, all.size.height);
  _panel.frame = NSMakeRect(all.size.width - kInspector - kInset, kInset, kInspector, all.size.height - kTop - kInset);
  double beside = all.size.width - (_inspecting ? kInspector + kInset : 0) - MVHudWidth - kInset;
  _hud.frame = NSMakeRect(beside, kInset, MVHudWidth, all.size.height - kTop - kInset);
  if (_picture.width <= 0) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  double margin = _frame.showsFrame ? kMargin : 0;
  CGSize room = CGSizeMake(_stage.frame.size.width - 2 * margin, all.size.height - kTop - kBottom);
  CGSize body = [_frame bodyFor:_picture turns:_turns];
  double scale = MVFitScale(body, room);
  CGSize screen = CGSizeMake(_picture.width * scale, _picture.height * scale);
  CGSize drawn = [_frame bodyFor:screen turns:_turns];
  double bottom = kBottom + (room.height - drawn.height) / 2;
  NSRect place = NSMakeRect(round((_stage.frame.size.width - drawn.width) / 2), round(bottom), drawn.width, drawn.height);
  [_frame layOutScreen:screen in:place turns:_turns];
  BOOL drawsItsOwn = [_kind isEqual:@"surface"] || [_kind isEqual:@"pixels"];
  CGSize portrait = screen.width > screen.height ? CGSizeMake(screen.height, screen.width) : screen;
  [_layers layOut:screen turns:_turns cutout:_frame.showsFrame && !drawsItsOwn ? MVCutoutRect(_frame.spec, portrait) : CGRectZero];
  [CATransaction commit];
}

- (void)applySpec {
  NSDictionary *look = _look[@"frame"];
  _frame.spec = MVFrameSpecOf(look[@"model"], look[@"platform"], look[@"color"], _picture);
}

- (void)setPicture:(CGSize)size {
  if (size.width <= 0 || size.height <= 0 || CGSizeEqualToSize(size, _picture)) return;
  _picture = size;
  _view.picture = size;
  [self applySpec];
  if (_zoom <= 0 && !self.behind) {
    _window.frameAutosaveName = _name;
    double saved = [NSUserDefaults.standardUserDefaults doubleForKey:[self zoomKey]];
    if (saved > 0) _zoom = saved;
  }
  if (_zoom <= 0) _zoom = [self fitZoom];
  [self setZoom:_zoom];
}

- (NSString *)zoomKey {
  return [@"zoom." stringByAppendingString:_name ?: @""];
}

/// What the panes beside the device take of the window.
- (double)sideWidth {
  return (_inspecting ? kInspector + kInset : 0) + (_hudding ? MVHudWidth + kInset : 0);
}

/// The chrome that never scales, at a given zoom's device.
- (CGSize)windowSizeAt:(double)zoom {
  CGSize body = [_frame bodyFor:CGSizeMake(_picture.width * zoom, _picture.height * zoom) turns:_turns];
  double margin = _frame.showsFrame ? kMargin : 0;
  return CGSizeMake(MAX(body.width + 2 * margin, kOpensWide) + [self sideWidth], MAX(body.height + kTop + kBottom, kSmallest.height));
}

- (double)fitZoom {
  NSRect visible = (_window.screen ?: NSScreen.mainScreen).visibleFrame;
  CGSize body = [_frame bodyFor:_picture turns:_turns];
  CGSize room = CGSizeMake(visible.size.width * kFitScreen - 2 * kMargin, visible.size.height * kFitScreen - kTop - kBottom);
  return MVFitScale(body, room);
}

- (void)setZoom:(double)zoom {
  _zoom = zoom;
  [_window setContentSize:[self windowSizeAt:zoom]];
  [self layoutPicture];
  [self sayZoom];
}

- (void)sayZoom {
  MVEmit(@{@"op": @"zoom", @"scale": @(_zoom)});
  if (!self.behind) [NSUserDefaults.standardUserDefaults setDouble:_zoom forKey:[self zoomKey]];
}

- (void)setTurns:(int)turns {
  _turns = turns;
  [self layoutPicture];
}

- (void)windowDidResize:(NSNotification *)notification {
  [self layoutPicture];
}

- (void)windowDidEndLiveResize:(NSNotification *)notification {
  if (_picture.width <= 0) return;
  _zoom = _view.bounds.size.width / _picture.width;
  [self sayZoom];
}

- (void)showSurface:(IOSurfaceRef)surface {
  [_layers showSurface:surface];
  [_backdrop followSurface:surface];
}

- (BOOL)showImage:(CVImageBufferRef)image {
  [_backdrop followImage:image];
  return [_layers showImage:image];
}

- (void)setStatus:(NSDictionary *)message {
  NSString *state = message[@"state"];
  BOOL live = [state isEqual:@"live"];
  _line.state = live ? @"Live" : message[@"title"] ?: state;
  [_layers setDimmed:!live];
  [_overlay showState:live ? nil : state title:message[@"title"] fix:message[@"fix"]];
  _window.title = live ? _name : [NSString stringWithFormat:@"%@: %@", _name, message[@"title"] ?: state];
}

- (void)setDriving:(BOOL)driving tool:(NSString *)tool {
  _line.tool = driving ? tool : nil;
  [_frame setDriving:driving];
}

- (void)sayNote:(NSString *)note {
  [_line say:note];
}

- (void)show:(MVShow)how {
  switch (how) {
    case MVShowBehind:
      _window.offscreen = YES;
      [_window setFrameOrigin:NSMakePoint(kOffscreenAt, kOffscreenAt)];
      [_window orderBack:nil];
      break;
    case MVShowFront:
      [_window orderFrontRegardless];
      break;
    case MVShowFocused:
      NSApp.activationPolicy = NSApplicationActivationPolicyRegular;
      [_window makeKeyAndOrderFront:nil];
      [NSApp activateIgnoringOtherApps:YES];
      break;
  }
}

- (void)raise {
  [self show:MVShowOf(NO, self.behind)];
}

- (void)toggleInspector {
  double zoom = _zoom;
  _inspecting = !_inspecting;
  _panel.hidden = !_inspecting;
  [self watchReadings];
  [self setZoom:zoom > 0 ? zoom : 1];
}

- (void)showPane:(NSInteger)pane {
  if (!_inspecting) [self toggleInspector];
  [_inspector showPane:pane];
}

/// A source runs only while something shows it: what it reads costs the device.
- (void)watchReadings {
  BOOL wanted = _hudding || (_inspecting && _inspector.readings);
  if (wanted == _reading) return;
  _reading = wanted;
  MVEmit(@{@"op": @"perfWatch", @"on": @(wanted)});
}

- (void)toggleHud {
  _hudding = !_hudding;
  _hud.hidden = !_hudding;
  [self watchReadings];
  [self setZoom:_zoom > 0 ? _zoom : 1];
}

- (void)showPerf:(NSDictionary *)message {
  if (_hudding) [_hud show:message];
  [_inspector.perf show:message];
}

- (void)showMeasure:(NSDictionary *)message {
  if (![message[@"op"] isEqual:@"measured"]) return [_inspector.perf showMeasuring:message[@"line"] ?: @""];
  [_inspector.perf showMeasured:message];
}

- (void)showStats:(NSDictionary *)stats {
  [_hud setPictureRate:[stats[@"shown"] doubleValue]];
  [_inspector.perf setPictureRate:[stats[@"shown"] doubleValue]];
  if (_inspecting) [_inspector showStats:stats];
}

- (void)addActivity:(NSDictionary *)call {
  [_inspector addActivity:call];
}

- (void)showApps:(NSDictionary *)message {
  [_inspector showApps:message];
}

/// The toolbar's record button says a movie is being made.
- (void)setRecording:(BOOL)on {
  NSButton *button = MVFindControl(_bar, @"record");
  button.image = [NSImage imageWithSystemSymbolName:on ? @"stop.circle.fill" : @"record.circle" accessibilityDescription:on ? @"Stop Recording" : @"Record Screen"];
  button.contentTintColor = on ? NSColor.systemRedColor : NSColor.labelColor;
}

- (void)setFrameShown:(BOOL)shown {
  if (_frame.showsFrame == shown) return;
  _frame.showsFrame = shown;
  if (!self.behind) [NSUserDefaults.standardUserDefaults setBool:shown forKey:kFrameDefault];
  [self setZoom:_zoom > 0 ? _zoom : 1];
}

- (void)control:(id)sender {
  NSString *name = [sender respondsToSelector:@selector(representedObject)] ? [sender representedObject] : [sender identifier];
  if ([name isEqual:@"more"]) return [self showMore:sender];
  [self perform:name];
}

- (void)perform:(NSString *)name {
  if ([name isEqual:@"zoomIn"] || [name isEqual:@"zoomOut"]) return [self setZoom:MVZoomStep(_zoom, [name isEqual:@"zoomIn"])];
  if ([name isEqual:@"zoomFit"]) return [self setZoom:[self fitZoom]];
  if ([name isEqual:@"zoomActual"]) return [self setZoom:MIN(_picture.width, _picture.height) > 0 ? _frame.spec.points / MIN(_picture.width, _picture.height) : 1];
  if ([name isEqual:@"frame"]) return [self setFrameShown:!_frame.showsFrame];
  if ([name isEqual:@"inspector"]) return [self toggleInspector];
  if ([name isEqual:@"hud"]) return [self toggleHud];
  if ([@[@"screenshot", @"copy", @"record", @"reconnect", @"measureLaunch", @"measureScroll", @"dashboard"] containsObject:name]) return MVEmit(@{@"op": @"control", @"name": name});
  if ([name isEqual:@"paste"]) return [_view paste:self];
  [_view pressButton:name];
}

- (BOOL)validateUserInterfaceItem:(id<NSValidatedUserInterfaceItem>)item {
  if (item.action != @selector(control:)) return YES;
  id object = [(id)item respondsToSelector:@selector(representedObject)] ? [(id)item representedObject] : nil;
  if ([object isEqual:@"frame"]) [(NSMenuItem *)item setState:_frame.showsFrame ? NSControlStateValueOn : NSControlStateValueOff];
  if ([object isEqual:@"inspector"]) [(NSMenuItem *)item setState:_inspecting ? NSControlStateValueOn : NSControlStateValueOff];
  return YES;
}

- (void)postMouse:(NSEventType)type x:(double)x y:(double)y {
  NSPoint inView = NSMakePoint(x * _view.bounds.size.width, (1 - y) * _view.bounds.size.height);
  NSPoint at = [_view convertPoint:inView toView:nil];
  [NSApp postEvent:[NSEvent mouseEventWithType:type location:at modifierFlags:0 timestamp:0 windowNumber:_window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1] atStart:NO];
}

- (void)pokeX:(double)x y:(double)y right:(BOOL)right {
  [self postMouse:right ? NSEventTypeRightMouseDown : NSEventTypeLeftMouseDown x:x y:y];
  // as long as a mouse's: a touch that lifts in the instant it lands is no tap to a device
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kClickSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self postMouse:right ? NSEventTypeRightMouseUp : NSEventTypeLeftMouseUp x:x y:y];
  });
}

/// A button held, or drawn from one place to another, by the events a mouse sends: a step a display's tick apart.
- (void)pokeX:(double)x y:(double)y toX:(double)x2 toY:(double)y2 seconds:(double)seconds {
  [self postMouse:NSEventTypeLeftMouseDown x:x y:y];
  int steps = x == x2 && y == y2 ? 0 : MAX(1, (int)(seconds / 0.016));
  for (int i = 1; i <= steps; i++) {
    double at = (double)i / steps;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(at * seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self postMouse:NSEventTypeLeftMouseDragged x:x + (x2 - x) * at y:y + (y2 - y) * at];
    });
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((seconds + 0.02) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self postMouse:NSEventTypeLeftMouseUp x:x2 y:y2];
  });
}

- (BOOL)snapshot:(NSString *)file {
  return MVWriteWindow(_window, file);
}

- (void)pokeButton:(NSString *)name {
  [_view pressButton:name];
}

- (void)pokeText:(NSString *)text {
  // what a keyboard's letters end in: a window kept behind is never the key window, so no real key gets this far
  [_view insertText:text replacementRange:NSMakeRange(NSNotFound, 0)];
}

- (void)pokeKey:(NSString *)characters {
  NSEvent *e = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:_window.windowNumber context:nil characters:characters charactersIgnoringModifiers:characters isARepeat:NO keyCode:0];
  // to the window itself: this app need not be the active one for an acceptance run
  [_window sendEvent:e];
}

- (void)windowDidChangeOcclusionState:(NSNotification *)notification {
  if (self.onHidden) self.onHidden(!(_window.occlusionState & NSWindowOcclusionStateVisible));
}

- (void)windowWillClose:(NSNotification *)notification {
  MVEmit(@{@"op": @"closed"});
  exit(0);
}

@end
